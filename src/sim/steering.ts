/**
 * Steering: how a body decides where to walk. DESIGN.md §15.1.
 *
 * Every body is either engaged - something is in range, it attacks, it does
 * not move and nothing moves it - or seeking. A seeker walks downhill on a
 * distance field whose goals are the free attack positions around every enemy
 * and whose obstacles are everything standing still, and slides off whatever
 * it touches on the way. That is all of it. There is no slot assignment, no
 * tangent steering, no stuck detection, no give-up timer and no post-hoc
 * separation pass, because with those two rules there is nothing left for any
 * of them to fix. See motion.ts and flowfield.ts for the two halves, and
 * docs/PATHING.md for why it is this and not something else.
 *
 * None of it knows what a lane is. It is handed a `World` (context.ts) - a
 * size, a set of edges and whatever is solid in it - so the same rules run in
 * a player's lane and in the Final Showdown's cross arena (§3.3, replaced).
 */

import {
  clearField,
  computeFlowField,
  createFlowField,
  goalOwner,
  markOutside,
  markCrowd,
  markObstacle,
  markRing,
  NO_OWNER,
  PASSAGE_CLEARANCE,
  SOURCE_WAIT,
  standingCost,
  steerAlongField,
  UNREACHABLE,
  W_DIAG,
} from './flowfield.ts';
import type { FieldShape } from './flowfield.ts';
import { orderByPriority, slideStep, spineDx, type Body } from './motion.ts';
import { SECONDS_PER_TICK } from './constants.ts';
import type { SimContext, World } from './context.ts';
import type { DefensiveUnit, Monster, Vec2 } from './types.ts';

/**
 * The field for one kind of seeker of one radius and range in one world, made
 * on first use. Both come from data/ and there are only a few combinations, so
 * this settles to a handful of fields per lane once every unit type has walked.
 *
 * `scope` separates fields that must not be shared: one per lane, and in the
 * arena one per army, since two armies standing in the same place want
 * opposite answers out of it.
 */
function fieldFor(
  ctx: SimContext,
  world: World,
  scope: string,
  /** Part of the field's cache key: one field per kind of seeker and goal. */
  kind: string,
  radius: number,
  range: number,
) {
  const key = `${world.id}:${scope}:${kind}:${radius}:${range}`;
  let field = ctx.fields.get(key);
  if (!field) {
    field = createFlowField(world.width, world.depth, world.originY, world.subdivision);
    ctx.fields.set(key, field);
  }
  return field;
}

/**
 * How far a seeker looks along the field, in cells. Far enough that the walk
 * toward the chosen cell averages out the grid; near enough that it cannot aim
 * at something on the far side of an obstacle it has not yet rounded.
 */
const LOOKAHEAD_CELLS = 3;

// Scratch values, reused so that a tick allocates nothing (§15.3).
const scratchDirection: Vec2 = { x: 0, y: 0 };
const order: number[] = [];
/** (radius, range) pairs seen this tick, deduplicated without allocating a Set. */
const shapesRadius: number[] = [];
const shapesRange: number[] = [];
const shapesPhasing: boolean[] = [];

/** Every body that walks: a unit or a monster, seen through what planning needs. */
export type Walker = DefensiveUnit | Monster;

/** A body that is not going anywhere on its own: terrain, as far as the field is concerned. */
export function holdsStill(body: Walker): boolean {
  return body.engaged || body.moveSpeed === 0;
}

/**
 * A body in the form the field wants it. One shared record, refilled per call:
 * `markObstacle` and `markRing` read it and are done with it before the next
 * call, and a tick marks hundreds of bodies (§15.3: no per-frame allocation).
 * Nothing may hold on to what this returns.
 */
const scratchShape: FieldShape = { x: 0, y: 0, radius: 0, halfWidth: 0 };
export function shapeOf(body: Body): FieldShape {
  scratchShape.x = body.pos.x;
  scratchShape.y = body.pos.y;
  scratchShape.radius = body.radius;
  scratchShape.halfWidth = body.halfWidth;
  return scratchShape;
}

/**
 * Give every seeking body of one kind its direction for the tick.
 *
 * One field per (radius, range) present among the seekers: obstacles are every
 * enemy body and every ally that is not going to move - engaged, or unable to
 * walk - inflated by that radius; goals are the free positions from which an
 * enemy is in range. When there are none, the positions beside the allies that
 * are attacking are the goals instead, so a body with nothing to attack waits
 * where it is nearest to the next position to free up.
 *
 * A seeker reads the field for a direction. Where the field has nothing better
 * to offer, it is on or beside a goal, or enclosed. On or beside an attack
 * position it walks straight at the enemy the position belongs to and lets
 * contact stop it; anywhere else it stands still. Nothing presses into a crowd:
 * a body with nowhere to go does not push, which is what keeps a waiting crowd
 * from wedging itself into a shape nothing can move through.
 */
export function planMoves(
  ctx: SimContext,
  world: World,
  /** Whose field this is: a lane's team, or an army's. Never shared. */
  scope: string,
  kind: string,
  seekers: readonly Walker[],
  enemies: readonly Body[],
  allies: readonly Walker[],
  enemiesBlock: boolean,
  /**
   * The one body everyone is walking at - the fortress, for a wave with
   * nothing else to fight. Null: the goal is `targets`' attack rings instead.
   */
  goal: Body | null,
  targets: readonly Body[] = enemies,
): void {
  shapesRadius.length = 0;
  shapesRange.length = 0;
  shapesPhasing.length = 0;
  for (const seeker of seekers) {
    if (!seeker.alive || seeker.engaged) continue;
    let seen = false;
    for (let i = 0; i < shapesRadius.length; i++) {
      if (
        shapesRadius[i] === seeker.radius &&
        shapesRange[i] === seeker.range &&
        shapesPhasing[i] === seeker.phasesMonsters
      ) {
        seen = true;
        break;
      }
    }
    if (!seen) {
      shapesRadius.push(seeker.radius);
      shapesRange.push(seeker.range);
      // Part of the shape, because it changes which bodies are terrain: a boss
      // routes as though the swarm around it were not there (§3.4).
      shapesPhasing.push(seeker.phasesMonsters);
    }
  }

  const anyEnemy = enemies.some((e) => e.alive);

  for (let shape = 0; shape < shapesRadius.length; shape++) {
    const radius = shapesRadius[shape]!;
    const range = shapesRange[shape]!;
    const phasing = shapesPhasing[shape]!;
    const field = fieldFor(
      ctx,
      world,
      scope,
      `${kind}:${phasing ? 'phase' : 'solid'}`,
      radius,
      range,
    );
    clearField(field);
    // The world's own edges are terrain too: a body cannot stand with half of
    // itself outside them, and a goal marked where one cannot stand is a goal
    // a crowd walks at forever (flowfield.ts, `markOutside`).
    markOutside(field, world.bounds, radius);

    // Everything the seeker must get PAST is inflated by a hair more than its
    // own radius; the body it is walking up to HIT is inflated by exactly its
    // radius, since touching that one is the point. See PASSAGE_CLEARANCE.
    const past = radius + PASSAGE_CLEARANCE;

    if (enemiesBlock) {
      // A unit's field rings every monster, so every monster is something it
      // might walk up and hit; a monster's chase field rings only what is
      // actually being chased, and the rest of the line is terrain to get past.
      const allTargets = targets === enemies;
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        const touching = allTargets || targets.includes(enemy);
        markObstacle(field, shapeOf(enemy), touching ? radius : past);
      }
    }
    for (const ally of allies) {
      if (!ally.alive) continue;
      // §3.4: a boss and the monsters around it are not terrain to each other,
      // so neither routes around the other. Units are unaffected - they never
      // phase, so neither clause fires on a defender's field.
      if (phasing && ally.monster) continue;
      if (ally.phasesMonsters) continue;
      // An ally that is going nowhere is terrain. One that is walking is not -
      // it will have moved by the time anyone gets there - but it is not free
      // ground either: getting past a body takes time, and a route that goes
      // through one should say so. See CROWD_COST.
      if (holdsStill(ally)) markObstacle(field, shapeOf(ally), past);
      else markCrowd(field, shapeOf(ally), radius);
    }
    // Whatever this world has that never moves. In a lane that is the
    // fortress, and it is solid to everyone: without it a monster with nothing
    // else to do walks into the wall and out the bottom of the lane. The arena
    // has none.
    for (const solid of world.solids) {
      markObstacle(field, shapeOf(solid), solid === goal ? radius : past);
    }

    // Rings go on after every obstacle, so a covered ring cell is not a goal.
    if (goal) {
      markRing(field, shapeOf(goal), radius, range, goal.id);
    } else {
      for (const enemy of targets) {
        if (!enemy.alive) continue;
        markRing(field, shapeOf(enemy), radius, range, enemy.id);
      }
    }
    const sources = computeFlowField(field);

    // Nothing free to attack from: wait beside whoever is attacking.
    if (sources === 0 && (goal || anyEnemy)) {
      const beside = 1 / field.subdivision;
      for (const ally of allies) {
        if (!ally.alive || !holdsStill(ally)) continue;
        markRing(field, shapeOf(ally), radius, beside, NO_OWNER, SOURCE_WAIT);
      }
      computeFlowField(field);
    }

    for (const seeker of seekers) {
      if (!seeker.alive || seeker.engaged) continue;
      if (seeker.radius !== radius || seeker.range !== range) continue;

      const cell = steerAlongField(
        field,
        seeker.pos,
        scratchDirection,
        LOOKAHEAD_CELLS,
        seeker.fieldCell,
      );
      seeker.fieldCell = cell;

      const here = standingCost(field, seeker.pos);
      if (cell !== -1) {
        seeker.moveX = scratchDirection.x;
        seeker.moveY = scratchDirection.y;
        // Priority: how far this body is from a goal. A body enclosed on every
        // side reads the cell it is escaping to, plus the escape.
        seeker.pathCost = here === UNREACHABLE ? field.cost[cell]! + W_DIAG : here;
        continue;
      }

      // Nothing better within reach. On or beside an attack position, close on
      // the enemy it belongs to and let contact decide; otherwise stand.
      seeker.pathCost = here;
      seeker.moveX = 0;
      seeker.moveY = 0;
      const ownerId = goalOwner(field, seeker.pos);
      const target =
        ownerId === NO_OWNER
          ? // Nowhere to stand and no goal beside it: the route is sealed, and
            // what seals it is a defender. Head for the nearest one - it is
            // both the obstacle and the only thing worth doing about it.
            here === UNREACHABLE
            ? nearestOf(enemies, seeker)
            : null
          : bodyById(enemies, world.solids, ownerId);
      if (!target) continue;
      // Close along the axis the range check measures on: the nearest point
      // of the target's SPINE, not its centre. For a circle the two are the
      // same. For the fortress - a wall the width of the lane (§4) - they are
      // not: a monster standing at one end of it would walk the length of the
      // wall toward the middle, through everything already fighting there,
      // rather than the few inches straight ahead into the stonework.
      const dx = spineDx(target.pos.x, target.halfWidth, seeker.pos.x, 0);
      const dy = target.pos.y - seeker.pos.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length > 1e-9) {
        seeker.moveX = dx / length;
        seeker.moveY = dy / length;
      }
    }
  }

  for (const seeker of seekers) {
    if (!seeker.alive || !seeker.engaged) continue;
    seeker.moveX = 0;
    seeker.moveY = 0;
    seeker.pathCost = 0;
  }
}

/** The closest living enemy by centre distance, or null. */
export function nearestOf(enemies: readonly Body[], self: Walker): Body | null {
  let best: Body | null = null;
  let bestDistance = Infinity;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.pos.x - self.pos.x;
    const dy = enemy.pos.y - self.pos.y;
    const d = dx * dx + dy * dy;
    if (d < bestDistance) {
      bestDistance = d;
      best = enemy;
    }
  }
  return best;
}

/** The enemy a goal cell was marked for: one of `enemies`, or a solid. */
function bodyById(enemies: readonly Body[], solids: readonly Body[], id: number): Body | null {
  for (const solid of solids) if (solid.id === id) return solid;
  for (const enemy of enemies) if (enemy.id === id && enemy.alive) return enemy;
  return null;
}

/**
 * Move every seeker of one kind, nearest-to-a-goal first, each sliding off
 * everything settled and walking through the seekers still to move. See
 * motion.ts on why that order and that rule are the whole of the crowd
 * behaviour.
 */
export function moveSeekers(
  world: World,
  seekers: readonly Walker[],
  speedOf: (seeker: Walker) => number,
  obstacles: readonly (readonly Body[])[],
): void {
  let count = 0;
  for (let i = 0; i < seekers.length; i++) {
    const seeker = seekers[i]!;
    if (!seeker.alive) continue;
    seeker.settled = holdsStill(seeker);
    if (seeker.settled) continue;
    order[count++] = i;
  }
  if (count === 0) return;

  orderByPriority(
    order,
    count,
    (i) => seekers[i]!.pathCost,
    (i) => seekers[i]!.id,
  );

  for (let k = 0; k < count; k++) {
    const seeker = seekers[order[k]!]!;
    const step = speedOf(seeker) * SECONDS_PER_TICK;
    // A body with nowhere to go still resolves any overlap it is in - one that
    // has just spawned into a crowd, say - by sliding a zero-length step.
    slideStep(seeker, seeker.moveX, seeker.moveY, step, obstacles, world.bounds);
    seeker.settled = true;
  }
}

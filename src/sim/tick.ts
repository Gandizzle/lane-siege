/**
 * The fixed-timestep step function. DESIGN.md §15.1.
 *
 * `step(ctx, state, commands)` advances the match exactly one tick at
 * 20 ticks/second. No wall clock, no Math.random, no DOM, no Pixi. The server
 * runs this same function, which is what makes replays exact and desyncs
 * detectable.
 *
 * On mutation: §15.3 requires pooled objects and no per-frame allocation, which
 * rules out rebuilding the state tree every tick. So the state is mutated in
 * place and returned. Treat the returned reference as the new state and never
 * hold on to the old one - snapshot with `snapshot()` if you need history.
 *
 * MOVEMENT, IN ONE PARAGRAPH
 *
 * Every body is either engaged - something is in range, it attacks, it does not
 * move and nothing moves it - or seeking. A seeker walks downhill on a distance
 * field whose goals are the free attack positions around every enemy and whose
 * obstacles are everything standing still, and slides off whatever it touches
 * on the way. That is all of it. There is no slot assignment, no tangent
 * steering, no stuck detection, no give-up timer and no post-hoc separation
 * pass, because with those two rules there is nothing left for any of them to
 * fix. See motion.ts and flowfield.ts for the two halves, and docs/PATHING.md
 * for why it is this and not something else.
 */

import type { GameData } from '../data/schema.ts';
import {
  NO_ACQUIRE_LIMIT,
  SECONDS_PER_TICK,
  TICKS_PER_SECOND,
  secondsToTicks,
} from './constants.ts';
import type { Command } from './commands.ts';
import { applyCommands } from './apply.ts';
import { resolveDamage } from './damage.ts';
import { buildDefIndex, stat, type DefIndex } from './defs.ts';
import { auraFor, recomputeUnitBuffs } from './buffs.ts';
import { monsterEnrage } from './enrage.ts';
import {
  clearField,
  computeFlowField,
  createFlowField,
  goalOwner,
  markObstacle,
  markRing,
  NO_OWNER,
  SOURCE_WAIT,
  standingCost,
  steerAlongField,
  UNREACHABLE,
  W_DIAG,
} from './flowfield.ts';
import type { FieldShape, FlowField } from './flowfield.ts';
import { orderByPriority, slideStep, type Body, type Bounds } from './motion.ts';
import { admitFromReserve, countLiving, createMonster, placeWave } from './spawn.ts';
import { holdOrAcquire, nearestInRange, withinRange } from './targeting.ts';
import {
  FORTRESS_ID,
  type DefensiveUnit,
  type Lane,
  type MatchState,
  type Monster,
  type Vec2,
} from './types.ts';
import { generateWave, resolveMonsterStats, type SpawnSpec } from './waves.ts';

/** Everything a tick needs that is not match state: the data and its index. */
export interface SimContext {
  data: GameData;
  defs: DefIndex;
  /** Where monsters go once the lane is clear. Constant for a match (§5.5). */
  fortressPosition: Vec2;
  /** The fortress as a body, for what counts as being in range of it. */
  fortress: Body;
  /**
   * The same body as a one-element contact set, so the movement code can
   * include it without allocating an array every tick (§15.3).
   */
  fortressBodies: readonly Body[];
  /** The lane's edges. Bodies stay inside them. */
  bounds: Bounds;
  /**
   * Distance fields, one per lane per (kind, radius, range) that has needed one.
   * Scratch, derived entirely from the lane's contents and rebuilt each tick,
   * so it lives here rather than in MatchState - it is a way of looking at the
   * match, not part of it.
   */
  fields: Map<string, FlowField>;
}

export function createContext(data: GameData): SimContext {
  const lane = data.lane;
  const fortressPosition = {
    x: lane.buildZone.width / 2,
    y: lane.buildZone.depth + lane.fortressZoneDepth * 0.5,
  };
  // §4: a wall across the end of the lane, not a pebble at the middle of it -
  // a horizontal spine with a radius swept along it (motion.ts). Settled and
  // alive forever: it never moves and it is never removed, and a destroyed
  // fortress ends the lane rather than clearing the obstacle.
  const fortress: Body = {
    id: FORTRESS_ID,
    pos: fortressPosition,
    radius: lane.fortressRadius,
    halfWidth: lane.fortressHalfWidth,
    alive: true,
    settled: true,
    // Not a monster, and solid to every one of them - including bosses, which
    // pass through their own side and nothing else.
    monster: false,
    phasesMonsters: false,
  };

  return {
    data,
    defs: buildDefIndex(data),
    fortressPosition,
    fortress,
    fortressBodies: [fortress],
    bounds: {
      minX: 0,
      maxX: lane.buildZone.width,
      minY: -lane.spawnZoneDepth,
      maxY: lane.buildZone.depth + lane.fortressZoneDepth,
    },
    fields: new Map(),
  };
}

/**
 * The field for one kind of seeker of one radius and range in one lane, made
 * on first use. Both come from data/ and there are only a few combinations, so
 * this settles to a handful of fields per lane once every unit type has walked.
 */
function fieldFor(
  ctx: SimContext,
  teamId: string,
  /** Part of the field's cache key: one field per kind of seeker and goal. */
  kind: string,
  radius: number,
  range: number,
) {
  const key = `${teamId}:${kind}:${radius}:${range}`;
  let field = ctx.fields.get(key);
  if (!field) {
    const lane = ctx.data.lane;
    field = createFlowField(
      lane.buildZone.width,
      lane.spawnZoneDepth + lane.buildZone.depth + lane.fortressZoneDepth,
      -lane.spawnZoneDepth,
      lane.pathSubdivision,
    );
    ctx.fields.set(key, field);
  }
  return field;
}

/** Attack cooldown in ticks for a given attacks-per-second rate. */
function cooldownTicks(attacksPerSecond: number): number {
  if (attacksPerSecond <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(TICKS_PER_SECOND / attacksPerSecond));
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

/**
 * §8: every wave carries its own enrage clock, which keeps running while any of
 * its monsters are alive anywhere and stops when the last one dies.
 */
function advanceWaveClocks(state: MatchState): void {
  let finished = 0;
  for (const clock of state.waveClocks) {
    if (clock.remaining > 0) clock.age += 1;
    else finished++;
  }
  // Only rebuild the array when a wave has actually ended, so the common tick
  // allocates nothing.
  if (finished > 0) {
    state.waveClocks = state.waveClocks.filter((c) => c.remaining > 0);
  }
}

/**
 * §12: sight of an opponent's lane, bought with a send, runs out.
 *
 * Counted down on the watcher rather than the watched, so two opponents looking
 * at the same lane have their own clocks.
 */
function advanceVision(state: MatchState): void {
  for (const team of state.teams) {
    for (const watched of Object.keys(team.vision)) {
      const left = team.vision[watched] ?? 0;
      if (left > 0) team.vision[watched] = left - 1;
      else delete team.vision[watched];
    }
  }
}

// ------------------------------------------------------------ engage or seek

/**
 * Decide, for every unit, who it is fighting and whether it can reach them.
 *
 * §5.2: a unit holds its target until that dies, then takes the nearest. There
 * is no acquisition cap - a unit has no fortress of its own to walk at, so
 * "the nearest monster in the lane" is its default and it advances on one it
 * cannot yet reach (§5.2, amended: units advance rather than stand idle).
 *
 * `engaged` is narrower than `targetId`: a unit with a target three tiles away
 * has one to walk toward, not one to shoot. Cooldowns tick here so a body that
 * is walking still recovers.
 */
function classifyUnits(lane: Lane): void {
  for (const unit of lane.units) {
    if (!unit.alive) continue;
    if (unit.cooldown > 0) unit.cooldown -= 1;

    const target = holdOrAcquire(lane.monsters, unit, NO_ACQUIRE_LIMIT);
    unit.targetId = target ? target.id : null;
    unit.engaged = target !== null && withinRange(unit, target, unit.range);
  }
}

/**
 * The same for monsters, with one difference that changes how a whole wave
 * moves: a monster always has somewhere to be.
 *
 * §5.5 says the fortress is what a wave is for, and that is now the DEFAULT
 * rather than what is left when the lane is empty. A monster walks at the
 * fortress and looks no further than `monsterAcquireRange` for something to
 * fight; inside that it takes the nearest and keeps it until it dies or drifts
 * out; once it is trading blows it stops looking entirely.
 *
 * What this replaces is "every monster in the lane goes after the nearest unit
 * anywhere". That made one tower the destination of thirty bodies at once - a
 * global answer that every one of them recomputed every tick, and which changed
 * for all of them together whenever anything moved. A monster that cannot reach
 * a defender now simply carries on past it, which is what a lane defence looks
 * like, and the queue that used to form behind an unreachable target does not
 * form.
 */
function classifyMonsters(ctx: SimContext, lane: Lane): void {
  const acquireRange = ctx.data.lane.monsterAcquireRange;

  for (const monster of lane.monsters) {
    if (!monster.alive) continue;
    if (monster.cooldown > 0) monster.cooldown -= 1;

    const unit = holdOrAcquire(lane.units, monster, acquireRange);
    monster.targetId = unit ? unit.id : FORTRESS_ID;
    monster.engaged = withinRange(monster, unit ?? ctx.fortress, monster.range);
  }
}

// ------------------------------------------------------------------ planning

/** Every body that walks: a unit or a monster, seen through what planning needs. */
type Walker = DefensiveUnit | Monster;

/** A body that is not going anywhere on its own: terrain, as far as the field is concerned. */
function holdsStill(body: Walker): boolean {
  return body.engaged || body.moveSpeed === 0;
}

/**
 * A body in the form the field wants it. One shared record, refilled per call:
 * `markObstacle` and `markRing` read it and are done with it before the next
 * call, and a tick marks hundreds of bodies (§15.3: no per-frame allocation).
 * Nothing may hold on to what this returns.
 */
const scratchShape: FieldShape = { x: 0, y: 0, radius: 0, halfWidth: 0 };
function shapeOf(body: Body): FieldShape {
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
function planMoves(
  ctx: SimContext,
  lane: Lane,
  kind: string,
  seekers: readonly Walker[],
  enemies: readonly Body[],
  allies: readonly Walker[],
  enemiesBlock: boolean,
  /** True: the goal is the fortress. False: the goal is `targets`' attack rings. */
  fortressGoal: boolean,
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
  const goal = fortressGoal ? ctx.fortress : null;

  for (let shape = 0; shape < shapesRadius.length; shape++) {
    const radius = shapesRadius[shape]!;
    const range = shapesRange[shape]!;
    const phasing = shapesPhasing[shape]!;
    const field = fieldFor(
      ctx,
      lane.teamId,
      `${kind}:${phasing ? 'phase' : 'solid'}`,
      radius,
      range,
    );
    clearField(field);

    if (enemiesBlock) {
      for (const enemy of enemies) {
        if (enemy.alive) markObstacle(field, shapeOf(enemy), radius);
      }
    }
    for (const ally of allies) {
      if (!ally.alive || !holdsStill(ally)) continue;
      // §3.4: a boss and the monsters around it are not terrain to each other,
      // so neither routes around the other. Units are unaffected - they never
      // phase, so neither clause fires on a defender's field.
      if (phasing && ally.monster) continue;
      if (ally.phasesMonsters) continue;
      markObstacle(field, shapeOf(ally), radius);
    }
    // The fortress is solid to everyone. Without this a monster with nothing
    // else to do walks into the wall and out the bottom of the lane.
    markObstacle(field, shapeOf(ctx.fortress), radius);

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
          : bodyById(enemies, ctx, ownerId);
      if (!target) continue;
      const dx = target.pos.x - seeker.pos.x;
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

/**
 * Monsters move in two groups, and which group a monster is in is the whole of
 * how a wave behaves.
 *
 * SEEKERS have caught sight of nothing and are walking at the fortress (§5.5).
 * Defenders are obstacles to route around, not destinations - so a tower off to
 * one side is simply passed, and thirty bodies do not all turn toward it.
 *
 * CHASERS have a defender inside their acquisition range and are going to fight
 * it. They get the older behaviour, and they need it: their goals are the free
 * attack positions around the defenders that are actually being chased, which
 * is what makes a body walk round a full ring to the one gap in it instead of
 * pressing into the back of it. Confining that to bodies already within
 * acquisition range is what keeps it from becoming a lane-wide stampede - it is
 * a local crowd solving a local problem.
 *
 * Both groups are built into scratch arrays rather than fresh ones: this runs
 * per lane per tick (§15.3).
 */
const seekingScratch: Walker[] = [];
const chasingScratch: Walker[] = [];
const chasedScratch: Body[] = [];

function planMonsterMoves(ctx: SimContext, lane: Lane, unitsBlock: boolean): void {
  seekingScratch.length = 0;
  chasingScratch.length = 0;
  chasedScratch.length = 0;

  for (const monster of lane.monsters) {
    if (!monster.alive || monster.engaged) continue;
    const target =
      monster.targetId === FORTRESS_ID || monster.targetId === null
        ? null
        : (lane.units.find((u) => u.id === monster.targetId && u.alive) ?? null);

    if (!target) {
      seekingScratch.push(monster);
      continue;
    }
    chasingScratch.push(monster);
    if (!chasedScratch.includes(target)) chasedScratch.push(target);
  }

  if (seekingScratch.length > 0) {
    planMoves(ctx, lane, 'toFortress', seekingScratch, lane.units, lane.monsters, unitsBlock, true);
  }
  if (chasingScratch.length > 0) {
    planMoves(
      ctx,
      lane,
      'toTarget',
      chasingScratch,
      lane.units,
      lane.monsters,
      unitsBlock,
      false,
      chasedScratch,
    );
  }

  // Engaged monsters are not in either group and are going nowhere.
  for (const monster of lane.monsters) {
    if (!monster.alive || !monster.engaged) continue;
    monster.moveX = 0;
    monster.moveY = 0;
    monster.pathCost = 0;
  }
}

/** The closest living enemy by centre distance, or null. */
function nearestOf(enemies: readonly Body[], self: Walker): Body | null {
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

/** The enemy a goal cell was marked for: one of `enemies`, or the fortress. */
function bodyById(enemies: readonly Body[], ctx: SimContext, id: number): Body | null {
  if (id === ctx.fortress.id) return ctx.fortress;
  for (const enemy of enemies) if (enemy.id === id && enemy.alive) return enemy;
  return null;
}

// ------------------------------------------------------------------- moving

/**
 * Move every seeker of one kind, nearest-to-a-goal first, each sliding off
 * everything settled and walking through the seekers still to move. See
 * motion.ts on why that order and that rule are the whole of the crowd
 * behaviour.
 */
function moveSeekers(
  ctx: SimContext,
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
    slideStep(seeker, seeker.moveX, seeker.moveY, step, obstacles, ctx.bounds);
    seeker.settled = true;
  }
}

// ----------------------------------------------------------------- fighting

function unitsAttack(ctx: SimContext, lane: Lane): void {
  for (const unit of lane.units) {
    if (!unit.alive || !unit.engaged || unit.cooldown > 0) continue;

    const def = ctx.defs.units.get(unit.defId);
    if (!def) continue;
    const target = lane.monsters.find((m) => m.id === unit.targetId && m.alive);
    if (!target) continue;

    // §7.4 tech is cached on the unit; §10.1 aura depends on where it is
    // standing right now, so it is evaluated here (see buffs.ts on why).
    const aura = auraFor(lane, unit, ctx.fortressPosition);

    const dealt = resolveDamage(
      ctx.data.matrix.multipliers,
      stat(def.damage) * unit.techDamage * aura.damage,
      def.damageType,
      target.armour,
    );
    // Credited with what the monster actually lost. A killing blow worth three
    // times the HP left is worth the HP left: see `damageDealt` in types.ts.
    unit.damageDealt += target.hp > 0 ? Math.min(dealt, target.hp) : 0;
    target.hp -= dealt;
    unit.cooldown = cooldownTicks(stat(def.attackSpeed) * unit.techAttackSpeed * aura.attackSpeed);
    lane.attacks.push({ attackerId: unit.id, targetId: target.id });
  }
}

function monstersAttack(ctx: SimContext, lane: Lane, state: MatchState): void {
  const enrageConfig = ctx.data.waves.enrage;

  for (const monster of lane.monsters) {
    if (!monster.alive || !monster.engaged || monster.cooldown > 0) continue;

    // §8: enrage raises damage and attack speed. Never HP - a stalling player
    // should face deadlier monsters, not unkillable ones.
    const multiplier = monsterEnrage(state, monster, enrageConfig);
    const damage = monster.damage * multiplier;

    if (monster.targetId !== FORTRESS_ID) {
      const target = lane.units.find((u) => u.id === monster.targetId && u.alive);
      if (!target) continue;
      target.hp -=
        resolveDamage(ctx.data.matrix.multipliers, damage, monster.damageType, target.armour) *
        auraFor(lane, target, ctx.fortressPosition).damageTaken;
      lane.attacks.push({ attackerId: monster.id, targetId: target.id });
    } else {
      // Sieging the fortress (§5.5).
      lane.fortress.hp -= resolveDamage(
        ctx.data.matrix.multipliers,
        damage,
        monster.damageType,
        ctx.data.fortress.armour,
      );
      lane.attacks.push({ attackerId: monster.id, targetId: FORTRESS_ID });
    }

    monster.cooldown = cooldownTicks(monster.attackSpeed * multiplier);
  }
}

/** The whole movement-and-combat pipeline for one lane, in order. */
function laneTick(ctx: SimContext, lane: Lane, state: MatchState): void {
  const enrageConfig = ctx.data.waves.enrage;
  const unitsBlock = ctx.data.lane.unitsBlockMovement !== false;

  // Last tick's blows are last tick's news. Emptied in place rather than
  // replaced, so the common tick allocates nothing (§15.3).
  lane.attacks.length = 0;

  // 1. Who is fighting and who is walking, from where everyone is now.
  classifyUnits(lane);
  classifyMonsters(ctx, lane);

  // 2. Every walker picks a direction, off fields built from step 1.
  planMoves(ctx, lane, 'unit', lane.units, lane.monsters, lane.units, true, false);
  planMonsterMoves(ctx, lane, unitsBlock);

  // 3. Everyone walks: units first, then monsters. Whichever kind is not
  // moving is settled - where it is now is where it will be - and monsters
  // carry enrage on their speed (§8).
  // The fortress is in every contact set: it is solid to both kinds, and
  // without it a besieging crowd presses straight through the wall.
  const obstacles: (readonly Body[])[] = unitsBlock
    ? [lane.units, lane.monsters, ctx.fortressBodies]
    : [lane.monsters, ctx.fortressBodies];
  for (const monster of lane.monsters) monster.settled = true;
  moveSeekers(ctx, lane.units, (u) => u.moveSpeed, [lane.units, lane.monsters, ctx.fortressBodies]);
  for (const unit of lane.units) unit.settled = true;
  moveSeekers(
    ctx,
    lane.monsters,
    (m) => (m as Monster).moveSpeed * monsterEnrage(state, m as Monster, enrageConfig),
    obstacles,
  );

  // 4. Everyone who was fighting lands a hit if their cooldown allows.
  unitsAttack(ctx, lane);
  monstersAttack(ctx, lane, state);
}

/**
 * §10.1: the fortress weapon is the last line of defence and must reliably kill
 * one or two current-wave monsters unaided, so that small leaks self-repair and
 * large ones are correctly fatal. Its damage type is chosen by the player each
 * build phase.
 */
function fortressActs(ctx: SimContext, lane: Lane): void {
  if (lane.fortress.destroyed) return;

  if (lane.fortress.weaponCooldown > 0) {
    lane.fortress.weaponCooldown -= 1;
    return;
  }

  const weapon = ctx.data.fortress.weapon;
  // From the wall, not from a point at the middle of it: a monster chewing the
  // far end of a five-tile fortress is in range of the fortress.
  const target = nearestInRange(lane.monsters, ctx.fortress, stat(weapon.range));
  if (!target) return;

  target.hp -= resolveDamage(
    ctx.data.matrix.multipliers,
    stat(weapon.damage),
    lane.fortress.weaponDamageType,
    target.armour,
  );
  lane.fortress.weaponCooldown = cooldownTicks(stat(weapon.attackSpeed));
  lane.attacks.push({ attackerId: FORTRESS_ID, targetId: target.id });
}

/**
 * §11.1: the defender always gets the bounty, including for monsters an
 * opponent sent at them.
 *
 * §5.5: when the lane goes fully clear the fortress regenerates, so chip damage
 * is not permanent. That lever plus the fortress weapon is the primary control
 * over when the first player is eliminated - target wave 13-15, not wave 8.
 */
function reapDead(ctx: SimContext, lane: Lane, state: MatchState): void {
  let anyMonsterDied = false;

  for (const monster of lane.monsters) {
    if (!monster.alive || monster.hp > 0) continue;
    monster.alive = false;
    anyMonsterDied = true;

    lane.economy.gold += monster.bounty;

    const clock = state.waveClocks.find((c) => c.waveNumber === monster.waveNumber);
    if (clock) clock.remaining -= 1;
  }

  for (const unit of lane.units) {
    if (!unit.alive) continue;

    // §10.1 regeneration aura.
    const regen = auraFor(lane, unit, ctx.fortressPosition).regenPerSecond;
    if (regen > 0 && unit.hp > 0 && unit.hp < unit.maxHp) {
      unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp * regen * SECONDS_PER_TICK);
    }

    if (unit.hp <= 0) unit.alive = false;
  }

  if (anyMonsterDied) {
    // Drop the corpses, then let the reserve queue refill the free slots (§8.1).
    lane.monsters = lane.monsters.filter((m) => m.alive);
    admitFromReserve(state, ctx.data, ctx.defs, lane);

    // §5.5, amended: regeneration on a full clear is an upgrade, so this is a
    // no-op until one is bought. Chip damage is otherwise permanent.
    if (
      lane.fortress.regenPerClear > 0 &&
      countLiving(lane) === 0 &&
      lane.reserve.length === 0 &&
      !lane.fortress.destroyed
    ) {
      lane.fortress.hp = Math.min(
        lane.fortress.maxHp,
        lane.fortress.hp + lane.fortress.regenPerClear,
      );
    }
  }

  if (lane.fortress.hp <= 0) lane.fortress.destroyed = true;
}

/**
 * §5.4: all defensive units respawn fully at the start of each build phase, so
 * losing your line on wave 4 is a temporary setback - the punishment is the leak
 * damage, not the loss of the investment.
 *
 * §3.3: from wave 25 respawn stops and losses are permanent.
 */
function respawnUnits(ctx: SimContext, lane: Lane, state: MatchState): void {
  if (state.wave >= ctx.data.waves.attritionStartWave) return;

  for (const unit of lane.units) {
    unit.alive = true;
    unit.hp = unit.maxHp;
    unit.targetId = null;
    unit.cooldown = 0;
    // Units advance during combat (§5.2, amended), so put the line back on the
    // tiles the player chose rather than leaving it wherever it drifted to.
    unit.pos.x = unit.homeTileX + 0.5;
    unit.pos.y = unit.homeTileY + 0.5;
    unit.engaged = false;
    unit.fieldCell = -1;
  }
}

/**
 * A new build phase opens: what was bought in the last one is no longer a
 * mistake that can be taken back at full price (§11, sell).
 *
 * Every lane, including eliminated ones - they cannot sell anyway, and a rule
 * that skips lanes is a rule with an exception to remember.
 */
function rollOverUnitSpend(state: MatchState): void {
  for (const lane of Object.values(state.lanes)) {
    for (const unit of lane.units) {
      unit.spend.earlier += unit.spend.thisPhase;
      unit.spend.thisPhase = 0;
    }
  }
}

/** Put a wave into every living lane. All lanes face identical waves (§9.2). */
function spawnWave(ctx: SimContext, state: MatchState): void {
  const specs = generateWave(ctx.data, state.seed, state.wave);
  if (specs.length === 0) return;

  const cap = ctx.data.waves.maxConcurrentMonsters;
  let totalSpawned = 0;

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

    // §11.5: monsters an opponent sent at this lane join its next wave. The
    // defender still collects their bounty.
    const incoming = lane.incomingSends.map((s) => ({
      defId: s.defId,
      waveNumber: state.wave,
    }));
    lane.incomingSends.length = 0;
    // The "you are being attacked by X" notice belongs to the wave that is
    // coming, so it clears when that wave actually lands.
    lane.sendLog.length = 0;

    // Everyone who fits under the cap spawns together, as one packed clump at
    // the centre of the spawn zone; the rest wait in reserve (§8.1).
    const arriving: SpawnSpec[] = [];
    for (const spec of [...specs, ...incoming]) {
      if (arriving.length + countLiving(lane) < cap) {
        arriving.push(spec);
      } else {
        lane.reserve.push(spec);
      }
      totalSpawned++;
    }

    const radii = arriving.map((spec) => {
      const def = ctx.defs.monsters.get(spec.defId);
      return def ? resolveMonsterStats(ctx.data, def, spec.waveNumber).radius : 0.3;
    });
    const positions = placeWave(ctx.data, radii);
    arriving.forEach((spec, i) => {
      const monster = createMonster(state, ctx.data, ctx.defs, spec, positions[i]!);
      if (monster) lane.monsters.push(monster);
    });
  }

  if (totalSpawned > 0) {
    state.waveClocks.push({
      waveNumber: state.wave,
      age: 0,
      // One clock per wave across all lanes: it stops when the last monster of
      // this wave dies anywhere (§8).
      remaining: totalSpawned,
    });
  }
}

/**
 * §3.1, amended: build phase, then combat.
 *
 * DESIGN CHANGE to §3.2. The original had waves spawning on a fixed global
 * clock so that one slow player could not hold three others hostage. That also
 * meant a second wave could land on top of an unfinished one and wreck the
 * build cycle, so the clock is gone: the ONLY global timers left are the 30s
 * build phase and the enrage clock (§8).
 *
 * Combat now runs until every living lane is empty. The hostage problem is
 * handled at the other end instead - enrage keeps climbing on a lane that
 * cannot clear (§8), and when that lane's fortress falls its monsters are wiped
 * from the board and it stops receiving waves, so it cannot stall the match
 * indefinitely.
 */
function allLanesClear(state: MatchState): boolean {
  const living = state.teams.filter((t) => !t.eliminated);
  if (living.length === 0) return true;

  return living.every((team) => {
    const lane = state.lanes[team.id];
    if (!lane) return true;
    return lane.reserve.length === 0 && countLiving(lane) === 0;
  });
}

function advancePhase(ctx: SimContext, state: MatchState): void {
  if (state.phase === 'build') {
    if (state.phaseTicksLeft > 0) {
      state.phaseTicksLeft -= 1;
      return;
    }

    state.phase = 'combat';
    state.wave += 1;
    // Combat has no clock of its own. It ends when the lanes are empty.
    state.phaseTicksLeft = 0;
    spawnWave(ctx, state);

    // §15.3: recompute on wave start, not per tick.
    for (const team of state.teams) {
      if (team.eliminated) continue;
      const lane = state.lanes[team.id];
      if (!lane) continue;
      recomputeUnitBuffs(ctx.data, ctx.defs, lane);
      // The round's scoreboard starts here rather than when the build phase
      // opened, which is what leaves the last wave's numbers up to be read
      // for the whole of that build phase (§14.1, added).
      for (const unit of lane.units) unit.damageDealt = 0;
    }
    return;
  }

  if (!allLanesClear(state)) return;

  state.phase = 'build';
  state.phaseTicksLeft = secondsToTicks(ctx.data.waves.buildPhaseSeconds);
  rollOverUnitSpend(state);

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

    respawnUnits(ctx, lane, state);
    // §11.6: passive income is paid each wave and compounds over the match.
    // Gems are not: the resource building pays them out on its own clock
    // (§10.2, amended) - see `produceGems`.
    lane.economy.gold += lane.economy.passiveIncome;
  }
}

/**
 * Clear a dead player's lane.
 *
 * Their monsters would otherwise sit there forever: nothing kills them, and
 * since combat now ends only when every lane is empty (§3.2, amended), they
 * would stall the match for everyone still playing. Wave clocks are decremented
 * for each one removed, or the wave never ends and enrage keeps climbing (§8).
 */
function wipeLane(state: MatchState, lane: Lane): void {
  for (const monster of lane.monsters) {
    if (!monster.alive) continue;
    const clock = state.waveClocks.find((c) => c.waveNumber === monster.waveNumber);
    if (clock) clock.remaining -= 1;
    monster.alive = false;
  }
  for (const spec of lane.reserve) {
    const clock = state.waveClocks.find((c) => c.waveNumber === spec.waveNumber);
    if (clock) clock.remaining -= 1;
  }

  lane.monsters.length = 0;
  // Nothing is swinging in a wiped lane, so nothing should still be drawn
  // swinging in it either.
  lane.attacks.length = 0;
  lane.reserve.length = 0;
  lane.incomingSends.length = 0;
}

/** §13: fortress HP at zero eliminates that team; placement locks in there. */
function checkEliminations(state: MatchState): void {
  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane || !lane.fortress.destroyed) continue;

    team.eliminated = true;
    wipeLane(state, lane);
    // Count up from the bottom: the first out places last. Counting survivors
    // would give two teams eliminated on the same tick the same placement.
    state.eliminatedCount += 1;
    team.placement = state.teams.length - state.eliminatedCount + 1;
  }

  const living = state.teams.filter((t) => !t.eliminated).length;
  // §13: the match ends when one team remains. A solo lane - the M1 harness, or
  // a practice run - has no opponent to outlast, so it ends only when its own
  // fortress falls, not instantly.
  state.finished = state.teams.length > 1 ? living <= 1 : living === 0;
}

// ----------------------------------------------------------------------- step

/** Advance the match one tick. Returns the same (mutated) state object. */
export function step(
  ctx: SimContext,
  state: MatchState,
  commands: readonly Command[] = [],
): MatchState {
  if (state.finished) return state;

  applyCommands(ctx, state, commands);

  state.tick += 1;
  advanceWaveClocks(state);
  advanceVision(state);
  advancePhase(ctx, state);

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

    laneTick(ctx, lane, state);
    fortressActs(ctx, lane);
    produceGems(lane);
    reapDead(ctx, lane, state);
  }

  checkEliminations(state);
  return state;
}

/**
 * §10.2, amended: the resource building hands over gems on its own clock.
 *
 * Every tick, in both phases, for as long as the lane is alive. Gems that
 * arrive while you play are a different thing from gems that arrive in a lump
 * at the end of a wave: the second is a wave's reward, and the first is a
 * reason to have built the building early, which is what an economy upgrade is
 * supposed to be.
 *
 * An integer countdown rather than a fraction accumulated per tick. The two
 * agree on the long run and disagree about exactly which tick a payout lands
 * on; the countdown cannot drift, and there is nothing to argue about between
 * two clients running the same match.
 */
function produceGems(lane: Lane): void {
  const fortress = lane.fortress;
  if (fortress.gemPayoutTicks <= 0) return;

  fortress.gemCooldown -= 1;
  if (fortress.gemCooldown > 0) return;

  lane.economy.gems += fortress.gemsPerPayout;
  fortress.gemCooldown = fortress.gemPayoutTicks;
}

/** Deep copy, for replays, desync comparison and tests. */
export function snapshot(state: MatchState): MatchState {
  return structuredClone(state);
}

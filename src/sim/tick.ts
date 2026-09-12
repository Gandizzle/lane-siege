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
 */

import type { GameData } from '../data/schema.ts';
import {
  MONSTER_RETARGET_TICKS,
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
import { hasLineOfSight, isPositionBlocked, rebuildOccupancy } from './grid.ts';
import {
  clearField,
  computeFlowField,
  createFlowField,
  markGoalBody,
  markObstacle,
  markSourceRow,
  sampleCost,
  steerAlongField,
} from './flowfield.ts';
import type { FlowField } from './flowfield.ts';
import { blocksPath, chooseSide, findBlocker, writeTangentWaypoint } from './avoidance.ts';
import { pushOutOf, relaxSeparation } from './separation.ts';
import { slotIndexFor, writeSlotPosition } from './slots.ts';
import { admitFromReserve, countLiving, createMonster } from './spawn.ts';
import { clearStuck, stepToward, updateStuckDetection } from './steering.ts';
import {
  distanceSquared,
  holdOrDrop,
  nearestMonsterInRange,
  nearestUnit,
  writeUnitPosition,
} from './targeting.ts';
import type { DefensiveUnit, Lane, MatchState, Monster, Vec2 } from './types.ts';
import { generateWave } from './waves.ts';

/**
 * Scratch pathing state for one lane. Derived entirely from the lane's contents
 * and rebuilt each tick, so it lives here rather than in MatchState - it is not
 * part of the match, it is a way of looking at it.
 */
interface LaneFields {
  /** Distance to the nearest defensive unit. Monsters walk down this. */
  toUnits: FlowField;
  /** Distance to the nearest monster. Units walk down this. */
  toMonsters: FlowField;
}

/** Everything a tick needs that is not match state: the data and its index. */
export interface SimContext {
  data: GameData;
  defs: DefIndex;
  /** Where monsters go once the lane is clear. Constant for a match (§5.5). */
  fortressPosition: Vec2;
  fields: Map<string, LaneFields>;
}

export function createContext(data: GameData): SimContext {
  return {
    data,
    defs: buildDefIndex(data),
    fortressPosition: {
      x: data.lane.buildZone.width / 2,
      y: data.lane.buildZone.depth + data.lane.fortressZoneDepth * 0.5,
    },
    fields: new Map(),
  };
}

function laneFields(ctx: SimContext, teamId: string): LaneFields {
  let fields = ctx.fields.get(teamId);
  if (!fields) {
    const { width, depth } = ctx.data.lane.buildZone;
    const sub = ctx.data.lane.pathSubdivision;
    fields = {
      toUnits: createFlowField(width, depth, sub),
      toMonsters: createFlowField(width, depth, sub),
    };
    ctx.fields.set(teamId, fields);
  }
  return fields;
}

/**
 * Rebuild both distance fields for a lane.
 *
 * One sweep serves every agent heading for the same kind of goal, which is why
 * this is cheaper than giving each of thirty monsters its own A* search - see
 * the note at the top of flowfield.ts.
 *
 * The defensive line is the obstacle set in BOTH fields, because it is the only
 * thing in the lane that forms a wall: monsters have to get round it, and the
 * units that make it up have to get round each other. Same geometry, two
 * inflations - a monster needs a monster's clearance to pass, a unit needs a
 * unit's - which is exactly why there are two fields and not one.
 *
 * Inflation uses the KIND's declared radius, not the individual body's, since
 * one field serves every member of that kind. Bosses are wider than that, so a
 * boss can be offered a route it does not quite fit; it falls back on local
 * steering and separation at that point, which is the accepted cost of one
 * shared sweep over per-body sweeps.
 */
function updateFields(ctx: SimContext, lane: Lane): LaneFields {
  const laneData = ctx.data.lane;
  const { width, depth } = laneData.buildZone;
  const fields = laneFields(ctx, lane.teamId);

  // Monsters: the units are both the goal and the wall.
  clearField(fields.toUnits);
  let anyUnit = false;
  for (const unit of lane.units) {
    if (!unit.alive) continue;
    markObstacle(fields.toUnits, unit.pos.x, unit.pos.y, unit.radius, laneData.monsterRadius);
    markGoalBody(fields.toUnits, unit.pos.x, unit.pos.y, unit.radius, laneData.monsterRadius);
    anyUnit = true;
  }
  if (!anyUnit) {
    // §5.5: lane clear, so head for the fortress - which sits below the grid,
    // making the bottom row the way out.
    markSourceRow(fields.toUnits, depth - 1, width);
  }
  computeFlowField(fields.toUnits);

  // A monster is not in its own field's obstacle set, so the cell it stands on
  // is its own answer.
  for (const monster of lane.monsters) {
    monster.pathCost = sampleCost(fields.toUnits, monster.pos, 0);
  }

  // Units: the monsters are the goal, and ALLIES are the wall. Marking allies
  // is the change that lets a back row route around a front row instead of
  // walking into its back and stopping.
  clearField(fields.toMonsters);
  for (const unit of lane.units) {
    if (!unit.alive) continue;
    markObstacle(fields.toMonsters, unit.pos.x, unit.pos.y, unit.radius, laneData.unitRadius);
  }
  for (const monster of lane.monsters) {
    if (!monster.alive) continue;
    markGoalBody(
      fields.toMonsters,
      monster.pos.x,
      monster.pos.y,
      monster.radius,
      laneData.unitRadius,
    );
  }
  computeFlowField(fields.toMonsters);

  for (const unit of lane.units) {
    unit.pathCost = sampleCost(fields.toMonsters, unit.pos, unitFootprint(laneData, unit));
  }

  return fields;
}

/**
 * How far a unit's own blocked footprint reaches in the unit field, in tiles:
 * its body plus the inflation that field was built with.
 */
function unitFootprint(laneData: GameData['lane'], unit: DefensiveUnit): number {
  return unit.radius + laneData.unitRadius;
}

/** Attack cooldown in ticks for a given attacks-per-second rate. */
function cooldownTicks(attacksPerSecond: number): number {
  if (attacksPerSecond <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(TICKS_PER_SECOND / attacksPerSecond));
}

// Scratch values, reused so that a tick allocates nothing (§15.3).
const scratchDestination: Vec2 = { x: 0, y: 0 };
const scratchUnitPos: Vec2 = { x: 0, y: 0 };
const scratchDirection: Vec2 = { x: 0, y: 0 };

/**
 * How far inside its attack range a unit settles when advancing. Below 1 so the
 * stop/go decision has hysteresis and a target drifting a fraction of a tile
 * does not restart the advance.
 */
const ADVANCE_DEADBAND = 0.9;

/**
 * Relaxation passes per tick. Slots pull neighbours toward a shared ring, so a
 * couple of passes at half stiffness left pairs a percent or two inside each
 * other; this converges instead.
 */
const RELAX_ITERATIONS = 4;

/** How near its slot a unit has to get before it parks, in tiles. */
const SLOT_SETTLE = 0.2;

/** How far it must be shoved before it bothers setting off again. */
const SLOT_RESTART = 0.55;

/** Improvement in squared distance that counts as making progress. */
const SLOT_PROGRESS_EPSILON = 0.01;

/**
 * How long a unit keeps trying without getting nearer, in ticks.
 *
 * Four seconds. Tuned against two measurements that pull opposite ways: too
 * impatient and a unit parks mid-detour (5 of 8 reach contact at 6s), too
 * patient and the stragglers orbit instead of settling (the settling test fails
 * at 8s). At 4s both are satisfied.
 */
const SLOT_STALL_TICKS = 80;

/**
 * How far ahead to aim when following the field, in tiles.
 *
 * The field answers with a direction, and `stepToward` wants a destination, so
 * the direction is projected this far. One tile: far enough that the mover
 * commits to the direction for the whole tick, near enough that it does not
 * overshoot a goal that is closer than the projection.
 */
const FIELD_LOOKAHEAD = 1;

/**
 * How near its slot a unit has to be before the field stops steering it, in
 * tiles.
 *
 * The field routes to the nearest MONSTER; slots decide where around it each
 * attacker stands. So the field is for travelling and the slot is for arriving,
 * and this is the handover. Without it the field wins all the way in, every
 * attacker aims at the same body, and the group re-forms the queue that slots
 * exist to prevent - measured 3 of 8 in contact with the handover removed
 * against 6 with it.
 */
const FIELD_HANDOVER = 2;

// --------------------------------------------------------------------- stages

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

/**
 * §5.2, amended: a unit holds its target until that target dies or leaves range,
 * and only then reacquires the nearest in range. That part is unchanged, and it
 * is what stops target-switch jitter.
 *
 * What changed: a unit with NOTHING in range no longer stands there. It advances
 * on the nearest monster in the lane until something comes into range, then
 * plants and fights. It still never chases a target it is already engaging.
 *
 * Units block each other while advancing (the occupancy grid), so a line drifts
 * forward rather than collapsing into one tile.
 */
function unitsAct(ctx: SimContext, lane: Lane, state: MatchState, fields: LaneFields): void {
  for (const unit of lane.units) {
    if (!unit.alive) continue;

    const def = ctx.defs.units.get(unit.defId);
    if (!def) continue;

    if (unit.cooldown > 0) unit.cooldown -= 1;

    const range = stat(def.range);
    let target = holdOrDrop(lane.monsters, unit, range);
    if (!target) {
      writeUnitPosition(unit, scratchUnitPos);
      target = nearestMonsterInRange(lane.monsters, scratchUnitPos, range, unit.radius);
    }
    unit.targetId = target ? target.id : null;

    if (!target) {
      advanceUnit(ctx, unit, lane, fields, range);
      continue;
    }

    // In range: plant and fight. Standing still on purpose is not being stuck.
    clearStuck(unit);
    if (unit.cooldown > 0) continue;

    // §7.4 tech is cached on the unit; §10.1 aura depends on where it is
    // standing right now, so it is evaluated here (see buffs.ts on why).
    const aura = auraFor(lane, unit, ctx.fortressPosition);

    target.hp -= resolveDamage(
      ctx.data.matrix.multipliers,
      stat(def.damage) * unit.techDamage * aura.damage,
      def.damageType,
      target.armour,
    );
    unit.cooldown = cooldownTicks(stat(def.attackSpeed) * unit.techAttackSpeed * aura.attackSpeed);
  }

  void state;
}

/**
 * Walk one unit toward the nearest monster in the lane. Units stay inside the
 * build zone: the lane beyond it is not theirs to hold, and letting them wander
 * into the spawn zone would make the build grid meaningless.
 */
function advanceUnit(
  ctx: SimContext,
  unit: DefensiveUnit,
  lane: Lane,
  fields: LaneFields,
  range: number,
): void {
  const maxX = ctx.data.lane.buildZone.width;
  const maxY = ctx.data.lane.buildZone.depth;

  if (unit.moveSpeed <= 0) {
    clearStuck(unit);
    return;
  }

  // Hold the current advance target unless it is gone or something is clearly
  // closer. Re-picking the nearest monster every tick makes a unit shiver
  // between two near-equidistant ones.
  let target: Monster | null = null;
  if (unit.advanceTargetId !== null) {
    for (const monster of lane.monsters) {
      if (monster.alive && monster.id === unit.advanceTargetId) {
        target = monster;
        break;
      }
    }
  }

  let nearest: Monster | null = null;
  let bestDist = Infinity;
  for (const monster of lane.monsters) {
    if (!monster.alive) continue;
    const dist = distanceSquared(unit.pos, monster.pos);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = monster;
    }
  }

  // Switch only for a meaningfully closer one - 20% in squared distance.
  if (!target || (nearest && bestDist < distanceSquared(unit.pos, target.pos) * 0.8)) {
    target = nearest;
  }

  // Nothing to walk toward - during a build phase, say.
  if (!target) {
    unit.advanceTargetId = null;
    clearStuck(unit);
    return;
  }
  unit.advanceTargetId = target.id;

  // Stop a little short of attack range rather than exactly at it. Without this
  // deadband a unit oscillates across the range boundary all fight: one step
  // forward puts the target in range so it stops, the target drifts a hair out,
  // it steps forward again, and so on for as long as the fight lasts.
  const settle = range * ADVANCE_DEADBAND;
  if (distanceSquared(unit.pos, target.pos) <= settle * settle) {
    clearStuck(unit);
    return;
  }

  // Walk to this unit's own slot on the ring around the target rather than at
  // the target itself. Nobody contends for the same point, so a group fans out
  // and surrounds instead of queueing - and there is nothing to jitter over.
  if (unit.slotTargetId !== target.id) {
    unit.slotTargetId = target.id;
    unit.settled = false;
    unit.slotBestDistSq = Infinity;
    unit.routeBestCost = Infinity;
    unit.slotStallTicks = 0;
    unit.slotIndex = slotIndexFor(lane.units, unit, (u) => u.advanceTargetId, target.id);
  }
  writeSlotPosition(
    target.pos,
    target.radius,
    unit.radius,
    range * 0.5,
    unit.slotIndex,
    scratchDestination,
  );

  // Close enough to the slot is close enough: chasing the last fraction of a
  // tile just grinds against the separation pass, which is pushing back. Park
  // at SLOT_SETTLE and do not set off again until pushed past SLOT_RESTART -
  // one shared threshold is a limit cycle.
  const toSlot = distanceSquared(unit.pos, scratchDestination);
  const threshold = unit.settled ? SLOT_RESTART : SLOT_SETTLE;
  if (toSlot < threshold * threshold) {
    unit.settled = true;
    unit.slotStallTicks = 0;
    clearStuck(unit);
    return;
  }
  unit.settled = false;

  // Pick a route. In order of preference:
  //
  //   1. Straight at the slot, when nothing is in the way.
  //   2. The distance field, which is global: it sees the whole lane, so it
  //      finds the way round a line of allies that spans it - the case local
  //      steering cannot solve, and the reason a unit behind a full front row
  //      used to stand there. Measured 1 of 8 units through a wall with a gap
  //      at one end before this, 7 of 8 after.
  //   3. Tangent steering, for the last stretch and for whatever the field
  //      cannot answer: a unit boxed in by its own allies has no clear cell to
  //      walk to at all, and going round the nearest one is still better than
  //      standing still.
  //
  // Nothing in the way means neither runs: following a gradient on open ground
  // adds wobble for nothing, because its sources are moving. And the field
  // hands over to slots near the target rather than steering all the way in,
  // because it routes to the nearest MONSTER while the slot decides where
  // around it to stand - let the field win to the end and every attacker aims
  // at the same body, re-forming the queue slots exist to prevent.
  let routedByField = false;
  const blocker = findBlocker(lane.units, unit, scratchDestination);

  if (blocker) {
    unit.avoidBlockerId = blocker.id;

    if (toSlot > FIELD_HANDOVER * FIELD_HANDOVER) {
      const cell = steerAlongField(
        fields.toMonsters,
        unit.pos,
        scratchDirection,
        unitFootprint(ctx.data.lane, unit),
        unit.fieldCell,
      );
      unit.fieldCell = cell;
      routedByField = cell !== -1;
    } else {
      unit.fieldCell = -1;
    }

    if (routedByField) {
      unit.avoidSide = 0;
      scratchDestination.x = unit.pos.x + scratchDirection.x * FIELD_LOOKAHEAD;
      scratchDestination.y = unit.pos.y + scratchDirection.y * FIELD_LOOKAHEAD;
    } else {
      // Commit to the SIDE, not to the blocker. Re-deciding each time a
      // different ally becomes the nearest obstacle makes a unit reverse
      // mid-manoeuvre and orbit the cluster forever; holding the side carries
      // it all the way round.
      if (unit.avoidSide === 0) {
        unit.avoidSide = chooseSide(unit, blocker, scratchDestination);
      }
      writeTangentWaypoint(unit, blocker, unit.avoidSide, scratchDestination);
    }
  } else if (blocksPath(unit, target, scratchDestination)) {
    // The target itself is in the way. Its slots ring it, so the far ones sit
    // behind it: walk straight at one of those and you walk into the target and
    // stop, parked in whoever's slot you happened to reach. Round it the same
    // way an ally is rounded.
    unit.fieldCell = -1;
    unit.avoidBlockerId = null;
    if (unit.avoidSide === 0) {
      unit.avoidSide = chooseSide(unit, target, scratchDestination);
    }
    writeTangentWaypoint(unit, target, unit.avoidSide, scratchDestination);
  } else {
    unit.fieldCell = -1;
    unit.avoidBlockerId = null;
    unit.avoidSide = 0;
  }

  // Give up on a slot there is no room for - but only while steering locally.
  //
  // A detour means no progress for a while, which is fine; no progress EVER
  // means orbiting a crowd, and orbiting forever is jitter with extra steps.
  // That is a hazard of TANGENT steering, which sees one ally at a time and
  // can circle a cluster indefinitely. A unit on the field cannot: the field is
  // a global gradient, so downhill is always genuine progress toward the goal,
  // and if it is not moving it is because bodies are in the way - queuing, not
  // orbiting. Parking it there is what stranded a whole group against a wall
  // they had a route around, and once parked it could never restart, because a
  // unit standing still cannot make the progress that would clear the stall.
  let progressed = false;
  if (toSlot < unit.slotBestDistSq - SLOT_PROGRESS_EPSILON) {
    unit.slotBestDistSq = toSlot;
    progressed = true;
  }
  if (unit.pathCost < unit.routeBestCost) {
    unit.routeBestCost = unit.pathCost;
    progressed = true;
  }

  if (blocker === null) {
    // Nothing in the way: there is nothing to orbit, so there is nothing to
    // give up on. Clearing the baselines here is also how a parked unit gets
    // released - without it the park was permanent, because the baselines are
    // bests-ever and a unit standing still can never beat its own best. A unit
    // that gave up in a crowd stayed frozen at 0.76 tiles from contact even
    // after every ally around it died and the ground was open.
    unit.slotStallTicks = 0;
    unit.slotBestDistSq = Infinity;
    unit.routeBestCost = Infinity;
  } else if (progressed || routedByField) {
    unit.slotStallTicks = 0;
  } else if (++unit.slotStallTicks > SLOT_STALL_TICKS) {
    unit.settled = true;
    clearStuck(unit);
    return;
  }

  // No grid for units: ally tiles are not terrain, and treating them as such is
  // what made a blocked unit sidestep left, then right, then left forever.
  stepToward(unit, scratchDestination, unit.moveSpeed, 1, null);

  // Clamp into the build zone.
  if (unit.pos.x < 0) unit.pos.x = 0.01;
  if (unit.pos.y < 0) unit.pos.y = 0.01;
  if (unit.pos.x >= maxX) unit.pos.x = maxX - 0.01;
  if (unit.pos.y >= maxY) unit.pos.y = maxY - 0.01;

  updateStuckDetection(unit);
  lane.occupancyDirty = true;
}

/**
 * §5.1 and §5.5: a monster walks to the nearest defensive unit and attacks it.
 * It never advances to the fortress while any unit is alive. Once the lane is
 * clear it besieges the fortress and stays there until killed - it does not
 * vanish, which is exactly what makes a leak dangerous.
 */
function monstersAct(ctx: SimContext, lane: Lane, state: MatchState, fields: LaneFields): void {
  const enrageConfig = ctx.data.waves.enrage;
  const grid = ctx.data.lane.unitsBlockMovement ? lane.occupancy : null;

  for (const monster of lane.monsters) {
    if (!monster.alive) continue;

    const multiplier = monsterEnrage(state, monster, enrageConfig);
    if (monster.cooldown > 0) monster.cooldown -= 1;

    // Retargeting is throttled to a fixed interval, not run per tick (§5.1).
    if (monster.retargetIn > 0) {
      monster.retargetIn -= 1;
    } else {
      const nearest = nearestUnit(lane.units, monster.pos);
      monster.targetId = nearest ? nearest.id : null;
      monster.besieging = nearest === null;
      monster.retargetIn = MONSTER_RETARGET_TICKS;
    }

    let target = null;
    if (monster.targetId !== null) {
      for (const unit of lane.units) {
        if (unit.id === monster.targetId && unit.alive) {
          target = unit;
          break;
        }
      }
    }

    if (target) {
      // Monsters take slots around their target too, so a pack spreads around
      // a unit instead of stacking on the same approach point.
      if (monster.slotTargetId !== target.id) {
        monster.slotTargetId = target.id;
        monster.slotIndex = slotIndexFor(lane.monsters, monster, (m) => m.targetId, target.id);
      }
      writeSlotPosition(
        target.pos,
        target.radius,
        monster.radius,
        monster.range * 0.5,
        monster.slotIndex,
        scratchDestination,
      );
    } else {
      scratchDestination.x = ctx.fortressPosition.x;
      scratchDestination.y = ctx.fortressPosition.y;
    }

    const dx = scratchDestination.x - monster.pos.x;
    const dy = scratchDestination.y - monster.pos.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const dx0 = scratchDestination.x;
    const dy0 = scratchDestination.y;
    // Edge to edge: a melee monster closes until the bodies touch rather than
    // stopping a body-width short of its target.
    const targetRadius = target ? target.radius : 0;
    const reachEdge = monster.range + monster.radius + targetRadius;
    const inRange = dx * dx + dy * dy <= reachEdge * reachEdge;

    if (inRange) {
      // Standing still because it has arrived is not being stuck. Counting
      // those ticks is what used to freeze monsters forever once their target
      // died - see the note at the top of steering.ts.
      clearStuck(monster);
    } else {
      // Walk straight at the target when the way is open, and only fall back on
      // the distance field when something is genuinely in the way. The field is
      // what sees around a wall that greedy steering would press into forever -
      // but following it on open ground adds wobble for nothing, because its
      // gradient reshuffles as its sources move.
      const clear = grid === null || hasLineOfSight(grid, monster.pos.x, monster.pos.y, dx0, dy0);

      if (clear) {
        monster.fieldCell = -1;
        scratchDirection.x = dx / distance;
        scratchDirection.y = dy / distance;
      } else {
        // A monster is not part of its own field's obstacle set - only the
        // defensive line is - so it reads the cell it stands on directly, with
        // no footprint to look past.
        const cell = steerAlongField(
          fields.toUnits,
          monster.pos,
          scratchDirection,
          0,
          monster.fieldCell,
        );
        monster.fieldCell = cell;

        if (cell !== -1) {
          scratchDestination.x = monster.pos.x + scratchDirection.x * FIELD_LOOKAHEAD;
          scratchDestination.y = monster.pos.y + scratchDirection.y * FIELD_LOOKAHEAD;
        } else {
          scratchDirection.x = dx / distance;
          scratchDirection.y = dy / distance;
        }
      }

      // Always attempt to move: gating movement on the stuck flag is what froze
      // monsters permanently.
      stepToward(monster, scratchDestination, monster.moveSpeed, multiplier, grid);
      updateStuckDetection(monster);
    }

    if (!(inRange || monster.isStuck) || monster.cooldown > 0) continue;

    // §8: enrage raises damage and attack speed. Never HP - a stalling player
    // should face deadlier monsters, not unkillable ones.
    const damage = monster.damage * multiplier;

    // §5.3: a boxed-in monster attacks whatever is nearest rather than standing
    // there, even if that thing is not its assigned target.
    if (!target && monster.isStuck) {
      const neighbour = nearestUnit(lane.units, monster.pos);
      if (neighbour) {
        neighbour.hp -=
          resolveDamage(ctx.data.matrix.multipliers, damage, monster.damageType, neighbour.armour) *
          auraFor(lane, neighbour, ctx.fortressPosition).damageTaken;
        monster.cooldown = cooldownTicks(monster.attackSpeed * multiplier);
        continue;
      }
    }

    if (target) {
      target.hp -=
        resolveDamage(ctx.data.matrix.multipliers, damage, monster.damageType, target.armour) *
        auraFor(lane, target, ctx.fortressPosition).damageTaken;
    } else if (inRange) {
      // Sieging the fortress (§5.5). A stuck monster with no unit in reach is
      // wedged somewhere in the grid, not at the wall, so it does not chip HP.
      lane.fortress.hp -= resolveDamage(
        ctx.data.matrix.multipliers,
        damage,
        monster.damageType,
        ctx.data.fortress.armour,
      );
    } else {
      continue;
    }

    monster.cooldown = cooldownTicks(monster.attackSpeed * multiplier);
  }
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
  const target = nearestMonsterInRange(lane.monsters, ctx.fortressPosition, stat(weapon.range));
  if (!target) return;

  target.hp -= resolveDamage(
    ctx.data.matrix.multipliers,
    stat(weapon.damage),
    lane.fortress.weaponDamageType,
    target.armour,
  );
  lane.fortress.weaponCooldown = cooldownTicks(stat(weapon.attackSpeed));
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
  let anyUnitDied = false;

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

    if (unit.hp <= 0) {
      unit.alive = false;
      anyUnitDied = true;
    }
  }

  if (anyUnitDied) lane.occupancyDirty = true;

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
    unit.stuckAnchor.x = unit.pos.x;
    unit.stuckAnchor.y = unit.pos.y;
    unit.stuckTicks = 0;
    unit.isStuck = false;
  }
  lane.occupancyDirty = true;
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

    for (const spec of [...specs, ...incoming]) {
      if (countLiving(lane) < cap) {
        const monster = createMonster(state, ctx.data, ctx.defs, spec, lane.monsters.length);
        if (monster) {
          lane.monsters.push(monster);
          totalSpawned++;
        }
      } else {
        // §8.1: the excess waits, and enters one at a time as monsters die.
        lane.reserve.push(spec);
        totalSpawned++;
      }
    }
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
      if (lane) recomputeUnitBuffs(ctx.data, ctx.defs, lane);
    }
    return;
  }

  if (!allLanesClear(state)) return;

  state.phase = 'build';
  state.phaseTicksLeft = secondsToTicks(ctx.data.waves.buildPhaseSeconds);

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

    respawnUnits(ctx, lane, state);
    // §11.6: passive income is paid each wave and compounds over the match.
    lane.economy.gold += lane.economy.passiveIncome;
    lane.economy.gems += lane.fortress.gemsPerWave;
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
  lane.reserve.length = 0;
  lane.incomingSends.length = 0;
}

/**
 * Resolve crowding once everything has moved.
 *
 * Bodies of the same kind push each other apart rather than refusing to move in
 * the first place - see separation.ts on why refusal caused the jitter and the
 * clogging. A shove is vetoed if it would squeeze a monster inside a unit's
 * tile, which stays a hard wall.
 */
function separateBodies(ctx: SimContext, lane: Lane): void {
  const grid = ctx.data.lane.unitsBlockMovement ? lane.occupancy : null;

  relaxSeparation(
    lane.monsters,
    RELAX_ITERATIONS,
    grid ? (x: number, y: number) => !isPositionBlocked(grid, x, y) : null,
  );

  const maxX = ctx.data.lane.buildZone.width;
  const maxY = ctx.data.lane.buildZone.depth;
  relaxSeparation(
    lane.units,
    RELAX_ITERATIONS,
    (x: number, y: number) => x >= 0 && y >= 0 && x < maxX && y < maxY,
  );

  // Melee should stop at contact, not sink into what it is hitting. The
  // defender holds; the monster is backed out to exactly touching.
  pushOutOf(lane.monsters, lane.units);

  // Units that were shoved may have crossed a tile boundary.
  lane.occupancyDirty = true;
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

    // Rebuilt on change rather than unconditionally. Units move now, so they
    // set the dirty flag themselves when they do (§15.3).
    if (lane.occupancyDirty) {
      rebuildOccupancy(lane.occupancy, lane.units);
      lane.occupancyDirty = false;
    }

    const fields = updateFields(ctx, lane);

    unitsAct(ctx, lane, state, fields);
    monstersAct(ctx, lane, state, fields);
    separateBodies(ctx, lane);
    fortressActs(ctx, lane);
    reapDead(ctx, lane, state);
  }

  checkEliminations(state);
  return state;
}

/** Deep copy, for replays, desync comparison and tests. */
export function snapshot(state: MatchState): MatchState {
  return structuredClone(state);
}

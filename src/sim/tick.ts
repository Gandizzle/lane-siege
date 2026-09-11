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
import { MONSTER_RETARGET_TICKS, TICKS_PER_SECOND, secondsToTicks } from './constants.ts';
import type { Command } from './commands.ts';
import { applyCommands } from './apply.ts';
import { resolveDamage } from './damage.ts';
import { buildDefIndex, stat, type DefIndex } from './defs.ts';
import { monsterEnrage } from './enrage.ts';
import { rebuildOccupancy } from './grid.ts';
import { admitFromReserve, countLiving, createMonster } from './spawn.ts';
import { stepToward, updateStuckDetection } from './steering.ts';
import { holdOrDrop, nearestMonsterInRange, nearestUnit, writeUnitPosition } from './targeting.ts';
import type { Lane, MatchState, Vec2 } from './types.ts';
import { generateWave } from './waves.ts';

/** Everything a tick needs that is not match state: the data and its index. */
export interface SimContext {
  data: GameData;
  defs: DefIndex;
  /** Where monsters go once the lane is clear. Constant for a match (§5.5). */
  fortressPosition: Vec2;
}

export function createContext(data: GameData): SimContext {
  return {
    data,
    defs: buildDefIndex(data),
    fortressPosition: {
      x: data.lane.buildZone.width / 2,
      y: data.lane.buildZone.depth + data.lane.fortressZoneDepth * 0.5,
    },
  };
}

/** Attack cooldown in ticks for a given attacks-per-second rate. */
function cooldownTicks(attacksPerSecond: number): number {
  if (attacksPerSecond <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(TICKS_PER_SECOND / attacksPerSecond));
}

// Scratch vectors, reused so that a tick allocates nothing (§15.3).
const scratchDestination: Vec2 = { x: 0, y: 0 };
const scratchUnitPos: Vec2 = { x: 0, y: 0 };

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
 * §5.2: a unit holds its target until the target dies or leaves range, and only
 * then reacquires the nearest in range. Stationary always - units never move
 * and never chase.
 */
function unitsAct(ctx: SimContext, lane: Lane): void {
  for (const unit of lane.units) {
    if (!unit.alive) continue;

    const def = ctx.defs.units.get(unit.defId);
    if (!def) continue;

    if (unit.cooldown > 0) unit.cooldown -= 1;

    const range = stat(def.range);
    let target = holdOrDrop(lane.monsters, unit, range);
    if (!target) {
      writeUnitPosition(unit, scratchUnitPos);
      target = nearestMonsterInRange(lane.monsters, scratchUnitPos, range);
    }
    unit.targetId = target ? target.id : null;

    if (!target || unit.cooldown > 0) continue;

    // TODO(§7.4, §10.1): aura and tech multipliers fold in here. Auras are
    // recomputed only on add/remove/upgrade and on wave start (§15.3), never per
    // tick, so the resolved multiplier should be cached on the unit.
    target.hp -= resolveDamage(
      ctx.data.matrix.multipliers,
      stat(def.damage),
      def.damageType,
      target.armour,
    );
    unit.cooldown = cooldownTicks(stat(def.attackSpeed));
  }
}

/**
 * §5.1 and §5.5: a monster walks to the nearest defensive unit and attacks it.
 * It never advances to the fortress while any unit is alive. Once the lane is
 * clear it besieges the fortress and stays there until killed - it does not
 * vanish, which is exactly what makes a leak dangerous.
 */
function monstersAct(ctx: SimContext, lane: Lane, state: MatchState): void {
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
      writeUnitPosition(target, scratchDestination);
    } else {
      scratchDestination.x = ctx.fortressPosition.x;
      scratchDestination.y = ctx.fortressPosition.y;
    }

    const dx = scratchDestination.x - monster.pos.x;
    const dy = scratchDestination.y - monster.pos.y;
    const inRange = dx * dx + dy * dy <= monster.range * monster.range;

    if (!inRange && !monster.isStuck) {
      stepToward(monster, scratchDestination, monster.moveSpeed, multiplier, grid);
    }
    updateStuckDetection(monster);

    if (!(inRange || monster.isStuck) || monster.cooldown > 0) continue;

    // §8: enrage raises damage and attack speed. Never HP - a stalling player
    // should face deadlier monsters, not unkillable ones.
    const damage = monster.damage * multiplier;

    if (target) {
      target.hp -= resolveDamage(
        ctx.data.matrix.multipliers,
        damage,
        monster.damageType,
        target.armour,
      );
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
    if (unit.alive && unit.hp <= 0) {
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
    if (unit.alive) {
      unit.hp = unit.maxHp;
      continue;
    }
    unit.alive = true;
    unit.hp = unit.maxHp;
    unit.targetId = null;
    unit.cooldown = 0;
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
 * §3.1 and §3.2: build phase, then combat. Waves spawn on a fixed global clock
 * regardless of whether any lane has cleared the previous wave - a slow player
 * meets wave 8 while wave 7 is still alive in their lane, and cannot hold three
 * other players hostage.
 *
 * The wave interval is the FULL cycle, so the combat phase is whatever the build
 * phase leaves of it.
 */
function combatPhaseTicks(data: GameData): number {
  const interval = data.waves.waveIntervalSeconds;
  if (interval === null) return 0;
  return secondsToTicks(Math.max(0, interval - data.waves.buildPhaseSeconds));
}

/** §3.2: all living players ready skips the rest of the build phase. */
function allReady(state: MatchState): boolean {
  const living = state.teams.filter((t) => !t.eliminated);
  if (living.length === 0) return false;
  return living.every((t) => state.lanes[t.id]?.ready === true);
}

/**
 * Every living lane has killed everything, reserves included.
 *
 * DESIGN CHANGE to §3.2: the combat phase ends as soon as this is true rather
 * than always running its full length. §3.2's concern is that a SLOW player must
 * not hold everyone else hostage, and this cannot do that - the clock only jumps
 * forward when every living lane is already finished, which is the same
 * principle the ready button applies to the build phase.
 *
 * The consequence worth knowing: the wave clock is no longer strictly fixed. It
 * is fixed unless everyone is done early, so a table of skilled players moves
 * through waves faster than the nominal 75s cycle.
 */
function allLanesClear(state: MatchState): boolean {
  const living = state.teams.filter((t) => !t.eliminated);
  if (living.length === 0) return false;

  return living.every((team) => {
    const lane = state.lanes[team.id];
    if (!lane) return true;
    return lane.reserve.length === 0 && countLiving(lane) === 0;
  });
}

function advancePhase(ctx: SimContext, state: MatchState): void {
  const skipping =
    (state.phase === 'build' && allReady(state)) ||
    // Wave 0 has spawned nothing yet, so an empty lane during 'combat' before
    // the first spawn must not count as cleared.
    (state.phase === 'combat' && state.wave > 0 && allLanesClear(state));

  if (state.phaseTicksLeft > 0 && !skipping) {
    state.phaseTicksLeft -= 1;
    return;
  }

  if (state.phase === 'build') {
    state.phase = 'combat';
    state.wave += 1;
    state.phaseTicksLeft = combatPhaseTicks(ctx.data);
    for (const team of state.teams) {
      const lane = state.lanes[team.id];
      if (lane) lane.ready = false;
    }
    spawnWave(ctx, state);
  } else {
    state.phase = 'build';
    state.phaseTicksLeft = secondsToTicks(ctx.data.waves.buildPhaseSeconds);

    for (const team of state.teams) {
      if (team.eliminated) continue;
      const lane = state.lanes[team.id];
      if (!lane) continue;

      respawnUnits(ctx, lane, state);
      // §11.6: passive income is paid out each wave and compounds over the
      // match. This is the long-game economic engine.
      lane.economy.gold += lane.economy.passiveIncome;
      lane.economy.gems += stat(ctx.data.fortress.resourceBuilding.gemsPerWave);
    }
  }
}

/** §13: fortress HP at zero eliminates that team; placement locks in there. */
function checkEliminations(state: MatchState): void {
  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane || !lane.fortress.destroyed) continue;

    team.eliminated = true;
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
  advancePhase(ctx, state);

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

    // Occupancy is rebuilt on change only, never per tick (§15.3).
    if (lane.occupancyDirty) {
      rebuildOccupancy(lane.occupancy, lane.units);
      lane.occupancyDirty = false;
    }

    unitsAct(ctx, lane);
    monstersAct(ctx, lane, state);
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

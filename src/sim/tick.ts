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
import { rebuildOccupancy, restoreSelf, withoutSelf } from './grid.ts';
import type { OccupancyGrid } from './grid.ts';
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
function unitsAct(ctx: SimContext, lane: Lane, state: MatchState): void {
  const grid = ctx.data.lane.unitsBlockMovement ? lane.occupancy : null;
  const maxX = ctx.data.lane.buildZone.width;
  const maxY = ctx.data.lane.buildZone.depth;

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

    if (!target) {
      advanceUnit(unit, lane, grid, maxX, maxY);
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
  unit: DefensiveUnit,
  lane: Lane,
  grid: OccupancyGrid | null,
  maxX: number,
  maxY: number,
): void {
  if (unit.moveSpeed <= 0) {
    clearStuck(unit);
    return;
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

  // Nothing to walk toward - during a build phase, say.
  if (!nearest) {
    clearStuck(unit);
    return;
  }

  scratchDestination.x = nearest.pos.x;
  scratchDestination.y = nearest.pos.y;

  // A unit's own tile must not block its own step.
  const self = grid ? withoutSelf(grid, unit.pos.x, unit.pos.y) : 0;
  stepToward(unit, scratchDestination, unit.moveSpeed, 1, grid);
  if (grid) restoreSelf(grid, unit.pos.x, unit.pos.y, self);

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

    if (inRange) {
      // Standing still because it has arrived is not being stuck. Counting
      // those ticks is what used to freeze monsters forever once their target
      // died - see the note at the top of steering.ts.
      clearStuck(monster);
    } else {
      // Always attempt to move. The occupancy grid is the only thing allowed to
      // refuse, and it stops refusing the moment the way clears.
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

    unitsAct(ctx, lane, state);
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

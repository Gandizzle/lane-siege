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
import { resolveDamage } from './damage.ts';
import { buildDefIndex, stat, type DefIndex } from './defs.ts';
import { monsterEnrage } from './enrage.ts';
import { stepToward, updateStuckDetection } from './steering.ts';
import { holdOrDrop, nearestMonsterInRange, nearestUnit, unitPosition } from './targeting.ts';
import type { Lane, MatchState, Vec2 } from './types.ts';

/** Everything a tick needs that is not match state: the data and its index. */
export interface SimContext {
  data: GameData;
  defs: DefIndex;
}

export function createContext(data: GameData): SimContext {
  return { data, defs: buildDefIndex(data) };
}

/** Attack cooldown in ticks for a given attacks-per-second rate. */
function cooldownTicks(attacksPerSecond: number): number {
  if (attacksPerSecond <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.round(TICKS_PER_SECOND / attacksPerSecond));
}

// --------------------------------------------------------------------- stages

/**
 * §8: every wave carries its own enrage clock, which keeps running while any of
 * its monsters are alive anywhere and stops when the last one dies.
 */
function advanceWaveClocks(state: MatchState): void {
  for (const clock of state.waveClocks) {
    if (clock.remaining > 0) clock.age += 1;
  }
  state.waveClocks = state.waveClocks.filter((c) => c.remaining > 0);
}

/**
 * §5.2: a unit holds its target until the target dies or leaves range, and only
 * then reacquires the nearest in range. Stationary always - units never move
 * and never chase.
 */
function unitsAct(ctx: SimContext, lane: Lane, state: MatchState): void {
  const { enrage } = ctx.data.waves;

  for (const unit of lane.units) {
    if (!unit.alive) continue;

    const def = ctx.defs.units.get(unit.defId);
    if (!def) continue;

    if (unit.cooldown > 0) unit.cooldown -= 1;

    const range = stat(def.range);
    let target = holdOrDrop(lane.monsters, unit, range);
    if (!target) {
      target = nearestMonsterInRange(lane.monsters, unitPosition(unit), range);
    }
    unit.targetId = target ? target.id : null;

    if (!target || unit.cooldown > 0) continue;

    // TODO: aura and tech multipliers fold in here. Auras are recomputed only
    // on add/remove/upgrade and on wave start (§15.3), never per tick, so the
    // resolved multiplier should be cached on the unit rather than derived now.
    target.hp -= resolveDamage(
      ctx.data.matrix.multipliers,
      stat(def.damage),
      def.damageType,
      target.armour,
    );
    unit.cooldown = cooldownTicks(stat(def.attackSpeed));

    void state;
    void enrage;
  }
}

const scratchDestination: Vec2 = { x: 0, y: 0 };

/**
 * §5.1 and §5.5: a monster walks to the nearest defensive unit and attacks it.
 * It never advances to the fortress while any unit is alive. Once the lane is
 * clear it besieges the fortress and stays there until killed - it does not
 * vanish, which is exactly what makes a leak dangerous.
 */
function monstersAct(ctx: SimContext, lane: Lane, state: MatchState): void {
  const enrageConfig = ctx.data.waves.enrage;
  const fortressTile: Vec2 = {
    x: ctx.data.lane.buildZone.width / 2,
    y: ctx.data.lane.buildZone.depth + ctx.data.lane.fortressZoneDepth,
  };

  for (const monster of lane.monsters) {
    if (!monster.alive) continue;

    const def = ctx.defs.monsters.get(monster.defId);
    if (!def) continue;

    const multiplier = monsterEnrage(state, monster, enrageConfig);
    if (monster.cooldown > 0) monster.cooldown -= 1;

    // Retargeting is throttled, not per tick (§5.1, §15.3).
    if (monster.retargetIn > 0) {
      monster.retargetIn -= 1;
    } else {
      const nearest = nearestUnit(lane.units, monster.pos);
      monster.targetId = nearest ? nearest.id : null;
      monster.besieging = nearest === null;
      monster.retargetIn = MONSTER_RETARGET_TICKS;
    }

    const target = monster.targetId
      ? lane.units.find((u) => u.id === monster.targetId && u.alive)
      : undefined;

    const destination = target ? unitPosition(target) : fortressTile;
    scratchDestination.x = destination.x;
    scratchDestination.y = destination.y;

    const range = stat(def.range);
    const dx = scratchDestination.x - monster.pos.x;
    const dy = scratchDestination.y - monster.pos.y;
    const inRange = dx * dx + dy * dy <= range * range;

    if (!inRange && !monster.isStuck) {
      stepToward(monster, scratchDestination, stat(def.moveSpeed), multiplier);
    }
    updateStuckDetection(monster);

    if ((inRange || monster.isStuck) && monster.cooldown <= 0) {
      const damage = stat(def.damage) * multiplier;
      if (target) {
        target.hp -= resolveDamage(
          ctx.data.matrix.multipliers,
          damage,
          def.damageType,
          target.armour,
        );
      } else {
        // Sieging the fortress (§5.5).
        lane.fortress.hp -= resolveDamage(
          ctx.data.matrix.multipliers,
          damage,
          def.damageType,
          'plate',
        );
      }
      // Enrage raises attack speed, so it shortens the cooldown (§8).
      monster.cooldown = cooldownTicks(stat(def.attackSpeed) * multiplier);
    }
  }
}

/**
 * §10.1: the fortress weapon is the last line of defence and must reliably kill
 * one or two current-wave monsters unaided, so that small leaks self-repair and
 * large ones are correctly fatal. Its damage type is chosen by the player each
 * build phase.
 */
function fortressActs(ctx: SimContext, lane: Lane): void {
  const weapon = ctx.data.fortress.weapon;
  if (lane.fortress.destroyed) return;

  if (lane.fortress.weaponCooldown > 0) {
    lane.fortress.weaponCooldown -= 1;
    return;
  }

  const origin: Vec2 = {
    x: ctx.data.lane.buildZone.width / 2,
    y: ctx.data.lane.buildZone.depth + ctx.data.lane.fortressZoneDepth,
  };
  const target = nearestMonsterInRange(lane.monsters, origin, stat(weapon.range));
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
 */
function reapDead(ctx: SimContext, lane: Lane, state: MatchState): void {
  for (const monster of lane.monsters) {
    if (!monster.alive || monster.hp > 0) continue;
    monster.alive = false;

    const def = ctx.defs.monsters.get(monster.defId);
    lane.economy.gold += stat(def?.bounty ?? null);

    const clock = state.waveClocks.find((c) => c.waveNumber === monster.waveNumber);
    if (clock) clock.remaining -= 1;

    // §8.1: a reserve monster takes the free slot, entering at its own wave's
    // current enrage state.
    // TODO: pull from lane.reserve here once wave spawning exists.
  }

  for (const unit of lane.units) {
    if (unit.alive && unit.hp <= 0) unit.alive = false;
  }

  if (lane.fortress.hp <= 0) lane.fortress.destroyed = true;

  // TODO(§5.5): on a full lane clear, regenerate fortress HP so chip damage is
  // not permanent. This lever plus the fortress weapon is the primary control
  // over when the first player is eliminated - target wave 13-15, not wave 8.
}

/**
 * §3.1 and §3.2: build phase, then combat. Waves spawn on a fixed global clock
 * regardless of whether any lane has cleared the previous wave - a slow player
 * meets wave 8 while wave 7 is still alive in their lane, and cannot hold three
 * other players hostage.
 */
function advancePhase(ctx: SimContext, state: MatchState): void {
  if (state.phaseTicksLeft > 0) {
    state.phaseTicksLeft -= 1;
    return;
  }

  if (state.phase === 'build') {
    state.phase = 'combat';
    state.wave += 1;
    // TODO(M1): spawn the wave. Composition is a pure function of
    // (seed, waveNumber) via waveRng, capped at maxConcurrentMonsters with the
    // excess held in lane.reserve (§8.1), plus each lane's incomingSends
    // (§11.5). Blocked on data/waves.json composition and data/monsters.json.
    const interval = ctx.data.waves.waveIntervalSeconds;
    state.phaseTicksLeft = interval === null ? 0 : secondsToTicks(interval);
  } else {
    state.phase = 'build';
    state.phaseTicksLeft = secondsToTicks(ctx.data.waves.buildPhaseSeconds);
    // TODO(§5.4): units respawn fully at the start of each build phase, through
    // wave 24. From wave 25 respawn stops and losses are permanent (§3.3).
    // TODO(§11.6): pay out passive income, once per wave.
  }
}

/** §13: fortress HP at zero eliminates that team; placement locks in there. */
function checkEliminations(state: MatchState): void {
  const living = state.teams.filter((t) => !t.eliminated);

  for (const team of living) {
    const lane = state.lanes[team.id];
    if (!lane || !lane.fortress.destroyed) continue;
    team.eliminated = true;
    team.placement = living.length;
  }

  state.finished = state.teams.filter((t) => !t.eliminated).length <= 1;
}

// ----------------------------------------------------------------------- step

/**
 * Advance the match one tick. Returns the same (mutated) state object.
 *
 * TODO: commands are accepted but not yet applied. Each needs cost, supply and
 * phase validation inside the simulation - never in the UI - returning a
 * CommandRejection the UI can display.
 */
export function step(
  ctx: SimContext,
  state: MatchState,
  commands: readonly Command[] = [],
): MatchState {
  if (state.finished) return state;

  void commands;

  state.tick += 1;
  advanceWaveClocks(state);
  advancePhase(ctx, state);

  for (const team of state.teams) {
    if (team.eliminated) continue;
    const lane = state.lanes[team.id];
    if (!lane) continue;

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

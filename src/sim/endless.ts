/**
 * Solo mode's last wave. DESIGN.md §3.3, solo.
 *
 * In a standard match the last wave is followed by the Final Showdown. A solo
 * player has nobody to meet there, so instead they get one more build phase
 * and then a wave that never ends: monsters walk in one at a time, each of a
 * type drawn at random from every monster the twenty-five waves used, a boss
 * on a clock, and the whole stream climbing the waves' own growth curve one
 * wave's worth every `stepSeconds`. The match ends when the fortress falls.
 * What is left to compare is how many monsters fell before it did.
 *
 * WHAT CHANGES WHEN THE WAVES STOP
 *
 * Three rules exist only because there used to be a gap between waves, and
 * the stream has none:
 *
 *   - Income. Passive income is paid as each build phase opens (§11.6); here
 *     it is paid every step, which is the stream's nearest thing to a wave.
 *   - Respawning. Units stand back up at the start of a build phase (§5.4);
 *     here a fallen unit stands back up on its own tile after
 *     `respawnSeconds`, so the stream wears a line down without ending it.
 *   - The board. The line can only be changed between waves (§3.1); here it
 *     can be changed throughout (apply.ts, `boardOpen`), or the gold the
 *     stream pays would have nothing to buy.
 *
 * And sends, which a solo player can only aim at themselves: one bought in the
 * last build phase, or during the stream, walks in at once rather than waiting
 * for a next wave that is never coming. Sends have a pool of their own on the
 * field (§8.1, amended), so a send only ever waits behind other sends: one
 * that queued behind the stream used to surface minutes after it was bought -
 * long after auto-send was switched off - which read as sends nobody paid for.
 *
 * DETERMINISM
 *
 * Body `n` is drawn from `waveRng(seed, ENDLESS_SALT + n)` and nothing else,
 * as a wave is from `(seed, waveNumber)` (§9.2): the stream a seed produces is
 * the same whatever the player does to it, and a replay of it is exact.
 */

import type { GameData } from '../data/schema.ts';
import { secondsToTicks } from './constants.ts';
import type { DefIndex } from './defs.ts';
import { stat } from './defs.ts';
import { recomputeUnitBuffs } from './buffs.ts';
import { waveRng } from './rng.ts';
import { countLiving, createMonster, freeSpawnPoint, poolCap, poolOf } from './spawn.ts';
import { freshAbilityState } from './status.ts';
import type { DefensiveUnit, Lane, MatchState } from './types.ts';
import { resolveMonsterStats, sendBounty, type SpawnSpec } from './waves.ts';

/**
 * Keeps the stream's draws apart from the waves' own. `waveRng` derives a
 * generator from a seed and a number, and the waves use 1 to 25 - so the
 * stream counts from somewhere they will never reach.
 */
const ENDLESS_SALT = 1_000_000;

interface Ctx {
  data: GameData;
  defs: DefIndex;
}

/**
 * Every monster the authored waves used, split into the ones that walk in with
 * the stream and the bosses that arrive on their own clock. Sorted, so the
 * index a draw lands on means the same monster on every client.
 */
export function endlessPool(data: GameData): { monsters: string[]; bosses: string[] } {
  const bossIds = new Set(data.monsters.bosses.map((b) => b.id));
  const monsters = new Set<string>();
  const bosses = new Set<string>(data.waves.bossBank);
  for (const wave of data.waves.composition) {
    for (const entry of wave.entries) {
      if (bossIds.has(entry.monsterId)) bosses.add(entry.monsterId);
      else monsters.add(entry.monsterId);
    }
  }
  return { monsters: [...monsters].sort(), bosses: [...bosses].sort() };
}

/** How many steps up the curve the stream is, `ageTicks` after it opened. */
export function endlessStep(data: GameData, ageTicks: number): number {
  const step = secondsToTicks(data.waves.endless.stepSeconds);
  return step > 0 ? Math.floor(ageTicks / step) : 0;
}

/**
 * The wave whose strength a body of this step has (§9.1): the last authored
 * wave plus one, plus a wave for every step since. The stream is `wave + 1`
 * on the HUD from start to end; this is only the number its bodies are grown
 * by, and the key their enrage clock (§8) is kept under.
 */
export function endlessWaveNumber(data: GameData, step: number): number {
  return data.waves.showdown.afterWave + 1 + step;
}

/** Ticks between arrivals at this step. */
function gapTicks(data: GameData, step: number): number {
  const cfg = data.waves.endless;
  let gap = cfg.firstGapSeconds;
  // A loop rather than Math.pow, which is not bit-identical across engines and
  // is banned in the simulation for that reason (waves.ts, `intPow`).
  for (let i = 0; i < step && gap > cfg.minGapSeconds; i++) gap *= cfg.gapPerStep;
  return Math.max(1, secondsToTicks(Math.max(cfg.minGapSeconds, gap)));
}

/**
 * Open the stream. Called by `advancePhase` when solo's last build phase runs
 * out, in place of spawning a wave (tick.ts).
 */
export function beginEndless(ctx: Ctx, state: MatchState): void {
  const cfg = ctx.data.waves.endless;
  state.phase = 'combat';
  state.wave = ctx.data.waves.showdown.afterWave + 1;
  state.phaseTicksLeft = 0;
  state.endless = {
    age: 0,
    spawned: 0,
    // The first body on the first tick, so the wave visibly starts when the
    // build timer says it does.
    nextBody: 1,
    nextBoss: secondsToTicks(cfg.bossEverySeconds),
    fallen: {},
  };
  // What a wave start does (tick.ts): tech recomputed, and the damage panel
  // starts counting again.
  for (const lane of Object.values(state.lanes)) {
    recomputeUnitBuffs(ctx.data, ctx.defs, lane);
    for (const unit of lane.units) unit.damageDealt = 0;
  }
}

/**
 * One tick of the stream for one lane, before the lane itself ticks (so a
 * body that arrives is in place for this tick's fighting, as a wave's is).
 */
export function endlessTick(ctx: Ctx, state: MatchState, lane: Lane): void {
  const endless = state.endless;
  if (!endless) return;
  const { data } = ctx;
  const cfg = data.waves.endless;

  endless.age += 1;
  const step = endlessStep(data, endless.age);
  const waveNumber = endlessWaveNumber(data, step);

  // §11.6: passive income, paid as each step opens - the stream's wave.
  const stepTicks = secondsToTicks(cfg.stepSeconds);
  if (stepTicks > 0 && endless.age % stepTicks === 0) {
    lane.economy.gold += lane.economy.passiveIncome;
  }

  // Sends walk straight in. They are paid for as any send is - the bounty the
  // sender's gems bought (`sendBounty`) - and there being no next wave to hold
  // them for is the only difference.
  if (lane.incomingSends.length > 0) {
    for (const sent of lane.incomingSends) {
      admit(ctx, state, lane, {
        defId: sent.defId,
        waveNumber,
        sendId: sent.sendId,
        bounty: sendBounty(data, sent.sendId),
      });
    }
    lane.incomingSends.length = 0;
    lane.sendLog.length = 0;
  }

  // The stream. A full reserve holds it back rather than queueing without end:
  // a player who cannot keep up is about to lose anyway, and a reserve of a
  // thousand bodies is memory spent on a foregone conclusion. Full of the
  // STREAM's bodies, that is: sends are counted out, or a player could hold
  // the stream back by queueing cheap sends in front of it.
  const pool = endlessPool(data);
  endless.nextBody -= 1;
  if (endless.nextBody <= 0 && streamQueued(lane) < cfg.maxReserve && pool.monsters.length > 0) {
    const rng = waveRng(state.seed, ENDLESS_SALT + endless.spawned);
    const defId = pool.monsters[rng.int(pool.monsters.length)]!;
    endless.spawned += 1;
    admit(ctx, state, lane, { defId, waveNumber, bounty: bodyBounty(ctx, defId) });
    endless.nextBody = gapTicks(data, step);
  }

  endless.nextBoss -= 1;
  if (endless.nextBoss <= 0 && pool.bosses.length > 0) {
    // Which boss is a function of WHEN, not of how many bodies the player let
    // through: the stream holds back on a full reserve, and the boss at the
    // three-minute mark should be the same boss either way.
    const bossTicks = Math.max(1, secondsToTicks(cfg.bossEverySeconds));
    const rng = waveRng(state.seed, 2 * ENDLESS_SALT + Math.floor(endless.age / bossTicks));
    const defId = pool.bosses[rng.int(pool.bosses.length)]!;
    // §3.4's purse rides on a boss here too: it is the reward for the fight
    // the stream just got harder by.
    admit(ctx, state, lane, {
      defId,
      waveNumber,
      bounty: bodyBounty(ctx, defId) + (data.economy.bossBounty ?? 0),
    });
    endless.nextBoss = secondsToTicks(cfg.bossEverySeconds);
  }

  standUpTheFallen(ctx, endless, lane);
}

/** A stream body's gold: its weight at the stream's rate (§11.1 has no pool to split here). */
function bodyBounty(ctx: Ctx, defId: string): number {
  const weight = ctx.defs.monsters.get(defId)?.bounty ?? 0;
  return Math.max(0, weight) * ctx.data.waves.endless.bountyPerWeight;
}

/** How many of the stream's own bodies are waiting in the reserve: sends not counted. */
function streamQueued(lane: Lane): number {
  let count = 0;
  for (const queued of lane.reserve) if (poolOf(queued) === 'wave') count++;
  return count;
}

/**
 * Put one body into the lane: onto the field if its pool has room, into the
 * reserve if not (§8.1), and onto its step's enrage clock either way. The
 * stream, bosses included, counts against the wave's pool and sends against
 * their own, so neither waits behind the other (§8.1, amended).
 */
function admit(ctx: Ctx, state: MatchState, lane: Lane, spec: SpawnSpec): void {
  // One clock per step, as one per wave (§8): bodies of a step that are still
  // standing a minute later enrage together, and a fresh step does not
  // inherit an old one's fury.
  let clock = state.waveClocks.find((c) => c.waveNumber === spec.waveNumber);
  if (!clock) {
    clock = { waveNumber: spec.waveNumber, age: 0, remaining: 0 };
    state.waveClocks.push(clock);
  }
  clock.remaining += 1;

  const pool = poolOf(spec);
  const def = ctx.defs.monsters.get(spec.defId);
  if (!def) return;
  const radius = resolveMonsterStats(ctx.data, def, spec.waveNumber).radius;
  // Straight in if its pool has room, nobody of its pool is already waiting
  // (which would be jumping the queue), and the zone has ground for it;
  // otherwise it waits its turn (spawn.ts, `admitFromReserve`).
  const at =
    countLiving(lane, pool) < poolCap(ctx.data, pool) &&
    !lane.reserve.some((queued) => poolOf(queued) === pool)
      ? freeSpawnPoint(ctx.data, radius, lane.monsters)
      : null;
  if (!at) {
    lane.reserve.push(spec);
    return;
  }
  const monster = createMonster(state, ctx.data, ctx.defs, spec, at);
  if (monster) lane.monsters.push(monster);
}

/**
 * §5.4, for a fight with no build phase in it: a unit that falls stands back
 * up on its own tile, whole, after `respawnSeconds`.
 */
function standUpTheFallen(ctx: Ctx, endless: NonNullable<MatchState['endless']>, lane: Lane): void {
  const wait = secondsToTicks(ctx.data.waves.endless.respawnSeconds);
  for (const unit of lane.units) {
    if (unit.alive) continue;
    const left = endless.fallen[unit.id];
    if (left === undefined) {
      endless.fallen[unit.id] = wait;
      continue;
    }
    if (left > 1) {
      endless.fallen[unit.id] = left - 1;
      continue;
    }
    delete endless.fallen[unit.id];
    // Its tech comes with it: `baseMaxHp` already carries the health track
    // and the multipliers are cached on the unit (buffs.ts).
    respawnUnit(unit, stat(ctx.data.abilities.energy.max));
  }
  // A unit sold while it was down has no clock to keep.
  for (const id of Object.keys(endless.fallen)) {
    if (!lane.units.some((u) => u.id === Number(id))) delete endless.fallen[Number(id)];
  }
}

/**
 * One unit, back on its tile and whole (§5.4). What a build phase does to the
 * whole line (tick.ts, `respawnUnits`), and what the stream does to one body
 * at a time.
 */
export function respawnUnit(unit: DefensiveUnit, energyMax: number): void {
  unit.alive = true;
  unit.maxHp = unit.baseMaxHp;
  unit.hp = unit.maxHp;
  // A fresh body, which is what §5.4 says respawning is: no burns carried
  // over from the fight that killed it, no cooldowns part-spent, and a FULL
  // ENERGY POOL. A pool that carried over would make the first wave after a
  // long fight quietly weaker than the one after a short one, for a reason no
  // player could see. Nothing can spend it during the build phase either
  // (abilityRuntime.ts, `AbilityEnv.fighting`), so full here is full when the
  // wave lands.
  Object.assign(unit, freshAbilityState(energyMax));
  unit.targetId = null;
  unit.cooldown = 0;
  // Units advance during combat (§5.2, amended), so put it back on the tile
  // the player chose rather than wherever it drifted to.
  unit.pos.x = unit.homeTileX + 0.5;
  unit.pos.y = unit.homeTileY + 0.5;
  unit.engaged = false;
  unit.fieldCell = -1;
}

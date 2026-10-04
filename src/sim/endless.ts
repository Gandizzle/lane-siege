/**
 * Solo mode's last wave. DESIGN.md §3.3, solo.
 *
 * In a standard match the last wave is followed by the Final Showdown. A solo
 * player has nobody to meet there, so instead they get one more build phase
 * and then a wave that never ends. The field fills to the wave's cap
 * (`maxConcurrentMonsters`, §8.1) at once, with monsters of types drawn at
 * random from every monster the twenty-five waves used, and every one that
 * dies is replaced on the next tick. Every `bossEverySeconds` a batch of
 * bosses falls due - one more in it every `bossGrowthEvery` batches - and
 * they take the next places that free up. And the whole stream climbs the
 * waves' own growth curve one wave's worth every `stepSeconds`. The match ends
 * when the fortress falls; what is left to compare is how many monsters fell
 * before it did.
 *
 * THE LINE IS WHAT YOU BROUGHT
 *
 * Nothing can be bought once the stream opens - not a unit, not an upgrade,
 * not tech, the fortress, supply, the weapon or the aura (apply.ts, `shopOpen`
 * and `boardOpen`) - and a unit that falls stays down: there is no build
 * phase left to respawn it in (§5.4). The last build phase is the last chance
 * to spend, so gold stops when it ends: the stream's bodies pay nothing and no
 * passive income is paid, since there is nothing left to spend either on.
 *
 * Sends are the one thing still open, and a solo player can only aim them at
 * themselves: gems buy more monsters to kill for the tally, at the wall's
 * risk. One bought in the last build phase, or during the stream, walks in at
 * once rather than waiting for a next wave that is never coming - into a pool
 * of its own on the field (§8.1, amended), so a send only ever waits behind
 * other sends.
 *
 * DETERMINISM
 *
 * Body `n` is drawn from `waveRng(seed, ENDLESS_SALT + n)` and boss `n` from
 * `waveRng(seed, 2 * ENDLESS_SALT + n)`, and nothing else, as a wave is from
 * `(seed, waveNumber)` (§9.2): which monsters the stream sends, in what order,
 * is the same whatever the player does - only how soon each arrives depends
 * on how fast the last one died - and a replay of it is exact.
 */

import type { GameData } from '../data/schema.ts';
import { secondsToTicks } from './constants.ts';
import type { DefIndex } from './defs.ts';
import { recomputeUnitBuffs } from './buffs.ts';
import { waveRng } from './rng.ts';
import { countLiving, createMonster, freeSpawnPoint, poolCap, poolOf } from './spawn.ts';
import { emptyTally } from './state.ts';
import type { EndlessState, Lane, MatchState } from './types.ts';
import { resolveMonsterStats, type SpawnSpec } from './waves.ts';

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
 * Every monster the authored waves used, split into the ones that fill the
 * field and the bosses that arrive in batches. Sorted, so the index a draw
 * lands on means the same monster on every client.
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

/**
 * How many bosses the batch numbered `batch` (from 0) brings: `firstBosses`,
 * and one more every `bossGrowthEvery` batches - so a few minutes in, the
 * places that free up go to bosses as often as not.
 */
export function bossBatchSize(data: GameData, batch: number): number {
  const cfg = data.waves.endless;
  return cfg.firstBosses + Math.floor(batch / cfg.bossGrowthEvery);
}

/**
 * Open the stream. Called by `advancePhase` when solo's last build phase runs
 * out, in place of spawning a wave (tick.ts).
 */
export function beginEndless(ctx: Ctx, state: MatchState): void {
  state.phase = 'combat';
  state.wave = ctx.data.waves.showdown.afterWave + 1;
  state.phaseTicksLeft = 0;
  state.endless = {
    age: 0,
    spawned: 0,
    bossesSpawned: 0,
    batches: 0,
    bossesDue: 0,
    nextBatch: batchTicks(ctx.data),
  };
  // What a wave start does (tick.ts): tech recomputed, and the damage panel
  // starts counting again.
  for (const lane of Object.values(state.lanes)) {
    recomputeUnitBuffs(ctx.data, ctx.defs, lane);
    for (const unit of lane.units) unit.damageDealt = 0;
    lane.waveTally = emptyTally();
  }
}

function batchTicks(data: GameData): number {
  return Math.max(1, secondsToTicks(data.waves.endless.bossEverySeconds));
}

/**
 * One tick of the stream for one lane, before the lane itself ticks (so a
 * body that arrives is in place for this tick's fighting, as a wave's is).
 */
export function endlessTick(ctx: Ctx, state: MatchState, lane: Lane): void {
  const endless = state.endless;
  if (!endless) return;
  const { data } = ctx;

  endless.age += 1;
  const waveNumber = endlessWaveNumber(data, endlessStep(data, endless.age));

  // A batch of bosses falls due on its clock. It does not push in: its bosses
  // take the next places on the field ahead of the stream's own bodies.
  endless.nextBatch -= 1;
  if (endless.nextBatch <= 0) {
    endless.bossesDue += bossBatchSize(data, endless.batches);
    endless.batches += 1;
    endless.nextBatch = batchTicks(data);
  }

  // Sends walk straight in, into their own pool. They pay no bounty here: gold
  // has nothing left to buy.
  if (lane.incomingSends.length > 0) {
    for (const sent of lane.incomingSends) {
      admitSend(ctx, state, lane, {
        defId: sent.defId,
        waveNumber,
        sendId: sent.sendId,
        bounty: 0,
      });
    }
    lane.incomingSends.length = 0;
    lane.sendLog.length = 0;
  }

  fillTheField(ctx, state, lane, endless, waveNumber);
}

/**
 * Keep the wave's pool full (§8.1): a body for every place free on the field,
 * bosses first while any are due, for as long as the spawn zone has ground for
 * them. On the stream's first tick that is the whole pool at once; after it,
 * one for each that died.
 */
function fillTheField(
  ctx: Ctx,
  state: MatchState,
  lane: Lane,
  endless: EndlessState,
  waveNumber: number,
): void {
  const pool = endlessPool(ctx.data);
  const cap = poolCap(ctx.data, 'wave');
  let living = countLiving(lane, 'wave');

  while (living < cap) {
    const boss = endless.bossesDue > 0 && pool.bosses.length > 0;
    const choices = boss ? pool.bosses : pool.monsters;
    if (choices.length === 0) return;
    const rng = waveRng(
      state.seed,
      boss ? 2 * ENDLESS_SALT + endless.bossesSpawned : ENDLESS_SALT + endless.spawned,
    );
    const defId = choices[rng.int(choices.length)]!;
    const def = ctx.defs.monsters.get(defId);
    if (!def) return;
    const radius = resolveMonsterStats(ctx.data, def, waveNumber).radius;
    const at = freeSpawnPoint(ctx.data, radius, lane.monsters);
    // No ground for it yet. The same draw is made again next tick, so what
    // arrives does not depend on how crowded the zone was.
    if (!at) return;

    if (boss) {
      endless.bossesSpawned += 1;
      endless.bossesDue -= 1;
    } else {
      endless.spawned += 1;
    }
    onItsClock(state, waveNumber);
    const monster = createMonster(state, ctx.data, ctx.defs, { defId, waveNumber, bounty: 0 }, at);
    if (monster) lane.monsters.push(monster);
    living += 1;
  }
}

/**
 * Put one send into the lane: onto the field if its pool has room, nobody of
 * its pool is already waiting (which would be jumping the queue) and the zone
 * has ground for it; into the reserve if not (spawn.ts, `admitFromReserve`).
 */
function admitSend(ctx: Ctx, state: MatchState, lane: Lane, spec: SpawnSpec): void {
  const def = ctx.defs.monsters.get(spec.defId);
  if (!def) return;
  onItsClock(state, spec.waveNumber);
  const pool = poolOf(spec);
  const radius = resolveMonsterStats(ctx.data, def, spec.waveNumber).radius;
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
 * One clock per step, as one per wave (§8): bodies of a step that are still
 * standing a minute later enrage together, and a fresh step does not inherit
 * an old one's fury.
 */
function onItsClock(state: MatchState, waveNumber: number): void {
  let clock = state.waveClocks.find((c) => c.waveNumber === waveNumber);
  if (!clock) {
    clock = { waveNumber, age: 0, remaining: 0 };
    state.waveClocks.push(clock);
  }
  clock.remaining += 1;
}

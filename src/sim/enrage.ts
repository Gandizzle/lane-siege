/**
 * Enrage. DESIGN.md §8.
 *
 * Additive, not compounding, because an additive curve is readable at a glance
 * and a compounding one is not. Applies to monster damage, movement speed and
 * attack speed - never to HP: a stalling player should face deadlier monsters,
 * not unkillable ones.
 *
 * Tracked per WAVE, not per lane. Wave 3's monsters carry their own clock; if
 * they join a still-enraged wave 2, they start fresh and wave 2 stays enraged.
 * A wave's clock stops when all of its monsters are dead.
 */

import type { EnrageConfig } from '../data/schema.ts';
import { ticksToSeconds } from './constants.ts';
import type { MatchState, Monster, WaveClock } from './types.ts';

/** Multiplier for a wave that has existed for `ageTicks`. */
export function enrageMultiplier(config: EnrageConfig, ageTicks: number): number {
  const enragedSeconds = ticksToSeconds(ageTicks) - config.delaySeconds;
  if (enragedSeconds <= 0) return 1;
  const multiplier = 1 + config.ratePerSecond * enragedSeconds;
  return multiplier > config.cap ? config.cap : multiplier;
}

export function findWaveClock(state: MatchState, waveNumber: number): WaveClock | undefined {
  return state.waveClocks.find((c) => c.waveNumber === waveNumber);
}

/** Multiplier currently applying to one monster, via its wave's clock. */
export function monsterEnrage(state: MatchState, monster: Monster, config: EnrageConfig): number {
  const clock = findWaveClock(state, monster.waveNumber);
  return clock ? enrageMultiplier(config, clock.age) : 1;
}

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { secondsToTicks } from './constants.ts';
import { enrageMultiplier } from './enrage.ts';

const { data } = loadDataFromDisk();
const config = data.waves.enrage;

describe('enrage (DESIGN.md §8)', () => {
  it('does nothing before the delay elapses', () => {
    expect(enrageMultiplier(config, 0)).toBe(1);
    expect(enrageMultiplier(config, secondsToTicks(config.delaySeconds))).toBe(1);
  });

  it('matches the worked example: 60 seconds in is 2.8x', () => {
    const ticks = secondsToTicks(config.delaySeconds + 60);
    expect(enrageMultiplier(config, ticks)).toBeCloseTo(2.8, 6);
  });

  it('is additive, not compounding', () => {
    const at30 = enrageMultiplier(config, secondsToTicks(config.delaySeconds + 30));
    const at60 = enrageMultiplier(config, secondsToTicks(config.delaySeconds + 60));
    // Additive: the gain over the second 30s equals the gain over the first.
    expect(at60 - at30).toBeCloseTo(at30 - 1, 6);
  });

  it('caps', () => {
    expect(enrageMultiplier(config, secondsToTicks(100000))).toBe(config.cap);
  });
});

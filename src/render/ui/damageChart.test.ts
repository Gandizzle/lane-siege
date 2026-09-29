/**
 * The damage chart's words for the matrix (damageChart.ts): what each cell
 * says, read the way the simulation reads it.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import { damageMultiplier } from '../../sim/index.ts';
import { formatMultiplier, verdict } from './damageChart.ts';

const { data } = loadDataFromDisk();

describe('the damage chart', () => {
  it('calls a multiplier strong above one, weak below, and nothing at one', () => {
    expect(verdict(1.5)).toBe('strong');
    expect(verdict(0.6)).toBe('weak');
    expect(verdict(1)).toBe('');
  });

  it('writes multipliers without float noise', () => {
    expect(formatMultiplier(1.5)).toBe('×1.5');
    expect(formatMultiplier(0.6000000000000001)).toBe('×0.6');
    expect(formatMultiplier(1)).toBe('×1');
  });

  it('has a strong and a weak cell for every damage type in the current matrix', () => {
    // What the tutorial's Counters chapter tells the player to look for.
    const { damageTypes, armourTypes, multipliers } = data.matrix;
    for (const type of damageTypes) {
      const words = armourTypes.map((armour) =>
        verdict(damageMultiplier(multipliers, type, armour)),
      );
      expect(words).toContain('strong');
      expect(words).toContain('weak');
    }
  });
});

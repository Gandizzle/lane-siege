import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { damageMultiplier, resolveDamage } from './damage.ts';

const { data } = loadDataFromDisk();
const matrix = data.matrix.multipliers;

describe('damage matrix (DESIGN.md §6)', () => {
  it('gives every damage type exactly one favourable and one unfavourable matchup', () => {
    for (const dmg of data.matrix.damageTypes) {
      const values = data.matrix.armourTypes.map((arm) => damageMultiplier(matrix, dmg, arm));
      expect(values.filter((v) => v > 1)).toHaveLength(1);
      expect(values.filter((v) => v < 1)).toHaveLength(1);
    }
  });

  it('encodes the rationale from the doc', () => {
    // Impact shatters Ward barriers; wasted on Swarm.
    expect(damageMultiplier(matrix, 'impact', 'ward')).toBe(1.5);
    expect(damageMultiplier(matrix, 'impact', 'swarm')).toBe(0.6);
    // Pierce punches through Plate; passes cleanly through Flesh.
    expect(damageMultiplier(matrix, 'pierce', 'plate')).toBe(1.5);
    expect(damageMultiplier(matrix, 'pierce', 'flesh')).toBe(0.6);
    // Blast shreds Flesh; smothered by Plate.
    expect(damageMultiplier(matrix, 'blast', 'flesh')).toBe(1.5);
    expect(damageMultiplier(matrix, 'blast', 'plate')).toBe(0.6);
    // Arcane chains through Swarm; absorbed by Ward.
    expect(damageMultiplier(matrix, 'arcane', 'swarm')).toBe(1.5);
    expect(damageMultiplier(matrix, 'arcane', 'ward')).toBe(0.6);
  });

  it('applies the multiplier to damage per attack', () => {
    expect(resolveDamage(matrix, 100, 'blast', 'flesh')).toBeCloseTo(150);
    expect(resolveDamage(matrix, 100, 'blast', 'plate')).toBeCloseTo(60);
    expect(resolveDamage(matrix, 100, 'blast', 'swarm')).toBeCloseTo(100);
  });

  it('never returns negative damage', () => {
    expect(resolveDamage(matrix, -10, 'impact', 'flesh')).toBe(0);
  });
});

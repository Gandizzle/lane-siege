import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { damageMultiplier, resolveDamage } from './damage.ts';

const { data } = loadDataFromDisk();
const matrix = data.matrix.multipliers;

describe('damage matrix (DESIGN.md §6)', () => {
  it('gives every damage type exactly one favourable and one unfavourable matchup', () => {
    for (const dmg of data.matrix.damageTypes) {
      const values = data.matrix.armorTypes.map((arm) => damageMultiplier(matrix, dmg, arm));
      expect(values.filter((v) => v > 1)).toHaveLength(1);
      expect(values.filter((v) => v < 1)).toHaveLength(1);
    }
  });

  it('runs as one cycle: each type beats one armor and is weak to the next', () => {
    // Arcane burns through Flesh; absorbed by Ward.
    expect(damageMultiplier(matrix, 'arcane', 'flesh')).toBe(1.5);
    expect(damageMultiplier(matrix, 'arcane', 'ward')).toBe(0.6);
    // Blast scatters a Swarm; soaked up by Flesh.
    expect(damageMultiplier(matrix, 'blast', 'swarm')).toBe(1.5);
    expect(damageMultiplier(matrix, 'blast', 'flesh')).toBe(0.6);
    // Pierce punches through Plate; slips between the bodies of a Swarm.
    expect(damageMultiplier(matrix, 'pierce', 'plate')).toBe(1.5);
    expect(damageMultiplier(matrix, 'pierce', 'swarm')).toBe(0.6);
    // Impact shatters Ward barriers; rings off Plate.
    expect(damageMultiplier(matrix, 'impact', 'ward')).toBe(1.5);
    expect(damageMultiplier(matrix, 'impact', 'plate')).toBe(0.6);
  });

  it('has no closed pair: the strong and weak links form a single loop', () => {
    // The playtest: the old chart split into two halves that never touched.
    // Follow "the armor this type is weak to" -> "the type strong against
    // that armor" and every type must come round before repeating.
    const strongAgainst = (armor: string) =>
      data.matrix.damageTypes.find((d) => damageMultiplier(matrix, d, armor as never) > 1)!;
    const weakTo = (dmg: string) =>
      data.matrix.armorTypes.find((a) => damageMultiplier(matrix, dmg as never, a) < 1)!;
    const seen = new Set<string>();
    let type: string = data.matrix.damageTypes[0]!;
    for (let i = 0; i < data.matrix.damageTypes.length; i++) {
      seen.add(type);
      type = strongAgainst(weakTo(type));
    }
    expect(seen.size).toBe(data.matrix.damageTypes.length);
  });

  it('applies the multiplier to damage per attack', () => {
    expect(resolveDamage(matrix, 100, 'blast', 'swarm')).toBeCloseTo(150);
    expect(resolveDamage(matrix, 100, 'blast', 'flesh')).toBeCloseTo(60);
    expect(resolveDamage(matrix, 100, 'blast', 'plate')).toBeCloseTo(100);
  });

  it('never returns negative damage', () => {
    expect(resolveDamage(matrix, -10, 'impact', 'flesh')).toBe(0);
  });
});

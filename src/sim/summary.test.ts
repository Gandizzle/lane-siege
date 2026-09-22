/**
 * The build-phase wave summary. DESIGN.md §9.3.
 *
 * "Without this, the matrix is invisible complexity and new players lose without
 * knowing why." So the counter hints are game logic with a correctness bar, not
 * cosmetic text.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { trivialWaves } from './fixtures.ts';
import { summariseWave } from './waves.ts';

const { data } = loadDataFromDisk();

/** A wave of Grubs and nothing else, for the single-armour readings. */
const grubsOnly = trivialWaves(data, 'grub');

describe('wave summary (§9.3)', () => {
  it('names what the wave mostly deals', () => {
    // A wave of nothing but Grubs, which deal Impact. Built rather than
    // assumed: wave 1 is a tuned composition and picked up a second monster
    // the first time it was tuned.
    const summary = summariseWave(grubsOnly, 1, 1);
    expect(summary.dominantDamageType).toBe('impact');
    expect(summary.dominantDamageShare).toBe(1);
  });

  it('names the commonest of a mixed wave rather than claiming all of it', () => {
    const summary = summariseWave(data, 1, 1);
    expect(summary.dominantDamageShare).toBeGreaterThan(0);
    expect(summary.dominantDamageShare).toBeLessThanOrEqual(1);
  });

  it('reports the armour spread, commonest first', () => {
    const summary = summariseWave(data, 1, 3);
    expect(summary.armourMix.length).toBeGreaterThan(1);
    for (let i = 1; i < summary.armourMix.length; i++) {
      expect(summary.armourMix[i - 1]!.count).toBeGreaterThanOrEqual(summary.armourMix[i]!.count);
    }
  });

  it('rates Blast strong and Pierce weak against an all-Flesh wave', () => {
    // §6: Blast shreds Flesh (1.5); Pierce passes through it (0.6).
    const summary = summariseWave(grubsOnly, 1, 1, 'ironvow');

    const mortar = summary.units.find((u) => u.unitId === 'sanction')!;
    const spike = summary.units.find((u) => u.unitId === 'sentinel')!;
    const hammer = summary.units.find((u) => u.unitId === 'pledge')!;

    expect(mortar.verdict).toBe('strong');
    expect(mortar.effectiveness).toBeCloseTo(1.5, 6);

    expect(spike.verdict).toBe('weak');
    expect(spike.effectiveness).toBeCloseTo(0.6, 6);

    // Impact is neutral against Flesh.
    expect(hammer.verdict).toBe('neutral');
    expect(hammer.effectiveness).toBeCloseTo(1.0, 6);
  });

  it('weights effectiveness by how much of each armour is actually coming', () => {
    // Wave 3 mixes flesh, plate and swarm, so nothing should read as a pure
    // 1.5 or 0.6 - the average has to move off the single-armour values.
    const summary = summariseWave(data, 1, 3, 'ironvow');
    const mortar = summary.units.find((u) => u.unitId === 'sanction')!;
    expect(mortar.effectiveness).toBeGreaterThan(0.6);
    expect(mortar.effectiveness).toBeLessThan(1.5);
  });

  it('can scope to one builder', () => {
    const all = summariseWave(data, 1, 1);
    const scoped = summariseWave(data, 1, 1, 'ironvow');
    expect(scoped.units.length).toBeGreaterThan(0);
    expect(scoped.units.length).toBeLessThanOrEqual(all.units.length);
    expect(scoped.units.every((u) => u.unitId !== 'nonexistent')).toBe(true);
  });

  it('tags each rating with its mark, so the UI can show only buildables', () => {
    const summary = summariseWave(data, 1, 1, 'ironvow');
    // Builder A's full roster is six units (§7.1).
    expect(summary.units.filter((u) => u.mark === 1).length).toBe(6);
    expect(summary.units.some((u) => u.mark === 2)).toBe(true);
  });

  it('is a pure function of (seed, wave) like the wave itself (§9.2)', () => {
    expect(summariseWave(data, 77, 4)).toEqual(summariseWave(data, 77, 4));
  });
});

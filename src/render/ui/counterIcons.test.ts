/**
 * The counter hints on a unit card: a sword for its damage against the wave's
 * armor, a shield for its armor against the wave's damage (counterIcons.ts),
 * and where they are shown at all (features.ts).
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import { summariseWave } from '../../sim/index.ts';
import { trivialWaves } from '../../sim/fixtures.ts';
import { EVERYTHING, featuresFor } from '../features.ts';
import { parseRich, splitAmounts, GOLD } from './currency.ts';
import {
  SHIELD_BAD,
  SHIELD_GOOD,
  SWORD_BAD,
  SWORD_GOOD,
  counterHints,
  counterToken,
} from './counterIcons.ts';

const { data } = loadDataFromDisk();

describe('the sword and the shield', () => {
  it('is green for strong, red for weak, and absent when even', () => {
    expect(counterToken('sword', 'strong')).toBe(SWORD_GOOD);
    expect(counterToken('sword', 'weak')).toBe(SWORD_BAD);
    expect(counterToken('sword', 'neutral')).toBe('');
    expect(counterToken('shield', 'strong')).toBe(SHIELD_GOOD);
    expect(counterToken('shield', 'weak')).toBe(SHIELD_BAD);
    expect(counterToken('shield', 'neutral')).toBe('');
  });

  it('puts the sword first and leaves out whichever is even', () => {
    expect(counterHints({ verdict: 'strong', armorVerdict: 'weak' })).toBe(
      `${SWORD_GOOD} ${SHIELD_BAD}`,
    );
    expect(counterHints({ verdict: 'neutral', armorVerdict: 'strong' })).toBe(SHIELD_GOOD);
    expect(counterHints({ verdict: 'weak', armorVerdict: 'neutral' })).toBe(SWORD_BAD);
    expect(counterHints({ verdict: 'neutral', armorVerdict: 'neutral' })).toBe('');
    expect(counterHints(undefined)).toBe('');
  });

  it('reads both halves of the chart off a real wave', () => {
    // Grubs: flesh, dealing impact. Arcane beats flesh, blast does not; impact
    // glances off plate and goes through ward (§6).
    const summary = summariseWave(trivialWaves(data, 'grub'), 1, 1, 'ironvow');
    const tokens = (damageType: string | null, armor: string | null) =>
      summary.units
        .filter((u) => {
          const def = data.units.units.find((d) => d.id === u.unitId)!;
          return (!damageType || def.damageType === damageType) && (!armor || def.armor === armor);
        })
        .map((u) => counterHints(u));
    for (const hint of tokens('arcane', null)) expect(hint).toContain(SWORD_GOOD);
    for (const hint of tokens('blast', null)) expect(hint).toContain(SWORD_BAD);
    for (const hint of tokens(null, 'plate')) expect(hint).toContain(SHIELD_GOOD);
    for (const hint of tokens(null, 'ward')) expect(hint).toContain(SHIELD_BAD);
  });

  it('draws as icons in a line of text, with nothing after them taken for an amount', () => {
    expect(parseRich(`melee ${SWORD_GOOD} ${SHIELD_BAD}`)).toEqual([
      { text: 'melee ' },
      { icon: 'sword-good' },
      { text: ' ' },
      { icon: 'shield-bad' },
    ]);
    // After a coin, the number is gold; after a sword, the next word is a word.
    expect(splitAmounts(parseRich(`${SWORD_BAD} Vigil · ${GOLD}5`))).toEqual([
      { icon: 'sword-bad' },
      { text: ' Vigil · ' },
      { icon: 'gold' },
      { text: '5', of: 'gold' },
    ]);
  });
});

describe('where the hints are shown', () => {
  it('in the games you learn in: practice, solo and the tutorial', () => {
    for (const kind of ['practice', 'solo', 'tutorial'] as const) {
      expect(featuresFor({ kind }).counterHints, kind).toBe(true);
    }
  });

  it('not in a game against other people', () => {
    expect(featuresFor({ kind: 'quick' }).counterHints).toBe(false);
    expect(featuresFor({ kind: 'private', code: 'ABCD' }).counterHints).toBe(false);
    // And nothing else about the interface differs.
    expect({ ...featuresFor({ kind: 'quick' }), counterHints: true }).toEqual(EVERYTHING);
  });
});

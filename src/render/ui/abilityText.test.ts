/**
 * Abilities in words. See abilityText.ts.
 *
 * The rule these guard is that the words come from the NUMBERS. An authored
 * "+8% damage to three allies" stops being true the first time somebody tunes
 * the ability; a generated one cannot. So what is tested is that every ability
 * in the catalogue produces a description, that the description contains the
 * figures the data actually holds, and that a rank change moves them.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import { resolveAbility, type AbilityDef } from '../../data/schema.ts';
import { describeAbility, effectLine, targetLine, triggerLine } from './abilityText.ts';

const { data } = loadDataFromDisk();
const all = [...data.abilities.abilities, ...data.abilities.planned];

function def(id: string): AbilityDef {
  const found = all.find((a) => a.id === id);
  if (!found) throw new Error(`no ability ${id}`);
  return found;
}

describe('every ability can be described', () => {
  it('produces a trigger, a target and a line per effect, for all of them', () => {
    for (const ability of all) {
      const ranks = ability.ranks?.length ?? 1;
      for (let rank = 1; rank <= ranks; rank++) {
        const card = describeAbility(resolveAbility(ability, rank));
        expect(card.mechanics.length, `${ability.id} r${rank}`).toBe(2 + ability.effects.length);
        for (const line of card.mechanics) {
          expect(line.length, `${ability.id} r${rank}`).toBeGreaterThan(2);
          // A line that still has a placeholder in it is a case nobody wrote.
          expect(line, `${ability.id} r${rank}`).not.toContain('undefined');
          expect(line, `${ability.id} r${rank}`).not.toContain('NaN');
        }
      }
    }
  });

  it('keeps the authored line short enough for the card', () => {
    // The numbers are generated, so the authored line only has to say what the
    // ability is FOR. Anything longer is a paragraph in a box built for one.
    for (const ability of all) {
      expect(ability.text.length, ability.id).toBeLessThanOrEqual(90);
      expect(ability.text, ability.id).not.toMatch(/\d+%/);
    }
  });
});

describe('the numbers in the words are the numbers in the data', () => {
  it('reads a stacking aura the way a player would ask about it', () => {
    const card = describeAbility(resolveAbility(def('shoulder_to_shoulder'), 1));
    // The question the old flavour line raised: do they have to stay in a row?
    expect(card.mechanics[0]).toBe('Always on, while they are in range');
    expect(card.mechanics[1]).toBe('Up to 3 allies within 1.6 tiles');
    expect(card.mechanics[2]).toBe('+8% damage · up to 3 stacks, one per unit');
  });

  it('moves every figure when the rank does', () => {
    const one = describeAbility(resolveAbility(def('kindle'), 1)).mechanics.join('|');
    const three = describeAbility(resolveAbility(def('kindle'), 3)).mechanics.join('|');
    expect(one).not.toBe(three);
    expect(three).toContain('19 damage per second');
  });

  it('prices an ability that costs energy', () => {
    expect(triggerLine(resolveAbility(def('interdict'), 1))).toBe('Every 8s · costs 60 energy');
  });

  it('says what a chance is rather than leaving it out', () => {
    expect(triggerLine(resolveAbility(def('emberdust'), 1))).toContain('35% of its hits');
  });

  it('spells out a synergy in both directions', () => {
    // Applying the word...
    expect(effectLine(resolveAbility(def('snarekelp'), 1).effects[0]!)).toContain(
      'marks it soaked',
    );
    // ...and being paid for it.
    expect(effectLine(resolveAbility(def('hailburst'), 1).effects[0]!)).toContain(
      'against anything soaked',
    );
    // ...and only reaching what already carries it.
    expect(targetLine(resolveAbility(def('wildfire'), 1).target)).toContain('already burning');
  });

  it('says how a stack is counted, because that decides what to build', () => {
    // One per KIND: stacking it means a mixed line, not six of one thing.
    expect(effectLine(resolveAbility(def('rootbite'), 1).effects[0]!)).toContain(
      'one per KIND of unit',
    );
  });

  it('describes a passive on itself without inventing a range for it', () => {
    expect(triggerLine(resolveAbility(def('parry'), 1))).toBe('Always on');
  });
});

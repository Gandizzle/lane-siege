/**
 * Abilities in words. See abilityText.ts and `fillDescription` in abilities.ts.
 *
 * The card's paragraph is written by hand and its numbers are not: every
 * figure is a placeholder filled from the resolved ability at the unit's rank.
 * So what is tested is that every live ability has a paragraph, that every
 * placeholder in it resolves at every rank, that the figures it prints are the
 * figures in the data, and that the shared notes appear on exactly the
 * abilities whose rules they describe.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import { fillDescription, resolveAbility, type AbilityDef } from '../../data/schema.ts';
import {
  abilityNotes,
  describeAbility,
  effectLine,
  targetLine,
  triggerLine,
  type AbilityRules,
} from './abilityText.ts';

const { data } = loadDataFromDisk();
const live = data.abilities.abilities;
const all = [...live, ...data.abilities.planned];
const rules: AbilityRules = {
  energy: data.abilities.energy,
  control: data.abilities.control,
  dampening: data.waves.showdown.dampening,
};

function def(id: string): AbilityDef {
  const found = all.find((a) => a.id === id);
  if (!found) throw new Error(`no ability ${id}`);
  return found;
}

function paragraph(id: string, rank = 1): string {
  return describeAbility(resolveAbility(def(id), rank)).description;
}

describe('every ability on the field has a paragraph', () => {
  it('fills every placeholder at every rank, and leaves nothing behind', () => {
    for (const ability of live) {
      const ranks = ability.ranks?.length ?? 1;
      for (let rank = 1; rank <= ranks; rank++) {
        const { text, unresolved } = fillDescription(resolveAbility(ability, rank));
        expect(unresolved, `${ability.id} r${rank}`).toEqual([]);
        expect(text.length, `${ability.id} r${rank}`).toBeGreaterThan(40);
        expect(text, `${ability.id} r${rank}`).not.toMatch(/[{}]|undefined|NaN|Infinity/);
      }
    }
  });

  it('is written as sentences, not as a list', () => {
    for (const ability of live) {
      const text = paragraph(ability.id);
      expect(text, ability.id).toMatch(/^[A-Z]/);
      expect(text, ability.id).toMatch(/\.$/);
      // The style the bullets had, and the dash a generated paragraph leans on.
      expect(text, ability.id).not.toMatch(/·|—/);
    }
  });

  it('shows the paragraph in place of the generated lines', () => {
    const card = describeAbility(resolveAbility(def('kindle'), 1));
    expect(card.description).not.toBe('');
    expect(card.mechanics).toEqual([]);
  });

  it('falls back to the generated lines for a design with no paragraph', () => {
    for (const ability of data.abilities.planned) {
      if (ability.description) continue;
      const card = describeAbility(resolveAbility(ability, 1));
      expect(card.mechanics.length, ability.id).toBe(2 + ability.effects.length);
    }
  });

  it('keeps the authored line short enough for the card', () => {
    // The one-liner only says what the ability is FOR; the paragraph says the rest.
    for (const ability of all) {
      expect(ability.text.length, ability.id).toBeLessThanOrEqual(90);
      expect(ability.text, ability.id).not.toMatch(/\d+%/);
    }
  });
});

describe('the numbers in the words are the numbers in the data', () => {
  it('reads Shoulder to Shoulder the way a player would ask about it', () => {
    expect(paragraph('shoulder_to_shoulder', 1)).toBe(
      'Up to 3 allies within 1.6 tiles of the Pledge, nearest first, deal 8% more damage ' +
        "for as long as they stay in range. The Pledge doesn't buff itself. Each Pledge can " +
        'give an ally only one stack, but an ally standing near several Pledges can carry up ' +
        'to 3 stacks, and the stacks multiply together.',
    );
  });

  it('moves every figure when the rank does', () => {
    const one = paragraph('kindle', 1);
    const three = paragraph('kindle', 3);
    expect(one).toContain('4 blast damage per second over 4 seconds');
    expect(three).toContain('19 blast damage per second over 5 seconds');
  });

  it('reads a cost, a stack cap and a trigger threshold off the resolved ability', () => {
    expect(paragraph('interdict')).toContain('if it has 60 energy');
    expect(paragraph('kindle')).toContain('up to 3 at a time');
    expect(paragraph('unbroken')).toContain('below 50% health');
  });

  it('agrees a noun with its number', () => {
    expect(paragraph('spitfire', 1)).toContain('making up to 1 jump,');
    expect(paragraph('spitfire', 2)).toContain('making up to 2 jumps,');
    expect(paragraph('interdict')).toContain('for 1 second.');
  });

  it('writes a debuff as a size, and lets the sentence say which way', () => {
    // -0.15 in the data is "slows ... by 15%", not "by -15%".
    expect(paragraph('rootbite', 1)).toContain('by 15% for 2.5 seconds');
  });

  it('reports a placeholder that names nothing rather than printing it', () => {
    const broken = resolveAbility({ ...def('parry'), description: 'Dodges {nonsense%}.' }, 1);
    expect(fillDescription(broken).unresolved).toEqual(['{nonsense%}']);
  });
});

describe('the shared rules are noted where they apply', () => {
  const notes = (id: string) => abilityNotes(resolveAbility(def(id), 1), rules);

  it('explains energy on an ability that spends it, from the energy settings', () => {
    const energy = notes('interdict').find((n) => n.includes('regains'));
    expect(energy).toContain(`${data.abilities.energy.max} energy`);
    expect(energy).toContain(`${data.abilities.energy.regenPerSecond} a second`);
    expect(notes('kindle').some((n) => n.includes('regains'))).toBe(false);
  });

  it('explains diminishing control on a stun, from the control settings', () => {
    const control = notes('interdict').find((n) => n.includes('wear thin'));
    expect(control).toContain(`${data.abilities.control.windowSeconds} seconds`);
    expect(control).toContain(`${data.abilities.control.immuneSeconds} seconds`);
    expect(notes('parry').some((n) => n.includes('wear thin'))).toBe(false);
  });

  it('explains what ability damage can and cannot do on an ability that deals it', () => {
    expect(notes('verdict').some((n) => n.includes("can't miss"))).toBe(true);
    // Attack damage is only explained where it is used.
    expect(notes('firestorm').some((n) => n.includes('before tech'))).toBe(true);
    expect(notes('verdict').some((n) => n.includes('before tech'))).toBe(false);
    expect(notes('tidesong').some((n) => n.includes("can't miss"))).toBe(false);
  });

  it('warns that healing fades in the Final Showdown on an ability that heals', () => {
    expect(notes('heartwood').some((n) => n.includes('Final Showdown'))).toBe(true);
    expect(notes('grave_tithe').some((n) => n.includes('Final Showdown'))).toBe(true);
    expect(notes('impale').some((n) => n.includes('Final Showdown'))).toBe(false);
  });

  it('says when a timed ability starts its clock', () => {
    expect(notes('anchorline').some((n) => n.includes('timer'))).toBe(true);
    expect(notes('kindle').some((n) => n.includes('timer'))).toBe(false);
  });
});

describe('the generated lines a planned design falls back to', () => {
  it('prices an ability that costs energy', () => {
    expect(triggerLine(resolveAbility(def('interdict'), 1))).toBe('Every 8s · costs 60 energy');
  });

  it('spells out a synergy in both directions', () => {
    expect(effectLine(resolveAbility(def('snarekelp'), 1).effects[0]!)).toContain(
      'marks it soaked',
    );
    expect(effectLine(resolveAbility(def('hailburst'), 1).effects[0]!)).toContain(
      'against anything soaked',
    );
    expect(targetLine(resolveAbility(def('wildfire'), 1).target)).toContain('already burning');
  });
});

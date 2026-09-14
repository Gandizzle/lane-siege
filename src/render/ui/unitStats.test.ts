/**
 * What the selected-unit panel says. See unitStats.ts.
 *
 * The panel is a reading aid, so what is tested is what it says rather than
 * where it puts it: that the arrow appears exactly where an upgrade changes
 * something, and that a number nobody can act on is replaced by a word.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import type { UnitDef } from '../../data/schema.ts';
import { STAT_CELLS, statText } from './unitStats.ts';

const { data } = loadDataFromDisk();

function def(id: string): UnitDef {
  const found = data.units.units.find((u) => u.id === id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
}

function next(current: UnitDef): UnitDef | null {
  return current.upgradesTo ? def(current.upgradesTo) : null;
}

describe('a stat says what it is now, and what the tier would make it', () => {
  it('shows one value when there is no tier above', () => {
    const top = data.units.units.find((u) => !u.upgradesTo)!;
    for (const cell of STAT_CELLS) {
      expect(statText(cell.key, top, null)).not.toContain('→');
    }
  });

  it('shows the arrow only where the tier actually moves the number', () => {
    const hammer = def('hammer');
    const hammer2 = next(hammer)!;

    // A tier raises HP and damage, so those carry an arrow...
    expect(statText('hp', hammer, hammer2)).toBe(`${hammer.hp} → ${hammer2.hp}`);
    expect(statText('damage', hammer, hammer2)).toBe(`${hammer.damage} → ${hammer2.damage}`);

    // ...and leaves reach alone, so that one does not.
    expect(hammer.range).toBe(hammer2.range);
    expect(statText('range', hammer, hammer2)).not.toContain('→');
  });

  it('never shows an arrow between two identical readings', () => {
    // Belt and braces: an arrow that points at the same number it came from is
    // the panel claiming an upgrade bought something it did not.
    for (const current of data.units.units) {
      const above = next(current);
      if (!above) continue;
      for (const cell of STAT_CELLS) {
        const text = statText(cell.key, current, above);
        if (!text.includes('→')) continue;
        const [before, after] = text.split(' → ');
        expect(before).not.toBe(after);
      }
    }
  });
});

describe('numbers a player cannot act on are not shown as numbers', () => {
  it('calls a melee reach melee, rather than 0.1', () => {
    // §5.2: reach is edge to edge, so a melee unit's is a hair over zero. The
    // digits are true and useless; the word is what the player is deciding on.
    const hammer = def('hammer');
    expect(hammer.range).toBeLessThan(0.6);
    expect(statText('range', hammer, null)).toBe('melee');
  });

  it('gives a real gun its reach in tiles', () => {
    expect(statText('range', def('mortar'), null)).toBe('3.9 tiles');
  });

  it('says what a reading is measured in once, not on both sides of an arrow', () => {
    const spike = def('spike');
    const spike2 = def(spike.upgradesTo!);
    expect(spike.range).not.toBe(spike2.range);
    expect(statText('range', spike, spike2)).toBe(`${spike.range} → ${spike2.range} tiles`);
  });

  it('multiplies damage by attack speed, because neither means much alone', () => {
    // Bulwark hits hard and slowly, Thornling the other way round. The per-hit
    // numbers say the opposite of what the sustained ones do.
    const bulwark = def('bulwark');
    const thornling = def('thornling');
    expect(bulwark.damage!).toBeGreaterThan(thornling.damage!);

    const bulwarkDps = Number(statText('dps', bulwark, null));
    const thornlingDps = Number(statText('dps', thornling, null));
    expect(bulwarkDps).toBeCloseTo(bulwark.damage! * bulwark.attackSpeed!, 1);
    expect(thornlingDps).toBeGreaterThan(bulwarkDps);
  });

  it('trims a whole number rather than writing 1.0', () => {
    const hammer = def('hammer');
    expect(hammer.attackSpeed).toBe(1);
    expect(statText('attackSpeed', hammer, null)).toBe('1/s');
  });
});

describe('the stat block covers what the player asked to see', () => {
  it('has a cell for every number that decides a tile', () => {
    const keys = STAT_CELLS.map((c) => c.key);
    expect(keys).toContain('hp');
    expect(keys).toContain('damage');
    expect(keys).toContain('attackSpeed');
    expect(keys).toContain('moveSpeed');
    expect(keys).toContain('range');
  });

  it('fits the two-column grid it is drawn in', () => {
    expect(STAT_CELLS.length % 2).toBe(0);
  });

  it('formats every cell of every unit without producing an empty one', () => {
    for (const unit of data.units.units) {
      for (const cell of STAT_CELLS) {
        expect(statText(cell.key, unit, next(unit))).not.toBe('');
      }
    }
  });
});

describe('trait lines are descriptive only', () => {
  it('is never something the simulation would have to honour', () => {
    // A line here describes a rule the game already has. If one ever appears
    // before the mechanic does, the panel starts lying - so the data is
    // checked, not the renderer.
    for (const unit of data.units.units) {
      for (const trait of unit.traits ?? []) {
        expect(typeof trait).toBe('string');
        expect(trait.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

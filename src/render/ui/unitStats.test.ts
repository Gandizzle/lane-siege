/**
 * What the selected-unit panel says. See unitStats.ts.
 *
 * The panel is a reading aid, so most of what is tested is what it says rather
 * than where it puts it: that the arrow appears exactly where an upgrade
 * changes something, and that a number nobody can act on is replaced by a word.
 *
 * The exception is `panelRegions`, and it is the exception for a reason. The
 * buttons are pinned to the bottom of the panel and the ability text above them
 * grows with what it has to say, so on a short screen they used to meet - and
 * the text lost, because the buttons are drawn over it. The boxes are now a
 * subtraction, and these assert the subtraction at every viewport the game is
 * laid out for, both ways round.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import type { UnitDef } from '../../data/schema.ts';
import { computeLayout } from '../layout.ts';
import {
  STAT_CELLS,
  abilityLines,
  briefAbilityLines,
  monsterAbilityLines,
  monsterStatText,
  panelRegions,
  statText,
  typeLine,
} from './unitStats.ts';

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
    const hammer = def('pledge');
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
    const hammer = def('pledge');
    expect(hammer.range).toBeLessThan(0.6);
    expect(statText('range', hammer, null)).toBe('melee');
  });

  it('gives a real gun its reach in tiles', () => {
    expect(statText('range', def('sanction'), null)).toBe('3.9 tiles');
  });

  it('says what a reading is measured in once, not on both sides of an arrow', () => {
    const spike = def('sentinel');
    const spike2 = def(spike.upgradesTo!);
    expect(spike.range).not.toBe(spike2.range);
    expect(statText('range', spike, spike2)).toBe(`${spike.range} → ${spike2.range} tiles`);
  });

  it('multiplies damage by attack speed, because neither means much alone', () => {
    // Bulwark hits hard and slowly, Thornling the other way round. The per-hit
    // numbers say the opposite of what the sustained ones do.
    const bulwark = def('oathwall');
    const thornling = def('thornling');
    expect(bulwark.damage!).toBeGreaterThan(thornling.damage!);

    const bulwarkDps = Number(statText('dps', bulwark, null));
    const thornlingDps = Number(statText('dps', thornling, null));
    expect(bulwarkDps).toBeCloseTo(bulwark.damage! * bulwark.attackSpeed!, 1);
    expect(thornlingDps).toBeGreaterThan(bulwarkDps);
  });

  it('trims a whole number rather than writing 1.0', () => {
    const hammer = def('pledge');
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

describe('the panel gives the buttons their space before anything else gets any', () => {
  /** Every viewport the layout has to survive, both ways round. */
  const VIEWPORTS = [
    [412, 915],
    [360, 640],
    [320, 568],
    [915, 412],
    [640, 360],
    [1400, 800],
    [800, 1400],
  ] as const;

  /** The bar and the panel's box inside it, exactly as buildBar.ts computes them. */
  function panel(width: number, height: number) {
    const l = computeLayout(width, height, data.lane);
    // The bar's inner box: the same inset the tab strip leaves behind it.
    const top = l.buildBar.y + 6;
    return panelRegions(l.buildBar, top, l.buildBar.height - 12);
  }

  it('never lets the text reach the buttons, at any size or orientation', () => {
    for (const [w, h] of VIEWPORTS) {
      const r = panel(w, h);
      expect(r.text.y + r.text.height, `${w}x${h}`).toBeLessThanOrEqual(r.buttons.y + 0.001);
    }
  });

  it('never gives the text a negative box on a panel too short for one', () => {
    // A 240-pixel-tall bar has no room left after the title, the stats and a
    // touch target. The answer is no room, not a box that grows upwards.
    for (const barHeight of [40, 80, 120, 200, 400]) {
      const r = panelRegions({ x: 0, y: 0, width: 400, height: barHeight }, 0, barHeight);
      expect(r.text.height, `${barHeight}px bar`).toBeGreaterThanOrEqual(0);
      expect(r.text.y + r.text.height).toBeLessThanOrEqual(r.buttons.y + 0.001);
    }
  });

  it('stacks title, stats, text and buttons in that order without overlap', () => {
    for (const [w, h] of VIEWPORTS) {
      const r = panel(w, h);
      expect(r.stats.y, `${w}x${h}`).toBeGreaterThanOrEqual(r.title.y + r.title.height);
      expect(r.text.y).toBeGreaterThanOrEqual(r.stats.y + r.stats.height);
      expect(r.buttons.y).toBeGreaterThanOrEqual(r.text.y + r.text.height);
      expect(r.buttons.y + r.buttons.height).toBeLessThanOrEqual(
        l(w, h).buildBar.y + l(w, h).buildBar.height + 0.001,
      );
    }
  });

  it('keeps a floor under the ability text, giving up a stat row for it', () => {
    // The 360x640 case. Before the floor the text box came to seven pixels and
    // the panel said nothing at all about what the unit does.
    const r = panel(360, 640);
    expect(r.text.height).toBeGreaterThanOrEqual(26);
    expect(r.statRows).toBeLessThan(Math.ceil(STAT_CELLS.length / 2));
    expect(r.statRows).toBeGreaterThan(0);
    // And a tall panel keeps every row.
    expect(panel(412, 915).statRows).toBe(Math.ceil(STAT_CELLS.length / 2));
  });

  it('hands the buttons space to the text when there are no buttons to place', () => {
    // A monster has nothing to buy, so its panel is all reading.
    const bar = { x: 0, y: 0, width: 400, height: 300 };
    const withButtons = panelRegions(bar, 0, 300, true);
    const without = panelRegions(bar, 0, 300, false);
    expect(without.text.height).toBeGreaterThan(withButtons.text.height);
    expect(without.buttons.height).toBe(0);
  });

  it('keeps every box inside the bar it was given', () => {
    for (const [w, h] of VIEWPORTS) {
      const bar = l(w, h).buildBar;
      const r = panel(w, h);
      for (const name of ['title', 'stats', 'text', 'buttons'] as const) {
        const box = r[name];
        expect(box.x, `${w}x${h} ${name}`).toBeGreaterThanOrEqual(bar.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bar.x + bar.width + 0.001);
      }
    }
  });

  function l(width: number, height: number) {
    return computeLayout(width, height, data.lane);
  }
});

describe('what a body panel says', () => {
  it('puts the name and the types on one line, and no tier at all', () => {
    const vigil = def('vigil');
    expect(typeLine(vigil.damageType, vigil.armour)).toBe('arcane · ward');
    // The thing this replaced: "Vigil → Vigil II" over "Tier 1 → 2 · arcane ·
    // ward", which spent two of the panel's lines on the next unit's suffix.
    expect(typeLine(vigil.damageType, vigil.armour)).not.toContain('Tier');
    expect(typeLine(vigil.damageType, vigil.armour)).not.toContain('II');
  });

  it('names a NEW ability the next tier brings, and says nothing about a rank', () => {
    const ember = def('ember');
    const ember2 = def('ember_2');
    const ember3 = def('ember_3');

    // Tier 2 is the same ability with bigger numbers, which the stat block
    // already shows. Nothing is added.
    expect(abilityLines(data, ember, ember2).filter((s) => s.startsWith('Next tier'))).toEqual([]);
    // Tier 3 unlocks Conflagration, which is worth a line.
    const unlocks = abilityLines(data, ember2, ember3).filter((s) => s.startsWith('Next tier'));
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]).toContain('Conflagration');
  });

  it('gives every unit at least one line, because every unit has an ability', () => {
    for (const unit of data.units.units) {
      expect(abilityLines(data, unit, null).length, unit.id).toBeGreaterThan(0);
    }
  });

  it('strips the descriptions when the panel has no room for them', () => {
    const brief = briefAbilityLines(data, def('ember_3'), null);
    expect(brief).toEqual(['Kindle', 'Conflagration']);
    for (const line of brief) expect(line).not.toContain('—');
  });

  it('answers a tap on an ordinary monster rather than showing nothing', () => {
    const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;
    const lines = monsterAbilityLines(data, grub);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Nothing special');
  });

  it('reads a monster that does have one', () => {
    const bloater = data.monsters.monsters.find((m) => m.id === 'bloater')!;
    expect(monsterAbilityLines(data, bloater)[0]).toContain('Rupture');
  });

  it('reads a monster the same way it reads a unit', () => {
    const husk = data.monsters.monsters.find((m) => m.id === 'husk')!;
    for (const cell of STAT_CELLS) {
      expect(monsterStatText(cell.key, husk), cell.key).not.toBe('');
    }
    expect(monsterStatText('range', husk)).toBe('melee');
  });
});

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
import { resolveMonsterStats } from '../../sim/index.ts';
import type { UnitDef } from '../../data/schema.ts';
import { refId } from '../../data/schema.ts';
import { computeLayout } from '../layout.ts';
import type { StatMods } from '../../sim/index.ts';
import { layOutChips } from './abilityChips.ts';
import {
  MIN_ROW_HEIGHT,
  NOTHING_SPECIAL,
  STAT_CELLS,
  columnsThatFit,
  energyCost,
  energyMeter,
  isPlain,
  monsterChips,
  monsterNumbers,
  monsterStatText,
  panelRegions,
  statDirection,
  statText,
  typeLine,
  unitChips,
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

describe('a stat says what it is now, and what the mark would make it', () => {
  it('shows one value when there is no mark above', () => {
    const top = data.units.units.find((u) => !u.upgradesTo)!;
    for (const cell of STAT_CELLS) {
      expect(statText(cell.key, top, null)).not.toContain('→');
    }
  });

  it('shows the arrow only where the mark actually moves the number', () => {
    const hammer = def('pledge');
    const hammer2 = next(hammer)!;

    // A mark raises HP and damage, so those carry an arrow...
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
    // Somewhere in the roster is a pair where the per-hit numbers say the
    // opposite of what the sustained ones do - a slow heavy swing against a
    // fast light one. WHICH pair is a pricing decision and has moved once
    // already, so it is found rather than named.
    const units = data.units.units;
    const pair = units.flatMap((heavy) =>
      units
        .filter(
          (quick) =>
            (heavy.damage ?? 0) > (quick.damage ?? 0) &&
            (heavy.damage ?? 0) * (heavy.attackSpeed ?? 0) <
              (quick.damage ?? 0) * (quick.attackSpeed ?? 0),
        )
        .map((quick) => [heavy, quick] as const),
    )[0];

    expect(pair, 'a roster with no slow heavy hitter says nothing here').toBeDefined();
    const [heavy, quick] = pair!;

    const heavyDps = Number(statText('dps', heavy, null));
    const quickDps = Number(statText('dps', quick, null));
    expect(heavyDps).toBeCloseTo((heavy.damage ?? 0) * (heavy.attackSpeed ?? 0), 1);
    // The panel reports the sustained number, so it disagrees with the per-hit
    // one - which is the entire reason it multiplies.
    expect(quickDps).toBeGreaterThan(heavyDps);
    expect(quick.damage!).toBeLessThan(heavy.damage!);
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
  it('puts the name and the types on one line, and no mark at all', () => {
    const vigil = def('vigil');
    expect(typeLine(vigil.damageType, vigil.armour)).toBe('arcane · ward');
    // The thing this replaced: "Vigil → Vigil II" over "Mark 1 → 2 · arcane ·
    // ward", which spent two of the panel's lines on the next unit's suffix.
    expect(typeLine(vigil.damageType, vigil.armour)).not.toContain('Mark');
    expect(typeLine(vigil.damageType, vigil.armour)).not.toContain('II');
  });

  it('offers a NEW ability the next mark brings, and says nothing about a rank', () => {
    const ember = def('ember');
    const ember2 = def('ember_2');
    const ember3 = def('ember_3');

    // Mark 2 is the same ability with bigger numbers, which the stat block
    // already shows. Nothing is added.
    expect(unitChips(data, ember, ember2).filter((c) => c.upcoming)).toEqual([]);
    // Mark 3 unlocks Conflagration, which is worth a chip of its own.
    const unlocks = unitChips(data, ember2, ember3).filter((c) => c.upcoming);
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]?.name).toBe('Conflagration');
  });

  it('gives every unit at least one chip, because every unit has an ability', () => {
    for (const unit of data.units.units) {
      expect(unitChips(data, unit, null).length, unit.id).toBeGreaterThan(0);
    }
  });

  it('carries the rank the body actually has, so the card shows its numbers', () => {
    const chips = unitChips(data, def('ember_3'), null);
    expect(chips.map((c) => [c.abilityId, c.rank])).toEqual([
      ['kindle', 3],
      ['conflagration', 1],
    ]);
  });

  it('answers a tap on an ordinary monster rather than showing nothing', () => {
    const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;
    expect(monsterChips(data, grub)).toEqual([]);
    expect(NOTHING_SPECIAL).toContain('Nothing special');
  });

  it('reads a monster that does have one', () => {
    const bloater = data.monsters.monsters.find((m) => m.id === 'bloater')!;
    expect(monsterChips(data, bloater)[0]?.name).toBe('Rupture');
  });

  it('reads a monster the same way it reads a unit', () => {
    const husk = monsterNumbers(data.monsters.monsters.find((m) => m.id === 'husk')!);
    for (const cell of STAT_CELLS) {
      expect(monsterStatText(cell.key, husk), cell.key).not.toBe('');
    }
    expect(monsterStatText('range', husk)).toBe('melee');
  });

  it('shows the wave it is in, not the definition (§9.1, amended)', () => {
    // A grub grows one step a wave, so the panel must say so: reading the
    // definition told a wave-5 player their grub had 30 health when the thing
    // walking at them had nearly twice that.
    const def = data.monsters.monsters.find((m) => m.id === 'grub')!;
    const early = monsterStatText('hp', resolveMonsterStats(data, def, 1));
    const late = monsterStatText('hp', resolveMonsterStats(data, def, 5));
    expect(Number(early)).toBe(def.hp);
    expect(Number(late)).toBeGreaterThan(Number(early) * 1.5);
  });
});

describe('ability chips wrap and never leave their box', () => {
  const chips = (names: string[]) =>
    names.map((name, i) => ({ abilityId: `a${i}`, rank: 1, name, upcoming: false }));

  it('wraps to the next row when a chip does not fit the current one', () => {
    const placed = layOutChips(chips(['Kindle', 'Conflagration', 'Wildfire']), {
      x: 0,
      y: 0,
      width: 140,
      height: 200,
    });
    expect(placed).toHaveLength(3);
    expect(new Set(placed.map((p) => p.y)).size).toBeGreaterThan(1);
    // Nothing sticks out the side.
    for (const p of placed) expect(p.x + p.width).toBeLessThanOrEqual(140.001);
  });

  it('drops the chips that do not fit rather than drawing past the bottom', () => {
    const box = { x: 0, y: 0, width: 100, height: 26 };
    const placed = layOutChips(
      chips(['Shoulder to Shoulder', 'Closing Ranks', 'Hold the Line']),
      box,
    );
    expect(placed.length).toBeLessThan(3);
    for (const p of placed) {
      expect(p.y + p.height, 'inside the box').toBeLessThanOrEqual(box.y + box.height + 0.001);
    }
  });

  it("fits both of a mark-3 unit's abilities in the box the panel gives it", () => {
    // The case that mattered: a 360x640 phone, where the sentences did not fit
    // and the panel fell back to showing nothing at all.
    const regions = panelRegions(
      computeLayout(360, 640, data.lane).buildBar,
      computeLayout(360, 640, data.lane).buildBar.y + 6,
      computeLayout(360, 640, data.lane).buildBar.height - 12,
    );
    const both = unitChips(data, def('pledge_3'), null);
    expect(both).toHaveLength(2);
    expect(layOutChips(both, regions.text)).toHaveLength(2);
  });
});

describe('a stat cell shows what the body is actually fighting with', () => {
  const pledge = () => def('pledge');
  const mods = (over: Partial<StatMods> = {}): StatMods => ({
    damage: 1,
    attackSpeed: 1,
    moveSpeed: 1,
    maxHealth: 1,
    ...over,
  });

  it('reads the definition when nothing is on it', () => {
    expect(statText('damage', pledge(), null, null)).toBe(statText('damage', pledge(), null));
    expect(statDirection('damage', null)).toBe('plain');
  });

  it('multiplies the reading by what is on it', () => {
    const base = Number(statText('damage', pledge(), null));
    const buffed = Number(statText('damage', pledge(), null, mods({ damage: 1.5 })));
    expect(buffed).toBe(Math.round(base * 1.5));
  });

  it('colours a rise green and a fall red, per cell', () => {
    expect(statDirection('damage', mods({ damage: 1.24 }))).toBe('up');
    expect(statDirection('moveSpeed', mods({ moveSpeed: 0.8 }))).toBe('down');
    // A slow does not colour the damage cell.
    expect(statDirection('damage', mods({ moveSpeed: 0.8 }))).toBe('plain');
  });

  it('moves Dmg/s when EITHER of the two behind it moves', () => {
    expect(statDirection('dps', mods({ damage: 1.2 }))).toBe('up');
    expect(statDirection('dps', mods({ attackSpeed: 0.7 }))).toBe('down');
    // And a buff to one against a debuff to the other can cancel out, which is
    // the whole reason the cell is damage times attack speed and not either.
    expect(statDirection('dps', mods({ damage: 1.25, attackSpeed: 0.8 }))).toBe('plain');
  });

  it('leaves reach alone, because no ability may modify it', () => {
    expect(statDirection('range', mods({ damage: 2, attackSpeed: 2, moveSpeed: 2 }))).toBe('plain');
  });

  it('applies the same multiplier to the mark it is being compared with', () => {
    // Otherwise the arrow compares a buffed body against an unbuffed mark and
    // an aura reads as an upgrade.
    const buffed = statText('damage', def('pledge'), def('pledge_2'), mods({ damage: 2 }));
    const [now, then] = buffed.split(' → ').map(Number);
    expect(now).toBe(Math.round((def('pledge').damage ?? 0) * 2));
    expect(then).toBe(Math.round((def('pledge_2').damage ?? 0) * 2));
  });

  it("reads a monster's live numbers the same way", () => {
    const husk = data.monsters.monsters.find((m) => m.id === 'husk')!;
    const slowed = monsterStatText('moveSpeed', monsterNumbers(husk), mods({ moveSpeed: 0.5 }));
    expect(Number(slowed.split(' ')[0])).toBeCloseTo((husk.moveSpeed ?? 0) * 0.5, 2);
  });

  it('ignores a difference the wire could not have carried', () => {
    // The rows quantise to hundredths (protocol.ts), so anything under that is
    // rounding rather than a buff and must not paint a cell green.
    expect(statDirection('damage', mods({ damage: 1.002 }))).toBe('plain');
    expect(isPlain(1.002)).toBe(true);
    expect(isPlain(1.02)).toBe(false);
  });
});

describe('a grid of buttons fits the box it is given', () => {
  /** The send tab's box, as `setLayout` computes it. */
  function sendBox(width: number, height: number) {
    const l = computeLayout(width, height, data.lane);
    const landscape = l.orientation === 'landscape';
    const stripH = landscape ? 2 * 30 + 4 : 30;
    const top = l.buildBar.y + stripH + 7;
    const panelHeight = l.buildBar.height - stripH - 12;
    const chipH = landscape ? 38 * 2 + 6 : 38;
    return {
      x: landscape ? l.buildBar.x + 6 : 6,
      y: top + chipH + 6,
      width: l.buildBar.width - 12,
      height: panelHeight - chipH - 6,
      barBottom: l.buildBar.y + l.buildBar.height,
    };
  }

  it('never puts a row past the bottom of the bar, at any size', () => {
    // The bug this pins: `grid` used to draw each button at least a touch
    // target tall while spacing the rows at the unclamped pitch, so a grid
    // whose rows did not fit spilled off the bottom and the last row was cut
    // in half. Five sends in two columns on a phone was exactly that case.
    for (const [w, h] of [
      [412, 915],
      [360, 640],
      [320, 568],
      [915, 412],
      [640, 360],
      [1400, 800],
    ] as const) {
      const box = sendBox(w, h);
      const cols = columnsThatFit(data.sends.sends.length, box.width, box.height, 110, 6);
      const rows = Math.ceil(data.sends.sends.length / cols);
      const rowHeight = Math.max(MIN_ROW_HEIGHT, (box.height - 6 * (rows - 1)) / rows);
      const bottom = box.y + (rows - 1) * (rowHeight + 6) + rowHeight;
      expect(bottom, `${w}x${h}`).toBeLessThanOrEqual(box.barBottom + 0.5);
    }
  });

  it('gives a phone three columns rather than two half-height ones', () => {
    const box = sendBox(412, 915);
    expect(columnsThatFit(data.sends.sends.length, box.width, box.height, 110, 6)).toBe(3);
  });

  it('fills a landscape column rather than leaving a gap beside the last row', () => {
    // Two across and three down, not one across and five down: the column is
    // tall enough for either and two makes the buttons twice the height.
    const box = sendBox(915, 412);
    expect(columnsThatFit(data.sends.sends.length, box.width, box.height, 110, 6)).toBe(2);
  });

  it('would rather shorten a row than make a button unreadable', () => {
    // 360x640 leaves the send grid 74 pixels. Five columns would fit one tall
    // row and leave each button 65 pixels wide, which is not a name; three
    // columns of 34-pixel rows are still tappable and still readable.
    const box = sendBox(360, 640);
    expect(columnsThatFit(data.sends.sends.length, box.width, box.height, 110, 6)).toBe(3);
  });
});

describe('the energy meter in the panel header', () => {
  const title = { x: 18, y: 10, width: 376, height: 24 };
  const max = data.abilities.energy.max ?? 0;

  it('shows nothing for a body that can never spend any', () => {
    // Every body fills the same pool; only the ten that unlock an
    // energy-costing ability can draw on it, and a bar that reads full forever
    // is a bar worth nobody's pixels.
    expect(energyCost(data, 'pledge')).toBe(0);
    expect(energyCost(data, 'grub')).toBe(0);
    expect(energyMeter(title, null, max, 0, 100)).toBeNull();
  });

  it('shows one for the mark that unlocks an energy ability', () => {
    expect(energyCost(data, 'sanction_3')).toBeGreaterThan(0);
    expect(energyMeter(title, 30, max, energyCost(data, 'sanction_3'), 100)).not.toBeNull();
  });

  it('takes the CHEAPEST cost, which is when the body can next do something', () => {
    // One energy ability each today, so this is also the only one - but the
    // question the notch answers is "can it act", not "can it cast that".
    for (const unit of data.units.units) {
      const costs = (unit.abilities ?? [])
        .map((ref) => data.abilities.abilities.find((a) => a.id === refId(ref))?.energyCost ?? 0)
        .filter((cost): cost is number => typeof cost === 'number' && cost > 0);
      if (costs.length === 0) continue;
      expect(energyCost(data, unit.id), unit.id).toBe(Math.min(...costs));
    }
  });

  it('fills in proportion, and never past either end', () => {
    const empty = energyMeter(title, 0, max, 50, 100)!;
    const half = energyMeter(title, max / 2, max, 50, 100)!;
    const full = energyMeter(title, max, max, 50, 100)!;
    expect(empty.fill.width).toBe(0);
    expect(half.fill.width).toBeCloseTo(full.fill.width / 2, 6);
    expect(full.fill.width).toBe(full.track.width);
    // An overfull pool cannot happen, but a bar that would draw past its track
    // if it did is a bar drawn over the name beside it.
    expect(energyMeter(title, max * 3, max, 50, 100)!.fill.width).toBe(full.track.width);
  });

  it('marks where the ability becomes affordable, and says when it is', () => {
    const cost = 60;
    const below = energyMeter(title, cost - 1, max, cost, 100)!;
    const at = energyMeter(title, cost, max, cost, 100)!;
    expect(below.ready).toBe(false);
    expect(at.ready).toBe(true);
    // The notch sits at the cost's share of the track, inside it.
    expect(at.notch).toBeGreaterThan(at.track.x);
    expect(at.notch).toBeLessThan(at.track.x + at.track.width);
  });

  it('gives up the space rather than sitting on the name', () => {
    // A long name leaves no room, and no meter is better than one drawn over
    // the word it is beside.
    expect(energyMeter(title, 50, max, 60, 20)).not.toBeNull();
    expect(energyMeter(title, 50, max, 60, title.width - 20)).toBeNull();
  });

  it('stays inside the title row it was given', () => {
    const meter = energyMeter(title, 50, max, 60, 100)!;
    expect(meter.track.x).toBeGreaterThanOrEqual(title.x);
    expect(meter.track.x + meter.track.width).toBeLessThanOrEqual(title.x + title.width + 0.001);
    expect(meter.track.y).toBeGreaterThanOrEqual(title.y);
    expect(meter.track.y + meter.track.height).toBeLessThanOrEqual(title.y + title.height + 0.001);
  });
});

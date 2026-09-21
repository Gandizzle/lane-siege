import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from './loadNode.ts';
import { SHAPE_FAMILY } from './schema.ts';
import type { GameData } from './schema.ts';
import { validateData } from './validate.ts';
import { buildableUnits, isRanged, isTank, rosterRows } from './roster.ts';

describe('data/', () => {
  const { data, report } = loadDataFromDisk();

  it('parses every file', () => {
    expect(Object.keys(data).sort()).toEqual([
      'abilities',
      'economy',
      'fortress',
      'lane',
      'matrix',
      'monsters',
      'sends',
      'units',
      'waves',
    ]);
  });

  it('has no structural errors', () => {
    // Missing values are expected while the game is unbalanced; broken
    // invariants are not.
    expect(report.errors).toEqual([]);
  });

  it('holds a complete damage matrix', () => {
    expect(report.missing.filter((p) => p.startsWith('matrix'))).toEqual([]);
  });
});

/**
 * §14.2, amended: every body on the field has its own silhouette, and it is
 * in its armour type's family. The validator enforces this on load; these say
 * it out loud, and prove the validator actually bites.
 */
describe('silhouettes', () => {
  const { data } = loadDataFromDisk();
  const monsters = [...data.monsters.monsters, ...data.monsters.bosses];
  const bases = data.units.units.filter((u) => u.mark === 1);

  it('gives every body on the field its own', () => {
    const shapes = [...bases, ...monsters].map((b) => b.shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('keeps each in its armour family, so the counter-read survives', () => {
    for (const body of [...data.units.units, ...monsters]) {
      expect(SHAPE_FAMILY[body.shape], body.id).toBe(body.armour);
    }
  });

  it('carries a shape up its whole upgrade chain (§7.3)', () => {
    const byId = new Map(data.units.units.map((u) => [u.id, u]));
    for (const unit of data.units.units) {
      if (!unit.upgradesTo) continue;
      expect(byId.get(unit.upgradesTo)?.shape, unit.id).toBe(unit.shape);
    }
  });

  it('is refused by the validator when two bodies share one', () => {
    const copy = structuredClone(data) as GameData;
    const [a, b] = copy.units.units.filter((u) => u.mark === 1);
    b!.shape = a!.shape;
    // The mark above it must move with it, or that is the error reported.
    for (const u of copy.units.units) if (u.id.startsWith(`${b!.id}_`)) u.shape = a!.shape;

    const { report } = validateData(copy as unknown as Record<string, unknown>);
    expect(report.errors.some((e) => e.includes(a!.id) && e.includes(b!.id))).toBe(true);
  });

  it('is refused by the validator when a shape is in the wrong family', () => {
    const copy = structuredClone(data) as GameData;
    const grub = copy.monsters.monsters.find((m) => m.id === 'grub')!;
    grub.shape = 'hexagon';
    const { report } = validateData(copy as unknown as Record<string, unknown>);
    expect(report.errors.some((e) => e.includes('grub') && e.includes('plate'))).toBe(true);
  });
});

/**
 * Rung is which of a builder's six lines a unit is, 1 to 6; mark is how far up
 * its own chain. Both are read by things that would not notice a wrong answer -
 * the price bands in docs/BALANCE.md, and the showdown harness, which composes a
 * roster by asking for a share of each rung. A roster missing a rung would
 * silently never build one.
 */
describe('rungs and marks', () => {
  const { data } = loadDataFromDisk();

  it('gives every complete builder six lines numbered 1 to 6', () => {
    for (const builder of data.units.builders) {
      if (!builder.complete) continue;
      const rungs = data.units.units
        .filter((u) => u.builderId === builder.id && u.mark === 1)
        .map((u) => u.rung)
        .sort((a, b) => a - b);
      expect(rungs, builder.id).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('carries a rung up the whole upgrade chain', () => {
    const byId = new Map(data.units.units.map((u) => [u.id, u]));
    for (const unit of data.units.units) {
      if (!unit.upgradesTo) continue;
      expect(byId.get(unit.upgradesTo)?.rung, unit.id).toBe(unit.rung);
    }
  });

  it('numbers marks 1, 2, 3 up each chain and stops there', () => {
    const byId = new Map(data.units.units.map((u) => [u.id, u]));
    const roots = data.units.units.filter(
      (u) => !data.units.units.some((o) => o.upgradesTo === u.id),
    );
    for (const root of roots) {
      let expected = 1;
      let current: typeof root | undefined = root;
      while (current) {
        expect(current.mark, current.id).toBe(expected);
        expected += 1;
        current = current.upgradesTo ? byId.get(current.upgradesTo) : undefined;
      }
      expect(expected - 1, `${root.id} chain length`).toBeGreaterThanOrEqual(2);
    }
  });

  it('is refused by the validator when a mark changes rung', () => {
    const copy = structuredClone(data) as GameData;
    copy.units.units.find((u) => u.id === 'pledge_2')!.rung = 4;
    const { report } = validateData(copy as unknown as Record<string, unknown>);
    expect(report.errors.some((e) => e.includes('pledge_2') && e.includes('rung'))).toBe(true);
  });

  it('is refused by the validator when a roster skips a rung', () => {
    const copy = structuredClone(data) as GameData;
    for (const u of copy.units.units) if (u.builderId === 'pyre' && u.rung === 4) u.rung = 3;
    const { report } = validateData(copy as unknown as Record<string, unknown>);
    expect(report.errors.some((e) => e.includes('pyre') && e.includes('rung'))).toBe(true);
  });
});

/**
 * The build bar draws a builder's six lines as two rows of three: rungs 1 to 3
 * above, 4 to 6 below. Each row is a half of the ladder a player might be
 * buying from, so each row has to be a roster in miniature.
 */
describe('the two rows of three', () => {
  const { data } = loadDataFromDisk();

  it('orders the roster by rung, which is what the rows mean', () => {
    for (const builder of data.units.builders) {
      const rungs = buildableUnits(data, builder.id).map((u) => u.rung);
      expect(rungs, builder.id).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('splits into two rows of three', () => {
    for (const builder of data.units.builders) {
      const rows = rosterRows(data, builder.id);
      expect(
        rows.map((r) => r.length),
        builder.id,
      ).toEqual([3, 3]);
      expect(rows[0]!.map((u) => u.rung)).toEqual([1, 2, 3]);
      expect(rows[1]!.map((u) => u.rung)).toEqual([4, 5, 6]);
    }
  });

  it('gives every row a tank and something with reach', () => {
    for (const builder of data.units.builders) {
      if (!builder.complete) continue;
      for (const row of rosterRows(data, builder.id)) {
        const where = `${builder.id} rungs ${row.map((u) => u.rung).join('')}`;
        expect(row.some(isTank), `${where} has no tank`).toBe(true);
        expect(row.some(isRanged), `${where} has nothing with reach`).toBe(true);
      }
    }
  });

  it('reads the roles off the numbers, not off a label', () => {
    // A tank is melee and mostly hit points; a gun is neither. The point of
    // deriving it is that a unit cannot be restatted out of the job it was
    // counted for and still be counted for it.
    const oathwall = data.units.units.find((u) => u.id === 'oathwall')!;
    const judgement = data.units.units.find((u) => u.id === 'judgement')!;
    expect(isTank(oathwall)).toBe(true);
    expect(isRanged(oathwall)).toBe(false);
    expect(isTank(judgement)).toBe(false);
    expect(isRanged(judgement)).toBe(true);

    const glassy = { ...oathwall, hp: 1 };
    expect(isTank(glassy), 'a wall with no wall left is not a tank').toBe(false);
  });

  it('is refused by the validator when a row loses its tank', () => {
    const copy = structuredClone(data) as GameData;
    // Give Ironvow's rung 1 a gun's profile and its top row has no front line.
    for (const u of copy.units.units) {
      if (u.builderId === 'ironvow' && u.rung === 1) {
        u.range = 4;
        u.hp = 10;
      }
    }
    const { report } = validateData(copy as unknown as Record<string, unknown>);
    expect(report.errors.some((e) => e.includes('ironvow') && e.includes('no tank'))).toBe(true);
  });

  it('is refused by the validator when a row loses its reach', () => {
    const copy = structuredClone(data) as GameData;
    for (const u of copy.units.units) {
      if (u.builderId === 'pyre' && u.rung >= 4) u.range = 0.1;
    }
    const { report } = validateData(copy as unknown as Record<string, unknown>);
    expect(report.errors.some((e) => e.includes('pyre') && e.includes('reach'))).toBe(true);
  });
});

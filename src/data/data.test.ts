import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from './loadNode.ts';
import { SHAPE_FAMILY } from './schema.ts';
import type { GameData } from './schema.ts';
import { validateData } from './validate.ts';

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
  const bases = data.units.units.filter((u) => u.tier === 1);

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
    const [a, b] = copy.units.units.filter((u) => u.tier === 1);
    b!.shape = a!.shape;
    // The tier above it must move with it, or that is the error reported.
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

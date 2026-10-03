/**
 * Battlefield backgrounds (battlefield.ts): which there are, which may be
 * chosen, and that each one is painted - inside the area it is given, and the
 * same every time - and that Molten's plates tile the ground they cut up.
 */

import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  BATTLEFIELD_IDS,
  battlefieldInUse,
  battlefieldName,
  battlefieldNote,
  gridAlpha,
  GroundView,
  isTextured,
  unlockedBattlefields,
  voronoiCells,
  type BattlefieldId,
} from './battlefield.ts';

const AREA = { x: 40, y: 20, width: 8 * 48, height: 14 * 48 };
const SECOND = { x: 40 + 8 * 48, y: 20, width: 5 * 48, height: 3 * 48 };

function painted(id: BattlefieldId, areas = [AREA]): GroundView {
  const view = new GroundView();
  view.paint(id, areas, 48);
  return view;
}

function instructions(view: GroundView): number {
  return (view.children as Graphics[]).reduce((n, g) => n + g.context.instructions.length, 0);
}

/** Every layer that drew anything drew it inside `area` (an empty layer has no bounds). */
function within(view: GroundView, area: typeof AREA, id: string): void {
  for (const g of view.children as Graphics[]) {
    if (g.context.instructions.length === 0) continue;
    const b = g.bounds;
    expect(b.minX, id).toBeGreaterThanOrEqual(area.x - 1);
    expect(b.minY, id).toBeGreaterThanOrEqual(area.y - 1);
    expect(b.maxX, id).toBeLessThanOrEqual(area.x + area.width + 1);
    expect(b.maxY, id).toBeLessThanOrEqual(area.y + area.height + 1);
  }
}

describe('battlefields', () => {
  it('offers the plain ground and four painted ones, every one open for now', () => {
    expect(BATTLEFIELD_IDS[0]).toBe('plain');
    expect(BATTLEFIELD_IDS.filter(isTextured)).toHaveLength(4);
    expect(unlockedBattlefields()).toEqual(BATTLEFIELD_IDS);
    for (const id of BATTLEFIELD_IDS) {
      expect(battlefieldName(id)).not.toBe('');
      expect(battlefieldNote(id)).not.toBe('');
    }
  });

  it('draws the chosen one when it is open, and the plain ground when it is not', () => {
    for (const id of unlockedBattlefields()) expect(battlefieldInUse(id)).toBe(id);
    expect(battlefieldInUse('nowhere' as never)).toBe('plain');
  });

  it('paints nothing for the plain ground, and every painted one inside its area', () => {
    expect(instructions(painted('plain'))).toBe(0);
    for (const id of BATTLEFIELD_IDS.filter(isTextured)) {
      const view = painted(id);
      expect(instructions(view), id).toBeGreaterThan(0);
      // Whole details only: nothing spills past the edge, so nothing needs a mask.
      within(view, AREA, id);
    }
  });

  it('keeps every frame of the moving ground inside its area too', () => {
    const view = painted('molten');
    expect(view.animated).toBe(true);
    for (let t = 0; t < 20; t += 0.37) {
      view.animate(t);
      within(view, AREA, `molten at ${t.toFixed(2)}s`);
    }
  });

  it('only moves the ground that moves', () => {
    for (const id of BATTLEFIELD_IDS) expect(painted(id).animated, id).toBe(id === 'molten');
  });

  it('paints the same ground every time, and two areas side by side differently', () => {
    const shapes = (view: GroundView) =>
      JSON.stringify(
        (view.children as Graphics[]).map((g) => [
          g.context.instructions.map((i) => i.action),
          g.context.instructions.length > 0 ? g.bounds : null,
        ]),
      );
    for (const id of BATTLEFIELD_IDS.filter(isTextured)) {
      expect(shapes(painted(id)), id).toBe(shapes(painted(id)));
      // The second area gets its own seed: more shapes than one area alone,
      // and not the first area's shapes again.
      expect(instructions(painted(id, [AREA, SECOND])), id).toBeGreaterThan(
        instructions(painted(id)),
      );
    }
  });

  it('keeps the build grid stronger over a painted ground than over the plain one', () => {
    for (const id of BATTLEFIELD_IDS.filter(isTextured)) {
      expect(gridAlpha(id)).toBeGreaterThan(gridAlpha('plain'));
    }
  });
});

describe("Molten's plates", () => {
  const bounds = { x: 0, y: 0, width: 300, height: 200 };
  const sites = [
    { x: 40, y: 50 },
    { x: 150, y: 30 },
    { x: 260, y: 60 },
    { x: 70, y: 160 },
    { x: 180, y: 130 },
    { x: 270, y: 170 },
  ];
  const cells = voronoiCells(sites, bounds, 1000);
  const area = (poly: { x: number; y: number }[]) =>
    Math.abs(
      poly.reduce((sum, a, k) => {
        const b = poly[(k + 1) % poly.length]!;
        return sum + a.x * b.y - b.x * a.y;
      }, 0) / 2,
    );

  it('cut the ground into cells that cover it exactly', () => {
    const total = cells.reduce((sum, cell) => sum + area(cell), 0);
    expect(total).toBeCloseTo(bounds.width * bounds.height, 3);
  });

  it('give each site the cell around it', () => {
    cells.forEach((cell, i) => {
      // Every corner is no nearer another site than this one.
      for (const corner of cell) {
        const own = Math.hypot(corner.x - sites[i]!.x, corner.y - sites[i]!.y);
        for (const other of sites) {
          expect(Math.hypot(corner.x - other.x, corner.y - other.y)).toBeGreaterThan(own - 1e-6);
        }
      }
    });
  });

  it('name the neighbour across every shared edge, both ways', () => {
    cells.forEach((cell, i) => {
      for (const corner of cell) {
        if (corner.by < 0) continue;
        expect(cells[corner.by]!.some((c) => c.by === i)).toBe(true);
      }
    });
  });
});

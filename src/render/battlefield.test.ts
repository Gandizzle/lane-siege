/**
 * Battlefield backgrounds (battlefield.ts): which there are, which may be
 * chosen, and that each one is painted - inside the area it is given, and the
 * same every time.
 */

import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  BATTLEFIELD_IDS,
  battlefieldInUse,
  battlefieldName,
  gridAlpha,
  isTextured,
  paintGround,
  unlockedBattlefields,
} from './battlefield.ts';

const AREA = { x: 40, y: 20, width: 8 * 48, height: 14 * 48 };

function painted(id: (typeof BATTLEFIELD_IDS)[number], seed = 1): Graphics {
  const g = new Graphics();
  paintGround(g, id, AREA, 48, seed);
  return g;
}

describe('battlefields', () => {
  it('offers the plain ground and three painted ones, every one open for now', () => {
    expect(BATTLEFIELD_IDS[0]).toBe('plain');
    expect(BATTLEFIELD_IDS.filter(isTextured)).toHaveLength(3);
    expect(unlockedBattlefields()).toEqual(BATTLEFIELD_IDS);
    for (const id of BATTLEFIELD_IDS) expect(battlefieldName(id)).not.toBe('');
  });

  it('draws the chosen one when it is open, and the plain ground when it is not', () => {
    for (const id of unlockedBattlefields()) expect(battlefieldInUse(id)).toBe(id);
    expect(battlefieldInUse('nowhere' as never)).toBe('plain');
  });

  it('paints nothing for the plain ground, and every painted one inside its area', () => {
    expect(painted('plain').context.instructions).toHaveLength(0);
    for (const id of BATTLEFIELD_IDS.filter(isTextured)) {
      const b = painted(id).bounds;
      expect(painted(id).context.instructions.length, id).toBeGreaterThan(0);
      // Whole details only: nothing spills past the edge, so nothing needs a mask.
      expect(b.minX, id).toBeGreaterThanOrEqual(AREA.x - 1);
      expect(b.minY, id).toBeGreaterThanOrEqual(AREA.y - 1);
      expect(b.maxX, id).toBeLessThanOrEqual(AREA.x + AREA.width + 1);
      expect(b.maxY, id).toBeLessThanOrEqual(AREA.y + AREA.height + 1);
    }
  });

  it('paints the same ground every time from the same seed', () => {
    for (const id of BATTLEFIELD_IDS.filter(isTextured)) {
      const shapes = (g: Graphics) => JSON.stringify(g.context.instructions.map((i) => i.action));
      expect(shapes(painted(id, 7)), id).toBe(shapes(painted(id, 7)));
    }
  });

  it('keeps the build grid stronger over a painted ground than over the plain one', () => {
    for (const id of BATTLEFIELD_IDS.filter(isTextured)) {
      expect(gridAlpha(id)).toBeGreaterThan(gridAlpha('plain'));
    }
  });
});

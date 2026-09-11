import { describe, expect, it } from 'vitest';
import { computeLayout, screenToTile, tileToScreen } from './layout.ts';
import type { LaneFile } from '../data/schema.ts';

const lane: LaneFile = {
  buildZone: { width: 8, depth: 10 },
  spawnZoneDepth: 1,
  fortressZoneDepth: 1,
  unitsBlockMovement: null,
  unitRadius: 0.34,
  monsterRadius: 0.3,
};

describe('portrait layout (DESIGN.md §4.1)', () => {
  it('fits the whole lane on one screen, in order', () => {
    const l = computeLayout(400, 900, lane);
    expect(l.tabs.y).toBe(0);
    expect(l.spawn.y).toBeGreaterThanOrEqual(l.tabs.y + l.tabs.height - 0.001);
    expect(l.build.y).toBeGreaterThanOrEqual(l.spawn.y + l.spawn.height - 0.001);
    expect(l.fortress.y).toBeGreaterThanOrEqual(l.build.y + l.build.height - 0.001);
    expect(l.buildBar.y + l.buildBar.height).toBeCloseTo(900, 6);
  });

  it('keeps tiles square and inside the build band', () => {
    const l = computeLayout(400, 900, lane);
    expect(l.tileSize * l.grid.width).toBeLessThanOrEqual(l.build.width + 0.001);
    expect(l.tileSize * l.grid.depth).toBeLessThanOrEqual(l.build.height + 0.001);
  });

  it('round-trips tile <-> screen', () => {
    const l = computeLayout(400, 900, lane);
    const centre = tileToScreen(l, 3, 4);
    const back = screenToTile(l, centre.x + l.tileSize / 2, centre.y + l.tileSize / 2);
    expect(back).toEqual({ tileX: 3, tileY: 4 });
  });

  it('rejects taps outside the grid', () => {
    const l = computeLayout(400, 900, lane);
    expect(screenToTile(l, 0, 0)).toBeNull();
    expect(screenToTile(l, 399, 899)).toBeNull();
  });
});

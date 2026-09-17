import { describe, expect, it } from 'vitest';
import { computeLayout, screenToTile, tileToScreen } from './layout.ts';
import type { LaneFile } from '../data/schema.ts';
import type { Rect } from './layout.ts';

const lane: LaneFile = {
  buildZone: { width: 8, depth: 10 },
  spawnZoneDepth: 3,
  fortressZoneDepth: 1,
  fortressRadius: 0.45,
  fortressHalfWidth: 3.55,
  monsterAcquireRange: 3,
  unitsBlockMovement: null,
  pathSubdivision: 5,
};

/** Every area the layout hands out, so overlap can be asked about as a set. */
function areas(l: ReturnType<typeof computeLayout>) {
  return { hud: l.tabs, lane: l.lane, bar: l.buildBar };
}

/** Do two rectangles share any pixels? */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

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

describe('landscape layout: the same three areas, in columns', () => {
  const wide = () => computeLayout(915, 412, lane);

  it('knows which way round it is', () => {
    expect(wide().orientation).toBe('landscape');
    expect(computeLayout(400, 900, lane).orientation).toBe('portrait');
    // A tie goes to portrait: the stacked arrangement is the one the game was
    // designed around, and a square screen has to be called something.
    expect(computeLayout(600, 600, lane).orientation).toBe('portrait');
  });

  it('puts the HUD left, the lane in the middle and the build bar right', () => {
    const l = wide();
    expect(l.tabs.x).toBe(0);
    expect(l.lane.x).toBeGreaterThanOrEqual(l.tabs.x + l.tabs.width - 0.001);
    expect(l.buildBar.x).toBeGreaterThanOrEqual(l.lane.x + l.lane.width - 0.001);
    expect(l.buildBar.x + l.buildBar.width).toBeCloseTo(915, 6);
  });

  it('gives all three the full height', () => {
    const l = wide();
    for (const area of Object.values(areas(l))) {
      expect(area.y).toBe(0);
      expect(area.height).toBeCloseTo(412, 6);
    }
  });

  it('never lets two areas share a pixel, either way round', () => {
    for (const [w, h] of [
      [915, 412],
      [412, 915],
      [640, 360],
      [360, 640],
      [1400, 800],
    ] as const) {
      const a = areas(computeLayout(w, h, lane));
      expect(overlaps(a.hud, a.lane), `${w}x${h} hud/lane`).toBe(false);
      expect(overlaps(a.lane, a.bar), `${w}x${h} lane/bar`).toBe(false);
      expect(overlaps(a.hud, a.bar), `${w}x${h} hud/bar`).toBe(false);
    }
  });

  it('keeps the opponent tabs inside the HUD', () => {
    for (const [w, h] of [
      [915, 412],
      [412, 915],
      [640, 360],
    ] as const) {
      const l = computeLayout(w, h, lane);
      expect(l.tabStrip.x).toBeGreaterThanOrEqual(l.tabs.x - 0.001);
      expect(l.tabStrip.x + l.tabStrip.width).toBeLessThanOrEqual(l.tabs.x + l.tabs.width + 0.001);
      expect(l.tabStrip.y).toBeGreaterThanOrEqual(l.tabs.y - 0.001);
      expect(l.tabStrip.y + l.tabStrip.height).toBeLessThanOrEqual(
        l.tabs.y + l.tabs.height + 0.001,
      );
    }
  });

  it('draws the same lane, whole and square, in both', () => {
    for (const [w, h] of [
      [915, 412],
      [412, 915],
      [640, 360],
    ] as const) {
      const l = computeLayout(w, h, lane);
      const tilesDeep = lane.spawnZoneDepth + lane.buildZone.depth + lane.fortressZoneDepth;
      // Inside its own column, on both axes.
      expect(l.tileSize * l.grid.width).toBeLessThanOrEqual(l.lane.width + 0.001);
      expect(l.tileSize * tilesDeep).toBeLessThanOrEqual(l.lane.height + 0.001);
      // And the zone bands span that column rather than the screen.
      for (const band of [l.spawn, l.build, l.fortress]) {
        expect(band.x).toBeCloseTo(l.lane.x, 6);
        expect(band.width).toBeCloseTo(l.lane.width, 6);
      }
    }
  });

  it('uses the height for the lane, which is what a short screen has less of', () => {
    // Sideways the lane is fitted to the full height rather than to the third
    // of it a stacked layout would leave.
    const stacked = computeLayout(412, 915, lane);
    const columns = computeLayout(915, 412, lane);
    const tilesDeep = lane.spawnZoneDepth + lane.buildZone.depth + lane.fortressZoneDepth;
    expect(columns.tileSize).toBeCloseTo(412 / tilesDeep, 6);
    // Still smaller than upright, because 412 is less than 915 minus two bands.
    expect(columns.tileSize).toBeLessThan(stacked.tileSize);
  });

  it('round-trips tile <-> screen sideways too', () => {
    const l = wide();
    const centre = tileToScreen(l, 5, 2);
    const back = screenToTile(l, centre.x + l.tileSize / 2, centre.y + l.tileSize / 2);
    expect(back).toEqual({ tileX: 5, tileY: 2 });
  });

  it('asks the front screens to compact themselves only when short', () => {
    expect(computeLayout(915, 412, lane).compact).toBe(true);
    expect(computeLayout(412, 915, lane).compact).toBe(false);
    expect(computeLayout(1400, 800, lane).compact).toBe(false);
  });
});

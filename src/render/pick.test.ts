/**
 * Pointing at a body. See `bodyAt` and `screenToTilePoint` in layout.ts.
 *
 * The rule these guard is §14.2's: a body is one circle - collision shape, hit
 * shape and drawn size at once - so the thing you tap is that circle. It used
 * to be the tile the unit was standing mostly inside, which pointed at the
 * wrong thing twice: at nothing when a unit had advanced off its tile, and at a
 * unit when the tap was on an empty corner of its tile.
 */

import { describe, expect, it } from 'vitest';
import { bodyAt, computeLayout, screenToTilePoint, tileToScreen } from './layout.ts';
import { loadDataFromDisk } from '../data/loadNode.ts';

const { data } = loadDataFromDisk();
const layout = computeLayout(412, 915, data.lane);

/** Three units in a row, half a tile apart, as a packed line is. */
const LINE = [
  { id: 1, x: 2.5, y: 4.5, radius: 0.26 },
  { id: 2, x: 3.5, y: 4.5, radius: 0.26 },
  { id: 3, x: 3.9, y: 4.5, radius: 0.26 },
];

describe('picking a body out of the lane', () => {
  it('takes the one whose circle covers the point', () => {
    expect(bodyAt(LINE, 2.5, 4.5)?.id).toBe(1);
    expect(bodyAt(LINE, 3.5, 4.4)?.id).toBe(2);
  });

  it('takes nothing when the point is inside the tile but outside every body', () => {
    // The corner of unit 1's tile: well inside the square it used to be
    // selected by, and nowhere near the unit.
    expect(bodyAt(LINE, 2.05, 4.05)).toBeNull();
  });

  it('takes a body that has walked off its own tile', () => {
    // A unit built on (2, 4) that has advanced most of a tile. The tile rule
    // would look for it on (2, 3) and find nothing there.
    const advanced = [{ id: 9, x: 2.5, y: 3.9, radius: 0.3 }];
    expect(bodyAt(advanced, 2.5, 3.9)?.id).toBe(9);
  });

  it('takes the nearer of two circles that overlap the point', () => {
    // Units 2 and 3 are 0.4 apart with 0.26 radii, so they overlap. A point
    // between them is inside both.
    expect(bodyAt(LINE, 3.75, 4.5)?.id).toBe(3);
    expect(bodyAt(LINE, 3.65, 4.5)?.id).toBe(2);
  });

  it('stops exactly at the edge of the circle', () => {
    const one = [{ id: 1, x: 2.5, y: 4.5, radius: 0.26 }];
    expect(bodyAt(one, 2.5 + 0.259, 4.5)).not.toBeNull();
    expect(bodyAt(one, 2.5 + 0.261, 4.5)).toBeNull();
  });

  it('finds nothing in an empty lane', () => {
    expect(bodyAt([], 4, 4)).toBeNull();
  });
});

describe('screen pixels to a point in the lane', () => {
  it('is the inverse of the tile transform', () => {
    const screen = tileToScreen(layout, 3.25, 6.75);
    const back = screenToTilePoint(layout, screen.x, screen.y);
    expect(back.x).toBeCloseTo(3.25);
    expect(back.y).toBeCloseTo(6.75);
  });

  it('keeps the fraction, which is the whole point of it', () => {
    // `screenToTile` floors to a tile index; this one does not, because a body
    // does not stand on a tile index.
    const screen = tileToScreen(layout, 2.5, 5.5);
    expect(screenToTilePoint(layout, screen.x, screen.y).x % 1).toBeCloseTo(0.5);
  });

  it('reads the spawn zone above the grid as negative, as the simulation does', () => {
    const screen = tileToScreen(layout, 4, -1.5);
    expect(screenToTilePoint(layout, screen.x, screen.y).y).toBeCloseTo(-1.5);
  });
});

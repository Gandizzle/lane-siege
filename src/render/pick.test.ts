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
import {
  TOUCH_SLACK_PX,
  bodyNear,
  computeLayout,
  screenToTilePoint,
  tileToScreen,
} from './layout.ts';
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
    expect(bodyNear(LINE, 2.5, 4.5)?.id).toBe(1);
    expect(bodyNear(LINE, 3.5, 4.4)?.id).toBe(2);
  });

  it('takes nothing when the point is well outside every body', () => {
    // The corner of unit 1's tile: well inside the square it used to be
    // selected by, and a long way from the unit even with slack allowed.
    expect(bodyNear(LINE, 2.05, 4.05)).toBeNull();
    expect(bodyNear(LINE, 2.05, 4.05, 0.3)).toBeNull();
  });

  it('takes a body that has walked off its own tile', () => {
    // A unit built on (2, 4) that has advanced most of a tile. The tile rule
    // would look for it on (2, 3) and find nothing there.
    const advanced = [{ id: 9, x: 2.5, y: 3.9, radius: 0.3 }];
    expect(bodyNear(advanced, 2.5, 3.9)?.id).toBe(9);
  });

  it('takes the nearer of two circles that overlap the point', () => {
    // Units 2 and 3 are 0.4 apart with 0.26 radii, so they overlap. A point
    // between them is inside both.
    expect(bodyNear(LINE, 3.75, 4.5)?.id).toBe(3);
    expect(bodyNear(LINE, 3.65, 4.5)?.id).toBe(2);
  });

  it('stops exactly at the edge of the circle when nothing is allowed', () => {
    const one = [{ id: 1, x: 2.5, y: 4.5, radius: 0.26 }];
    expect(bodyNear(one, 2.5 + 0.259, 4.5)).not.toBeNull();
    expect(bodyNear(one, 2.5 + 0.261, 4.5)).toBeNull();
  });

  it('reaches `slack` past the edge, and no further', () => {
    const one = [{ id: 1, x: 2.5, y: 4.5, radius: 0.26 }];
    expect(bodyNear(one, 2.5 + 0.45, 4.5, 0.2)).not.toBeNull();
    expect(bodyNear(one, 2.5 + 0.47, 4.5, 0.2)).toBeNull();
  });

  it('takes the nearer body when the slack reaches two of them', () => {
    const pair = [
      { id: 1, x: 2.5, y: 4.5, radius: 0.26 },
      { id: 2, x: 3.5, y: 4.5, radius: 0.26 },
    ];
    expect(bodyNear(pair, 2.9, 4.5, 0.3)?.id).toBe(1);
    expect(bodyNear(pair, 3.1, 4.5, 0.3)?.id).toBe(2);
  });

  it('finds nothing in an empty lane', () => {
    expect(bodyNear([], 4, 4, 0.3)).toBeNull();
  });
});

describe('the touch allowance', () => {
  // The rule it must not break: placing a unit NEXT TO a line is most of what
  // the build phase is, and a tap at the centre of an empty tile beside an
  // occupied one has to reach the tile, not the neighbour.
  const slack = TOUCH_SLACK_PX / layout.tileSize;

  it('leaves the next tile along free to build on', () => {
    const one = [{ id: 1, x: 2.5, y: 4.5, radius: 0.26 }];
    expect(bodyNear(one, 3.5, 4.5, slack)).toBeNull();
    expect(bodyNear(one, 2.5, 5.5, slack)).toBeNull();
    expect(bodyNear(one, 3.5, 5.5, slack)).toBeNull();
  });

  it('is big enough to be worth having, and smaller than a tile', () => {
    // A tier-1 unit is about a quarter-tile radius, which is a ~22px target on
    // a phone against the 44 a thumb wants. With the allowance it is near 44.
    const radius = 0.26 * layout.tileSize;
    expect((radius + TOUCH_SLACK_PX) * 2).toBeGreaterThan(38);
    // And the REACH stays under one tile, which is the invariant that keeps a
    // tap on the next tile along a placement rather than a selection.
    expect(radius + TOUCH_SLACK_PX).toBeLessThan(layout.tileSize);
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

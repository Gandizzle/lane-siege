/**
 * The Final Showdown arena. DESIGN.md §3.3, replaced.
 *
 * §3.3 ended a match with an attrition endgame: from wave 25 nothing could be
 * built, nothing respawned, and increasingly nasty waves ground the table down
 * until one player was left. That is a war of attrition against the clock and
 * it is decided by who happened to bank the most gold. The Final Showdown
 * decides it by putting the four armies in one place and letting them fight.
 *
 * THE SHAPE
 *
 * A cross. Four spokes of lane width meeting at a square centre:
 *
 *                 +--------+
 *                 |  north |          Each spoke is `spokeWidth` across - the
 *                 |  grid  |          same 8 as a lane - and `spokeLength`
 *                 |--------|          long: the player's whole 10-row build
 *        +--------+ appr.  +--------+ grid, plus `approachDepth` rows of open
 *        | grid   | CENTRE | grid   | ground ahead of it. The centre is the
 *        | west   |  8x8   | east   | square where the four spokes meet, which
 *        +--------+ appr.  +--------+ is spokeWidth on a side by construction.
 *                 |--------|
 *                 |  grid  |          The four corners of the bounding square
 *                 |  south |          are not part of the arena: `bounds.band`
 *                 +--------+          is what keeps bodies out of them.
 *
 * Every army starts where it was built. A unit standing on tile (3, 7) of its
 * owner's build grid stands on the same tile of that owner's spoke, so the line
 * a player spent twenty-five waves arranging is the line they take into the
 * showdown - and the row they built nearest their fortress is the row furthest
 * from the fight.
 *
 * SEATING is by the team's place in the match, not by who is still alive: lane
 * one always fights from the south spoke, lane two from the west, and so on
 * clockwise. A player who was eliminated during the waves simply leaves their
 * spoke empty, which is easier to read than a table that reshuffles.
 */

import type { GameData } from '../data/schema.ts';
import type { Bounds } from './motion.ts';
import type { Vec2 } from './types.ts';

/** Which spoke an army fights from, in seating order: clockwise from south. */
export const LEGS = ['south', 'west', 'north', 'east'] as const;
export type Leg = (typeof LEGS)[number];

export interface ArenaShape {
  /** Across a spoke, in tiles: the lane's own width. */
  spokeWidth: number;
  /** Along a spoke: the build grid plus the open ground ahead of it. */
  spokeLength: number;
  /** Rows of open ground between a player's grid and the centre. */
  approachDepth: number;
  /** The bounding square's side. Spoke, centre, spoke. */
  size: number;
  /** Where bodies may stand, corners excluded. */
  bounds: Bounds;
}

export function arenaShape(data: GameData): ArenaShape {
  const spokeWidth = data.lane.buildZone.width;
  const approachDepth = data.waves.showdown.approachDepth;
  const spokeLength = data.lane.buildZone.depth + approachDepth;
  const size = spokeLength * 2 + spokeWidth;

  return {
    spokeWidth,
    spokeLength,
    approachDepth,
    size,
    bounds: {
      minX: 0,
      maxX: size,
      minY: 0,
      maxY: size,
      // Inside this band on either axis is inside a spoke or the centre.
      // Outside it on both is a corner, and there is no arena there.
      band: { min: spokeLength, max: spokeLength + spokeWidth },
    },
  };
}

/** The middle of the arena, which is the middle of the centre square. */
export function arenaCentre(shape: ArenaShape): Vec2 {
  return { x: shape.size / 2, y: shape.size / 2 };
}

/**
 * Does the line between these two points leave the cross?
 *
 * The arena is a cross, and the four corners of its bounding square are not
 * arena at all - nothing stands there and nothing walks there. This asks
 * whether a shot from `a` to `b` would have to pass through one of them, which
 * is what "shooting across the void" means: a body at the back of the south
 * spoke drawing a bead on one at the back of the east spoke, through the gap
 * between them.
 *
 * WHY IT MATTERS. Without it the corners are transparent, and a long enough
 * gun covers two spokes from a standing start while nothing can walk to it -
 * so reach is worth far more than the price ladder charges for it, and the
 * back of your own spoke is the safest place in the game to put your whole
 * army. The first three round robins all said exactly that: rung 6 alone won
 * nine fights in ten.
 *
 * Liang-Barsky against each corner box, unrolled and allocation-free: this runs
 * once per candidate target per body per tick (§15.3). The two fast paths
 * carry most calls - two bodies both inside the vertical bar, or both inside
 * the horizontal one, are inside a convex rectangle and the segment between
 * them cannot leave it.
 */
export function crossesTheVoid(shape: ArenaShape, a: Vec2, b: Vec2): boolean {
  const band = shape.bounds.band;
  if (!band) return false;

  const { min, max } = band;
  // Both down the vertical bar, or both across the horizontal one. Either way
  // the segment stays inside one rectangle.
  if (a.x >= min && a.x <= max && b.x >= min && b.x <= max) return false;
  if (a.y >= min && a.y <= max && b.y >= min && b.y <= max) return false;

  const size = shape.size;
  return (
    hitsBox(a, b, 0, 0, min, min) ||
    hitsBox(a, b, max, 0, size, min) ||
    hitsBox(a, b, 0, max, min, size) ||
    hitsBox(a, b, max, max, size, size)
  );
}

/** The inverse, which is what a caller usually wants to say. */
export function hasLineOfSight(shape: ArenaShape, a: Vec2, b: Vec2): boolean {
  return !crossesTheVoid(shape, a, b);
}

/**
 * Liang-Barsky: does the segment a-b pass through the INTERIOR of this box?
 *
 * Interior rather than closed, so a shot that grazes a corner along its edge -
 * two bodies either side of the centre square, sighting down the line where
 * the arena stops - is not blocked by a box it never actually enters.
 */
function hitsBox(
  a: Vec2,
  b: Vec2,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;

  // Each edge as a half-plane: p * t <= q. p of zero is a segment parallel to
  // that edge, which either misses the slab entirely or tells us nothing.
  for (let edge = 0; edge < 4; edge++) {
    const p = edge === 0 ? -dx : edge === 1 ? dx : edge === 2 ? -dy : dy;
    const q =
      edge === 0 ? a.x - minX : edge === 1 ? maxX - a.x : edge === 2 ? a.y - minY : maxY - a.y;

    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t1 > t0;
}

/**
 * Whether a point is inside the centre square - the ground all four spokes
 * meet on, and the hill somebody holds (§3.3, replaced).
 *
 * The square is the band on BOTH axes, which is the same band the corners are
 * cut out with: inside it one way is a spoke, inside it both ways is the
 * middle. Measured on the body's centre rather than its circle, so a body half
 * in and half out is wherever its middle is and two players cannot both count
 * the same body by standing it on the line.
 */
export function inCentre(shape: ArenaShape, pos: Vec2): boolean {
  const band = shape.bounds.band;
  if (!band) return false;
  return pos.x >= band.min && pos.x <= band.max && pos.y >= band.min && pos.y <= band.max;
}

/**
 * Where a unit built on tile (tileX, tileY) of its lane stands in the arena.
 *
 * The south spoke is the layout written out: the player's grid at the bottom
 * with its far row - the one that faced the monsters - nearest the centre.
 * Every other spoke is that same layout turned a quarter turn clockwise, once
 * per seat, so all four armies are arranged identically with respect to their
 * own fight.
 */
export function legPosition(shape: ArenaShape, leg: Leg, tileX: number, tileY: number): Vec2 {
  const { spokeLength, spokeWidth, approachDepth } = shape;
  // The south spoke, in arena tiles: x across the spoke, y down its length,
  // with tileY 0 - the row that faced the spawn - closest to the centre.
  let x = spokeLength + tileX + 0.5;
  let y = spokeLength + spokeWidth + approachDepth + tileY + 0.5;

  const centre = shape.size / 2;
  for (let turn = LEGS.indexOf(leg); turn > 0; turn--) {
    // A quarter turn clockwise on a screen whose y points down.
    const dx = x - centre;
    const dy = y - centre;
    x = centre - dy;
    y = centre + dx;
  }
  return { x, y };
}

/** The spoke a team fights from, by its seat at the table. */
export function legForSeat(seat: number): Leg {
  return LEGS[seat % LEGS.length]!;
}

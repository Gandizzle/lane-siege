/**
 * The Final Showdown arena. DESIGN.md §3.3, replaced.
 *
 * §3.3 ended a match with an attrition endgame: from wave 25 nothing could be
 * built, nothing respawned, and increasingly nasty waves ground the table down
 * until one player was left. That is a war of attrition against the clock and
 * it is decided by who happened to bank the most gold. The Final Showdown
 * decides it by putting the surviving armies in one place and letting them
 * fight.
 *
 * TWO SHAPES, CHOSEN BY WHO IS LEFT
 *
 * Four survivors fight on a CROSS. Four spokes of lane width meeting at a
 * square centre:
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
 * Three fight on a Y. The same spokes, three of them, a third of a turn apart
 * and meeting at a triangle:
 *
 *            \  north-  /     \  north-  /       The triangle's sides are each
 *             \  west  /       \  east  /        a spoke's width, so every
 *              \      /         \      /         spoke ends flush against it.
 *               \    /-----------\    /          Its middle is `hub` from each
 *                \  /   CENTRE    \  /           side - spokeWidth / (2√3),
 *                 \/   triangle    \/            2.3 tiles - where the cross's
 *                  |               |             square is spokeWidth / 2.
 *                  |     south     |
 *                  |               |
 *
 * A cross with one spoke left empty is not a fair place for three: two of the
 * three are a quarter turn apart and the third faces one of them head on,
 * across the whole board, while the one in the middle has an enemy on each
 * side. The Y gives every army the same two neighbours at the same angle.
 *
 * Two fight on the cross, on OPPOSITE spokes - south and north - so a duel is
 * the head-on clash it should be rather than an L-shaped fight round a corner.
 * The two empty spokes stay open ground either side of the middle.
 *
 * Every army starts where it was built. A unit standing on tile (3, 7) of its
 * owner's build grid stands on the same tile of that owner's spoke, so the line
 * a player spent twenty-five waves arranging is the line they take into the
 * showdown - and the row they built nearest their fortress is the row furthest
 * from the fight.
 *
 * SEATING is by the survivors' order at the table (`seating`): the first
 * survivor takes the south spoke - the bottom of the screen, where a lane's
 * own defenders stand - and the rest follow clockwise. With all four at the
 * table that is simply lane one south, lane two west, and so on.
 */

import type { GameData } from '../data/schema.ts';
import type { Bounds } from './motion.ts';
import type { Vec2 } from './types.ts';

/** The two shapes an arena takes. See the top of this file for which is used when. */
export type ArenaLayout = 'cross' | 'y';
export const ARENA_LAYOUTS: readonly ArenaLayout[] = ['cross', 'y'];

/** The cross's spokes, in seating order: clockwise from south. */
export const LEGS = ['south', 'west', 'north', 'east'] as const;
export type Leg = (typeof LEGS)[number];

/**
 * sin 60°, which is all the trigonometry a Y needs. A square root rather than
 * `Math.sin`, because the root is correctly rounded on every machine and the
 * sine is not: two clients that disagree in the last bit of a spoke's
 * direction disagree about where every body in it stands.
 */
const SIN60 = Math.sqrt(3) / 2;

export interface ArenaShape {
  layout: ArenaLayout;
  /** Across a spoke, in tiles: the lane's own width. */
  spokeWidth: number;
  /** Along a spoke: the build grid plus the open ground ahead of it. */
  spokeLength: number;
  /** Rows of open ground between a player's grid and the centre. */
  approachDepth: number;
  /** The bounding box, in tiles: what the field and the camera cover. */
  width: number;
  depth: number;
  /** Where the spokes meet. */
  centre: Vec2;
  /**
   * Each spoke's direction out from the centre, unit length, in seating order:
   * clockwise on the screen from south.
   */
  spokes: readonly Vec2[];
  /**
   * From the centre to the inner end of a spoke - where the shared middle stops
   * and a spoke's own ground begins. The square's half-side on the cross, the
   * triangle's inradius on the Y.
   */
  hub: number;
  /** From the centre to the outer end of a spoke. */
  reach: number;
  /** Where bodies may stand. */
  bounds: Bounds;
}

export function arenaShape(data: GameData, layout: ArenaLayout = 'cross'): ArenaShape {
  return layout === 'y' ? yShape(data) : crossShape(data);
}

function crossShape(data: GameData): ArenaShape {
  const spokeWidth = data.lane.buildZone.width;
  const approachDepth = data.waves.showdown.approachDepth;
  const spokeLength = data.lane.buildZone.depth + approachDepth;
  const size = spokeLength * 2 + spokeWidth;
  const hub = spokeWidth / 2;

  return {
    layout: 'cross',
    spokeWidth,
    spokeLength,
    approachDepth,
    width: size,
    depth: size,
    centre: { x: size / 2, y: size / 2 },
    spokes: [
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
    ],
    hub,
    reach: hub + spokeLength,
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

/**
 * The Y: a stem pointing south and two arms a third of a turn either side of
 * it, so the arms reach up and out at thirty degrees above the horizontal.
 *
 * The bounding box is rounded up to whole tiles, because the field's grid is
 * counted in them, and the Y sits in the middle of it.
 */
function yShape(data: GameData): ArenaShape {
  const spokeWidth = data.lane.buildZone.width;
  const approachDepth = data.waves.showdown.approachDepth;
  const spokeLength = data.lane.buildZone.depth + approachDepth;
  const half = spokeWidth / 2;
  // Three strips of width 2·half meeting at 120° leave a triangle between
  // their inner ends whose sides are 2·half long, and whose inradius is this.
  const hub = half / Math.sqrt(3);
  const reach = hub + spokeLength;

  // Clockwise on a screen whose y points down: south, then a third of a turn
  // to the upper left, then another to the upper right.
  const spokes: Vec2[] = [
    { x: 0, y: 1 },
    { x: -SIN60, y: -0.5 },
    { x: SIN60, y: -0.5 },
  ];

  // The arms' outer corners are the widest and highest points; the stem's end
  // is the lowest.
  const side = reach * SIN60 + half * 0.5;
  const above = reach * 0.5 + half * SIN60;
  const width = Math.ceil(2 * side);
  const depth = Math.ceil(above + reach);
  const centre = { x: width / 2, y: above + (depth - above - reach) / 2 };

  return {
    layout: 'y',
    spokeWidth,
    spokeLength,
    approachDepth,
    width,
    depth,
    centre,
    spokes,
    hub,
    reach,
    bounds: {
      minX: 0,
      maxX: width,
      minY: 0,
      maxY: depth,
      spokes: { cx: centre.x, cy: centre.y, half, reach, dirs: spokes },
    },
  };
}

/** The middle of the arena: the middle of the centre square, or of the triangle. */
export function arenaCentre(shape: ArenaShape): Vec2 {
  return { x: shape.centre.x, y: shape.centre.y };
}

/**
 * Which arena a showdown with this many armies is fought in, and which spoke
 * each army takes, in seat order. See the top of this file.
 */
export function seating(armies: number): { layout: ArenaLayout; spokes: number[] } {
  if (armies === 3) return { layout: 'y', spokes: [0, 1, 2] };
  // South and north: a duel is fought head on.
  if (armies === 2) return { layout: 'cross', spokes: [0, 2] };
  return {
    layout: 'cross',
    spokes: Array.from({ length: armies }, (_, i) => i % LEGS.length),
  };
}

/**
 * Does the line between these two points leave the arena?
 *
 * The arena is a cross or a Y, and the rest of its bounding box is not arena
 * at all - nothing stands there and nothing walks there. This asks whether a
 * shot from `a` to `b` would have to pass through it, which is what "shooting
 * across the void" means: a body at the back of the south spoke drawing a bead
 * on one at the back of the east spoke, through the gap between them.
 *
 * WHY IT MATTERS. Without it the gaps are transparent, and a long enough gun
 * covers two spokes from a standing start while nothing can walk to it - so
 * reach is worth far more than the price ladder charges for it, and the back
 * of your own spoke is the safest place in the game to put your whole army.
 * The first three round robins all said exactly that: rung 6 alone won nine
 * fights in ten.
 *
 * Allocation-free: this runs once per candidate target per body per tick
 * (§15.3).
 */
export function crossesTheVoid(shape: ArenaShape, a: Vec2, b: Vec2): boolean {
  return shape.layout === 'y' ? yCrossesTheVoid(shape, a, b) : crossCrossesTheVoid(shape, a, b);
}

/**
 * The cross's version: Liang-Barsky against each corner box, unrolled. The two
 * fast paths carry most calls - two bodies both inside the vertical bar, or
 * both inside the horizontal one, are inside a convex rectangle and the segment
 * between them cannot leave it.
 */
function crossCrossesTheVoid(shape: ArenaShape, a: Vec2, b: Vec2): boolean {
  const band = shape.bounds.band;
  if (!band) return false;

  const { min, max } = band;
  // Both down the vertical bar, or both across the horizontal one. Either way
  // the segment stays inside one rectangle.
  if (a.x >= min && a.x <= max && b.x >= min && b.x <= max) return false;
  if (a.y >= min && a.y <= max && b.y >= min && b.y <= max) return false;

  const size = shape.width;
  return (
    hitsBox(a, b, 0, 0, min, min) ||
    hitsBox(a, b, max, 0, size, min) ||
    hitsBox(a, b, 0, max, min, size) ||
    hitsBox(a, b, max, max, size, size)
  );
}

/**
 * The Y's version. Between each pair of neighbouring spokes is a wedge of void
 * whose point is the inside corner where their edges meet, and a segment
 * between two bodies in the arena can only leave it through one of those: it
 * cannot pass beyond a spoke's far end, because both of its ends are nearer
 * the centre than that.
 *
 * Each wedge is two half-planes - past this spoke's edge on its neighbour's
 * side, and past the neighbour's edge on this one's - so the test is
 * Liang-Barsky with two sides instead of four. The fast path is the same as
 * the cross's: two bodies in one spoke are inside one rectangle.
 */
function yCrossesTheVoid(shape: ArenaShape, a: Vec2, b: Vec2): boolean {
  const { centre, spokes, reach } = shape;
  const half = shape.spokeWidth / 2;

  for (const d of spokes) {
    if (inSpoke(a, centre, d, half, reach) && inSpoke(b, centre, d, half, reach)) return false;
  }
  for (let i = 0; i < spokes.length; i++) {
    const d = spokes[i]!;
    const next = spokes[(i + 1) % spokes.length]!;
    if (hitsWedge(a, b, centre, d, next, half)) return true;
  }
  return false;
}

/** The inverse, which is what a caller usually wants to say. */
export function hasLineOfSight(shape: ArenaShape, a: Vec2, b: Vec2): boolean {
  return !crossesTheVoid(shape, a, b);
}

/** How far `p` is along spoke `d` from the centre. */
function along(p: Vec2, centre: Vec2, d: Vec2): number {
  return (p.x - centre.x) * d.x + (p.y - centre.y) * d.y;
}

/**
 * How far `p` is across spoke `d`, positive toward the previous spoke round
 * the table - to the right, looking down the spoke at the centre from its far
 * end. The same convention `spokePosition` lays a grid out in.
 */
function across(p: Vec2, centre: Vec2, d: Vec2): number {
  return (p.x - centre.x) * d.y - (p.y - centre.y) * d.x;
}

function inSpoke(p: Vec2, centre: Vec2, d: Vec2, half: number, reach: number): boolean {
  const a = along(p, centre, d);
  if (a < 0 || a > reach) return false;
  const c = across(p, centre, d);
  return c >= -half && c <= half;
}

/**
 * Does the segment a-b pass through the INTERIOR of the wedge between spoke
 * `d` and the next one clockwise, `next`?
 *
 * The wedge is where both of these are positive: how far past `d`'s edge on
 * `next`'s side a point is, and how far past `next`'s edge on `d`'s side. Each
 * is linear along the segment, so each holds on one interval of it, and the
 * segment is in the wedge where both intervals overlap. Strictly positive, so
 * a shot that runs exactly along an edge, or touches the inside corner and
 * nothing more, is not blocked - the same rule as the cross's `hitsBox`.
 */
function hitsWedge(a: Vec2, b: Vec2, centre: Vec2, d: Vec2, next: Vec2, half: number): boolean {
  let lo = 0;
  let hi = 1;
  for (let side = 0; side < 2; side++) {
    const v0 = side === 0 ? -across(a, centre, d) - half : across(a, centre, next) - half;
    const v1 = side === 0 ? -across(b, centre, d) - half : across(b, centre, next) - half;
    if (v0 <= 0 && v1 <= 0) return false;
    if (v0 > 0 && v1 > 0) continue;
    // One end in, one out: in from where it crosses zero, or up to there.
    const t = v0 / (v0 - v1);
    if (v0 <= 0) {
      if (t > lo) lo = t;
    } else if (t < hi) {
      hi = t;
    }
  }
  return hi > lo;
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
 * Whether a point is in the middle - the ground every spoke meets on, and the
 * hill somebody holds (§3.3, replaced).
 *
 * On the cross that is the square inside the band on BOTH axes, which is the
 * same band the corners are cut out with: inside it one way is a spoke, inside
 * it both ways is the middle. On the Y it is the triangle: no further than
 * `hub` along any spoke, which is exactly where every spoke's own ground
 * begins.
 *
 * Measured on the body's centre rather than its circle, so a body half in and
 * half out is wherever its middle is and two players cannot both count the
 * same body by standing it on the line.
 */
export function inCentre(shape: ArenaShape, pos: Vec2): boolean {
  if (shape.layout === 'y') {
    for (const d of shape.spokes) {
      if (along(pos, shape.centre, d) > shape.hub) return false;
    }
    return true;
  }
  const band = shape.bounds.band;
  if (!band) return false;
  return pos.x >= band.min && pos.x <= band.max && pos.y >= band.min && pos.y <= band.max;
}

/**
 * Where a unit built on tile (tileX, tileY) of its lane stands in the arena,
 * on spoke `spoke`.
 *
 * The south spoke is the layout written out: the player's grid at the bottom
 * with its far row - the one that faced the monsters - nearest the centre,
 * and its left column on the left. Every other spoke is that same layout
 * turned to face the centre down its own direction, so every army is arranged
 * identically with respect to its own fight.
 *
 * On the cross every quantity here is a whole or half tile and every
 * direction is a whole axis, so the result is exact - the same bits the old
 * quarter-turn rotation produced.
 */
export function spokePosition(
  shape: ArenaShape,
  spoke: number,
  tileX: number,
  tileY: number,
): Vec2 {
  const d = shape.spokes[spoke % shape.spokes.length]!;
  // Along the spoke from the centre: the inner end, the approach, then the
  // grid, its spawn-facing row first.
  const out = shape.hub + shape.approachDepth + tileY + 0.5;
  // Across it from its middle line, left to right as the player saw it.
  const side = tileX + 0.5 - shape.spokeWidth / 2;
  return {
    x: shape.centre.x + out * d.x + side * d.y,
    y: shape.centre.y + out * d.y - side * d.x,
  };
}

/**
 * The silhouettes and the mark pips. DESIGN.md §14.2, amended.
 *
 * §14.2 gave one shape per armour type. That is four shapes for thirty-seven
 * bodies, and a crowd of identical hexagons tells you nothing about which of
 * your units is which. Every body now has its own silhouette, and the thing
 * §14.2 was protecting is kept as a rule about FAMILIES: round things are
 * Flesh, angular things are Plate, pointed and stellar things are Ward, and
 * clusters of small things are Swarm. The armour read survives at a glance and
 * without colour; within a family, every member is distinct. `SHAPE_FAMILY` in
 * schema.ts is the assignment and validate.ts enforces it on load.
 *
 * Drawn with Pixi Graphics primitives only. A monster is an outline, a
 * defensive unit is a solid fill - so at a glance you can tell what is yours
 * and what is coming for you, independent of colour or shape.
 *
 * GEOMETRY FIRST, PIXELS SECOND
 *
 * `silhouette()` returns plain vertex lists and circles, centred on the origin
 * and fitting inside the unit circle; `drawEntity()` scales and paints them.
 * The split is what makes the catalogue testable: shapes.test.ts checks that
 * every silhouette stays inside the body's collision radius - what you see is
 * exactly what collides (§4.2) - and that no two are the same, with no canvas
 * in sight.
 *
 * Fused shapes (a teardrop, a crescent, a bulb) are traced as ONE polygon
 * rather than as overlapping primitives. A union of primitives fills fine, but
 * a monster is stroked, and stroking a union draws every seam.
 */

import { Graphics } from 'pixi.js';
import type { DamageType, ShapeId } from '../data/schema.ts';
import { DAMAGE_COLOURS } from './palette.ts';

export interface EntityStyle {
  shape: ShapeId;
  damageType: DamageType;
  /** 1..3. Drives size and the pip count (§7.3). */
  mark: number;
  /** Monsters are outlines; defensive units are solid (§14.2). */
  outlined: boolean;
}

/** One primitive of a silhouette, in unit-circle coordinates, y down. */
export type Piece =
  { kind: 'poly'; points: number[] } | { kind: 'circle'; x: number; y: number; r: number };

const TAU = Math.PI * 2;
/** Straight up on screen. Every pointed shape points this way. */
const UP = -Math.PI / 2;

// ------------------------------------------------------------- generators

/** Regular polygon, first vertex at `rotation`, circumradius `radius`. */
function regular(sides: number, rotation = UP, radius = 1, cx = 0, cy = 0): number[] {
  const points: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (TAU * i) / sides;
    points.push(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
  }
  return points;
}

/** A star: `points` tips at radius 1, valleys at `inner`. */
function star(tips: number, inner: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < tips * 2; i++) {
    const a = UP + (Math.PI * i) / tips;
    const r = i % 2 === 0 ? 1 : inner;
    points.push(r * Math.cos(a), r * Math.sin(a));
  }
  return points;
}

/** A closed curve given as radius-of-angle, sampled evenly. */
function polar(radiusAt: (angle: number) => number, samples = 48): number[] {
  const points: number[] = [];
  for (let i = 0; i < samples; i++) {
    const a = (TAU * i) / samples;
    const r = radiusAt(a);
    points.push(r * Math.cos(a), r * Math.sin(a));
  }
  return points;
}

/** Points along an arc from `from` to `to` (radians, either direction), inclusive. */
function arc(cx: number, cy: number, r: number, from: number, to: number, steps: number): number[] {
  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    points.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return points;
}

/** A regular polygon with its corners rounded off, scaled back out to radius 1. */
function roundedRegular(sides: number, corner: number): number[] {
  const interior = ((sides - 2) * Math.PI) / sides;
  const centreDistance = 1 - corner / Math.sin(interior / 2);
  const scale = 1 / (centreDistance + corner);
  const half = Math.PI / 2 - interior / 2;
  const points: number[] = [];
  for (let i = 0; i < sides; i++) {
    const heading = UP + (TAU * i) / sides;
    points.push(
      ...arc(
        centreDistance * scale * Math.cos(heading),
        centreDistance * scale * Math.sin(heading),
        corner * scale,
        heading - half,
        heading + half,
        6,
      ),
    );
  }
  return points;
}

const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const poly = (points: number[]): Piece => ({ kind: 'poly', points });
const dot = (x: number, y: number, r: number): Piece => ({ kind: 'circle', x, y, r });

/** The same small piece stamped at several offsets: the swarm family. */
function stamp(offsets: [number, number][], piece: (x: number, y: number) => Piece): Piece[] {
  return offsets.map(([x, y]) => piece(x, y));
}
const TRIAD: [number, number][] = [
  [0, -0.56],
  [-0.5, 0.38],
  [0.5, 0.38],
];
const COMPASS: [number, number][] = [
  [0, -0.62],
  [0.62, 0],
  [0, 0.62],
  [-0.62, 0],
];
const CORNERS: [number, number][] = [
  [-0.52, -0.52],
  [0.52, -0.52],
  [-0.52, 0.52],
  [0.52, 0.52],
];

// -------------------------------------------------------------- catalogue

/**
 * Every silhouette, in unit-circle coordinates. The comment on each is what it
 * should read as at nine pixels, which is the size it is judged at.
 */
const CATALOGUE: Record<ShapeId, () => Piece[]> = {
  // ---- Flesh: round. Soft edges, no corners.
  orb: () => [dot(0, 0, 1)],
  egg: () => {
    // Narrower at the top than the bottom.
    const points: number[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (TAU * i) / 48;
      const taper = 1 - 0.22 * Math.max(0, -Math.sin(a));
      points.push(0.82 * Math.cos(a) * taper, Math.sin(a));
    }
    return [poly(points)];
  },
  bean: () => {
    // A kidney: a wide ellipse with its top dented in.
    const points: number[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (TAU * i) / 48;
      const x = Math.cos(a);
      let y = 0.62 * Math.sin(a);
      if (y < 0) y += 0.3 * (1 - Math.abs(x)) ** 2;
      points.push(x, y);
    }
    return [poly(points)];
  },
  pill: () => [
    // A stadium lying on its side.
    poly([
      ...arc(0.45, 0, 0.55, rad(-90), rad(90), 10),
      ...arc(-0.45, 0, 0.55, rad(90), rad(270), 10),
    ]),
  ],
  teardrop: () => [
    // Round below, one point up: a lance tip.
    poly([...arc(0, 0.28, 0.72, rad(-34.2), rad(214.2), 20), 0, -1]),
  ],
  tadpole: () => [
    // Round above, a thin tail trailing down.
    poly([...arc(0, -0.28, 0.72, rad(70), rad(-250), 22), -0.09, 0.55, 0, 1, 0.09, 0.55]),
  ],
  bulb: () => [
    // A big round head over a small round foot, with a neck.
    poly([
      ...arc(0, -0.4, 0.6, rad(76.4), rad(-256.4), 20),
      -0.15,
      0.313,
      ...arc(0, 0.64, 0.36, rad(245.4), rad(-65.4), 14),
      0.15,
      0.181,
    ]),
  ],
  blob: () => [poly(polar((a) => 0.74 + 0.26 * Math.cos(3 * (a - UP))))],
  moon: () => [
    // A crescent: the disc with a bite out of its right side.
    poly([
      ...arc(0, 0, 1, rad(50.3), rad(309.7), 22),
      ...arc(0.42, 0, 0.8, rad(285.9), rad(74.1), 16),
    ]),
  ],
  pebble: () => [poly(roundedRegular(3, 0.3))],
  cloud: () => [poly(polar((a) => 0.78 + 0.22 * Math.cos(4 * a)))],
  spindle: () => [
    // A vesica standing on end: a needle.
    poly([
      ...arc(0.98, 0, 1.4, rad(-134.4), rad(-225.6), 14),
      ...arc(-0.98, 0, 1.4, rad(45.6), rad(-45.6), 14),
    ]),
  ],

  // ---- Plate: angular. Straight edges, corners.
  hexagon: () => [poly(regular(6))],
  pentagon: () => [poly(regular(5))],
  slab: () => [poly([-0.9, -0.4, 0.9, -0.4, 0.9, 0.4, -0.9, 0.4])],
  square: () => [poly([-0.7, -0.7, 0.7, -0.7, 0.7, 0.7, -0.7, 0.7])],
  shield: () => [
    poly(
      [-0.85, -0.75, 0.85, -0.75, 0.85, 0.05, 0.45, 0.7, 0, 1, -0.45, 0.7, -0.85, 0.05].map(
        (v) => v * 0.88,
      ),
    ),
  ],
  wedge: () => [poly([-0.88, -0.45, 0.88, -0.45, 0.44, 0.55, -0.44, 0.55])],
  chevron: () => [poly([0, -1, 0.92, 0.3, 0.55, 0.65, 0, -0.15, -0.55, 0.65, -0.92, 0.3])],
  keep: () => [
    // A crenellated block: three merlons along the top.
    poly(
      [
        -0.85, 0.85, -0.85, -0.85, -0.45, -0.85, -0.45, -0.35, -0.2, -0.35, -0.2, -0.85, 0.2, -0.85,
        0.2, -0.35, 0.45, -0.35, 0.45, -0.85, 0.85, -0.85, 0.85, 0.85,
      ].map((v) => v * 0.82),
    ),
  ],

  // ---- Ward: pointed. Tips, stars, symmetry.
  diamond: () => [poly([0, -1, 1, 0, 0, 1, -1, 0])],
  kite: () => [poly([0, -1, 0.7, -0.25, 0, 1, -0.7, -0.25])],
  star4: () => [poly(star(4, 0.42))],
  star5: () => [poly(star(5, 0.5))],
  star6: () => [poly(star(6, 0.62))],
  cross: () => [
    poly(
      [
        -0.28, -1, 0.28, -1, 0.28, -0.28, 1, -0.28, 1, 0.28, 0.28, 0.28, 0.28, 1, -0.28, 1, -0.28,
        0.28, -1, 0.28, -1, -0.28, -0.28, -0.28,
      ].map((v) => v * 0.96),
    ),
  ],
  hourglass: () => [
    poly([-0.66, -0.74, 0.66, -0.74, 0.094, 0, 0.66, 0.74, -0.66, 0.74, -0.094, 0]),
  ],
  spear: () => [poly([0, -1, 0.72, 0.66, 0, 0.25, -0.72, 0.66])],
  // A long thin sliver, point up: the thing that shoots from out of reach.
  dart: () => [poly([0, -1, 0.42, 0.9, 0, 0.58, -0.42, 0.9])],
  // Three points over a flat base: the one that stands at the back and tends.
  crown: () => [
    poly([-0.86, 0.7, -0.86, -0.62, -0.4, 0.02, 0, -0.9, 0.4, 0.02, 0.86, -0.62, 0.86, 0.7]),
  ],

  // ---- Swarm: many small things.
  cluster3: () => stamp(TRIAD, (x, y) => poly(regular(3, UP, 0.34, x, y))),
  dots3: () => stamp(TRIAD, (x, y) => dot(x, y, 0.32)),
  dots4: () => stamp(COMPASS, (x, y) => dot(x, y, 0.3)),
  dots5: () => [...stamp(CORNERS, (x, y) => dot(x, y, 0.26)), dot(0, 0, 0.26)],
  ring6: () => stamp(regularOffsets(6, 0.68), (x, y) => dot(x, y, 0.26)),
  tri4: () => stamp(COMPASS, (x, y) => poly(regular(3, UP, 0.36, x, y))),
  diamonds3: () => stamp(TRIAD, (x, y) => poly(regular(4, UP, 0.38, x, y))),
  squares4: () =>
    // Pulled in from CORNERS: a square's diagonal reaches further than a dot's radius.
    stamp(
      CORNERS.map(([x, y]) => [x * 0.885, y * 0.885] as [number, number]),
      (x, y) => poly(regular(4, UP + Math.PI / 4, 0.3, x, y)),
    ),
  flock: () =>
    stamp(
      [
        [0, -0.6],
        [-0.35, -0.15],
        [0.35, -0.15],
        [-0.7, 0.3],
        [0.7, 0.3],
      ],
      (x, y) => dot(x, y, 0.22),
    ),
  // Seven tiny things packed tight, one in the middle: smaller and denser than
  // any other swarm, which is what the body underneath it is.
  hive: () => [dot(0, 0, 0.2), ...stamp(regularOffsets(6, 0.6), (x, y) => dot(x, y, 0.2))],
};

/** The centres of `n` things evenly around a ring of radius `r`. */
function regularOffsets(n: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = UP + (TAU * i) / n;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

/** The silhouette for a shape, centred on the origin, inside the unit circle. */
export function silhouette(shape: ShapeId): Piece[] {
  return CATALOGUE[shape]();
}

/** Every shape the catalogue knows, for the tests and the data check. */
export const SHAPE_IDS = Object.keys(CATALOGUE) as ShapeId[];

// ---------------------------------------------------------------- drawing

/**
 * Draws one entity into `g`. Radius is scaled by mark so a mark 3 unit reads as
 * bigger even before you count its pips.
 */
export function drawEntity(
  g: Graphics,
  style: EntityStyle,
  cx: number,
  cy: number,
  baseRadius: number,
): Graphics {
  const radius = baseRadius * (1 + (style.mark - 1) * 0.15);
  const colour = DAMAGE_COLOURS[style.damageType];

  for (const piece of silhouette(style.shape)) {
    if (piece.kind === 'circle') {
      g.circle(cx + piece.x * radius, cy + piece.y * radius, piece.r * radius);
    } else {
      const points = piece.points;
      const scaled = new Array<number>(points.length);
      for (let i = 0; i < points.length; i += 2) {
        scaled[i] = cx + points[i]! * radius;
        scaled[i + 1] = cy + points[i + 1]! * radius;
      }
      g.poly(scaled);
    }
  }

  if (style.outlined) {
    g.stroke({ width: Math.max(1.5, radius * 0.16), color: colour, alignment: 0.5 });
  } else {
    g.fill({ color: colour });
  }

  drawMarkPips(g, style.mark, cx, cy + radius + baseRadius * 0.38, baseRadius * 0.13, colour);
  return g;
}

/**
 * How many pips a mark wears: one per UPGRADE BOUGHT, not one per mark owned.
 *
 * A unit as built is mark 1 and wears none, so the pips read as a count of
 * what the player has spent on it rather than as an off-by-one of the mark
 * number - upgrade once, one dot.
 */
export function markPipCount(mark: number): number {
  return mark > 1 ? mark - 1 : 0;
}

/** The pip row beneath the silhouette. An unupgraded unit draws none. */
export function drawMarkPips(
  g: Graphics,
  mark: number,
  cx: number,
  cy: number,
  pipRadius: number,
  colour: number,
): void {
  const pips = markPipCount(mark);
  if (pips <= 0) return;
  const spacing = pipRadius * 3;
  const start = cx - (spacing * (pips - 1)) / 2;
  for (let i = 0; i < pips; i++) {
    g.circle(start + i * spacing, cy, pipRadius).fill({ color: colour });
  }
}

/** Convenience: a fresh Graphics containing one entity. */
export function entityGraphic(style: EntityStyle, radius: number): Graphics {
  return drawEntity(new Graphics(), style, 0, 0, radius);
}

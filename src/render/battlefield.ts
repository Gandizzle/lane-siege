/**
 * Battlefield backgrounds: what the ground under the fight looks like.
 *
 * A cosmetic choice, picked from previews in its own panel off the menu
 * (ui/battlefieldPicker.ts) and kept in preferences. The plain ground is the
 * default and always there; the others are meant one day to be earned or
 * bought. For now every one is open, and `unlockedBattlefields` is the one
 * place the rule for which are will go.
 *
 * SEEN, BUT NEVER THE POINT
 *
 * Every channel on a body is spoken for - silhouette is armour, fill is damage
 * type, outline means monster (§14.2) - so a ground must never draw a shape a
 * body could be mistaken for. The three calm grounds keep to that: textured
 * enough to see at a glance on a phone, but nothing in them is the size or the
 * brightness of a body, and nothing is laid out on the tile grid, which would
 * make the grid harder to pick out during a build phase and invent one during
 * a wave.
 *
 * Molten is the deliberate exception, made to see how far is too far: basalt
 * plates over lava that glows, pulses down the lane towards the wall, and
 * throws up the odd ember. Its orange sits near the impact and blast fills,
 * and its embers are small moving lights - both of which the calm grounds
 * avoid on purpose.
 *
 * DRAWN, NOT LOADED
 *
 * Each is painted with Graphics from a fixed seed, in tile units, so it looks
 * the same at every screen size and every visit, costs no download, and is
 * painted once per layout rather than per frame. What moves on Molten is only
 * the alpha of a few layers and a handful of embers (`GroundView.animate`).
 * Every detail is kept wholly inside the area it is painted into, so no mask
 * is needed to trim it.
 */

import { Container, Graphics } from 'pixi.js';
import type { Rect } from './layout.ts';

export const BATTLEFIELDS = [
  { id: 'plain', name: 'Plain', note: 'The flat dark ground' },
  { id: 'meadow', name: 'Meadow', note: 'Short grass' },
  { id: 'dunes', name: 'Dunes', note: 'Rippled sand' },
  { id: 'cobbles', name: 'Cobblestone', note: 'An old road' },
  { id: 'molten', name: 'Molten', note: 'Lava, and it moves' },
] as const;

export type BattlefieldId = (typeof BATTLEFIELDS)[number]['id'];

export const BATTLEFIELD_IDS: readonly BattlefieldId[] = BATTLEFIELDS.map((b) => b.id);

/**
 * The battlefields this player may choose. Every one, for now: earning and
 * buying them is a later feature, and this is where it will be decided.
 */
export function unlockedBattlefields(): readonly BattlefieldId[] {
  return BATTLEFIELD_IDS;
}

/** A battlefield's name, for the menu. */
export function battlefieldName(id: BattlefieldId): string {
  return BATTLEFIELDS.find((b) => b.id === id)?.name ?? 'Plain';
}

/** A few words on what it is, under its preview. */
export function battlefieldNote(id: BattlefieldId): string {
  return BATTLEFIELDS.find((b) => b.id === id)?.note ?? '';
}

/**
 * The battlefield actually drawn: the one chosen, if this player may have it,
 * and the plain ground otherwise - a saved choice that stops being available
 * falls back rather than drawing something not theirs.
 */
export function battlefieldInUse(chosen: BattlefieldId): BattlefieldId {
  return unlockedBattlefields().includes(chosen) ? chosen : 'plain';
}

/** Whether this battlefield is painted at all, or is the flat colours alone. */
export function isTextured(id: BattlefieldId): boolean {
  return id !== 'plain';
}

/**
 * How strongly the build grid reads over this ground. Stronger on a textured
 * one, so the lines stay the brightest straight thing on the board while
 * there is building to do.
 */
export function gridAlpha(id: BattlefieldId): number {
  return isTextured(id) ? 0.5 : 0.32;
}

// ------------------------------------------------------------------ the view

/** How many bands Molten's lava pulses in, one after another down the lane. */
const PULSE_GROUPS = 4;
/** Seconds for one pulse to roll the length of a band cycle. */
const PULSE_SECONDS = 3.6;

interface Ember {
  x: number;
  /** Where it starts; it rises `travel` from here and fades out. */
  y: number;
  travel: number;
  sway: number;
  radius: number;
  period: number;
  offset: number;
}

/**
 * One battlefield's ground, painted into one or more areas (the lane is one;
 * the showdown arena's cross is three). Paint it when the choice, the area or
 * the tile size changes, and call `animate` every frame: on a still ground it
 * returns at once.
 */
export class GroundView extends Container {
  /** Everything that does not move: on a calm ground, all of it. */
  private readonly still = new Graphics();
  /** Molten's lava, under the plates, a layer per pulse band. */
  private readonly flows: Graphics[] = [];
  private readonly plates = new Graphics();
  /** The heat the lava throws onto the plates' edges, over them. */
  private readonly glows: Graphics[] = [];
  private readonly sparks = new Graphics();
  private embers: Ember[] = [];
  private moving = false;

  constructor() {
    super();
    for (let i = 0; i < PULSE_GROUPS; i++) {
      this.flows.push(new Graphics());
      this.glows.push(new Graphics());
    }
    this.addChild(this.still, ...this.flows, this.plates, ...this.glows, this.sparks);
  }

  /** Whether `animate` has anything to do. */
  get animated(): boolean {
    return this.moving;
  }

  /**
   * Paint `id` into `areas`, in this container's own coordinates. `tile` is the
   * size of a tile in pixels. Each area gets its own seed, so two painted side
   * by side are not copies of each other. The plain ground paints nothing.
   */
  paint(id: BattlefieldId, areas: readonly Rect[], tile: number): void {
    this.still.clear();
    this.plates.clear();
    this.sparks.clear();
    for (const g of [...this.flows, ...this.glows]) g.clear();
    this.embers = [];
    this.moving = false;
    if (tile <= 0) return;

    areas.forEach((area, i) => {
      if (area.width <= 0 || area.height <= 0) return;
      const rng = seeded(hash(id) ^ Math.imul(i + 1, 0x9e3779b1));
      switch (id) {
        case 'plain':
          return;
        case 'meadow':
          return paintMeadow(this.still, area, tile, rng);
        case 'dunes':
          return paintDunes(this.still, area, tile, rng);
        case 'cobbles':
          return paintCobbles(this.still, area, tile, rng);
        case 'molten':
          this.moving = true;
          return paintMolten(
            {
              still: this.still,
              flows: this.flows,
              plates: this.plates,
              glows: this.glows,
              embers: this.embers,
            },
            area,
            tile,
            rng,
          );
      }
    });
    this.animate(0);
  }

  /**
   * Move what moves, `seconds` into the ground's own clock. The lava's bands
   * brighten one after another down the lane, so the glow rolls towards the
   * wall; the embers rise and fade on their own cycles.
   */
  animate(seconds: number): void {
    if (!this.moving) return;
    for (let k = 0; k < PULSE_GROUPS; k++) {
      const phase = (seconds / PULSE_SECONDS) * Math.PI * 2 - (k / PULSE_GROUPS) * Math.PI * 2;
      const level = 0.5 + 0.5 * Math.sin(phase);
      this.flows[k]!.alpha = 0.55 + 0.45 * level;
      this.glows[k]!.alpha = 0.2 + 0.8 * level;
    }
    const g = this.sparks;
    g.clear();
    for (const e of this.embers) {
      const p = ((((seconds + e.offset) / e.period) % 1) + 1) % 1;
      const alpha = Math.sin(p * Math.PI) * 0.75;
      if (alpha <= 0.02) continue;
      const x = e.x + Math.sin(p * Math.PI * 2 + e.offset) * e.sway;
      const y = e.y - p * e.travel;
      g.circle(x, y, e.radius).fill({ color: 0xffa040, alpha });
    }
  }
}

// --------------------------------------------------------------- the grounds

/**
 * Short grass: a mossy base, broad patches lighter and darker, tufts of three
 * blades scattered thickly, and the odd pale fleck of clover - enough to read
 * as a field at a glance, and nothing body-sized in it.
 */
function paintMeadow(g: Graphics, a: Rect, s: number, rng: () => number): void {
  g.rect(a.x, a.y, a.width, a.height).fill({ color: 0x18261b });

  const tiles = (a.width * a.height) / (s * s);
  for (let i = 0; i < tiles * 0.16; i++) {
    const rx = (0.6 + rng() * 1.1) * s;
    const ry = rx * (0.5 + rng() * 0.3);
    if (2 * rx > a.width || 2 * ry > a.height) continue;
    const x = a.x + rx + rng() * (a.width - 2 * rx);
    const y = a.y + ry + rng() * (a.height - 2 * ry);
    g.ellipse(x, y, rx, ry).fill({ color: rng() < 0.5 ? 0x22351f : 0x121c14, alpha: 0.7 });
  }

  const reach = 0.18 * s;
  const tuft = (colour: number, alpha: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const x = a.x + reach + rng() * Math.max(0, a.width - 2 * reach);
      const y = a.y + reach + rng() * Math.max(0, a.height - 2 * reach);
      for (let blade = 0; blade < 3; blade++) {
        const angle = -Math.PI / 2 + (blade - 1) * 0.45 + (rng() - 0.5) * 0.3;
        const length = (0.08 + rng() * 0.1) * s;
        g.moveTo(x, y).lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      }
    }
    g.stroke({ width: Math.max(1, s * 0.03), color: colour, alpha });
  };
  tuft(0x2c4428, 0.9, tiles * 2.2);
  tuft(0x3d5c33, 0.85, tiles * 1.1);

  for (let i = 0; i < tiles * 0.25; i++) {
    const r = (0.022 + rng() * 0.018) * s;
    const x = a.x + r + rng() * (a.width - 2 * r);
    const y = a.y + r + rng() * (a.height - 2 * r);
    g.circle(x, y, r);
  }
  g.fill({ color: 0x8a8a5a, alpha: 0.45 });
}

/**
 * Sand: long, broken, gently curving ripples, each a lit crest over a
 * shadowed trough, broad drifts a shade darker, and a scatter of grit. The
 * ripples run across the lane at a slant and in pieces, so they never line up
 * into rows of a grid.
 */
function paintDunes(g: Graphics, a: Rect, s: number, rng: () => number): void {
  g.rect(a.x, a.y, a.width, a.height).fill({ color: 0x2c251a });

  const tiles = (a.width * a.height) / (s * s);
  for (let i = 0; i < tiles * 0.12; i++) {
    const rx = (0.9 + rng() * 1.4) * s;
    const ry = rx * (0.35 + rng() * 0.2);
    if (2 * rx > a.width || 2 * ry > a.height) continue;
    const x = a.x + rx + rng() * (a.width - 2 * rx);
    const y = a.y + ry + rng() * (a.height - 2 * ry);
    g.ellipse(x, y, rx, ry).fill({ color: rng() < 0.5 ? 0x231d14 : 0x342c1f, alpha: 0.7 });
  }

  const amplitude = 0.07 * s;
  const spacing = 0.36 * s;
  const lines = Math.floor((a.height - 2 * amplitude) / spacing);
  const crests: [number, number][][] = [];
  for (let i = 0; i <= lines; i++) {
    const baseY = a.y + amplitude + i * spacing + (rng() - 0.5) * spacing * 0.4;
    const wavelength = (1.6 + rng() * 1.6) * s;
    const phase = rng() * Math.PI * 2;
    const slant = (rng() - 0.5) * 0.12;
    // Broken into runs of a tile or two with gaps between, like real ripples.
    let x = a.x + rng() * s;
    while (x < a.x + a.width) {
      const run = (0.8 + rng() * 1.8) * s;
      const end = Math.min(a.x + a.width, x + run);
      const points: [number, number][] = [];
      for (let px = x; px <= end; px += s * 0.12) {
        const y =
          baseY +
          Math.sin(((px - a.x) / wavelength) * Math.PI * 2 + phase) * amplitude +
          (px - a.x) * slant;
        points.push([px, Math.min(a.y + a.height - 3, Math.max(a.y + 3, y))]);
      }
      if (points.length > 1) crests.push(points);
      x = end + (0.3 + rng() * 0.9) * s;
    }
  }
  const trace = (dy: number) => {
    for (const run of crests) {
      g.moveTo(run[0]![0], run[0]![1] + dy);
      for (let i = 1; i < run.length; i++) g.lineTo(run[i]![0], run[i]![1] + dy);
    }
  };
  const width = Math.max(1, s * 0.04);
  trace(width);
  g.stroke({ width, color: 0x17120c, alpha: 0.9 });
  trace(0);
  g.stroke({ width, color: 0x54472f, alpha: 0.9 });

  for (let i = 0; i < tiles * 0.4; i++) {
    const r = (0.018 + rng() * 0.025) * s;
    const x = a.x + r * 1.3 + rng() * (a.width - 2.6 * r);
    const y = a.y + r + rng() * (a.height - 2 * r);
    g.ellipse(x, y, r * 1.3, r);
  }
  g.fill({ color: 0x5a4c34, alpha: 0.7 });
}

/**
 * An old road: rounded stones of uneven size set in dark mortar, on a
 * jittered staggered lattice that is deliberately not the tile grid - smaller
 * than a tile, offset row to row, and never square.
 */
function paintCobbles(g: Graphics, a: Rect, s: number, rng: () => number): void {
  g.rect(a.x, a.y, a.width, a.height).fill({ color: 0x0e1014 });

  const pitchX = 0.43 * s;
  const pitchY = 0.37 * s;
  const tones = [0x272c36, 0x2c313c, 0x232731, 0x303541];
  const stones: { x: number; y: number; rx: number; ry: number; tone: number }[] = [];
  for (let row = 0; ; row++) {
    const cy = a.y + pitchY * 0.55 + row * pitchY;
    if (cy > a.y + a.height) break;
    const shift = row % 2 === 0 ? 0 : pitchX / 2;
    for (let col = 0; ; col++) {
      const cx = a.x + pitchX * 0.5 + shift + col * pitchX;
      if (cx > a.x + a.width) break;
      const rx = pitchX * (0.4 + rng() * 0.07);
      const ry = pitchY * (0.38 + rng() * 0.08);
      const x = cx + (rng() - 0.5) * pitchX * 0.12;
      const y = cy + (rng() - 0.5) * pitchY * 0.12;
      // Whole stones only: one cut by the edge would need a mask to trim.
      if (x - rx < a.x || x + rx > a.x + a.width || y - ry < a.y || y + ry > a.y + a.height) {
        continue;
      }
      stones.push({ x, y, rx, ry, tone: tones[Math.floor(rng() * tones.length)]! });
    }
  }
  for (const tone of tones) {
    for (const st of stones) if (st.tone === tone) g.ellipse(st.x, st.y, st.rx, st.ry);
    g.fill({ color: tone });
  }
  // The worn top of each stone, lighter, so they read as rounded.
  for (const st of stones) {
    g.ellipse(st.x - st.rx * 0.12, st.y - st.ry * 0.18, st.rx * 0.6, st.ry * 0.5);
  }
  g.fill({ color: 0x434a58, alpha: 0.4 });
}

/** The layers of a GroundView that Molten paints into, bottom to top. */
interface MoltenLayers {
  still: Graphics;
  flows: Graphics[];
  plates: Graphics;
  glows: Graphics[];
  embers: Ember[];
}

/**
 * Basalt over lava: the ground cut into plates (the cells of a jittered
 * lattice), each pulled back from its neighbours so the lava shows in the
 * cracks between, and the cracks sorted into bands across the lane that
 * `animate` brightens in turn.
 */
function paintMolten(layers: MoltenLayers, a: Rect, s: number, rng: () => number): void {
  const { still, flows, plates, glows, embers } = layers;
  still.rect(a.x, a.y, a.width, a.height).fill({ color: 0x3a1006 });

  // Sites a little past the area, so the cells at its edge are whole plates
  // cut by the edge rather than slivers.
  const spacing = 1.3 * s;
  const margin = spacing;
  const outer: Rect = {
    x: a.x - margin,
    y: a.y - margin,
    width: a.width + margin * 2,
    height: a.height + margin * 2,
  };
  const sites: Point[] = [];
  const rowH = spacing * 0.87;
  for (let row = 0; outer.y + row * rowH <= outer.y + outer.height; row++) {
    const shift = row % 2 === 0 ? 0 : spacing / 2;
    for (let col = 0; outer.x + shift + col * spacing <= outer.x + outer.width; col++) {
      sites.push({
        x: outer.x + shift + col * spacing + (rng() - 0.5) * spacing * 0.7,
        y: outer.y + row * rowH + (rng() - 0.5) * rowH * 0.7,
      });
    }
  }
  const cells = voronoiCells(sites, outer, spacing * 2.6);

  // The cracks: every edge two cells share, once, inside the area.
  const wide = 0.34 * s;
  const inner = insetRect(a, wide / 2);
  const band = 1.7 * s;
  const groupOf = (m: Point) => {
    const k = Math.floor((m.y - a.y + (m.x - a.x) * 0.4) / band);
    return ((k % PULSE_GROUPS) + PULSE_GROUPS) % PULSE_GROUPS;
  };
  const cracks: [Point, Point][][] = flows.map(() => []);
  cells.forEach((cell, i) => {
    for (let k = 0; k < cell.length; k++) {
      const from = cell[k]!;
      const to = cell[(k + 1) % cell.length]!;
      if (from.by <= i) continue;
      const seg = clipSegment(from, to, inner);
      if (!seg) continue;
      cracks[groupOf({ x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 })]!.push(seg);
    }
  });
  const trace = (g: Graphics, segs: [Point, Point][]) => {
    for (const [p, q] of segs) g.moveTo(p.x, p.y).lineTo(q.x, q.y);
  };
  cracks.forEach((segs, k) => {
    const flow = flows[k]!;
    trace(flow, segs);
    flow.stroke({ width: 0.16 * s, color: 0xd9400c, cap: 'round' });
    trace(flow, segs);
    flow.stroke({ width: 0.06 * s, color: 0xffc061, cap: 'round' });
    const glow = glows[k]!;
    trace(glow, segs);
    glow.stroke({ width: wide, color: 0xff5a10, alpha: 0.16, cap: 'round' });
  });

  // The plates, each drawn back towards its middle so the cracks show.
  const tones = [0x241b18, 0x2a201c, 0x201815, 0x2e2420];
  const shaded: { poly: Point[]; tone: number }[] = [];
  const tops: Point[][] = [];
  for (const cell of cells) {
    const centre = centroid(cell);
    const reach = Math.sqrt(Math.abs(polygonArea(cell)) / Math.PI);
    if (reach <= 0) continue;
    const pulled = scaleToward(cell, centre, Math.max(0.6, 1 - (0.07 * s) / reach));
    const plate = clipToRect(pulled, a);
    if (plate.length < 3) continue;
    shaded.push({ poly: plate, tone: tones[Math.floor(rng() * tones.length)]! });
    // A lighter top, up and to the left, so a plate reads as a raised slab.
    const top = clipToRect(
      scaleToward(pulled, { x: centre.x - 0.05 * s, y: centre.y - 0.07 * s }, 0.72),
      a,
    );
    if (top.length >= 3) tops.push(top);
  }
  for (const tone of tones) {
    for (const p of shaded) if (p.tone === tone) plates.poly(flat(p.poly));
    plates.fill({ color: tone });
  }
  for (const top of tops) plates.poly(flat(top));
  plates.fill({ color: 0x3a2e28, alpha: 0.45 });

  // Embers, sparse: one for every dozen tiles or so.
  const tiles = (a.width * a.height) / (s * s);
  for (let i = 0; i < tiles / 12; i++) {
    const radius = (0.03 + rng() * 0.025) * s;
    const travel = (1.2 + rng() * 1.6) * s;
    const sway = 0.12 * s;
    if (a.height < travel + 2 * radius || a.width < 2 * (sway + radius)) continue;
    embers.push({
      x: a.x + sway + radius + rng() * (a.width - 2 * (sway + radius)),
      y: a.y + travel + radius + rng() * (a.height - travel - 2 * radius),
      travel,
      sway,
      radius,
      period: 3.5 + rng() * 4,
      offset: rng() * 10,
    });
  }
}

// ------------------------------------------------------------------ geometry

export interface Point {
  x: number;
  y: number;
}

/** A corner of a cell, and which site's cell lies across the edge that starts at it (-1: the bounds). */
interface Corner extends Point {
  by: number;
}

/**
 * The Voronoi cell of every site, clipped to `bounds`: for each site, the
 * bounds cut down by the half-plane nearer to it than to each other site
 * within `reach`. Each corner records whose cell lies across the edge that
 * starts at it, so an edge two cells share can be drawn once.
 */
export function voronoiCells(sites: readonly Point[], bounds: Rect, reach: number): Corner[][] {
  const reach2 = reach * reach;
  return sites.map((p, i) => {
    let cell: Corner[] = [
      { x: bounds.x, y: bounds.y, by: -1 },
      { x: bounds.x + bounds.width, y: bounds.y, by: -1 },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height, by: -1 },
      { x: bounds.x, y: bounds.y + bounds.height, by: -1 },
    ];
    sites.forEach((q, j) => {
      if (j === i || cell.length === 0) return;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      if (dx * dx + dy * dy > reach2) return;
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      cell = clipHalfPlane(cell, (v) => (v.x - mx) * dx + (v.y - my) * dy, j);
    });
    return cell;
  });
}

/**
 * Keep the part of `poly` where `side` is at most zero (Sutherland-Hodgman),
 * marking the new edge along the cut as `by`'s.
 */
function clipHalfPlane(poly: Corner[], side: (v: Point) => number, by: number): Corner[] {
  const out: Corner[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if (sa <= 0 !== sb <= 0) {
      const t = sa / (sa - sb);
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // Leaving: the edge from here runs along the cut. Entering: it is what
      // is left of a's edge.
      out.push({ ...at, by: sa <= 0 ? by : a.by });
    }
  }
  return out;
}

function clipToRect(poly: readonly Point[], r: Rect): Point[] {
  let out: Corner[] = poly.map((p) => ({ x: p.x, y: p.y, by: -1 }));
  out = clipHalfPlane(out, (v) => r.x - v.x, -1);
  out = clipHalfPlane(out, (v) => v.x - (r.x + r.width), -1);
  out = clipHalfPlane(out, (v) => r.y - v.y, -1);
  out = clipHalfPlane(out, (v) => v.y - (r.y + r.height), -1);
  return out;
}

/** The part of a segment inside `r` (Liang-Barsky), or null if none of it is. */
function clipSegment(p: Point, q: Point, r: Rect): [Point, Point] | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, p.x - r.x],
    [dx, r.x + r.width - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.height - p.y],
  ];
  for (const [num, room] of edges) {
    if (num === 0) {
      if (room < 0) return null;
      continue;
    }
    const t = room / num;
    if (num < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  if (t1 - t0 < 1e-6) return null;
  return [
    { x: p.x + dx * t0, y: p.y + dy * t0 },
    { x: p.x + dx * t1, y: p.y + dy * t1 },
  ];
}

function insetRect(r: Rect, by: number): Rect {
  return {
    x: r.x + by,
    y: r.y + by,
    width: Math.max(0, r.width - by * 2),
    height: Math.max(0, r.height - by * 2),
  };
}

function polygonArea(poly: readonly Point[]): number {
  let sum = 0;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!;
    const b = poly[(k + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function centroid(poly: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

function scaleToward(poly: readonly Point[], c: Point, k: number): Point[] {
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

function flat(poly: readonly Point[]): number[] {
  return poly.flatMap((p) => [p.x, p.y]);
}

// -------------------------------------------------------------------- noise

/** A small, fast, seeded generator (mulberry32): the same ground every visit. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

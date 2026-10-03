/**
 * Battlefield backgrounds: what the ground under the fight looks like.
 *
 * A cosmetic choice in the menu (ui/menu.ts), kept in preferences. The plain
 * ground is the default and always there; the others are meant one day to be
 * earned or bought. For now every one is open, and `unlockedBattlefields` is
 * the one place the rule for which are will go.
 *
 * QUIET ON PURPOSE
 *
 * The ground is the one thing on the board that is never the point. Every
 * other channel is spoken for - silhouette is armour, fill is damage type,
 * outline means monster (§14.2) - so a ground that drew shapes or colours a
 * body could be mistaken for would cost a player a read in the middle of a
 * fight. So each one is dark, low in contrast and still: its details sit a few
 * shades off its base, nothing in it is the size or brightness of a body, and
 * nothing is laid out on the tile grid, which would make the grid harder to
 * pick out during a build phase and invent one during a wave.
 *
 * DRAWN, NOT LOADED
 *
 * Each is painted with Graphics from a fixed seed, in tile units, so it looks
 * the same at every screen size and every visit, costs no download, and is
 * drawn once per layout rather than per frame. Every detail is kept wholly
 * inside the area it is painted into, so no mask is needed to trim it.
 */

import type { Graphics } from 'pixi.js';
import type { Rect } from './layout.ts';

export const BATTLEFIELDS = [
  { id: 'plain', name: 'Plain' },
  { id: 'meadow', name: 'Meadow' },
  { id: 'dunes', name: 'Dunes' },
  { id: 'cobbles', name: 'Cobblestone' },
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
 * How strongly the build grid reads over this ground. A shade stronger on a
 * textured one, so the lines stay the brightest straight thing on the board
 * while there is building to do.
 */
export function gridAlpha(id: BattlefieldId): number {
  return isTextured(id) ? 0.4 : 0.32;
}

/**
 * Paint `id` into `area`, in the Graphics' own coordinates. `tile` is the size
 * of a tile in pixels; `seed` keeps two areas painted side by side from being
 * copies of each other. The plain ground paints nothing.
 */
export function paintGround(
  g: Graphics,
  id: BattlefieldId,
  area: Rect,
  tile: number,
  seed = 1,
): void {
  if (area.width <= 0 || area.height <= 0 || tile <= 0) return;
  const rng = seeded(hash(id) ^ Math.imul(seed, 0x9e3779b1));
  switch (id) {
    case 'plain':
      return;
    case 'meadow':
      return paintMeadow(g, area, tile, rng);
    case 'dunes':
      return paintDunes(g, area, tile, rng);
    case 'cobbles':
      return paintCobbles(g, area, tile, rng);
  }
}

// --------------------------------------------------------------- the grounds

/**
 * Short dark grass: a mossy base, a few broad patches a shade lighter, and
 * tufts of three blades scattered thinly - small and dim enough that nothing
 * reads as a body.
 */
function paintMeadow(g: Graphics, a: Rect, s: number, rng: () => number): void {
  g.rect(a.x, a.y, a.width, a.height).fill({ color: 0x131a15 });

  const tiles = (a.width * a.height) / (s * s);
  for (let i = 0; i < tiles * 0.12; i++) {
    const rx = (0.6 + rng() * 0.9) * s;
    const ry = rx * (0.5 + rng() * 0.3);
    const x = a.x + rx + rng() * Math.max(0, a.width - 2 * rx);
    const y = a.y + ry + rng() * Math.max(0, a.height - 2 * ry);
    if (2 * rx > a.width || 2 * ry > a.height) continue;
    g.ellipse(x, y, rx, ry).fill({ color: rng() < 0.5 ? 0x16201a : 0x111713, alpha: 0.4 });
  }

  const reach = 0.13 * s;
  for (let i = 0; i < tiles * 2.4; i++) {
    const x = a.x + reach + rng() * Math.max(0, a.width - 2 * reach);
    const y = a.y + reach + rng() * Math.max(0, a.height - 2 * reach);
    for (let blade = 0; blade < 3; blade++) {
      const angle = -Math.PI / 2 + (blade - 1) * 0.45 + (rng() - 0.5) * 0.3;
      const length = (0.06 + rng() * 0.07) * s;
      g.moveTo(x, y).lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    }
  }
  g.stroke({ width: Math.max(1, s * 0.022), color: 0x223020, alpha: 0.75 });
}

/**
 * Dark sand: long, broken, gently curving ripples, each a lit crest over a
 * shadowed trough, and a scatter of grit. The ripples run across the lane at
 * a slant and in pieces, so they never line up into rows of a grid.
 */
function paintDunes(g: Graphics, a: Rect, s: number, rng: () => number): void {
  g.rect(a.x, a.y, a.width, a.height).fill({ color: 0x1b1813 });

  const amplitude = 0.07 * s;
  const spacing = 0.38 * s;
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
        points.push([px, Math.min(a.y + a.height - 2, Math.max(a.y + 2, y))]);
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
  const width = Math.max(1, s * 0.03);
  trace(width);
  g.stroke({ width, color: 0x13110d, alpha: 0.8 });
  trace(0);
  g.stroke({ width, color: 0x29241a, alpha: 0.7 });

  const tiles = (a.width * a.height) / (s * s);
  for (let i = 0; i < tiles * 0.35; i++) {
    const r = (0.018 + rng() * 0.025) * s;
    const x = a.x + r + rng() * (a.width - 2 * r);
    const y = a.y + r + rng() * (a.height - 2 * r);
    g.ellipse(x, y, r * 1.3, r).fill({ color: 0x2a251c, alpha: 0.6 });
  }
}

/**
 * An old road: rounded stones of uneven size set in dark mortar, on a
 * jittered staggered lattice that is deliberately not the tile grid - smaller
 * than a tile, offset row to row, and never square.
 */
function paintCobbles(g: Graphics, a: Rect, s: number, rng: () => number): void {
  g.rect(a.x, a.y, a.width, a.height).fill({ color: 0x121419 });

  const pitchX = 0.43 * s;
  const pitchY = 0.37 * s;
  const tones = [0x17191f, 0x181b21, 0x16181e, 0x191c23];
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
  // The worn top of each stone, a shade lighter, so they read as rounded.
  for (const st of stones) {
    g.ellipse(st.x - st.rx * 0.12, st.y - st.ry * 0.18, st.rx * 0.6, st.ry * 0.5);
  }
  g.fill({ color: 0x20232b, alpha: 0.3 });
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

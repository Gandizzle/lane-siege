/**
 * The looks a player is seen in (sim/types.ts, `Looks`): their fortress's
 * stonework, what their shots leave behind them, their spoke of the Final
 * Showdown, and the flourish when they win. Drawn here, once, for the board,
 * the arena and the Collection's pictures alike, so the little one a player
 * unlocks is the one everybody in their matches sees.
 *
 * THE RULE THAT DOES NOT BEND
 *
 * Every channel on a body is spoken for (§14.2), and so is every channel on a
 * shot (attackStyle.ts): head shape and color are damage type, size is damage,
 * speed is range, and the dots trailing the head are the shooter's armor. A
 * look decorates around all of that and changes none of it:
 *
 *  - A fortress skin is paint inside the wall's own outline. The outline is
 *    the body monsters hit (motion.ts), and it is drawn exactly as before.
 *  - A trail is what a shot LEAVES: bits that stay where the head has been
 *    and fade, in colors of their own, smaller than the head and never moving
 *    with it - so the dots that do move with it still count the armor.
 *  - A floor is a pattern on a spoke, under the seat tint that says whose it
 *    is, dim, and with nothing in it the size or the brightness of a body.
 *  - A victory goes off over the end of the match, when nothing is left to
 *    read.
 *
 * DRAWN, NOT LOADED
 *
 * Like the battlefields (battlefield.ts): Graphics, from fixed seeds, so a look
 * is the same on every screen and every visit and costs no download.
 */

import { Container, Graphics } from 'pixi.js';
import type { Looks, MatchView, TeamId } from '../sim/index.ts';
import { NO_LOOKS } from '../sim/index.ts';
import { UI } from './palette.ts';

/** What a team in this match is seen in: yours, or another seat's. */
export function looksOf(view: MatchView | null, teamId: TeamId): Looks {
  if (!view) return NO_LOOKS;
  if (teamId === view.teamId) return view.teamLooks;
  return view.opponents.find((o) => o.teamId === teamId)?.looks ?? NO_LOOKS;
}

/**
 * Who won the match, once it is over: you, if you are still standing, or the
 * one who placed first. Null while it is running, and for solo, which nobody
 * wins - the wall always falls in the end.
 */
export function winnerOf(view: MatchView): TeamId | null {
  if (!view.finished || view.solo) return null;
  if (!view.eliminated) return view.teamId;
  const first =
    view.opponents.find((o) => o.placement === 1) ?? view.opponents.find((o) => !o.eliminated);
  return first?.teamId ?? null;
}

/** A number in [0, 1) from two integers: scatter that is the same every time. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x6a09e667, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- fortress

type FortressSkin = 'granite' | 'obsidian' | 'gilded';

const SKINS: Record<string, FortressSkin> = {
  fortress_granite: 'granite',
  fortress_obsidian: 'obsidian',
  fortress_gilded: 'gilded',
};

/** The stone, and the edge it is drawn with, for each skin and the game's own. */
const STONE: Record<FortressSkin | 'plain', { fill: number; edge: number }> = {
  plain: { fill: UI.fortressStone, edge: UI.textMuted },
  granite: { fill: 0x5f6778, edge: 0xa4adbd },
  obsidian: { fill: 0x231f33, edge: 0x8a78d6 },
  gilded: { fill: 0x4e4029, edge: UI.level },
};

/** Whether a fortress skin is one this build can draw. */
export function isFortressSkin(id: string | null): boolean {
  return id !== null && id in SKINS;
}

/**
 * The fortress wall in the skin worn, or the game's own stone for none: the
 * stadium every monster hits (layout.ts, `fortressShape`), centred on (`cx`,
 * `cy`), its spine reaching `halfWidth` either side and `radius` round it.
 *
 * Whatever a skin adds stays on the straight run of the wall and clear of its
 * top and bottom, so nothing crosses the outline - the rounded ends are plain
 * stone in every skin. The battlements are notches along the top in the
 * zone's color, last, as they always were.
 */
export function drawFortress(
  g: Graphics,
  skinId: string | null,
  cx: number,
  cy: number,
  halfWidth: number,
  radius: number,
): void {
  const skin = skinId === null ? null : (SKINS[skinId] ?? null);
  const stone = STONE[skin ?? 'plain'];
  const left = cx - halfWidth - radius;
  const width = (halfWidth + radius) * 2;
  const top = cy - radius;

  g.roundRect(left, top, width, radius * 2, radius).fill({ color: stone.fill });
  if (skin === 'granite') drawGranite(g, cx, cy, halfWidth, radius);
  if (skin === 'obsidian') drawObsidian(g, cx, cy, halfWidth, radius);
  if (skin === 'gilded') drawGilded(g, cx, cy, halfWidth, radius);
  g.roundRect(left, top, width, radius * 2, radius).stroke({ width: 1.5, color: stone.edge });

  // Battlements along the top edge, so the wall reads as masonry rather than
  // as a bar. Decoration, drawn inside the body: nothing here moves the edge
  // monsters actually hit.
  const merlon = radius * 0.5;
  for (let x = cx - halfWidth + merlon; x <= cx + halfWidth; x += merlon * 2.8) {
    g.rect(x - merlon / 2, top, merlon, radius * 0.4).fill({ color: UI.fortressZone });
    if (skin === 'gilded') {
      // A gold sill under each gap.
      g.rect(x - merlon / 2, top + radius * 0.4, merlon, Math.max(1, radius * 0.08)).fill({
        color: UI.level,
      });
    }
  }
}

/** Granite: dressed blocks in two courses, and the speckle of the stone. */
function drawGranite(g: Graphics, cx: number, cy: number, halfWidth: number, r: number): void {
  const x0 = cx - halfWidth;
  const x1 = cx + halfWidth;
  const joint = Math.max(1, r * 0.07);
  const mortar = 0x3c424f;
  const top = cy - r * 0.55;
  const bottom = cy + r * 0.78;
  g.rect(x0, cy - joint / 2, x1 - x0, joint).fill({ color: mortar });
  const block = r * 1.7;
  for (let x = x0 + block; x < x1; x += block) {
    g.rect(x - joint / 2, top, joint, cy - top).fill({ color: mortar });
    const below = x - block / 2;
    if (below > x0) g.rect(below - joint / 2, cy, joint, bottom - cy).fill({ color: mortar });
  }
  const specks = Math.round(((x1 - x0) / r) * 5);
  for (let i = 0; i < specks; i++) {
    const x = x0 + hash(i, 1) * (x1 - x0);
    const y = top + hash(i, 2) * (bottom - top);
    const light = hash(i, 3) < 0.55;
    g.circle(x, y, r * (0.035 + hash(i, 4) * 0.04)).fill({
      color: light ? 0xc3cad6 : 0x353b47,
      alpha: light ? 0.7 : 0.8,
    });
  }
}

/** Obsidian: black glass in facets, and the odd edge catching the light. */
function drawObsidian(g: Graphics, cx: number, cy: number, halfWidth: number, r: number): void {
  const x0 = cx - halfWidth;
  const x1 = cx + halfWidth;
  const top = cy - r * 0.52;
  const bottom = cy + r * 0.8;
  const facet = r * 1.3;
  let up = true;
  for (let x = x0; x + facet <= x1 + 0.5; x += facet / 2) {
    const tipY = up ? top : bottom;
    const baseY = up ? bottom : top;
    g.poly([x, baseY, x + facet, baseY, x + facet / 2, tipY]).fill({
      color: up ? 0x3a3357 : 0x2c2745,
      alpha: 0.85,
    });
    up = !up;
  }
  // Slivers of light along a few facet edges, kept off the rounded ends.
  const run = x1 - x0 - r * 2;
  const glints = Math.floor(run / (r * 2.6));
  for (let i = 0; i < glints; i++) {
    const x = x0 + r + ((i + 0.5) / glints) * run + (hash(i, 7) - 0.5) * r * 0.6;
    const lean = (hash(i, 8) < 0.5 ? -1 : 1) * r * 0.35;
    const w = Math.max(0.8, r * 0.07);
    g.poly([
      x - lean,
      top + r * 0.1,
      x - lean + w,
      top + r * 0.1,
      x + lean + w,
      bottom - r * 0.15,
      x + lean,
      bottom - r * 0.15,
    ]).fill({
      color: 0xc9bcff,
      alpha: 0.55,
    });
  }
}

/** Gilded: dark bronze with bands of gold, and gold studs between them. */
function drawGilded(g: Graphics, cx: number, cy: number, halfWidth: number, r: number): void {
  const x0 = cx - halfWidth;
  const x1 = cx + halfWidth;
  const band = Math.max(1.5, r * 0.13);
  g.rect(x0, cy - r * 0.42, x1 - x0, band).fill({ color: UI.level });
  g.rect(x0, cy + r * 0.62 - band, x1 - x0, band).fill({ color: UI.level });
  g.rect(x0, cy - r * 0.42 + band, x1 - x0, Math.max(1, band * 0.4)).fill({ color: 0x8a6a1c });
  const step = r * 1.25;
  for (let x = x0 + step / 2; x < x1; x += step) {
    g.circle(x, cy + r * 0.12, Math.max(1, r * 0.1)).fill({ color: UI.level });
    g.circle(x - r * 0.03, cy + r * 0.09, Math.max(0.5, r * 0.04)).fill({ color: 0xfff1c2 });
  }
}

// ------------------------------------------------------------------- trails

export type TrailKind = 'ember' | 'frost';

const TRAILS: Record<string, TrailKind> = {
  trail_ember: 'ember',
  trail_frost: 'frost',
};

/** The trail a cosmetic leaves, or none for none - or for one this build cannot draw. */
export function trailOf(id: string | null): TrailKind | null {
  return id === null ? null : (TRAILS[id] ?? null);
}

/** How long a bit of trail stays where a shot left it, fading, in milliseconds. */
export const TRAIL_LINGER_MS = 420;

/**
 * One bit of trail, `ageMs` after the shot's head passed (`x`, `y`), in
 * pixels; `size` is the head's radius, which the bit stays under. Nothing once
 * it has faded. `index` varies the bits along one shot.
 */
export function drawTrailBit(
  g: Graphics,
  kind: TrailKind,
  x: number,
  y: number,
  size: number,
  ageMs: number,
  index: number,
): void {
  const fade = 1 - ageMs / TRAIL_LINGER_MS;
  if (fade <= 0.02) return;
  if (kind === 'ember') {
    // A cinder: white-gold as it leaves the shot, dull orange as it cools,
    // drifting up a little as it goes.
    const rise = size * 1.4 * (1 - fade) * (0.6 + hash(index, 11) * 0.8);
    const r = size * (0.22 + 0.2 * fade);
    const cy = y - rise;
    if (fade > 0.45) {
      g.moveTo(x + r * 2.2, cy)
        .circle(x, cy, r * 2.2)
        .fill({ color: 0xff8a3d, alpha: 0.2 * fade });
    }
    g.moveTo(x + r, cy)
      .circle(x, cy, r)
      .fill({ color: fade > 0.6 ? 0xffe6a8 : 0xffa04d, alpha: 0.9 * fade });
    return;
  }
  // A glint of frost: a four-pointed star, set where it formed, shrinking.
  const r = size * (0.3 + 0.4 * fade);
  const w = r * 0.26;
  const turn = index % 2 === 0 ? 0 : Math.PI / 4;
  const points: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = turn + (i * Math.PI) / 4;
    const reach = i % 2 === 0 ? r : w * 1.4;
    points.push(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
  }
  g.moveTo(points[0]!, points[1]!)
    .poly(points)
    .fill({ color: 0xeafcff, alpha: 0.85 * fade });
}

// ------------------------------------------------------------------- floors

export type FloorKind = 'checker' | 'starfield';

const FLOORS: Record<string, FloorKind> = {
  floor_checker: 'checker',
  floor_starfield: 'starfield',
};

/** The pattern a floor cosmetic paints, or none. */
export function floorOf(id: string | null): FloorKind | null {
  return id === null ? null : (FLOORS[id] ?? null);
}

/**
 * Where a pattern goes: a strip in some space - arena tiles, or a picture's
 * pixels - running `from` to `to` along `dir` out of `origin`, `half` either
 * side of its middle line. `unit` is how big one tile of it is in the space it
 * is drawn in, and `toPixel` takes a point of that space to the screen.
 */
export interface FloorStrip {
  origin: { x: number; y: number };
  dir: { x: number; y: number };
  from: number;
  to: number;
  half: number;
  unit: number;
  toPixel: (x: number, y: number) => [number, number];
}

/**
 * A spoke's floor: squares, or a scatter of stars, laid along the spoke's own
 * direction so they turn with it on the Y. Dim on purpose - the seat tint goes
 * over it, and a body has to stand out against all three. `strength` brightens
 * it, and `speck` enlarges its stars, for a picture of one, where there is no
 * fight to read and a star the size of the board's would be lost.
 */
export function drawFloor(
  g: Graphics,
  kind: FloorKind,
  strip: FloorStrip,
  seed = 0,
  strength = 1,
  speck = 1,
): void {
  const { origin, dir } = strip;
  // Right of the line, walking out: the same side spokePolygon calls right.
  const at = (along: number, across: number): [number, number] =>
    strip.toPixel(
      origin.x + along * dir.x + across * dir.y,
      origin.y + along * dir.y - across * dir.x,
    );
  const flat = (corners: [number, number][]): number[] => corners.flat();

  if (kind === 'checker') {
    // Squares a tile and a half across - never a tile, so nothing reads as a
    // grid to stand on - in two tones, light ones lit and dark ones left.
    const cell = 1.5;
    const across = Math.max(1, Math.round((strip.half * 2) / cell));
    const size = (strip.half * 2) / across;
    let row = 0;
    for (let along = strip.from; along < strip.to - 0.01; along += size, row++) {
      const end = Math.min(strip.to, along + size);
      for (let column = 0; column < across; column++) {
        if ((row + column) % 2 !== 0) continue;
        const a = -strip.half + column * size;
        const b = a + size;
        g.poly(flat([at(along, a), at(end, a), at(end, b), at(along, b)])).fill({
          color: 0xdde3ee,
          alpha: Math.min(1, 0.1 * strength),
        });
      }
    }
    return;
  }

  // The starfield: night over the spoke, and stars no bigger than a speck.
  g.poly(
    flat([
      at(strip.from, -strip.half),
      at(strip.to, -strip.half),
      at(strip.to, strip.half),
      at(strip.from, strip.half),
    ]),
  ).fill({ color: 0x0b1030, alpha: Math.min(1, 0.42 * strength) });
  const area = (strip.to - strip.from) * strip.half * 2;
  const stars = Math.round(area * 1.6);
  for (let i = 0; i < stars; i++) {
    const along = strip.from + hash(seed + i, 21) * (strip.to - strip.from);
    const across = (hash(seed + i, 22) * 2 - 1) * strip.half * 0.96;
    const [x, y] = at(along, across);
    const roll = hash(seed + i, 23);
    if (roll < 0.08) {
      // Now and then a sparkle, still far smaller than any body.
      const r = strip.unit * 0.09 * speck;
      const w = r * 0.25;
      g.poly([
        x,
        y - r,
        x + w,
        y - w,
        x + r,
        y,
        x + w,
        y + w,
        x,
        y + r,
        x - w,
        y + w,
        x - r,
        y,
        x - w,
        y - w,
      ]).fill({
        color: 0xf4f6ff,
        alpha: 0.6,
      });
    } else {
      g.circle(x, y, strip.unit * (0.018 + hash(seed + i, 24) * 0.026) * speck).fill({
        color: roll < 0.3 ? 0xbcd2ff : 0xf4f6ff,
        alpha: 0.3 + hash(seed + i, 25) * 0.45,
      });
    }
  }
}

// ------------------------------------------------------------------ victory

export type VictoryKind = 'fireworks' | 'confetti';

const VICTORIES: Record<string, VictoryKind> = {
  victory_fireworks: 'fireworks',
  victory_confetti: 'confetti',
};

/** The flourish a victory cosmetic sets off, or none. */
export function victoryOf(id: string | null): VictoryKind | null {
  return id === null ? null : (VICTORIES[id] ?? null);
}

/** Colors a celebration may use: bright, warm and not the fight's to read. */
const FESTIVE = [0xf2c14e, 0xf0708a, 0x7be0b0, 0x7fd3f0, 0xb79bff, 0xffffff];

const FIREWORK_SHELLS = 8;
const SHELL_EVERY_MS = 520;
const RISE_MS = 650;
const BURST_MS = 1500;
const SPARKS = 26;
const CONFETTI_PIECES = 150;
const CONFETTI_MS = 5200;

/** How long a flourish runs, in milliseconds. */
export function victoryLength(kind: VictoryKind): number {
  return kind === 'fireworks'
    ? (FIREWORK_SHELLS - 1) * SHELL_EVERY_MS + RISE_MS + BURST_MS
    : CONFETTI_MS;
}

/**
 * Draw a flourish `ms` into it over a `width` by `height` screen. Pure in its
 * inputs, so a frame is the same however it was reached - and a picture of
 * one, for the Collection, is just a frame.
 */
export function drawVictory(
  g: Graphics,
  kind: VictoryKind,
  ms: number,
  width: number,
  height: number,
): void {
  if (kind === 'fireworks') drawFireworks(g, ms, width, height);
  else drawConfetti(g, ms, width, height);
}

function drawFireworks(g: Graphics, ms: number, width: number, height: number): void {
  const scale = Math.min(width, height) / 400;
  for (let shell = 0; shell < FIREWORK_SHELLS; shell++) {
    const start = shell * SHELL_EVERY_MS;
    const t = ms - start;
    if (t < 0) break;
    const x = width * (0.14 + 0.72 * hash(shell, 31));
    const burstY = height * (0.14 + 0.3 * hash(shell, 32));
    const color = FESTIVE[shell % FESTIVE.length]!;
    if (t < RISE_MS) {
      // Going up: a bright head and a short tail of sparks.
      const p = t / RISE_MS;
      const eased = 1 - (1 - p) * (1 - p);
      const y = height + 10 - (height + 10 - burstY) * eased;
      for (let i = 0; i < 5; i++) {
        g.circle(
          x + (hash(shell, 40 + i) - 0.5) * 3 * scale,
          y + i * 7 * scale,
          (2.2 - i * 0.35) * scale,
        ).fill({
          color: 0xfff1c2,
          alpha: 0.9 - i * 0.17,
        });
      }
      continue;
    }
    const b = (t - RISE_MS) / BURST_MS;
    if (b >= 1) continue;
    // The burst: sparks thrown out, slowing, falling, and fading.
    const reach = (70 + 50 * hash(shell, 33)) * scale;
    const out = 1 - (1 - Math.min(1, b * 1.6)) ** 3;
    const fall = 70 * scale * b * b;
    const fade = 1 - b;
    if (b < 0.18) {
      g.circle(x, burstY, reach * 0.3 * (1 - b / 0.18)).fill({
        color: 0xffffff,
        alpha: 0.5 * (1 - b / 0.18),
      });
    }
    for (let i = 0; i < SPARKS; i++) {
      const a = (i / SPARKS) * Math.PI * 2 + hash(shell, 50 + i) * 0.25;
      const speed = 0.75 + hash(shell, 80 + i) * 0.45;
      const sx = x + Math.cos(a) * reach * speed * out;
      const sy = burstY + Math.sin(a) * reach * speed * out + fall;
      const r = (2.4 * fade + 0.6) * scale;
      // A short streak back along where it came from.
      const back = reach * speed * 0.12 * (1 - b);
      const tx = sx - Math.cos(a) * back;
      const ty = sy - Math.sin(a) * back - fall * 0.08;
      const nx = -Math.sin(a) * r * 0.5;
      const ny = Math.cos(a) * r * 0.5;
      g.poly([sx + nx, sy + ny, tx, ty, sx - nx, sy - ny]).fill({ color, alpha: 0.55 * fade });
      g.circle(sx, sy, r).fill({ color: i % 4 === 0 ? 0xffffff : color, alpha: 0.95 * fade });
    }
  }
}

function drawConfetti(g: Graphics, ms: number, width: number, height: number): void {
  const scale = Math.min(width, height) / 400;
  const fallMs = 3000;
  for (let i = 0; i < CONFETTI_PIECES; i++) {
    const start = hash(i, 61) * (CONFETTI_MS - fallMs);
    const t = ms - start;
    if (t < 0 || t > fallMs) continue;
    const p = t / fallMs;
    const speed = 0.8 + hash(i, 62) * 0.5;
    const x0 = hash(i, 63) * width;
    const sway = Math.sin(p * Math.PI * (2 + hash(i, 64) * 3) + i) * 22 * scale;
    const x = x0 + sway;
    const y = -12 + (height + 24) * Math.min(1, p * speed);
    const spin = (hash(i, 65) - 0.5) * 18 * (t / 1000) + i;
    const w = (5 + hash(i, 66) * 5) * scale;
    const h = Math.max(1, w * 0.6 * Math.abs(Math.cos(spin)));
    const alpha = p > 0.85 ? (1 - p) / 0.15 : 1;
    g.rect(x - w / 2, y - h / 2, w, h).fill({ color: FESTIVE[i % FESTIVE.length]!, alpha });
  }
}

/** A flourish in miniature, for the Collection: a burst, or a scatter of confetti. */
export function drawVictoryIcon(
  g: Graphics,
  kind: VictoryKind,
  cx: number,
  cy: number,
  size: number,
): void {
  const s = size / 2;
  if (kind === 'fireworks') {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const color = FESTIVE[i % 4]!;
      const inner = s * 0.3;
      const outer = s * (i % 2 === 0 ? 0.95 : 0.75);
      const w = s * 0.07;
      const nx = -Math.sin(a) * w;
      const ny = Math.cos(a) * w;
      const x1 = cx + Math.cos(a) * inner;
      const y1 = cy + Math.sin(a) * inner;
      g.poly([
        x1 + nx,
        y1 + ny,
        cx + Math.cos(a) * outer,
        cy + Math.sin(a) * outer,
        x1 - nx,
        y1 - ny,
      ]).fill({
        color,
        alpha: 0.85,
      });
      g.circle(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, s * 0.09).fill({ color });
    }
    g.circle(cx, cy, s * 0.16).fill({ color: 0xffffff });
    return;
  }
  for (let i = 0; i < 11; i++) {
    const x = cx + (hash(i, 71) * 2 - 1) * s * 0.9;
    const y = cy + (hash(i, 72) * 2 - 1) * s * 0.9;
    const w = s * (0.22 + hash(i, 73) * 0.14);
    const h = w * (0.35 + hash(i, 74) * 0.4);
    const a = hash(i, 75) * Math.PI;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const corner = (u: number, v: number): [number, number] => [
      x + u * cos - v * sin,
      y + u * sin + v * cos,
    ];
    g.poly([
      ...corner(-w / 2, -h / 2),
      ...corner(w / 2, -h / 2),
      ...corner(w / 2, h / 2),
      ...corner(-w / 2, h / 2),
    ]).fill({
      color: FESTIVE[i % FESTIVE.length]!,
    });
  }
}

/**
 * A winner's flourish, over the end of a match. Seen by the winner, and by
 * anyone still watching when the match is won - the look is theirs to show.
 * Paint only: it never takes a tap.
 */
export class VictoryShow extends Container {
  private readonly g = new Graphics();
  private kind: VictoryKind | null = null;
  private ms = 0;
  private size = { width: 0, height: 0 };

  constructor() {
    super();
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.g);
  }

  get playing(): boolean {
    return this.kind !== null;
  }

  play(kind: VictoryKind, width: number, height: number): void {
    this.kind = kind;
    this.ms = 0;
    this.size = { width, height };
    this.visible = true;
    this.update(0);
  }

  /** The screen changed size: the flourish goes on, over the new one. */
  resize(width: number, height: number): void {
    this.size = { width, height };
  }

  stop(): void {
    this.kind = null;
    this.visible = false;
    this.g.clear();
  }

  update(deltaMs: number): void {
    if (!this.kind) return;
    this.ms += deltaMs;
    if (this.ms >= victoryLength(this.kind)) {
      this.stop();
      return;
    }
    this.g.clear();
    drawVictory(this.g, this.kind, this.ms, this.size.width, this.size.height);
  }
}

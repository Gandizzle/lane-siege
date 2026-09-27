/**
 * Small animated markers for what is happening to a body: burning, slowed,
 * shielded and the rest (src/sim/statusMarks.ts decides which).
 *
 * Every kind has its own SHAPE as well as its own colour, which is the rule
 * §14.2 set for the bodies themselves: colour is the second channel, so a
 * player who cannot tell the greens apart can still tell rising pluses
 * (healing) from rising bubbles (blight) from spikes in the ground (roots).
 *
 *   burning       flames licking up off the top
 *   blighted      bubbles rising and bursting
 *   slowed        ice crystals circling slowly
 *   rooted        spikes pinning it to the ground (drawn under the body)
 *   stunned       stars circling over it
 *   taunted       a red chevron pointing down at it
 *   shielded      a bubble round it
 *   regenerating  pluses rising
 *   empowered     chevrons rising on its right
 *   weakened      chevrons sinking on its left
 *   fortified     four corner brackets round it
 *
 * Small on purpose: a marker says "something is on this body" and the panel
 * says what, so nothing here may grow big enough to hide the silhouette that
 * says what the body IS. Every one scales with the body, with a floor so a
 * Mite's markers are still legible.
 *
 * Wall time, not ticks, like the other effects: a flame flickers at the same
 * speed whatever the simulation is doing. `seed` offsets each body's phase so
 * a burning crowd does not flicker in unison. Every shape is filled, with the
 * path seeded at its own first point, for the reason effects.ts gives.
 */

import type { Graphics } from 'pixi.js';
import { hasMark } from '../sim/index.ts';
import { DAMAGE_COLOURS } from './palette.ts';

export interface MarkedBody {
  /** Centre, in screen pixels. */
  cx: number;
  cy: number;
  /** Body radius, in screen pixels. */
  radius: number;
  /** `STATUS_MARKS` bits. */
  marks: number;
  /** Any number that differs between bodies; the id does. */
  seed: number;
}

const COLOURS = {
  flame: DAMAGE_COLOURS.blast,
  flameCore: 0xffd24a,
  blight: 0xb5d33d,
  ice: 0xa8e0ff,
  root: 0x9c7a3c,
  stun: 0xf0e442,
  taunt: 0xff5a5a,
  shield: 0xcfe9ff,
  regen: 0x5ee08a,
  empowered: 0xffd24a,
  weakened: 0xc084fc,
  fortified: 0xb8c4d6,
} as const;

const TAU = Math.PI * 2;

/** The markers that sit UNDER the body: roots come up out of the ground. */
export function drawMarksUnder(g: Graphics, body: MarkedBody, time: number): void {
  if (hasMark(body.marks, 'rooted')) drawRoots(g, body, time);
}

/** Every other marker, over the body. */
export function drawMarksOver(g: Graphics, body: MarkedBody, time: number): void {
  const m = body.marks;
  if (hasMark(m, 'shielded')) drawShield(g, body, time);
  if (hasMark(m, 'fortified')) drawBrackets(g, body, time);
  if (hasMark(m, 'slowed')) drawIce(g, body, time);
  if (hasMark(m, 'burning')) drawFlames(g, body, time);
  if (hasMark(m, 'blighted')) drawBubbles(g, body, time);
  if (hasMark(m, 'regenerating')) drawPluses(g, body, time);
  if (hasMark(m, 'empowered')) drawChevrons(g, body, time, 1);
  if (hasMark(m, 'weakened')) drawChevrons(g, body, time, -1);
  if (hasMark(m, 'stunned')) drawStars(g, body, time);
  if (hasMark(m, 'taunted')) drawTaunt(g, body, time);
}

/**
 * Marker scale in pixels. Larger than the body for small bodies and smaller
 * for big ones: a marker has to be legible on a Mite and must not swamp a
 * boss. Markers are ANCHORED to the body's edge (`radius`) and SIZED by this.
 */
function size(body: MarkedBody): number {
  return Math.min(26, Math.max(10, body.radius * 1.3));
}

/** A per-body phase in radians, from its seed. */
function phase(body: MarkedBody): number {
  return ((body.seed * 0.6180339887) % 1) * TAU;
}

function fill(g: Graphics, points: number[], colour: number, alpha: number): void {
  if (alpha <= 0.01 || points.length < 6) return;
  g.moveTo(points[0]!, points[1]!).poly(points).fill({ color: colour, alpha });
}

function dot(g: Graphics, x: number, y: number, r: number, colour: number, alpha: number): void {
  if (alpha <= 0.01 || r <= 0) return;
  g.moveTo(x + r, y)
    .circle(x, y, r)
    .fill({ color: colour, alpha });
}

/** The fractional part: where a repeating cycle is, 0 to 1. */
function cycle(x: number): number {
  return x - Math.floor(x);
}

// ------------------------------------------------------------------ markers

function drawFlames(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const p = phase(body);
  for (let i = 0; i < 3; i++) {
    const angle = -Math.PI / 2 + (i - 1) * 0.85;
    const bx = body.cx + Math.cos(angle) * body.radius * 0.75;
    const by = body.cy + Math.sin(angle) * body.radius * 0.75;
    // Out from the body and up, the way a flame leans off something burning.
    let dx = Math.cos(angle) * 0.6;
    let dy = Math.sin(angle) * 0.6 - 0.4;
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    const flicker = Math.sin(time * 12 + i * 2.1 + p) * 0.5 + Math.sin(time * 19 + i) * 0.5;
    const height = s * (0.6 + 0.2 * flicker) * (i === 1 ? 1.15 : 0.9);
    for (const [scale, colour] of [
      [1, COLOURS.flame],
      [0.55, COLOURS.flameCore],
    ] as const) {
      const h = height * scale;
      const w = s * 0.22 * scale;
      fill(
        g,
        [
          bx - dy * w,
          by + dx * w,
          bx + dx * h,
          by + dy * h,
          bx + dy * w,
          by - dx * w,
          bx - dx * w * 0.7,
          by - dy * w * 0.7,
        ],
        colour,
        0.95,
      );
    }
  }
}

function drawBubbles(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const p = phase(body);
  for (let i = 0; i < 3; i++) {
    const t = cycle(time / 1.3 + i / 3 + p);
    const x = body.cx + (i - 1) * body.radius * 0.6 + Math.sin(time * 3 + i + p) * s * 0.08;
    const y = body.cy - body.radius * 0.3 - t * s * 1.3;
    const alpha = 0.95 * (1 - t * 0.8) * Math.min(1, t * 5);
    dot(g, x, y, s * (0.14 + 0.08 * (1 - t)), COLOURS.blight, alpha);
  }
}

function drawIce(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const p = phase(body);
  const d = s * 0.22;
  const orbit = body.radius + s * 0.45;
  for (let i = 0; i < 3; i++) {
    const angle = time * 0.9 + (i * TAU) / 3 + p;
    const x = body.cx + Math.cos(angle) * orbit;
    const y = body.cy + Math.sin(angle) * orbit;
    fill(g, [x, y - d * 1.3, x + d * 0.8, y, x, y + d * 1.3, x - d * 0.8, y], COLOURS.ice, 0.95);
  }
}

function drawRoots(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const w = s * 0.16;
  for (let k = 0; k < 4; k++) {
    const angle = Math.PI / 4 + (k * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const inner = body.radius * 0.6;
    const outer = body.radius + s * (0.55 + 0.05 * Math.sin(time * 2 + k));
    fill(
      g,
      [
        body.cx + cos * inner - sin * w,
        body.cy + sin * inner + cos * w,
        body.cx + cos * outer,
        body.cy + sin * outer,
        body.cx + cos * inner + sin * w,
        body.cy + sin * inner - cos * w,
      ],
      COLOURS.root,
      0.95,
    );
  }
}

function drawStars(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const p = phase(body);
  const cy = body.cy - body.radius - s * 0.35;
  const rx = body.radius * 0.6 + s * 0.3;
  for (let i = 0; i < 3; i++) {
    const angle = time * 4.5 + (i * TAU) / 3 + p;
    const x = body.cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * s * 0.22;
    // Smaller at the back of the orbit, so it reads as circling rather than
    // sliding side to side.
    const q = s * 0.26 * (0.8 + 0.2 * Math.sin(angle));
    const points: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const r = k % 2 === 0 ? q : q * 0.4;
      points.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    fill(g, points, COLOURS.stun, 0.95);
  }
}

function drawTaunt(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const x = body.cx;
  const y = body.cy - body.radius - s * 0.8 - Math.sin(time * 5 + phase(body)) * s * 0.12;
  const w = s * 0.4;
  const h = s * 0.24;
  const k = s * 0.17;
  // A V pointing down at the body: this one is locked on.
  fill(
    g,
    [x - w, y - h, x - w + k, y - h, x, y + h - k * 1.6, x + w - k, y - h, x + w, y - h, x, y + h],
    COLOURS.taunt,
    0.95,
  );
}

function drawShield(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const r = body.radius + Math.max(3, s * 0.3);
  const shimmer = 0.5 + 0.5 * Math.sin(time * 3 + phase(body));
  g.moveTo(body.cx + r, body.cy)
    .circle(body.cx, body.cy, r)
    .fill({ color: COLOURS.shield, alpha: 0.1 + 0.06 * shimmer });
  g.moveTo(body.cx + r, body.cy)
    .circle(body.cx, body.cy, r)
    .stroke({ width: Math.max(1.5, s * 0.1), color: COLOURS.shield, alpha: 0.5 + 0.3 * shimmer });
}

function drawPluses(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const p = phase(body);
  for (let i = 0; i < 2; i++) {
    const t = cycle(time / 1.4 + i * 0.5 + p);
    const x = body.cx + (i === 0 ? -1 : 1) * (body.radius * 0.6 + s * 0.2);
    const y = body.cy + body.radius * 0.3 - t * s * 1.4;
    const a = s * 0.26;
    const th = Math.max(1, s * 0.09);
    const alpha = 0.95 * (1 - t) * Math.min(1, t * 6);
    if (alpha <= 0.01) continue;
    g.rect(x - a, y - th, a * 2, th * 2).fill({ color: COLOURS.regen, alpha });
    g.rect(x - th, y - a, th * 2, a * 2).fill({ color: COLOURS.regen, alpha });
  }
}

/** Two chevrons, rising on the right (`dir` 1) or sinking on the left (-1). */
function drawChevrons(g: Graphics, body: MarkedBody, time: number, dir: 1 | -1): void {
  const s = size(body);
  const w = s * 0.3;
  const h = s * 0.17 * dir;
  const k = s * 0.15;
  const x = body.cx + dir * (body.radius + s * 0.45);
  const travel = s * 0.4;
  const drift = cycle(time * 1.1 + phase(body)) * travel;
  for (let i = 0; i < 2; i++) {
    const y = body.cy + dir * (s * 0.25 - i * s * 0.45 - drift);
    const alpha = 0.95 * (1 - (drift / travel) * 0.6);
    fill(
      g,
      [
        x - w,
        y + h,
        x,
        y - h,
        x + w,
        y + h,
        x + w - k,
        y + h,
        x,
        y - h + k * 1.7 * dir,
        x - w + k,
        y + h,
      ],
      dir === 1 ? COLOURS.empowered : COLOURS.weakened,
      alpha,
    );
  }
}

function drawBrackets(g: Graphics, body: MarkedBody, time: number): void {
  const s = size(body);
  const b = body.radius + s * 0.3;
  const len = s * 0.4;
  const th = Math.max(1.5, s * 0.11);
  const alpha = 0.8 + 0.15 * Math.sin(time * 2 + phase(body));
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = body.cx + sx * b;
      const y = body.cy + sy * b;
      // The corner's two arms, each running back toward the body's middle.
      g.rect(sx > 0 ? x - len : x, sy > 0 ? y - th : y, len, th).fill({
        color: COLOURS.fortified,
        alpha,
      });
      g.rect(sx > 0 ? x - th : x, sy > 0 ? y - len : y, th, len).fill({
        color: COLOURS.fortified,
        alpha,
      });
    }
  }
}

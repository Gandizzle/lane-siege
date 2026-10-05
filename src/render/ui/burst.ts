/**
 * The celebration both big moments share: a ring thrown out from the middle,
 * rays turning off it, and confetti that flies out and falls - for a lane
 * cleared (waveCleared.ts) and a tutorial chapter finished
 * (chapterComplete.ts). One drawing, so the two read as the same kind of news.
 */

import type { Graphics } from 'pixi.js';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { CURRENCY_COLOURS } from './currency.ts';

/** One bit of confetti. */
export interface Bit {
  angle: number;
  speed: number;
  spin: number;
  size: number;
  colour: number;
}

/**
 * `count` bits of confetti, the same every time: a celebration is not the
 * place for a random number generator to make two of them look different.
 */
export function confetti(count: number): Bit[] {
  const colours = [
    CURRENCY_COLOURS.gold,
    DAMAGE_COLOURS.impact,
    DAMAGE_COLOURS.pierce,
    DAMAGE_COLOURS.arcane,
    UI.healthGood,
  ];
  const bits: Bit[] = [];
  for (let i = 0; i < count; i++) {
    const golden = (i * 0.61803398875) % 1;
    bits.push({
      angle: (i / count) * Math.PI * 2 + golden * 0.4,
      speed: 0.55 + golden * 0.6,
      spin: (golden - 0.5) * 14,
      size: 3 + ((i * 7) % 4),
      colour: colours[i % colours.length]!,
    });
  }
  return bits;
}

/**
 * Draw the burst `ageMs` after it began, centred on (`cx`, `cy`) and reaching
 * `reach` pixels out. Clears `g` first; past about two seconds it draws
 * nothing, and the words it was for are left on their own.
 */
export function drawBurst(
  g: Graphics,
  cx: number,
  cy: number,
  reach: number,
  ageMs: number,
  scale: number,
  bits: readonly Bit[],
): void {
  g.clear();
  const t = ageMs / 1000;

  // The ring: out fast, thinning as it goes.
  const ring = Math.min(1, t / 0.7);
  if (ring < 1) {
    g.circle(cx, cy, reach * easeOut(ring)).stroke({
      width: 6 * scale * (1 - ring),
      color: CURRENCY_COLOURS.gold,
      alpha: 0.8 * (1 - ring),
    });
  }

  // Rays, turning slowly, gone after a second and a half.
  const rays = Math.max(0, 1 - t / 1.5);
  if (rays > 0) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + t * 0.6;
      const inner = reach * 0.25;
      const outer = reach * (0.45 + 0.35 * easeOut(Math.min(1, t / 0.5)));
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner).lineTo(
        cx + Math.cos(a) * outer,
        cy + Math.sin(a) * outer,
      );
    }
    g.stroke({ width: 3 * scale, color: CURRENCY_COLOURS.gold, alpha: 0.45 * rays });
  }

  // Confetti: out along its angle, slowing, then falling, then gone.
  const life = 2.2;
  if (t < life) {
    for (const bit of bits) {
      const travel = reach * bit.speed * easeOut(Math.min(1, t / 0.9));
      const fall = 60 * scale * t * t;
      const x = cx + Math.cos(bit.angle) * travel;
      const y = cy + Math.sin(bit.angle) * travel + fall;
      const turn = bit.spin * t;
      const w = bit.size * scale;
      const h = w * 0.55 * Math.abs(Math.cos(turn));
      g.rect(x - w / 2, y - h / 2, w, Math.max(1, h)).fill({
        color: bit.colour,
        alpha: Math.max(0, 1 - t / life),
      });
    }
  }
}

export function easeOut(x: number): number {
  return 1 - (1 - x) * (1 - x);
}

/** Past 1 and back, for a pop. */
export function easeOutBack(x: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

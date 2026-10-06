/**
 * The counter hints on a unit card: a sword and a shield. DESIGN.md §9.3, §6.
 *
 * Two questions decide whether a unit is the right one for the coming wave,
 * and the damage chart answers both: does its DAMAGE land hard on the wave's
 * armor, and does its ARMOR shrug off the wave's damage. The sword answers the
 * first and the shield the second, green for good and red for bad, and a card
 * that is about even on one of them simply does not show that one
 * (sim/waves.ts, `summariseWave`).
 *
 * They were the words "▲ strong" and "▼ weak", which only ever answered the
 * first question: a unit that hit the wave hard and folded under it read as
 * the right choice.
 *
 * Drawn rather than emoji for the reasons the coin is (currency.ts), and laid
 * out the same way - as tokens in a `RichLabel` line.
 */

import type { Graphics } from 'pixi.js';
import { UI } from '../palette.ts';

export type Counter = 'sword-good' | 'sword-bad' | 'shield-good' | 'shield-bad';

/** The tokens, for building strings: `melee ${SWORD_GOOD}`. */
export const SWORD_GOOD = '{sword-good}';
export const SWORD_BAD = '{sword-bad}';
export const SHIELD_GOOD = '{shield-good}';
export const SHIELD_BAD = '{shield-bad}';

/** The same colors the stat panel uses for raised and lowered (buildBar.ts). */
export const COUNTER_COLORS = { good: UI.healthGood, bad: UI.danger } as const;

/** A darker rim, so the shape holds its edge on a dark card. */
const RIM = 0x10141c;

type Verdict = 'strong' | 'neutral' | 'weak';

/**
 * A unit card's hints, as tokens: the sword and then the shield, each only
 * where it is not about even, or nothing at all for a unit that is even on
 * both - or for a match that does not show the hints, which passes no rating.
 */
export function counterHints(
  rating: { verdict: Verdict; armorVerdict: Verdict } | undefined,
): string {
  if (!rating) return '';
  return [counterToken('sword', rating.verdict), counterToken('shield', rating.armorVerdict)]
    .filter((token) => token !== '')
    .join(' ');
}

/** A sword for a unit's damage, a shield for its armor, in the color of the verdict. */
export function counterToken(kind: 'sword' | 'shield', verdict: Verdict): string {
  if (verdict === 'neutral') return '';
  if (kind === 'sword') return verdict === 'strong' ? SWORD_GOOD : SWORD_BAD;
  return verdict === 'strong' ? SHIELD_GOOD : SHIELD_BAD;
}

/**
 * Draw one icon into `g`, filling the square at (`x`, `y`) of side `size`.
 *
 *   sword   point up and to the right, a crossguard, a grip and a pommel
 *   shield  a heater shield, flat across the top and pointed below, with a
 *           lighter boss down the middle so it reads as a shield and not a
 *           badge
 *
 * The bad ones are not only red: the sword is snapped, its point a shard
 * knocked aside, and the shield is split by a crack. Red and green are the
 * pair the commonest color blindness cannot tell apart, so the shape has to
 * say it too.
 */
export function drawCounter(g: Graphics, icon: Counter, x: number, y: number, size: number): void {
  const bad = icon.endsWith('bad');
  const color = bad ? COUNTER_COLORS.bad : COUNTER_COLORS.good;
  const rim = Math.max(0.6, size * 0.06);
  if (icon.startsWith('sword')) {
    drawSword(g, x, y, size, color, rim, bad);
  } else {
    drawShield(g, x, y, size, color, rim, bad);
  }
}

function drawSword(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  rim: number,
  broken: boolean,
): void {
  // Laid out upright in a unit square, then turned 45 degrees about its
  // centre so the point is top right, and scaled so the turned sword spans
  // the square corner to corner.
  const turn = Math.SQRT1_2;
  const stretch = 1.25;
  const at = (u: number, v: number): [number, number] => {
    const du = (u - 0.5) * stretch;
    const dv = (v - 0.5) * stretch;
    return [x + size * (0.5 + du * turn - dv * turn), y + size * (0.5 + du * turn + dv * turn)];
  };
  const shape = (points: [number, number][]) => points.flatMap(([u, v]) => at(u, v));

  // Whole, or snapped a third of the way down with a jagged edge, the point
  // a shard knocked off to the side.
  const blade = broken
    ? shape([
        [0.38, 0.62],
        [0.38, 0.27],
        [0.46, 0.33],
        [0.53, 0.24],
        [0.62, 0.31],
        [0.62, 0.62],
      ])
    : shape([
        [0.5, 0],
        [0.62, 0.14],
        [0.62, 0.62],
        [0.38, 0.62],
        [0.38, 0.14],
      ]);
  // The point: a triangle with a jagged foot, off to one side of the stump.
  const shard = broken
    ? shape(
        [
          [0.5, -0.04],
          [0.63, 0.1],
          [0.6, 0.18],
          [0.52, 0.13],
          [0.43, 0.19],
          [0.37, 0.1],
        ].map(([u, v]) => [u! + 0.12, v! - 0.03] as [number, number]),
      )
    : null;
  const guard = shape([
    [0.18, 0.6],
    [0.82, 0.6],
    [0.82, 0.72],
    [0.18, 0.72],
  ]);
  const grip = shape([
    [0.43, 0.72],
    [0.57, 0.72],
    [0.57, 0.88],
    [0.43, 0.88],
  ]);
  const [px, py] = at(0.5, 0.93);

  g.poly(blade).fill({ color }).stroke({ width: rim, color: RIM, join: 'round' });
  if (shard) g.poly(shard).fill({ color }).stroke({ width: rim, color: RIM, join: 'round' });
  g.poly(grip).fill({ color }).stroke({ width: rim, color: RIM, join: 'round' });
  g.poly(guard).fill({ color }).stroke({ width: rim, color: RIM, join: 'round' });
  g.circle(px, py, size * 0.085 * stretch)
    .fill({ color })
    .stroke({ width: rim, color: RIM });
}

function drawShield(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  rim: number,
  cracked: boolean,
): void {
  const left = x + size * 0.14;
  const right = x + size * 0.86;
  const top = y + size * 0.06;
  const shoulder = y + size * 0.5;
  const tip = y + size * 0.98;
  const mid = x + size / 2;
  g.moveTo(left, top)
    .lineTo(right, top)
    .lineTo(right, shoulder)
    .quadraticCurveTo(right, y + size * 0.8, mid, tip)
    .quadraticCurveTo(left, y + size * 0.8, left, shoulder)
    .closePath()
    .fill({ color })
    .stroke({ width: rim, color: RIM, join: 'round' });
  // The boss: a lighter band down the middle, the way a shield is painted.
  g.rect(mid - size * 0.07, top + rim, size * 0.14, size * 0.72).fill({
    color: 0xffffff,
    alpha: 0.35,
  });
  if (!cracked) return;
  // A crack from the top edge to the point, zigzagging across the boss.
  const at = (u: number, v: number) => [x + size * u, y + size * v];
  g.poly(
    [at(0.58, 0.06), at(0.4, 0.3), at(0.62, 0.5), at(0.42, 0.7), at(0.52, 0.92)].flat(),
    false,
  ).stroke({ width: Math.max(1, size * 0.12), color: RIM, join: 'miter', cap: 'butt' });
}

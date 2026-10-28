/**
 * Levels: what a pile of XP adds up to.
 *
 * Each level costs a fixed step more than the one before it - 300 XP to reach
 * level 2, then 400, 500, and so on (data/progression.json). A straight line
 * rather than a curve that compounds: the hundredth level asks for about
 * thirty matches where the second asked for one, which is "more and more"
 * without becoming a wall.
 *
 * The total to REACH a level is therefore a quadratic in the level, and
 * `levelOf` solves it directly rather than counting up a level at a time - a
 * player at level 400 is not a loop of four hundred.
 *
 * THE TOP
 *
 * The curve goes on for ever; the game stops it. Every level pays keys, and
 * the top level is the one that pays the last key there is anything to spend
 * on (`topLevel`, and store.ts for what that is) - so nobody banks keys ahead
 * of what is in the game, and every new builder or cosmetic raises it. XP past
 * the start of the top level does not count: `levelOf` stops there, and the
 * store never keeps any past it, or a raised top would pay it all out at once.
 */

import type { LevelCurve } from './config.ts';

/** Where a total of XP stands. */
export interface LevelProgress {
  /** 1 for a new player. */
  level: number;
  /** XP earned since reaching `level`. */
  into: number;
  /** XP the climb from `level` to the next one takes in all. */
  needed: number;
  /** All the XP there is that counts: none past the top. */
  total: number;
  /** At the top level: there is no next one yet, and no XP counts towards it. */
  atTop: boolean;
}

/** XP it takes to climb from `level` to `level + 1`. */
export function xpToNext(level: number, curve: LevelCurve): number {
  return curve.first + curve.step * (Math.max(1, level) - 1);
}

/** The total XP at which `level` begins: 0 for level 1. */
export function xpToReach(level: number, curve: LevelCurve): number {
  const n = Math.max(1, Math.floor(level)) - 1;
  return n * curve.first + (curve.step * n * (n - 1)) / 2;
}

/**
 * The top level, when unlocking everything there is costs `keys` and every
 * level pays `perLevel`: the level that pays the last of them. Level 1 pays
 * none, so it is one more than the levels the keys take. No top at all when
 * levels pay nothing, since then there is nothing to bank.
 */
export function topLevel(keys: number, perLevel: number): number {
  return perLevel > 0 ? 1 + Math.ceil(Math.max(0, keys) / perLevel) : Infinity;
}

/** The most XP that counts under a top level: what reaching it takes. */
export function xpCeiling(top: number, curve: LevelCurve): number {
  return Number.isFinite(top) ? xpToReach(top, curve) : Infinity;
}

/**
 * The level `total` XP reaches, and how far into it - stopping at `top`, the
 * top level, when there is one.
 */
export function levelOf(total: number, curve: LevelCurve, top = Infinity): LevelProgress {
  const xp = Math.min(Math.max(0, Math.floor(total)), xpCeiling(top, curve));
  // xpToReach(n + 1) = s/2·n² + (f − s/2)·n, solved for the largest n it
  // does not exceed, then nudged in case a square root rounded the wrong way.
  const { first: f, step: s } = curve;
  let n: number;
  if (s === 0) {
    n = Math.floor(xp / f);
  } else {
    const b = f - s / 2;
    n = Math.floor((-b + Math.sqrt(b * b + 2 * s * xp)) / s);
  }
  n = Math.max(0, n);
  while (n > 0 && xpToReach(n + 1, curve) > xp) n--;
  while (xpToReach(n + 2, curve) <= xp) n++;

  const level = n + 1;
  return {
    level,
    into: xp - xpToReach(level, curve),
    needed: xpToNext(level, curve),
    total: xp,
    atTop: level >= top,
  };
}

/**
 * Visual language. DESIGN.md §14.2.
 *
 * Placeholder art is the permanent plan, and the shapes carry real information:
 *
 *   Silhouette        one per body, in its armour type's family (shapes.ts)
 *   Fill colour       damage type
 *   Size + pips       tier
 *   Outline vs solid  monster vs defensive unit
 *
 * SHAPE is the primary channel, because armour type is what you must read
 * instantly on an incoming monster - which is what keeps the game
 * colourblind-safe. Colour is the secondary channel, and these four are drawn
 * from the Okabe-Ito palette so they stay distinguishable under the common
 * colour vision deficiencies as well.
 *
 * Everything here is drawn with Pixi Graphics calls. No sprites, no texture
 * atlas, no asset pipeline, and it scales to any screen density.
 */

import type { DamageType } from '../data/schema.ts';

export const DAMAGE_COLOURS: Record<DamageType, number> = {
  impact: 0xe69f00, // amber - raw force
  pierce: 0x56b4e9, // sky - armour-piercing
  blast: 0xd55e00, // vermillion - explosive
  arcane: 0xcc79a7, // orchid - energy
};

/**
 * Whose army is whose in the Final Showdown (§3.3, replaced), by seat.
 *
 * §14.2 spends every one of its channels on what a body IS - silhouette for
 * armour, fill for damage type, size and pips for tier - and a lane never
 * needs a fifth, because everything solid in it is yours. Four armies in one
 * arena do need one, so ownership gets a colour of its own: the ground each
 * spoke is tinted with, and a ring behind each body standing on it.
 *
 * Deliberately NOT four of the damage-type colours. A ring in the same amber
 * as an impact unit's fill would read as a statement about the unit rather
 * than about its owner. These four are from the same Okabe-Ito palette, so
 * they stay apart from each other under the common colour vision deficiencies
 * - and a player who cannot tell two of them apart can still read ownership
 * off which spoke an army walked out of.
 */
export const SEAT_COLOURS = [
  0x0072b2, // blue
  0xf0e442, // yellow
  0x009e73, // green
  0xf2f4f8, // bone
] as const;

export const UI = {
  background: 0x11131a,
  spawnZone: 0x1d1520,
  buildZone: 0x161a24,
  gridLine: 0x232936,
  fortressZone: 0x1a2030,
  /** The fortress wall itself: masonry, a shade above the ground it stands on. */
  fortressStone: 0x2f3648,
  buildBar: 0x0d0f15,
  tabs: 0x0d0f15,
  outline: 0xf2f4f8,
  text: 0xdfe4ee,
  textMuted: 0x8b93a5,
  healthGood: 0x6bbf59,
  healthLow: 0xd55e00,
  accent: 0x56b4e9,
  selected: 0xf2f4f8,
  danger: 0xd55e00,
  panel: 0x181c26,
  panelEdge: 0x2a3040,
  /** The Final Showdown's ground, and the square where the four spokes meet. */
  arenaFloor: 0x171b26,
  arenaCentre: 0x1d2231,
} as const;

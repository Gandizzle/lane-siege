/**
 * Visual language. DESIGN.md §14.2.
 *
 * Placeholder art is the permanent plan, and the shapes carry real information:
 *
 *   Silhouette        armour type   (circle / hexagon / triangle cluster / diamond)
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

import type { ArmourType, DamageType } from '../data/schema.ts';

export const DAMAGE_COLOURS: Record<DamageType, number> = {
  impact: 0xe69f00, // amber - raw force
  pierce: 0x56b4e9, // sky - armour-piercing
  blast: 0xd55e00, // vermillion - explosive
  arcane: 0xcc79a7, // orchid - energy
};

export const ARMOUR_SHAPES: Record<ArmourType, string> = {
  flesh: 'circle',
  plate: 'hexagon',
  swarm: 'cluster',
  ward: 'diamond',
};

export const UI = {
  background: 0x11131a,
  spawnZone: 0x1d1520,
  buildZone: 0x161a24,
  gridLine: 0x232936,
  fortressZone: 0x1a2030,
  buildBar: 0x0d0f15,
  tabs: 0x0d0f15,
  outline: 0xf2f4f8,
  text: 0xdfe4ee,
  textMuted: 0x8b93a5,
} as const;

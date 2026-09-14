/**
 * What a given attacker's attack LOOKS like. DESIGN.md §14.2.
 *
 * §14.2 gives the visual language for bodies: silhouette is armour type, fill
 * colour is damage type, size and pips are tier. An attack is made by a body, so
 * it is drawn in that same language rather than in a new one - a shot should be
 * recognisable as having come from the thing that fired it, without a legend.
 *
 * Five channels, every one of them read off the attacker's own definition, so
 * there is nothing to author and nothing that can drift out of step with a
 * balance change:
 *
 *   head shape   damage type   what it does on arrival
 *   colour       damage type   the same fill the body is drawn in
 *   size         damage        a mortar shell against a thornling's dart
 *   speed        range         so a long shot and a short one take about as
 *                              long to land, which is what reads as "fired at"
 *                              rather than "drifted toward"
 *   trail        armour        the body's own silhouette family, in miniature
 *
 * So two units of the same damage type are still told apart by size and trail,
 * and a tier 3 shot is visibly the same shot as its tier 1 - scaled, like the
 * body is.
 *
 * MELEE IS NOT A PROJECTILE
 *
 * A body whose reach is shorter than `RANGED_MIN_TILES` is touching what it
 * hits, so there is nowhere for a projectile to travel. It gets a swing instead
 * (effects.ts). The threshold sits in the gap the data actually has - melee
 * reaches are 0.08 to 0.15 tiles and the shortest real gun is 0.9 - so nothing
 * sits near the boundary and flickers between the two.
 */

import type { ArmourType, DamageType } from '../data/schema.ts';
import { DAMAGE_COLOURS } from './palette.ts';

/** Reach at or above which an attack is drawn as a projectile, in tiles. */
export const RANGED_MIN_TILES = 0.6;

/** How the head of a projectile is drawn. One per damage type. */
export type ProjectileShape = 'dart' | 'slug' | 'shell' | 'mote';

const SHAPE_BY_DAMAGE: Record<DamageType, ProjectileShape> = {
  // A thin spike, pointed along its flight. Armour-piercing.
  pierce: 'dart',
  // A blunt round thing with a streak behind it. Raw force.
  impact: 'slug',
  // Heavy and round, with a ring: something that will go off.
  blast: 'shell',
  // A diamond with a halo. Energy rather than matter.
  arcane: 'mote',
};

/** Trailing dots behind the head, by the attacker's armour family (§14.2). */
const TRAIL_BY_ARMOUR: Record<ArmourType, number> = {
  flesh: 1,
  plate: 2,
  ward: 2,
  swarm: 3,
};

export interface AttackStyle {
  /** False means a melee swing rather than a shot. */
  ranged: boolean;
  colour: number;
  shape: ProjectileShape;
  /** Head radius in TILES, so it survives a resize like everything else. */
  size: number;
  /** Tiles per second in flight. */
  speed: number;
  /** Dots trailing the head. */
  trail: number;
}

/** Damage that counts as a full-size shot. Above this, size stops growing. */
const DAMAGE_FOR_MAX_SIZE = 80;
const MIN_SIZE_TILES = 0.06;
const MAX_SIZE_TILES = 0.13;

/**
 * Roughly how long a shot should spend in the air, in seconds. Speed is derived
 * from this and the attacker's reach rather than being a stat of its own: a
 * projectile that takes half a second to cross five tiles reads as a lobbed
 * rock, and one that crosses one tile in the same time reads as broken.
 */
const TIME_IN_AIR = 0.16;
const MIN_SPEED = 6;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The style for one attacker.
 *
 * `tier` scales the head the same way §14.2 scales a body, so an upgraded unit's
 * shot is recognisably the same shot. Everything else is read straight off the
 * definition's own numbers.
 */
export function attackStyle(input: {
  damageType: DamageType;
  armour: ArmourType;
  /** Reach, edge to edge, in tiles. Decides melee or ranged, and the speed. */
  range: number;
  /** Damage per hit. Decides the size. */
  damage: number;
  tier?: number;
}): AttackStyle {
  const tier = input.tier ?? 1;
  const tierScale = 1 + (tier - 1) * 0.15;
  const size =
    (MIN_SIZE_TILES +
      (MAX_SIZE_TILES - MIN_SIZE_TILES) * clamp01(input.damage / DAMAGE_FOR_MAX_SIZE)) *
    tierScale;

  return {
    ranged: input.range >= RANGED_MIN_TILES,
    colour: DAMAGE_COLOURS[input.damageType],
    shape: SHAPE_BY_DAMAGE[input.damageType],
    size,
    speed: Math.max(MIN_SPEED, input.range / TIME_IN_AIR),
    trail: TRAIL_BY_ARMOUR[input.armour],
  };
}

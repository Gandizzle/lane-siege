/**
 * The four silhouettes and the tier pips. DESIGN.md §14.2.
 *
 * Drawn with Pixi Graphics primitives only. A monster is an outline, a
 * defensive unit is a solid fill - so at a glance you can tell what is yours
 * and what is coming for you, independent of colour.
 */

import { Graphics } from 'pixi.js';
import type { ArmourType, DamageType } from '../data/schema.ts';
import { DAMAGE_COLOURS } from './palette.ts';

export interface EntityStyle {
  armour: ArmourType;
  damageType: DamageType;
  /** 1..3. Drives size and the pip count (§7.3). */
  tier: number;
  /** Monsters are outlines; defensive units are solid (§14.2). */
  outlined: boolean;
}

/** Regular polygon points, flat-topped, centred on (cx, cy). */
function polygonPoints(cx: number, cy: number, radius: number, sides: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < sides; i++) {
    // Angles are constants of the shape, computed once per call. Determinism
    // does not apply here - this is the renderer, not the simulation.
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    points.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  return points;
}

function drawSilhouette(g: Graphics, armour: ArmourType, cx: number, cy: number, r: number): void {
  switch (armour) {
    case 'flesh':
      g.circle(cx, cy, r);
      break;
    case 'plate':
      g.poly(polygonPoints(cx, cy, r, 6));
      break;
    case 'ward':
      g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy]);
      break;
    case 'swarm': {
      // A cluster of small triangles: many small things, not one big thing.
      const small = r * 0.5;
      const offsets: [number, number][] = [
        [0, -r * 0.42],
        [-r * 0.46, r * 0.36],
        [r * 0.46, r * 0.36],
      ];
      for (const [ox, oy] of offsets) {
        g.poly(polygonPoints(cx + ox, cy + oy, small, 3));
      }
      break;
    }
  }
}

/**
 * Draws one entity into `g`. Radius is scaled by tier so a tier 3 unit reads as
 * bigger even before you count its pips.
 */
export function drawEntity(
  g: Graphics,
  style: EntityStyle,
  cx: number,
  cy: number,
  baseRadius: number,
): Graphics {
  const radius = baseRadius * (1 + (style.tier - 1) * 0.15);
  const colour = DAMAGE_COLOURS[style.damageType];

  drawSilhouette(g, style.armour, cx, cy, radius);

  if (style.outlined) {
    g.stroke({ width: Math.max(1.5, radius * 0.16), color: colour, alignment: 0.5 });
  } else {
    g.fill({ color: colour });
  }

  drawTierPips(g, style.tier, cx, cy + radius + baseRadius * 0.38, baseRadius * 0.13, colour);
  return g;
}

/** One pip per tier, in a row beneath the silhouette. Tier 1 draws none. */
export function drawTierPips(
  g: Graphics,
  tier: number,
  cx: number,
  cy: number,
  pipRadius: number,
  colour: number,
): void {
  if (tier <= 1) return;
  const spacing = pipRadius * 3;
  const start = cx - (spacing * (tier - 1)) / 2;
  for (let i = 0; i < tier; i++) {
    g.circle(start + i * spacing, cy, pipRadius).fill({ color: colour });
  }
}

/** Convenience: a fresh Graphics containing one entity. */
export function entityGraphic(style: EntityStyle, radius: number): Graphics {
  return drawEntity(new Graphics(), style, 0, 0, radius);
}

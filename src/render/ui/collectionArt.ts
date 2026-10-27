/**
 * The little pictures the Collection and the builder picker draw with.
 *
 * Shapes, like everything else in the game (§14.2): a builder is shown by its
 * own six units, a badge by its own glyph, a title by its own words, and the
 * slots nobody has made yet - fortress skins, trails, floors, flourishes - by
 * an icon that says what kind of thing is coming. And the key that unlocks
 * them, beside the padlock on what is still locked.
 */

import type { Graphics, StrokeInput } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import type { Cosmetic } from '../../progression/config.ts';
import { UI } from '../palette.ts';
import { drawEntity } from '../shapes.ts';
import { badgeColor, drawBadgeGlyph } from './levelBadge.ts';

/** A builder's six lines, mark 1 each, cheapest first, across `width`. */
export function drawRoster(
  g: Graphics,
  data: GameData,
  builderId: string,
  x: number,
  cy: number,
  width: number,
): void {
  const units = data.units.units
    .filter((u) => u.builderId === builderId && u.mark === 1)
    .sort((a, b) => a.rung - b.rung);
  if (units.length === 0) return;
  const step = width / units.length;
  const radius = Math.min(step * 0.36, 11);
  units.forEach((unit, i) => {
    drawEntity(
      g,
      { shape: unit.shape, damageType: unit.damageType, mark: 1, outlined: false },
      x + step * (i + 0.5),
      cy,
      radius,
    );
  });
}

/**
 * A cosmetic's picture, centred on (`cx`, `cy`), about `size` across. Titles
 * are drawn by their caller, since they are words.
 */
export function drawCosmeticIcon(
  g: Graphics,
  cosmetic: Cosmetic,
  cx: number,
  cy: number,
  size: number,
): void {
  const s = size / 2;
  const tint = tintOf(cosmetic.id);
  switch (cosmetic.slot) {
    case 'badge':
      if (cosmetic.glyph)
        drawBadgeGlyph(g, cosmetic.glyph, cx, cy, size * 0.8, badgeColor(cosmetic.glyph));
      return;
    case 'fortress': {
      // A wall with three merlons.
      const w = s * 1.7;
      const h = s * 0.9;
      const top = cy - h / 2 + s * 0.2;
      g.rect(cx - w / 2, top, w, h).fill({ color: tint });
      const m = w / 5;
      for (let i = 0; i < 3; i++) {
        g.rect(cx - w / 2 + m * (i * 2), top - s * 0.35, m, s * 0.35).fill({ color: tint });
      }
      return;
    }
    case 'trail': {
      // A shot and the streak it leaves.
      g.moveTo(cx - s, cy + s * 0.5)
        .lineTo(cx + s * 0.35, cy - s * 0.1)
        .lineTo(cx + s * 0.2, cy + s * 0.25)
        .closePath()
        .fill({ color: tint, alpha: 0.65 });
      g.circle(cx + s * 0.45, cy - s * 0.1, s * 0.3).fill({ color: tint });
      return;
    }
    case 'floor': {
      // A patch of patterned ground.
      const t = s * 0.6;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if ((i + j) % 2 === 0) continue;
          g.rect(cx - t * 1.5 + i * t, cy - t * 1.5 + j * t, t, t).fill({ color: tint });
        }
      }
      g.rect(cx - t * 1.5, cy - t * 1.5, t * 3, t * 3).stroke({ width: 1, color: tint });
      return;
    }
    case 'victory': {
      // A burst.
      const points: number[] = [];
      for (let i = 0; i < 16; i++) {
        const r = i % 2 === 0 ? s : s * 0.45;
        const a = (i * Math.PI) / 8;
        points.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.poly(points).fill({ color: tint });
      return;
    }
    default:
      g.circle(cx, cy, s * 0.6).fill({ color: tint });
  }
}

/**
 * A padlock, its body centred on (`cx`, `cy`): for what is not yours yet.
 */
export function drawPadlock(g: Graphics, cx: number, cy: number, color: number): void {
  g.roundRect(cx - 7, cy - 5.5, 14, 11, 2).fill({ color });
  strokeArc(g, cx, cy - 5.5, 4.5, Math.PI, 0, { width: 2, color });
}

/**
 * A key, centred on (`cx`, `cy`), about `size` across: a ring, a shaft and two
 * teeth. What every level pays, and what opens a padlock.
 */
export function drawKey(g: Graphics, cx: number, cy: number, size: number, color: number): void {
  const r = size * 0.24;
  const ringX = cx - size * 0.5 + r;
  g.circle(ringX, cy, r).fill({ color });
  g.circle(ringX, cy, r * 0.45).cut();
  const shaft = size * 0.13;
  const end = cx + size * 0.5;
  g.rect(ringX + r * 0.8, cy - shaft / 2, end - (ringX + r * 0.8), shaft).fill({ color });
  const tooth = size * 0.1;
  g.rect(end - tooth, cy, tooth, size * 0.2).fill({ color });
  g.rect(end - tooth * 2.8, cy, tooth, size * 0.15).fill({ color });
}

/**
 * An open arc - a shackle, a handle - stroked as a path of its own.
 *
 * Both obvious ways to draw one go wrong in Pixi, and both shipped. After a
 * fill, the next path starts where the last shape ended - the origin, after a
 * rectangle - and an arc joins on to that, so it came with a line from the
 * top-left corner. Moving to the arc's own first point instead puts that
 * point in twice, and a stroke that starts with a step of no length has no
 * direction to be widened across: its first corners are 0 / 0, NaN, which one
 * GPU drops and another draws as a spike to the corner. A fresh path has
 * neither.
 */
function strokeArc(
  g: Graphics,
  x: number,
  y: number,
  radius: number,
  start: number,
  end: number,
  style: StrokeInput,
): void {
  g.beginPath().arc(x, y, radius, start, end).stroke(style);
}

/**
 * A color for an item with no art yet, from its id, so two items in a slot
 * do not look identical: a handful of colors the fight does not lean on.
 */
function tintOf(id: string): number {
  const named: [string, number][] = [
    ['gilded', UI.level],
    ['obsidian', 0x6b5b95],
    ['granite', 0x8b93a5],
    ['ember', 0xe69f00],
    ['frost', 0x7fd3f0],
    ['starfield', 0x5865c8],
    ['checker', 0xc9d1e0],
    ['fireworks', 0xf0708a],
    ['confetti', UI.xp],
  ];
  for (const [word, color] of named) if (id.includes(word)) return color;
  return UI.accent;
}

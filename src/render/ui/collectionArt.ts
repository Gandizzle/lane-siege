/**
 * The little pictures the Collection and the builder picker draw with.
 *
 * Shapes, like everything else in the game (§14.2): a builder is shown by its
 * own six units, a badge by its own glyph, a title by its own words, and every
 * look by the look itself, drawn by the same code the board draws it with
 * (looks.ts) - a wall in its skin, a shot leaving its trail, a patch of its
 * floor, a flourish going off - so what is unlocked is what is seen. A
 * battlefield is a swatch of its own ground, painted by the Collection itself
 * (battlefield.ts). And the key that unlocks them, beside the padlock on what
 * is still locked.
 */

import type { Graphics, StrokeInput } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import type { Cosmetic } from '../../progression/config.ts';
import {
  drawFloor,
  drawFortress,
  drawTrailBit,
  drawVictoryIcon,
  floorOf,
  trailOf,
  victoryOf,
} from '../looks.ts';
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
  switch (cosmetic.slot) {
    case 'badge':
      if (cosmetic.glyph)
        drawBadgeGlyph(g, cosmetic.glyph, cx, cy, size * 0.8, badgeColor(cosmetic.glyph));
      return;
    case 'fortress':
      // The wall itself, in miniature, battlements and all.
      drawFortress(g, cosmetic.id, cx, cy + s * 0.1, s * 0.95, s * 0.5);
      return;
    case 'trail': {
      // A shot on its way up and across, and what it has left behind it.
      const kind = trailOf(cosmetic.id);
      const from = { x: cx - s * 1.05, y: cy + s * 0.55 };
      const to = { x: cx + s * 0.8, y: cy - s * 0.45 };
      const head = s * 0.34;
      if (kind) {
        for (let i = 1; i <= 5; i++) {
          const f = i / 6;
          drawTrailBit(
            g,
            kind,
            from.x + (to.x - from.x) * f,
            from.y + (to.y - from.y) * f,
            head * 1.2,
            (1 - f) * 230,
            i,
          );
        }
      }
      g.circle(to.x, to.y, head).fill({ color: UI.outline });
      return;
    }
    case 'floor': {
      // A patch of it, framed.
      const kind = floorOf(cosmetic.id);
      const unit = (s * 2) / 3;
      if (kind) {
        drawFloor(
          g,
          kind,
          {
            origin: { x: 0, y: 1.5 },
            dir: { x: 1, y: 0 },
            from: 0,
            to: 3,
            half: 1.5,
            unit,
            toPixel: (x, y) => [cx - s + x * unit, cy - s + y * unit],
          },
          7,
          kind === 'checker' ? 4 : 1.8,
          4,
        );
      }
      g.roundRect(cx - s, cy - s, s * 2, s * 2, 3).stroke({ width: 1, color: UI.panelEdge });
      return;
    }
    case 'victory': {
      const kind = victoryOf(cosmetic.id);
      if (kind) drawVictoryIcon(g, kind, cx, cy, size);
      return;
    }
    default:
      g.circle(cx, cy, s * 0.6).fill({ color: UI.accent });
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

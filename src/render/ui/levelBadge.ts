/**
 * The pieces progression is drawn with wherever it appears: the level badge a
 * player shows off, the XP bar climbing towards the next one, and the little
 * shapes badges are worn as.
 *
 * Gold for a level and violet for XP (palette.ts): colors the fight never
 * uses, so nothing about a player's standing can be mistaken for something
 * about a body.
 */

import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { BadgeGlyph } from '../../progression/config.ts';
import { UI } from '../palette.ts';
import { label } from './text.ts';

/** "Lv 12" on a gold pill. Height decides the type size; the width follows. */
export class LevelBadge extends Container {
  private readonly pill = new Graphics();
  private readonly words: Text;
  private shown = '';
  private h = 0;

  constructor() {
    super();
    this.words = label('', 11, UI.background, '700');
    this.addChild(this.pill, this.words);
  }

  /** Width it ends up, so whatever sits beside it can be placed. */
  set(level: number, height: number): number {
    const text = `Lv ${level}`;
    if (text !== this.shown || height !== this.h) {
      this.shown = text;
      this.h = height;
      this.words.text = text;
      this.words.style.fontSize = Math.max(9, Math.round(height * 0.6));
      const w = Math.ceil(this.words.width + height * 0.7);
      this.pill.clear();
      this.pill.roundRect(0, 0, w, height, height / 2).fill({ color: UI.level });
      this.words.position.set((w - this.words.width) / 2, (height - this.words.height) / 2);
    }
    return this.width;
  }
}

/** A bar from 0 to 1, in XP violet on a recessed track. */
export function drawXpBar(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
  color: number = UI.xp,
): void {
  const f = Math.max(0, Math.min(1, fraction));
  const r = height / 2;
  g.roundRect(x, y, width, height, r).fill({ color: UI.background });
  if (f > 0) g.roundRect(x, y, Math.max(height, width * f), height, r).fill({ color });
  g.roundRect(x, y, width, height, r).stroke({ width: 1, color: UI.panelEdge });
}

/**
 * A badge's shape, centred on (`cx`, `cy`) and `size` across: a heart, a
 * shield or a star. Drawn rather than loaded, like every other shape here.
 */
export function drawBadgeGlyph(
  g: Graphics,
  glyph: BadgeGlyph,
  cx: number,
  cy: number,
  size: number,
  color: number,
): void {
  const s = size / 2;
  if (glyph === 'heart') {
    // Two lobes and a point, as one closed path.
    g.moveTo(cx, cy + s * 0.85)
      .bezierCurveTo(cx - s * 1.25, cy - s * 0.05, cx - s * 0.6, cy - s * 1.05, cx, cy - s * 0.35)
      .bezierCurveTo(cx + s * 0.6, cy - s * 1.05, cx + s * 1.25, cy - s * 0.05, cx, cy + s * 0.85)
      .fill({ color });
    return;
  }
  if (glyph === 'shield') {
    g.moveTo(cx, cy - s)
      .lineTo(cx + s * 0.85, cy - s * 0.65)
      .lineTo(cx + s * 0.75, cy + s * 0.2)
      .quadraticCurveTo(cx + s * 0.45, cy + s * 0.75, cx, cy + s)
      .quadraticCurveTo(cx - s * 0.45, cy + s * 0.75, cx - s * 0.75, cy + s * 0.2)
      .lineTo(cx - s * 0.85, cy - s * 0.65)
      .closePath()
      .fill({ color });
    return;
  }
  // A five-pointed star.
  const points: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s : s * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.poly(points).fill({ color });
}

/** The color each badge shape is worn in. */
export function badgeColor(glyph: BadgeGlyph): number {
  return glyph === 'heart' ? UI.support : glyph === 'star' ? UI.level : UI.accent;
}

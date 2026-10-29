/**
 * The badges beside a name, as everybody sees them: in a lobby's seat cards
 * and on the tabs across the top of a match (lobbyScreen.ts, opponentTabs.ts).
 * What is in the row is what the server checked (server/playerStore.ts) and
 * sent with the names (`WornBadge`), never what a device claimed.
 *
 * Each badge is its own shape in its own color (levelBadge.ts): a heart, a
 * shield, a star. A Founder's star carries its number - beside it rather
 * than inside, since at the size a name block allows a number inside a star
 * is a smudge.
 *
 * Built once and redrawn in place: the row is decoration, never a button, so
 * it can be rebuilt freely, but there is no need to.
 */

import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { COSMETICS, type CosmeticsConfig } from '../../progression/config.ts';
import type { WornBadge } from '../../sim/index.ts';
import { UI } from '../palette.ts';
import { badgeColor, drawBadgeGlyph } from './levelBadge.ts';
import { label } from './text.ts';

export class BadgeRow extends Container {
  private readonly glyphs = new Graphics();
  private readonly numbers: Text[] = [];
  private shown = '';
  private rowWidth = 0;

  constructor(private readonly cosmetics: CosmeticsConfig = COSMETICS) {
    super();
    this.addChild(this.glyphs);
  }

  /** How wide the row came out, so whatever is beside it can be placed. 0 for no badges. */
  get rowW(): number {
    return this.rowWidth;
  }

  /** Draw `badges`, each `size` across, centred on y = size / 2. Returns the row's width. */
  set(badges: readonly WornBadge[], size: number): number {
    const signature = `${size}|${badges.map((b) => `${b.id}#${b.number ?? ''}`).join(',')}`;
    if (signature === this.shown) return this.rowWidth;
    this.shown = signature;
    this.glyphs.clear();
    for (const text of this.numbers) text.visible = false;
    const gap = Math.max(2, Math.round(size * 0.25));
    let x = 0;
    let used = 0;
    for (const badge of badges) {
      const glyph = this.cosmetics.cosmetics.find((c) => c.id === badge.id)?.glyph;
      if (!glyph) continue;
      if (x > 0) x += gap;
      drawBadgeGlyph(this.glyphs, glyph, x + size / 2, size / 2, size, badgeColor(glyph));
      x += size;
      if (badge.number !== null) {
        const text = this.numbers[used] ?? this.addNumber();
        used += 1;
        text.text = `#${badge.number}`;
        text.style.fontSize = Math.max(8, Math.round(size * 0.85));
        text.visible = true;
        text.position.set(x + 1, (size - text.height) / 2);
        x += 1 + text.width;
      }
    }
    this.rowWidth = x;
    return x;
  }

  private addNumber(): Text {
    const text = label('', 10, UI.level, '700');
    this.numbers.push(text);
    this.addChild(text);
    return text;
  }
}

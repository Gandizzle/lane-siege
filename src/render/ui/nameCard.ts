/**
 * Who you are, on the home screen: your name, the level you have reached, the
 * title and badges you have chosen to wear (cosmetics), and how far you are
 * towards the next level.
 *
 * The level sits beside the name because it is there to be seen - it buys
 * nothing in a match, and the only thing it is for is showing how long you
 * have been at this. Tapping the card changes the name, as the plain name row
 * it replaced did.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { waveCount } from '../../progression/award.ts';
import type { BadgeGlyph } from '../../progression/config.ts';
import type { LevelProgress } from '../../progression/levels.ts';
import { UI } from '../palette.ts';
import { LevelBadge, badgeColor, drawBadgeGlyph, drawXpBar } from './levelBadge.ts';
import { fit, label } from './text.ts';

/** What the card shows. */
export interface NameCardState {
  name: string;
  level: LevelProgress;
  /** The title being worn, or null. */
  title: string | null;
  /** Badges being worn, in catalogue order. */
  badges: BadgeGlyph[];
  /** Boosted waves left; 0 for none. */
  boostWaves: number;
  /** A Supporter's boost, on for good. */
  boostAlways: boolean;
}

export class NameCard extends Container {
  private readonly bg = new Graphics();
  private readonly glyphs = new Graphics();
  private readonly bar = new Graphics();
  private readonly nameText: Text;
  private readonly titleText: Text;
  private readonly hint: Text;
  private readonly xpText: Text;
  private readonly badge = new LevelBadge();
  private state: NameCardState | null = null;
  private box = { x: 0, y: 0, width: 0, height: 0 };

  constructor(onTap: () => void) {
    super();
    this.nameText = label('', 15, UI.text, '700');
    this.titleText = label('', 11, UI.level, '600');
    this.hint = label('tap to change', 10, UI.textMuted);
    this.xpText = label('', 10, UI.textMuted, '600');
    this.addChild(
      this.bg,
      this.glyphs,
      this.bar,
      this.nameText,
      this.titleText,
      this.hint,
      this.xpText,
      this.badge,
    );
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  /** The card's height for a layout: shorter on a cramped screen. */
  static height(compact: boolean): number {
    return compact ? 70 : 78;
  }

  place(x: number, y: number, width: number, height: number): void {
    this.box = { x, y, width, height };
    this.hitArea = new Rectangle(x, y, width, height);
    this.redraw();
  }

  set(state: NameCardState): void {
    this.state = state;
    this.redraw();
  }

  private redraw(): void {
    const s = this.state;
    const { x, y, width, height } = this.box;
    if (!s || width <= 0) return;
    const pad = 14;

    this.bg.clear();
    this.bg
      .roundRect(x, y, width, height, 10)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });

    // Line one: the name, the badges worn after it, and the level at the end.
    const badgeH = 20;
    const badgeW = this.badge.set(s.level.level, badgeH);
    this.badge.position.set(x + width - pad - badgeW, y + 10);
    const glyphSize = 13;
    const glyphRoom = s.badges.length * (glyphSize + 4);
    const nameRoom = width - pad * 2 - badgeW - 10 - glyphRoom;
    this.nameText.text = fit(s.name, nameRoom, 15);
    this.nameText.position.set(x + pad, y + 10);
    this.glyphs.clear();
    let gx = x + pad + this.nameText.width + 6 + glyphSize / 2;
    for (const glyph of s.badges) {
      drawBadgeGlyph(this.glyphs, glyph, gx, y + 20, glyphSize, badgeColor(glyph));
      gx += glyphSize + 4;
    }

    // Line two: the title being worn, and on the right either the running
    // boost - something worth knowing before a match - or how to edit.
    this.titleText.text = s.title ? fit(s.title, width / 2, 11) : '';
    this.titleText.position.set(x + pad, y + 31);
    const boosted = s.boostAlways || s.boostWaves > 0;
    this.hint.text = s.boostAlways
      ? 'XP boost: always on'
      : boosted
        ? `XP boost: ${waveCount(s.boostWaves)}`
        : 'tap to change';
    this.hint.style.fill = boosted ? UI.xp : UI.textMuted;
    this.hint.style.fontWeight = boosted ? '700' : '500';
    this.hint.position.set(x + width - pad - this.hint.width, y + 31);

    // Line three: the climb to the next level.
    const { into, needed } = s.level;
    this.xpText.text = `${into.toLocaleString('en-GB')} / ${needed.toLocaleString('en-GB')} XP`;
    const barY = y + height - 18;
    const barW = width - pad * 2 - this.xpText.width - 10;
    this.bar.clear();
    drawXpBar(this.bar, x + pad, barY, barW, 8, needed > 0 ? into / needed : 0);
    this.xpText.position.set(x + width - pad - this.xpText.width, barY - 3);
  }
}

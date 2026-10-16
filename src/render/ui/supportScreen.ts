/**
 * Support: becoming a Supporter. PLACEHOLDER: nothing can be bought yet.
 *
 * One purchase, for good, and the plainest thing the game sells - a thank-you
 * with a little attached (data/store.json): bonus XP on every match, boosts
 * without the ad, a badge by your name, and your name in the credits. It
 * changes nothing about who wins, and the page says so.
 *
 * The pitch is the developer's own words, from the data file, so it can be
 * rewritten without touching this. The heart beats; the button is gold.
 * Until there is a payment provider the button says purchases are not open
 * yet (the game's `onBuy`), except in the `?progress=test` build, which grants
 * it on the device - and offers a way to take every test purchase back.
 */

import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { percent } from '../../progression/award.ts';
import type { ProgressStore } from '../../progression/store.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { drawBadgeGlyph } from './levelBadge.ts';
import type { PanelButton } from './menu.ts';
import { Sheet } from './sheet.ts';
import { centreOn, label, wrapped } from './text.ts';

export interface SupportHandlers {
  onClose(): void;
  onBuy(itemId: string, name: string): void;
  /** `?progress=test` only: undo every test purchase. */
  onResetTest(): void;
}

export class SupportScreen extends Sheet {
  private readonly heart = new Graphics();
  private readonly checks = new Graphics();
  private readonly headline: Text;
  private readonly pitch: Text;
  private readonly perks: Text[];
  private readonly buy: PanelButton;
  private readonly footnote: Text;
  private readonly reset: PanelButton;
  private clock = 0;
  private heartAt = { cx: 0, cy: 0 };

  constructor(
    layout: LaneLayout,
    private readonly progress: ProgressStore,
    private readonly testMode: boolean,
    private readonly handlers: SupportHandlers,
  ) {
    super(layout, 'Support', '', () => handlers.onClose());
    const supporter = progress.store.supporter;
    this.headline = label('', 18, UI.text, '700');
    this.pitch = wrapped(supporter.pitch, 12, UI.textMuted);
    this.perks = supporter.perks.map((perk) => wrapped(perk, 13, UI.text));
    this.buy = this.button('', () => this.handlers.onBuy('supporter', 'Supporter'), 15);
    this.footnote = wrapped('', 10, UI.textMuted);
    this.reset = this.button('Reset test purchases', () => this.handlers.onResetTest(), 11);
    this.body.addChild(
      this.heart,
      this.headline,
      this.pitch,
      this.checks,
      ...this.perks,
      this.buy,
      this.footnote,
      this.reset,
    );
  }

  refresh(): void {
    if (this.visible) this.arrange();
  }

  /** The heartbeat. */
  update(deltaMs: number): void {
    if (!this.visible) return;
    this.clock += deltaMs / 1000;
    const t = this.clock % 1.4;
    const beat = t < 0.15 ? t / 0.15 : t < 0.3 ? 1 - (t - 0.15) / 0.15 : 0;
    const second =
      t >= 0.35 && t < 0.5 ? (t - 0.35) / 0.15 : t >= 0.5 && t < 0.65 ? 1 - (t - 0.5) / 0.15 : 0;
    const size = 64 * (1 + 0.1 * Math.max(beat, second * 0.7));
    this.heart.clear();
    // A soft glow behind it, and the heart.
    this.heart.circle(this.heartAt.cx, this.heartAt.cy, 46).fill({ color: UI.support, alpha: 0.1 });
    drawBadgeGlyph(this.heart, 'heart', this.heartAt.cx, this.heartAt.cy, size, UI.support);
  }

  protected layoutBody(width: number): number {
    const supporter = this.progress.profile.supporter;
    const store = this.progress.store.supporter;
    const cx = width / 2;
    let y = 6;
    this.heartAt = { cx, cy: y + 44 };
    this.update(0);
    y += 96;

    this.headline.text = supporter ? 'You are a Supporter. Thank you!' : 'Become a Supporter';
    centreOn(this.headline, cx, y);
    y += 30;
    this.pitch.style.wordWrapWidth = width - 16;
    this.pitch.style.align = 'center';
    centreOn(this.pitch, cx, y);
    y += this.pitch.height + 18;

    // What it comes with, each with a tick - the bonus spelled out from the
    // number the XP is actually counted with.
    this.checks.clear();
    const bonus = percent(this.progress.config.supporter.bonus);
    this.perks.forEach((perk, i) => {
      perk.text = (store.perks[i] ?? '').replaceAll('{bonus}', bonus);
      perk.style.wordWrapWidth = width - 52;
      const tx = 16;
      const ty = y + 9;
      this.checks
        .moveTo(tx, ty)
        .lineTo(tx + 5, ty + 5)
        .lineTo(tx + 14, ty - 5)
        .stroke({
          width: 2.5,
          color: supporter ? UI.healthGood : UI.level,
          cap: 'round',
          join: 'round',
        });
      perk.position.set(tx + 26, y);
      y += Math.max(26, perk.height + 10);
    });
    y += 12;

    this.buy.place(0, y, width, 48);
    this.buy.set(
      supporter ? 'Supporter · thank you' : `Become a Supporter · ${store.price}`,
      'primary',
      !supporter,
    );
    y += 58;

    this.footnote.text = this.testMode
      ? 'Test build: buying here grants it on this device, and nothing is charged.'
      : 'Purchases are not open yet. This is what the page will offer when they are.';
    this.footnote.style.wordWrapWidth = width - 16;
    this.footnote.style.align = 'center';
    centreOn(this.footnote, cx, y);
    y += this.footnote.height + 12;

    this.reset.visible = this.testMode;
    if (this.testMode) {
      this.reset.place(width / 4, y, width / 2, 30);
      this.reset.set('Reset test purchases', 'plain');
      y += 40;
    }
    return y;
  }
}

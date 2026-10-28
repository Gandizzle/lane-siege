/**
 * Supporter: the one thing the game sells. PLACEHOLDER: nothing can be bought
 * yet.
 *
 * One purchase, for good (data/store.json). Everything else - every builder,
 * every cosmetic - is earned by playing, with the keys each level pays, so
 * this is a thank-you with a little attached: bonus XP on every match, the
 * ad's XP boost always on with no ad, a badge by your name, and your name in
 * the credits. It changes nothing about who wins, and the page says so.
 *
 * It leads with what it is worth, "+125% XP", worked out from the numbers the
 * XP is counted with: a page that only said "support" would be skipped by
 * people who never learned it also boosts their XP, and one that only said
 * "boost" would be selling something without saying so. At the top level
 * (store.ts), where no XP counts until new content raises it, it says that
 * too, under the number, rather than sell a boost with nothing to boost. The
 * pitch is the developer's own words, from the data file, so it can be
 * rewritten without touching this. The heart beats.
 *
 * And the Founders: at launch the first players to claim it get all of this
 * free, with a Founder badge and title. Counting them needs a server, so for
 * now only the `?progress=test` build shows the claim, and grants it on the
 * device. Until there is a payment provider the buy button says purchases are
 * not open yet (the game's `buySupporter`), except in that build, which
 * grants it too - and offers a way to take both back.
 */

import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { percent } from '../../progression/award.ts';
import type { ProgressStore } from '../../progression/store.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { badgeColor, drawBadgeGlyph } from './levelBadge.ts';
import type { PanelButton } from './menu.ts';
import { Sheet } from './sheet.ts';
import { centreOn, label, wrapped } from './text.ts';

export interface SupportHandlers {
  onClose(): void;
  onBuy(): void;
  /** `?progress=test` only, until there is a server to count the claims. */
  onClaimFounder(): void;
  /** `?progress=test` only: undo Supporter and Founder. */
  onResetTest(): void;
}

/** What a Supporter earns on top, in all: the ad's boost always on, and their own. */
export function supporterBonus(progress: ProgressStore): string {
  return percent(progress.config.adBoost.bonus + progress.config.supporter.bonus);
}

export class SupportScreen extends Sheet {
  private readonly heart = new Graphics();
  private readonly checks = new Graphics();
  private readonly headline: Text;
  private readonly worth: Text;
  private readonly worthNote: Text;
  /** At the top level: why the XP is waiting. */
  private readonly topNote: Text;
  private readonly pitch: Text;
  private readonly perks: Text[];
  private readonly buy: PanelButton;
  private readonly footnote: Text;
  private readonly founderCard = new Graphics();
  private readonly founderTitle: Text;
  private readonly founderPitch: Text;
  private readonly claim: PanelButton;
  private readonly reset: PanelButton;
  private clock = 0;
  private heartAt = { cx: 0, cy: 0 };

  constructor(
    layout: LaneLayout,
    private readonly progress: ProgressStore,
    private readonly testMode: boolean,
    private readonly handlers: SupportHandlers,
  ) {
    super(layout, 'Supporter', '', () => handlers.onClose());
    const store = progress.store;
    this.headline = label('', 18, UI.text, '700');
    this.worth = label('', 30, UI.level, '700');
    this.worthNote = label('on every match, for good, with no ads', 12, UI.textMuted, '600');
    this.topNote = wrapped('', 11, UI.xp);
    this.topNote.style.fontWeight = '700';
    this.topNote.style.align = 'center';
    this.pitch = wrapped(store.supporter.pitch, 12, UI.textMuted);
    this.perks = store.supporter.perks.map((perk) => wrapped(perk, 13, UI.text));
    this.buy = this.button('', () => this.handlers.onBuy(), 15);
    this.footnote = wrapped('', 10, UI.textMuted);
    this.founderTitle = label('Founders', 15, UI.text, '700');
    this.founderPitch = wrapped(
      store.founders.pitch.replaceAll('{count}', String(store.founders.count)),
      12,
      UI.textMuted,
    );
    this.claim = this.button('', () => this.handlers.onClaimFounder(), 13);
    this.reset = this.button('Reset test purchases', () => this.handlers.onResetTest(), 11);
    this.body.addChild(
      this.heart,
      this.headline,
      this.worth,
      this.worthNote,
      this.topNote,
      this.pitch,
      this.checks,
      ...this.perks,
      this.buy,
      this.footnote,
      this.founderCard,
      this.founderTitle,
      this.founderPitch,
      this.claim,
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
    const { supporter, founder } = this.progress.profile;
    const store = this.progress.store.supporter;
    const cx = width / 2;
    let y = 6;
    this.heartAt = { cx, cy: y + 44 };
    this.update(0);
    y += 96;

    this.headline.text = founder
      ? 'You are a Founder. Thank you!'
      : supporter
        ? 'You are a Supporter. Thank you!'
        : 'Become a Supporter';
    centreOn(this.headline, cx, y);
    y += 30;
    // What it is worth, first and biggest.
    this.worth.text = `+${supporterBonus(this.progress)} XP`;
    centreOn(this.worth, cx, y);
    y += 38;
    centreOn(this.worthNote, cx, y);
    y += 26;
    const { level, atTop } = this.progress.level;
    this.topNote.visible = atTop;
    if (atTop) {
      this.topNote.text =
        `You are at level ${level}, the top for now: XP counts again, boost and all, ` +
        'when new builders and cosmetics raise it.';
      this.topNote.style.wordWrapWidth = width - 32;
      centreOn(this.topNote, cx, y - 4);
      y += this.topNote.height + 14;
    }
    this.pitch.style.wordWrapWidth = width - 16;
    this.pitch.style.align = 'center';
    centreOn(this.pitch, cx, y);
    y += this.pitch.height + 18;

    // What it comes with, each with a tick - the bonus spelled out from the
    // number the XP is actually counted with.
    this.checks.clear();
    const bonus = percent(this.progress.config.supporter.bonus);
    const boost = percent(this.progress.config.adBoost.bonus);
    const perks = supporter || founder;
    this.perks.forEach((perk, i) => {
      perk.text = (store.perks[i] ?? '').replaceAll('{bonus}', bonus).replaceAll('{boost}', boost);
      perk.style.wordWrapWidth = width - 52;
      const tx = 16;
      const ty = y + 9;
      this.checks
        .moveTo(tx, ty)
        .lineTo(tx + 5, ty + 5)
        .lineTo(tx + 14, ty - 5)
        .stroke({
          width: 2.5,
          color: perks ? UI.healthGood : UI.level,
          cap: 'round',
          join: 'round',
        });
      perk.position.set(tx + 26, y);
      y += Math.max(26, perk.height + 10);
    });
    y += 12;

    this.buy.place(0, y, width, 48);
    this.buy.set(
      supporter
        ? 'Supporter · thank you'
        : founder
          ? 'Founder · all of this is yours'
          : `Become a Supporter · ${store.price}`,
      'primary',
      !perks,
    );
    y += 58;

    this.footnote.text = this.testMode
      ? 'Test build: buying here grants it on this device, and nothing is charged.'
      : 'One purchase, yours for good. Purchases are not open yet: this is what the page will offer when they are.';
    this.footnote.style.wordWrapWidth = width - 16;
    this.footnote.style.align = 'center';
    centreOn(this.footnote, cx, y);
    y += this.footnote.height + 16;

    // The Founders, while there are claims to make - for now, in the test
    // build - and always for a Founder, whose page it is.
    const founders = this.testMode || founder;
    for (const piece of [this.founderCard, this.founderTitle, this.founderPitch, this.claim]) {
      piece.visible = founders;
    }
    if (founders) y = this.layoutFounders(y, width, founder);

    this.reset.visible = this.testMode;
    if (this.testMode) {
      this.reset.place(width / 4, y, width / 2, 30);
      this.reset.set('Reset test purchases', 'plain');
      y += 40;
    }
    return y;
  }

  /** A card under the rest: the star, what a Founder gets, and the claim. */
  private layoutFounders(y: number, width: number, founder: boolean): number {
    const pad = 14;
    this.founderTitle.position.set(pad + 30, y + pad);
    this.founderPitch.style.wordWrapWidth = width - pad * 2 - 30;
    this.founderPitch.position.set(pad + 30, y + pad + 22);
    const buttonY = this.founderPitch.y + this.founderPitch.height + 10;
    const h = buttonY + 32 + pad - y;
    this.founderCard.clear();
    this.founderCard
      .roundRect(0, y, width, h, 12)
      .fill({ color: UI.panel })
      .stroke({ width: 1.5, color: badgeColor('star') });
    drawBadgeGlyph(this.founderCard, 'star', pad + 11, y + pad + 10, 22, badgeColor('star'));
    this.claim.place(pad + 30, buttonY, width - pad * 2 - 30, 32);
    this.claim.set(
      founder ? 'You are a Founder' : 'Claim it (test)',
      founder ? 'plain' : 'primary',
      !founder,
    );
    return y + h + 14;
  }
}

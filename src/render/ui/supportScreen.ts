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
 * And the Founders: the first players to reach the Founders' level, with the
 * online matches as well, get all of this free, with a Founder star carrying
 * their number. The game server counts them from its own count of each player
 * (server/playerStore.ts), and hands out a number the moment a player gets
 * there; the card here says the rule, where the player stands as the server
 * counts them, how many stars are left, and a Founder's own number.
 *
 * A Supporter's or a Founder's name in the credits is chosen here, and
 * changed here: the name they want, not whatever their phone is called. The
 * credits themselves are a button away (creditsScreen.ts).
 *
 * Until there is a payment provider the buy button says purchases are not
 * open yet (the game's `buySupporter`), except in the `?progress=test` build,
 * which grants it - and a Founder's star - on the device, and offers a way to
 * take both back.
 */

import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { percent } from '../../progression/award.ts';
import type { ProgressStore } from '../../progression/store.ts';
import type { FounderStatus, PlayerSummary } from '../../net/playerApi.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { badgeColor, drawBadgeGlyph, drawFounderStar, placeStarNumber } from './levelBadge.ts';
import type { PanelButton } from './menu.ts';
import { Sheet } from './sheet.ts';
import { centreOn, label, wrapped } from './text.ts';

export interface SupportHandlers {
  onClose(): void;
  onBuy(): void;
  /** `?progress=test` only: become a Founder on this device, with a number. */
  onClaimFounder(): void;
  /** `?progress=test` only: undo Supporter and Founder. */
  onResetTest(): void;
  /** Choose or change the name shown in the credits. */
  onCreditName(): void;
  /** Open the credits. */
  onCredits(): void;
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
  /** How far off the player is, and how many stars are left. */
  private readonly founderStatus: Text;
  /** A Founder's number, in the card's star. */
  private readonly founderNumber: Text;
  private readonly claim: PanelButton;
  /** What the server last said about the Founders; null before it has, or with none. */
  private status: FounderStatus | null = null;
  /** What the server last said about this player; null before it has, or with no server. */
  private player: PlayerSummary | null = null;
  /** Their name in the credits, and the button to choose it. */
  private readonly creditLine: Text;
  private readonly creditButton: PanelButton;
  private readonly seeCredits: PanelButton;
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
      store.founders.pitch
        .replaceAll('{count}', String(store.founders.count))
        .replaceAll('{level}', String(store.founders.level))
        .replaceAll('{online}', String(store.founders.onlineMatches)),
      12,
      UI.textMuted,
    );
    this.founderStatus = wrapped('', 11, UI.level);
    this.founderStatus.style.fontWeight = '700';
    this.founderNumber = label('', 10, UI.background, '700');
    this.claim = this.button('', () => this.handlers.onClaimFounder(), 13);
    this.creditLine = wrapped('', 12, UI.text);
    this.creditButton = this.button('', () => this.handlers.onCreditName(), 12);
    this.seeCredits = this.button('See the credits', () => this.handlers.onCredits(), 12);
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
      this.founderStatus,
      this.founderNumber,
      this.claim,
      this.creditLine,
      this.creditButton,
      this.seeCredits,
      this.reset,
    );
  }

  refresh(): void {
    if (this.visible) this.arrange();
  }

  /** What the server says about the Founders: how many stars are left. */
  setFounderStatus(status: FounderStatus | null): void {
    this.status = status;
    this.refresh();
  }

  /** What the server says about this player: its count, and their credits name. */
  setPlayer(player: PlayerSummary | null): void {
    this.player = player;
    this.refresh();
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

    const { founderNumber } = this.progress.profile;
    this.headline.text = founder
      ? founderNumber !== null
        ? `You are Founder #${founderNumber}. Thank you!`
        : 'You are a Founder. Thank you!'
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

    // A Supporter's or a Founder's name in the credits, chosen here.
    const credited = perks && this.player !== null;
    this.creditLine.visible = credited;
    this.creditButton.visible = credited;
    if (credited) {
      const name = this.player?.creditName ?? '';
      this.creditLine.text = this.player?.creditBlocked
        ? 'Your name was taken out of the credits.'
        : name
          ? `In the credits as "${name}".`
          : 'Choose the name to show in the credits - any name you like.';
      this.creditLine.style.wordWrapWidth = width - 16;
      this.creditLine.style.align = 'center';
      centreOn(this.creditLine, cx, y);
      y += this.creditLine.height + 8;
      if (this.player?.creditBlocked) {
        this.creditButton.visible = false;
      } else {
        this.creditButton.place(width / 4, y, width / 2, 32);
        this.creditButton.set(
          name ? 'Change the name' : 'Choose a name',
          name ? 'plain' : 'primary',
        );
        y += 42;
      }
    }
    this.seeCredits.place(width / 4, y, width / 2, 30);
    this.seeCredits.set('See the credits', 'plain');
    y += 44;

    // The Founders: the race to the level, and a Founder's own star.
    y = this.layoutFounders(y, width);

    this.reset.visible = this.testMode;
    if (this.testMode) {
      this.reset.place(width / 4, y, width / 2, 30);
      this.reset.set('Reset test purchases', 'plain');
      y += 40;
    }
    return y;
  }

  /**
   * A card under the rest: the star - a Founder's own, with their number in
   * it - what a Founder gets, and how the race stands for this player.
   */
  private layoutFounders(y: number, width: number): number {
    const { founder, founderNumber } = this.progress.profile;
    const rule = this.progress.store.founders;
    const level = this.progress.level.level;
    const pad = 14;
    const textX = pad + 38;
    const textW = width - textX - pad;
    this.founderTitle.text =
      founder && founderNumber !== null ? `Founder #${founderNumber}` : 'Founders';
    this.founderTitle.position.set(textX, y + pad);
    this.founderPitch.style.wordWrapWidth = textW;
    this.founderPitch.position.set(textX, y + pad + 22);
    let ty = this.founderPitch.y + this.founderPitch.height + 8;

    // Where this player stands, as the server counts them: a number is handed
    // out by itself the moment they get there.
    const left = this.status?.left ?? null;
    const counted = this.player;
    const stars = left !== null ? ` · ${left} of ${rule.count} stars still to win` : '';
    this.founderStatus.text = founder
      ? ''
      : left === 0
        ? `All ${rule.count} stars have been won.`
        : counted
          ? `As the server counts it: level ${counted.level} of ${rule.level}, ` +
            `${Math.min(counted.onlineMatches, rule.onlineMatches)} of ${rule.onlineMatches} online matches` +
            stars
          : `You are level ${level} of ${rule.level}. The game server counts the race: ` +
            'play online to be in it.';
    this.founderStatus.visible = this.founderStatus.text !== '';
    if (this.founderStatus.visible) {
      this.founderStatus.style.wordWrapWidth = textW;
      this.founderStatus.position.set(textX, ty);
      ty += this.founderStatus.height + 10;
    }

    // A button for a Founder's number, and in the test build for the claim.
    const button = founder || this.testMode;
    this.claim.visible = button;
    if (button) {
      this.claim.place(textX, ty, textW, 32);
      this.claim.set(
        founder
          ? founderNumber !== null
            ? `You are Founder #${founderNumber}`
            : 'You are a Founder'
          : 'Test: become a Founder',
        founder ? 'plain' : 'primary',
        !founder,
      );
      ty += 32;
    }
    const h = ty + pad - y;

    this.founderCard.clear();
    this.founderCard
      .roundRect(0, y, width, h, 12)
      .fill({ color: UI.panel })
      .stroke({ width: 1.5, color: badgeColor('star') });
    const starX = pad + 14;
    const starY = y + pad + 13;
    if (founder && founderNumber !== null) {
      drawFounderStar(this.founderCard, starX, starY, 30);
      placeStarNumber(this.founderNumber, founderNumber, starX, starY, 30);
    } else {
      drawBadgeGlyph(this.founderCard, 'star', starX, starY, 24, badgeColor('star'));
      placeStarNumber(this.founderNumber, null, starX, starY, 30);
    }
    return y + h + 14;
  }
}

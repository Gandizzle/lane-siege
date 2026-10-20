/**
 * The XP boost, offered before a game (award.ts; progression.json, adBoost).
 *
 * Opt in, every time. Before any game that can earn XP, while fewer than 25
 * boosted waves are left, this asks whether to watch an ad for +50% XP on the
 * next 25 waves. No goes straight to the game. Yes plays the ad
 * (adPlaceholder.ts, until there is a real one), and once it has been watched
 * to the end the card turns over to say what it earned - "Congratulations,
 * you get 50% experience boost for 25 waves!" - with a burst; Play goes on to
 * the game.
 *
 * Asked before a game rather than after one because that is when saying yes
 * changes something: the waves about to be played. And asked again whenever
 * fewer than 25 are left, as often as the player likes, so boosts stack - to
 * 50 waves at most. The numbers in every sentence come from the data file.
 *
 * Nothing here decides anything: the game says when to ask, plays the ad and
 * starts the boost (game.ts, `beforeGame`). This is the card.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { percent, waveCount, type BoostStatus } from '../../progression/award.ts';
import type { ProgressionConfig } from '../../progression/config.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { confetti, drawBurst } from './burst.ts';
import { PanelButton } from './menu.ts';
import { centreOn, label, wrapped } from './text.ts';

export interface BoostOfferHandlers {
  /** Yes: play the ad. */
  onWatch(): void;
  /** No: straight to the game. */
  onSkip(): void;
  /** The congratulations are read: on to the game. */
  onPlay(): void;
}

type AdBoost = ProgressionConfig['adBoost'];

/** Asking, or saying what the ad earned. */
type Face = 'ask' | 'won';

const PAD = 20;
const EMBLEM_R = 30;

export class BoostOffer extends Container {
  private readonly scrim = new Graphics();
  /** Everything but the scrim: shrunk as one on a screen too short for it. */
  private readonly panel = new Container();
  private readonly card = new Graphics();
  private readonly burst = new Graphics();
  private readonly emblem = new Graphics();
  private readonly emblemText: Text;
  private readonly title: Text;
  private readonly body: Text;
  private readonly note: Text;
  private readonly yes: PanelButton;
  private readonly no: PanelButton;
  private readonly play: PanelButton;
  private readonly bits = confetti(40);

  private face: Face = 'ask';
  /** What the boost is worth, "50%": the emblem says what the words say. */
  private bonus = '';
  /** Since the card last turned: the burst runs from it. */
  private ms = 0;
  private busy = false;
  private emblemAt = { cx: 0, cy: 0 };

  constructor(
    private layout: LaneLayout,
    private readonly handlers: BoostOfferHandlers,
  ) {
    super();
    this.visible = false;
    this.emblemText = label('', 14, UI.background, '700');
    this.title = wrapped('', 20, UI.text);
    this.title.style.fontWeight = '700';
    this.title.style.align = 'center';
    this.body = wrapped('', 14, UI.text);
    this.body.style.align = 'center';
    this.note = wrapped('', 12, UI.xp);
    this.note.style.fontWeight = '700';
    this.note.style.align = 'center';
    this.yes = new PanelButton(
      'Yes, watch an ad',
      () => {
        if (!this.busy) this.handlers.onWatch();
      },
      15,
    );
    this.no = new PanelButton(
      'No, just play',
      () => {
        if (!this.busy) this.handlers.onSkip();
      },
      14,
    );
    this.play = new PanelButton('Play', () => this.handlers.onPlay(), 15);

    // The scrim takes every tap that is not a button's: saying yes or no is a
    // choice, made with a button, never with a stray tap beside the card.
    this.scrim.eventMode = 'static';
    this.card.eventMode = 'static';

    this.addChild(this.scrim, this.panel);
    this.panel.addChild(
      this.card,
      this.burst,
      this.emblem,
      this.emblemText,
      this.title,
      this.body,
      this.note,
      this.yes,
      this.no,
      this.play,
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Whether it is still asking - rather than saying what the ad earned. */
  get asking(): boolean {
    return this.visible && this.face === 'ask';
  }

  /** Ask whether to watch the ad. `status` is the boost as it stands. */
  ask(status: BoostStatus, ad: AdBoost): void {
    this.face = 'ask';
    this.busy = false;
    this.ms = 0;
    this.bonus = percent(ad.bonus);
    this.title.text = 'Boost your XP?';
    this.body.text =
      `Watch a short ad and get +${percent(ad.bonus)} XP ` +
      `for the next ${waveCount(ad.waves)} you play.`;
    this.note.text =
      status.wavesLeft > 0
        ? `${waveCount(status.wavesLeft)} of boost left - this makes ${status.wavesAfter}.`
        : '';
    this.open();
  }

  /** The ad was watched: say what it earned. `status` is the boost after it. */
  congratulate(status: BoostStatus, ad: AdBoost, added: number): void {
    this.face = 'won';
    this.busy = false;
    this.ms = 0;
    this.bonus = percent(ad.bonus);
    this.title.text = '';
    this.body.text =
      `Congratulations, you get ${percent(ad.bonus)} experience boost ` +
      `for ${waveCount(added)}!`;
    this.note.text =
      status.wavesLeft > added
        ? `That makes ${waveCount(status.wavesLeft)} of boost in all.`
        : 'It starts with this game.';
    this.open();
  }

  /** While the ad is up: the buttons wait, so one tap cannot start two. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    if (this.visible) this.arrange();
  }

  close(): void {
    this.visible = false;
    this.busy = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    if (this.visible) this.arrange();
  }

  /** The emblem's pulse, and the burst when the card turns to good news. */
  update(deltaMs: number): void {
    if (!this.visible) return;
    this.ms += deltaMs;
    this.drawEmblem();
    if (this.face === 'won') {
      drawBurst(this.burst, this.emblemAt.cx, this.emblemAt.cy, 120, this.ms, 0.9, this.bits);
    } else {
      this.burst.clear();
    }
  }

  private open(): void {
    this.visible = true;
    this.arrange();
    this.update(0);
  }

  /** A disc in the boost's purple, saying what it is worth, breathing. */
  private drawEmblem(): void {
    const { cx, cy } = this.emblemAt;
    const won = this.face === 'won';
    const pulse = 1 + (won ? 0.08 : 0.04) * Math.sin((this.ms / 1000) * (won ? 6 : 3));
    const r = EMBLEM_R * pulse;
    this.emblem.clear();
    this.emblem.circle(cx, cy, r + 8).fill({ color: UI.xp, alpha: 0.15 });
    this.emblem.circle(cx, cy, r).fill({ color: won ? UI.level : UI.xp });
    this.emblemText.scale.set(pulse);
    this.emblemText.position.set(cx - this.emblemText.width / 2, cy - this.emblemText.height / 2);
  }

  private arrange(): void {
    const screen = this.layout.screen;
    const w = Math.min(screen.width - 32, 340);
    const inner = w - PAD * 2;
    const asking = this.face === 'ask';

    // Measure the words at this width first: the card is as tall as they are.
    for (const text of [this.title, this.body, this.note]) text.style.wordWrapWidth = inner;
    this.body.style.fontSize = asking ? 14 : 18;
    this.body.style.fontWeight = asking ? '500' : '700';
    this.body.style.fill = asking ? UI.text : UI.level;
    this.body.style.lineHeight = asking ? 19 : 24;
    const titleH = this.title.text ? this.title.height + 8 : 0;
    const noteH = this.note.text ? this.note.height + 10 : 0;
    const buttonsH = asking ? 46 + 10 + 40 : 46;
    const h =
      PAD + EMBLEM_R * 2 + 16 + titleH + this.body.height + 10 + noteH + 10 + buttonsH + PAD;

    const x = Math.round((screen.width - w) / 2);
    const y = Math.round(Math.max(8, (screen.height - h) / 2));
    // A landscape phone may not have the height: shrink the card about its
    // middle rather than cut its buttons off.
    const scale = Math.min(1, (screen.height - 16) / h);
    this.panel.scale.set(scale);
    this.panel.position.set(
      screen.width / 2 - scale * (x + w / 2),
      screen.height / 2 - scale * (y + h / 2),
    );

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.75 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.card.clear();
    this.card
      .roundRect(x, y, w, h, 14)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1.5, color: asking ? UI.xp : UI.level, alpha: 0.8 });
    this.card.hitArea = new Rectangle(x, y, w, h);

    const cx = x + w / 2;
    let ty = y + PAD;
    this.emblemAt = { cx, cy: ty + EMBLEM_R };
    this.emblemText.text = `+${this.bonus}`;
    ty += EMBLEM_R * 2 + 16;
    if (this.title.text) {
      centreOn(this.title, cx, ty);
      ty += titleH;
    }
    centreOn(this.body, cx, ty);
    ty += this.body.height + 10;
    this.note.visible = this.note.text !== '';
    if (this.note.visible) {
      centreOn(this.note, cx, ty);
      ty += noteH;
    }
    ty += 10;

    this.yes.visible = asking;
    this.no.visible = asking;
    this.play.visible = !asking;
    if (asking) {
      this.yes.place(x + PAD, ty, inner, 46);
      this.yes.set('Yes, watch an ad', 'primary', !this.busy);
      this.no.place(x + PAD, ty + 56, inner, 40);
      this.no.set('No, just play', 'plain', !this.busy);
    } else {
      this.play.place(x + PAD, ty, inner, 46);
      this.play.set('Play', 'primary');
    }
  }
}

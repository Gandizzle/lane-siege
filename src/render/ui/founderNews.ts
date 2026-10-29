/**
 * "Founder #7": the moment a player is told they are one of the first to the
 * Founders' level (store.json, founders) - their star, with their number in it,
 * going off in the same burst as a level-up, what it brings, and one button.
 *
 * Shown over the home screen once the server has counted them (the game's
 * `checkFounder`), and over whatever is up in the `?progress=test` build's
 * claim. Built once and only repositioned, like every other card: a rebuilt
 * button never receives a tap (see the note at the top of buildBar.ts).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { confetti, drawBurst } from './burst.ts';
import { drawFounderStar, placeStarNumber } from './levelBadge.ts';
import { PanelButton } from './menu.ts';
import { centreOn, label, wrapped } from './text.ts';

const PAD = 20;
const STAR = 76;

export class FounderNews extends Container {
  private readonly scrim = new Graphics();
  /** Everything but the scrim: shrunk as one on a screen too short for it. */
  private readonly panel = new Container();
  private readonly card = new Graphics();
  private readonly burst = new Graphics();
  private readonly star = new Graphics();
  private readonly number: Text;
  private readonly title: Text;
  private readonly lead: Text;
  private readonly perks: Text;
  private readonly done: PanelButton;
  private readonly bits = confetti(40);
  private founder = { number: 0, count: 0, level: 0, bonus: '' };
  private ms = 0;
  private starAt = { x: 0, y: 0 };

  constructor(
    private layout: LaneLayout,
    onClose: () => void,
  ) {
    super();
    this.visible = false;
    this.title = label('', 24, UI.level, '700');
    this.number = label('', 20, UI.background, '700');
    this.lead = wrapped('', 13, UI.text);
    this.lead.style.align = 'center';
    this.perks = wrapped('', 12, UI.textMuted);
    this.perks.style.align = 'center';
    this.done = new PanelButton('Wonderful', onClose, 15);

    // A choice, made with the button: a stray tap beside the card is not one.
    this.scrim.eventMode = 'static';
    this.card.eventMode = 'static';
    this.addChild(this.scrim, this.panel);
    this.panel.addChild(
      this.card,
      this.burst,
      this.star,
      this.number,
      this.title,
      this.lead,
      this.perks,
      this.done,
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** `bonus` is what a Supporter earns on top in all, "125%". */
  open(number: number, count: number, level: number, bonus: string): void {
    this.founder = { number, count, level, bonus };
    this.ms = 0;
    this.visible = true;
    this.arrange();
  }

  close(): void {
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    if (this.visible) this.arrange();
  }

  /** The burst behind the star, for its first two seconds. */
  update(deltaMs: number): void {
    if (!this.visible) return;
    this.ms += deltaMs;
    drawBurst(this.burst, this.starAt.x, this.starAt.y, 120, this.ms, 1, this.bits);
  }

  private arrange(): void {
    const { number, count, level, bonus } = this.founder;
    const screen = this.layout.screen;
    const w = Math.min(screen.width - 32, 340);
    const inner = w - PAD * 2;
    this.title.text = `Founder #${number}`;
    this.lead.text = `One of the first ${count} players to reach level ${level}.`;
    this.lead.style.wordWrapWidth = inner;
    this.perks.text =
      `Everything a Supporter gets is yours, free and for good: +${bonus} XP on every ` +
      'match, the XP boost always on with no ads, and this star by your name.';
    this.perks.style.wordWrapWidth = inner;

    const h = PAD + STAR + 14 + 32 + this.lead.height + 10 + this.perks.height + 18 + 46 + PAD;
    const x = Math.round((screen.width - w) / 2);
    const y = Math.round(Math.max(8, (screen.height - h) / 2));
    const scale = Math.min(1, (screen.height - 16) / h);
    this.panel.scale.set(scale);
    this.panel.position.set(
      screen.width / 2 - scale * (x + w / 2),
      screen.height / 2 - scale * (y + h / 2),
    );

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.78 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.card.clear();
    this.card
      .roundRect(x, y, w, h, 14)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1.5, color: UI.level, alpha: 0.9 });
    this.card.hitArea = new Rectangle(x, y, w, h);

    const cx = x + w / 2;
    let ty = y + PAD;
    this.starAt = { x: cx, y: ty + STAR / 2 };
    this.star.clear();
    this.star.circle(cx, ty + STAR / 2, STAR * 0.62).fill({ color: UI.level, alpha: 0.12 });
    drawFounderStar(this.star, cx, ty + STAR / 2, STAR);
    placeStarNumber(this.number, number, cx, ty + STAR / 2, STAR);
    ty += STAR + 14;
    centreOn(this.title, cx, ty);
    ty += 32;
    centreOn(this.lead, cx, ty);
    ty += this.lead.height + 10;
    centreOn(this.perks, cx, ty);
    ty += this.perks.height + 18;
    this.done.place(x + PAD, ty, inner, 46);
    this.done.set('Wonderful', 'primary');
    this.update(0);
  }
}

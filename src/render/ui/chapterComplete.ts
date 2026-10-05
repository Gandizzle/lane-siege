/**
 * "Chapter 2 Complete!" - the burst in the middle of the board as a tutorial
 * chapter ends (src/tutorial).
 *
 * The chapter used to end on the coach's card alone, the same plain box every
 * step had come in, so finishing one felt like reaching the bottom of a page.
 * Now it is celebrated the way a cleared lane is (waveCleared.ts, the same
 * burst from burst.ts) with the victory fanfare, in the upper middle of the
 * lane, where the coach's card at the bottom of the screen leaves it room.
 *
 * Paint only, and drawn over the coach, so its dimming does not dim the news.
 * It stays as long as the chapter-complete card does: the burst plays once,
 * and the words wait with the card for the player to go on.
 */

import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { confetti, drawBurst, easeOutBack } from './burst.ts';
import { CURRENCY_COLORS } from './currency.ts';
import { label, overlaid } from './text.ts';

const POP_MS = 400;
const CONFETTI = 44;

export class ChapterComplete extends Container {
  private readonly burst = new Graphics();
  private readonly backing = new Graphics();
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly bits = confetti(CONFETTI);
  /** Milliseconds since it opened; negative while it is not up. */
  private age = -1;

  constructor(private layout: LaneLayout) {
    super();
    this.eventMode = 'none';
    this.title = overlaid('', 34, CURRENCY_COLORS.gold, '700');
    this.subtitle = label('', 15, UI.text, '700');
    this.addChild(this.burst, this.backing, this.title, this.subtitle);
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  /** Celebrate chapter `number`, called `name`. */
  show(number: number, name: string): void {
    this.title.text = `Chapter ${number} Complete!`;
    this.subtitle.text = name;
    this.age = 0;
  }

  hide(): void {
    this.age = -1;
    this.visible = false;
  }

  get showing(): boolean {
    return this.age >= 0;
  }

  /** Animate on wall time: the match is held while the chapter-complete card is up. */
  render(deltaMs: number): void {
    if (this.age < 0) {
      this.visible = false;
      return;
    }
    this.visible = true;
    this.age += deltaMs;

    const l = this.layout;
    const scale = Math.max(1, l.textScale);
    const cx = l.lane.x + l.lane.width / 2;
    const cy = l.lane.y + l.lane.height * 0.34;

    this.title.style.fontSize = Math.round(34 * scale);
    this.subtitle.style.fontSize = Math.round(15 * scale);
    // Shrunk to the lane on a narrow screen rather than run off it.
    this.title.scale.set(1);
    const room = l.lane.width - 24;
    const fit = Math.min(1, room / Math.max(1, this.title.width));
    const titleW = this.title.width * fit;
    const titleH = this.title.height * fit;

    const pop = this.age < POP_MS ? easeOutBack(this.age / POP_MS) : 1;
    this.title.scale.set(fit * pop);
    this.title.x = cx - this.title.width / 2;
    this.title.y = cy - this.title.height / 2;
    const subY = cy + titleH / 2 + 6 * scale;
    this.subtitle.x = cx - this.subtitle.width / 2;
    this.subtitle.y = subY;

    const width = Math.min(l.lane.width - 8, Math.max(titleW, this.subtitle.width) + 40 * scale);
    const top = cy - titleH / 2 - 14 * scale;
    const bottom = subY + this.subtitle.height + 14 * scale;
    this.backing.clear();
    this.backing
      .roundRect(cx - width / 2, top, width, bottom - top, 16)
      .fill({ color: UI.background, alpha: 0.86 })
      .stroke({ width: 2, color: CURRENCY_COLORS.gold, alpha: 0.8 });

    const reach = Math.min(l.lane.width, l.lane.height) * 0.55;
    drawBurst(this.burst, cx, cy, reach, this.age, scale, this.bits);
  }
}

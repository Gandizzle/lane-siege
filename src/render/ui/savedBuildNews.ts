/**
 * "While you were away": what a player's saved build did in other people's
 * quick matches since they last looked. (docs/ARCHITECTURE.md, "Saved builds")
 *
 * Shown once, over the home screen, when there is news (net/ghostApi.ts works
 * out what is new against what this device last showed). Four boxes, first to
 * fourth, with how many of each since the last look - first in gold, because
 * that is the one a player made the build for - and the whole record since it
 * was saved underneath, so a good run reads as part of a longer one.
 *
 * Built once and only repositioned, like every other card: a rebuilt button
 * never receives a tap (see the note at the top of buildBar.ts).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { GhostNews } from '../../net/ghostApi.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { PanelButton } from './menu.ts';
import { centreOn, label, wrapped } from './text.ts';

const PAD = 20;
const PLACES = ['1st', '2nd', '3rd', '4th'];

export class SavedBuildNews extends Container {
  private readonly scrim = new Graphics();
  /** Everything but the scrim: shrunk as one on a screen too short for it. */
  private readonly panel = new Container();
  private readonly card = new Graphics();
  private readonly title: Text;
  private readonly lead: Text;
  private readonly places: { name: Text; count: Text }[];
  private readonly record: Text;
  private readonly done: PanelButton;
  private news: GhostNews | null = null;

  constructor(
    private layout: LaneLayout,
    onClose: () => void,
  ) {
    super();
    this.visible = false;
    this.title = label('Your saved build', 20, UI.text, '700');
    this.lead = wrapped('', 13, UI.textMuted);
    this.lead.style.align = 'center';
    this.places = PLACES.map((place, i) => ({
      name: label(place, 12, i === 0 ? UI.level : UI.textMuted, '700'),
      count: label('', 24, i === 0 ? UI.level : UI.text, '700'),
    }));
    this.record = wrapped('', 11, UI.textMuted);
    this.record.style.align = 'center';
    this.done = new PanelButton('Nice', onClose, 15);

    // A choice, made with the button: a stray tap beside the card is not one.
    this.scrim.eventMode = 'static';
    this.card.eventMode = 'static';
    this.addChild(this.scrim, this.panel);
    this.panel.addChild(
      this.card,
      this.title,
      this.lead,
      ...this.places.flatMap((p) => [p.name, p.count]),
      this.record,
      this.done,
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(news: GhostNews): void {
    this.news = news;
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

  private arrange(): void {
    const news = this.news;
    if (!news) return;
    const screen = this.layout.screen;
    const w = Math.min(screen.width - 32, 340);
    const inner = w - PAD * 2;
    const played = news.results.reduce((a, b) => a + b, 0);
    const total = news.total.reduce((a, b) => a + b, 0);
    this.lead.text =
      `It played ${played} ${played === 1 ? 'match' : 'matches'} in other people's ` +
      'quick matches since you last looked:';
    this.lead.style.wordWrapWidth = inner;
    const wins = news.total[0] ?? 0;
    this.record.text = `All told: ${total} ${total === 1 ? 'match' : 'matches'}, ${wins} won.`;
    this.record.style.wordWrapWidth = inner;

    const boxH = 62;
    const h = PAD + 30 + this.lead.height + 14 + boxH + 12 + this.record.height + 16 + 46 + PAD;
    const x = Math.round((screen.width - w) / 2);
    const y = Math.round(Math.max(8, (screen.height - h) / 2));
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
      .stroke({ width: 1.5, color: UI.level, alpha: 0.8 });
    this.card.hitArea = new Rectangle(x, y, w, h);

    const cx = x + w / 2;
    let ty = y + PAD;
    centreOn(this.title, cx, ty);
    ty += 30;
    centreOn(this.lead, cx, ty);
    ty += this.lead.height + 14;

    // A box for each place: what it was, and how many since the last look.
    const gap = 8;
    const boxW = (inner - gap * 3) / 4;
    this.places.forEach((place, i) => {
      const bx = x + PAD + i * (boxW + gap);
      this.card
        .roundRect(bx, ty, boxW, boxH, 10)
        .fill({ color: UI.panel })
        .stroke({ width: 1, color: i === 0 ? UI.level : UI.panelEdge });
      centreOn(place.name, bx + boxW / 2, ty + 8);
      place.count.text = String(news.results[i] ?? 0);
      centreOn(place.count, bx + boxW / 2, ty + 26);
    });
    ty += boxH + 12;
    centreOn(this.record, cx, ty);
    ty += this.record.height + 16;
    this.done.place(x + PAD, ty, inner, 46);
    this.done.set('Nice', 'primary');
  }
}

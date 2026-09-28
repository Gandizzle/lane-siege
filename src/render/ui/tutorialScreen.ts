/**
 * The tutorial's front page: every chapter, which ones are done, and a way to
 * run them all in order (src/tutorial).
 *
 * Two ways in, because there are two kinds of player here. Somebody new wants
 * the whole thing, start to finish, without choosing: the big button at the
 * top does that, and each chapter hands on to the next when it ends. Somebody
 * coming back wants one thing explained again - "how do sends work?" - and the
 * list below lets them go straight to it. A tick marks what has been finished,
 * and the big button offers to carry on from the first chapter without one.
 *
 * One column upright; two sideways, where six rows will not fit down the
 * screen.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, fit, label } from './text.ts';

export interface ChapterEntry {
  id: string;
  title: string;
  summary: string;
}

export interface TutorialScreenHandlers {
  /** Play this chapter; the ones after it follow on. */
  onStart(index: number): void;
  onBack(): void;
}

interface Row {
  root: Container;
  background: Graphics;
  number: Text;
  title: Text;
  summary: Text;
  tick: Text;
}

export class TutorialScreen extends Container {
  private readonly scrim = new Graphics();
  private readonly heading: Text;
  private readonly subheading: Text;
  private readonly startButton = new Container();
  private readonly startBackground = new Graphics();
  private readonly startTitle: Text;
  private readonly startNote: Text;
  private readonly rows: Row[] = [];
  private readonly backButton = new Container();
  private readonly backBackground = new Graphics();
  private readonly backLabel: Text;

  private done = new Set<string>();

  constructor(
    private layout: LaneLayout,
    private readonly chapters: readonly ChapterEntry[],
    private readonly handlers: TutorialScreenHandlers,
  ) {
    super();

    this.heading = label('Tutorial', 24, UI.text, '700');
    this.subheading = label('', 11, UI.textMuted);
    this.startTitle = label('', 15, UI.background, '700');
    this.startNote = label('', 10, UI.background, '600');
    this.backLabel = label('Back', 13, UI.text, '700');

    this.startButton.eventMode = 'static';
    this.startButton.cursor = 'pointer';
    this.startButton.on('pointertap', () => this.handlers.onStart(this.firstToPlay()));
    this.startButton.addChild(this.startBackground, this.startTitle, this.startNote);

    this.backButton.eventMode = 'static';
    this.backButton.cursor = 'pointer';
    this.backButton.on('pointertap', () => this.handlers.onBack());
    this.backButton.addChild(this.backBackground, this.backLabel);

    // Every row is made once and only moved (the note in buildBar.ts).
    chapters.forEach((chapter, index) => {
      const root = new Container();
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.on('pointertap', () => this.handlers.onStart(index));
      const row: Row = {
        root,
        background: new Graphics(),
        number: label(`${index + 1}`, 16, UI.accent, '700'),
        title: label(chapter.title, 14, UI.text, '700'),
        summary: label(chapter.summary, 10, UI.textMuted),
        tick: label('✓', 16, UI.healthGood, '700'),
      };
      root.addChild(row.background, row.number, row.title, row.summary, row.tick);
      this.rows.push(row);
    });

    // Swallows taps, so nothing behind the screen hears them.
    this.scrim.eventMode = 'static';

    this.addChild(
      this.scrim,
      this.heading,
      this.subheading,
      this.startButton,
      ...this.rows.map((r) => r.root),
      this.backButton,
    );
    this.setLayout(layout);
  }

  /** Which chapters have been finished, by id. */
  setDone(done: readonly string[]): void {
    this.done = new Set(done);
    this.redraw();
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.redraw();
  }

  /** The first chapter not yet finished, or the first of all. */
  private firstToPlay(): number {
    const index = this.chapters.findIndex((c) => !this.done.has(c.id));
    return index < 0 ? 0 : index;
  }

  private redraw(): void {
    const l = this.layout.screen;
    const finished = this.chapters.filter((c) => this.done.has(c.id)).length;
    const first = this.firstToPlay();

    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    // Sideways, the list goes in two columns and everything tightens.
    const rowHeight = this.layout.compact ? 44 : 54;
    const gap = this.layout.compact ? 6 : 8;
    const singleWidth = Math.min(l.width - 32, 380);
    const stackHeight = this.chapters.length * (rowHeight + gap);
    const top = this.layout.compact ? 14 : Math.max(24, l.height * 0.06);
    const headerHeight = 34 + 18 + 12 + 50 + 14;
    const twoColumns =
      top + headerHeight + stackHeight + 52 > l.height && l.width >= 2 * 240 + 12 + 32;
    const columns = twoColumns ? 2 : 1;
    const columnWidth = twoColumns ? Math.min((l.width - 32 - 12) / 2, 340) : singleWidth;
    const blockWidth = columnWidth * columns + 12 * (columns - 1);
    const left = (l.width - blockWidth) / 2;

    centreOn(this.heading, l.width / 2, top);
    this.subheading.text =
      finished === 0
        ? `${this.chapters.length} short chapters. Tap one for a refresher, or play them all.`
        : `${finished} of ${this.chapters.length} chapters done. Tap any one to play it again.`;
    centreOn(this.subheading, l.width / 2, top + 34);

    // The big button: the whole tutorial from the start, or from where the
    // player left off.
    const startY = top + 34 + 18 + 12;
    const startWidth = Math.min(blockWidth, 380);
    const startX = (l.width - startWidth) / 2;
    const resuming = finished > 0 && finished < this.chapters.length;
    this.startTitle.text = resuming
      ? `Continue: ${this.chapters[first]?.title ?? ''}`
      : 'Start from the beginning';
    this.startNote.text = resuming
      ? `Chapter ${first + 1}, then the rest in order`
      : 'Every chapter in order, one after the other';
    this.startBackground.clear();
    this.startBackground.roundRect(startX, startY, startWidth, 50, 10).fill({ color: UI.accent });
    this.startButton.hitArea = new Rectangle(startX, startY, startWidth, 50);
    this.startTitle.position.set(startX + 16, startY + 8);
    this.startNote.position.set(startX + 16, startY + 30);

    const rowsTop = startY + 50 + 14;
    const perColumn = Math.ceil(this.chapters.length / columns);
    this.rows.forEach((row, index) => {
      const column = Math.floor(index / perColumn);
      const x = left + column * (columnWidth + 12);
      const y = rowsTop + (index % perColumn) * (rowHeight + gap);
      const done = this.done.has(this.chapters[index]!.id);

      row.background.clear();
      row.background
        .roundRect(x, y, columnWidth, rowHeight, 10)
        .fill({ color: UI.panel })
        .stroke({ width: 1, color: done ? UI.healthGood : UI.panelEdge, alpha: done ? 0.6 : 1 });
      row.root.hitArea = new Rectangle(x, y, columnWidth, rowHeight);

      const textTop = y + (rowHeight - 34) / 2;
      row.number.position.set(x + 14, y + rowHeight / 2 - 11);
      row.title.position.set(x + 40, textTop);
      const summary = this.chapters[index]!.summary;
      row.summary.text = fit(summary, columnWidth - 40 - 36, 10);
      row.summary.position.set(x + 40, textTop + 20);
      row.tick.visible = done;
      row.tick.position.set(x + columnWidth - 28, y + rowHeight / 2 - 11);
    });

    const rowsBottom = rowsTop + perColumn * (rowHeight + gap);
    const backWidth = 120;
    const backX = (l.width - backWidth) / 2;
    const backY = Math.min(rowsBottom + 4, l.height - 44);
    this.backBackground.clear();
    this.backBackground.roundRect(backX, backY, backWidth, 36, 8).fill({ color: UI.panelEdge });
    this.backButton.hitArea = new Rectangle(backX, backY, backWidth, 36);
    centreOn(this.backLabel, backX + backWidth / 2, backY + 9);
  }
}

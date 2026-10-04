/**
 * The tutorial's front page: every chapter, which ones are done, and a way to
 * run them all in order (src/tutorial).
 *
 * The practice matches between chapters (tutorial/lessons.ts) are not rows of
 * their own - twelve rows do not fit down a phone - but a pill on the row of
 * the chapter they follow, ticked like the row when done.
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
import { centreOn, label } from './text.ts';

/** One lesson, as the list shows it (tutorial/lessons.ts). */
export interface LessonEntry {
  kind: 'chapter' | 'practice';
  id: string;
  title: string;
  summary: string;
}

export interface TutorialScreenHandlers {
  /** Play this lesson, by its place in the list given; the ones after it follow on. */
  onStart(index: number): void;
  onBack(): void;
}

interface Row {
  /** The chapter's place in the lesson list. */
  lesson: number;
  root: Container;
  background: Graphics;
  number: Text;
  title: Text;
  summary: Text;
  tick: Text;
  /** The practice match after this chapter, if there is one. */
  practice: Pill | null;
}

interface Pill {
  lesson: number;
  root: Container;
  background: Graphics;
  text: Text;
}

const PILL_WIDTH = 86;
const PILL_HEIGHT = 26;

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
    private readonly lessons: readonly LessonEntry[],
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
    lessons.forEach((chapter, lesson) => {
      if (chapter.kind !== 'chapter') return;
      const root = new Container();
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.on('pointertap', () => this.handlers.onStart(lesson));
      const after = lessons[lesson + 1];
      const row: Row = {
        lesson,
        root,
        background: new Graphics(),
        number: label(`${this.rows.length + 1}`, 16, UI.accent, '700'),
        title: label(chapter.title, 14, UI.text, '700'),
        summary: label(chapter.summary, 10, UI.textMuted),
        tick: label('✓', 16, UI.healthGood, '700'),
        practice: after?.kind === 'practice' ? this.pill(lesson + 1) : null,
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
      // Over the rows rather than in them: a tap on a pill is not also a tap
      // on the chapter under it.
      ...this.rows.flatMap((r) => (r.practice ? [r.practice.root] : [])),
      this.backButton,
    );
    this.setLayout(layout);
  }

  private pill(lesson: number): Pill {
    const root = new Container();
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', () => this.handlers.onStart(lesson));
    const pill: Pill = {
      lesson,
      root,
      background: new Graphics(),
      text: label('', 11, UI.text, '700'),
    };
    root.addChild(pill.background, pill.text);
    return pill;
  }

  /** Which lessons have been finished, by id. */
  setDone(done: readonly string[]): void {
    this.done = new Set(done);
    this.redraw();
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.redraw();
  }

  /** The first lesson not yet finished, or the first of all. */
  private firstToPlay(): number {
    const index = this.lessons.findIndex((c) => !this.done.has(c.id));
    return index < 0 ? 0 : index;
  }

  private redraw(): void {
    const l = this.layout.screen;
    const chapters = this.lessons.filter((c) => c.kind === 'chapter');
    const finished = chapters.filter((c) => this.done.has(c.id)).length;
    const anyDone = this.lessons.some((c) => this.done.has(c.id));
    const allDone = this.lessons.every((c) => this.done.has(c.id));
    const first = this.firstToPlay();

    this.scrim.clear();
    this.scrim.rect(0, 0, l.width, l.height).fill({ color: UI.background });
    this.scrim.hitArea = new Rectangle(0, 0, l.width, l.height);

    // Sideways, the list goes in two columns and everything tightens.
    const rowHeight = this.layout.compact ? 44 : 54;
    const gap = this.layout.compact ? 6 : 8;
    const singleWidth = Math.min(l.width - 32, 380);
    const stackHeight = this.rows.length * (rowHeight + gap);
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
        ? `${chapters.length} short chapters, with practice matches between. Or tap one.`
        : `${finished} of ${chapters.length} chapters done. Tap any one to play it again.`;
    centreOn(this.subheading, l.width / 2, top + 34);

    // The big button: the whole tutorial from the start, or from where the
    // player left off.
    const startY = top + 34 + 18 + 12;
    const startWidth = Math.min(blockWidth, 380);
    const startX = (l.width - startWidth) / 2;
    const resuming = anyDone && !allDone;
    const next = this.lessons[first];
    const nextChapter = this.rows.findIndex((r) => r.lesson === first);
    this.startTitle.text = resuming ? `Continue: ${next?.title ?? ''}` : 'Start from the beginning';
    this.startNote.text = !resuming
      ? 'Every chapter in order, with practice between'
      : next?.kind === 'practice'
        ? 'A practice match, then the rest in order'
        : `Chapter ${nextChapter + 1}, then the rest in order`;
    this.startBackground.clear();
    this.startBackground.roundRect(startX, startY, startWidth, 50, 10).fill({ color: UI.accent });
    this.startButton.hitArea = new Rectangle(startX, startY, startWidth, 50);
    this.startTitle.position.set(startX + 16, startY + 8);
    this.startNote.position.set(startX + 16, startY + 30);

    const rowsTop = startY + 50 + 14;
    const perColumn = Math.ceil(this.rows.length / columns);
    this.rows.forEach((row, index) => {
      const column = Math.floor(index / perColumn);
      const x = left + column * (columnWidth + 12);
      const y = rowsTop + (index % perColumn) * (rowHeight + gap);
      const entry = this.lessons[row.lesson]!;
      const done = this.done.has(entry.id);

      row.background.clear();
      row.background
        .roundRect(x, y, columnWidth, rowHeight, 10)
        .fill({ color: UI.panel })
        .stroke({ width: 1, color: done ? UI.healthGood : UI.panelEdge, alpha: done ? 0.6 : 1 });
      row.root.hitArea = new Rectangle(x, y, columnWidth, rowHeight);

      const textTop = y + (rowHeight - 34) / 2;
      row.number.position.set(x + 14, y + rowHeight / 2 - 11);
      row.title.position.set(x + 40, textTop);
      // The pill sits at the row's right-hand end, and the tick before it.
      const pillRoom = row.practice ? PILL_WIDTH + 8 : 0;
      const textRoom = columnWidth - 40 - 36 - pillRoom;
      fitInto(row.title, entry.title, textRoom);
      fitInto(row.summary, entry.summary, textRoom);
      row.summary.position.set(x + 40, textTop + 20);
      row.tick.visible = done;
      row.tick.position.set(x + columnWidth - 28 - pillRoom, y + rowHeight / 2 - 11);
      if (row.practice)
        this.placePill(row.practice, x + columnWidth - 8 - PILL_WIDTH, y, rowHeight);
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

  /** A practice pill, ticked once that match has been played to its end. */
  private placePill(pill: Pill, x: number, rowY: number, rowHeight: number): void {
    const done = this.done.has(this.lessons[pill.lesson]!.id);
    const y = rowY + (rowHeight - PILL_HEIGHT) / 2;
    pill.background.clear();
    pill.background
      .roundRect(x, y, PILL_WIDTH, PILL_HEIGHT, PILL_HEIGHT / 2)
      .fill({ color: UI.panelEdge })
      .stroke({ width: 1, color: done ? UI.healthGood : UI.accent, alpha: 0.8 });
    pill.root.hitArea = new Rectangle(x, y, PILL_WIDTH, PILL_HEIGHT);
    pill.text.text = done ? '✓ Practice' : '▶ Practice';
    pill.text.style.fill = done ? UI.healthGood : UI.text;
    centreOn(pill.text, x + PILL_WIDTH / 2, y + (PILL_HEIGHT - pill.text.height) / 2);
  }
}

/**
 * Set `text` to as much of `full` as fits in `width`, measured rather than
 * guessed: a row with a pill beside it has only just enough room for a title
 * like "Build your first line", and an estimate per character cut it short.
 */
function fitInto(text: Text, full: string, width: number): void {
  text.text = full;
  if (text.width <= width) return;
  const characters = [...full];
  let keep = characters.length - 1;
  while (keep > 1) {
    text.text = `${characters.slice(0, keep).join('').trimEnd()}…`;
    if (text.width <= width) return;
    keep--;
  }
}

/**
 * What the status markers mean: a legend of what has been on the board, a
 * guide to every kind there is, and a page on each.
 *
 * Three views in one panel:
 *
 *   - **Recent** - opened by the legend button beside the board. Every kind of
 *     marker on screen now or in the last minute of play, most recent first,
 *     each drawn as it looks on the board, with who it was on.
 *   - **All effects** - opened from the menu's "Effects guide", or from the
 *     recent view. Every kind the game has.
 *   - **Detail** - one kind: the marker on a unit and on a monster, what it
 *     does, and every ability in the game that causes it and who carries it.
 *
 * NOTHING HERE LISTS THE KINDS BY HAND. The rows come from `STATUS_MARKS`,
 * the names, descriptions and drawings from `MARK_INFO` (statusMarks.ts), and
 * what causes each from the abilities data (statusGuide.ts). A new kind of
 * marker is a compile error in `MARK_INFO` until it has a name, a description
 * and a drawing, and then appears here, on the board and in the legend
 * together; a new ability appears under its kind the moment something carries
 * it.
 *
 * Built once and only rearranged afterwards, like every other panel: an
 * interactive object rebuilt between a press and its release never receives
 * the tap (buildBar.ts).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import { STATUS_MARKS, markBit, type StatusMark } from '../../sim/index.ts';
import type { LaneLayout, Rect } from '../layout.ts';
import { UI } from '../palette.ts';
import { drawEntity } from '../shapes.ts';
import { causesByMark, type Cause } from '../statusGuide.ts';
import type { SeenMark, StatusLog } from '../statusLog.ts';
import { MARK_INFO, drawMarksOver, drawMarksUnder } from '../statusMarks.ts';
import { PanelButton } from './menu.ts';
import { fit, label, wrapped } from './text.ts';

type View = 'recent' | 'catalogue' | 'detail';

/** The detail page's band of samples: the marker on a unit and a monster, captioned. */
const SAMPLES_HEIGHT = 112;

/** Draw one kind of marker round a stand-in body, as it looks on the board. */
function drawSample(
  g: Graphics,
  mark: StatusMark,
  cx: number,
  cy: number,
  radius: number,
  time: number,
  body: 'plain' | 'unit' | 'monster',
  seed: number,
): void {
  const sample = { cx, cy, radius, marks: markBit(mark), seed };
  drawMarksUnder(g, sample, time);
  if (body === 'plain') {
    g.moveTo(cx + radius, cy)
      .circle(cx, cy, radius)
      .fill({ color: UI.panelEdge });
  } else {
    drawEntity(
      g,
      body === 'unit'
        ? { shape: 'square', damageType: 'impact', mark: 1, outlined: false }
        : { shape: 'orb', damageType: 'arcane', mark: 1, outlined: true },
      cx,
      cy,
      radius,
    );
  }
  drawMarksOver(g, sample, time);
}

/** How long ago, in a few characters. */
function ago(seen: SeenMark): string {
  if (seen.now) return 'now';
  const seconds = Math.max(1, Math.round(seen.ago));
  return `${seconds}s ago`;
}

/** Who it was on, in the words the legend uses. */
function whom(seen: SeenMark): string {
  if (seen.onUnits && seen.onMonsters) return 'on units and monsters';
  return seen.onUnits ? 'on units' : 'on monsters';
}

/** One kind of marker as a row: the marker, its name, a line under it. */
class EffectRow extends Container {
  private readonly bg = new Graphics();
  readonly preview = new Graphics();
  private readonly title: Text;
  private readonly line: Text;
  private readonly arrow: Text;
  private w = 0;
  private h = 0;
  /** Where the preview's body sits, relative to the row. */
  private cx = 0;
  private cy = 0;

  constructor(
    readonly mark: StatusMark,
    onTap: (mark: StatusMark) => void,
  ) {
    super();
    const info = MARK_INFO[mark];
    this.title = label(info.name, 13, info.colour, '700');
    this.line = label('', 11, UI.textMuted, '500');
    this.arrow = label('›', 18, UI.textMuted, '700');
    this.addChild(this.bg, this.preview, this.title, this.line, this.arrow);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => onTap(this.mark));
  }

  place(rect: Rect): void {
    this.position.set(rect.x, rect.y);
    this.w = rect.width;
    this.h = rect.height;
    this.hitArea = new Rectangle(0, 0, rect.width, rect.height);
    this.bg.clear();
    this.bg.roundRect(0, 1, rect.width, rect.height - 2, 8).fill({ color: UI.panel });
    this.cx = rect.height / 2 + 4;
    this.cy = rect.height / 2;
    const textX = rect.height + 12;
    this.title.position.set(textX, rect.height / 2 - 16);
    this.line.position.set(textX, rect.height / 2 + 1);
    this.arrow.position.set(rect.width - 18, (rect.height - this.arrow.height) / 2);
  }

  setLine(text: string): void {
    const shown = fit(text, this.w - this.h - 40, 11);
    if (this.line.text !== shown) this.line.text = shown;
  }

  animate(time: number): void {
    this.preview.clear();
    const radius = Math.min(9, this.h * 0.2);
    drawSample(this.preview, this.mark, this.cx, this.cy, radius, time, 'plain', 3);
  }
}

// ------------------------------------------------------------------ the button

/**
 * The legend button beside the board: the latest kind of marker seen, drawn
 * live, and a dot while there is one the player has not opened the legend
 * since. A question mark until anything has been seen.
 */
export class EffectsButton extends Container {
  private readonly bg = new Graphics();
  private readonly preview = new Graphics();
  private readonly dot = new Graphics();
  private readonly query: Text;
  private rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(onTap: () => void) {
    super();
    this.query = label('?', 16, UI.text, '700');
    this.addChild(this.bg, this.preview, this.query, this.dot);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  place(rect: Rect): void {
    this.rect = rect;
    // A little more reach than the drawing, like the menu button.
    this.hitArea = new Rectangle(rect.x - 5, rect.y - 5, rect.width + 10, rect.height + 10);
    this.bg.clear();
    this.bg
      .roundRect(rect.x, rect.y, rect.width, rect.height, 8)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    this.query.position.set(
      rect.x + (rect.width - this.query.width) / 2,
      rect.y + (rect.height - this.query.height) / 2,
    );
    this.dot.clear();
    this.dot
      .circle(rect.x + rect.width - 3, rect.y + 3, 4)
      .fill({ color: UI.accent })
      .stroke({ width: 1.5, color: UI.background });
  }

  render(latest: StatusMark | null, unread: boolean, time: number): void {
    this.dot.visible = unread;
    this.query.visible = latest === null;
    this.preview.clear();
    if (latest === null) return;
    const r = this.rect;
    drawSample(
      this.preview,
      latest,
      r.x + r.width / 2,
      r.y + r.height / 2 + 1,
      4.5,
      time,
      'plain',
      5,
    );
  }
}

// ------------------------------------------------------------------ the panel

export class EffectsPanel extends Container {
  private readonly scrim = new Graphics();
  private readonly box = new Graphics();
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly empty: Text;
  private readonly closeX: PanelButton;
  private readonly rows: EffectRow[];
  private readonly allButton: PanelButton;
  private readonly backButton: PanelButton;
  private readonly doneButton: PanelButton;

  // The detail page.
  private readonly samples = new Graphics();
  private readonly onUnit: Text;
  private readonly onMonster: Text;
  private readonly detailSummary: Text;
  private readonly detailText: Text;
  private readonly causesHeading: Text;
  private readonly causesText: Text;
  /** The second column of causes, on a screen wide enough for two. */
  private readonly causesMore: Text;

  private readonly causes: Record<StatusMark, Cause[]>;
  private layout: LaneLayout;
  private view: View = 'recent';
  /** Where the detail page's Back goes. */
  private backTo: 'recent' | 'catalogue' = 'catalogue';
  private detailMark: StatusMark = STATUS_MARKS[0];
  /** The recent list as last laid out, so a changed list is re-laid out once. */
  private arranged = '';
  private recent: SeenMark[] = [];
  /** Wall time for the previews: the match behind is paused. */
  private clock = 0;
  private sampleAt = { unitX: 0, monsterX: 0, y: 0, radius: 0 };
  /** Where the second column of causes starts, from the first. */
  private causesColumn = 0;

  constructor(
    layout: LaneLayout,
    data: GameData,
    private readonly onClose: () => void,
  ) {
    super();
    this.layout = layout;
    this.visible = false;
    this.causes = causesByMark(data);

    this.title = label('', 18, UI.text, '700');
    this.subtitle = wrapped('', 11, UI.textMuted);
    this.empty = wrapped(
      'Nothing on the board yet. When a unit or a monster is burning, slowed, shielded or ' +
        'anything else, its marker shows up here with what it means.',
      12,
      UI.textMuted,
    );
    this.closeX = new PanelButton('✕', () => this.onClose());
    this.rows = STATUS_MARKS.map((mark) => new EffectRow(mark, (m) => this.showDetail(m)));
    this.allButton = new PanelButton('All effects', () => this.show('catalogue'));
    this.backButton = new PanelButton('Back', () => this.show(this.backTo));
    this.doneButton = new PanelButton('Close', () => this.onClose());

    this.onUnit = label('on a unit', 10, UI.textMuted);
    this.onMonster = label('on a monster', 10, UI.textMuted);
    this.detailSummary = label('', 12, UI.text, '600');
    this.detailText = wrapped('', 12, UI.textMuted);
    this.causesHeading = label('CAUSED BY', 10, UI.textMuted, '700');
    this.causesText = wrapped('', 11, UI.text);
    this.causesMore = wrapped('', 11, UI.text);

    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.onClose());
    this.box.eventMode = 'static';

    this.addChild(
      this.scrim,
      this.box,
      this.title,
      this.subtitle,
      this.closeX,
      this.empty,
      ...this.rows,
      this.samples,
      this.onUnit,
      this.onMonster,
      this.detailSummary,
      this.detailText,
      this.causesHeading,
      this.causesText,
      this.causesMore,
      this.allButton,
      this.backButton,
      this.doneButton,
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Open on the recent list (the legend button) or every kind (the menu). */
  open(view: 'recent' | 'catalogue'): void {
    this.visible = true;
    this.backTo = view;
    this.show(view);
  }

  close(): void {
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.arranged = '';
    if (this.visible) this.arrange();
  }

  /** Once a frame while open: refresh the recent list and animate every preview. */
  render(log: StatusLog, matchTime: number, deltaMs: number): void {
    if (!this.visible) return;
    this.clock += deltaMs / 1000;

    if (this.view === 'recent') {
      this.recent = log.recent(matchTime);
      const signature = this.recent.map((s) => s.mark).join();
      if (signature !== this.arranged) this.arrange();
      for (const seen of this.recent) {
        this.rowFor(seen.mark).setLine(`${ago(seen)} · ${whom(seen)}`);
      }
    }

    if (this.view === 'detail') {
      const { unitX, monsterX, y, radius } = this.sampleAt;
      this.samples.clear();
      drawSample(this.samples, this.detailMark, unitX, y, radius, this.clock, 'unit', 1);
      drawSample(this.samples, this.detailMark, monsterX, y, radius, this.clock, 'monster', 2);
    } else {
      for (const row of this.rows) if (row.visible) row.animate(this.clock);
    }
  }

  // ---------------------------------------------------------------- views

  private show(view: View): void {
    this.view = view;
    this.arranged = '';
    this.arrange();
  }

  private showDetail(mark: StatusMark): void {
    if (this.view !== 'detail') this.backTo = this.view === 'recent' ? 'recent' : 'catalogue';
    this.detailMark = mark;
    this.show('detail');
  }

  private rowFor(mark: StatusMark): EffectRow {
    return this.rows[STATUS_MARKS.indexOf(mark)]!;
  }

  /** Which rows the current view lists, in order. */
  private listed(): StatusMark[] {
    if (this.view === 'recent') return this.recent.map((s) => s.mark);
    if (this.view === 'catalogue') return [...STATUS_MARKS];
    return [];
  }

  // ---------------------------------------------------------------- layout

  private arrange(): void {
    const screen = this.layout.screen;
    const wide = this.layout.orientation === 'landscape' || this.layout.compact;
    const pad = 16;
    const marks = this.listed();
    this.arranged = this.view === 'recent' ? marks.join() : '';

    // Two columns of rows on a short screen, where one would run off it.
    const columns = wide && this.view !== 'detail' ? 2 : 1;
    let rowH = wide ? 40 : 46;
    const gap = 12;
    const panelW = Math.min(screen.width - 24, wide ? 720 : 420);
    const innerW = panelW - pad * 2;
    const colW = (innerW - gap * (columns - 1)) / columns;

    this.title.text =
      this.view === 'recent'
        ? 'Effects on the board'
        : this.view === 'catalogue'
          ? 'All effects'
          : MARK_INFO[this.detailMark].name;
    this.subtitle.text =
      this.view === 'recent'
        ? 'Now and in the last minute. Tap one to see what it does.'
        : this.view === 'catalogue'
          ? 'Every marker a body can wear. Tap one to see what it does.'
          : '';
    this.subtitle.style.wordWrapWidth = innerW - 40;

    // Measure the body first, so the box is exactly as tall as what is in it.
    const header = 36 + (this.subtitle.text ? this.subtitle.height + 8 : 0);
    let bodyH: number;
    if (this.view === 'detail') {
      bodyH = this.measureDetail(innerW, wide);
    } else if (marks.length === 0) {
      this.empty.style.wordWrapWidth = innerW;
      bodyH = this.empty.height + 8;
    } else {
      // Rows give up height before the panel gives up the screen: every kind
      // must fit on the shortest phone turned sideways.
      const perColumn = Math.ceil(marks.length / columns);
      const room = screen.height - 16 - pad - header - 64;
      rowH = Math.max(30, Math.min(rowH, Math.floor(room / perColumn)));
      bodyH = perColumn * rowH;
    }
    const footer = 64;
    const panelH = Math.min(screen.height - 16, pad + header + bodyH + footer);
    const px = Math.round((screen.width - panelW) / 2);
    const py = Math.round(Math.max(8, (screen.height - panelH) / 2));

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.78 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.box.clear();
    this.box
      .roundRect(px, py, panelW, panelH, 12)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1, color: UI.panelEdge });
    this.box.hitArea = new Rectangle(px, py, panelW, panelH);

    this.title.style.fill = this.view === 'detail' ? MARK_INFO[this.detailMark].colour : UI.text;
    this.title.position.set(px + pad, py + 14);
    this.subtitle.position.set(px + pad, py + 42);
    this.closeX.place(px + panelW - pad - 34, py + 10, 34, 34);

    const top = py + pad + header;

    // The list views.
    for (const row of this.rows) row.visible = false;
    marks.forEach((mark, i) => {
      const row = this.rowFor(mark);
      const column = Math.floor(i / Math.ceil(marks.length / columns));
      const index = i - column * Math.ceil(marks.length / columns);
      row.visible = true;
      row.place({
        x: px + pad + column * (colW + gap),
        y: top + index * rowH,
        width: colW,
        height: rowH,
      });
      if (this.view === 'catalogue') row.setLine(MARK_INFO[mark].summary);
    });
    this.empty.visible = this.view === 'recent' && marks.length === 0;
    this.empty.position.set(px + pad, top);

    // The detail view.
    const detail = this.view === 'detail';
    for (const piece of [
      this.samples,
      this.onUnit,
      this.onMonster,
      this.detailSummary,
      this.detailText,
      this.causesHeading,
      this.causesText,
      this.causesMore,
    ]) {
      piece.visible = detail;
    }
    if (detail) this.placeDetail(px + pad, top, innerW, wide);

    // The footer: what each view leads to.
    const by = py + panelH - pad - 36;
    const half = (innerW - 10) / 2;
    this.allButton.visible = this.view === 'recent';
    this.backButton.visible = this.view === 'detail';
    if (this.view === 'recent') {
      this.allButton.place(px + pad, by, half, 36);
      this.doneButton.place(px + pad + half + 10, by, half, 36);
    } else if (this.view === 'detail') {
      this.backButton.place(px + pad, by, half, 36);
      this.doneButton.place(px + pad + half + 10, by, half, 36);
    } else {
      this.doneButton.place(px + pad, by, innerW, 36);
    }
    this.doneButton.set('Close', 'primary');
  }

  /** Fill the detail page's text and say how tall it will be. */
  private measureDetail(innerW: number, wide: boolean): number {
    const info = MARK_INFO[this.detailMark];
    const causes = this.causes[this.detailMark];
    const textW = wide ? innerW - 190 : innerW;
    this.detailSummary.text = info.summary;
    this.detailText.text = info.description;
    this.detailText.style.wordWrapWidth = textW;
    const lines = causes.map((c) => `${c.ability} - ${c.owners.join(', ')}`);
    // Side by side on a wide screen once the list is long: a short screen
    // has the width to spare and not the height.
    const split = wide && lines.length > 4 ? Math.ceil(lines.length / 2) : lines.length;
    this.causesText.text =
      lines.length > 0 ? lines.slice(0, split).join('\n') : 'Nothing in the game causes this yet.';
    this.causesMore.text = lines.slice(split).join('\n');
    const columnW = split < lines.length ? (textW - 16) / 2 : textW;
    this.causesText.style.wordWrapWidth = columnW;
    this.causesMore.style.wordWrapWidth = columnW;
    this.causesColumn = columnW + 16;
    const text =
      this.detailSummary.height +
      8 +
      this.detailText.height +
      14 +
      this.causesHeading.height +
      6 +
      Math.max(this.causesText.height, this.causesMore.text ? this.causesMore.height : 0) +
      8;
    const samples = SAMPLES_HEIGHT;
    return wide ? Math.max(samples, text) : samples + text;
  }

  private placeDetail(x: number, y: number, innerW: number, wide: boolean): void {
    // The marker on a unit and on a monster, side by side: the same kind can
    // land on either, and they are drawn differently (solid and outlined).
    const sampleW = wide ? 170 : innerW;
    const radius = 17;
    const sy = y + 40;
    this.sampleAt = {
      unitX: x + sampleW * 0.28,
      monsterX: x + sampleW * 0.72,
      y: sy,
      radius,
    };
    this.onUnit.position.set(this.sampleAt.unitX - this.onUnit.width / 2, sy + radius + 26);
    this.onMonster.position.set(
      this.sampleAt.monsterX - this.onMonster.width / 2,
      sy + radius + 26,
    );

    const tx = wide ? x + 190 : x;
    let ty = wide ? y : y + SAMPLES_HEIGHT;
    this.detailSummary.position.set(tx, ty);
    ty += this.detailSummary.height + 8;
    this.detailText.position.set(tx, ty);
    ty += this.detailText.height + 14;
    this.causesHeading.position.set(tx, ty);
    ty += this.causesHeading.height + 6;
    this.causesText.position.set(tx, ty);
    this.causesMore.position.set(tx + this.causesColumn, ty);
  }
}

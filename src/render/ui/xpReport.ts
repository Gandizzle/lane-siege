/**
 * What a match earned, after it: the XP, line by line, and the climb it buys.
 *
 * It pops up over the end-of-match card as soon as YOUR match ends - out, or
 * the last one standing - because that is when the XP is counted. Each line
 * arrives in turn and counts up; then the total; then the bar fills from where
 * you were towards where you are now. Crossing a level is the moment: the bar
 * fills to the end, the badge turns over to the new level with a burst and a
 * fanfare and the key it pays ("Level 7! +1 key", for the Collection), and the
 * bar starts again from empty - as many times as it takes. At the top level
 * (store.ts) it stops full, says so, and the note under the total says what
 * raises it. A match played at the top earns nothing, and there is no card.
 *
 * A tap on the card skips to the end, so nobody has to sit through it twice.
 * Continue closes it and leaves the end-of-match card underneath.
 *
 * Under the bar, a line on the XP boost (award.ts): how many boosted waves are
 * left. The ad itself is not offered here - it is asked about before a game
 * (ui/boostOffer.ts), where saying yes changes the game about to be played.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { XpLine } from '../../progression/award.ts';
import type { LevelCurve } from '../../progression/config.ts';
import { keyCount } from '../../progression/cosmetics.ts';
import { levelOf } from '../../progression/levels.ts';
import type { AwardResult } from '../../progression/store.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { confetti, drawBurst, easeOut, easeOutBack } from './burst.ts';
import { LevelBadge, drawXpBar } from './levelBadge.ts';
import { PanelButton } from './menu.ts';
import { centreOn, fit, label, overlaid, wrapped } from './text.ts';

// ------------------------------------------------------------------ timeline

/** When the first line arrives, and how far apart the rest do. */
const START_MS = 250;
const LINE_MS = 260;
/** How long a number takes to count up. */
const COUNT_MS = 220;
const TOTAL_COUNT_MS = 450;
/** The bar's fill: a base, and longer for each level crossed. */
const BAR_MS = 700;
const BAR_PER_LEVEL_MS = 550;
const BAR_MAX_MS = 3200;

export interface ReportPlan {
  lines: XpLine[];
  total: number;
  /** XP at the start and the end of the climb. */
  from: number;
  to: number;
  totalAt: number;
  barAt: number;
  barMs: number;
  endAt: number;
}

export function planReport(result: AwardResult): ReportPlan {
  const { overTop } = result.award;
  const lines = [...result.award.lines, ...result.award.boosts, ...(overTop ? [overTop] : [])];
  const totalAt = START_MS + lines.length * LINE_MS + 100;
  const barAt = totalAt + TOTAL_COUNT_MS + 200;
  const levels = result.after.level - result.before.level;
  const barMs =
    result.award.total > 0 ? Math.min(BAR_MAX_MS, BAR_MS + BAR_PER_LEVEL_MS * levels) : 0;
  return {
    lines,
    total: result.award.total,
    from: result.before.total,
    to: result.after.total,
    totalAt,
    barAt,
    barMs,
    endAt: barAt + barMs,
  };
}

/** What is showing `ms` into the report. */
export interface ReportFrame {
  /** Per line: whether it has arrived, and the number it has counted up to. */
  lines: { shown: boolean; value: number }[];
  total: { shown: boolean; value: number };
  /** XP the bar stands at: from `plan.from` to `plan.to`, never backwards. */
  barXp: number;
  done: boolean;
}

function counted(ms: number, at: number, duration: number, value: number): number {
  if (ms < at) return 0;
  return Math.round(value * easeOut(Math.min(1, (ms - at) / duration)));
}

export function reportFrame(plan: ReportPlan, ms: number): ReportFrame {
  const lines = plan.lines.map((line, i) => {
    const at = START_MS + i * LINE_MS;
    return { shown: ms >= at, value: counted(ms, at, COUNT_MS, line.xp) };
  });
  const fill = plan.barMs > 0 ? Math.max(0, Math.min(1, (ms - plan.barAt) / plan.barMs)) : 1;
  // Eased in and out, so it starts gently, runs through the levels, and
  // settles on the new total rather than slamming into it.
  const eased = fill < 0.5 ? 2 * fill * fill : 1 - (-2 * fill + 2) ** 2 / 2;
  return {
    lines,
    total: {
      shown: ms >= plan.totalAt,
      value: counted(ms, plan.totalAt, TOTAL_COUNT_MS, plan.total),
    },
    barXp: Math.round(plan.from + (plan.to - plan.from) * eased),
    done: ms >= plan.endAt,
  };
}

// ------------------------------------------------------------------ the card

/** 120 → "+120"; -60 → "−60", with a real minus sign. */
function signed(xp: number): string {
  const digits = Math.abs(xp).toLocaleString('en-GB');
  return xp < 0 ? `−${digits}` : `+${digits}`;
}

export interface XpReportHandlers {
  onClose(): void;
  /** A level was crossed: `level` is the new one. For the fanfare. */
  onLevelUp(level: number): void;
}

const LEVEL_POP_MS = 500;

/** The card's bands, top to bottom, besides the lines and the note. */
const TITLE_H = 30;
/** The rule, the gap and the total under it. */
const TOTAL_H = 38;
/** Above the bar, for "Level 7!". */
const LEVEL_ROOM = 40;
/** The bar and the XP written under it. */
const BAR_H = 32;
/** The boost: how much of it is left, and the gap under that. */
const BOOST_H = 30;
const CONTINUE_H = 40;

class Row extends Container {
  readonly caption: Text;
  readonly amount: Text;
  constructor(size: number, color: number, weight: '600' | '700') {
    super();
    this.caption = label('', size, color, weight);
    this.amount = label('', size, color, '700');
    this.addChild(this.caption, this.amount);
  }
}

export class XpReport extends Container {
  private readonly scrim = new Graphics();
  /** Everything but the scrim: shrunk as one on a screen too short for it. */
  private readonly panel = new Container();
  private readonly card = new Graphics();
  private readonly bar = new Graphics();
  private readonly burst = new Graphics();
  private readonly title: Text;
  private readonly rows: Row[] = [];
  private readonly totalRow: Row;
  private readonly note: Text;
  private readonly fromBadge = new LevelBadge();
  private readonly toBadge = new LevelBadge();
  private readonly barText: Text;
  private readonly levelUp: Text;
  /** How many boosted waves are left. */
  private readonly boostLine: Text;
  private readonly continueButton: PanelButton;
  private readonly bits = confetti(36);

  private plan: ReportPlan | null = null;
  private curve: LevelCurve = { first: 1, step: 0 };
  /** The top level the XP was counted against: the bar stops there. */
  private top = Infinity;
  private keysPerLevel = 0;
  private ms = 0;
  /** The level the bar has reached, to notice it turning over. */
  private shownLevel = 0;
  /** Since the last level was crossed, for the pop and the burst; negative for none. */
  private poppedMs = -1;
  private geometry = { x: 0, y: 0, w: 0, barY: 0, barX: 0, barW: 0 };

  constructor(
    private layout: LaneLayout,
    private readonly handlers: XpReportHandlers,
  ) {
    super();
    this.visible = false;
    this.title = label('Experience', 18, UI.text, '700');
    this.totalRow = new Row(15, UI.level, '700');
    this.note = wrapped('', 11, UI.textMuted);
    this.barText = label('', 10, UI.textMuted, '600');
    this.levelUp = overlaid('', 20, UI.level, '700');
    this.boostLine = wrapped('', 12, UI.xp);
    this.boostLine.style.fontWeight = '700';
    this.boostLine.style.align = 'center';
    this.continueButton = new PanelButton('Continue', () => this.handlers.onClose());

    // The scrim takes every tap that is not a button's, so nothing reaches
    // the end-of-match card underneath; a tap on the card skips the counting.
    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.skip());
    this.card.eventMode = 'static';
    this.card.on('pointertap', () => this.skip());

    this.addChild(this.scrim, this.panel);
    this.panel.addChild(
      this.card,
      this.title,
      this.totalRow,
      this.note,
      this.bar,
      this.fromBadge,
      this.toBadge,
      this.barText,
      this.burst,
      this.levelUp,
      this.boostLine,
      this.continueButton,
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /**
   * `boost` is the line on the boost under the bar: how much is left.
   * `keysPerLevel` is what each level crossed pays, said as it is crossed.
   */
  open(result: AwardResult, curve: LevelCurve, boost: string, keysPerLevel = 0): void {
    this.plan = planReport(result);
    this.curve = curve;
    this.top = result.top;
    this.keysPerLevel = keysPerLevel;
    this.ms = 0;
    this.shownLevel = result.before.level;
    this.poppedMs = -1;
    this.boostLine.text = boost;

    for (const row of this.rows) row.destroy({ children: true });
    this.rows.length = 0;
    for (const line of this.plan.lines) {
      // Boosts in the boost's purple; the part over practice's daily cap or
      // past the top level, taken off, muted.
      const boosted = line.id === 'adBoost' || line.id === 'supporter';
      const cut = line.id === 'limit' || line.id === 'top';
      const color = boosted ? UI.xp : cut ? UI.textMuted : UI.text;
      const row = new Row(13, color, '600');
      row.caption.text = line.label;
      this.rows.push(row);
      this.panel.addChildAt(row, this.panel.getChildIndex(this.totalRow));
    }
    this.note.text = result.award.note ?? '';
    this.visible = true;
    this.arrange();
    this.update(0);
  }

  close(): void {
    this.visible = false;
    this.plan = null;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    if (this.visible) this.arrange();
  }

  /** Straight to the end: every line counted, the bar where it ends. */
  private skip(): void {
    if (!this.plan || this.ms >= this.plan.endAt) return;
    this.ms = this.plan.endAt;
    this.update(0);
  }

  update(deltaMs: number): void {
    const plan = this.plan;
    if (!this.visible || !plan) return;
    this.ms += deltaMs;
    const frame = reportFrame(plan, this.ms);
    const { x, w, barX, barY, barW } = this.geometry;
    const pad = 18;

    frame.lines.forEach((line, i) => {
      const row = this.rows[i];
      if (!row) return;
      row.visible = line.shown;
      row.amount.text = signed(line.value);
      row.amount.position.set(x + w - pad - row.amount.width, row.caption.y);
    });
    this.totalRow.visible = frame.total.shown;
    this.totalRow.amount.text = `+${frame.total.value.toLocaleString('en-GB')} XP`;
    this.totalRow.amount.position.set(
      x + w - pad - this.totalRow.amount.width,
      this.totalRow.caption.y,
    );

    // The bar: the level the XP shown so far reaches, and how far into it -
    // or full, with no next level beside it, at the top.
    const at = levelOf(frame.barXp, this.curve, this.top);
    if (at.level > this.shownLevel) {
      this.shownLevel = at.level;
      this.poppedMs = 0;
      this.levelUp.text =
        this.keysPerLevel > 0
          ? `Level ${at.level}! +${keyCount(this.keysPerLevel)}`
          : `Level ${at.level}!`;
      this.handlers.onLevelUp(at.level);
    } else if (this.poppedMs >= 0) {
      this.poppedMs += deltaMs;
    }
    const fromW = this.fromBadge.set(at.level, 20);
    this.fromBadge.position.set(barX - fromW - 8, barY - 6);
    this.toBadge.set(at.level + 1, 20);
    this.toBadge.position.set(barX + barW + 8, barY - 6);
    this.toBadge.alpha = 0.55;
    this.toBadge.visible = !at.atTop;
    this.bar.clear();
    const fill = at.atTop ? 1 : at.needed > 0 ? at.into / at.needed : 0;
    drawXpBar(this.bar, barX, barY, barW, 9, fill);
    this.barText.text = at.atTop
      ? 'Top level for now'
      : `${at.into.toLocaleString('en-GB')} / ${at.needed.toLocaleString('en-GB')} XP`;
    centreOn(this.barText, barX + barW / 2, barY + 14);

    // A level crossed: the words pop and the confetti goes up from the badge.
    if (this.poppedMs >= 0) {
      const t = Math.min(1, this.poppedMs / LEVEL_POP_MS);
      const scale = this.poppedMs < LEVEL_POP_MS ? Math.max(0.01, easeOutBack(t)) : 1;
      this.levelUp.visible = true;
      this.levelUp.scale.set(scale);
      // Scaled about its own middle rather than its corner.
      this.levelUp.position.set(
        x + w / 2 - this.levelUp.width / 2,
        barY - 34 - this.levelUp.height / 2,
      );
      drawBurst(this.burst, barX - fromW / 2 - 8, barY + 4, 90, this.poppedMs, 0.8, this.bits);
    } else {
      this.levelUp.visible = false;
      this.burst.clear();
    }
  }

  private arrange(): void {
    const screen = this.layout.screen;
    const compact = this.layout.compact;
    const w = Math.min(screen.width - 32, 360);
    const pad = 18;
    const lineH = compact ? 21 : 24;
    const count = this.rows.length;
    // As tall as the note wraps to - the top level's takes three lines on a
    // small phone - with room under it for "Level N!".
    this.note.style.wordWrapWidth = w - pad * 2;
    const noteH = this.note.text ? Math.max(34, Math.ceil(this.note.height) + 14) : 0;
    // No boost to speak of, no line for it.
    const boostH = this.boostLine.text ? BOOST_H : 8;
    // Top to bottom, the same steps the layout below takes.
    const h =
      pad +
      TITLE_H +
      count * lineH +
      TOTAL_H +
      noteH +
      LEVEL_ROOM +
      BAR_H +
      boostH +
      CONTINUE_H +
      pad;
    const x = Math.round((screen.width - w) / 2);
    const y = Math.round(Math.max(8, (screen.height - h) / 2));
    // A landscape phone has no room for six lines and the rest: the card
    // shrinks about its middle to fit, rather than spilling off the bottom.
    const scale = Math.min(1, (screen.height - 16) / h);
    this.panel.scale.set(scale);
    this.panel.position.set(
      screen.width / 2 - scale * (x + w / 2),
      screen.height / 2 - scale * (y + h / 2),
    );

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.7 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.card.clear();
    this.card
      .roundRect(x, y, w, h, 14)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1.5, color: UI.level, alpha: 0.7 });
    this.card.hitArea = new Rectangle(x, y, w, h);

    centreOn(this.title, x + w / 2, y + pad - 2);
    let ty = y + pad + TITLE_H;
    for (const row of this.rows) {
      row.caption.text = fit(row.caption.text, w - pad * 2 - 70, 13);
      row.caption.position.set(x + pad, ty);
      row.amount.position.set(x + w - pad - row.amount.width, ty);
      ty += lineH;
    }
    const rule = ty + 4;
    this.card
      .moveTo(x + pad, rule)
      .lineTo(x + w - pad, rule)
      .stroke({ width: 1, color: UI.panelEdge });
    this.totalRow.caption.text = 'Total';
    this.totalRow.caption.position.set(x + pad, rule + 8);
    this.totalRow.amount.position.set(x + w - pad - this.totalRow.amount.width, rule + 8);
    ty += TOTAL_H;
    this.note.position.set(x + pad, ty);
    ty += noteH;

    // Room above the bar for "Level 7!".
    ty += LEVEL_ROOM;
    const barW = w - pad * 2 - 2 * 58;
    const barX = x + (w - barW) / 2;
    const barY = ty;
    ty += BAR_H;
    this.geometry = { x, y, w, barX, barY, barW };

    this.boostLine.style.wordWrapWidth = w - pad * 2;
    centreOn(this.boostLine, x + w / 2, ty);
    ty += boostH;
    this.continueButton.place(x + pad, ty, w - pad * 2, CONTINUE_H);
    this.continueButton.set('Continue', 'primary');
  }
}

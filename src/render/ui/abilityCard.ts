/**
 * One ability, read in full. DESIGN.md §14.1, §7, §18.
 *
 * WHY A CARD AND NOT A PARAGRAPH IN THE PANEL
 *
 * The selected-body panel has room for about two lines, and a unit at the top
 * of its ladder has two abilities with a sentence each plus the numbers behind
 * them. Fitting all of that into the panel meant shrinking it until it did -
 * and what actually happened is that it fell back to names with no
 * descriptions at all, which is how a mark-1 Oathwall came to say "Hold the
 * Line" and nothing else.
 *
 * So the panel lists NAMES, which always fit, and each one is a button. This
 * is what opens: the authored one-liner, then the ability in full - a written
 * paragraph whose numbers are filled from the resolved ability, so they cannot
 * go stale - then the shared rules it is subject to (abilityText.ts). It covers the
 * screen because the answer is worth the screen for the two seconds it takes
 * to read, and it closes on a tap anywhere - there is nothing to decide on it,
 * so there is nothing to aim at. The scrim is what makes "anywhere" true: it
 * covers the whole screen, so a tap outside the box lands on the card rather
 * than on the board behind it.
 *
 * A long ability on a short screen (a phone held sideways) is taller than the
 * screen. The type tightens first, down to `MIN_FIT` of its size, because a
 * card read in one look is better than one that has to be moved. Past that
 * the body scrolls under a fixed close button: dragged on a touch screen,
 * wheeled with a mouse, with a thumb at the edge to say there is more. A drag
 * is told from a tap by how far the pointer moved, so reading never closes
 * the card and a tap still does.
 */

import {
  Container,
  Graphics,
  Rectangle,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Text,
} from 'pixi.js';
import type { ResolvedAbility } from '../../data/schema.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { describeAbility, type AbilityRules } from './abilityText.ts';
import { label, wrapped } from './text.ts';

/** Inset from the screen edge, and the card's own padding. */
const MARGIN = 16;
const PAD = 18;

/**
 * The card's type sizes at a text scale of 1 (layout.ts, `textScaleFor`).
 * They were 16, 11, 11 and 10, with "tap anywhere to close" at 9 in the muted
 * color - a card a player opened in order to READ, set in small print, and
 * closed by an instruction they could barely see.
 */
const TITLE_SIZE = 20;
const TEXT_SIZE = 15;
const BODY_SIZE = 14;
const LINE_SIZE = 14;
const NOTE_SIZE = 12;
const CLOSE_SIZE = 14;

/** How far the type may tighten to fit before the card scrolls instead. */
const MIN_FIT = 0.8;
/** How far a pointer moves before a press is a drag and not a tap, in pixels. */
const DRAG_SLOP = 8;

/** The card's contents at one type size, measured. */
interface Body {
  title: Text;
  text: Text;
  lines: Text[];
  notes: Text[];
  gap: number;
  lineGap: number;
  noteGap: number;
  height: number;
}

export class AbilityCard extends Container {
  private layout: LaneLayout;
  /** What is showing, so a repeated frame costs nothing. */
  private signature = '';

  /** The scrolling body, and how far it can go; 0 when it all fits. */
  private content: Container | null = null;
  private thumb: Graphics | null = null;
  private scroll = 0;
  private scrollMax = 0;
  private viewTop = 0;
  private viewHeight = 0;
  private thumbX = 0;
  /** The press in progress, and whether the last one was a drag. */
  private press: { y: number; scroll: number; moved: boolean } | null = null;
  private dragged = false;

  /**
   * `onDismiss` is not optional decoration: it is the whole of how the card
   * closes.
   *
   * The card is re-rendered every frame from whatever its owner says is open
   * (game.ts), so hiding ITSELF lasts exactly one frame - the next render puts
   * it straight back, and the tap looks like it did nothing. A dismissal has to
   * reach the thing that decides what is open, and this is the wire it travels
   * down.
   */
  constructor(
    layout: LaneLayout,
    private readonly onDismiss: () => void,
    /** The data the shared notes are written from (energy, control, dampening). */
    private readonly rules?: AbilityRules,
  ) {
    super();
    this.layout = layout;
    this.visible = false;
    this.eventMode = 'static';
    this.on('pointerdown', (event: FederatedPointerEvent) => {
      this.press = { y: event.global.y, scroll: this.scroll, moved: false };
      this.dragged = false;
    });
    // Heard wherever the pointer goes, so a drag that leaves the card still
    // moves it.
    this.on('globalpointermove', (event: FederatedPointerEvent) => {
      const press = this.press;
      if (!press || this.scrollMax <= 0) return;
      const dy = event.global.y - press.y;
      if (Math.abs(dy) > DRAG_SLOP) press.moved = true;
      if (press.moved) this.scrollTo(press.scroll - dy);
    });
    const release = () => {
      this.dragged = this.press?.moved ?? false;
      this.press = null;
    };
    this.on('pointerup', release);
    this.on('pointerupoutside', release);
    this.on('pointertap', () => {
      if (this.dragged || this.press?.moved) return;
      this.onDismiss();
    });
    this.on('wheel', (event: FederatedWheelEvent) => this.scrollTo(this.scroll + event.deltaY));
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.signature = '';
  }

  close(): void {
    this.visible = false;
    this.signature = '';
    this.clear();
  }

  /**
   * Draw the card for `ability`, or close if there is none.
   *
   * Takes a RESOLVED ability rather than an id and a rank, because resolving is
   * the definition index's job and doing it here would be the renderer holding
   * an opinion about what rank a unit has (§15.3).
   */
  render(ability: ResolvedAbility | null): void {
    if (!ability) {
      if (this.visible) this.close();
      return;
    }

    const signature = `${ability.id}:${ability.rank}:${this.layout.screen.width}x${this.layout.screen.height}`;
    if (this.visible && signature === this.signature) return;
    this.signature = signature;
    this.visible = true;
    this.clear();

    const card = describeAbility(ability, this.rules);
    const screen = this.layout.screen;
    const scale = this.layout.textScale;
    const px = (size: number) => Math.round(size * scale);
    const width = Math.min(screen.width - MARGIN * 2, Math.round(440 * Math.max(1, scale)));
    const x = (screen.width - width) / 2;
    const inner = width - PAD * 2;

    // Not a footnote: the one thing to do with the card, said where a button
    // would be and looking like one.
    const dismiss = label('Tap anywhere to close', px(CLOSE_SIZE), UI.background, '700');
    const closeH = Math.round(dismiss.height + 16);
    // The body's share of the screen: everything but the margins, the padding,
    // the close button and the gap above it.
    const room = screen.height - MARGIN * 2 - PAD * 2 - closeH - px(10);

    // Laid out top down against a measured height, so the box is exactly as
    // tall as what is in it however long the wording turns out - tightened a
    // step at a time when that is taller than the screen.
    const lay = (fit: number): Body => {
      const size = (n: number) => Math.round(n * scale * fit);
      const title = label(card.name, size(TITLE_SIZE), UI.text, '700');
      const text = wrapped(card.text, size(TEXT_SIZE), UI.text);
      text.style.wordWrapWidth = inner;
      // The paragraph, or for an ability that has none the generated lines.
      const lines = card.description
        ? [wrapped(card.description, size(BODY_SIZE), UI.text)]
        : card.mechanics.map((line) => wrapped(`· ${line}`, size(LINE_SIZE), UI.textMuted));
      for (const line of lines) line.style.wordWrapWidth = inner;
      const notes = card.notes.map((line) => {
        const item = wrapped(line, size(NOTE_SIZE), UI.textMuted);
        item.style.wordWrapWidth = inner;
        return item;
      });
      const gap = size(10);
      const lineGap = size(6);
      const noteGap = size(8);
      let height = title.height + gap + text.height + gap;
      for (const line of lines) height += line.height + lineGap;
      for (const note of notes) height += noteGap + note.height;
      return { title, text, lines, notes, gap, lineGap, noteGap, height };
    };
    let fit = 1;
    let body = lay(fit);
    while (body.height > room && fit > MIN_FIT + 0.001) {
      for (const part of [body.title, body.text, ...body.lines, ...body.notes]) part.destroy();
      fit = Math.max(MIN_FIT, fit - 0.05);
      body = lay(fit);
    }
    const scrolls = body.height > room;
    const viewHeight = scrolls ? room : body.height;
    const height = PAD + viewHeight + body.gap + closeH + PAD;
    const y = Math.max(MARGIN, (screen.height - height) / 2);

    // A scrim over the whole screen: the card is modal, and a tap anywhere
    // outside it has to reach this rather than the board underneath.
    const scrim = new Graphics();
    scrim.rect(0, 0, screen.width, screen.height).fill({ color: 0x000000, alpha: 0.6 });
    const box = new Graphics();
    box
      .roundRect(x, y, width, height, 14)
      .fill({ color: UI.panel })
      .stroke({ width: 1.5, color: UI.accent, alpha: 0.7 });
    this.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.addChild(scrim, box);

    const content = new Container();
    let cursor = 0;
    body.title.position.set(0, cursor);
    cursor += body.title.height + body.gap;
    body.text.position.set(0, cursor);
    cursor += body.text.height + body.gap;
    for (const line of body.lines) {
      line.position.set(0, cursor);
      cursor += line.height + body.lineGap;
    }
    for (const note of body.notes) {
      note.position.set(0, cursor + body.noteGap);
      cursor += body.noteGap + note.height;
    }
    content.addChild(body.title, body.text, ...body.lines, ...body.notes);
    this.addChild(content);
    this.content = content;
    this.viewTop = y + PAD;
    this.viewHeight = viewHeight;
    this.scroll = 0;
    this.scrollMax = scrolls ? body.height - viewHeight : 0;
    content.x = x + PAD;

    if (scrolls) {
      const mask = new Graphics();
      mask.rect(x, this.viewTop, width, viewHeight).fill({ color: 0xffffff });
      this.addChild(mask);
      content.mask = mask;
      this.thumb = new Graphics();
      this.thumbX = x + width - PAD / 2 - 2;
      this.addChild(this.thumb);
    }
    this.scrollTo(0);

    const closeY = y + height - PAD - closeH;
    box.roundRect(x + PAD, closeY, inner, closeH, 10).fill({ color: UI.accent });
    if (scrolls) dismiss.text = 'Drag to read on, tap to close';
    dismiss.position.set(x + (width - dismiss.width) / 2, closeY + (closeH - dismiss.height) / 2);
    this.addChild(dismiss);
  }

  /** Move the body to `to`, kept between its top and its last line. */
  private scrollTo(to: number): void {
    this.scroll = Math.min(this.scrollMax, Math.max(0, to));
    if (this.content) this.content.y = this.viewTop - this.scroll;
    const thumb = this.thumb;
    if (!thumb || this.scrollMax <= 0) return;
    const total = this.viewHeight + this.scrollMax;
    const length = Math.max(24, (this.viewHeight * this.viewHeight) / total);
    const top = this.viewTop + (this.scroll / this.scrollMax) * (this.viewHeight - length);
    thumb.clear().roundRect(this.thumbX, top, 4, length, 2).fill({ color: UI.accent, alpha: 0.8 });
  }

  /** Take everything down, textures included: the card is rebuilt, never reused. */
  private clear(): void {
    for (const child of this.removeChildren()) child.destroy({ children: true });
    this.content = null;
    this.thumb = null;
    this.scroll = 0;
    this.scrollMax = 0;
    this.press = null;
  }
}

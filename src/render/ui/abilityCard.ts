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
 * is what opens: the authored sentence, then every number, generated from the
 * resolved ability so it cannot go stale (abilityText.ts). It covers the
 * screen because the answer is worth the screen for the two seconds it takes
 * to read, and it closes on a tap anywhere - there is nothing to decide on it,
 * so there is nothing to aim at. The scrim is what makes "anywhere" true: it
 * covers the whole screen, so a tap outside the box lands on the card rather
 * than on the board behind it.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { ResolvedAbility } from '../../data/schema.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { describeAbility, CONTROL_NOTE } from './abilityText.ts';
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
const LINE_SIZE = 14;
const NOTE_SIZE = 13;
const CLOSE_SIZE = 14;

export class AbilityCard extends Container {
  private layout: LaneLayout;
  /** What is showing, so a repeated frame costs nothing. */
  private signature = '';

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
  ) {
    super();
    this.layout = layout;
    this.visible = false;
    this.eventMode = 'static';
    this.on('pointertap', () => this.onDismiss());
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.signature = '';
  }

  close(): void {
    this.visible = false;
    this.signature = '';
    this.removeChildren();
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
    this.removeChildren();

    const card = describeAbility(ability);
    const screen = this.layout.screen;
    const scale = this.layout.textScale;
    const px = (size: number) => Math.round(size * scale);
    const width = Math.min(screen.width - MARGIN * 2, Math.round(440 * Math.max(1, scale)));
    const x = (screen.width - width) / 2;
    const inner = width - PAD * 2;
    const controls = ability.effects.some((e) => e.kind === 'control');

    // Laid out top down against a measured height, so the box is exactly as
    // tall as what is in it however long the wording turns out.
    const title = label(card.name, px(TITLE_SIZE), UI.text, '700');
    const text = wrapped(card.text, px(TEXT_SIZE), UI.text);
    text.style.wordWrapWidth = inner;
    const lines = card.mechanics.map((line) => {
      const item = wrapped(`· ${line}`, px(LINE_SIZE), UI.textMuted);
      item.style.wordWrapWidth = inner - 6;
      return item;
    });
    const note = controls ? wrapped(CONTROL_NOTE, px(NOTE_SIZE), UI.textMuted) : null;
    if (note) note.style.wordWrapWidth = inner;
    // Not a footnote: the one thing to do with the card, said where a button
    // would be and looking like one.
    const dismiss = label('Tap anywhere to close', px(CLOSE_SIZE), UI.background, '700');
    const closeH = Math.round(dismiss.height + 16);

    const gap = px(10);
    let height = PAD;
    height += title.height + gap;
    height += text.height + gap;
    for (const line of lines) height += line.height + px(6);
    if (note) height += px(6) + note.height;
    height += gap + closeH + PAD;

    // Taller than the screen only on a very long ability on a very short
    // screen; it starts at the top then, rather than off it.
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

    let cursor = y + PAD;
    title.position.set(x + PAD, cursor);
    this.addChild(title);
    cursor += title.height + gap;

    text.position.set(x + PAD, cursor);
    this.addChild(text);
    cursor += text.height + gap;

    for (const line of lines) {
      line.position.set(x + PAD, cursor);
      this.addChild(line);
      cursor += line.height + px(6);
    }
    if (note) {
      note.position.set(x + PAD, cursor + px(6));
      this.addChild(note);
    }

    const closeY = y + height - PAD - closeH;
    box.roundRect(x + PAD, closeY, inner, closeH, 10).fill({ color: UI.accent });
    dismiss.position.set(x + (width - dismiss.width) / 2, closeY + (closeH - dismiss.height) / 2);
    this.addChild(dismiss);
  }
}

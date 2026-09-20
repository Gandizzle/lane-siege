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
const MARGIN = 20;
const PAD = 16;
const LINE = 15;

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
    const width = Math.min(screen.width - MARGIN * 2, 380);
    const x = (screen.width - width) / 2;
    const inner = width - PAD * 2;
    const controls = ability.effects.some((e) => e.kind === 'control');

    // Laid out top down against a measured height, so the box is exactly as
    // tall as what is in it however long the wording turns out.
    const title = label(card.name, 16, UI.text, '700');
    const text = wrapped(card.text, 11, UI.textMuted);
    text.style.wordWrapWidth = inner;
    const lines = card.mechanics.map((line) => {
      const item = wrapped(`· ${line}`, 11, UI.text);
      item.style.wordWrapWidth = inner - 6;
      return item;
    });
    const note = controls ? wrapped(CONTROL_NOTE, 10, UI.textMuted) : null;
    if (note) note.style.wordWrapWidth = inner;
    const dismiss = label('tap anywhere to close', 9, UI.textMuted);

    let height = PAD;
    height += 22 + 4;
    height += text.height + 10;
    for (const line of lines) height += line.height + 5;
    if (note) height += 6 + note.height;
    height += 10 + LINE + PAD - 10;

    const y = Math.max(MARGIN, (screen.height - height) / 2);

    // A scrim over the whole screen: the card is modal, and a tap anywhere
    // outside it has to reach this rather than the board underneath.
    const scrim = new Graphics();
    scrim.rect(0, 0, screen.width, screen.height).fill({ color: 0x000000, alpha: 0.55 });
    const box = new Graphics();
    box
      .roundRect(x, y, width, height, 12)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    this.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.addChild(scrim, box);

    let cursor = y + PAD;
    title.position.set(x + PAD, cursor);
    this.addChild(title);
    cursor += 22 + 4;

    text.position.set(x + PAD, cursor);
    this.addChild(text);
    cursor += text.height + 10;

    for (const line of lines) {
      line.position.set(x + PAD, cursor);
      this.addChild(line);
      cursor += line.height + 5;
    }
    if (note) {
      note.position.set(x + PAD, cursor + 6);
      this.addChild(note);
    }

    dismiss.position.set(x + PAD, y + height - PAD - 2);
    this.addChild(dismiss);
  }
}

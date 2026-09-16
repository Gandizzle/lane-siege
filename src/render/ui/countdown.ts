/**
 * "Final Showdown in 3..." DESIGN.md §3.3, replaced.
 *
 * The one moment in a match where the screen stops being a board. Twenty-five
 * waves of building end, the lanes go away, and what replaces them is not
 * another board but a card: the armies are already standing in the arena and
 * the simulation is holding them still (showdown.ts) while this counts.
 *
 * Opaque rather than an overlay, because it is a CUT. Showing the arena
 * dimmed behind it would make the countdown feel like a pause in a fight
 * already happening, which is the opposite of the beat this is here to land.
 */

import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { TICKS_PER_SECOND } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { centreOn, label } from './text.ts';

/**
 * What the big numeral reads at `ticks` left.
 *
 * Rounded UP, so a card set to three seconds opens on "3" and each numeral is
 * on screen for a full second. Rounding down would show "3" for one tick and
 * "0" for a second, which is a countdown that lies at both ends.
 */
export function countdownNumeral(ticks: number): number {
  return Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
}

export class ShowdownCountdown extends Container {
  private readonly backdrop = new Graphics();
  private readonly caption: Text;
  private readonly numeral: Text;
  private layout: LaneLayout;
  private showing = -1;

  constructor(layout: LaneLayout) {
    super();
    this.layout = layout;
    this.caption = label('Final Showdown in', 20, UI.textMuted, '600');
    this.numeral = label('', 108, UI.text, '700');
    this.addChild(this.backdrop, this.caption, this.numeral);
    this.visible = false;
    this.setLayout(layout);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    const { width, height } = layout.screen;

    this.backdrop.clear();
    this.backdrop.rect(0, 0, width, height).fill({ color: UI.background });

    centreOn(this.caption, width / 2, height / 2 - 92);
    this.place();
  }

  /** Visible exactly while the simulation is holding the armies still. */
  render(countdownTicks: number): void {
    const numeral = countdownNumeral(countdownTicks);
    this.visible = numeral > 0;
    if (!this.visible || numeral === this.showing) return;

    this.showing = numeral;
    this.numeral.text = `${numeral}…`;
    this.place();
  }

  private place(): void {
    const { width, height } = this.layout.screen;
    centreOn(this.numeral, width / 2, height / 2 - 56);
  }
}

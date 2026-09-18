/**
 * The one button shape every panel in the build bar uses.
 *
 * Built once and only updated afterwards - see the note at the top of
 * buildBar.ts on why rebuilding an interactive object per frame makes it dead.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { UI } from '../palette.ts';
import { drawEntity } from '../shapes.ts';
import type { EntityStyle } from '../shapes.ts';
import { fit, label } from './text.ts';

/**
 * How long a press has to be held to count as a hold rather than a tap.
 *
 * A second. Long enough that nobody arms auto-send by mistake, short enough
 * that holding does not feel like waiting - and the button fills a bar along
 * its bottom edge while the clock runs, so the gesture explains itself the
 * first time somebody's thumb rests on it.
 */
export const HOLD_MS = 1000;

/** How long the blink after a press lasts. */
const FLASH_MS = 240;

export class GridButton extends Container {
  private readonly bg = new Graphics();
  private readonly ring = new Graphics();
  private readonly swatch = new Graphics();
  private readonly pulse = new Graphics();
  private readonly title: Text;
  private readonly detail: Text;
  private readonly note: Text;
  private w = 0;
  private h = 0;

  /** Milliseconds left on the blink, and on the press being held. */
  private flashLeft = 0;
  private holdMs = 0;
  private holding = false;
  /** A hold that has already fired: the release must not also count as a tap. */
  private holdFired = false;
  /** False while the button is dimmed: it still takes events, taps just do nothing. */
  private tappable = true;

  constructor(
    onTap: () => void,
    /** Press and hold for `HOLD_MS`. Absent: the button has no hold gesture. */
    private readonly onHold?: () => void,
  ) {
    super();
    this.title = label('', 11, UI.text, '700');
    this.detail = label('', 9, UI.textMuted);
    this.note = label('', 9, UI.textMuted, '700');
    this.addChild(this.bg, this.swatch, this.ring, this.pulse, this.title, this.detail, this.note);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => {
      // A release that completed a hold is not a tap. Consumed here rather
      // than cleared on release, because Pixi fires the release first.
      if (this.holdFired) {
        this.holdFired = false;
        return;
      }
      if (this.tappable) onTap();
    });
    this.on('pointerdown', () => {
      this.holding = this.onHold !== undefined;
      this.holdMs = 0;
      this.holdFired = false;
    });
    this.on('pointerup', () => (this.holding = false));
    this.on('pointerupoutside', () => {
      this.holding = false;
      this.holdFired = false;
    });
  }

  /**
   * Wall-clock time, not ticks: a blink and a hold are things a thumb does, and
   * they run at the same speed whatever the simulation is doing.
   */
  animate(deltaMs: number): void {
    const wasHolding = this.holding && !this.holdFired;
    if (this.holding && !this.holdFired) {
      this.holdMs += deltaMs;
      if (this.holdMs >= HOLD_MS) {
        this.holdFired = true;
        this.holding = false;
        this.onHold?.();
      }
    }
    if (this.flashLeft > 0) this.flashLeft = Math.max(0, this.flashLeft - deltaMs);

    // Redraw only while something is moving, or on the frame it stops.
    if (wasHolding || this.flashLeft > 0 || this.pulseDrawn) this.drawPulse();
  }

  /** Whether the overlay currently has anything in it, so it is cleared once. */
  private pulseDrawn = false;

  private drawPulse(): void {
    this.pulse.clear();
    this.pulseDrawn = false;

    if (this.flashLeft > 0) {
      // Fades out rather than in: the moment of the press is the bright one.
      this.pulse
        .roundRect(0, 0, this.w, this.h, 8)
        .fill({ color: UI.selected, alpha: 0.45 * (this.flashLeft / FLASH_MS) });
      this.pulseDrawn = true;
    }
    if (this.holding && !this.holdFired && this.holdMs > 0) {
      const fraction = Math.min(1, this.holdMs / HOLD_MS);
      this.pulse.rect(0, this.h - 3, this.w * fraction, 3).fill({ color: UI.accent, alpha: 0.9 });
      this.pulseDrawn = true;
    }
  }

  /** Blink, to say that the press did something. */
  flash(): void {
    this.flashLeft = FLASH_MS;
    this.drawPulse();
  }

  layout(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);

    this.bg.clear();
    this.bg.roundRect(0, 0, width, height, 8).fill({ color: UI.panel });
    this.bg.roundRect(0, 0, width, height, 8).stroke({ width: 1, color: UI.panelEdge });

    this.ring.clear();
    this.ring.roundRect(0, 0, width, height, 8).stroke({ width: 2, color: UI.selected });
    this.ring.visible = false;

    // Detail and note hang off the BOTTOM, so a tall grid tile has its price
    // where the eye lands rather than crowding the name. A short button - the
    // 44px action row in the selected-unit panel - has no such room, and the
    // bottom-up positions walk straight into the title, so they stack from the
    // title down instead. Whichever is lower wins.
    this.title.x = 8;
    this.title.y = 6;
    this.detail.x = 8;
    this.detail.y = Math.max(22, height - 30);
    this.note.x = 8;
    this.note.y = Math.max(this.detail.y + 11, height - 16);
  }

  /**
   * The mark in the top-right corner: a plain chip for a colour, or the body
   * itself for a unit.
   *
   * A unit button gets the real silhouette - the same armour shape, the same
   * damage-type fill, the same tier pips that §14.2 draws on the board. A
   * player choosing what to build is choosing a shape they will have to read in
   * a crowd three seconds later, and a row of identical squares teaches them
   * nothing about which shape that is. Everything else here is genuinely a
   * colour and nothing more - a damage type, an aura - and stays a chip.
   */
  setSwatch(mark: number | EntityStyle | null): void {
    this.swatch.clear();
    if (mark === null) return;

    const size = Math.min(14, this.h * 0.22);
    if (typeof mark === 'number') {
      this.swatch.roundRect(this.w - size - 8, 7, size, size, 3).fill({ color: mark });
      return;
    }
    // Centred in the same box the chip occupies, and sized so a tier 3 body -
    // which §14.2 draws larger - still lands inside it along with its pips.
    const radius = (size / 2) * 0.82;
    drawEntity(this.swatch, mark, this.w - size / 2 - 8, 7 + size / 2 - radius * 0.3, radius);
  }

  update(opts: {
    title: string;
    detail: string;
    note?: string;
    noteColour?: number;
    /** Dimmed and unresponsive to taps when false. */
    enabled: boolean;
    /**
     * Whether the button takes pointer events at all. Defaults to `enabled`.
     *
     * The two come apart for exactly one thing: a send you cannot currently
     * afford is dimmed and does nothing when tapped, but must still take a
     * HOLD, because "fire this as soon as I can afford it" is the whole point
     * of arming auto-send (buildBar.ts).
     */
    interactive?: boolean;
    selected?: boolean;
    /** Ring colour, for a selection that means something other than "chosen". */
    selectedColour?: number;
  }): void {
    // Every line is cut to the button it is in. A button knows its own width
    // and the strings it is handed do not - "Revenant · Raider's Haste" fits a
    // landscape column and runs off a portrait one - so the cut belongs here
    // rather than at each of the dozen call sites that build a label.
    const room = this.w - 16;
    const title = fit(opts.title, room, this.title.style.fontSize as number);
    const detail = fit(opts.detail, room, this.detail.style.fontSize as number);
    if (this.title.text !== title) this.title.text = title;
    if (this.detail.text !== detail) this.detail.text = detail;

    const note = fit(opts.note ?? '', room, this.note.style.fontSize as number);
    if (this.note.text !== note) this.note.text = note;
    this.note.visible = note.length > 0;
    if (note.length > 0) this.note.style.fill = opts.noteColour ?? UI.textMuted;

    this.ring.visible = opts.selected === true;
    if (opts.selected === true) {
      this.ring.clear();
      this.ring
        .roundRect(0, 0, this.w, this.h, 8)
        .stroke({ width: 2, color: opts.selectedColour ?? UI.selected });
    }

    this.alpha = opts.enabled ? 1 : 0.42;
    const interactive = opts.interactive ?? opts.enabled;
    this.tappable = opts.enabled;
    this.eventMode = interactive ? 'static' : 'none';
    if (!interactive) {
      this.holding = false;
      this.holdFired = false;
    }
  }
}

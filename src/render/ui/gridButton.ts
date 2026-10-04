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
import { RichLabel } from './currency.ts';
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

/**
 * The three lines' sizes at a text scale of 1 (layout.ts, `textScaleFor`):
 * the name, the price, and the note under it.
 *
 * They were 11, 9 and 9, which put the price - the number a player reads the
 * button FOR - in the smallest type on it.
 */
export const TITLE_SIZE = 14;
export const DETAIL_SIZE = 13;
export const NOTE_SIZE = 12;
/** A line's height, as a multiple of its font size. */
const LINE = 1.25;
/**
 * How far a button may shrink all three lines to fit a short box. Below this
 * the note is dropped rather than the type shrunk further.
 */
const MIN_FIT = 0.78;
/** How far a long name may shrink to fit its width before a shorter name, or an ellipsis. */
const MIN_TITLE_FIT = 0.85;

/**
 * The three sizes a button of this height draws its lines at, on this screen.
 * `inline` is a button with its price beside its name, which has two lines to
 * fit rather than three.
 */
export function lineSizes(
  height: number,
  textScale: number,
  inline = false,
): { title: number; detail: number; note: number; pad: number } {
  const pad = Math.round(Math.max(5, Math.min(9, 6 * textScale)));
  const wanted = (TITLE_SIZE + (inline ? 0 : DETAIL_SIZE) + NOTE_SIZE) * LINE * textScale;
  const fit = textScale * Math.max(MIN_FIT, Math.min(1, (height - pad * 2) / wanted));
  return {
    title: Math.round(TITLE_SIZE * fit),
    detail: Math.round(DETAIL_SIZE * fit),
    note: Math.round(NOTE_SIZE * fit),
    pad,
  };
}

export class GridButton extends Container {
  private readonly bg = new Graphics();
  private readonly ring = new Graphics();
  private readonly swatch = new Graphics();
  /**
   * The cooldown: a shade over the part of the button still waiting, drawn
   * from the right and shrinking towards it as the time runs out. A sweep and
   * not a number, so it reads at a glance and never has to be read at all.
   */
  private readonly shade = new Graphics();
  /** The button's own rounded outline, so the shade never spills past a corner. */
  private readonly shadeMask = new Graphics();
  /** The fraction last drawn, so a shade that has not moved is not redrawn. */
  private shadeDrawn = 0;
  private readonly pulse = new Graphics();
  private readonly title: Text;
  private readonly detail: RichLabel;
  /** The second half of a price, on its own line when the first would not hold both. */
  private readonly detailMore: RichLabel;
  private readonly note: RichLabel;
  private w = 0;
  private h = 0;
  /** The lines' sizes and the inset, from the last layout (`lineSizes`). */
  private sizes = { title: TITLE_SIZE, detail: DETAIL_SIZE, note: NOTE_SIZE, pad: 6 };
  private swatchSize = 14;
  private hasSwatch = false;
  /** Whether the third line has room under the other two. */
  private noteFits = true;
  /** Where the price line sits when it is one line. */
  private detailY = 0;
  /** Whether the button was last drawn usable; null before the first draw. */
  private live: boolean | null = null;
  /** What the name was last fitted from, so it is measured once per change. */
  private titleKey = '';
  /** The price beside the name rather than under it (`priceBesideName`). */
  private inline = false;
  /** What an inline button's line was last fitted for. */
  private inlineKey = '';

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
    this.title = label('', TITLE_SIZE, UI.text, '700');
    // Prices: they may carry coin, gem and supply icons (currency.ts).
    this.detail = new RichLabel(DETAIL_SIZE, UI.text, '600');
    this.detailMore = new RichLabel(DETAIL_SIZE, UI.text, '600');
    this.note = new RichLabel(NOTE_SIZE, UI.textMuted, '700');
    this.shade.mask = this.shadeMask;
    this.addChild(
      this.bg,
      this.swatch,
      this.shadeMask,
      this.shade,
      this.ring,
      this.pulse,
      this.title,
      this.detail,
      this.detailMore,
      this.note,
    );

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

  /**
   * Place the button, and size its lines for its box: the screen's text
   * scale, shrunk as far as `MIN_FIT` where three lines at full size would not
   * fit the height.
   */
  layout(x: number, y: number, width: number, height: number, textScale = 1): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);

    this.sizes = lineSizes(height, textScale, this.inline);
    const { title, detail, note, pad } = this.sizes;
    this.title.style.fontSize = title;
    this.detail.setFontSize(detail);
    this.detailMore.setFontSize(detail);
    this.note.setFontSize(note);
    this.swatchSize = Math.round(Math.min(14 * textScale, height * 0.24));
    this.titleKey = '';
    this.inlineKey = '';

    this.drawBackground();
    this.ring.clear();
    this.ring.roundRect(0, 0, width, height, 8).stroke({ width: 2, color: UI.selected });
    this.ring.visible = false;

    this.shadeMask.clear();
    this.shadeMask.roundRect(0, 0, width, height, 8).fill({ color: 0xffffff });
    this.drawShade(this.shadeDrawn);

    // Detail and note hang off the BOTTOM, so a tall grid tile has its price
    // where the eye lands rather than crowding the name. A short button - the
    // action row in the selected-unit panel - has no such room, and the
    // bottom-up positions walk straight into the title, so they stack from the
    // title down instead. Whichever is lower wins.
    const inset = pad + 2;
    this.title.x = inset;
    this.title.y = pad;
    let noteY = height - pad - note * LINE;
    let detailY = noteY - detail * LINE;
    const underTitle = pad + title * LINE;
    if (this.inline) {
      // The price shares the name's line; the note is the second line.
      detailY = pad + ((title - detail) * LINE) / 2;
      noteY = Math.max(underTitle, noteY);
    } else if (detailY < underTitle) {
      detailY = underTitle;
      noteY = detailY + detail * LINE;
    }
    this.detail.x = inset;
    this.detail.y = detailY;
    this.detailY = detailY;
    this.detailMore.x = inset;
    this.note.x = inset;
    this.note.y = noteY;
    // Only where it fits: on a short button the third line would be drawn
    // across the bottom edge and into the row below it.
    this.noteFits = noteY + note * LINE <= height + 1;
  }

  /**
   * Put the price on the name's line, after the name, for a short button that
   * has to say both at a size worth reading: Upgrade and Sell, whose height is
   * a touch target and no more. Set once, before the first layout.
   */
  priceBesideName(): this {
    this.inline = true;
    return this;
  }

  /**
   * The button's ground: raised while it can be used, recessed while it
   * cannot. The words stay readable either way - the whole button used to be
   * faded to two-fifths, which took a price you cannot afford yet down to a
   * smudge exactly when it is the number you are saving towards.
   */
  private drawBackground(): void {
    const live = this.live ?? true;
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.w, this.h, 8)
      .fill({ color: live ? UI.panel : UI.panelAsleep })
      .stroke({ width: 1, color: UI.panelEdge });
  }

  /**
   * The mark in the top-right corner: a plain chip for a colour, or the body
   * itself for a unit.
   *
   * A unit button gets the real silhouette - the same armour shape, the same
   * damage-type fill, the same mark pips that §14.2 draws on the board. A
   * player choosing what to build is choosing a shape they will have to read in
   * a crowd three seconds later, and a row of identical squares teaches them
   * nothing about which shape that is. Everything else here is genuinely a
   * colour and nothing more - a damage type, an aura - and stays a chip.
   */
  setSwatch(mark: number | EntityStyle | null): void {
    this.swatch.clear();
    this.hasSwatch = mark !== null;
    if (mark === null) return;

    const size = this.swatchSize;
    const top = this.sizes.pad + 1;
    if (typeof mark === 'number') {
      this.swatch.roundRect(this.w - size - 8, top, size, size, 3).fill({ color: mark });
      return;
    }
    // Centred in the same box the chip occupies, and sized so a mark 3 body -
    // which §14.2 draws larger - still lands inside it along with its pips.
    const radius = (size / 2) * 0.82;
    drawEntity(this.swatch, mark, this.w - size / 2 - 8, top + size / 2 - radius * 0.3, radius);
  }

  /**
   * Shade the part of the button still cooling down: 1 is the whole button,
   * just bought; 0 is ready. The edge of the shade carries a bright line, so
   * the sweep is visible even over a dark swatch.
   */
  private drawShade(fraction: number): void {
    this.shade.clear();
    this.shadeDrawn = fraction;
    if (fraction <= 0) return;
    const x = this.w * (1 - fraction);
    this.shade.rect(x, 0, this.w - x, this.h).fill({ color: 0x000000, alpha: 0.55 });
    this.shade.rect(x, 0, 2, this.h).fill({ color: UI.accent, alpha: 0.9 });
  }

  update(opts: {
    title: string;
    /** A shorter name, for a button too narrow for `title` (Regeneration, Regen). */
    shortTitle?: string | undefined;
    detail: string;
    /**
     * More of the price - what it buys, say - that follows `detail` on the same
     * line where there is room, and goes on a line of its own under it where
     * there is not and the button is tall enough for four. Otherwise the two
     * share one line, shrunk to fit.
     */
    detailMore?: string;
    note?: string;
    noteColour?: number;
    /** Cooldown still to run, as a fraction of the whole: 0 or absent is ready. */
    cooldown?: number;
    /** The title alone, in the middle of the button: an arrow, a glyph. */
    centred?: boolean;
    /** Recessed and unresponsive to taps when false. */
    enabled: boolean;
    /**
     * Out for want of money, and nothing else: the price is drawn in the
     * can't-afford colour, so the button says WHY it is out. A button out for
     * any other reason - the wrong phase, the top of its ladder - keeps its
     * price in the muted text colour.
     */
    unaffordable?: boolean;
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
    const inset = this.sizes.pad + 2;
    const room = this.w - inset * 2;
    if (opts.centred === true) {
      if (this.title.text !== opts.title) this.title.text = opts.title;
      this.title.style.fontSize = this.sizes.title;
      this.titleKey = '';
      this.title.x = (this.w - this.title.width) / 2;
      this.title.y = (this.h - this.title.height) / 2;
    } else if (this.inline) {
      // Price first, because it is the half that must not be cut; the name
      // gets what is left of the line beside it. The swatch in the corner is
      // the first thing given up for the name, on a button too narrow for all
      // three. Decided once per change of what it says, not every frame: the
      // two tries measure the name at two widths.
      const key = `${opts.title}|${opts.shortTitle ?? ''}|${opts.detail}|${room}|${this.hasSwatch}`;
      if (key !== this.inlineKey) {
        this.inlineKey = key;
        const swatch = this.hasSwatch ? this.swatchSize + 6 : 0;
        this.detail.set(opts.detail, room - swatch);
        const price = this.detail.width;
        this.fitTitle(opts.title, opts.shortTitle, room - swatch - price - 8);
        this.swatch.visible = true;
        if (swatch > 0 && this.title.text.endsWith('…')) {
          this.swatch.visible = false;
          this.fitTitle(opts.title, opts.shortTitle, room - price - 8);
        }
      }
      this.title.x = inset;
      this.title.y = this.sizes.pad;
      this.detail.x = inset + this.title.width + 8;
      this.detailMore.visible = false;
    } else {
      // The name does not run under the swatch in the corner.
      this.fitTitle(opts.title, opts.shortTitle, room - (this.hasSwatch ? this.swatchSize + 6 : 0));
      this.title.x = inset;
      this.title.y = this.sizes.pad;
    }
    if (!this.inline) this.placeDetail(opts.detail, opts.detailMore ?? '', room);

    const note = opts.note ?? '';
    this.note.set(note, room);
    this.note.visible = note.length > 0 && this.noteFits;
    if (note.length > 0) this.note.setColour(opts.noteColour ?? UI.textMuted);

    // Usable or not, every word stays readable: the ground recesses, the name
    // goes to the muted colour, and the price says whether money is the reason.
    const live = opts.enabled;
    if (live !== this.live) {
      this.live = live;
      this.drawBackground();
      this.title.style.fill = live ? UI.text : UI.textMuted;
      this.swatch.alpha = live ? 1 : 0.5;
    }
    const priceColour =
      opts.unaffordable === true ? UI.unaffordable : live ? UI.text : UI.textMuted;
    this.detail.setColour(priceColour);
    this.detailMore.setColour(live ? UI.text : UI.textMuted);

    this.ring.visible = opts.selected === true;
    if (opts.selected === true) {
      this.ring.clear();
      this.ring
        .roundRect(0, 0, this.w, this.h, 8)
        .stroke({ width: 2, color: opts.selectedColour ?? UI.selected });
    }

    // Redrawn in hundredths: a smooth sweep, and nothing at all on the frames
    // where it has not moved.
    const cooldown = Math.round(Math.min(1, Math.max(0, opts.cooldown ?? 0)) * 100) / 100;
    if (cooldown !== this.shadeDrawn) this.drawShade(cooldown);

    const interactive = opts.interactive ?? opts.enabled;
    this.tappable = opts.enabled;
    this.eventMode = interactive ? 'static' : 'none';
    if (!interactive) {
      this.holding = false;
      this.holdFired = false;
    }
  }

  /**
   * Put `title` in the name line at the largest size that fits `room`: its
   * full size if it fits, shrunk as far as `MIN_TITLE_FIT` if that is enough,
   * then the short name the same way, and an ellipsis only after all that.
   * Measured, not estimated, and only when the name or the room changes.
   */
  private fitTitle(title: string, short: string | undefined, room: number): void {
    const key = `${title}|${short ?? ''}|${Math.round(room)}|${this.sizes.title}`;
    if (key === this.titleKey) return;
    this.titleKey = key;
    const full = this.sizes.title;
    const candidates = short && short !== title ? [title, short] : [title];
    for (const candidate of candidates) {
      this.title.style.fontSize = full;
      this.title.text = candidate;
      const width = this.title.width;
      if (width <= room) return;
      const size = Math.floor((full * room) / width);
      if (size >= full * MIN_TITLE_FIT) {
        this.title.style.fontSize = size;
        return;
      }
    }
    const last = candidates[candidates.length - 1]!;
    const size = Math.floor(full * MIN_TITLE_FIT);
    this.title.style.fontSize = size;
    this.title.text = fit(last, room, size);
  }

  /**
   * The price line: `detail` and `more` together if they fit the width at
   * full size; otherwise `more` on a line of its own if the button has the
   * height for four lines; otherwise together, shrunk to fit (currency.ts).
   */
  private placeDetail(detail: string, more: string, room: number): void {
    const together = more ? `${detail} ${more}` : detail;
    this.detail.y = this.detailY;
    this.detailMore.visible = false;
    this.detail.set(together, room);
    if (!more || this.detail.naturalWidth <= room) return;

    const line = this.sizes.detail * LINE;
    const top = this.detailY - line;
    if (top < this.sizes.pad + this.sizes.title * LINE) return;
    this.detail.set(detail, room);
    this.detail.y = top;
    this.detailMore.set(more, room);
    this.detailMore.y = this.detailY;
    this.detailMore.visible = true;
  }
}

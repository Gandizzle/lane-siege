/**
 * The abilities of the selected body, as buttons. DESIGN.md §14.1.
 *
 * A name always fits; a sentence does not. The panel has about two lines for
 * this, and shrinking a unit's two abilities plus their descriptions into that
 * space ended with the descriptions dropped entirely - so the panel lists the
 * names and each one opens a card (abilityCard.ts).
 *
 * Chips wrap like words: each is as wide as its own name, and one that does
 * not fit the row starts the next. A row that does not fit the box is not
 * drawn at all rather than drawn over the buttons below - the box is the
 * subtraction `panelRegions` made (unitStats.ts) and nothing here may spend
 * more than it.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { UI } from '../palette.ts';
import { label } from './text.ts';
import type { Rect } from './unitStats.ts';

export interface Chip {
  /** The ability, and which rank of it this body has. */
  abilityId: string;
  rank: number;
  name: string;
  /** A mark this body does not have yet: drawn dimmer, still readable. */
  upcoming: boolean;
}

const HEIGHT = 22;
const GAP = 5;
const PAD = 9;

/** Roughly how wide a chip's name will draw, for wrapping without measuring. */
function chipWidth(name: string, upcoming: boolean): number {
  const text = upcoming ? `+ ${name}` : name;
  return Math.ceil([...text].length * 6.1) + PAD * 2;
}

/**
 * Where each chip goes inside `box`, and which ones fit.
 *
 * Pure, so a test can check the wrapping and the "never past the bottom" rule
 * without a canvas. Chips that do not fit are simply absent from the result.
 */
export function layOutChips(chips: readonly Chip[], box: Rect): (Rect & { index: number })[] {
  const out: (Rect & { index: number })[] = [];
  let x = box.x;
  let y = box.y;

  for (const [index, chip] of chips.entries()) {
    const width = Math.min(chipWidth(chip.name, chip.upcoming), box.width);
    if (x > box.x && x + width > box.x + box.width) {
      x = box.x;
      y += HEIGHT + GAP;
    }
    if (y + HEIGHT > box.y + box.height + 0.001) break;
    out.push({ index, x, y, width, height: HEIGHT });
    x += width + GAP;
  }
  return out;
}

export class AbilityChips extends Container {
  private readonly background = new Graphics();
  private readonly labels: Text[] = [];
  private signature = '';

  constructor(private readonly onTap: (chip: Chip) => void) {
    super();
    this.addChild(this.background);
  }

  /** Forget what was drawn, so the next frame draws fresh. */
  reset(): void {
    this.signature = '';
  }

  render(chips: readonly Chip[], box: Rect): void {
    const signature = JSON.stringify([chips, box]);
    if (signature === this.signature) return;
    this.signature = signature;

    for (const text of this.labels) text.destroy();
    this.labels.length = 0;
    this.removeChildren();
    this.background.clear();
    this.addChild(this.background);

    for (const placed of layOutChips(chips, box)) {
      const chip = chips[placed.index]!;
      this.background
        .roundRect(placed.x, placed.y, placed.width, placed.height, 6)
        .fill({ color: chip.upcoming ? UI.background : UI.panelEdge })
        .stroke({ width: 1, color: UI.panelEdge });

      const text = label(
        chip.upcoming ? `+ ${chip.name}` : chip.name,
        10,
        chip.upcoming ? UI.textMuted : UI.text,
        '600',
      );
      text.position.set(placed.x + PAD, placed.y + 5);
      this.labels.push(text);
      this.addChild(text);

      // One hit area per chip rather than one container per chip: a rebuilt
      // interactive object never receives a tap (see the note at the top of
      // buildBar.ts), and these are rebuilt whenever the selection changes.
      const target = new Container();
      target.eventMode = 'static';
      target.cursor = 'pointer';
      target.hitArea = new Rectangle(placed.x, placed.y, placed.width, placed.height);
      target.on('pointertap', () => this.onTap(chip));
      this.addChild(target);
    }
  }
}

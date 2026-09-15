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
import { label } from './text.ts';

export class GridButton extends Container {
  private readonly bg = new Graphics();
  private readonly ring = new Graphics();
  private readonly swatch = new Graphics();
  private readonly title: Text;
  private readonly detail: Text;
  private readonly note: Text;
  private w = 0;
  private h = 0;

  constructor(onTap: () => void) {
    super();
    this.title = label('', 11, UI.text, '700');
    this.detail = label('', 9, UI.textMuted);
    this.note = label('', 9, UI.textMuted, '700');
    this.addChild(this.bg, this.swatch, this.ring, this.title, this.detail, this.note);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
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
    enabled: boolean;
    selected?: boolean;
  }): void {
    if (this.title.text !== opts.title) this.title.text = opts.title;
    if (this.detail.text !== opts.detail) this.detail.text = opts.detail;

    const note = opts.note ?? '';
    if (this.note.text !== note) this.note.text = note;
    this.note.visible = note.length > 0;
    if (note.length > 0) this.note.style.fill = opts.noteColour ?? UI.textMuted;

    this.ring.visible = opts.selected === true;
    this.alpha = opts.enabled ? 1 : 0.42;
    this.eventMode = opts.enabled ? 'static' : 'none';
  }
}

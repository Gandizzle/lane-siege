/**
 * The one button shape every panel in the build bar uses.
 *
 * Built once and only updated afterwards - see the note at the top of
 * buildBar.ts on why rebuilding an interactive object per frame makes it dead.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { UI } from '../palette.ts';
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

    this.title.x = 8;
    this.title.y = 6;
    this.detail.x = 8;
    this.detail.y = height - 30;
    this.note.x = 8;
    this.note.y = height - 16;
  }

  /** A coloured square in the top-right, for damage types and unit glyphs. */
  setSwatch(colour: number | null): void {
    this.swatch.clear();
    if (colour === null) return;
    const size = Math.min(14, this.h * 0.22);
    this.swatch.roundRect(this.w - size - 8, 7, size, size, 3).fill({ color: colour });
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

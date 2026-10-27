/**
 * A full-screen panel with a title, a way out, and a body that scrolls when it
 * is taller than the screen: the Collection and the Supporter page are both
 * one of these.
 *
 * Every other panel in the game fits its screen by design. These are
 * catalogues, or long, and a catalogue on a small phone does not fit: four
 * builders and seventeen cosmetics in six slots is taller than a 640-pixel
 * screen however small the rows are drawn. So the body scrolls - by drag, as the arena's camera does,
 * and by the mouse wheel - inside a mask, with a thin bar on the right saying
 * how much more there is.
 *
 * A drag must not end in a tap on whatever it started over, or scrolling a
 * list of buy buttons would buy things. A press that moved further than a
 * thumb's wobble is a scroll, and the tap it ends in is swallowed
 * (`tapOk`).
 *
 * Built once, like every other panel: subclasses make their pieces in their
 * constructors and only position them in `layoutBody`.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent, FederatedWheelEvent, Text } from 'pixi.js';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { PanelButton } from './menu.ts';
import { label, wrapped } from './text.ts';

/** How far a press may wander and still be a tap. */
const DRAG_SLOP = 6;

export abstract class Sheet extends Container {
  private readonly scrim = new Graphics();
  protected readonly box = new Graphics();
  private readonly titleText: Text;
  private readonly subtitle: Text;
  private readonly closeX: PanelButton;
  /** Everything that scrolls. Subclasses add to it and place it in `layoutBody`. */
  protected readonly body = new Container();
  private readonly bodyMask = new Graphics();
  private readonly scrollbar = new Graphics();
  private scrollY = 0;
  private bodyHeight = 0;
  private view = { x: 0, y: 0, width: 0, height: 0 };
  private drag: { y: number; moved: number } | null = null;
  /** The last press scrolled, so the tap it ends in is not a tap. */
  private dragged = false;
  protected layout: LaneLayout;

  constructor(
    layout: LaneLayout,
    title: string,
    subtitle: string,
    protected readonly onClose: () => void,
  ) {
    super();
    this.layout = layout;
    this.visible = false;
    this.titleText = label(title, 18, UI.text, '700');
    this.subtitle = wrapped(subtitle, 11, UI.textMuted);
    this.closeX = new PanelButton('✕', () => this.onClose());

    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.onClose());
    // The box swallows its own taps, so a tap on empty panel does not close it.
    this.box.eventMode = 'static';
    this.body.mask = this.bodyMask;

    this.addChild(
      this.scrim,
      this.box,
      this.titleText,
      this.subtitle,
      this.closeX,
      this.bodyMask,
      this.body,
      this.scrollbar,
    );

    this.eventMode = 'static';
    this.on('pointerdown', (event: FederatedPointerEvent) => {
      this.dragged = false;
      if (this.inView(event)) this.drag = { y: event.global.y, moved: 0 };
    });
    this.on('globalpointermove', (event: FederatedPointerEvent) => {
      const drag = this.drag;
      if (!drag) return;
      const dy = event.global.y - drag.y;
      drag.y = event.global.y;
      drag.moved += Math.abs(dy);
      if (drag.moved < DRAG_SLOP) return;
      this.dragged = true;
      this.scrollTo(this.scrollY - dy);
    });
    const end = () => (this.drag = null);
    this.on('pointerup', end);
    this.on('pointerupoutside', end);
    this.on('wheel', (event: FederatedWheelEvent) => this.scrollTo(this.scrollY + event.deltaY));
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(): void {
    this.visible = true;
    this.scrollY = 0;
    this.arrange();
  }

  close(): void {
    this.visible = false;
    this.drag = null;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    if (this.visible) this.arrange();
  }

  /** Lay the body out `width` wide, from y = 0, and say how tall it came to. */
  protected abstract layoutBody(width: number): number;

  /** Room under the title for something that does not scroll: tabs, say. */
  protected headerExtra(): number {
    return 0;
  }

  protected layoutHeaderExtra(_x: number, _y: number, _width: number): void {}

  /** Room under the body for something that does not scroll: a button, say. */
  protected footer(): number {
    return 0;
  }

  protected layoutFooter(_x: number, _y: number, _width: number): void {}

  /** For a tap on anything in the body: false when the press was a scroll. */
  protected tapOk(): boolean {
    return !this.dragged;
  }

  /** A button in the body, whose tap does not fire at the end of a scroll. */
  protected button(caption: string, onTap: () => void, fontSize = 13): PanelButton {
    return new PanelButton(
      caption,
      () => {
        if (this.tapOk()) onTap();
      },
      fontSize,
    );
  }

  /** Lay the whole sheet out again, keeping the scroll where it is if it can. */
  protected arrange(): void {
    const screen = this.layout.screen;
    const pad = 16;
    const panelW = Math.min(screen.width - 16, 480);
    const panelH = screen.height - 16;
    const px = Math.round((screen.width - panelW) / 2);
    const py = 8;
    const innerW = panelW - pad * 2;

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.7 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.box.clear();
    this.box
      .roundRect(px, py, panelW, panelH, 12)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1, color: UI.panelEdge });
    this.box.hitArea = new Rectangle(px, py, panelW, panelH);

    this.titleText.position.set(px + pad, py + 14);
    this.closeX.place(px + panelW - pad - 34, py + 10, 34, 34);
    this.subtitle.style.wordWrapWidth = innerW - 44;
    this.subtitle.position.set(px + pad, py + 42);
    const subtitleH = this.subtitle.text ? this.subtitle.height + 10 : 0;
    let top = py + 42 + subtitleH;
    const extra = this.headerExtra();
    if (extra > 0) {
      this.layoutHeaderExtra(px + pad, top, innerW);
      top += extra + 8;
    }

    const footer = this.footer();
    const bottom = py + panelH - pad - (footer > 0 ? footer + 10 : 0);
    if (footer > 0) this.layoutFooter(px + pad, bottom + 10, innerW);

    this.view = { x: px + pad, y: top, width: innerW, height: Math.max(40, bottom - top) };
    this.bodyMask.clear();
    this.bodyMask
      .rect(this.view.x, this.view.y, this.view.width, this.view.height)
      .fill({ color: 0xffffff });
    // Short of the scrollbar's width, so nothing sits under it.
    this.bodyHeight = this.layoutBody(innerW - 6);
    this.scrollTo(this.scrollY);
  }

  private scrollTo(y: number): void {
    const room = Math.max(0, this.bodyHeight - this.view.height);
    this.scrollY = Math.max(0, Math.min(room, y));
    this.body.position.set(this.view.x, this.view.y - this.scrollY);

    this.scrollbar.clear();
    if (room <= 0) return;
    const track = this.view.height;
    const thumb = Math.max(24, (track * this.view.height) / this.bodyHeight);
    const at = this.view.y + ((track - thumb) * this.scrollY) / room;
    this.scrollbar
      .roundRect(this.view.x + this.view.width - 3, at, 3, thumb, 1.5)
      .fill({ color: UI.textMuted, alpha: 0.6 });
  }

  private inView(event: FederatedPointerEvent): boolean {
    const { x, y } = event.global;
    const v = this.view;
    return x >= v.x && x <= v.x + v.width && y >= v.y && y <= v.y + v.height;
  }
}

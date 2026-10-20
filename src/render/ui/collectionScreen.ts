/**
 * Your Collection: every cosmetic, by slot, and a switch for each one you have.
 *
 * SCAFFOLDING for the cosmetics to come (progression/cosmetics.ts). The rule
 * is the one the player was promised: once a cosmetic is unlocked it can be
 * switched on or off, and a slot that holds one at a time - a title, a
 * fortress - switches the others off as one goes on. Locked ones are shown
 * too, dimmed, with how they are earned or bought, because a collection is
 * also a list of things to work towards.
 *
 * Titles and badges are drawn today, with your name (ui/nameCard.ts). The
 * other slots are marked "coming soon": their switches work and are
 * remembered, so what a player chooses now is what they will see the day the
 * game learns to draw it.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { Cosmetic, CosmeticSlot } from '../../progression/config.ts';
import { howToUnlock } from '../../progression/cosmetics.ts';
import type { ProgressStore } from '../../progression/store.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import type { PanelButton } from './menu.ts';
import { Sheet } from './sheet.ts';
import { drawCosmeticIcon, drawPadlock } from './storeArt.ts';
import { fit, label } from './text.ts';

export interface CollectionHandlers {
  onClose(): void;
  /** The store, for something that has to be bought. */
  onStore(): void;
  /** A switch was flipped: the name card and anything else wearing it redraws. */
  onChanged(): void;
}

const ROW_H = 48;

class Row extends Container {
  readonly bg = new Graphics();
  readonly icon = new Graphics();
  readonly pill = new Graphics();
  readonly title: Text;
  readonly how: Text;
  readonly words: Text;

  constructor(
    readonly cosmetic: Cosmetic,
    onTap: () => void,
  ) {
    super();
    this.title = label(cosmetic.name, 13, UI.text, '700');
    this.how = label('', 10, UI.textMuted, '600');
    // A title's picture is its own words.
    this.words = label(cosmetic.slot === 'title' ? 'Aa' : '', 13, UI.level, '700');
    this.addChild(this.bg, this.icon, this.words, this.title, this.how, this.pill);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }
}

export class CollectionScreen extends Sheet {
  private readonly heads: { slot: CosmeticSlot; name: Text; blurb: Text; soon: Text }[];
  private readonly rows: Row[];
  private readonly storeButton: PanelButton;

  constructor(
    layout: LaneLayout,
    private readonly progress: ProgressStore,
    private readonly handlers: CollectionHandlers,
  ) {
    super(
      layout,
      'Collection',
      'Everything you can wear. Switch on what you have unlocked; the rest says how to get it.',
      () => handlers.onClose(),
    );
    this.heads = progress.cosmetics.slots.map((slot) => ({
      slot,
      name: label(slot.name, 13, UI.text, '700'),
      blurb: label(slot.blurb, 10, UI.textMuted, '500'),
      soon: label('Coming soon', 10, UI.xp, '700'),
    }));
    this.rows = progress.cosmetics.cosmetics.map(
      (cosmetic) => new Row(cosmetic, () => this.tapRow(cosmetic)),
    );
    this.storeButton = this.button('Open the store', () => this.handlers.onStore());
    this.body.addChild(
      ...this.heads.flatMap((h) => [h.name, h.blurb, h.soon]),
      ...this.rows,
      this.storeButton,
    );
  }

  refresh(): void {
    if (this.visible) this.arrange();
  }

  /** Flip an unlocked one; a locked one with a price goes to the store. */
  private tapRow(cosmetic: Cosmetic): void {
    if (!this.tapOk()) return;
    if (this.progress.isUnlocked(cosmetic)) {
      this.progress.setCosmetic(cosmetic.id, !this.progress.isOn(cosmetic));
      this.handlers.onChanged();
      this.arrange();
      return;
    }
    if (cosmetic.price !== null) this.handlers.onStore();
  }

  protected layoutBody(width: number): number {
    const level = this.progress.level.level;
    let y = 0;
    for (const head of this.heads) {
      head.name.position.set(0, y);
      head.soon.visible = !head.slot.live;
      head.soon.position.set(head.name.width + 8, y + 2);
      head.blurb.position.set(0, y + 18);
      y += 38;
      for (const row of this.rows) {
        if (row.cosmetic.slot !== head.slot.id) continue;
        this.placeRow(row, y, width, level);
        y += ROW_H + 6;
      }
      y += 10;
    }
    this.storeButton.place(0, y, width, 36);
    this.storeButton.set('More in the store', 'plain');
    return y + 36;
  }

  private placeRow(row: Row, y: number, width: number, level: number): void {
    const c = row.cosmetic;
    const unlocked = this.progress.isUnlocked(c);
    const on = this.progress.isOn(c);
    row.hitArea = new Rectangle(0, y, width, ROW_H);
    row.bg.clear();
    row.bg
      .roundRect(0, y, width, ROW_H, 10)
      .fill({ color: on ? 0x1e2333 : UI.panel })
      .stroke({ width: 1, color: on ? UI.level : UI.panelEdge });

    row.icon.clear();
    const iconX = 24;
    if (c.slot === 'title') {
      row.words.position.set(iconX - row.words.width / 2, y + (ROW_H - row.words.height) / 2);
    } else {
      drawCosmeticIcon(row.icon, c, iconX, y + ROW_H / 2, 24);
    }

    row.title.text = fit(c.name, width - 140, 13);
    row.title.position.set(48, y + 8);
    // How to get it, with how far off it is when that is a level.
    let how = unlocked ? (on ? 'Wearing' : 'Unlocked') : howToUnlock(c);
    if (!unlocked && c.unlock.level !== null) how += ` (you are level ${level})`;
    row.how.text = fit(how, width - 120, 10);
    row.how.style.fill = unlocked ? (on ? UI.level : UI.healthGood) : UI.textMuted;
    row.how.position.set(48, y + 27);
    row.alpha = unlocked ? 1 : 0.55;

    // The switch, for what can be switched; a padlock for what cannot.
    const pw = 44;
    const ph = 24;
    const px = width - 12 - pw;
    const py = y + (ROW_H - ph) / 2;
    row.pill.clear();
    if (unlocked) {
      row.pill
        .roundRect(px, py, pw, ph, ph / 2)
        .fill({ color: on ? UI.accent : UI.panelEdge })
        .circle(on ? px + pw - ph / 2 : px + ph / 2, py + ph / 2, ph / 2 - 3)
        .fill({ color: UI.text });
    } else {
      drawPadlock(row.pill, px + pw / 2, py + ph / 2 + 3.5, UI.textMuted);
    }
  }
}

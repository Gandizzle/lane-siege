/**
 * Your Collection: everything there is to earn - every builder and every
 * cosmetic - unlocked with keys, and switched on and off.
 *
 * Every level pays a key (progression.json, keys), and this is where they are
 * spent: three on a builder, one or two on a cosmetic. Nothing here is bought
 * with money (store.json) - Supporter is the one purchase, and the only thing
 * it adds here is its own badge. Titles, and the badges that mean something,
 * come with what they mean - a level, Supporter, Founder - and say so. Levels
 * stop where the keys for everything here are paid (store.ts, the top level),
 * and the header says when that is where a player stands.
 *
 * Spending takes two taps: the first says what it will cost, the second, within
 * a few seconds, spends it - as the menu's Leave does - because a key takes a
 * level to earn, and a list being scrolled is a list being tapped by accident.
 *
 * An unlocked cosmetic can be switched on or off, and a slot that holds one at
 * a time - a title, a fortress - switches the others off as one goes on. Slots
 * the game does not draw yet are marked "coming soon", and nothing in them can
 * be unlocked until it does: nobody spends keys on something they cannot see.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { BuilderDef, GameData } from '../../data/schema.ts';
import type { Cosmetic, CosmeticSlot } from '../../progression/config.ts';
import { forSale, howToUnlock, keyCount } from '../../progression/cosmetics.ts';
import type { ProgressStore } from '../../progression/store.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { drawCosmeticIcon, drawKey, drawPadlock, drawRoster } from './collectionArt.ts';
import { PanelButton } from './menu.ts';
import { Sheet } from './sheet.ts';
import { fit, label } from './text.ts';

export interface CollectionHandlers {
  onClose(): void;
  /** A switch flipped, or keys spent: the name card and the home screen redraw. */
  onChanged(): void;
  /** Keys were spent on `name`: said, and heard. */
  onUnlocked(name: string): void;
}

const ROW_H = 48;
/** How long the first tap on something to unlock waits for the second. */
const ARM_MS = 3000;

class Row extends Container {
  readonly bg = new Graphics();
  readonly icon = new Graphics();
  readonly pill = new Graphics();
  readonly title: Text;
  readonly how: Text;
  readonly words: Text;

  constructor(caption: string, isTitle: boolean, onTap: () => void) {
    super();
    this.title = label(caption, 13, UI.text, '700');
    this.how = label('', 10, UI.textMuted, '600');
    // A title's picture is its own words.
    this.words = label(isTitle ? 'Aa' : '', 13, UI.level, '700');
    this.addChild(this.bg, this.icon, this.words, this.title, this.how, this.pill);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }
}

export class CollectionScreen extends Sheet {
  private readonly keysIcon = new Graphics();
  private readonly keysText: Text;
  private readonly keysNext: Text;
  private readonly testLevel: PanelButton;
  private readonly builderHead: { name: Text; blurb: Text };
  private readonly builderRows: { builder: BuilderDef; row: Row }[];
  private readonly heads: { slot: CosmeticSlot; name: Text; blurb: Text; soon: Text }[];
  private readonly rows: { cosmetic: Cosmetic; row: Row }[];
  /** Tapped once to unlock: what, and how long the second tap has left. */
  private armed: { id: string; ms: number } | null = null;

  constructor(
    layout: LaneLayout,
    private readonly data: GameData,
    private readonly progress: ProgressStore,
    private readonly testMode: boolean,
    private readonly handlers: CollectionHandlers,
  ) {
    const keys = progress.config.keys;
    super(
      layout,
      'Collection',
      `Every level pays ${keyCount(keys.perLevel)}. Unlock builders and looks with them, ` +
        'and switch on what you have.',
      () => handlers.onClose(),
    );
    this.keysText = label('', 15, UI.level, '700');
    this.keysNext = label('', 11, UI.textMuted, '600');
    this.testLevel = new PanelButton(
      'Test: +1 level',
      () => {
        this.progress.testLevelUp();
        this.handlers.onChanged();
      },
      11,
    );
    this.addChild(this.keysIcon, this.keysText, this.keysNext, this.testLevel);

    const starter = data.units.builders.find((b) => b.id === keys.starter);
    this.builderHead = {
      name: label('Builders', 13, UI.text, '700'),
      blurb: label(
        `${keyCount(keys.builder)} each.${starter ? ` ${starter.name} is yours from the start.` : ''}`,
        10,
        UI.textMuted,
        '500',
      ),
    };
    this.builderRows = data.units.builders.map((builder) => ({
      builder,
      row: new Row(builder.name, false, () => this.tapBuilder(builder)),
    }));
    this.heads = progress.cosmetics.slots.map((slot) => ({
      slot,
      name: label(slot.name, 13, UI.text, '700'),
      blurb: label(slot.blurb, 10, UI.textMuted, '500'),
      soon: label('Coming soon', 10, UI.xp, '700'),
    }));
    this.rows = progress.cosmetics.cosmetics.map((cosmetic) => ({
      cosmetic,
      row: new Row(cosmetic.name, cosmetic.slot === 'title', () => this.tapCosmetic(cosmetic)),
    }));
    this.body.addChild(
      this.builderHead.name,
      this.builderHead.blurb,
      ...this.builderRows.map((b) => b.row),
      ...this.heads.flatMap((h) => [h.name, h.blurb, h.soon]),
      ...this.rows.map((r) => r.row),
    );
  }

  override open(): void {
    this.armed = null;
    super.open();
  }

  refresh(): void {
    if (this.visible) this.arrange();
  }

  /** The second tap's few seconds running out. */
  update(deltaMs: number): void {
    if (!this.visible || !this.armed) return;
    this.armed.ms -= deltaMs;
    if (this.armed.ms <= 0) {
      this.armed = null;
      this.arrange();
    }
  }

  /**
   * The first tap on something keys can unlock says what it costs; the
   * second spends them. True when this tap spent them.
   */
  private confirm(id: string): boolean {
    if (this.armed?.id === id) {
      this.armed = null;
      return true;
    }
    this.armed = { id, ms: ARM_MS };
    this.arrange();
    return false;
  }

  private tapBuilder(builder: BuilderDef): void {
    if (!this.tapOk() || this.progress.ownsBuilder(builder.id)) return;
    if (this.progress.keys.left < this.progress.builderCost(builder.id)) return;
    if (!this.confirm(builder.id)) return;
    if (this.progress.unlockBuilder(builder.id)) this.unlocked(builder.name);
  }

  /** Flip an unlocked one; one keys can unlock, unlock on the second tap. */
  private tapCosmetic(cosmetic: Cosmetic): void {
    if (!this.tapOk()) return;
    if (this.progress.isUnlocked(cosmetic)) {
      this.armed = null;
      this.progress.setCosmetic(cosmetic.id, !this.progress.isOn(cosmetic));
      this.handlers.onChanged();
      this.arrange();
      return;
    }
    if (!this.affordable(cosmetic) || !this.confirm(cosmetic.id)) return;
    if (this.progress.unlockCosmetic(cosmetic.id)) this.unlocked(cosmetic.name);
  }

  private unlocked(name: string): void {
    this.handlers.onUnlocked(name);
    this.handlers.onChanged();
    this.arrange();
  }

  /** Locked, for keys, in a slot that is drawn, and the keys are there. */
  private affordable(cosmetic: Cosmetic): boolean {
    return (
      !this.progress.isUnlocked(cosmetic) &&
      forSale(this.progress.cosmetics, cosmetic) &&
      this.progress.keys.left >= (cosmetic.unlock.keys ?? 0)
    );
  }

  // ---------------------------------------------------------------- layout

  protected override headerExtra(): number {
    return 28;
  }

  /** The keys there are to spend, and when the next come: always in sight. */
  protected override layoutHeaderExtra(x: number, y: number, width: number): void {
    const keys = this.progress.keys;
    this.keysIcon.clear();
    drawKey(this.keysIcon, x + 11, y + 12, 22, UI.level);
    this.keysText.text = keyCount(keys.left);
    this.keysText.position.set(x + 28, y + 3);
    const nextX = x + 28 + this.keysText.width + 6;
    // Short of the test button, in the build that has one.
    const room = (this.testMode ? width - 128 : width) - (nextX - x);
    this.keysNext.text =
      keys.nextAt === null ? '· top level for now' : `· next at level ${keys.nextAt}`;
    if (keys.nextAt === null && this.keysNext.width > room) this.keysNext.text = '· top level';
    this.keysNext.position.set(nextX, y + 6);
    this.testLevel.visible = this.testMode;
    if (this.testMode) {
      this.testLevel.place(x + width - 120, y - 2, 120, 28);
      this.testLevel.set('Test: +1 level', 'plain', keys.nextAt !== null);
    }
  }

  protected layoutBody(width: number): number {
    const level = this.progress.level.level;
    let y = 0;
    this.builderHead.name.position.set(0, y);
    this.builderHead.blurb.position.set(0, y + 18);
    y += 38;
    for (const { builder, row } of this.builderRows) {
      this.placeBuilder(builder, row, y, width);
      y += ROW_H + 6;
    }
    y += 10;

    for (const head of this.heads) {
      head.name.position.set(0, y);
      head.soon.visible = !head.slot.live;
      head.soon.position.set(head.name.width + 8, y + 2);
      head.blurb.position.set(0, y + 18);
      y += 38;
      for (const { cosmetic, row } of this.rows) {
        if (cosmetic.slot !== head.slot.id) continue;
        this.placeCosmetic(cosmetic, row, y, width, level);
        y += ROW_H + 6;
      }
      y += 10;
    }
    return y - 10;
  }

  private placeBuilder(builder: BuilderDef, row: Row, y: number, width: number): void {
    const owned = this.progress.ownsBuilder(builder.id);
    const cost = this.progress.builderCost(builder.id);
    const left = this.progress.keys.left;
    this.drawRow(row, y, width, false);
    row.icon.clear();
    // Its six units, small, in the right half: the builder by its own look.
    const rosterX = Math.max(160, width * 0.54);
    drawRoster(row.icon, this.data, builder.id, rosterX, y + ROW_H / 2, width - 52 - rosterX);
    row.title.text = fit(builder.name, rosterX - 24, 13);
    row.title.position.set(12, y + 8);
    let how: string;
    let color: number = UI.textMuted;
    if (owned) {
      how = cost === 0 ? 'Yours from the start' : 'Unlocked';
      color = UI.healthGood;
    } else if (this.armed?.id === builder.id) {
      how = `Tap again to spend ${keyCount(cost)}`;
      color = UI.level;
    } else if (left >= cost) {
      how = `${keyCount(cost)} · tap to unlock`;
      color = UI.level;
    } else {
      how = `${keyCount(cost)} · you have ${left}`;
    }
    this.placeHow(row, how, color, 12, y, rosterX - 16);
    row.alpha = owned || left >= cost ? 1 : 0.55;
    this.drawEnd(row, y, width, owned ? 'tick' : 'lock', this.armed?.id === builder.id);
  }

  private placeCosmetic(
    cosmetic: Cosmetic,
    row: Row,
    y: number,
    width: number,
    level: number,
  ): void {
    const unlocked = this.progress.isUnlocked(cosmetic);
    const on = this.progress.isOn(cosmetic);
    const armed = this.armed?.id === cosmetic.id;
    this.drawRow(row, y, width, on);

    row.icon.clear();
    const iconX = 24;
    if (cosmetic.slot === 'title') {
      row.words.position.set(iconX - row.words.width / 2, y + (ROW_H - row.words.height) / 2);
    } else {
      drawCosmeticIcon(row.icon, cosmetic, iconX, y + ROW_H / 2, 24);
    }
    row.title.text = fit(cosmetic.name, width - 140, 13);
    row.title.position.set(48, y + 8);

    // How to get it - what it costs in keys, or what it comes with, and how
    // far off a level is.
    const cost = cosmetic.unlock.keys;
    const left = this.progress.keys.left;
    let how: string;
    let color: number = UI.textMuted;
    if (unlocked) {
      how = on ? 'Wearing' : 'Unlocked';
      color = on ? UI.level : UI.healthGood;
    } else if (cost !== null && !forSale(this.progress.cosmetics, cosmetic)) {
      how = `${keyCount(cost)} when it arrives`;
    } else if (armed && cost !== null) {
      how = `Tap again to spend ${keyCount(cost)}`;
      color = UI.level;
    } else if (cost !== null && left >= cost) {
      how = `${keyCount(cost)} · tap to unlock`;
      color = UI.level;
    } else if (cost !== null) {
      how = `${keyCount(cost)} · you have ${left}`;
    } else {
      const need = cosmetic.unlock.level;
      const top = this.progress.topLevel;
      // A level past the top waits for what raises it, and says so - short
      // enough for a small phone's row.
      if (need !== null && need > top) {
        how = `Level ${need} · top is ${top} for now`;
        if (fit(how, width - 120, 10) !== how) how = `Level ${need} · top is ${top}`;
      } else {
        how = howToUnlock(cosmetic);
        if (need !== null) how += ` (you are level ${level})`;
      }
    }
    this.placeHow(row, how, color, 48, y, width - 120);
    row.alpha = unlocked || this.affordable(cosmetic) ? 1 : 0.55;

    if (unlocked) this.drawSwitch(row, y, width, on);
    else this.drawEnd(row, y, width, 'lock', armed);
  }

  private drawRow(row: Row, y: number, width: number, on: boolean): void {
    row.hitArea = new Rectangle(0, y, width, ROW_H);
    row.bg.clear();
    row.bg
      .roundRect(0, y, width, ROW_H, 10)
      .fill({ color: on ? 0x1e2333 : UI.panel })
      .stroke({ width: 1, color: on ? UI.level : UI.panelEdge });
  }

  private placeHow(row: Row, how: string, color: number, x: number, y: number, room: number) {
    row.how.text = fit(how, room, 10);
    row.how.style.fill = color;
    row.how.position.set(x, y + 27);
  }

  /** On the right: a switch for what can be switched. */
  private drawSwitch(row: Row, y: number, width: number, on: boolean): void {
    const pw = 44;
    const ph = 24;
    const px = width - 12 - pw;
    const py = y + (ROW_H - ph) / 2;
    row.pill.clear();
    row.pill
      .roundRect(px, py, pw, ph, ph / 2)
      .fill({ color: on ? UI.accent : UI.panelEdge })
      .circle(on ? px + pw - ph / 2 : px + ph / 2, py + ph / 2, ph / 2 - 3)
      .fill({ color: UI.text });
  }

  /** On the right: a tick for a builder that is yours, a padlock - gold once tapped - for the rest. */
  private drawEnd(row: Row, y: number, width: number, end: 'tick' | 'lock', armed: boolean): void {
    const cx = width - 12 - 22;
    const cy = y + ROW_H / 2;
    row.pill.clear();
    if (end === 'tick') {
      row.pill
        .moveTo(cx - 7, cy)
        .lineTo(cx - 2, cy + 5)
        .lineTo(cx + 7, cy - 5)
        .stroke({ width: 2.5, color: UI.healthGood, cap: 'round', join: 'round' });
      return;
    }
    drawPadlock(row.pill, cx, cy + 3.5, armed ? UI.level : UI.textMuted);
  }
}

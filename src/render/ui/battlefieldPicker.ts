/**
 * The battlefield panel: every ground as a live preview, tapped to use.
 *
 * Opened from the menu's Battlefield row and drawn over it, so closing it
 * goes back to the menu. Each card paints its ground the way the board does
 * (battlefield.ts, `GroundView`) with the build grid laid over it and a few
 * real bodies standing on it - two units, solid, and two monsters, outlined -
 * because the question a player is answering is not "is it pretty" but "can I
 * still read the fight on it". Molten moves in its preview as it does on the
 * board.
 *
 * A ground that is not unlocked (none yet: battlefield.ts,
 * `unlockedBattlefields`) is still shown, dimmed and marked, but cannot be
 * picked.
 *
 * Built once, like the menu: every card is made in the constructor and only
 * repainted when the layout changes, so a tap is never lost to a rebuild.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { DamageType, GameData, ShapeId } from '../../data/schema.ts';
import {
  BATTLEFIELD_IDS,
  battlefieldInUse,
  battlefieldName,
  battlefieldNote,
  gridAlpha,
  GroundView,
  unlockedBattlefields,
  type BattlefieldId,
} from '../battlefield.ts';
import type { LaneLayout, Rect } from '../layout.ts';
import { UI } from '../palette.ts';
import type { PreferenceStore } from '../preferences.ts';
import { drawEntity } from '../shapes.ts';
import { PanelButton } from './menu.ts';
import { fit, label, wrapped } from './text.ts';

/** A preview's height, as a share of its width. */
const PREVIEW_ASPECT = 0.62;
/** The name and note under a preview. */
const CAPTION_H = 38;
const GAP = 10;

export interface CardGrid {
  columns: number;
  cardW: number;
  previewH: number;
}

/**
 * How to lay `count` cards out in `width` by `height`: the fewest columns
 * whose rows fit, which is the largest previews. If even one row is too tall,
 * every card in one row with the previews cut down to fit.
 */
export function cardGrid(count: number, width: number, height: number): CardGrid {
  for (let columns = 1; columns <= count; columns++) {
    const cardW = (width - GAP * (columns - 1)) / columns;
    const previewH = cardW * PREVIEW_ASPECT;
    const rows = Math.ceil(count / columns);
    if (rows * (previewH + CAPTION_H) + (rows - 1) * GAP <= height) {
      return { columns, cardW, previewH };
    }
  }
  const cardW = (width - GAP * (count - 1)) / count;
  return {
    columns: count,
    cardW,
    previewH: Math.max(24, Math.min(cardW * PREVIEW_ASPECT, height - CAPTION_H)),
  };
}

interface Body {
  shape: ShapeId;
  damageType: DamageType;
  outlined: boolean;
  /**
   * Where it stands, in tiles: a monster from the preview's top-left, a unit
   * as the column and row of the grid cell it is placed in.
   */
  at: [number, number];
}

class Card extends Container {
  readonly ground = new GroundView();
  private readonly base = new Graphics();
  private readonly overlay = new Graphics();
  private readonly frame = new Graphics();
  private readonly title: Text;
  private readonly note: Text;
  private readonly tag: Text;
  private w = 0;
  private previewH = 0;
  private chosen: boolean | null = null;

  constructor(
    readonly id: BattlefieldId,
    private readonly bodies: readonly Body[],
    onTap: () => void,
  ) {
    super();
    this.title = label(battlefieldName(id), 13, UI.text, '700');
    this.note = label(battlefieldNote(id), 10, UI.textMuted, '600');
    this.tag = label('', 10, UI.accent, '700');
    this.addChild(
      this.base,
      this.ground,
      this.overlay,
      this.frame,
      this.title,
      this.note,
      this.tag,
    );
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  place(x: number, y: number, width: number, previewH: number): void {
    this.position.set(x, y);
    this.w = width;
    this.previewH = previewH;
    this.hitArea = new Rectangle(0, 0, width, previewH + CAPTION_H);

    // The plain ground is the flat build-zone color; a painted one covers it.
    this.base.clear();
    this.base.rect(0, 0, width, previewH).fill({ color: UI.buildZone });

    // Five tiles across, as a slice of the lane: monsters coming in at the
    // top, the build grid below them with two units placed on it.
    const tile = width / 5;
    this.ground.paint(this.id, [{ x: 0, y: 0, width, height: previewH }], tile);

    const g = this.overlay;
    g.clear();
    const gridTop = Math.min(previewH, Math.round(previewH * 0.42));
    for (let gx = tile; gx < width - 1; gx += tile) g.moveTo(gx, gridTop).lineTo(gx, previewH);
    for (let gy = gridTop; gy <= previewH - 1; gy += tile) g.moveTo(0, gy).lineTo(width, gy);
    g.stroke({ width: 1, color: UI.outline, alpha: gridAlpha(this.id) });
    const radius = tile * 0.32;
    for (const body of this.bodies) {
      const [x, y] = body.at;
      drawEntity(
        g,
        { shape: body.shape, damageType: body.damageType, mark: 1, outlined: body.outlined },
        body.outlined ? x * tile : (x + 0.5) * tile,
        body.outlined ? y * tile : gridTop + (y + 0.5) * tile,
        radius,
      );
    }

    this.title.position.set(2, previewH + 4);
    this.note.text = fit(battlefieldNote(this.id), width - 4, 10);
    this.note.position.set(2, previewH + 22);
    const was = this.chosen;
    this.chosen = null;
    this.show(was ?? false, unlockedBattlefields().includes(this.id));
  }

  /** Whether it is the ground in use, and whether it may be picked. */
  show(chosen: boolean, unlocked: boolean): void {
    if (chosen === this.chosen) return;
    this.chosen = chosen;
    this.frame.clear();
    this.frame
      .rect(0, 0, this.w, this.previewH)
      .stroke({ width: chosen ? 3 : 1, color: chosen ? UI.accent : UI.panelEdge, alignment: 1 });
    this.tag.text = chosen ? 'In use' : unlocked ? '' : 'Locked';
    this.tag.style.fill = chosen ? UI.accent : UI.textMuted;
    this.tag.position.set(this.w - this.tag.width - 2, this.previewH + 5);
    // The name gives way to the tag only when there is one.
    const room = this.w - 4 - (this.tag.text ? this.tag.width + 8 : 0);
    this.title.text = fit(battlefieldName(this.id), room, 13);
    this.alpha = unlocked ? 1 : 0.45;
  }
}

export class BattlefieldPicker extends Container {
  private readonly scrim = new Graphics();
  private readonly box = new Graphics();
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly closeX: PanelButton;
  private readonly done: PanelButton;
  private readonly cards: Card[];
  private layout: LaneLayout;
  /** The previews' own clock, so Molten moves while the match behind is paused. */
  private clock = 0;

  constructor(
    layout: LaneLayout,
    data: GameData,
    private readonly preferences: PreferenceStore,
    private readonly onClose: () => void,
  ) {
    super();
    this.layout = layout;
    this.visible = false;

    this.title = label('Battlefield', 18, UI.text, '700');
    this.subtitle = wrapped(
      'Tap a ground to fight on it. Each shows the build grid and a few bodies, ' +
        'so you can see how the fight reads on it.',
      11,
      UI.textMuted,
    );
    this.closeX = new PanelButton('✕', () => this.onClose());
    this.done = new PanelButton('Done', () => this.onClose());

    const bodies = sampleBodies(data);
    this.cards = BATTLEFIELD_IDS.map((id) => new Card(id, bodies, () => this.choose(id)));

    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.onClose());
    // The box swallows its own taps, so a tap between cards does not close it.
    this.box.eventMode = 'static';
    this.addChild(
      this.scrim,
      this.box,
      this.title,
      this.subtitle,
      this.closeX,
      ...this.cards,
      this.done,
    );
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(): void {
    this.visible = true;
    this.arrange();
  }

  close(): void {
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    if (this.visible) this.arrange();
  }

  /** Keep the chosen card marked and Molten moving. Nothing to do while closed. */
  render(deltaMs: number): void {
    if (!this.visible) return;
    this.clock += deltaMs / 1000;
    const inUse = battlefieldInUse(this.preferences.settings.battlefield);
    const unlocked = unlockedBattlefields();
    for (const card of this.cards) {
      card.show(card.id === inUse, unlocked.includes(card.id));
      card.ground.animate(this.clock);
    }
  }

  private choose(id: BattlefieldId): void {
    if (!unlockedBattlefields().includes(id)) return;
    this.preferences.configure({ battlefield: id });
  }

  private arrange(): void {
    const screen = this.layout.screen;
    const pad = 16;
    const panelW = Math.min(screen.width - 24, 760);
    const innerW = panelW - pad * 2;
    this.subtitle.style.wordWrapWidth = innerW - 44;

    const headerH = 26 + this.subtitle.height + 14;
    const footH = 12 + 36;
    const room = screen.height - 16 - pad * 2 - headerH - footH;
    const grid = cardGrid(this.cards.length, innerW, room);
    const rows = Math.ceil(this.cards.length / grid.columns);
    const cardH = grid.previewH + CAPTION_H;
    const cardsH = rows * cardH + (rows - 1) * GAP;
    const panelH = pad + headerH + cardsH + footH + pad;
    const px = Math.round((screen.width - panelW) / 2);
    const py = Math.round(Math.max(8, (screen.height - panelH) / 2));

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.6 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.box.clear();
    this.box
      .roundRect(px, py, panelW, panelH, 12)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1, color: UI.panelEdge });
    this.box.hitArea = new Rectangle(px, py, panelW, panelH);

    this.title.position.set(px + pad, py + 14);
    this.subtitle.position.set(px + pad, py + 42);
    this.closeX.place(px + panelW - pad - 34, py + 10, 34, 34);

    const top = py + pad + headerH;
    this.cards.forEach((card, i) => {
      const row = Math.floor(i / grid.columns);
      const column = i % grid.columns;
      // A short last row sits in the middle rather than hanging left.
      const inRow = Math.min(grid.columns, this.cards.length - row * grid.columns);
      const rowW = inRow * grid.cardW + (inRow - 1) * GAP;
      const left = px + pad + (innerW - rowW) / 2;
      const at: Rect = {
        x: Math.round(left + column * (grid.cardW + GAP)),
        y: Math.round(top + row * (cardH + GAP)),
        width: Math.floor(grid.cardW),
        height: grid.previewH,
      };
      card.place(at.x, at.y, at.width, Math.floor(at.height));
    });

    this.done.place(px + pad, py + panelH - pad - 36, innerW, 36);
    this.done.set('Done', 'primary');
  }
}

/**
 * Who stands on the previews: two units and two monsters of four different
 * damage types, taken from the game's own data, so the colors a player has
 * to read on the board are the ones tested against each ground.
 */
function sampleBodies(data: GameData): Body[] {
  const used = new Set<DamageType>();
  const take = <T extends { damageType: DamageType }>(list: readonly T[], n: number): T[] => {
    const out: T[] = [];
    for (const item of list) {
      if (out.length === n) break;
      if (used.has(item.damageType)) continue;
      used.add(item.damageType);
      out.push(item);
    }
    return out;
  };
  const units = take(
    data.units.units.filter((u) => u.mark === 1),
    2,
  );
  const monsters = take(data.monsters.monsters, 2);
  const unitSpots: [number, number][] = [
    [1, 0],
    [3, 0],
  ];
  const monsterSpots: [number, number][] = [
    [2.1, 0.55],
    [3.7, 0.8],
  ];
  return [
    ...monsters.map((m, i) => ({
      shape: m.shape,
      damageType: m.damageType,
      outlined: true,
      at: monsterSpots[i]!,
    })),
    ...units.map((u, i) => ({
      shape: u.shape,
      damageType: u.damageType,
      outlined: false,
      at: unitSpots[i]!,
    })),
  ];
}

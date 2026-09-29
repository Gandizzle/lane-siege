/**
 * The damage chart: every damage type against every armour, as the multiplier
 * the simulation applies (DESIGN.md §6, `damageMultiplier`).
 *
 * The matrix is the one rule the whole game turns on and the one a player
 * cannot see: a wave of plate shrugs off blast, a swarm melts under arcane, and
 * nothing on the board says so until the numbers go wrong. This puts it on one
 * card, opened from the menu and from the tutorial's Counters chapter.
 *
 * Read from `data.matrix` and nothing else, so a balance change to the matrix
 * is a change to the chart. The rows and columns are the matrix's own lists; a
 * fifth armour would get a fifth column, and would fail to compile until it
 * had a word below its shape (`LOOKS`).
 *
 * The columns are drawn with a real monster's silhouette, because the shape is
 * how a player tells armour on the board (shapes.ts: round is flesh, angular is
 * plate, pointed is ward, clusters are swarm).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { ArmourType, DamageType, GameData, ShapeId } from '../../data/schema.ts';
import { damageMultiplier } from '../../sim/index.ts';
import type { LaneLayout } from '../layout.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { silhouette } from '../shapes.ts';
import { PanelButton } from './menu.ts';
import { centreOn, label, wrapped } from './text.ts';

/** How each armour's family of shapes reads on the board (shapes.ts). */
const LOOKS: Record<ArmourType, string> = {
  flesh: 'round',
  plate: 'angular',
  swarm: 'clusters',
  ward: 'pointed',
};

/** The word under a multiplier: what it means for the damage. */
export function verdict(multiplier: number): 'strong' | 'weak' | '' {
  return multiplier > 1 ? 'strong' : multiplier < 1 ? 'weak' : '';
}

/** "×1.5", "×0.6", "×1". */
export function formatMultiplier(multiplier: number): string {
  return `×${Number(multiplier.toFixed(2))}`;
}

interface Cell {
  damageType: DamageType;
  armour: ArmourType;
  multiplier: number;
  background: Graphics;
  value: Text;
  word: Text;
}

export class DamageChart extends Container {
  private readonly scrim = new Graphics();
  private readonly box = new Graphics();
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly closeX: PanelButton;
  private readonly doneButton: PanelButton;
  private readonly footnote: Text;
  private readonly shapes = new Graphics();
  private readonly columnHeads: { armour: ArmourType; shape: ShapeId; name: Text; looks: Text }[];
  private readonly rowHeads: { damageType: DamageType; swatch: Graphics; name: Text }[];
  private readonly cells: Cell[] = [];
  private layout: LaneLayout;

  constructor(
    layout: LaneLayout,
    data: GameData,
    private readonly onClose: () => void,
  ) {
    super();
    this.layout = layout;
    this.visible = false;

    const { damageTypes, armourTypes, multipliers } = data.matrix;
    // Said only while the matrix makes it true.
    const oneEachWay = damageTypes.every((type) => {
      const row = armourTypes.map((armour) => damageMultiplier(multipliers, type, armour));
      return row.filter((m) => m > 1).length === 1 && row.filter((m) => m < 1).length === 1;
    });
    this.title = label('Damage vs armour', 18, UI.text, '700');
    this.subtitle = wrapped(
      'Colour is damage type, shape is armour.' +
        (oneEachWay
          ? ' Every damage type is strong against one armour and weak against another.'
          : ' Green lands harder, orange lands softer.'),
      11,
      UI.textMuted,
    );
    this.footnote = wrapped(
      'It works both ways: a monster hits your units by the same chart, so armour matters ' +
        'for your line too.',
      11,
      UI.textMuted,
    );
    this.closeX = new PanelButton('✕', () => this.onClose());
    this.doneButton = new PanelButton('Close', () => this.onClose());

    this.columnHeads = armourTypes.map((armour) => ({
      armour,
      // The first monster in that armour: a shape the player will actually meet.
      shape:
        data.monsters.monsters.find((m) => m.armour === armour)?.shape ??
        data.monsters.monsters[0]!.shape,
      name: label(armour, 12, UI.text, '700'),
      looks: label(LOOKS[armour], 9, UI.textMuted, '600'),
    }));
    this.rowHeads = damageTypes.map((damageType) => ({
      damageType,
      swatch: new Graphics(),
      name: label(damageType, 13, DAMAGE_COLOURS[damageType], '700'),
    }));
    for (const damageType of damageTypes) {
      for (const armour of armourTypes) {
        const multiplier = damageMultiplier(multipliers, damageType, armour);
        const word = verdict(multiplier);
        const colour = word === 'strong' ? UI.healthGood : word === 'weak' ? UI.danger : UI.text;
        this.cells.push({
          damageType,
          armour,
          multiplier,
          background: new Graphics(),
          value: label(formatMultiplier(multiplier), 14, colour, '700'),
          word: label(word, 9, colour, '600'),
        });
      }
    }

    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.onClose());
    // The box swallows its own taps, so reading it does not close it.
    this.box.eventMode = 'static';

    this.addChild(
      this.scrim,
      this.box,
      this.title,
      this.subtitle,
      this.closeX,
      this.shapes,
      ...this.columnHeads.flatMap((c) => [c.name, c.looks]),
      ...this.rowHeads.flatMap((r) => [r.swatch, r.name]),
      ...this.cells.flatMap((c) => [c.background, c.value, c.word]),
      this.footnote,
      this.doneButton,
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

  private arrange(): void {
    const screen = this.layout.screen;
    const short = this.layout.compact || this.layout.orientation === 'landscape';
    const pad = 16;
    const panelW = Math.min(screen.width - 24, 480);
    const innerW = panelW - pad * 2;

    this.subtitle.style.wordWrapWidth = innerW - 40;
    this.footnote.style.wordWrapWidth = innerW;

    const headerH = 36 + this.subtitle.height + 10;
    const columnHeadH = short ? 46 : 60;
    const footH = this.footnote.height + 10 + 36;
    // Rows give up height before the panel gives up the screen: the whole
    // chart has to fit on the shortest phone turned sideways.
    const rows = this.rowHeads.length;
    const room = screen.height - 16 - pad * 2 - headerH - columnHeadH - footH;
    const rowH = Math.max(26, Math.min(42, Math.floor(room / rows) - 4));
    const gridH = columnHeadH + rows * (rowH + 4);
    const panelH = Math.min(screen.height - 16, pad + headerH + gridH + footH + pad);
    const px = Math.round((screen.width - panelW) / 2);
    const py = Math.round(Math.max(8, (screen.height - panelH) / 2));

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.78 });
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

    // The grid: damage types down the side, armour across the top.
    const headW = Math.min(90, innerW * 0.24);
    const columns = this.columnHeads.length;
    const cellGap = 4;
    const cellW = (innerW - headW - cellGap * (columns - 1)) / columns;
    const gridTop = py + pad + headerH;
    const left = px + pad;

    this.shapes.clear();
    const glyph = short ? 9 : 11;
    this.columnHeads.forEach((head, column) => {
      const cx = left + headW + column * (cellW + cellGap) + cellW / 2;
      const cy = gridTop + glyph + 2;
      // Outlined, like a monster on the board: a shape, not a colour.
      for (const piece of silhouette(head.shape)) {
        if (piece.kind === 'circle') {
          this.shapes.circle(cx + piece.x * glyph, cy + piece.y * glyph, piece.r * glyph);
        } else {
          this.shapes.poly(piece.points.map((v, i) => (i % 2 === 0 ? cx : cy) + v * glyph));
        }
      }
      this.shapes.stroke({ width: 1.5, color: UI.text });
      centreOn(head.name, cx, cy + glyph + 4);
      centreOn(head.looks, cx, cy + glyph + 19);
    });

    const rowsTop = gridTop + columnHeadH;
    this.rowHeads.forEach((head, row) => {
      const y = rowsTop + row * (rowH + 4);
      head.swatch.clear();
      head.swatch
        .circle(left + 7, y + rowH / 2, 6)
        .fill({ color: DAMAGE_COLOURS[head.damageType] });
      head.name.position.set(left + 19, y + rowH / 2 - 9);
    });

    for (const cell of this.cells) {
      const row = this.rowHeads.findIndex((r) => r.damageType === cell.damageType);
      const column = this.columnHeads.findIndex((c) => c.armour === cell.armour);
      const x = left + headW + column * (cellW + cellGap);
      const y = rowsTop + row * (rowH + 4);
      const word = verdict(cell.multiplier);
      const tint = word === 'strong' ? UI.healthGood : word === 'weak' ? UI.danger : UI.panelEdge;
      cell.background.clear();
      cell.background
        .roundRect(x, y, cellW, rowH, 6)
        .fill({ color: tint, alpha: word === '' ? 0.5 : 0.18 });
      const cx = x + cellW / 2;
      if (word === '') {
        centreOn(cell.value, cx, y + rowH / 2 - 9);
      } else {
        const top = y + Math.max(0, (rowH - 30) / 2);
        centreOn(cell.value, cx, top);
        centreOn(cell.word, cx, top + 17);
      }
    }

    const footTop = rowsTop + this.rowHeads.length * (rowH + 4) + 4;
    this.footnote.position.set(left, footTop);
    this.doneButton.place(left, py + panelH - pad - 36, innerW, 36);
    // After `place`: a caption is fitted to the button's width, and before it
    // has one there is room for three letters.
    this.doneButton.set('Close', 'primary');
  }
}

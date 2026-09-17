/**
 * The damage panel. DESIGN.md §14.1, added.
 *
 * What each unit landed in the round, ranked. The question it answers is the
 * one a player cannot answer by watching: a fight at 20Hz with thirty bodies
 * in it shows you who was busy, not who was useful, and the difference between
 * those two is most of what an upgrade buys.
 *
 * WHY IT IS A TAB AND NOT A PANEL ON THE SIDE
 *
 * §14.1 fixes the camera and gives the whole width to the lane, so there is no
 * side to put it on that is not taken. The build bar is already the place the
 * screen keeps things you look at rather than things you watch, it is already
 * tabbed, and it is already idle during combat - the phase when these numbers
 * are moving. A tab costs the lane nothing and puts the panel a thumb's reach
 * from where the hand already is.
 *
 * WHAT IT SHOWS AND WHEN IT CLEARS
 *
 * The simulation clears the numbers when a wave SPAWNS rather than when the
 * build phase opens (`damageDealt` in sim/types.ts), so the fight that just
 * finished stays on screen for the whole of the build phase that follows it -
 * which is the only moment a player has both the time to read it and a
 * decision to spend it on.
 *
 * Rows include units that died: they earned their numbers before they went
 * down, and a panel that dropped them would flatter the survivors. A dead
 * unit's row is dimmed while it is down, which during a wave doubles as the
 * quickest read of where the line has broken.
 *
 * Interactive objects are built ONCE here, as everywhere in this folder - see
 * the note at the top of buildBar.ts for what happens otherwise.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import type { LaneView, Phase } from '../../sim/index.ts';
import type { Rect } from '../layout.ts';
import { DAMAGE_COLOURS, UI } from '../palette.ts';
import { drawEntity } from '../shapes.ts';
import {
  damageTable,
  fitRows,
  formatDamage,
  MAX_DAMAGE_ROWS,
  type DamageRow,
} from './damageRows.ts';
import { label } from './text.ts';

const HEADER_HEIGHT = 17;

class DamageRowView extends Container {
  private readonly bar = new Graphics();
  private readonly icon = new Graphics();
  private readonly caption: Text;
  private readonly value: Text;
  private w = 0;
  private h = 0;
  /** Which unit this row currently stands for, for the tap handler. */
  unitId = -1;

  constructor(onTap: (unitId: number) => void) {
    super();
    this.caption = label('', 10, UI.text, '600');
    this.value = label('', 11, UI.text, '700');
    this.addChild(this.bar, this.icon, this.caption, this.value);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => {
      if (this.unitId >= 0) onTap(this.unitId);
    });
  }

  layout(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
  }

  update(row: DamageRow, selected: boolean, alive: boolean): void {
    this.unitId = row.unitId;
    const colour = DAMAGE_COLOURS[row.def.damageType];

    // Ground, then the share bar over it, then the ring. The bar is the panel
    // doing the comparison for you: the numbers say how much and the bar says
    // how much of that is this one, without anybody having to divide.
    this.bar.clear();
    this.bar.roundRect(0, 0, this.w, this.h, 5).fill({ color: UI.panel });
    if (row.share > 0) {
      const width = Math.max(4, this.w * row.share);
      this.bar.roundRect(0, 0, width, this.h, 5).fill({ color: colour, alpha: 0.22 });
    }
    if (selected) {
      this.bar.roundRect(0, 0, this.w, this.h, 5).stroke({ width: 2, color: UI.selected });
    }

    // The same body §14.2 draws on the board, pips and all, so a row is read
    // by the same glance that reads the lane.
    const radius = Math.min(8, this.h * 0.3);
    this.icon.clear();
    drawEntity(
      this.icon,
      { shape: row.def.shape, damageType: row.def.damageType, tier: row.def.tier, outlined: false },
      12 + radius,
      this.h / 2 - radius * 0.35,
      radius,
    );

    if (this.caption.text !== row.def.name) this.caption.text = row.def.name;
    this.caption.position.set(16 + radius * 2, this.h / 2 - 7);

    const text = formatDamage(row.damage);
    if (this.value.text !== text) this.value.text = text;
    this.value.position.set(this.w - 8 - this.value.width, this.h / 2 - 8);

    // Dimmed while it is down. Its numbers stand; the unit does not.
    this.alpha = alive ? 1 : 0.45;
  }
}

export class DamagePanel extends Container {
  private readonly heading: Text;
  private readonly total: Text;
  private readonly empty: Text;
  private readonly rows: DamageRowView[] = [];
  /** How many of the rows the current screen has room for. */
  private shown = MAX_DAMAGE_ROWS;
  /** Right edge of the row block, which the total right-aligns against. */
  private rowsRight = 0;

  constructor(
    private readonly data: GameData,
    onSelectUnit: (unitId: number) => void,
  ) {
    super();
    this.heading = label('', 10, UI.textMuted, '700');
    this.total = label('', 10, UI.text, '700');
    this.empty = label('', 10, UI.textMuted);
    this.addChild(this.heading, this.total, this.empty);

    for (let i = 0; i < MAX_DAMAGE_ROWS; i++) {
      const row = new DamageRowView(onSelectUnit);
      this.rows.push(row);
      this.addChild(row);
    }
  }

  /** Positions everything. `top` and `height` are the bar's panel area. */
  layout(bar: Rect, top: number, height: number): void {
    // Inside the bar: its own left edge, which is zero in portrait and the
    // right-hand column's in landscape.
    const left = bar.x + 6;
    const width = bar.width - 12;
    this.rowsRight = left + width;

    this.heading.position.set(left, top);
    this.total.position.set(left, top);
    this.empty.position.set(left, top + HEADER_HEIGHT + 4);

    const fit = fitRows(width, height - HEADER_HEIGHT);
    this.shown = fit.shown;

    this.rows.forEach((row, i) => {
      // Down the left column, then down the right: a ranked list reads down.
      const column = Math.floor(i / fit.perColumn);
      const index = i % fit.perColumn;
      row.layout(
        left + column * (fit.columnWidth + fit.gap),
        top + HEADER_HEIGHT + index * (fit.rowHeight + fit.gap),
        fit.columnWidth,
        fit.rowHeight,
      );
    });
  }

  render(lane: LaneView, wave: number, phase: Phase, selectedUnitId: number | null): void {
    const table = damageTable(this.data, lane.unitDamage, this.shown);

    // Which wave these are, and whether they are still moving. A player
    // looking at numbers during the build phase is looking at the wave that
    // just ended, and nothing else on screen says so.
    const heading =
      wave < 1
        ? 'No wave fought yet'
        : phase === 'combat'
          ? `Wave ${wave} · live`
          : `Wave ${wave} · final`;
    const suffix = table.hidden > 0 ? ` · top ${table.rows.length}` : '';
    if (this.heading.text !== heading + suffix) this.heading.text = heading + suffix;

    const total = table.total > 0 ? `${formatDamage(table.total)} total` : '';
    if (this.total.text !== total) this.total.text = total;
    this.total.visible = total.length > 0;
    // Right-aligned against the same edge the rows end at.
    this.total.x = this.rowsRight - this.total.width;

    const nothing = table.total <= 0;
    this.empty.visible = nothing;
    if (nothing) {
      const text =
        wave < 1
          ? 'The first wave has not arrived yet.'
          : phase === 'combat'
            ? 'Nothing landed yet this wave.'
            : 'Your units landed nothing last wave.';
      if (this.empty.text !== text) this.empty.text = text;
    }

    this.rows.forEach((row, i) => {
      const data = table.rows[i];
      row.visible = !nothing && data !== undefined && i < this.shown;
      if (!row.visible || !data) return;
      row.update(
        data,
        data.unitId === selectedUnitId,
        lane.units.some((unit) => unit.id === data.unitId),
      );
    });
  }
}

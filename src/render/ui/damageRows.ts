/**
 * The damage panel's arithmetic. DESIGN.md §14.1, added.
 *
 * Kept out of the Pixi layer for the same reason `unitStats.ts` is: sorting,
 * totalling and formatting are the parts worth pinning with tests, and a Pixi
 * `Text` cannot be constructed without a canvas.
 *
 * The panel ranks by damage because that is the question being asked - which
 * of these was worth its gold - and a list in build order answers a different
 * one. Ties break on id, so two units that did exactly nothing hold still
 * between frames instead of swapping places.
 */

import type { GameData, UnitDef } from '../../data/schema.ts';
import type { UnitDamageView } from '../../sim/index.ts';

/** Rows the panel builds at boot. Nothing is ever created after that. */
export const MAX_DAMAGE_ROWS = 12;
/** Room for a silhouette, a name and a number, and a 44px-ish tap target. */
const MIN_ROW_HEIGHT = 26;
const ROW_GAP = 4;
/** Below this a column is too narrow for a name beside a number. */
const TWO_COLUMN_WIDTH = 330;

export interface RowFit {
  columns: number;
  perColumn: number;
  /** Rows the panel can show at this size: `columns * perColumn`. */
  shown: number;
  rowHeight: number;
  columnWidth: number;
  gap: number;
}

/**
 * How many rows fit, and how big they are.
 *
 * Height decides the count and width decides the columns, so a tall phone
 * shows a longer list and a narrow one shows a single column rather than two
 * unreadable ones. Two rows is the floor: a panel that could not show a
 * comparison would not be worth a tab.
 */
export function fitRows(width: number, height: number): RowFit {
  const columns = width >= TWO_COLUMN_WIDTH ? 2 : 1;
  const perColumn = Math.max(
    2,
    Math.min(
      Math.floor(MAX_DAMAGE_ROWS / columns),
      Math.floor((height + ROW_GAP) / (MIN_ROW_HEIGHT + ROW_GAP)),
    ),
  );
  return {
    columns,
    perColumn,
    shown: perColumn * columns,
    rowHeight: (height - ROW_GAP * (perColumn - 1)) / perColumn,
    columnWidth: (width - ROW_GAP * (columns - 1)) / columns,
    gap: ROW_GAP,
  };
}

export interface DamageRow {
  unitId: number;
  /** The definition as it stands now: its name, its silhouette, its tier. */
  def: UnitDef;
  damage: number;
  /** 0 to 1 of the best row, for the bar drawn behind it. */
  share: number;
}

export interface DamageTable {
  rows: DamageRow[];
  /** Everything the line landed this round, including rows that did not fit. */
  total: number;
  /** Units ranked below the last row shown. */
  hidden: number;
}

/**
 * The rows to draw, best first, cut to `limit`.
 *
 * The total counts every unit, not just the ones on screen: it is the answer
 * to "how much did my line do", and a total that changed with the size of the
 * panel would be a different number on a different phone.
 */
export function damageTable(
  data: GameData,
  rows: readonly UnitDamageView[],
  limit: number,
): DamageTable {
  const out: DamageRow[] = [];
  let total = 0;

  for (const row of rows) {
    const def = data.units.units.find((u) => u.id === row.defId);
    // A row the client has no definition for cannot be drawn and cannot be
    // explained, so it is not counted either.
    if (!def) continue;
    total += row.damage;
    out.push({ unitId: row.unitId, def, damage: row.damage, share: 0 });
  }

  out.sort((a, b) => b.damage - a.damage || a.unitId - b.unitId);

  const best = out[0]?.damage ?? 0;
  for (const row of out) row.share = best > 0 ? row.damage / best : 0;

  const shown = out.slice(0, Math.max(0, limit));
  return { rows: shown, total, hidden: out.length - shown.length };
}

/**
 * A damage number as the panel shows it: whole points, grouped in threes.
 *
 * Exact rather than abbreviated. "12.4k" and "12.5k" are the same picture, and
 * the whole point of the panel is to tell two units apart - so the digits stay.
 * Grouped by hand rather than through `toLocaleString`, which would put a
 * different separator in front of a player depending on where their phone
 * thinks it is.
 */
export function formatDamage(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  const digits = String(rounded);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return out;
}

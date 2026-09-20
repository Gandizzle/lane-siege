/**
 * The damage panel's arithmetic. DESIGN.md §14.1, added.
 *
 * Pure, so it is tested here rather than through Pixi: a `Text` cannot be
 * constructed without a canvas, and the ranking is the part worth pinning.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../../data/loadNode.ts';
import { computeLayout } from '../layout.ts';
import { damageTable, fitRows, formatDamage, MAX_DAMAGE_ROWS } from './damageRows.ts';

const { data } = loadDataFromDisk();
const hammer = data.units.units.find((u) => u.id === 'pledge')!;
const hammer2 = data.units.units.find((u) => u.id === 'pledge_2')!;

function row(unitId: number, defId: string, damage: number) {
  return { unitId, defId, damage };
}

describe('ranking the round (§14.1, added)', () => {
  it('puts the biggest number first', () => {
    const table = damageTable(
      data,
      [row(1, 'pledge', 120), row(2, 'pledge', 900), row(3, 'pledge', 400)],
      10,
    );
    expect(table.rows.map((r) => r.unitId)).toEqual([2, 3, 1]);
  });

  it('breaks a tie on id, so a row does not swap places every frame', () => {
    const table = damageTable(data, [row(9, 'pledge', 0), row(4, 'pledge', 0)], 10);
    expect(table.rows.map((r) => r.unitId)).toEqual([4, 9]);
  });

  it('measures each bar against the best row, not against the total', () => {
    const table = damageTable(data, [row(1, 'pledge', 1000), row(2, 'pledge', 250)], 10);
    expect(table.rows[0]!.share).toBe(1);
    expect(table.rows[1]!.share).toBe(0.25);
  });

  it('draws no bar at all when nothing has been landed', () => {
    const table = damageTable(data, [row(1, 'pledge', 0), row(2, 'pledge', 0)], 10);
    expect(table.total).toBe(0);
    expect(table.rows.every((r) => r.share === 0)).toBe(true);
  });

  it('totals every unit, including the ones that did not fit', () => {
    const rows = [row(1, 'pledge', 500), row(2, 'pledge', 300), row(3, 'pledge', 200)];
    const table = damageTable(data, rows, 2);

    // A total that shrank on a smaller screen would be a different number on a
    // different phone, for the same wave.
    expect(table.rows).toHaveLength(2);
    expect(table.hidden).toBe(1);
    expect(table.total).toBe(1000);
  });

  it('carries the definition, so a row can draw its mark', () => {
    const table = damageTable(data, [row(1, 'pledge_2', 10), row(2, 'pledge', 5)], 10);
    expect(table.rows[0]!.def.mark).toBe(hammer2.mark);
    expect(table.rows[1]!.def.mark).toBe(hammer.mark);
  });

  it('drops a row it has no definition for rather than drawing a blank', () => {
    const table = damageTable(data, [row(1, 'no_such_unit', 999), row(2, 'pledge', 10)], 10);
    expect(table.rows.map((r) => r.unitId)).toEqual([2]);
    expect(table.total).toBe(10);
  });
});

describe('the number as it is shown', () => {
  it('groups in threes and rounds to whole points', () => {
    expect(formatDamage(0)).toBe('0');
    expect(formatDamage(7.4)).toBe('7');
    expect(formatDamage(999)).toBe('999');
    expect(formatDamage(1000)).toBe('1,000');
    expect(formatDamage(12480.6)).toBe('12,481');
    expect(formatDamage(1234567)).toBe('1,234,567');
  });

  it('never shows a negative', () => {
    expect(formatDamage(-5)).toBe('0');
  });
});

describe('fitting the rows to the screen', () => {
  /** The panel area of the build bar, as buildBar.ts lays it out. */
  function panel(width: number, height: number) {
    const bar = computeLayout(width, height, data.lane).buildBar;
    // Tab strip, then the header line the panel puts above its rows.
    return fitRows(bar.width - 12, bar.height - 26 - 12 - 17);
  }

  it('fills two columns on a phone and keeps every row tappable', () => {
    const fit = panel(412, 915);
    expect(fit.columns).toBe(2);
    expect(fit.shown).toBeLessThanOrEqual(MAX_DAMAGE_ROWS);
    expect(fit.rowHeight).toBeGreaterThanOrEqual(26);
  });

  it('shows fewer rows on a short screen rather than thinner ones', () => {
    const tall = panel(412, 915);
    const short = panel(360, 640);
    expect(short.shown).toBeLessThan(tall.shown);
    // A row that shrank to fit would stop being a target a thumb can hit.
    expect(short.rowHeight).toBeGreaterThanOrEqual(26);
  });

  it('drops to one column when a column would be too narrow for a name', () => {
    expect(panel(320, 568).columns).toBe(1);
    expect(panel(412, 915).columns).toBe(2);
  });

  it('never asks for more rows than the panel built', () => {
    for (const [w, h] of [
      [320, 480],
      [360, 640],
      [412, 915],
      [430, 932],
      [768, 1024],
      [1024, 1366],
    ] as const) {
      const fit = panel(w, h);
      expect(fit.shown, `${w}x${h}`).toBeLessThanOrEqual(MAX_DAMAGE_ROWS);
      expect(fit.shown, `${w}x${h}`).toBeGreaterThanOrEqual(2);
    }
  });
});

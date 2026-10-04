/**
 * Which units get the upgrade burst (upgradeBursts.ts): the ones that are the
 * same body as before at a higher mark - not a new unit, not a sold one, not
 * one that only looks different because a different lane is on screen.
 */

import { describe, expect, it } from 'vitest';
import type { EntityView, LaneView } from '../sim/index.ts';
import { upgradeWord, upgradedUnits } from './upgradeBursts.ts';

const MARKS: Record<string, number> = { pledge: 1, pledge_2: 2, pledge_3: 3, vigil: 1 };
const markOf = (defId: string) => MARKS[defId] ?? 1;

function lane(units: [number, string][]): LaneView {
  return {
    units: units.map(([id, defId]) => ({ id, defId, x: 1, y: 1, radius: 0.3 }) as EntityView),
  } as LaneView;
}

describe('the upgrade burst', () => {
  it('goes off for a unit that is now a higher mark, and only that one', () => {
    const before = new Map([
      [1, 'pledge'],
      [2, 'pledge'],
    ]);
    const now = lane([
      [1, 'pledge_2'],
      [2, 'pledge'],
      [3, 'vigil'],
    ]);
    expect(upgradedUnits(before, now, markOf).map((u) => u.id)).toEqual([1]);
  });

  it('goes off again for the second upgrade', () => {
    const before = new Map([[1, 'pledge_2']]);
    expect(upgradedUnits(before, lane([[1, 'pledge_3']]), markOf)).toHaveLength(1);
  });

  it('does not go off for a placement or a sale', () => {
    expect(upgradedUnits(new Map(), lane([[1, 'pledge']]), markOf)).toHaveLength(0);
    expect(upgradedUnits(new Map([[1, 'pledge_2']]), lane([]), markOf)).toHaveLength(0);
  });

  it('says what the unit became, as its name does', () => {
    expect(upgradeWord(2)).toBe('Super!');
    expect(upgradeWord(3)).toBe('Ultra!');
  });
});

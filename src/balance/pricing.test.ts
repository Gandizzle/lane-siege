import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  GOLD_EFFICIENCY_PER_RUNG,
  MARK_COST,
  MARK_VALUE,
  SUPPLY_BY_RUNG,
  SUPPLY_EFFICIENCY_PER_RUNG,
  markOneCost,
  markStepCost,
  markStepSupply,
  priceRoster,
  targetValue,
  totalCost,
  unitValue,
} from './pricing.ts';
import { computeBudget } from './budget.ts';

const { data } = loadDataFromDisk();

/**
 * The ladder is two growth rates and everything else falls out of them. These
 * say what "falls out" means, because the failure mode is not a crash - it is a
 * roster where the expensive unit is quietly the worse buy and nobody notices
 * for a month.
 */
describe('the rung ladder', () => {
  const rungs = [1, 2, 3, 4, 5, 6];

  it('makes every rung dearer in gold than the one below', () => {
    for (let r = 2; r <= 6; r++) {
      expect(markOneCost(r), `rung ${r}`).toBeGreaterThan(markOneCost(r - 1));
    }
  });

  it('makes every rung better value per gold, by the stated rate', () => {
    for (let r = 2; r <= 6; r++) {
      const above = targetValue(r, 1) / markOneCost(r);
      const below = targetValue(r - 1, 1) / markOneCost(r - 1);
      expect(above / below, `rung ${r}`).toBeCloseTo(GOLD_EFFICIENCY_PER_RUNG, 6);
    }
  });

  it('makes every rung better value per supply, by the stated rate', () => {
    for (let r = 2; r <= 6; r++) {
      const above = targetValue(r, 1) / SUPPLY_BY_RUNG[r - 1]!;
      const below = targetValue(r - 1, 1) / SUPPLY_BY_RUNG[r - 2]!;
      expect(above / below, `rung ${r}`).toBeCloseTo(SUPPLY_EFFICIENCY_PER_RUNG, 6);
    }
  });

  it('climbs faster per supply than per gold, which is the point of it', () => {
    expect(SUPPLY_EFFICIENCY_PER_RUNG).toBeGreaterThan(GOLD_EFFICIENCY_PER_RUNG);
    const top = targetValue(6, 1) / SUPPLY_BY_RUNG[5]!;
    const bottom = targetValue(1, 1) / SUPPLY_BY_RUNG[0]!;
    expect(top / bottom).toBeGreaterThan(4);
  });

  /**
   * The one a flat supply charge on upgrades used to break: a fully upgraded
   * rung 4 body cost five supply against a rung 3 body's three, which made the
   * dearer unit worse per supply and removed every reason to climb.
   */
  it('stays monotone per supply at the TOP mark, not just at Mark I', () => {
    for (let r = 2; r <= 6; r++) {
      const above = targetValue(r, 3) / totalCost(r, 3).supply;
      const below = targetValue(r - 1, 3) / totalCost(r - 1, 3).supply;
      expect(above, `rung ${r} fully upgraded`).toBeGreaterThan(below);
    }
    for (let r = 2; r <= 6; r++) {
      const above = totalCost(r, 3).gold / totalCost(r, 3).supply;
      const below = totalCost(r - 1, 3).gold / totalCost(r - 1, 3).supply;
      expect(above, `rung ${r} gold per supply`).toBeGreaterThan(below);
    }
  });

  it('keeps every Mark I price inside the band the design asked for', () => {
    const bands: Record<number, [number, number]> = {
      1: [30, 60],
      2: [55, 100],
      3: [95, 160],
      4: [155, 260],
      5: [255, 355],
      6: [325, 425],
    };
    for (const r of rungs) {
      const [low, high] = bands[r]!;
      expect(markOneCost(r), `rung ${r}`).toBeGreaterThanOrEqual(low);
      expect(markOneCost(r), `rung ${r}`).toBeLessThanOrEqual(high);
    }
  });
});

describe('the mark ladder', () => {
  it('charges more for each mark than the one before it', () => {
    for (const r of [1, 3, 6]) {
      expect(markStepCost(r, 2)).toBeGreaterThan(markStepCost(r, 1));
      expect(markStepCost(r, 3)).toBeGreaterThan(markStepCost(r, 2));
    }
  });

  it('pays slightly better than flat per gold, so going tall is a choice', () => {
    for (let m = 2; m <= 3; m++) {
      const perGold = MARK_VALUE[m - 1]! / MARK_COST[m - 1]!;
      expect(perGold, `Mark ${m}`).toBeGreaterThan(1);
      // ...but not so much that a fresh body is never worth buying.
      expect(perGold, `Mark ${m}`).toBeLessThan(1.25);
    }
  });

  it('charges upgrade supply in proportion to the body, never flat', () => {
    for (let r = 1; r <= 6; r++) {
      expect(markStepSupply(r, 2), `rung ${r} Mk II`).toBe(0);
      expect(markStepSupply(r, 3), `rung ${r} Mk III`).toBe(SUPPLY_BY_RUNG[r - 1]);
    }
    // Which is the 1-to-3 supply the design asked for at the top of a chain.
    expect([1, 3, 5].map((r) => markStepSupply(r, 3))).toEqual([1, 2, 3]);
  });
});

/**
 * And that the roster in data/ is actually ON the ladder. `npm run reprice`
 * puts it there; this is what notices when somebody edits a number by hand.
 */
describe('the roster as priced', () => {
  it('sits on the ladder, to within rounding', () => {
    for (const p of priceRoster(data)) {
      expect(p.scaleFactor, `${p.id} stats`).toBeGreaterThan(0.9);
      expect(p.scaleFactor, `${p.id} stats`).toBeLessThan(1.1);
    }
  });

  it('charges the ladder price for every unit', () => {
    for (const unit of data.units.units) {
      expect(unit.goldCost, `${unit.id} gold`).toBe(Math.round(markStepCost(unit.rung, unit.mark)));
      expect(unit.supplyCost, `${unit.id} supply`).toBe(markStepSupply(unit.rung, unit.mark));
    }
  });

  it('keeps each unit its own shape - only damage and hp were moved', () => {
    // A tank is a tank and a gun is a gun: the restat scales both halves of a
    // unit together, so its offence-to-defence ratio is untouched. Ironvow's
    // Oathwall should still be the toughest thing it fields, and its Judgement
    // still the hardest-hitting, whatever they now cost.
    const ironvow = data.units.units.filter((u) => u.builderId === 'ironvow' && u.mark === 1);
    const toughest = ironvow.reduce((a, b) => ((a.hp ?? 0) >= (b.hp ?? 0) ? a : b));
    const hardest = ironvow.reduce((a, b) =>
      (a.damage ?? 0) * (a.attackSpeed ?? 0) >= (b.damage ?? 0) * (b.attackSpeed ?? 0) ? a : b,
    );
    expect(toughest.id).toBe('oathwall');
    expect(hardest.id).toBe('judgement');
  });

  it('prices no unit the budget cannot buy at least a few of', () => {
    const budget = computeBudget(data);
    for (const unit of data.units.units) {
      const full = totalCost(unit.rung, unit.mark);
      expect(budget.armyGold / full.gold, `${unit.id}`).toBeGreaterThan(3);
      expect(budget.armySupply / full.supply, `${unit.id}`).toBeGreaterThan(3);
    }
  });
});

describe('what value means', () => {
  it('is zero for a body that cannot hurt anything', () => {
    expect(unitValue({ damage: 0, attackSpeed: 1, range: 1, hp: 9999 })).toBe(0);
    expect(unitValue({ damage: 50, attackSpeed: 1, range: 1, hp: 0 })).toBe(0);
  });

  it('is linear in a scale applied to both halves', () => {
    const body = { damage: 20, attackSpeed: 1.2, range: 2, hp: 400 };
    const doubled = { ...body, damage: 40, hp: 800 };
    expect(unitValue(doubled) / unitValue(body)).toBeCloseTo(2, 9);
  });

  it('pays for reach', () => {
    const near = { damage: 20, attackSpeed: 1, range: 0.1, hp: 300 };
    const far = { ...near, range: 5 };
    expect(unitValue(far)).toBeGreaterThan(unitValue(near));
  });
});

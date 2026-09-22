import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { isMelee } from '../data/roster.ts';
import {
  chainCost,
  enumerateArmies,
  layOut,
  leakLine,
  nominalArmyGold,
  runWave,
  sampleArmies,
  shelf,
  usableRows,
  waveHitPoints,
  type Shopping,
} from './sandbox.ts';

const { data } = loadDataFromDisk();

function basket(
  data_: typeof data,
  builderId: string,
  buys: { rung: number; mark: number }[],
): Shopping {
  let gold = 0;
  let supply = 0;
  for (const buy of buys) {
    const cost = chainCost(data_, builderId, buy.rung, buy.mark);
    gold += cost.gold;
    supply += cost.supply;
  }
  return { buys, gold, supply };
}

describe('the shop', () => {
  it('charges what the roster charges, chain and all', () => {
    // pledge 45, pledge_2 +68, pledge_3 +101.
    expect(chainCost(data, 'ironvow', 1, 1)).toEqual({ gold: 45, supply: 1 });
    expect(chainCost(data, 'ironvow', 1, 2)).toEqual({ gold: 113, supply: 1 });
    expect(chainCost(data, 'ironvow', 1, 3)).toEqual({ gold: 214, supply: 2 });
  });

  it('shelves nothing a budget cannot reach', () => {
    for (const item of shelf(data, 'pyre', 200)) {
      expect(
        chainCost(data, 'pyre', item.rung, item.mark).gold,
        `r${item.rung}m${item.mark}`,
      ).toBeLessThanOrEqual(200);
    }
    // Rung 5 is 334 and so is not on a 200 gold shelf at any mark.
    expect(shelf(data, 'pyre', 200).some((i) => i.rung >= 5)).toBe(false);
    expect(shelf(data, 'pyre', 500).some((i) => i.rung === 5)).toBe(true);
  });
});

describe('enumerating armies', () => {
  const armies = enumerateArmies(data, 'ironvow', 250, 25);

  it('finds something to buy, and never overspends', () => {
    expect(armies.length).toBeGreaterThan(5);
    for (const army of armies) {
      expect(army.gold, army.buys.map((b) => `r${b.rung}m${b.mark}`).join(' ')).toBeLessThanOrEqual(
        250,
      );
      expect(army.supply).toBeLessThanOrEqual(25);
      expect(army.buys.length).toBeGreaterThan(0);
    }
  });

  it('refuses the baskets that declined to spend the budget', () => {
    // 85% of 250 is 212.5, so a lone 178-gold rung 4 is not an answer to "250".
    for (const army of armies) expect(army.gold).toBeGreaterThanOrEqual(250 * 0.85);
  });

  it('keeps a player to a few lines, counting marks of one line as one', () => {
    for (const army of armies) {
      expect(new Set(army.buys.map((b) => b.rung)).size).toBeLessThanOrEqual(3);
    }
    // And a basket that is one line at two marks is allowed, which is the case
    // the rung-rather-than-item rule exists for.
    const twoMarks = enumerateArmies(data, 'ironvow', 250, 25).filter(
      (a) =>
        new Set(a.buys.map((b) => b.mark)).size > 1 &&
        new Set(a.buys.map((b) => b.rung)).size === 1,
    );
    expect(twoMarks.length).toBeGreaterThan(0);
  });

  it('holds its shape when sampled down', () => {
    const many = enumerateArmies(data, 'ironvow', 650, 25);
    expect(many.length).toBeGreaterThan(100);
    const few = sampleArmies(many, 20);
    expect(few).toHaveLength(20);
    const rung = (s: Shopping): number => s.buys.reduce((n, b) => n + b.rung, 0) / s.buys.length;
    // The sample still spans cheap-and-many to dear-and-few rather than
    // collapsing onto whichever corner the enumerator emits first.
    expect(Math.max(...few.map(rung)) - Math.min(...few.map(rung))).toBeGreaterThan(1);
  });
});

describe('the line', () => {
  it('stands melee in front of reach', () => {
    // Twelve bodies, so the line is more than one row deep and "in front" is
    // a thing the rows can actually disagree about. Six of each fits a row of
    // eight and spills, which is the arrangement that tells melee-first from
    // reach-first; three bodies all land in row 0 and cannot.
    const army = basket(data, 'ironvow', [
      ...Array.from({ length: 6 }, () => ({ rung: 1, mark: 1 })),
      ...Array.from({ length: 6 }, () => ({ rung: 2, mark: 1 })),
    ]);
    const placed = layOut(data, 'ironvow', army);
    const melee = placed.filter((p) => isMelee(p.def));
    const reach = placed.filter((p) => !isMelee(p.def));
    expect(melee).toHaveLength(6);
    expect(reach).toHaveLength(6);

    // tileY 0 is the row the wave arrives at, so a lower mean row is further
    // forward. Strict, because equal means the split did nothing.
    const meanRow = (rows: typeof placed): number =>
      rows.reduce((sum, p) => sum + p.tileY, 0) / rows.length;
    expect(meanRow(melee)).toBeLessThan(meanRow(reach));
    expect(Math.max(...melee.map((p) => p.tileY))).toBeLessThanOrEqual(
      Math.min(...reach.map((p) => p.tileY)),
    );
  });

  it('never stands where the fortress could help', () => {
    const army = enumerateArmies(data, 'pyre', 650, 25).sort(
      (a, b) => b.buys.length - a.buys.length,
    )[0]!;
    const placed = layOut(data, 'pyre', army);
    expect(placed.length).toBeGreaterThan(4);
    for (const p of placed) expect(p.tileY).toBeLessThan(usableRows(data));
    expect(usableRows(data)).toBeLessThanOrEqual(leakLine(data));
  });
});

describe('a measured wave', () => {
  const army = basket(data, 'ironvow', [
    { rung: 1, mark: 1 },
    { rung: 3, mark: 1 },
  ]);

  it('clears wave 1 and says how comfortably', () => {
    const out = runWave(data, 'ironvow', army, 1, 1);
    expect(out.cleared).toBe(true);
    expect(out.leaked).toBe(0);
    expect(out.waveHpLeft).toBe(0);
    expect(out.seconds).toBeGreaterThan(0);
    expect(out.timedOut).toBe(false);
  });

  it('never reports more health than an army has', () => {
    // Thornweald's rung 2 raises its neighbours' maximum on the first tick of
    // combat. Measured against the maximum they were BUILT with, a full-health
    // army came back at 125%, and every margin in the report was inflated by
    // however much a builder buffed itself.
    for (const builderId of ['ironvow', 'pyre', 'thornweald', 'gloomtide']) {
      for (const shopping of enumerateArmies(data, builderId, 350, 25).slice(0, 6)) {
        const out = runWave(data, builderId, shopping, 2, 1);
        expect(out.armyHpLeft, `${builderId} ${out.label}`).toBeLessThanOrEqual(1);
        expect(out.armyHpLeft).toBeGreaterThanOrEqual(0);
        expect(out.margin).toBeLessThanOrEqual(1);
        expect(out.margin).toBeGreaterThanOrEqual(-1);
      }
    }
  });

  it('counts what walks past as leaked, not as killed', () => {
    // One rung 1 body against a wave it cannot stop. What gets past is removed
    // at the fortress's reach and counted, with the health it still had.
    const lone = basket(data, 'ironvow', [{ rung: 1, mark: 1 }]);
    const out = runWave(data, 'ironvow', lone, 4, 1);
    expect(out.leaked).toBeGreaterThan(0);
    expect(out.cleared).toBe(false);
    expect(out.waveHpLeft).toBeGreaterThan(0);
    expect(out.timedOut).toBe(false);
  });

  it('is a fight the wall could not have changed either way', () => {
    // The point of placing forward and cutting at the weapon's reach is that
    // the wall has no way in: it cannot shoot past the line the leak is taken
    // at, and its aura stops short of the rows the army stands in. So waking it
    // up must change nothing. If a result ever moves here, the army has drifted
    // back into the wall's reach and every margin in the sweep is partly the
    // wall's.
    const lone = basket(data, 'ironvow', [{ rung: 1, mark: 1 }]);
    const silent = runWave(data, 'ironvow', lone, 3, 1);
    const awake = runWave(data, 'ironvow', lone, 3, 1, { wakeTheFortress: true });
    expect(silent.leaked).toBeGreaterThan(0);
    expect(awake.leaked).toBe(silent.leaked);
    expect(awake.armyHpLeft).toBe(silent.armyHpLeft);
    expect(awake.waveHpLeft).toBe(silent.waveHpLeft);
  });

  it('stands the army outside the aura and short of the weapon', () => {
    const backRow = usableRows(data) - 1 + 0.5;
    const fortressY = data.lane.buildZone.depth + data.lane.fortressZoneDepth * 0.5;
    expect(fortressY - backRow).toBeGreaterThan(data.fortress.auras.radius.base!);
    expect(leakLine(data)).toBeLessThanOrEqual(
      data.lane.buildZone.depth - data.fortress.weapon.range!,
    );
  });

  it('measures the wave against the wave', () => {
    expect(waveHitPoints(data, 1, 1)).toBeGreaterThan(0);
    expect(waveHitPoints(data, 1, 4)).toBeGreaterThan(waveHitPoints(data, 1, 1));
  });
});

describe('what a wave is tuned for', () => {
  it('is authored on waves 1 to 5, and rises', () => {
    let previous = 0;
    for (let wave = 1; wave <= 5; wave++) {
      const nominal = nominalArmyGold(data, wave);
      expect(nominal, `wave ${wave}`).toBeGreaterThan(previous);
      previous = nominal;
    }
  });

  it('always leaves the player something over', () => {
    // 250 to start and a fixed 200 a wave, spent on nothing but army. A wave
    // that asks for every coin has taken the decision away.
    let earned = 250;
    for (let wave = 1; wave <= 5; wave++) {
      expect(nominalArmyGold(data, wave), `wave ${wave}`).toBeLessThan(earned);
      earned += 200;
    }
  });
});

import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget.ts';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { isMelee } from '../data/roster.ts';
import {
  chainCost,
  enumerateArmies,
  layOut,
  leakLine,
  nominalArmyGold,
  techGoldAtWave,
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
    // Summed off the definitions rather than written down here: the prices are
    // balance data and move whenever the mark ladder is retuned, and a test
    // that names them fails on the retune while saying nothing about whether
    // the shop reads the roster - which is the thing under test.
    const chain = ['pledge', 'pledge_2', 'pledge_3'].map((id) =>
      data.units.units.find((u) => u.id === id)!,
    );
    let gold = 0;
    let supply = 0;
    chain.forEach((def, i) => {
      gold += def.goldCost ?? 0;
      supply += def.supplyCost ?? 0;
      expect(chainCost(data, 'ironvow', 1, i + 1), `mark ${i + 1}`).toEqual({ gold, supply });
    });
    // And it really is cumulative, not the last step alone.
    expect(gold).toBeGreaterThan(chain[2]!.goldCost ?? 0);
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

  // Twenty-four fights against a tuned wave 2, which is a real wave now.
  it('never reports more health than an army has', { timeout: 30_000 }, () => {
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

  it('fights with the tech it is handed, and none unless it is', () => {
    const plain = runWave(data, 'ironvow', army, 1, 1);
    const tougher = runWave(data, 'ironvow', army, 1, 1, { tech: { def_hp: 1 } });
    const bonus = data.economy.tech.tracks.find((t) => t.id === 'def_hp')!.levels[0]!.value!;
    for (const [i, line] of plain.lines.entries()) {
      expect(tougher.lines[i]!.maxHp).toBeCloseTo(line.maxHp * (1 + bonus), 5);
    }
  });

  it('measures the wave against the wave', () => {
    expect(waveHitPoints(data, 1, 1)).toBeGreaterThan(0);
    expect(waveHitPoints(data, 1, 4)).toBeGreaterThan(waveHitPoints(data, 1, 1));
  });
});

describe('what a wave is tuned for', () => {
  it('is authored on waves 1 to 25, and rises', () => {
    // A boss wave is a spike and may stand above the wave after it; that
    // wave still has to be harder than the one BEFORE the boss.
    const every = data.waves.bossEveryNWaves;
    let previous = 0;
    for (let wave = 1; wave <= 25; wave++) {
      const nominal = nominalArmyGold(data, wave);
      expect(nominal, `wave ${wave}`).toBeGreaterThan(previous);
      const boss = every > 0 && wave % every === 0;
      if (!boss) previous = nominal;
    }
  });

  it('leaves a player with no economy something over, to wave 10', () => {
    // 250 to start, a fixed 200 a wave and a boss's purse, spent on nothing but
    // army. A wave that asks for every coin has taken the decision away.
    const every = data.waves.bossEveryNWaves;
    let earned = 250;
    for (let wave = 1; wave <= 10; wave++) {
      expect(nominalArmyGold(data, wave), `wave ${wave}`).toBeLessThan(earned);
      earned += 200;
      if (wave % every === 0) earned += data.economy.bossBounty ?? 0;
    }
  });

  it('never asks for more than a steady economy leaves for the army', () => {
    // Past wave 10 the ladder is set against the player the budget model
    // describes - one output level a wave, a rate level every five - and not
    // against one with no economy at all, who is meant to fall behind there,
    // and with the tech the sweep fights with already paid for.
    // Still never more than that player has, or nobody has room. (Not before
    // wave 11: until it pays back, an economy leaves LESS for the army than
    // none, which is the test above.)
    // The last wave is the exception, on purpose: a council of bosses that a
    // steady economy is NOT meant to beat. It is the check that a player built
    // an army at or near the supply cap, and a medium economy does not.
    const rows = computeBudget(data).waves;
    for (let wave = 11; wave < data.waves.showdown.afterWave; wave++) {
      const before = rows[wave - 2];
      const has =
        (before ? before.cumulativeIncome - before.cumulativeGemLadder : 250) -
        techGoldAtWave(data, wave);
      expect(nominalArmyGold(data, wave), `wave ${wave}`).toBeLessThan(has);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { computeBudget } from './budget.ts';
import { totalCost } from './pricing.ts';
import { BUILD_SPECS, lineNames, lines, placementOrder, realise, sharesLabel } from './builds.ts';
import { runArena, seatsForArmies } from './arena.ts';
import { planFights, runFights, standardError, summarise, type FightRecord } from './tournament.ts';

const { data } = loadDataFromDisk();
const budget = computeBudget(data);
const design = BUILD_SPECS.find((s) => s.id === 'design')!;

describe('realising a build', () => {
  it('never spends more than it was given', () => {
    for (const builder of data.units.builders) {
      for (const spec of BUILD_SPECS) {
        const army = realise(data, builder.id, spec, budget.armyGold, budget.armySupply);
        expect(army.goldSpent, `${builder.id}/${spec.id} gold`).toBeLessThanOrEqual(
          budget.armyGold + 1e-9,
        );
        expect(army.supplyUsed, `${builder.id}/${spec.id} supply`).toBeLessThanOrEqual(
          budget.armySupply,
        );
      }
    }
  });

  it('never places more bodies than the grid has tiles', () => {
    const tiles = data.lane.buildZone.width * data.lane.buildZone.depth;
    for (const builder of data.units.builders) {
      for (const spec of BUILD_SPECS) {
        const army = realise(data, builder.id, spec, budget.armyGold, budget.armySupply);
        expect(army.units.length, `${builder.id}/${spec.id}`).toBeLessThanOrEqual(tiles);
        const seen = new Set(army.units.map((u) => `${u.tileX},${u.tileY}`));
        expect(seen.size, 'two bodies on one tile').toBe(army.units.length);
      }
    }
  });

  it('builds only the rungs the spec asked for', () => {
    for (const [index, spec] of BUILD_SPECS.entries()) {
      if (!spec.id.startsWith('pure')) continue;
      const rung = index + 1;
      const army = realise(data, 'ironvow', spec, budget.armyGold, budget.armySupply);
      expect(army.units.length).toBeGreaterThan(0);
      expect(new Set(army.units.map((u) => u.rung))).toEqual(new Set([rung]));
    }
  });

  it('puts the shortest reach at the front and the longest at the back', () => {
    const byId = new Map(data.units.units.map((u) => [u.id, u]));
    const army = realise(data, 'gloomtide', design, budget.armyGold, budget.armySupply);

    // Row by row from the front: no body in a later row may outrange one in an
    // earlier row by the sort, which is what "melee up front" means once the
    // rows are filled in order.
    let previousRange = -Infinity;
    for (const unit of army.units) {
      const range = byId.get(unit.defId)?.range ?? 0;
      expect(range, `${unit.defId} out of order`).toBeGreaterThanOrEqual(previousRange - 1e-9);
      previousRange = range;
    }

    const first = army.units[0]!;
    const last = army.units[army.units.length - 1]!;
    expect(first.tileY, 'first body is in the front row').toBeLessThanOrEqual(last.tileY);
    expect(byId.get(last.defId)!.range!).toBeGreaterThan(byId.get(first.defId)!.range!);
  });

  it('reports a build that ran out of tiles rather than silently shrinking it', () => {
    // A rung 1 body at Mark I costs one supply, so 95 supply wants 95 of them
    // and the grid holds 80. The board is the second cap on going wide, and
    // the report has to be able to say the build hit it.
    //
    // Only at Mark I: a Mark III rung 1 body costs two supply, so the same
    // build upgraded is 48 bodies and fits. That upgrading RELIEVES the board
    // constraint is another reason going tall wins, and it is why this asks
    // for the Mark I version by name rather than taking the first spec.
    const wide = realise(
      data,
      'ironvow',
      { id: 'wideMk1', name: 'rung 1, Mark I', shares: [1, 0, 0, 0, 0, 0], mark: 1 },
      budget.armyGold,
      budget.armySupply,
    );
    expect(wide.tilesShort).toBeGreaterThan(0);
    expect(wide.units.length).toBe(data.lane.buildZone.width * data.lane.buildZone.depth);

    const tall = realise(data, 'ironvow', BUILD_SPECS[0]!, budget.armyGold, budget.armySupply);
    expect(tall.tilesShort, 'the same build upgraded fits on the board').toBe(0);
  });

  it('never comes back empty, however small the budget', () => {
    // A rung whose share is worth less than one body gets nothing from the
    // proportional pass, so a spread build on a small budget used to buy
    // NOTHING - "a tenth of eight supply" rounds to zero six times - and lost
    // a fight it never turned up to.
    for (const spec of BUILD_SPECS) {
      for (const supply of [4, 8, 10, 20]) {
        const army = realise(data, 'ironvow', spec, 3000, supply);
        expect(army.units.length, `${spec.id} on ${supply} supply`).toBeGreaterThan(0);
      }
    }
  });

  it('stops only when something has actually run out', () => {
    // Three things can stop a build: supply, gold, or the board. Whichever it
    // was, one of them has to be too empty to buy the cheapest body the spec
    // is allowed. A build that stops with all three in hand is a bug in the
    // spender, and it was one - the proportional pass used to leave supply on
    // the table for any rung whose share rounded below a body.
    for (const builder of data.units.builders) {
      for (const spec of BUILD_SPECS) {
        const army = realise(data, builder.id, spec, budget.armyGold, budget.armySupply);
        if (army.tilesShort > 0) continue;

        const rungs = spec.shares
          .map((share, i) => ({ share, rung: i + 1 }))
          .filter((r) => r.share > 0);
        const cheapestSupply = Math.min(
          ...rungs.map((r) => totalCost(r.rung, spec.mark ?? 3).supply),
        );
        const cheapestGold = Math.min(...rungs.map((r) => totalCost(r.rung, 1).gold));

        const supplyLeft = army.supplyBudget - army.supplyUsed;
        const goldLeft = army.goldBudget - army.goldSpent;
        expect(
          supplyLeft < cheapestSupply || goldLeft < cheapestGold,
          `${builder.id}/${spec.id} stopped with ${supplyLeft} supply and ${Math.round(goldLeft)} gold in hand`,
        ).toBe(true);
      }
    }
  });

  it('fills the tile order from the middle of each row outward', () => {
    const order = placementOrder(data);
    const width = data.lane.buildZone.width;
    expect(order).toHaveLength(width * data.lane.buildZone.depth);
    expect(order.slice(0, width).every((t) => t.tileY === 0)).toBe(true);
    // The middle column first, then either side of it.
    expect(order[0]!.tileX).toBe(Math.floor(width / 2));
    expect(Math.abs(order[1]!.tileX - order[0]!.tileX)).toBe(1);
  });

  it('knows each builder as six chains of marks', () => {
    for (const builder of data.units.builders) {
      const chains = lines(data, builder.id);
      expect(
        [...chains.keys()].sort((a, b) => a - b),
        builder.id,
      ).toEqual([1, 2, 3, 4, 5, 6]);
      for (const [rung, chain] of chains) {
        expect(chain.length, `${builder.id} rung ${rung}`).toBeGreaterThanOrEqual(2);
        expect(chain.map((u) => u.mark)).toEqual(chain.map((_, i) => i + 1));
      }
    }
  });
});

/**
 * A full-budget fight is ninety bodies a side and takes fifteen seconds of CPU,
 * which is the round robin's business and not a test suite's. These run on a
 * pocket budget - a handful of bodies each - because what they check is that
 * the instrument behaves, not what it measures.
 *
 * They are still seconds rather than milliseconds, and cutting the armies
 * further would not help: the cost of a tick is the flow field, and the field
 * is sized by the ARENA (32 tiles a side at five cells a tile) rather than by
 * how many bodies are walking on it. Two bodies a side costs most of what ten
 * does. Hence the explicit timeouts.
 */
describe('the arena', () => {
  const SMALL_GOLD = 1200;
  const SMALL_SUPPLY = 10;
  const SLOW = { timeout: 60_000 };

  it('is deterministic: one seed, one outcome', SLOW, () => {
    const armies = ['ironvow', 'pyre'].map((id) =>
      realise(data, id, design, SMALL_GOLD, SMALL_SUPPLY),
    );
    const a = runArena(data, armies, 4242);
    const b = runArena(data, armies, 4242);
    expect(a.ticks).toBe(b.ticks);
    expect(a.seats.map((s) => s.placement)).toEqual(b.seats.map((s) => s.placement));
    expect(a.seats.map((s) => s.survivingSupply)).toEqual(b.seats.map((s) => s.survivingSupply));
  });

  it('produces exactly one winner, and ends', SLOW, () => {
    const armies = data.units.builders.map((b) =>
      realise(data, b.id, design, SMALL_GOLD, SMALL_SUPPLY),
    );
    const result = runArena(data, armies, 99);
    expect(result.timedOut, 'a fight that will not end is not a result').toBe(false);
    expect(result.seats.filter((s) => s.won)).toHaveLength(1);
    expect(new Set(result.seats.map((s) => s.placement)).size).toBe(4);
  });

  it('seats a duel on opposite spokes, not the first two', SLOW, () => {
    // The first two seats are south and west - a quarter turn apart - which
    // makes a duel an L-shaped fight that meets at an angle rather than the
    // head-on clash it is supposed to be.
    expect(seatsForArmies(2)).toEqual([0, 2]);
    expect(seatsForArmies(4)).toEqual([0, 1, 2, 3]);

    const armies = ['ironvow', 'pyre'].map((id) =>
      realise(data, id, design, SMALL_GOLD, SMALL_SUPPLY),
    );
    const result = runArena(data, armies, 1);
    expect(result.seats.map((s) => s.seat)).toEqual([0, 2]);
    // And the loser still places second, not fourth: the two empty seats were
    // counted out before the fight started.
    expect(result.seats.map((s) => s.placement).sort()).toEqual([1, 2]);
  });

  it('gives the winner survivors and the losers none', SLOW, () => {
    const armies = ['ironvow', 'thornweald'].map((id) =>
      realise(data, id, design, SMALL_GOLD, SMALL_SUPPLY),
    );
    const result = runArena(data, armies, 7);
    const winner = result.seats.find((s) => s.won)!;
    const loser = result.seats.find((s) => !s.won)!;
    expect(winner.survivingSupply).toBeGreaterThan(0);
    expect(loser.unitsLeft).toBe(0);
    expect(loser.survivingSupply).toBe(0);
  });
});

describe('the tournament', () => {
  const options = { duelsPerPair: 1, freeForAlls: 1, mirrors: 1, seed: 11 };

  it('plans the same fights every time, which is what makes sharding sound', () => {
    expect(planFights(data, options)).toEqual(planFights(data, options));
  });

  it('plays both seatings of every duel', () => {
    const duels = planFights(data, options).filter((p) => p.kind === 'duel');
    expect(duels.length % 2).toBe(0);
    for (let i = 0; i < duels.length; i += 2) {
      const [first, second] = [duels[i]!, duels[i + 1]!];
      expect(first.pairKey).toBe(second.pairKey);
      expect(first.seed).toBe(second.seed);
      // Same two armies, opposite seats.
      expect(first.seats[0]).toEqual(second.seats[1]);
      expect(first.seats[1]).toEqual(second.seats[0]);
    }
  });

  it('sets every mirror fight to four copies of one builder on one build', () => {
    for (const plan of planFights(data, options).filter((p) => p.kind === 'mirror')) {
      expect(plan.seats).toHaveLength(4);
      expect(new Set(plan.seats.map((s) => `${s.builderId}/${s.specId}`)).size).toBe(1);
    }
  });

  /**
   * An arena fight is very nearly a function of the armies in it, so the same
   * mirror run twice is one observation written down twice. Sampling with
   * replacement turned 73 distinct mirrors into 160 "fights" and inflated the
   * control's chi-square from 7.7 to 21.0 - from "the arena is fine" to "the
   * arena is broken".
   */
  it('never repeats a mirror, however many are asked for', () => {
    const many = planFights(data, { ...options, mirrors: 1000 }).filter((p) => p.kind === 'mirror');
    const keys = many.map((p) => `${p.seats[0]!.builderId}/${p.seats[0]!.specId}`);
    expect(new Set(keys).size, 'a mirror was planned twice').toBe(keys.length);
    // Asking for more than there are builds gets every build, not repeats.
    expect(keys.length).toBe(BUILD_SPECS.length * data.units.builders.length);
  });

  it('puts one of every builder in every four-way', () => {
    for (const plan of planFights(data, options).filter((p) => p.kind === 'ffa')) {
      expect(new Set(plan.seats.map((s) => s.builderId)).size).toBe(4);
    }
  });

  it('shards into the same records as one run', { timeout: 120_000 }, () => {
    const plans = planFights(data, { duelsPerPair: 1, freeForAlls: 0, mirrors: 0, seed: 3 }).slice(
      0,
      2,
    );
    const whole = runFights(data, plans);
    const shards = [0, 1].map((i) =>
      runFights(
        data,
        plans.filter((_, n) => n % 2 === i),
      ),
    );
    // Interleaved back into plan order, exactly as the runner merges them.
    const merged: FightRecord[] = [];
    const cursor = [0, 0];
    for (let i = 0; i < plans.length; i++) {
      const shard = i % 2;
      const size = plans[i]!.seats.length;
      merged.push(...shards[shard]!.slice(cursor[shard]!, cursor[shard]! + size));
      cursor[shard]! += size;
    }
    expect(merged).toEqual(whole);
  });

  it('scores a duel to the builder that won it, whichever seat it sat in', () => {
    // SEATS 0 AND 2, which is where `seatsForArmies` puts a duel - opposite
    // spokes, not adjacent ones. This test used to say 0 and 1 and passed
    // while the real thing matched nothing and printed an empty matchup table.
    const [first, second] = seatsForArmies(2) as [number, number];
    const records: FightRecord[] = [
      // Two fights: the same pairing at both seatings, `a` winning both.
      row({ pairKey: 'x|y', seat: first, builderId: 'x', won: true, placement: 1 }),
      row({ pairKey: 'x|y', seat: second, builderId: 'y', won: false, placement: 2 }),
      row({ pairKey: 'x|y', seat: first, builderId: 'y', won: false, placement: 2 }),
      row({ pairKey: 'x|y', seat: second, builderId: 'x', won: true, placement: 1 }),
    ];
    const report = summarise(data, records);
    const duel = report.duels.find((d) => d.a === 'x')!;
    expect(duel.fights).toBe(2);
    expect(duel.aWinRate).toBe(1);
    expect(report.duelBuilders.find((t) => t.key === 'x')!.winRate).toBe(1);
    expect(report.duelBuilders.find((t) => t.key === 'y')!.winRate).toBe(0);
  });

  it('pairs a duel by fight, not by seat number', () => {
    // The pairing walks a fight at a time using the seat count each record
    // carries. Seats it has never heard of - a future arena with six spokes,
    // say - must still pair.
    const records: FightRecord[] = [
      row({ pairKey: 'x|y', seat: 4, builderId: 'x', won: true, placement: 1 }),
      row({ pairKey: 'x|y', seat: 9, builderId: 'y', won: false, placement: 2 }),
    ];
    const report = summarise(data, records);
    expect(report.duels).toHaveLength(1);
    expect(report.duels[0]!.fights).toBe(1);
    expect(report.duels[0]!.aWinRate).toBe(1);
  });

  it('counts a fight once, not once per seat', () => {
    const records: FightRecord[] = [0, 1, 2, 3].map((seat) =>
      row({
        kind: 'ffa',
        seat,
        builderId: `b${seat}`,
        won: seat === 0,
        placement: seat + 1,
        seats: 4,
      }),
    );
    expect(summarise(data, records).fights).toBe(1);
  });

  it('quotes an error that shrinks with the square root of the sample', () => {
    expect(standardError(0.5, 100)).toBeCloseTo(0.05, 6);
    expect(standardError(0.5, 400)).toBeCloseTo(0.025, 6);
    expect(standardError(0.5, 0)).toBe(0);
  });
});

function row(over: Partial<FightRecord>): FightRecord {
  return {
    kind: 'duel',
    seat: 0,
    builderId: 'x',
    specId: 'design',
    won: false,
    placement: 2,
    survivingSupply: 0,
    seats: 2,
    ticks: 100,
    timedOut: false,
    ...over,
  };
}

/**
 * What the Final Showdown setup screen puts on a card. Here rather than beside
 * the screen because neither needs Pixi, and a helper that decides what a
 * number says is worth a test whichever file it lives next to.
 */
describe('reading a build back', () => {
  it('normalises shares to a hundred, however they were typed', () => {
    expect(sharesLabel([1, 1, 1, 1, 1, 1])).toBe('17/17/17/17/17/17');
    expect(sharesLabel([0.1, 0.1, 0.15, 0.15, 0.25, 0.25])).toBe('10/10/15/15/25/25');
    expect(sharesLabel([2, 0, 0, 0, 0, 0])).toBe('100/0/0/0/0/0');
    expect(sharesLabel([0, 0, 0, 0, 0, 0])).toBe('nothing');
  });

  it('names the line at each rung', () => {
    for (const builder of data.units.builders) {
      const names = lineNames(data, builder.id);
      expect(names, builder.id).toHaveLength(6);
      expect(
        names.every((n) => n.length > 0),
        builder.id,
      ).toBe(true);
      expect(new Set(names).size, `${builder.id} has a repeated name`).toBe(6);
    }
    expect(lineNames(data, 'ironvow')[0]).toBe('Pledge');
    // A builder that does not exist gets six blanks, not a shifted list.
    expect(lineNames(data, 'nobody')).toEqual(['', '', '', '', '', '']);
  });
});

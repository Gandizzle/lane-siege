/**
 * Selling a unit back. DESIGN.md §11, decided (the document does not cover it).
 *
 * The rule is a refund rate applied PER PURCHASE, not per unit: gold spent in
 * the build phase now in progress comes back whole, gold spent in any earlier
 * one comes back at a discount. That is what makes the full rate an undo
 * button - a unit built by mistake, and an upgrade bought by mistake on a unit
 * that has stood there for ten waves, are both taken back at what they cost.
 *
 * Supply is not gold and does not follow the rate: it is a slot the unit
 * occupies, so it comes back whole whenever the unit goes.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, sellValue, step } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

/** A lane with money, so a rejection is never about affording something. */
function rich(): { state: MatchState; ctx: SimContext } {
  const state = createMatch(data, { seed: 3, teams: [{ id: 'l1', playerIds: ['p'] }] });
  const ctx = createContext(data);
  const lane = state.lanes.l1!;
  lane.economy.gold = 10_000;
  lane.economy.supplyCap = 999;
  return { state, ctx };
}

function place(ctx: SimContext, state: MatchState, unitDefId: string, tileX = 1, tileY = 1) {
  const result = applyCommand(ctx, state, {
    kind: 'placeUnit',
    teamId: 'l1',
    unitDefId,
    tileX,
    tileY,
  });
  expect(result.ok).toBe(true);
  return state.lanes.l1!.units[state.lanes.l1!.units.length - 1]!;
}

/** Run the simulation until the NEXT build phase opens. */
function nextBuildPhase(ctx: SimContext, state: MatchState): void {
  let guard = 0;
  while (state.phase !== 'combat' && guard++ < 20_000) step(ctx, state);
  guard = 0;
  while (state.phase !== 'build' && guard++ < 40_000) step(ctx, state);
  expect(state.phase).toBe('build');
}

const HAMMER_GOLD = data.units.units.find((u) => u.id === 'hammer')!.goldCost!;
const HAMMER_SUPPLY = data.units.units.find((u) => u.id === 'hammer')!.supplyCost!;
const HAMMER_2_GOLD = data.units.units.find((u) => u.id === 'hammer_2')!.goldCost!;

describe('selling in the phase that bought it is an undo (§11)', () => {
  it('returns every gold piece the unit cost', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const before = lane.economy.gold;

    const unit = place(ctx, state, 'hammer');
    expect(lane.economy.gold).toBe(before - HAMMER_GOLD);

    expect(applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id }).ok).toBe(
      true,
    );
    expect(lane.economy.gold).toBe(before);
  });

  it('returns an upgrade bought in the same phase as well', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const before = lane.economy.gold;

    const unit = place(ctx, state, 'hammer');
    expect(
      applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'l1', unitId: unit.id }).ok,
    ).toBe(true);
    expect(lane.economy.gold).toBe(before - HAMMER_GOLD - HAMMER_2_GOLD);

    applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id });
    expect(lane.economy.gold).toBe(before);
  });

  it('gives the supply back whole', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const before = lane.economy.supplyUsed;

    const unit = place(ctx, state, 'hammer');
    expect(lane.economy.supplyUsed).toBe(before + HAMMER_SUPPLY);

    applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id });
    expect(lane.economy.supplyUsed).toBe(before);
  });

  it('frees the tile it was standing on', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    const unit = place(ctx, state, 'hammer', 3, 3);
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'bulwark',
        tileX: 3,
        tileY: 3,
      }).ok,
    ).toBe(false);

    applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id });
    expect(lane.units).toHaveLength(0);
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'bulwark',
        tileX: 3,
        tileY: 3,
      }).ok,
    ).toBe(true);
  });
});

describe('selling later costs something (§11)', () => {
  it('returns the discounted rate once a new build phase has opened', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    const unit = place(ctx, state, 'hammer', 4, 4);
    nextBuildPhase(ctx, state);

    const before = lane.economy.gold;
    applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id });

    const rate = data.economy.sell.later!;
    expect(lane.economy.gold - before).toBe(Math.floor(HAMMER_GOLD * rate));
    expect(rate).toBeLessThan(1);
  });

  it('still refunds a FRESH upgrade on an old body in full', () => {
    // The point of pricing per purchase. A player who mis-taps Upgrade on a
    // veteran should be able to take that back, even though the body under it
    // is long since sunk cost.
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    const unit = place(ctx, state, 'hammer', 5, 5);
    nextBuildPhase(ctx, state);
    applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'l1', unitId: unit.id });

    const before = lane.economy.gold;
    applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id });

    const rate = data.economy.sell.later!;
    expect(lane.economy.gold - before).toBe(Math.floor(HAMMER_GOLD * rate + HAMMER_2_GOLD * 1));
  });

  it('rolls this phase into earlier once, not on every tick', () => {
    const { state, ctx } = rich();
    const unit = place(ctx, state, 'hammer', 6, 2);
    expect(unit.spend).toEqual({ thisPhase: HAMMER_GOLD, earlier: 0 });

    nextBuildPhase(ctx, state);
    expect(unit.spend).toEqual({ thisPhase: 0, earlier: HAMMER_GOLD });

    for (let i = 0; i < 20; i++) step(ctx, state);
    expect(unit.spend).toEqual({ thisPhase: 0, earlier: HAMMER_GOLD });
  });
});

describe('a sold unit is gone, not dead', () => {
  it('does not come back at the next build phase the way a casualty does', () => {
    // §5.4: losses respawn. A sale is not a loss, and a unit that walked back
    // onto its tile with the gold already refunded would be free money.
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    const unit = place(ctx, state, 'hammer', 2, 6);
    applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id });
    expect(lane.units).toHaveLength(0);

    nextBuildPhase(ctx, state);
    expect(lane.units).toHaveLength(0);
  });
});

describe('when selling is closed', () => {
  it('refuses during combat', () => {
    const { state, ctx } = rich();
    const unit = place(ctx, state, 'hammer', 2, 2);

    let guard = 0;
    while (state.phase !== 'combat' && guard++ < 20_000) step(ctx, state);

    expect(applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id })).toEqual({
      ok: false,
      rejection: 'not-build-phase',
    });
  });

  it('refuses once the showdown begins, like every other transaction (§3.3, replaced)', () => {
    const { state, ctx } = rich();
    const unit = place(ctx, state, 'hammer', 2, 3);
    state.phase = 'showdown';

    expect(applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id })).toEqual({
      ok: false,
      rejection: 'building-closed',
    });
  });

  it('refuses a unit that is not there', () => {
    const { state, ctx } = rich();
    expect(applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: 4242 })).toEqual({
      ok: false,
      rejection: 'no-such-unit',
    });
  });
});

describe('the price on the button is the price the command pays', () => {
  it('is the same function on both sides of the wire', () => {
    // The panel prices a sale from the two raw numbers in the view. If this
    // ever needed a second implementation, the two would drift.
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    const unit = place(ctx, state, 'hammer', 1, 5);
    nextBuildPhase(ctx, state);
    applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'l1', unitId: unit.id });

    const quoted = sellValue(data, unit.spend);
    const before = lane.economy.gold;
    applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId: unit.id });
    expect(lane.economy.gold - before).toBe(quoted);
  });

  it('quotes nothing for a unit nobody paid for', () => {
    expect(sellValue(data, { thisPhase: 0, earlier: 0 })).toBe(0);
  });
});

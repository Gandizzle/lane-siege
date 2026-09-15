/**
 * Commands, costs and the economy. DESIGN.md §7.3, §11.1, §11.4, §3.3.
 *
 * Every one of these checks lives inside the simulation, never in the UI, so
 * these tests are also the contract the server enforces against a lying client.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand } from './apply.ts';
import { createContext, createMatch, secondsToTicks, step } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

function freshMatch(): { state: MatchState; ctx: SimContext } {
  return {
    state: createMatch(data, { seed: 1, teams: [{ id: 'lane1', playerIds: ['p1'] }] }),
    ctx: createContext(data),
  };
}

const hammer = data.units.units.find((u) => u.id === 'hammer')!;

/** Step until the given phase. A function call, so TS does not narrow `phase`. */
function runToPhase(ctx: SimContext, state: MatchState, phase: 'build' | 'combat'): void {
  let guard = 0;
  while (state.phase !== phase && guard++ < 10000) step(ctx, state);
}

describe('placing units (§11.4)', () => {
  let state: MatchState;
  let ctx: SimContext;

  beforeEach(() => {
    ({ state, ctx } = freshMatch());
  });

  it('charges gold and supply', () => {
    const goldBefore = state.lanes.lane1!.economy.gold;

    const result = applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'hammer',
      tileX: 3,
      tileY: 3,
    });

    expect(result.ok).toBe(true);
    expect(state.lanes.lane1!.economy.gold).toBe(goldBefore - hammer.goldCost!);
    expect(state.lanes.lane1!.economy.supplyUsed).toBe(hammer.supplyCost!);
    expect(state.lanes.lane1!.units).toHaveLength(1);
  });

  it('refuses a tile that is already taken', () => {
    const place = () =>
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'lane1',
        unitDefId: 'hammer',
        tileX: 3,
        tileY: 3,
      });

    expect(place().ok).toBe(true);
    expect(place()).toEqual({ ok: false, rejection: 'tile-occupied' });
  });

  it('refuses a tile off the grid', () => {
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'lane1',
        unitDefId: 'hammer',
        tileX: 99,
        tileY: 3,
      }),
    ).toEqual({ ok: false, rejection: 'tile-out-of-bounds' });
  });

  it('refuses when gold runs out', () => {
    state.lanes.lane1!.economy.gold = 0;
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'lane1',
        unitDefId: 'hammer',
        tileX: 1,
        tileY: 1,
      }),
    ).toEqual({ ok: false, rejection: 'insufficient-gold' });
  });

  it('refuses when supply runs out, even with gold to spare', () => {
    // §11.4: supply is a hard cap and does not grow on its own. This is the
    // check that makes a large army a deliberate investment.
    state.lanes.lane1!.economy.gold = 99999;
    state.lanes.lane1!.economy.supplyUsed = state.lanes.lane1!.economy.supplyCap;

    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'lane1',
        unitDefId: 'hammer',
        tileX: 1,
        tileY: 1,
      }),
    ).toEqual({ ok: false, rejection: 'insufficient-supply' });
  });

  it('refuses outside the build phase (§3.1)', () => {
    state.phase = 'combat';
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'lane1',
        unitDefId: 'hammer',
        tileX: 1,
        tileY: 1,
      }),
    ).toEqual({ ok: false, rejection: 'not-build-phase' });
  });

  it('refuses from wave 25 onward (§3.3)', () => {
    // The attrition endgame closes construction; gold keeps accumulating.
    state.wave = data.waves.attritionStartWave;
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'lane1',
        unitDefId: 'hammer',
        tileX: 1,
        tileY: 1,
      }),
    ).toEqual({ ok: false, rejection: 'building-closed' });
  });

  it('blocks the tile for monsters once built (§4.2)', () => {
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'hammer',
      tileX: 3,
      tileY: 3,
    });
    step(ctx, state);
    const built = state.lanes.lane1!.units[0]!;
    expect(Math.floor(built.pos.x)).toBe(3);
    expect(Math.floor(built.pos.y)).toBe(3);
  });
});

describe('tier upgrades (§7.3)', () => {
  it('upgrades in place, keeping the tile and the identity', () => {
    const { state, ctx } = freshMatch();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'hammer',
      tileX: 2,
      tileY: 2,
    });

    const unit = state.lanes.lane1!.units[0]!;
    const { id } = unit;
    const tileX = Math.floor(unit.pos.x);
    const tileY = Math.floor(unit.pos.y);

    expect(applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'lane1', unitId: id }).ok).toBe(
      true,
    );

    expect(unit.id).toBe(id);
    expect(Math.floor(unit.pos.x)).toBe(tileX);
    expect(Math.floor(unit.pos.y)).toBe(tileY);
    expect(unit.defId).toBe('hammer_2');
    expect(state.lanes.lane1!.units).toHaveLength(1);
  });

  it('is more gold-efficient than building new', () => {
    // §7.3 target: about 1.6x cost for about 2.2x value.
    const t1 = data.units.units.find((u) => u.id === 'hammer')!;
    const t2 = data.units.units.find((u) => u.id === 'hammer_2')!;
    const costRatio = t2.goldCost! / t1.goldCost!;
    const valueRatio = t2.hp! / t1.hp!;
    expect(valueRatio).toBeGreaterThan(costRatio);
  });

  it('refuses at max tier', () => {
    // Bulwark tops out at tier 2; Hammer goes to 3 (§7.3 - only some units do).
    const { state, ctx } = freshMatch();
    state.lanes.lane1!.economy.gold = 99999;
    state.lanes.lane1!.economy.supplyCap = 999;

    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'bulwark',
      tileX: 2,
      tileY: 2,
    });
    const id = state.lanes.lane1!.units[0]!.id;

    expect(applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'lane1', unitId: id }).ok).toBe(
      true,
    );
    expect(applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'lane1', unitId: id })).toEqual({
      ok: false,
      rejection: 'max-tier',
    });
  });

  it('allows a third tier where the unit has one (§7.3)', () => {
    const { state, ctx } = freshMatch();
    state.lanes.lane1!.economy.gold = 99999;
    state.lanes.lane1!.economy.supplyCap = 999;

    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'hammer',
      tileX: 2,
      tileY: 2,
    });
    const unit = state.lanes.lane1!.units[0]!;

    applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'lane1', unitId: unit.id });
    applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'lane1', unitId: unit.id });
    expect(unit.defId).toBe('hammer_3');
  });
});

describe('gold flow (§11.1)', () => {
  it('pays the defender a bounty for every kill', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;

    // Run into combat, then kill everything outright.
    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    const goldBefore = lane.economy.gold;
    const expected = lane.monsters.reduce((sum, m) => sum + m.bounty, 0);
    expect(lane.monsters.length).toBeGreaterThan(0);

    for (const monster of lane.monsters) monster.hp = 0;
    step(ctx, state);

    expect(lane.economy.gold).toBe(goldBefore + expected);
  });

  it('pays gems on its own clock, not once a wave (§10.2, amended)', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;
    expect(lane.economy.gems).toBe(0);

    const interval = lane.fortress.gemPayoutTicks;
    const perPayout = lane.fortress.gemsPerPayout;
    expect(interval).toBe(secondsToTicks(data.fortress.resourceBuilding.payoutSeconds ?? 0));

    // One tick short of the first payout, then the tick that pays it.
    for (let t = 0; t < interval - 1; t++) step(ctx, state);
    expect(lane.economy.gems).toBe(0);
    step(ctx, state);
    expect(lane.economy.gems).toBe(perPayout);

    // And it keeps going, at the same spacing, without waiting for a wave.
    for (let t = 0; t < interval * 3; t++) step(ctx, state);
    expect(lane.economy.gems).toBe(perPayout * 4);
  });
});

describe('the fortress weapon type (§10.1)', () => {
  it('is free and instant during the build phase', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;
    const goldBefore = lane.economy.gold;

    expect(
      applyCommand(ctx, state, {
        kind: 'setWeaponType',
        teamId: 'lane1',
        damageType: 'blast',
      }),
    ).toEqual({ ok: true });

    expect(lane.fortress.weaponDamageType).toBe('blast');
    expect(lane.economy.gold).toBe(goldBefore);
  });

  it('cannot be switched mid-combat', () => {
    const { state, ctx } = freshMatch();
    state.phase = 'combat';
    expect(
      applyCommand(ctx, state, { kind: 'setWeaponType', teamId: 'lane1', damageType: 'arcane' }),
    ).toEqual({ ok: false, rejection: 'not-build-phase' });
  });
});

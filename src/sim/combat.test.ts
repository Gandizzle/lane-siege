/**
 * Wave lifecycle behaviour. DESIGN.md §5.4, §5.5, §3.2, §3.3, §8.1.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand } from './apply.ts';
import { countLiving, createContext, createMatch, step } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

function freshMatch(players = 1): { state: MatchState; ctx: SimContext } {
  const teams = Array.from({ length: players }, (_, i) => ({
    id: `lane${i + 1}`,
    playerIds: [`p${i + 1}`],
  }));
  return { state: createMatch(data, { seed: 1, teams }), ctx: createContext(data) };
}

function runToPhase(ctx: SimContext, state: MatchState, phase: 'build' | 'combat'): void {
  let guard = 0;
  while (state.phase !== phase && guard++ < 10000) step(ctx, state);
}

describe('unit respawn (§5.4)', () => {
  it('restores dead units at the start of the next build phase', () => {
    const { state, ctx } = freshMatch();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'hammer',
      tileX: 3,
      tileY: 3,
    });

    const unit = state.lanes.lane1!.units[0]!;
    runToPhase(ctx, state, 'combat');

    unit.hp = 0;
    step(ctx, state);
    expect(unit.alive).toBe(false);

    runToPhase(ctx, state, 'build');

    // Losing the line is a temporary setback; the punishment is the leak damage,
    // not the loss of the investment.
    expect(unit.alive).toBe(true);
    expect(unit.hp).toBe(unit.maxHp);
  });

  it('tops up survivors too', () => {
    const { state, ctx } = freshMatch();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'hammer',
      tileX: 3,
      tileY: 3,
    });
    const unit = state.lanes.lane1!.units[0]!;

    runToPhase(ctx, state, 'combat');
    unit.hp = 1;
    runToPhase(ctx, state, 'build');
    expect(unit.hp).toBe(unit.maxHp);
  });

  it('stops from wave 25, where losses become permanent (§3.3)', () => {
    const { state, ctx } = freshMatch();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: 'hammer',
      tileX: 3,
      tileY: 3,
    });
    const unit = state.lanes.lane1!.units[0]!;

    state.wave = data.waves.attritionStartWave;
    unit.alive = false;
    unit.hp = 0;

    runToPhase(ctx, state, 'combat');
    runToPhase(ctx, state, 'build');

    expect(unit.alive).toBe(false);
  });
});

describe('fortress regeneration (§5.5)', () => {
  it('heals when the lane goes fully clear', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;

    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    lane.fortress.hp = lane.fortress.maxHp - 500;
    const before = lane.fortress.hp;

    for (const monster of lane.monsters) monster.hp = 0;
    step(ctx, state);

    // Chip damage is not permanent - that is what stops a small leak from
    // compounding into a death spiral.
    expect(lane.fortress.hp).toBeGreaterThan(before);
    expect(lane.fortress.hp).toBe(before + data.fortress.regenOnLaneClear.base!);
  });

  it('never heals past maximum', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;

    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    lane.fortress.hp = lane.fortress.maxHp - 1;
    for (const monster of lane.monsters) monster.hp = 0;
    step(ctx, state);

    expect(lane.fortress.hp).toBe(lane.fortress.maxHp);
  });
});

describe('the global wave clock (§3.2)', () => {
  it('spawns the next wave whether or not the lane cleared the last one', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;

    // No units built at all, so nothing dies and wave 1 is still alive.
    runToPhase(ctx, state, 'combat');
    step(ctx, state);
    const afterWave1 = countLiving(lane);
    expect(afterWave1).toBeGreaterThan(0);

    runToPhase(ctx, state, 'build');
    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    expect(state.wave).toBe(2);
    expect(countLiving(lane)).toBeGreaterThan(afterWave1);
  });

  it('runs a 30s build phase inside a 75s cycle', () => {
    const { state, ctx } = freshMatch();
    runToPhase(ctx, state, 'combat');
    const combatStart = state.tick;

    runToPhase(ctx, state, 'build');
    runToPhase(ctx, state, 'combat');

    const cycle = (state.tick - combatStart) / 20;
    expect(cycle).toBeCloseTo(data.waves.waveIntervalSeconds!, 0);
  });
});

describe('the reserve queue (§8.1)', () => {
  it('holds monsters beyond the lane cap and feeds them in as others die', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;
    const cap = data.waves.maxConcurrentMonsters;

    // This lane builds nothing, so give it an indestructible fortress: a match
    // that ends mid-test would freeze the tick loop and prove nothing.
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    lane.fortress.hp = lane.fortress.maxHp;

    // Wave 5 is authored well over the cap, so the next transition overflows.
    state.wave = 4;
    runToPhase(ctx, state, 'combat');

    expect(state.wave).toBe(5);
    expect(countLiving(lane)).toBe(cap);
    expect(lane.reserve.length).toBeGreaterThan(0);

    const heldBack = lane.reserve.length;
    for (const monster of lane.monsters.filter((m) => m.alive).slice(0, 3)) monster.hp = 0;
    step(ctx, state);

    // The freed slots are refilled one for one, and the cap still holds.
    expect(lane.reserve.length).toBe(heldBack - 3);
    expect(countLiving(lane)).toBe(cap);
  });
});

describe('elimination (§13)', () => {
  it('gives simultaneous deaths distinct placements', () => {
    const { state, ctx } = freshMatch(4);

    state.lanes.lane1!.fortress.hp = 0;
    state.lanes.lane2!.fortress.hp = 0;
    step(ctx, state);

    const placements = state.teams
      .filter((t) => t.eliminated)
      .map((t) => t.placement)
      .sort();

    expect(placements).toHaveLength(2);
    expect(new Set(placements).size).toBe(2);
  });

  it('ends the match when one team remains', () => {
    const { state, ctx } = freshMatch(2);
    state.lanes.lane1!.fortress.hp = 0;
    step(ctx, state);
    expect(state.finished).toBe(true);
  });

  it('does not end a solo lane that is still standing', () => {
    const { state, ctx } = freshMatch(1);
    step(ctx, state);
    expect(state.finished).toBe(false);
  });
});

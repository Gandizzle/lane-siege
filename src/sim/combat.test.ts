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

describe('fortress regeneration (§5.5, amended)', () => {
  it('does not heal by default — self-healing is an upgrade, not a freebie', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;

    expect(lane.fortress.regenPerClear).toBe(0);

    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    lane.fortress.hp = lane.fortress.maxHp - 500;
    const before = lane.fortress.hp;

    for (const monster of lane.monsters) monster.hp = 0;
    step(ctx, state);

    // Chip damage is permanent until the upgrade is bought.
    expect(lane.fortress.hp).toBe(before);
  });

  it('heals on a full lane clear once the upgrade is bought', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;

    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    // Stand in for the fortress upgrade that M3 will sell.
    lane.fortress.regenPerClear = 40;
    lane.fortress.hp = lane.fortress.maxHp - 500;
    const before = lane.fortress.hp;

    for (const monster of lane.monsters) monster.hp = 0;
    step(ctx, state);

    expect(lane.fortress.hp).toBe(before + 40);
  });

  it('never heals past maximum', () => {
    const { state, ctx } = freshMatch();
    const lane = state.lanes.lane1!;

    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    lane.fortress.regenPerClear = 40;
    lane.fortress.hp = lane.fortress.maxHp - 1;

    for (const monster of lane.monsters) monster.hp = 0;
    step(ctx, state);

    expect(lane.fortress.hp).toBe(lane.fortress.maxHp);
  });
});

describe('phase clock (§3.2, amended)', () => {
  it('runs a 30 second build phase', () => {
    const { state, ctx } = freshMatch();
    expect(state.phase).toBe('build');

    const start = state.tick;
    runToPhase(ctx, state, 'combat');

    // 600 ticks counting the phase down, plus the tick that performs the
    // transition itself.
    const expected = data.waves.buildPhaseSeconds * 20 + 1;
    expect(state.tick - start).toBe(expected);
  });

  it('keeps combat running as long as any monster is alive', () => {
    // No global spawn clock any more: combat has no duration of its own.
    const armed = structuredClone(data);
    armed.fortress.weapon.damage = 0;

    const state = createMatch(armed, { seed: 1, teams: [{ id: 'lane1', playerIds: ['p1'] }] });
    const ctx = createContext(armed);
    state.lanes.lane1!.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    state.lanes.lane1!.fortress.hp = state.lanes.lane1!.fortress.maxHp;

    runToPhase(ctx, state, 'combat');
    // Far longer than the old 45s combat phase.
    for (let i = 0; i < 20 * 200; i++) step(ctx, state);

    expect(state.phase).toBe('combat');
    expect(state.wave).toBe(1);
  });

  it('never lands a second wave on an unfinished one', () => {
    // This is the whole point of dropping the global clock: the build cycle is
    // no longer interrupted by a wave arriving on top of the last one.
    const armed = structuredClone(data);
    armed.fortress.weapon.damage = 0;

    const state = createMatch(armed, { seed: 1, teams: [{ id: 'lane1', playerIds: ['p1'] }] });
    const ctx = createContext(armed);
    const lane = state.lanes.lane1!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    lane.fortress.hp = lane.fortress.maxHp;

    runToPhase(ctx, state, 'combat');
    for (let i = 0; i < 20 * 200; i++) step(ctx, state);

    const waves = new Set(lane.monsters.filter((m) => m.alive).map((m) => m.waveNumber));
    expect([...waves]).toEqual([1]);
  });

  it('returns to build as soon as every lane is clear', () => {
    const { state, ctx } = freshMatch();

    runToPhase(ctx, state, 'combat');
    step(ctx, state);
    for (const monster of state.lanes.lane1!.monsters) monster.hp = 0;

    step(ctx, state);
    step(ctx, state);

    expect(state.phase).toBe('build');
  });

  it('does not end combat while another lane is still fighting', () => {
    const { state, ctx } = freshMatch(2);

    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    for (const monster of state.lanes.lane1!.monsters) monster.hp = 0;
    state.lanes.lane2!.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    state.lanes.lane2!.fortress.hp = state.lanes.lane2!.fortress.maxHp;
    step(ctx, state);

    expect(state.phase).toBe('combat');
  });

  it('does not mistake the opening build phase for a cleared lane', () => {
    const { state, ctx } = freshMatch();
    expect(state.wave).toBe(0);
    step(ctx, state);
    expect(state.phase).toBe('build');
    expect(state.phaseTicksLeft).toBeGreaterThan(100);
  });
});

describe('elimination wipes a lane (§13, amended)', () => {
  it("clears the dead player's monsters and stops spawning there", () => {
    const { state, ctx } = freshMatch(2);
    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    const dead = state.lanes.lane1!;
    expect(dead.monsters.length).toBeGreaterThan(0);

    dead.fortress.hp = 0;
    step(ctx, state);

    expect(state.teams.find((t) => t.id === 'lane1')!.eliminated).toBe(true);
    expect(dead.monsters).toHaveLength(0);
    expect(dead.reserve).toHaveLength(0);

    // And the next wave skips that lane entirely.
    state.lanes.lane2!.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    state.lanes.lane2!.fortress.hp = state.lanes.lane2!.fortress.maxHp;
    for (const monster of state.lanes.lane2!.monsters) monster.hp = 0;
    runToPhase(ctx, state, 'build');
    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    expect(dead.monsters).toHaveLength(0);
  });

  it('lets the match finish rather than stalling on a dead lane', () => {
    // A wiped lane must not count as "still fighting", or combat could never end.
    const { state, ctx } = freshMatch(2);
    runToPhase(ctx, state, 'combat');
    step(ctx, state);

    state.lanes.lane1!.fortress.hp = 0;
    step(ctx, state);
    for (const monster of state.lanes.lane2!.monsters) monster.hp = 0;
    step(ctx, state);
    step(ctx, state);

    expect(state.finished).toBe(true);
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

    // Wave 22 is authored well over the 30-monster cap, so it overflows.
    state.wave = 21;
    runToPhase(ctx, state, 'combat');

    expect(state.wave).toBe(22);
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

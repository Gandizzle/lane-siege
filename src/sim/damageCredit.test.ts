/**
 * The round's damage scoreboard. DESIGN.md §14.1, added.
 *
 * These pin the two things a player will notice if they break: that the number
 * beside a unit is the damage that unit really did, and that the numbers from
 * the wave just fought are still there to read during the build phase after it.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand } from './apply.ts';
import { createContext, createMatch, step, viewFor } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

function freshMatch(): { state: MatchState; ctx: SimContext } {
  return {
    state: createMatch(data, { seed: 7, teams: [{ id: 'lane1', playerIds: ['p1'] }] }),
    ctx: createContext(data),
  };
}

function runToPhase(ctx: SimContext, state: MatchState, phase: 'build' | 'combat'): void {
  let guard = 0;
  while (state.phase !== phase && guard++ < 20000) step(ctx, state);
}

/** A line across the lane, so a wave cannot walk past without being hit. */
function buildLine(ctx: SimContext, state: MatchState, defId = 'pledge'): void {
  state.lanes.lane1!.economy.gold = 99999;
  state.lanes.lane1!.economy.supplyCap = 999;
  for (let x = 0; x < data.lane.buildZone.width; x++) {
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane1',
      unitDefId: defId,
      tileX: x,
      tileY: 3,
    });
  }
}

/**
 * Cuts the lane down to one unit and one monster, so a blow lands with nobody
 * else's swing mixed into the same tick. Returns the pair, both still in their
 * lane's own arrays.
 */
function duel(ctx: SimContext, state: MatchState) {
  const lane = state.lanes.lane1!;
  runToPhase(ctx, state, 'combat');

  const unit = lane.units[Math.floor(lane.units.length / 2)]!;
  for (const other of lane.units) if (other !== unit) other.alive = false;
  for (const monster of lane.monsters.slice(1)) monster.hp = 0;
  lane.reserve.length = 0;
  step(ctx, state);

  const monster = lane.monsters[0]!;
  // Walk them together. The monster steers at the fortress and the unit at the
  // monster, so this terminates well inside the guard.
  let guard = 0;
  while (!unit.engaged && guard++ < 2000) step(ctx, state);

  return { lane, unit, monster };
}

describe('what a unit is credited with (§14.1, added)', () => {
  it('counts exactly what the monster lost', () => {
    const { state, ctx } = freshMatch();
    buildLine(ctx, state);
    const { unit, monster } = duel(ctx, state);

    expect(unit.engaged).toBe(true);
    expect(unit.targetId).toBe(monster.id);

    // Let one blow land, with plenty of HP under it so nothing is wasted.
    monster.hp = monster.maxHp;
    unit.cooldown = 0;
    const creditedBefore = unit.damageDealt;
    const hpBefore = monster.hp;
    step(ctx, state);

    const credited = unit.damageDealt - creditedBefore;
    expect(credited).toBeGreaterThan(0);
    // The credit and the wound are the same subtraction. They cannot drift.
    expect(credited).toBeCloseTo(hpBefore - monster.hp, 6);
  });

  it('does not credit overkill', () => {
    const { state, ctx } = freshMatch();
    buildLine(ctx, state);
    const { unit, monster } = duel(ctx, state);

    // A sliver of HP under a full-weight blow: a unit that killed something
    // with 1 HP left did 1 damage, however hard it swung.
    monster.hp = 1;
    unit.cooldown = 0;
    const before = unit.damageDealt;
    step(ctx, state);

    expect(monster.hp).toBeLessThanOrEqual(0);
    expect(unit.damageDealt - before).toBeCloseTo(1, 6);
  });
});

describe('when the scoreboard clears (§14.1, added)', () => {
  it('keeps the last wave numbers up for the whole build phase', () => {
    const { state, ctx } = freshMatch();
    buildLine(ctx, state);
    const lane = state.lanes.lane1!;

    runToPhase(ctx, state, 'combat');
    runToPhase(ctx, state, 'build');

    const fought = lane.units.reduce((sum, u) => sum + u.damageDealt, 0);
    expect(fought).toBeGreaterThan(0);

    // The build phase is exactly when a player has time to read them, so they
    // survive all of it - including the respawn that puts the line back.
    for (let i = 0; i < state.phaseTicksLeft - 1; i++) step(ctx, state);
    expect(state.phase).toBe('build');
    expect(lane.units.reduce((sum, u) => sum + u.damageDealt, 0)).toBe(fought);
  });

  it('starts again when the next wave spawns', () => {
    const { state, ctx } = freshMatch();
    buildLine(ctx, state);
    const lane = state.lanes.lane1!;

    runToPhase(ctx, state, 'combat');
    runToPhase(ctx, state, 'build');
    expect(lane.units.reduce((sum, u) => sum + u.damageDealt, 0)).toBeGreaterThan(0);

    runToPhase(ctx, state, 'combat');
    // The tick a wave spawns is the tick the board clears, and the wave spawns
    // a lane away from the line, so nothing has landed yet.
    expect(lane.units.reduce((sum, u) => sum + u.damageDealt, 0)).toBe(0);
  });

  it('keeps a unit that died in the fight on the board', () => {
    const { state, ctx } = freshMatch();
    buildLine(ctx, state);
    const lane = state.lanes.lane1!;

    runToPhase(ctx, state, 'combat');
    let guard = 0;
    while (lane.units.every((u) => u.damageDealt === 0) && guard++ < 2000) step(ctx, state);

    const unit = lane.units.find((u) => u.damageDealt > 0)!;
    const earned = unit.damageDealt;
    unit.hp = 0;
    step(ctx, state);
    expect(unit.alive).toBe(false);

    // Dead units are gone from the entity list a viewer draws, so the rows are
    // a list of their own - and the row for a unit that was overrun is exactly
    // the one worth reading.
    const view = viewFor(ctx, state, 'lane1');
    const row = view.lane!.unitDamage.find((r) => r.unitId === unit.id);
    expect(view.lane!.units.some((u) => u.id === unit.id)).toBe(false);
    expect(row?.damage).toBe(earned);
  });
});

describe('who may see a scoreboard (§12)', () => {
  it('is your own lane only, even when an opponent can watch the fight', () => {
    const state = createMatch(data, {
      seed: 3,
      teams: [
        { id: 'lane1', playerIds: ['p1'] },
        { id: 'lane2', playerIds: ['p2'] },
      ],
    });
    const ctx = createContext(data);
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'lane2',
      unitDefId: 'pledge',
      tileX: 3,
      tileY: 3,
    });

    // `always` is the widest fog setting there is; even that does not hand
    // over what somebody else's line is worth.
    const view = viewFor(ctx, state, 'lane1', 'always');
    expect(view.watching.lane2).toBeDefined();
    expect(view.watching.lane2!.unitDamage).toEqual([]);
    expect(view.lane!.unitDamage).toEqual([]);
  });
});

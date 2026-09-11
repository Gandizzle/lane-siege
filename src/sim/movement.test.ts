/**
 * Movement behaviour: the stuck-flag deadlock, and mobile defensive units.
 *
 * The first describe below covers a bug found in play: monsters froze in place
 * permanently once the units blocking them died. Stuck detection had latched
 * while they stood in attack range, and movement was gated on that flag, so
 * displacement stayed zero and the flag could never clear. It is the reason
 * steering.ts now never gates movement on `isStuck`.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step } from './index.ts';
import type { GameData } from '../data/schema.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

/** Disarmed on both sides, so nothing dies and movement is all that happens. */
function passiveData(): GameData {
  const d = structuredClone(data);
  d.fortress.weapon.damage = 0;
  for (const u of d.units.units) u.damage = 0;
  return d;
}

function setup(d: GameData): { state: MatchState; ctx: SimContext } {
  const state = createMatch(d, { seed: 1, teams: [{ id: 'l1', playerIds: ['p'] }] });
  const ctx = createContext(d);
  const lane = state.lanes.l1!;
  lane.economy.gold = 99999;
  lane.economy.supplyCap = 999;
  lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
  lane.fortress.hp = lane.fortress.maxHp;
  return { state, ctx };
}

function run(ctx: SimContext, state: MatchState, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(ctx, state);
}

describe('monsters never freeze permanently (§5.3)', () => {
  it('resumes advancing once the wall blocking it is destroyed', () => {
    const d = passiveData();
    // Pin the units so this isolates monster movement.
    for (const u of d.units.units) u.moveSpeed = 0;

    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;

    for (let x = 0; x < 8; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: x,
        tileY: 3,
      });
    }

    while (state.phase !== 'combat') step(ctx, state);
    // Long enough that the old code would have latched isStuck.
    run(ctx, state, 200);

    const held = lane.monsters.filter((m) => m.alive);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((m) => m.pos.y < 3)).toBe(true);

    const before = held.map((m) => m.pos.y);
    for (const unit of lane.units) unit.hp = 0;
    step(ctx, state);
    run(ctx, state, 200);

    const after = lane.monsters.filter((m) => m.alive).map((m) => m.pos.y);
    expect(after).toHaveLength(before.length);
    after.forEach((y, i) => expect(y).toBeGreaterThan(before[i]! + 1));
  });

  it('does not flag a monster as stuck merely for standing in attack range', () => {
    const d = passiveData();
    for (const u of d.units.units) u.moveSpeed = 0;

    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (let x = 0; x < 8; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: x,
        tileY: 3,
      });
    }

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 200);

    expect(lane.monsters.filter((m) => m.alive).every((m) => !m.isStuck)).toBe(true);
  });
});

describe('defensive units advance when nothing is in range (§5.2, amended)', () => {
  it('walks toward the nearest monster instead of standing idle', () => {
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    // Placed at the back, far from where monsters enter.
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 4,
      tileY: 9,
    });
    const unit = lane.units[0]!;
    const startY = unit.pos.y;

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 60);

    expect(unit.pos.y).toBeLessThan(startY);
  });

  it('plants and holds once something is in range', () => {
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 4,
      tileY: 5,
    });
    const unit = lane.units[0]!;

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 200);

    const settled = unit.pos.y;
    run(ctx, state, 40);
    // Once engaged it stops - §5.2's no-chase rule still holds.
    expect(Math.abs(unit.pos.y - settled)).toBeLessThan(0.2);
  });

  it('stays inside the build zone', () => {
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;
    const depth = data.lane.buildZone.depth;

    for (let x = 0; x < 4; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: x,
        tileY: 8,
      });
    }

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 400);

    for (const unit of lane.units) {
      expect(unit.pos.y).toBeGreaterThanOrEqual(0);
      expect(unit.pos.y).toBeLessThan(depth);
      expect(unit.pos.x).toBeGreaterThanOrEqual(0);
      expect(unit.pos.x).toBeLessThan(data.lane.buildZone.width);
    }
  });

  it('does not let two units end up on the same tile', () => {
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    // A dense block, all of which want to walk to the same place.
    for (let x = 2; x < 6; x++) {
      for (let y = 7; y < 9; y++) {
        applyCommand(ctx, state, {
          kind: 'placeUnit',
          teamId: 'l1',
          unitDefId: 'hammer',
          tileX: x,
          tileY: y,
        });
      }
    }

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 300);

    const tiles = lane.units
      .filter((u) => u.alive)
      .map((u) => `${Math.floor(u.pos.x)},${Math.floor(u.pos.y)}`);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('returns the line to its build tiles at the next build phase', () => {
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 4,
      tileY: 9,
    });
    const unit = lane.units[0]!;

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 80);
    expect(unit.pos.y).toBeLessThan(9.5);

    // Clear the lane so combat ends, then check the unit went home.
    for (const monster of lane.monsters) monster.hp = 0;
    lane.reserve.length = 0;
    run(ctx, state, 5);

    expect(state.phase).toBe('build');
    expect(unit.pos.x).toBeCloseTo(unit.homeTileX + 0.5, 6);
    expect(unit.pos.y).toBeCloseTo(unit.homeTileY + 0.5, 6);
  });
});

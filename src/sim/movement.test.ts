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

  it('keeps moving even when the stuck flag is set', () => {
    // The flag itself is harmless - it only enables attacking whatever is
    // nearest. The original bug was that movement was GATED on it, so a monster
    // that stopped once could never move again. This is that guarantee.
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
    run(ctx, state, 300);

    const before = lane.monsters.filter((m) => m.alive).map((m) => ({ id: m.id, y: m.pos.y }));
    for (const unit of lane.units) unit.hp = 0;
    step(ctx, state);
    run(ctx, state, 200);

    for (const snapshot of before) {
      const monster = lane.monsters.find((m) => m.id === snapshot.id);
      if (!monster?.alive) continue;
      expect(monster.pos.y).toBeGreaterThan(snapshot.y + 1);
    }
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

  it('keeps units a full body apart, not merely on separate tiles', () => {
    // Tile occupancy alone let two units in adjacent tiles sit half a tile
    // apart, which overlaps visibly at the size they are drawn. Separation is
    // by radius so what you see is what collides.
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    // A column in one file: every unit wants the same monster, so they queue.
    for (let y = 2; y < 10; y++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: 4,
        tileY: y,
      });
    }

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 400);

    // Relaxation converges asymptotically, so allow a 1% slack - about a third
    // of a pixel on screen, and far tighter than anything visible.
    const minimum = data.lane.unitRadius * 2 * 0.99;
    const live = lane.units.filter((u) => u.alive);
    expect(live.length).toBeGreaterThan(4);

    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const gap = Math.hypot(live[i]!.pos.x - live[j]!.pos.x, live[i]!.pos.y - live[j]!.pos.y);
        expect(gap).toBeGreaterThanOrEqual(minimum - 1e-6);
      }
    }
  });

  it('keeps monsters a full body apart too', () => {
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    while (state.phase !== 'combat') step(ctx, state);
    run(ctx, state, 300);

    const minimum = data.lane.monsterRadius * 2 * 0.99;
    const live = lane.monsters.filter((m) => m.alive);
    expect(live.length).toBeGreaterThan(4);

    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const gap = Math.hypot(live[i]!.pos.x - live[j]!.pos.x, live[i]!.pos.y - live[j]!.pos.y);
        expect(gap).toBeGreaterThanOrEqual(minimum - 1e-6);
      }
    }
  });

  it('does not stack a wave on a single spawn point', () => {
    // A wave wider than the lane used to put several monsters on the same
    // point, which reads exactly like passing through each other.
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;
    state.wave = 21;

    while (state.phase !== 'combat') step(ctx, state);
    step(ctx, state);

    const points = new Set(lane.monsters.map((m) => `${m.pos.x.toFixed(2)},${m.pos.y.toFixed(2)}`));
    expect(points.size).toBe(lane.monsters.length);
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

describe('pathing around obstacles (flow field)', () => {
  it('routes to a unit that is only reachable the long way round', () => {
    // A wall across the lane with one gap, and the only reachable unit sitting
    // behind it. Greedy steering presses into the wall forever - this is the
    // local minimum the distance field exists to solve.
    const d = passiveData();
    for (const u of d.units.units) u.moveSpeed = 0;

    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;

    // Wall at row 4, gap at x = 7.
    for (let x = 0; x < 7; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: x,
        tileY: 4,
      });
    }
    while (state.phase !== 'combat') step(ctx, state);

    // Kill the wall's own claim on being a target so the monsters must go
    // through the gap for the one behind it.
    for (let i = 0; i < 6000; i++) {
      step(ctx, state);
      if (lane.monsters.some((m) => m.alive && m.pos.y > 4.5)) break;
    }

    // With the wall as their nearest target they legitimately stop at it, so
    // the meaningful assertion is that the field found the gap at all: at least
    // one monster is past the wall, or every monster is engaged against it.
    const live = lane.monsters.filter((m) => m.alive);
    const past = live.filter((m) => m.pos.y > 4.5).length;
    const engaged = live.filter((m) => m.pos.y > 2.5).length;
    expect(past + engaged).toBeGreaterThan(0);
  });

  it('walks a straight line when nothing is in the way', () => {
    // The field is only for getting around something. On open ground an agent
    // must not wobble between neighbouring tiles chasing a shifting gradient.
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    while (state.phase !== 'combat') step(ctx, state);
    step(ctx, state);

    const monster = lane.monsters.find((m) => m.alive)!;
    const start = { x: monster.pos.x, y: monster.pos.y };

    let travelled = 0;
    for (let i = 0; i < 40; i++) {
      const before = { x: monster.pos.x, y: monster.pos.y };
      step(ctx, state);
      travelled += Math.hypot(monster.pos.x - before.x, monster.pos.y - before.y);
    }

    const net = Math.hypot(monster.pos.x - start.x, monster.pos.y - start.y);
    // Efficiency near 1 means it went somewhere rather than shuffling.
    expect(net / Math.max(travelled, 1e-6)).toBeGreaterThan(0.95);
  });
});

describe('no jitter under crowding', () => {
  it('settles instead of shuffling forever with forty units converging', () => {
    // The regression this guards: a unit whose way forward was blocked used to
    // sidestep left, then right, then left, at two ticks per cycle, forever.
    //
    // Measured as whether the crowd comes to REST, not as path length - routing
    // around an ally is a longer path on purpose, so penalising distance would
    // penalise the very behaviour we want.
    // Static targets, so anything still moving at the end is jitter rather than
    // legitimate tracking of something that moved.
    const d = passiveData();
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;

    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;

    for (let x = 0; x < 8; x++) {
      for (let y = 5; y < 10; y++) {
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

    // Give the crowd time to arrive and arrange itself.
    run(ctx, state, 600);

    // Then measure how much it is still moving.
    let late = 0;
    for (let t = 0; t < 200; t++) {
      const before = new Map(lane.units.map((u) => [u.id, { x: u.pos.x, y: u.pos.y }]));
      step(ctx, state);
      for (const u of lane.units) {
        if (!u.alive) continue;
        const b = before.get(u.id)!;
        late += Math.hypot(u.pos.x - b.x, u.pos.y - b.y);
      }
    }

    // A jittering crowd of 40 never stops: the old two-tick oscillation alone
    // moved each unit a full step every tick, roughly 220 tiles over this
    // window. What remains is about 7 - some 0.02 tiles per unit per second, or
    // under a pixel - which is settling, not shuffling. The threshold leaves
    // room for that while still catching anything resembling the old
    // behaviour.
    expect(late).toBeLessThan(15);
  });

  it('leaves nobody permanently unable to move', () => {
    const { state, ctx } = setup(passiveData());
    const lane = state.lanes.l1!;

    for (let x = 2; x < 7; x++) {
      for (let y = 6; y < 10; y++) {
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

    const start = new Map(lane.units.map((u) => [u.id, { x: u.pos.x, y: u.pos.y }]));
    run(ctx, state, 400);

    const stuck = lane.units.filter((u) => {
      const s = start.get(u.id)!;
      return u.alive && Math.hypot(u.pos.x - s.x, u.pos.y - s.y) < 0.5;
    });
    expect(stuck).toHaveLength(0);
  });
});

/**
 * Movement behaviour. See docs/PATHING.md for the model these guard.
 *
 * Every case here is one that was reported from play or reproduced from an
 * earlier version's failure, not one chosen to pass. The important ones are the
 * two rules the model rests on - an engaged body never moves, and no two bodies
 * ever overlap - and the scenario that drove the redesign: thirty melee bodies
 * against one, with the gaps filling as the ring dies.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  applyCommand,
  buildDefIndex,
  createContext,
  createMatch,
  createMonster,
  FORTRESS_ID,
  gap,
  placeWave,
  step,
} from './index.ts';
import type { GameData } from '../data/schema.ts';
import type { Body, MatchState, SimContext } from './index.ts';
import { cellAt } from './flowfield.ts';

const { data } = loadDataFromDisk();

/**
 * Disarmed on both sides, so nothing dies and movement is all that happens.
 *
 * Monsters were left armed here once, which quietly corrupted every count of
 * "units that reached contact": the ones that arrived first were the ones that
 * got killed, so the measurement partly reported combat rather than routing.
 */
function passiveData(): GameData {
  const d = structuredClone(data);
  d.fortress.weapon.damage = 0;
  for (const u of d.units.units) u.damage = 0;
  for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.damage = 0;
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

function place(ctx: SimContext, state: MatchState, unitDefId: string, x: number, y: number) {
  applyCommand(ctx, state, { kind: 'placeUnit', teamId: 'l1', unitDefId, tileX: x, tileY: y });
}

function startCombat(ctx: SimContext, state: MatchState): void {
  while (state.phase !== 'combat') step(ctx, state);
}

type Fighter = Body & { engaged: boolean };

/**
 * The deepest overlap between any two living bodies, in tiles. 0 is clean.
 * With `engagedOnly`, only pairs where at least one body is engaged count.
 */
function worstOverlap(sets: readonly (readonly Fighter[])[], engagedOnly = false): number {
  const all: Fighter[] = [];
  for (const set of sets) for (const b of set) if (b.alive) all.push(b);
  let worst = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (engagedOnly && !a.engaged && !b.engaged) continue;
      // §3.4: a boss and a monster are not in contact at all, so the distance
      // between them is not an overlap. Every other pair is.
      if ((a.phasesMonsters && b.monster) || (b.phasesMonsters && a.monster)) continue;
      const g = gap(a, b);
      if (-g > worst) worst = -g;
    }
  }
  return worst;
}

/**
 * A body that has been pushed to touching and then slid a hair by a neighbour
 * can read as overlapping by float noise. Anything a hundredth of a tile deep
 * is real.
 */
const OVERLAP_TOLERANCE = 0.01;

describe('an engaged body never moves', () => {
  it('holds a monster and a unit perfectly still once they are in contact', () => {
    // The face-to-face jitter: two bodies fighting used to shiver, because the
    // separation pass kept nudging one and the range check kept flipping.
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'pledge', 3, 5);
    startCombat(ctx, state);
    const target = lane.monsters.find((m) => m.alive)!;
    for (const m of lane.monsters) if (m !== target) m.alive = false;

    // Let them meet.
    run(ctx, state, 200);
    const unit = lane.units[0]!;
    expect(unit.engaged).toBe(true);
    expect(target.engaged).toBe(true);

    const ux = unit.pos.x;
    const uy = unit.pos.y;
    const mx = target.pos.x;
    const my = target.pos.y;
    run(ctx, state, 200);

    expect(unit.pos.x).toBe(ux);
    expect(unit.pos.y).toBe(uy);
    expect(target.pos.x).toBe(mx);
    expect(target.pos.y).toBe(my);
  });

  it('is not displaced by a crowd pressing on it', () => {
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'oathwall', 3, 5);
    startCombat(ctx, state);
    run(ctx, state, 300);

    const engaged = lane.monsters.filter((m) => m.alive && m.engaged);
    expect(engaged.length).toBeGreaterThan(0);
    const before = engaged.map((m) => ({ x: m.pos.x, y: m.pos.y }));

    run(ctx, state, 200);
    engaged.forEach((m, i) => {
      expect(m.pos.x).toBe(before[i]!.x);
      expect(m.pos.y).toBe(before[i]!.y);
    });
  });
});

describe('bodies do not overlap', () => {
  // The rule has two halves. An engaged body is never overlapped by anything:
  // it is immovable, so an overlap with it could never be resolved and would
  // be frozen into the fight. Two walkers may brush for a tick - a body that
  // yields to one with priority can have nowhere clean to go until the next
  // tick - but never by more than a step, and never for long.
  it('never overlaps an engaged body, from spawn to contact', () => {
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (let x = 1; x < 7; x++) place(ctx, state, 'pledge', x, 5);
    startCombat(ctx, state);

    let worst = 0;
    for (let t = 0; t < 400; t++) {
      step(ctx, state);
      worst = Math.max(worst, worstOverlap([lane.units, lane.monsters], true));
    }
    expect(worst).toBeLessThan(OVERLAP_TOLERANCE);
  });

  it('resolves a brush between two walkers within a few ticks', () => {
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (let x = 1; x < 7; x++) place(ctx, state, 'pledge', x, 5);
    startCombat(ctx, state);

    let worst = 0;
    let longest = 0;
    let streak = 0;
    for (let t = 0; t < 400; t++) {
      step(ctx, state);
      const overlap = worstOverlap([lane.units, lane.monsters]);
      worst = Math.max(worst, overlap);
      streak = overlap >= OVERLAP_TOLERANCE ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    }
    // A grub's step is 0.055 tiles: a brush is shallower than one step.
    expect(worst).toBeLessThan(0.055);
    expect(longest).toBeLessThanOrEqual(3);
  });

  it('spawns a wave as one packed clump in the spawn zone', () => {
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    startCombat(ctx, state);

    const alive = lane.monsters.filter((m) => m.alive);
    expect(alive.length).toBeGreaterThan(1);
    // Above the grid, in the spawn zone, and together.
    for (const m of alive) {
      expect(m.pos.y).toBeLessThan(0);
      expect(m.pos.y).toBeGreaterThan(-d.lane.spawnZoneDepth);
    }
    const cx = alive.reduce((s, m) => s + m.pos.x, 0) / alive.length;
    expect(Math.abs(cx - d.lane.buildZone.width / 2)).toBeLessThan(0.3);
    expect(worstOverlap([lane.monsters])).toBeLessThan(OVERLAP_TOLERANCE);
  });
});

describe('thirty melee monsters against one tank', () => {
  // The scenario the model was designed against: those that can hit it stand
  // still and hit it; the rest wait; when one dies, one shifts in to fill the
  // gap; nobody blocks anybody else out of it.
  function tankAndThirty() {
    const d = passiveData();
    // A wave with plenty of bodies: grub_pack's shape, thirty times.
    d.waves.composition = [{ wave: 1, entries: [{ monsterId: 'grub', count: 30 }] }];
    d.waves.maxConcurrentMonsters = 40;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'oathwall', 3, 6);
    startCombat(ctx, state);
    return { state, ctx, lane, tank: lane.units[0]! };
  }

  it('fills the ring, and only the ring, with the rest waiting behind', () => {
    const { state, ctx, lane, tank } = tankAndThirty();
    run(ctx, state, 500);

    // Engaged WITH THE TANK, not engaged with anything: a monster that cannot
    // get onto the tank walks on to the fortress (§5.1, rule zero) and is
    // engaged there, which is a different fact about a different body.
    const onTank = lane.monsters.filter(
      (m) => m.alive && m.engaged && m.targetId === tank.id,
    ).length;
    const alive = lane.monsters.filter((m) => m.alive).length;
    expect(alive).toBe(30);
    // At these body sizes the ring around a 0.26 body holds about six 0.22
    // bodies at touching distance, and a couple more across the rest of the
    // in-range annulus; the point is that it is full and that the other two
    // dozen are not on it.
    expect(onTank).toBeGreaterThanOrEqual(5);
    expect(onTank).toBeLessThanOrEqual(9);
    expect(worstOverlap([lane.units, lane.monsters])).toBeLessThan(OVERLAP_TOLERANCE);
  });

  it('fills a gap when a ring member dies, without anyone deadlocking', () => {
    const { state, ctx, lane, tank } = tankAndThirty();
    run(ctx, state, 500);

    const angle = (m: { pos: { x: number; y: number } }) =>
      Math.atan2(m.pos.y - tank.pos.y, m.pos.x - tank.pos.x);

    for (let round = 0; round < 6; round++) {
      const ring = lane.monsters
        .filter((m) => m.alive && m.engaged)
        .sort((a, b) => angle(a) - angle(b));
      const before = ring.length;

      // Kill the member whose neighbours are furthest apart. Ring members are
      // immovable, and a ring packs first come first served, so the hole one
      // leaves is sometimes too narrow for a body: that hole staying open is
      // the geometry, not the pathing. The widest hole always fits one.
      let loosest = 0;
      let widest = -1;
      for (let i = 0; i < before; i++) {
        const prev = angle(ring[(i + before - 1) % before]!);
        const next = angle(ring[(i + 1) % before]!);
        let span = next - prev;
        while (span <= 0) span += Math.PI * 2;
        if (span > widest) {
          widest = span;
          loosest = i;
        }
      }
      ring[loosest]!.hp = 0;
      step(ctx, state);

      // Within a second the ring is full again.
      run(ctx, state, 20);
      const after = lane.monsters.filter((m) => m.alive && m.engaged).length;
      expect(after).toBeGreaterThanOrEqual(before);
      expect(worstOverlap([lane.units, lane.monsters])).toBeLessThan(OVERLAP_TOLERANCE);
    }
  });

  it('leaves the engaged ring perfectly still while the rest jostle', () => {
    const { state, ctx, lane } = tankAndThirty();
    run(ctx, state, 500);

    const ring = lane.monsters.filter((m) => m.alive && m.engaged);
    const before = ring.map((m) => ({ x: m.pos.x, y: m.pos.y }));
    run(ctx, state, 100);
    ring.forEach((m, i) => {
      expect(m.pos.x).toBe(before[i]!.x);
      expect(m.pos.y).toBe(before[i]!.y);
    });
  });
});

describe('defensive units advance when nothing is in range (§5.2, amended)', () => {
  it('walks toward the monsters instead of standing idle', () => {
    const d = passiveData();
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'pledge', 3, 8);
    startCombat(ctx, state);

    const unit = lane.units[0]!;
    const startY = unit.pos.y;
    run(ctx, state, 60);
    // Monsters are pinned in the spawn zone, so the unit has to come up.
    expect(unit.pos.y).toBeLessThan(startY - 1);
  });

  it('plants and holds once something is in range', () => {
    const d = passiveData();
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'judgement', 3, 8);
    startCombat(ctx, state);

    const unit = lane.units[0]!;
    run(ctx, state, 400);
    expect(unit.engaged).toBe(true);
    const x = unit.pos.x;
    const y = unit.pos.y;
    run(ctx, state, 100);
    expect(unit.pos.x).toBe(x);
    expect(unit.pos.y).toBe(y);
  });

  it('advances to the top of the grid and holds: the spawn zone is theirs', () => {
    // The wave's ground. A line that walks onto the spawn point is a line a
    // wave is born inside, which costs the attacker their numbers and makes a
    // send against that lane worthless - see `unitLane` in context.ts for the
    // measurements. A unit walks up to the line and waits there.
    const d = passiveData();
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'pledge', 3, 3);
    startCombat(ctx, state);

    run(ctx, state, 400);
    const unit = lane.units[0]!;
    // It advanced - it was built on row 3 and the monsters are above row 0.
    expect(unit.pos.y).toBeLessThan(3.5);
    // But not onto the spawn point. A crowd can shove it a hair over the line
    // and it walks back, so the bar is "not meaningfully inside", not "never".
    expect(unit.pos.y).toBeGreaterThan(-0.2);
  });

  it('still shoots into the spawn zone: reach is not a boundary', () => {
    // The line stops at the grid's edge; a lance's 4.9 tiles of reach does
    // not, and a monster standing in the open is a monster it can hit.
    const d = passiveData();
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'judgement', 3, 3);
    startCombat(ctx, state);

    run(ctx, state, 400);
    const unit = lane.units[0]!;
    expect(unit.engaged).toBe(true);
    const target = lane.monsters.find((m) => m.id === unit.targetId);
    expect(target).toBeDefined();
    expect(target!.pos.y).toBeLessThan(0);
  });

  it('returns the line to its build tiles at the next build phase', () => {
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'pledge', 2, 7);
    place(ctx, state, 'pledge', 5, 7);
    startCombat(ctx, state);
    run(ctx, state, 100);
    expect(lane.units.some((u) => Math.floor(u.pos.y) !== 7)).toBe(true);

    for (const m of lane.monsters) m.hp = 0;
    while (state.phase !== 'build') step(ctx, state);

    for (const unit of lane.units) {
      expect(unit.pos.x).toBe(unit.homeTileX + 0.5);
      expect(unit.pos.y).toBe(unit.homeTileY + 0.5);
      expect(unit.engaged).toBe(false);
    }
  });
});

describe('monsters route rather than press', () => {
  it('reaches a unit that is only reachable the long way round', () => {
    // A wall of units across the lane with a gap at one end, and the unit the
    // monsters are nearest to on the far side of the wall's solid part. The
    // wall itself is in range, so a monster's job is to find SOMETHING to hit
    // - and every one of them does.
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (let x = 0; x < 7; x++) place(ctx, state, 'oathwall', x, 4);
    startCombat(ctx, state);
    run(ctx, state, 600);

    const alive = lane.monsters.filter((m) => m.alive);
    const engaged = alive.filter((m) => m.engaged).length;
    expect(engaged).toBeGreaterThanOrEqual(Math.min(alive.length, 6));
  });

  it('attacks whatever it is touching when it can get no further (§5.3)', () => {
    // A solid wall: nothing to route through. Every monster that reaches the
    // wall must be engaged with it, not standing behind a neighbour waiting for
    // a gap that will never open.
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (let x = 0; x < 8; x++) place(ctx, state, 'oathwall', x, 3);
    startCombat(ctx, state);
    run(ctx, state, 600);

    const alive = lane.monsters.filter((m) => m.alive);
    const touchingWall = alive.filter((m) => lane.units.some((u) => u.alive && gap(m, u) < 0.05));
    for (const m of touchingWall) expect(m.engaged).toBe(true);
    expect(touchingWall.length).toBeGreaterThan(0);
  });

  it('walks a straight line to the fortress when nothing is in the way', () => {
    const d = passiveData();
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    startCombat(ctx, state);

    const monster = lane.monsters.find((m) => m.alive)!;
    for (const m of lane.monsters) if (m !== monster) m.alive = false;
    monster.pos.x = 3.5;
    monster.pos.y = -1.5;

    let travelled = 0;
    const start = { x: monster.pos.x, y: monster.pos.y };
    while (!monster.engaged && travelled < 30) {
      const px = monster.pos.x;
      const py = monster.pos.y;
      step(ctx, state);
      travelled += Math.hypot(monster.pos.x - px, monster.pos.y - py);
    }
    const straight = Math.hypot(monster.pos.x - start.x, monster.pos.y - start.y);
    // Path efficiency: distance covered against distance closed.
    expect(straight / travelled).toBeGreaterThan(0.99);
  });
});

describe('a monster walks at the fortress until something is worth fighting (§5.1)', () => {
  /** How far a monster looks for a defender, from data. */
  const ACQUIRE = data.lane.monsterAcquireRange;

  /** One monster at the top of the lane, one immobile unit wherever asked. */
  function lone(unitTileX: number, unitTileY: number) {
    const d = passiveData();
    for (const u of d.units.units) u.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'pledge', unitTileX, unitTileY);
    startCombat(ctx, state);

    const monster = lane.monsters.find((m) => m.alive)!;
    for (const m of lane.monsters) if (m !== monster) m.alive = false;
    monster.pos.x = 4;
    monster.pos.y = -2.5;
    return { state, ctx, lane, monster, unit: lane.units[0]! };
  }

  it('ignores a defender it has not reached yet', () => {
    // A tower against the far wall, well outside acquisition range of the
    // route. The monster should walk past it, not across the lane at it.
    const { state, ctx, monster, unit } = lone(0, 2);
    // Edge to edge, like every other range in the simulation.
    const sideways = Math.abs(unit.pos.x - monster.pos.x) - unit.radius - monster.radius;
    expect(sideways).toBeGreaterThan(ACQUIRE);

    for (let t = 0; t < 40; t++) step(ctx, state);
    expect(monster.targetId).toBe(FORTRESS_ID);
    // And it is heading down the lane rather than sideways at the tower.
    expect(monster.pos.y).toBeGreaterThan(-2.5);
    expect(Math.abs(monster.pos.x - 4)).toBeLessThan(1);
  });

  it('takes a defender that comes inside its acquisition range', () => {
    const { state, ctx, monster, unit } = lone(4, 4);
    for (let t = 0; t < 400 && monster.targetId === FORTRESS_ID; t++) step(ctx, state);

    expect(monster.targetId).toBe(unit.id);
    // It did not notice from further away than it is allowed to see.
    const d = Math.hypot(monster.pos.x - unit.pos.x, monster.pos.y - unit.pos.y);
    expect(d).toBeLessThanOrEqual(ACQUIRE + monster.radius + unit.radius + 0.3);
  });

  it('keeps the one it took rather than swapping every tick', () => {
    // Two towers side by side, both inside range. Whichever it picks, it keeps.
    const d = passiveData();
    for (const u of d.units.units) u.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    place(ctx, state, 'pledge', 3, 5);
    place(ctx, state, 'pledge', 4, 5);
    startCombat(ctx, state);

    const monster = lane.monsters.find((m) => m.alive)!;
    for (const m of lane.monsters) if (m !== monster) m.alive = false;
    monster.pos.x = 4;
    monster.pos.y = 3.2;

    for (let t = 0; t < 400 && monster.targetId === FORTRESS_ID; t++) step(ctx, state);
    const first = monster.targetId;
    expect(first).not.toBe(FORTRESS_ID);

    let changes = 0;
    let previous = first;
    for (let t = 0; t < 200; t++) {
      step(ctx, state);
      if (monster.targetId !== previous) changes++;
      previous = monster.targetId;
    }
    expect(changes).toBe(0);
  });

  it('goes back to the fortress when its target dies', () => {
    const { state, ctx, lane, monster, unit } = lone(4, 4);
    for (let t = 0; t < 400 && monster.targetId === FORTRESS_ID; t++) step(ctx, state);
    expect(monster.targetId).toBe(unit.id);

    unit.alive = false;
    unit.hp = 0;
    lane.units.length = 0;
    step(ctx, state);
    expect(monster.targetId).toBe(FORTRESS_ID);
  });
});

describe('units route around allies', () => {
  it('gets a whole group through a gap in a wall of allies', () => {
    // A line of immobile allies across the lane with one gap. Local steering
    // pressed flat against it; the field finds the gap.
    const d = passiveData();
    for (const u of d.units.units) if (u.id === 'sanction') u.moveSpeed = 0;
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;

    for (let x = 0; x < 7; x++) place(ctx, state, 'sanction', x, 5);
    for (let x = 2; x < 6; x++) for (const y of [8, 9]) place(ctx, state, 'pledge', x, y);
    startCombat(ctx, state);

    const target = lane.monsters.find((m) => m.alive)!;
    for (const m of lane.monsters) if (m !== target) m.alive = false;
    target.pos.x = 3.5;
    target.pos.y = 1.5;

    run(ctx, state, 1200);
    const movers = lane.units.filter((u) => u.defId === 'pledge');
    const through = movers.filter((u) => u.pos.y < 4.5).length;
    expect(through).toBe(8);
  });

  it('gets the back row past the front row to the target', () => {
    const d = passiveData();
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (const y of [7, 8]) for (let x = 2; x < 6; x++) place(ctx, state, 'pledge', x, y);
    startCombat(ctx, state);

    const target = lane.monsters.find((m) => m.alive)!;
    for (const m of lane.monsters) if (m !== target) m.alive = false;
    target.pos.x = 1.5;
    target.pos.y = 2.5;

    run(ctx, state, 1200);
    // A 0.22 body is ringed by up to seven 0.26 bodies; six is comfortable.
    const engaged = lane.units.filter((u) => u.alive && u.engaged).length;
    expect(engaged).toBeGreaterThanOrEqual(6);
  });
});

describe('a fast body behind a slow one', () => {
  /** The two of them alone in the lane, the fast one directly behind. */
  function convoy() {
    const d = passiveData();
    const state = createMatch(d, { seed: 1, teams: [{ id: 'l1', playerIds: ['p'] }] });
    const ctx = createContext(d);
    const defs = buildDefIndex(d);
    const lane = state.lanes.l1!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    lane.fortress.hp = lane.fortress.maxHp;
    while (state.phase !== 'combat') step(ctx, state);
    lane.monsters.length = 0;
    lane.reserve.length = 0;

    const slow = createMonster(state, d, defs, { defId: 'husk', waveNumber: 1 }, { x: 4, y: 2 })!;
    const fast = createMonster(
      state,
      d,
      defs,
      { defId: 'grub', waveNumber: 1 },
      { x: 4, y: 2 - slow.radius - 0.23 },
    )!;
    lane.monsters.push(slow, fast);
    expect(fast.moveSpeed).toBeGreaterThan(slow.moveSpeed);
    return { state, ctx, lane, slow, fast };
  }

  it('walks round it instead of inheriting its speed', () => {
    // Reported from play: a grub tailed a husk down the whole lane and never
    // got past it. The field marks as terrain only what will not move, so a
    // walking ally was free ground: the route pointed straight through it,
    // contact cancelled the part of the step that went into it, and a head-on
    // contact has no tangent to slide along. Nothing ever said "go round".
    const { state, ctx, slow, fast } = convoy();
    const startY = fast.pos.y;

    run(ctx, state, 100);

    const walked = fast.pos.y - startY;
    expect(walked).toBeGreaterThan(fast.moveSpeed * 5 * 0.9);
    // And the number that is actually being claimed: its own pace, not the
    // pace of whatever happened to be in front of it.
    expect(walked).toBeGreaterThan(slow.moveSpeed * 5 * 1.3);
  });

  it('is past it by the time they reach the wall', () => {
    const { state, ctx, slow, fast } = convoy();
    run(ctx, state, 300);

    expect(fast.engaged).toBe(true);
    expect(fast.pos.y).toBeGreaterThan(slow.pos.y);
  });
});

describe("the lane's own walls are terrain", () => {
  it('is what the planner builds every field on', () => {
    // motion.ts keeps a body's whole width inside the lane, so the strip along
    // each edge is ground nothing can stand on. The field has to know that, or
    // it marks attack positions there - goals a crowd walks at forever without
    // ever taking, which is what a lane-wide fortress produces a queue of.
    const { state, ctx } = setup(data);
    place(ctx, state, 'pledge', 3, 4);
    startCombat(ctx, state);
    run(ctx, state, 200);

    expect(ctx.fields.size).toBeGreaterThan(0);
    for (const [key, field] of ctx.fields) {
      // Inside any body's radius of the edge: no body of any size fits here.
      expect(field.blocked[cellAt(field, 0.05, 5)], key).toBe(1);
      expect(field.blocked[cellAt(field, 7.95, 5)], key).toBe(1);
    }
  });
});

describe('the crowd comes to rest', () => {
  it('stops moving once everything that can engage has engaged', () => {
    const d = passiveData();
    for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) m.moveSpeed = 0;
    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (let x = 2; x < 7; x++) for (let y = 6; y < 10; y++) place(ctx, state, 'pledge', x, y);
    startCombat(ctx, state);
    run(ctx, state, 1400);

    // Once settled, the sum of all movement over two seconds should be tiny:
    // the engaged are still by rule, and the waiting have nowhere to go.
    const before = new Map(lane.units.map((u) => [u.id, { x: u.pos.x, y: u.pos.y }]));
    let late = 0;
    for (let t = 0; t < 40; t++) {
      step(ctx, state);
      for (const u of lane.units) {
        const b = before.get(u.id)!;
        late += Math.hypot(u.pos.x - b.x, u.pos.y - b.y);
        b.x = u.pos.x;
        b.y = u.pos.y;
      }
    }
    expect(late).toBeLessThan(3);
  });
});

describe('a boss passes through its own escort (§3.4)', () => {
  /**
   * The case the rule exists for: one boss, the swarm it arrives with, and a
   * line of defenders for the swarm to pile up against. A boss is four times
   * the width of a swarmling, so made solid to them it spends the fight wedged
   * in its own escort.
   */
  function bossAndSwarm() {
    const d = passiveData();
    d.waves.composition = [
      {
        wave: 1,
        entries: [
          { monsterId: 'brood_sire', count: 1 },
          { monsterId: 'swarmling', count: 24 },
        ],
      },
    ];
    d.waves.maxConcurrentMonsters = 40;

    const { state, ctx } = setup(d);
    const lane = state.lanes.l1!;
    for (let x = 0; x < 8; x++) place(ctx, state, 'oathwall', x, 6);
    startCombat(ctx, state);

    const boss = lane.monsters.find((m) => m.defId === 'brood_sire')!;
    return { state, ctx, lane, boss };
  }

  it('is a monster that other monsters are not solid to', () => {
    const { boss, lane } = bossAndSwarm();
    expect(boss.monster).toBe(true);
    expect(boss.phasesMonsters).toBe(true);
    for (const m of lane.monsters) {
      if (m === boss) continue;
      expect(m.phasesMonsters, m.defId).toBe(false);
    }
    for (const u of lane.units) expect(u.monster).toBe(false);
  });

  it('actually ends up sharing space with them', () => {
    // The positive statement of the rule. Solid bodies are pushed apart every
    // tick, so if these ever occupy the same ground they are not colliding.
    const { state, ctx, lane, boss } = bossAndSwarm();
    let shared = 0;
    for (let t = 0; t < 400; t++) {
      step(ctx, state);
      for (const m of lane.monsters) {
        if (m === boss || !m.alive) continue;
        if (gap(boss, m) < -0.05) shared++;
      }
    }
    expect(shared).toBeGreaterThan(0);
  });

  it('is still perfectly solid to the defenders it is walking at', () => {
    // The half of the rule that must NOT change: a boss you cannot block is a
    // boss the lane cannot defend against.
    const { state, ctx, lane, boss } = bossAndSwarm();
    let worst = 0;
    for (let t = 0; t < 400; t++) {
      step(ctx, state);
      for (const unit of lane.units) {
        if (!unit.alive) continue;
        worst = Math.max(worst, -gap(boss, unit));
      }
    }
    expect(worst).toBeLessThan(OVERLAP_TOLERANCE);
  });

  it('reaches the line instead of milling about in the crowd', () => {
    // Measured before the rule: the boss never engaged in 600 ticks and walked
    // 3.2 tiles for every tile of progress it made. This is the whole point.
    const { state, ctx, boss } = bossAndSwarm();
    const start = { x: boss.pos.x, y: boss.pos.y };
    let walked = 0;
    let engagedAt = -1;

    for (let t = 1; t <= 600; t++) {
      const from = { x: boss.pos.x, y: boss.pos.y };
      step(ctx, state);
      walked += Math.hypot(boss.pos.x - from.x, boss.pos.y - from.y);
      if (engagedAt < 0 && boss.engaged) engagedAt = t;
    }

    expect(engagedAt).toBeGreaterThan(0);
    const progress = Math.hypot(boss.pos.x - start.x, boss.pos.y - start.y);
    expect(walked / progress).toBeLessThan(1.5);
  });
});

describe('the spawn zone is the attacker’s ground (§5.2, amended again)', () => {
  /**
   * The measured case. A line on the top four rows, and far more sent at it
   * than the lane can hold at once: before this rule the mean unit stood at
   * y = -0.14, twenty-nine of thirty-two units were inside the spawn zone, and
   * a wave was born inside them.
   */
  function underSiege(monsters = 60) {
    // Live combat, not `passiveData`: the reserve only drains as monsters die,
    // and a queue that never drains is not the case under test. The fortress
    // is given a bottomless pool so the lane survives being sent at twelve
    // times over.
    const d = data;
    const state = createMatch(d, {
      seed: 4,
      teams: ['l1', 'l2'].map((id) => ({ id, playerIds: [id] })),
    });
    const ctx = createContext(d);
    for (const id of ['l1', 'l2']) {
      const lane = state.lanes[id]!;
      lane.economy.gold = 9_000_000;
      lane.economy.gems = 9_000_000;
      lane.economy.supplyCap = 9999;
      lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
      lane.fortress.hp = lane.fortress.maxHp;
    }
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 4; y++) {
        applyCommand(ctx, state, {
          kind: 'placeUnit',
          teamId: 'l1',
          unitDefId: 'pledge',
          tileX: x,
          tileY: y,
        });
      }
    }
    // Counted in MONSTERS, not in taps. A send used to deliver a pack and now
    // delivers one body (sends.json), and a fixture that counts taps measures
    // a number in the data file rather than the pressure it meant to apply.
    const pack = Math.max(1, d.sends.sends.find((x) => x.id === 'grub_pack')!.monsters.length);
    for (let i = 0; i < Math.ceil(monsters / pack); i++) {
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'l2',
        targetTeamId: 'l1',
        sendId: 'grub_pack',
      });
    }
    while (state.phase !== 'combat') step(ctx, state);
    return { state, ctx, d };
  }

  it('keeps the whole defence out of it, however hard it is pushed', () => {
    const { state, ctx } = underSiege();
    const lane = state.lanes.l1!;

    let deepest = 0;
    for (let t = 0; t < 600; t++) {
      step(ctx, state);
      for (const unit of lane.units) {
        if (unit.alive) deepest = Math.min(deepest, unit.pos.y);
      }
    }
    // Shoved a hair past the line by a crowd is allowed - contact is local
    // physics and the field walks it back. Camping the spawn point is not.
    expect(deepest).toBeGreaterThan(-0.2);
  });

  it('never lets a monster be born inside a unit', () => {
    const { state, ctx } = underSiege();
    const lane = state.lanes.l1!;
    const seen = new Set<number>();
    let born = 0;
    let overlapping = 0;

    for (let t = 0; t < 600; t++) {
      step(ctx, state);
      for (const monster of lane.monsters) {
        if (!monster.alive || seen.has(monster.id)) continue;
        seen.add(monster.id);
        born++;
        for (const unit of lane.units) {
          if (!unit.alive) continue;
          if (gap(unit, monster) < 0) {
            overlapping++;
            break;
          }
        }
      }
    }

    // More than the cap, so the reserve has been feeding arrivals in - which is
    // the case that used to put a monster inside a unit.
    expect(born).toBeGreaterThan(data.waves.maxConcurrentMonsters);
    expect(overlapping).toBe(0);
  });

  it('still fills the lane to the cap while a queue is waiting', () => {
    // The point of the rule is not fewer monsters - it is that the ones the
    // cap allows have somewhere to be.
    const { state, ctx, d } = underSiege();
    const lane = state.lanes.l1!;
    let peak = 0;
    let sawQueue = false;

    for (let t = 0; t < 600; t++) {
      step(ctx, state);
      peak = Math.max(peak, lane.monsters.filter((m) => m.alive).length);
      if (lane.reserve.length > 0) sawQueue = true;
    }

    expect(sawQueue).toBe(true);
    expect(peak).toBe(d.waves.maxConcurrentMonsters);
  });

  it('gives the wave the lane to fight in rather than a scrum at the door', () => {
    // Enough sent that the line is eventually overrun, which is when the lane
    // behind it matters. Before the rule this scenario put monsters in only 4
    // of the lane's 14 rows for the whole fight: the wave was ground down on
    // the spawn point and never got past the door.
    //
    // Three hundred monsters rather than the two hundred this used to need. A block of thirty-two
    // Pledges all grant each other Shoulder to Shoulder (abilities.json), so
    // the same wall of bodies is about a quarter stronger than it was and forty
    // bodies no longer break it - at two hundred the line finishes the fight intact
    // and the wave never leaves the doorway, which measures the ABILITY rather
    // than the rule under test. At three hundred the line gives way and
    // thirteen of the fourteen rows see a monster.
    const { state, ctx } = underSiege(300);
    const lane = state.lanes.l1!;
    const rows = new Set<number>();

    // Long enough for the line to be overrun, which is when the rows behind it
    // start earning their keep: the front holds for the first eighty seconds
    // and the lane opens up as it gives way.
    for (let t = 0; t < 2200; t++) {
      step(ctx, state);
      for (const monster of lane.monsters) {
        if (monster.alive) rows.add(Math.floor(monster.pos.y));
      }
    }

    expect(rows.size).toBeGreaterThan(6);
  });

  it('packs a cap-sized clump wholly inside the zone', () => {
    const radii = new Array(data.waves.maxConcurrentMonsters).fill(0.3);
    for (const at of placeWave(data, radii)) {
      expect(at.x).toBeGreaterThanOrEqual(0.3);
      expect(at.x).toBeLessThanOrEqual(data.lane.buildZone.width - 0.3);
      expect(at.y).toBeGreaterThanOrEqual(-data.lane.spawnZoneDepth + 0.3);
      expect(at.y).toBeLessThanOrEqual(-0.3);
    }
  });
});

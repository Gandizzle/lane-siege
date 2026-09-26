/**
 * The Final Showdown. DESIGN.md §3.3, replaced.
 *
 * The arena's geometry, the transplant out of the lanes, the countdown, the
 * free-for-all itself, and dampening's scaffolding.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { LEGS, arenaShape, crossesTheVoid, inCentre, legForSeat, legPosition } from './arena.ts';
import {
  applyHealing,
  crowdControlMultiplier,
  dampeningRemaining,
  healingMultiplier,
  summonHealthMultiplier,
} from './dampening.ts';
import {
  applyCommand,
  createContext,
  createMatch,
  modifiersOf,
  slideStep,
  step,
  viewFor,
  TICKS_PER_SECOND,
} from './index.ts';
import type { Body, MatchState, SimContext } from './index.ts';
import type { Afflicted } from './status.ts';

const { data } = loadDataFromDisk();
const shape = arenaShape(data);

function fourPlayers(): { state: MatchState; ctx: SimContext } {
  const teams = ['a', 'b', 'c', 'd'].map((id) => ({ id, playerIds: [id] }));
  return { state: createMatch(data, { seed: 7, teams }), ctx: createContext(data) };
}

/** Build one unit of `defId` on each of `tiles`, funding the lane first. */
function arm(ctx: SimContext, state: MatchState, teamId: string, defId: string, count: number) {
  const lane = state.lanes[teamId]!;
  lane.economy.gold = 100000;
  lane.economy.supplyCap = 1000;
  for (let i = 0; i < count; i++) {
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId,
      unitDefId: defId,
      tileX: i % data.lane.buildZone.width,
      tileY: Math.floor(i / data.lane.buildZone.width),
    });
  }
  return lane;
}

/**
 * Jump to the moment the last wave is cleared, without simulating 25 of them.
 *
 * The transition is the thing under test, so it is taken rather than faked:
 * the state is put where the final wave's last monster dying would put it and
 * `step` is left to decide what happens next.
 */
function reachShowdown(ctx: SimContext, state: MatchState): void {
  state.wave = data.waves.showdown.afterWave;
  state.phase = 'combat';
  state.phaseTicksLeft = 0;
  for (const lane of Object.values(state.lanes)) {
    lane.monsters.length = 0;
    lane.reserve.length = 0;
  }
  state.waveClocks.length = 0;
  step(ctx, state);
}

/** Run the countdown card out, so the next step is a tick of fighting. */
function startFighting(ctx: SimContext, state: MatchState): void {
  const card = state.phaseTicksLeft;
  for (let i = 0; i < card; i++) step(ctx, state);
}

/** How far a body is from the middle of the arena. */
function toCentre(at: { x: number; y: number }): number {
  return Math.hypot(at.x - shape.size / 2, at.y - shape.size / 2);
}

describe('the arena (§3.3, replaced)', () => {
  it('is a cross of four lane-width spokes around a centre the same width', () => {
    expect(shape.spokeWidth).toBe(data.lane.buildZone.width);
    expect(shape.spokeLength).toBe(data.lane.buildZone.depth + data.waves.showdown.approachDepth);
    // Spoke, centre, spoke.
    expect(shape.size).toBe(shape.spokeLength * 2 + shape.spokeWidth);
    // The centre is where the four spokes overlap, so it is square by
    // construction: spokeWidth on a side.
    expect(shape.bounds.band).toEqual({
      min: shape.spokeLength,
      max: shape.spokeLength + shape.spokeWidth,
    });
  });

  it('puts every build tile of every seat inside the arena and off the corners', () => {
    const { width, depth } = data.lane.buildZone;
    const band = shape.bounds.band!;

    for (let seat = 0; seat < LEGS.length; seat++) {
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < depth; y++) {
          const at = legPosition(shape, legForSeat(seat), x, y);
          expect(at.x).toBeGreaterThan(0);
          expect(at.y).toBeGreaterThan(0);
          expect(at.x).toBeLessThan(shape.size);
          expect(at.y).toBeLessThan(shape.size);
          // A corner is outside the band on BOTH axes, and there is no arena
          // there for anybody to stand on.
          const offX = at.x < band.min || at.x > band.max;
          const offY = at.y < band.min || at.y > band.max;
          expect(offX && offY).toBe(false);
        }
      }
    }
  });

  it('seats the four armies on four different spokes, each facing the centre', () => {
    const centre = shape.size / 2;
    const corners = new Set<string>();

    for (let seat = 0; seat < LEGS.length; seat++) {
      const leg = legForSeat(seat);
      // Tile row 0 faced the monsters; in the arena it faces the fight.
      const front = legPosition(shape, leg, 3, 0);
      const back = legPosition(shape, leg, 3, data.lane.buildZone.depth - 1);
      const toCentre = (p: { x: number; y: number }) => Math.hypot(p.x - centre, p.y - centre);

      expect(toCentre(front)).toBeLessThan(toCentre(back));
      corners.add(`${Math.round(front.x)},${Math.round(front.y)}`);
    }

    expect(corners.size).toBe(LEGS.length);
  });

  it('places tile (x, y) of the south spoke where the build grid would be', () => {
    // The seat-one layout written out: the grid at the bottom of the arena,
    // its far row nearest the centre.
    const at = legPosition(shape, 'south', 0, 0);
    expect(at.x).toBeCloseTo(shape.spokeLength + 0.5);
    expect(at.y).toBeCloseTo(shape.size - data.lane.buildZone.depth + 0.5);
  });
});

describe('the transplant (§3.3, replaced)', () => {
  it('opens the showdown when the last wave is cleared, not a build phase', () => {
    const { state, ctx } = fourPlayers();
    arm(ctx, state, 'a', 'pledge', 2);
    reachShowdown(ctx, state);

    expect(state.phase).toBe('showdown');
    expect(state.showdown).not.toBeNull();
    // The tick that opened the showdown also spent one of the card's, exactly
    // as the tick that opens a build phase spends one of its thirty seconds.
    expect(state.phaseTicksLeft).toBe(
      Math.round(data.waves.showdown.countdownSeconds * TICKS_PER_SECOND) - 1,
    );
  });

  it('moves every army out of its lane and into its own spoke, whole', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 3);
    // Chewed up by the last wave. The arena opens with everyone at full HP.
    const hurt = state.lanes.a!.units[0]!;
    hurt.hp = 1;
    state.lanes.b!.units[1]!.alive = false;

    reachShowdown(ctx, state);
    const showdown = state.showdown!;

    expect(showdown.armies.map((a) => a.teamId)).toEqual(['a', 'b', 'c', 'd']);
    for (const lane of Object.values(state.lanes)) expect(lane.units).toHaveLength(0);
    for (const army of showdown.armies) {
      expect(army.units).toHaveLength(3);
      for (const unit of army.units) {
        expect(unit.alive).toBe(true);
        expect(unit.hp).toBe(unit.maxHp);
      }
    }
    // Same objects, moved rather than copied.
    expect(showdown.armies[0]!.units[0]).toBe(hurt);
  });

  it('stands each unit on the tile it was built on, in its seat spoke', () => {
    const { state, ctx } = fourPlayers();
    arm(ctx, state, 'c', 'pledge', 5);
    reachShowdown(ctx, state);

    const army = state.showdown!.armies.find((a) => a.teamId === 'c')!;
    expect(army.seat).toBe(2);
    for (const unit of army.units) {
      const want = legPosition(shape, legForSeat(2), unit.homeTileX, unit.homeTileY);
      expect(unit.pos.x).toBeCloseTo(want.x);
      expect(unit.pos.y).toBeCloseTo(want.y);
    }
  });

  it('leaves an eliminated player’s spoke empty rather than reseating the table', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 2);
    state.teams[1]!.eliminated = true;

    reachShowdown(ctx, state);
    const seats = state.showdown!.armies.map((a) => a.seat);

    // Seat 1 is gone; nobody is promoted into it.
    expect(seats).toEqual([0, 2, 3]);
  });
});

describe('the countdown (§3.3, replaced)', () => {
  it('holds every army still until it runs out', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 4);
    reachShowdown(ctx, state);

    const unit = state.showdown!.armies[0]!.units[0]!;
    const start = { x: unit.pos.x, y: unit.pos.y };

    const card = state.phaseTicksLeft;
    for (let i = 0; i < card; i++) step(ctx, state);

    expect(state.phaseTicksLeft).toBe(0);
    expect(unit.pos.x).toBe(start.x);
    expect(unit.pos.y).toBe(start.y);
    expect(state.showdown!.age).toBe(0);
    expect(state.showdown!.attacks).toHaveLength(0);
  });

  it('starts the fight clock only once the card clears', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 4);
    reachShowdown(ctx, state);

    const card = state.phaseTicksLeft;
    for (let i = 0; i < card; i++) step(ctx, state);
    step(ctx, state);

    expect(state.showdown!.age).toBe(1);
  });
});

describe('the free-for-all (§3.3, replaced)', () => {
  it('converges four armies on the centre and leaves one standing', () => {
    const { state, ctx } = fourPlayers();
    arm(ctx, state, 'a', 'pledge', 6);
    arm(ctx, state, 'b', 'pledge', 4);
    arm(ctx, state, 'c', 'pledge', 3);
    arm(ctx, state, 'd', 'pledge', 2);
    reachShowdown(ctx, state);

    let guard = 0;
    while (!state.finished && guard++ < 40000) step(ctx, state);

    expect(state.finished).toBe(true);
    const living = state.teams.filter((t) => !t.eliminated);
    expect(living).toHaveLength(1);
    expect(living[0]!.placement).toBe(1);
    // Placements count up from the bottom, so the first army wiped places last.
    expect(state.teams.filter((t) => t.placement === 4)).toHaveLength(1);
  });

  it('keeps every body inside the cross - never in a corner', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 8);
    reachShowdown(ctx, state);

    const band = shape.bounds.band!;
    let guard = 0;
    while (!state.finished && guard++ < 20000) {
      step(ctx, state);
      for (const army of state.showdown!.armies) {
        for (const unit of army.units) {
          if (!unit.alive) continue;
          const offX = unit.pos.x < band.min - unit.radius || unit.pos.x > band.max + unit.radius;
          const offY = unit.pos.y < band.min - unit.radius || unit.pos.y > band.max + unit.radius;
          expect(offX && offY).toBe(false);
          expect(unit.pos.x).toBeGreaterThanOrEqual(-1e-6);
          expect(unit.pos.y).toBeGreaterThanOrEqual(-1e-6);
          expect(unit.pos.x).toBeLessThanOrEqual(shape.size + 1e-6);
          expect(unit.pos.y).toBeLessThanOrEqual(shape.size + 1e-6);
        }
      }
    }
  });

  it('is a free-for-all: a unit fights whichever army is nearest', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 4);
    reachShowdown(ctx, state);

    const attackers = new Set<string>();
    let guard = 0;
    while (!state.finished && guard++ < 20000) {
      step(ctx, state);
      for (const attack of state.showdown!.attacks) {
        const army = state.showdown!.armies.find((a) =>
          a.units.some((u) => u.id === attack.attackerId),
        );
        if (army) attackers.add(army.teamId);
      }
      if (attackers.size >= 3) break;
    }

    expect(attackers.size).toBeGreaterThanOrEqual(3);
  });

  it('credits each unit with what it landed, so the panel still has rows', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 4);
    reachShowdown(ctx, state);

    let guard = 0;
    while (state.showdown!.attacks.length === 0 && guard++ < 20000) step(ctx, state);

    const attacker = state.showdown!.attacks[0]!.attackerId;
    const unit = state.showdown!.armies.flatMap((a) => a.units).find((u) => u.id === attacker)!;
    expect(unit.damageDealt).toBeGreaterThan(0);
  });

  it('ends immediately if nobody brought an army', () => {
    const { state, ctx } = fourPlayers();
    reachShowdown(ctx, state);

    let guard = 0;
    while (!state.finished && guard++ < 500) step(ctx, state);
    expect(state.finished).toBe(true);
  });
});

describe('what a unit can see in the arena (§3.3, replaced)', () => {
  const { margin, minimum } = data.waves.showdown.acquire;

  /** Two armies of one, put at a chosen gap between their edges. */
  function duel(defId: string, edgeGap: number) {
    const { state, ctx } = fourPlayers();
    arm(ctx, state, 'a', defId, 1);
    arm(ctx, state, 'b', defId, 1);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    const mine = state.showdown!.armies.find((army) => army.teamId === 'a')!.units[0]!;
    const theirs = state.showdown!.armies.find((army) => army.teamId === 'b')!.units[0]!;
    // Side by side in the middle of the arena, `edgeGap` apart edge to edge.
    mine.pos.x = shape.size / 2;
    mine.pos.y = shape.size / 2;
    theirs.pos.x = mine.pos.x + mine.radius + theirs.radius + edgeGap;
    theirs.pos.y = mine.pos.y;

    step(ctx, state);
    return { mine, theirs };
  }

  it('sees a body just inside its reach plus the margin', () => {
    // A hammer's reach is a hair over nothing, so the floor is what applies.
    const { mine, theirs } = duel('pledge', minimum - 0.05);
    expect(mine.targetId).toBe(theirs.id);
  });

  it('does not see one just outside it', () => {
    const { mine } = duel('pledge', minimum + 0.05);
    expect(mine.targetId).toBeNull();
  });

  it('gives a long-reaching unit sight to match, not the floor', () => {
    // A lance outranges the floor several times over. Sight is its own reach
    // plus the margin, so it looks as far as it can actually shoot.
    const lance = data.units.units.find((u) => u.id === 'judgement')!;
    const reach = lance.range ?? 0;
    expect(reach + margin).toBeGreaterThan(minimum);

    expect(duel('judgement', reach + margin - 0.05).mine.targetId).not.toBeNull();
    expect(duel('judgement', reach + margin + 0.05).mine.targetId).toBeNull();
  });

  it('sees nothing at all across the board when the card lifts', () => {
    // The armies open in their own spokes, twenty-odd tiles apart. Under
    // global sight every one of them would already have picked a duel.
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);
    step(ctx, state);

    for (const army of state.showdown!.armies) {
      for (const unit of army.units) expect(unit.targetId).toBeNull();
    }
  });

  it('walks at the middle of the map instead', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    const before = new Map<number, number>();
    for (const army of state.showdown!.armies) {
      for (const unit of army.units) before.set(unit.id, toCentre(unit.pos));
    }

    // Two seconds. Nothing has met anything yet at this distance, so every
    // one of them is still doing the default thing.
    for (let i = 0; i < 40; i++) step(ctx, state);

    for (const army of state.showdown!.armies) {
      for (const unit of army.units) {
        expect(unit.engaged).toBe(false);
        expect(toCentre(unit.pos)).toBeLessThan(before.get(unit.id)!);
      }
    }
  });

  it('heads for the middle, not for the army it cannot see', () => {
    // Seat 0 fights from the south spoke and seat 1 from the west one, so
    // "toward the centre" and "toward them" are different directions. Two
    // units on the WEST side of the south spoke: the centre is up and to the
    // right of both of them, and the other army is up and to the left.
    const { state, ctx } = fourPlayers();
    arm(ctx, state, 'a', 'pledge', 2);
    arm(ctx, state, 'b', 'pledge', 4);
    reachShowdown(ctx, state);
    startFighting(ctx, state);
    step(ctx, state);

    const south = state.showdown!.armies.find((army) => army.teamId === 'a')!;
    expect(south.seat).toBe(0);
    for (const unit of south.units) {
      expect(unit.targetId).toBeNull();
      expect(unit.pos.x).toBeLessThan(shape.size / 2);
      // Up and to the RIGHT. Walking at the west army would mean up and left.
      expect(unit.moveY).toBeLessThan(0);
      expect(unit.moveX).toBeGreaterThan(0.2);
    }
  });

  it('walks the arena at `walkSpeed` times lane speed', () => {
    // One pledge alone, walking at the centre for one second, at two paces.
    const walked = (pace: number): number => {
      const paced = structuredClone(data);
      paced.waves.showdown.walkSpeed = pace;
      const teams = ['a', 'b', 'c', 'd'].map((id) => ({ id, playerIds: [id] }));
      const state = createMatch(paced, { seed: 7, teams });
      const ctx = createContext(paced);
      arm(ctx, state, 'a', 'pledge', 1);
      reachShowdown(ctx, state);
      startFighting(ctx, state);
      const unit = state.showdown!.armies[0]!.units[0]!;
      const from = toCentre(unit.pos);
      for (let i = 0; i < TICKS_PER_SECOND; i++) step(ctx, state);
      return from - toCentre(unit.pos);
    };
    expect(data.waves.showdown.walkSpeed).toBeGreaterThan(1);
    expect(walked(2)).toBeCloseTo(2 * walked(1), 1);
  });

  it('still finishes: converging is what makes the armies meet', () => {
    const { state, ctx } = fourPlayers();
    arm(ctx, state, 'a', 'pledge', 6);
    arm(ctx, state, 'b', 'pledge', 4);
    arm(ctx, state, 'c', 'pledge', 3);
    arm(ctx, state, 'd', 'pledge', 2);
    reachShowdown(ctx, state);

    let guard = 0;
    while (!state.finished && guard++ < 40000) step(ctx, state);
    expect(state.finished).toBe(true);
  });
});

describe('dampening (§3.3, replaced)', () => {
  const config = data.waves.showdown.dampening;

  it('takes nothing away during the grace period', () => {
    expect(dampeningRemaining(config, 0)).toBe(1);
    expect(dampeningRemaining(config, config.graceSeconds * TICKS_PER_SECOND)).toBe(1);
  });

  it('removes its rate per second after it, additively', () => {
    const grace = config.graceSeconds * TICKS_PER_SECOND;
    expect(dampeningRemaining(config, grace + 10 * TICKS_PER_SECOND)).toBeCloseTo(
      1 - config.perSecond * 10,
    );
    expect(dampeningRemaining(config, grace + 50 * TICKS_PER_SECOND)).toBeCloseTo(
      1 - config.perSecond * 50,
    );
  });

  it('bottoms out at nothing rather than going negative', () => {
    const forever = (config.graceSeconds + 10 / config.perSecond) * TICKS_PER_SECOND;
    expect(dampeningRemaining(config, forever)).toBe(0);
  });

  it('answers for all three effects, so they can diverge later', () => {
    const ticks = (config.graceSeconds + 20) * TICKS_PER_SECOND;
    const want = dampeningRemaining(config, ticks);
    expect(healingMultiplier(config, ticks)).toBe(want);
    expect(summonHealthMultiplier(config, ticks)).toBe(want);
    expect(crowdControlMultiplier(config, ticks)).toBe(want);
  });
});

describe('healing, wherever it happens (§3.3, replaced)', () => {
  it('scales by the multiplier it is given', () => {
    const full = applyHealing(50, 100, 20, 1);
    const half = applyHealing(50, 100, 20, 0.5);
    expect(full - 50).toBeCloseTo((half - 50) * 2);
  });

  it('never overshoots the maximum', () => {
    expect(applyHealing(99.9, 100, 1000)).toBe(100);
  });

  it('refuses to heal a body that has already reached zero', () => {
    // The reaping happens at the end of a tick, so without this a fortress
    // could be healed back out of its own elimination.
    expect(applyHealing(0, 100, 50)).toBe(0);
    expect(applyHealing(-20, 100, 50)).toBe(-20);
  });

  it('does nothing at all when the multiplier has run out', () => {
    expect(applyHealing(50, 100, 20, 0)).toBe(50);
  });
});

describe('the cross has walls where a rectangle has none (§3.3, replaced)', () => {
  /** A body of `radius` at (x, y), free to move and not settled. */
  function body(x: number, y: number, radius = 0.3): Body {
    return {
      id: 1,
      pos: { x, y },
      radius,
      halfWidth: 0,
      alive: true,
      settled: false,
      monster: false,
      phasesMonsters: false,
    };
  }

  const band = shape.bounds.band!;
  const inCorner = { x: band.min / 2, y: band.min / 2 };

  it('pushes a body out of an inside corner, into the nearer spoke', () => {
    // Nothing else in the arena: the only thing that can move it is the shape.
    const walker = body(inCorner.x, inCorner.y);
    slideStep(walker, 0, 0, 0, [], shape.bounds);

    const offX = walker.pos.x < band.min - 1e-9;
    const offY = walker.pos.y < band.min - 1e-9;
    expect(offX && offY).toBe(false);
  });

  it('takes the shorter way back in', () => {
    // Deeper past the band on y than on x, so x is the shorter push and the
    // body should end up in the vertical spoke rather than the horizontal one.
    const walker = body(band.min - 0.5, band.min - 4);
    slideStep(walker, 0, 0, 0, [], shape.bounds);

    expect(walker.pos.x).toBeGreaterThanOrEqual(band.min + walker.radius - 1e-9);
    expect(walker.pos.y).toBeLessThan(band.min);
  });

  it('leaves a body that is already in a spoke exactly where it is', () => {
    const inSpoke = body(band.min + 2, 1);
    const before = { ...inSpoke.pos };
    slideStep(inSpoke, 0, 0, 0, [], shape.bounds);

    expect(inSpoke.pos).toEqual(before);
  });

  it('will not let a walker cross a corner to reach the next spoke', () => {
    // Walking diagonally out of the north spoke toward the west one: the
    // corner between them is not ground, and the body stops at its edge.
    const walker = body(band.min + 0.5, 1);
    for (let i = 0; i < 40; i++) {
      slideStep(walker, -1, 0, 0.2, [], shape.bounds);
    }

    expect(walker.pos.x).toBeGreaterThanOrEqual(band.min + walker.radius - 1e-6);
  });
});

/**
 * KING OF THE HILL (§3.3, replaced). The centre square is worth holding, and
 * the whole point of it is that an army which refuses to walk into the middle
 * gives the prize away.
 *
 * Without it the arena has one correct strategy and it is not a fight: mass the
 * slowest, longest-ranged bodies you can afford, hold them at the back of your
 * spoke, and walk in once the other three have destroyed each other.
 */
describe('holding the centre (§3.3, replaced)', () => {
  const centre = data.waves.showdown.centre;

  /** Move an army's bodies onto the middle of the arena, `count` of them. */
  function stand(state: MatchState, teamId: string, count: number): void {
    const army = state.showdown!.armies.find((a) => a.teamId === teamId)!;
    const middle = shape.size / 2;
    army.units.forEach((unit, i) => {
      if (i >= count) return;
      // Spread along one row so nothing overlaps, and well inside the square.
      unit.pos.x = middle - 2 + (i % 4);
      unit.pos.y = middle - 1 + Math.floor(i / 4) * 0.6;
    });
  }

  it('knows the centre square from the spokes', () => {
    const mid = shape.size / 2;
    expect(inCentre(shape, { x: mid, y: mid })).toBe(true);
    // Down a spoke is not the middle, on either axis.
    expect(inCentre(shape, { x: mid, y: 1 })).toBe(false);
    expect(inCentre(shape, { x: 1, y: mid })).toBe(false);
    // Nor is a corner, which is not even arena.
    expect(inCentre(shape, { x: 1, y: 1 })).toBe(false);
  });

  it('is held by nobody while nobody is standing in it', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 3);
    reachShowdown(ctx, state);
    // Straight off the build grids, every body is down its own spoke.
    expect(state.showdown!.centreHolders).toEqual([]);
  });

  it('is held by whoever has the most bodies in it', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    stand(state, 'a', 2);
    stand(state, 'c', 5);
    step(ctx, state);
    expect(state.showdown!.centreHolders).toEqual(['c']);
  });

  it('is held by EVERYONE tied, so contesting is never worse than conceding', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    stand(state, 'a', 3);
    stand(state, 'c', 3);
    step(ctx, state);
    expect(state.showdown!.centreHolders.sort()).toEqual(['a', 'c']);
  });

  /**
   * Measured as a RATIO against the same body without the hill, never as an
   * absolute. A Pledge carries Shoulder to Shoulder, which also moves
   * `damageDealt` and `damageTaken`, so an absolute assertion here tests the
   * unit's ability as much as the hill and breaks the first time either is
   * tuned.
   */
  function centreFactor(unit: Afflicted): { dealt: number; taken: number } {
    const withHill = modifiersOf(unit);
    const without = modifiersOf({
      ...unit,
      statuses: unit.statuses.filter((x) => x.abilityId !== '@centre'),
    });
    return {
      dealt: withHill.damageMul / without.damageMul,
      taken: withHill.damageTakenMul / without.damageTakenMul,
    };
  }

  it('buffs every body the holder owns, not only the ones standing there', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    stand(state, 'a', 4);
    step(ctx, state);

    const holder = state.showdown!.armies.find((x) => x.teamId === 'a')!;
    const other = state.showdown!.armies.find((x) => x.teamId === 'c')!;

    for (const unit of holder.units) {
      const factor = centreFactor(unit);
      expect(factor.dealt, `${unit.id} damage`).toBeCloseTo(1 + (centre.damageDealt ?? 0), 6);
      expect(factor.taken, `${unit.id} taken`).toBeCloseTo(1 + (centre.damageTaken ?? 0), 6);
    }
    for (const unit of other.units) {
      expect(
        unit.statuses.some((x) => x.abilityId === '@centre'),
        unit.defId,
      ).toBe(false);
      expect(centreFactor(unit).dealt).toBe(1);
    }
  });

  it('takes the buff away the tick the hill is lost', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    stand(state, 'a', 4);
    step(ctx, state);
    const unit = state.showdown!.armies.find((x) => x.teamId === 'a')!.units[0]!;
    expect(centreFactor(unit).dealt).toBeGreaterThan(1);

    // Walk them all back out of the square, and hold them there.
    const army = state.showdown!.armies.find((x) => x.teamId === 'a')!;
    for (const body of army.units) {
      body.pos.x = 1.5;
      body.pos.y = shape.size / 2;
      body.moveSpeed = 0;
    }
    step(ctx, state);
    expect(state.showdown!.centreHolders).toEqual([]);
    expect(unit.statuses.some((x) => x.abilityId === '@centre')).toBe(false);
    expect(centreFactor(unit).dealt).toBe(1);
  });

  it('does not stack however many ticks it is held for', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    const army = state.showdown!.armies.find((x) => x.teamId === 'a')!;
    for (let i = 0; i < 20; i++) {
      stand(state, 'a', 4);
      for (const body of army.units) body.moveSpeed = 0;
      step(ctx, state);
    }
    const unit = army.units[0]!;
    expect(unit.statuses.filter((x) => x.abilityId === '@centre')).toHaveLength(2);
    expect(centreFactor(unit).dealt).toBeCloseTo(1 + (centre.damageDealt ?? 0), 6);
  });

  it('is in the view, so a player can see who is winning it', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 6);
    reachShowdown(ctx, state);
    startFighting(ctx, state);
    stand(state, 'c', 4);
    step(ctx, state);

    // Public to everybody, eliminated or not: the arena has no fog.
    for (const watcher of ['a', 'b', 'c', 'd']) {
      expect(viewFor(ctx, state, watcher).showdown!.centreHolders, watcher).toEqual(['c']);
    }
  });
});

/**
 * LINE OF SIGHT (§3.3, replaced; `waves.showdown.lineOfSight`).
 *
 * The arena is a cross and the four corners of its bounding square are not
 * arena - nothing stands there and nothing walks there. With the rule on they
 * are not transparent either, so the back of one spoke cannot shoot the back of
 * the next across the gap between them.
 */
describe('shooting across the void (§3.3, replaced)', () => {
  const mid = shape.size / 2;
  const band = shape.bounds.band!;

  it('lets a shot travel down a spoke and through the centre', () => {
    // South to north, the length of the vertical bar.
    expect(crossesTheVoid(shape, { x: mid, y: shape.size - 2 }, { x: mid, y: 2 })).toBe(false);
    // West to east, the length of the horizontal one.
    expect(crossesTheVoid(shape, { x: 2, y: mid }, { x: shape.size - 2, y: mid })).toBe(false);
    // And anywhere inside the middle square.
    expect(
      crossesTheVoid(
        shape,
        { x: band.min + 1, y: band.min + 1 },
        { x: band.max - 1, y: band.max - 1 },
      ),
    ).toBe(false);
  });

  it('stops a shot that would cut a corner', () => {
    // The back of the south spoke at the back of the east spoke: the line
    // between them runs through ground that is not arena.
    expect(
      crossesTheVoid(shape, { x: mid, y: shape.size - 2 }, { x: shape.size - 2, y: mid }),
    ).toBe(true);
    expect(crossesTheVoid(shape, { x: mid, y: shape.size - 2 }, { x: 2, y: mid })).toBe(true);
    expect(crossesTheVoid(shape, { x: mid, y: 2 }, { x: 2, y: mid })).toBe(true);
    expect(crossesTheVoid(shape, { x: mid, y: 2 }, { x: shape.size - 2, y: mid })).toBe(true);
  });

  it('lets neighbours shoot each other across the middle', () => {
    // Close in, the line clips the centre square rather than a corner, so two
    // armies meeting in the middle fight normally.
    expect(crossesTheVoid(shape, { x: mid, y: band.max - 1 }, { x: band.max - 1, y: mid })).toBe(
      false,
    );
  });

  it('does not block a shot that merely grazes a corner', () => {
    // The south and west spokes touch at exactly one point, (band.min,
    // band.max). A line through that point which stays outside the corner box
    // on both sides of it grazes and does not cross - two bodies diagonally
    // either side of the pinch can see each other.
    //
    // This is the case a CLOSED overlap test gets wrong. A line straight down
    // the arena's edge is rejected earlier, by the parallel-to-the-slab arm, so
    // it would not catch the difference.
    expect(
      crossesTheVoid(
        shape,
        { x: band.min - 1, y: band.max - 1 },
        { x: band.min + 1, y: band.max + 1 },
      ),
      'a graze is not a wall',
    ).toBe(false);
    // The same point, crossed the other way, goes through the corner itself.
    expect(
      crossesTheVoid(
        shape,
        { x: band.min + 1, y: band.max - 1 },
        { x: band.min - 1, y: band.max + 1 },
      ),
      'and the other diagonal is a wall',
    ).toBe(true);
    // Along the arena's edge, which the parallel arm handles.
    expect(crossesTheVoid(shape, { x: band.max, y: band.max }, { x: band.max, y: band.min })).toBe(
      false,
    );
  });

  it('is symmetric, because a wall is a wall from either side', () => {
    const a = { x: mid, y: shape.size - 3 };
    const b = { x: shape.size - 3, y: mid };
    expect(crossesTheVoid(shape, a, b)).toBe(crossesTheVoid(shape, b, a));
  });

  it('stops a body engaging a target it cannot see', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'judgement', 3);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    // Seat 0 is the south spoke and seat 1 the west, and they meet at the
    // point (band.min, band.max). Putting the southern body on the spoke's
    // LEFT edge and the western one just below the band means the line between
    // them leaves the cross the instant it crosses x = band.min - close enough
    // to shoot, and a corner in the way.
    const south = state.showdown!.armies.find((x) => x.teamId === 'a')!.units[0]!;
    const west = state.showdown!.armies.find((x) => x.teamId === 'b')!.units[0]!;
    for (const army of state.showdown!.armies) {
      for (const unit of army.units) unit.moveSpeed = 0;
    }
    south.pos.x = band.min;
    south.pos.y = band.max + 1;
    west.pos.x = band.min - 1;
    west.pos.y = band.max - 1;

    expect(
      crossesTheVoid(shape, south.pos, west.pos),
      'the fixture puts a corner between them',
    ).toBe(true);
    step(ctx, state);
    expect(south.engaged, 'engaged something through a wall').toBe(false);
    expect(state.showdown!.attacks.some((x) => x.attackerId === south.id)).toBe(false);
  });

  it('lets the same two fight once the corner is out of the way', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'judgement', 3);
    reachShowdown(ctx, state);
    startFighting(ctx, state);

    const south = state.showdown!.armies.find((x) => x.teamId === 'a')!.units[0]!;
    const west = state.showdown!.armies.find((x) => x.teamId === 'b')!.units[0]!;
    for (const army of state.showdown!.armies) {
      for (const unit of army.units) {
        unit.moveSpeed = 0;
        // Park everyone else far away so the two under test are each other's
        // only candidate.
        unit.pos.x = 1;
        unit.pos.y = 1;
        unit.alive = unit === south || unit === west;
      }
    }
    // Both just inside the centre square, where the line between them is arena.
    south.pos.x = mid;
    south.pos.y = band.max - 0.5;
    west.pos.x = band.min + 0.5;
    west.pos.y = mid;
    south.alive = true;
    west.alive = true;

    expect(crossesTheVoid(shape, south.pos, west.pos)).toBe(false);
    step(ctx, state);
    expect(south.engaged, 'refused a shot it had every right to take').toBe(true);
  });

  it('is off in a lane, which has no void to shoot across', () => {
    // The rule lives on the showdown block, and nothing in a lane consults it.
    expect(data.lane).not.toHaveProperty('lineOfSight');
    expect(data.waves.showdown.lineOfSight).toBe(true);
  });
});

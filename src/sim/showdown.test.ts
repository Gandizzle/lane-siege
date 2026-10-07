/**
 * The Final Showdown. DESIGN.md §3.3, replaced.
 *
 * The arena's geometry, the transplant out of the lanes, the countdown, the
 * free-for-all itself, and dampening's scaffolding.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { LEGS, arenaShape, crossesTheVoid, inCentre, seating, spokePosition } from './arena.ts';
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
  Rng,
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

/** How far a body is from the middle of the cross. */
function toCentre(at: { x: number; y: number }): number {
  return Math.hypot(at.x - shape.centre.x, at.y - shape.centre.y);
}

describe('the arena (§3.3, replaced)', () => {
  it('is a cross of four lane-width spokes around a centre the same width', () => {
    expect(shape.spokeWidth).toBe(data.lane.buildZone.width);
    expect(shape.spokeLength).toBe(data.lane.buildZone.depth + data.waves.showdown.approachDepth);
    // Spoke, centre, spoke.
    expect(shape.width).toBe(shape.spokeLength * 2 + shape.spokeWidth);
    expect(shape.depth).toBe(shape.width);
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
          const at = spokePosition(shape, seat, x, y);
          expect(at.x).toBeGreaterThan(0);
          expect(at.y).toBeGreaterThan(0);
          expect(at.x).toBeLessThan(shape.width);
          expect(at.y).toBeLessThan(shape.depth);
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
    const corners = new Set<string>();

    for (let seat = 0; seat < LEGS.length; seat++) {
      // Tile row 0 faced the monsters; in the arena it faces the fight.
      const front = spokePosition(shape, seat, 3, 0);
      const back = spokePosition(shape, seat, 3, data.lane.buildZone.depth - 1);

      expect(toCentre(front)).toBeLessThan(toCentre(back));
      corners.add(`${Math.round(front.x)},${Math.round(front.y)}`);
    }

    expect(corners.size).toBe(LEGS.length);
  });

  it('places tile (x, y) of the south spoke where the build grid would be', () => {
    // The seat-one layout written out: the grid at the bottom of the arena,
    // its far row nearest the centre.
    const at = spokePosition(shape, LEGS.indexOf('south'), 0, 0);
    expect(at.x).toBe(shape.spokeLength + 0.5);
    expect(at.y).toBe(shape.depth - data.lane.buildZone.depth + 0.5);
  });

  it('lays every spoke out exactly - the same bits a quarter turn always gave', () => {
    // The cross is where every balance number so far was measured, so moving
    // its layout onto the general spoke formula must not move a body by so
    // much as a rounding error. Every quantity is a half tile and every
    // direction a whole axis, so the old rotation is reproducible exactly.
    const centre = shape.width / 2;
    for (let seat = 0; seat < LEGS.length; seat++) {
      for (let x = 0; x < data.lane.buildZone.width; x++) {
        for (let y = 0; y < data.lane.buildZone.depth; y++) {
          let wantX = shape.spokeLength + x + 0.5;
          let wantY = shape.spokeLength + shape.spokeWidth + shape.approachDepth + y + 0.5;
          for (let turn = seat; turn > 0; turn--) {
            const dx = wantX - centre;
            const dy = wantY - centre;
            wantX = centre - dy;
            wantY = centre + dx;
          }
          const at = spokePosition(shape, seat, x, y);
          expect(at.x).toBe(wantX);
          expect(at.y).toBe(wantY);
        }
      }
    }
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
    for (const id of ['a', 'b', 'd']) arm(ctx, state, id, 'pledge', 2);
    arm(ctx, state, 'c', 'pledge', 5);
    reachShowdown(ctx, state);

    expect(state.showdown!.layout).toBe('cross');
    const army = state.showdown!.armies.find((a) => a.teamId === 'c')!;
    expect(army.seat).toBe(2);
    expect(army.spoke).toBe(2);
    for (const unit of army.units) {
      const want = spokePosition(shape, 2, unit.homeTileX, unit.homeTileY);
      expect(unit.pos.x).toBe(want.x);
      expect(unit.pos.y).toBe(want.y);
    }
  });

  it('fights three on a Y, each keeping their seat and taking a spoke in order', () => {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 2);
    state.teams[1]!.eliminated = true;

    reachShowdown(ctx, state);
    const showdown = state.showdown!;

    // Seat 1 is gone, and nobody is promoted into it: the seats - and so the
    // colors - are the ones the players had all match. What changes is the
    // ground they stand on.
    expect(showdown.layout).toBe('y');
    expect(showdown.armies.map((a) => a.seat)).toEqual([0, 2, 3]);
    expect(showdown.armies.map((a) => a.spoke)).toEqual([0, 1, 2]);
    const y = arenaShape(data, 'y');
    for (const army of showdown.armies) {
      for (const unit of army.units) {
        const want = spokePosition(y, army.spoke, unit.homeTileX, unit.homeTileY);
        expect(unit.pos.x).toBe(want.x);
        expect(unit.pos.y).toBe(want.y);
      }
    }
  });

  it('puts a duel on opposite spokes, whichever two seats are left', () => {
    // Seats 0 and 1 are a quarter turn apart on the cross. A duel between them
    // is still fought head on.
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', 2);
    state.teams[2]!.eliminated = true;
    state.teams[3]!.eliminated = true;

    reachShowdown(ctx, state);
    const showdown = state.showdown!;
    expect(showdown.layout).toBe('cross');
    expect(showdown.armies.map((a) => a.seat)).toEqual([0, 1]);
    expect(showdown.armies.map((a) => LEGS[a.spoke])).toEqual(['south', 'north']);
  });

  it('seats by how many arrive: four on the cross, three on the Y, two opposite', () => {
    expect(seating(4)).toEqual({ layout: 'cross', spokes: [0, 1, 2, 3] });
    expect(seating(3)).toEqual({ layout: 'y', spokes: [0, 1, 2] });
    expect(seating(2)).toEqual({ layout: 'cross', spokes: [0, 2] });
    expect(seating(1)).toEqual({ layout: 'cross', spokes: [0] });
  });

  it('puts a player with nothing standing out before the card, not on a spoke', () => {
    // Three real armies and an empty lane are three armies: they get the Y,
    // and the empty lane places last, exactly as it would have the moment the
    // card lifted.
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'c', 'd']) arm(ctx, state, id, 'pledge', 2);

    reachShowdown(ctx, state);
    const showdown = state.showdown!;
    expect(showdown.layout).toBe('y');
    expect(showdown.armies.map((a) => a.teamId)).toEqual(['a', 'c', 'd']);
    const empty = state.teams.find((t) => t.id === 'b')!;
    expect(empty.eliminated).toBe(true);
    expect(empty.placement).toBe(4);
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
          expect(unit.pos.x).toBeLessThanOrEqual(shape.width + 1e-6);
          expect(unit.pos.y).toBeLessThanOrEqual(shape.depth + 1e-6);
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
    mine.pos.x = shape.centre.x;
    mine.pos.y = shape.centre.y;
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
    // right of both of them, and the other army is up and to the left. Four
    // armies, so that it is the cross and seat 1 is west.
    const { state, ctx } = fourPlayers();
    arm(ctx, state, 'a', 'pledge', 2);
    arm(ctx, state, 'b', 'pledge', 4);
    arm(ctx, state, 'c', 'pledge', 1);
    arm(ctx, state, 'd', 'pledge', 1);
    reachShowdown(ctx, state);
    startFighting(ctx, state);
    step(ctx, state);

    const south = state.showdown!.armies.find((army) => army.teamId === 'a')!;
    expect(south.seat).toBe(0);
    for (const unit of south.units) {
      expect(unit.targetId).toBeNull();
      expect(unit.pos.x).toBeLessThan(shape.centre.x);
      // Up and to the RIGHT. Walking at the west army would mean up and left.
      expect(unit.moveY).toBeLessThan(0);
      expect(unit.moveX).toBeGreaterThan(0.2);
    }
  });

  it('walks the arena at `walkSpeed` times lane speed', () => {
    // One pledge walking at the centre for one second, at two paces. Another
    // army across the board, or the match would be over the moment the card
    // lifted and nothing would walk at all.
    const walked = (pace: number): number => {
      const paced = structuredClone(data);
      paced.waves.showdown.walkSpeed = pace;
      const teams = ['a', 'b', 'c', 'd'].map((id) => ({ id, playerIds: [id] }));
      const state = createMatch(paced, { seed: 7, teams });
      const ctx = createContext(paced);
      arm(ctx, state, 'a', 'pledge', 1);
      arm(ctx, state, 'b', 'pledge', 1);
      reachShowdown(ctx, state);
      startFighting(ctx, state);
      const unit = state.showdown!.armies[0]!.units[0]!;
      const from = toCentre(unit.pos);
      for (let i = 0; i < TICKS_PER_SECOND; i++) step(ctx, state);
      return from - toCentre(unit.pos);
    };
    expect(data.waves.showdown.walkSpeed).toBeGreaterThan(1);
    expect(walked(1)).toBeGreaterThan(0.1);
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
    const middle = shape.centre;
    army.units.forEach((unit, i) => {
      if (i >= count) return;
      // Spread along one row so nothing overlaps, and well inside the square.
      unit.pos.x = middle.x - 2 + (i % 4);
      unit.pos.y = middle.y - 1 + Math.floor(i / 4) * 0.6;
    });
  }

  it('knows the centre square from the spokes', () => {
    const mid = shape.centre.x;
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
      body.pos.y = shape.centre.y;
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
  const mid = shape.centre.x;
  const size = shape.width;
  const band = shape.bounds.band!;

  it('lets a shot travel down a spoke and through the centre', () => {
    // South to north, the length of the vertical bar.
    expect(crossesTheVoid(shape, { x: mid, y: size - 2 }, { x: mid, y: 2 })).toBe(false);
    // West to east, the length of the horizontal one.
    expect(crossesTheVoid(shape, { x: 2, y: mid }, { x: size - 2, y: mid })).toBe(false);
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
    expect(crossesTheVoid(shape, { x: mid, y: size - 2 }, { x: size - 2, y: mid })).toBe(true);
    expect(crossesTheVoid(shape, { x: mid, y: size - 2 }, { x: 2, y: mid })).toBe(true);
    expect(crossesTheVoid(shape, { x: mid, y: 2 }, { x: 2, y: mid })).toBe(true);
    expect(crossesTheVoid(shape, { x: mid, y: 2 }, { x: size - 2, y: mid })).toBe(true);
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
    const a = { x: mid, y: size - 3 };
    const b = { x: size - 3, y: mid };
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

/**
 * THE Y (§3.3, replaced): three survivors fight on three spokes a third of a
 * turn apart, so that each has the same two neighbours at the same angle.
 *
 * The checks below lean on an independent reading of the shape - a point is in
 * the Y when it is inside one of the three spoke strips - rather than on the
 * functions under test, so a wrong rotation in one cannot be agreed with by
 * the same wrong rotation in another.
 */
describe('the Y, for three (§3.3, replaced)', () => {
  const y = arenaShape(data, 'y');
  const half = y.spokeWidth / 2;

  /** Along and across spoke `i`, by hand. */
  function frame(p: { x: number; y: number }, i: number): { along: number; across: number } {
    const d = y.spokes[i]!;
    const rx = p.x - y.centre.x;
    const ry = p.y - y.centre.y;
    return { along: rx * d.x + ry * d.y, across: rx * d.y - ry * d.x };
  }

  /** Inside the Y, with `margin` to spare from every wall. */
  function insideY(p: { x: number; y: number }, margin = 0): boolean {
    return y.spokes.some((_, i) => {
      const { along, across } = frame(p, i);
      return along >= 0 && along <= y.reach - margin && Math.abs(across) <= half - margin;
    });
  }

  /** `p` turned a third of a turn clockwise about the centre. */
  function turn(p: { x: number; y: number }): { x: number; y: number } {
    const dx = p.x - y.centre.x;
    const dy = p.y - y.centre.y;
    const c = -0.5;
    const s = Math.sqrt(3) / 2;
    return { x: y.centre.x + dx * c - dy * s, y: y.centre.y + dx * s + dy * c };
  }

  function threePlayers(units = 3): { state: MatchState; ctx: SimContext } {
    const { state, ctx } = fourPlayers();
    for (const id of ['a', 'b', 'c', 'd']) arm(ctx, state, id, 'pledge', units);
    state.teams[1]!.eliminated = true;
    state.eliminatedCount = 1;
    state.teams[1]!.placement = 4;
    return { state, ctx };
  }

  it('is three lane-wide spokes a third of a turn apart, meeting in a triangle', () => {
    expect(y.spokes).toHaveLength(3);
    expect(y.spokeWidth).toBe(data.lane.buildZone.width);
    expect(y.spokeLength).toBe(shape.spokeLength);
    for (let i = 0; i < 3; i++) {
      const d = y.spokes[i]!;
      const next = y.spokes[(i + 1) % 3]!;
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
      expect(d.x * next.x + d.y * next.y).toBeCloseTo(-0.5, 12);
    }
    // The stem points down the screen, like a lane's own defenders.
    expect(y.spokes[0]).toEqual({ x: 0, y: 1 });
    // The triangle's corners are the inside corners between spokes; each side
    // is a spoke's width, so every spoke ends flush against it.
    const corners = y.spokes.map((d) => ({
      x: y.centre.x + y.hub * d.x - half * d.y,
      y: y.centre.y + y.hub * d.y + half * d.x,
    }));
    for (let i = 0; i < 3; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 3]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(y.spokeWidth, 9);
    }
    expect(y.reach).toBeCloseTo(y.hub + y.spokeLength, 12);
  });

  it('fits its bounding box, and the field grid is whole tiles', () => {
    expect(Number.isInteger(y.width)).toBe(true);
    expect(Number.isInteger(y.depth)).toBe(true);
    for (let i = 0; i < 3; i++) {
      for (const along of [y.hub, y.reach]) {
        for (const across of [-half, half]) {
          const d = y.spokes[i]!;
          const x = y.centre.x + along * d.x + across * d.y;
          const yy = y.centre.y + along * d.y - across * d.x;
          expect(x).toBeGreaterThanOrEqual(0);
          expect(yy).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(y.width);
          expect(yy).toBeLessThanOrEqual(y.depth);
        }
      }
    }
  });

  it('puts every build tile in its own spoke, clear of the middle', () => {
    const { width, depth } = data.lane.buildZone;
    for (let spoke = 0; spoke < 3; spoke++) {
      for (let x = 0; x < width; x++) {
        for (let row = 0; row < depth; row++) {
          const at = spokePosition(y, spoke, x, row);
          const { along, across } = frame(at, spoke);
          expect(along).toBeGreaterThan(y.hub + y.approachDepth);
          expect(along).toBeLessThan(y.reach);
          expect(Math.abs(across)).toBeLessThan(half);
          expect(inCentre(y, at)).toBe(false);
        }
      }
    }
  });

  it('lays every army out as the same army turned, so no spoke is a better seat', () => {
    for (let x = 0; x < data.lane.buildZone.width; x++) {
      for (let row = 0; row < data.lane.buildZone.depth; row++) {
        const south = spokePosition(y, 0, x, row);
        const left = spokePosition(y, 1, x, row);
        const right = spokePosition(y, 2, x, row);
        expect(turn(south).x).toBeCloseTo(left.x, 9);
        expect(turn(south).y).toBeCloseTo(left.y, 9);
        expect(turn(left).x).toBeCloseTo(right.x, 9);
        expect(turn(left).y).toBeCloseTo(right.y, 9);
      }
    }
    // Tile row 0 faced the monsters; in the arena it faces the fight.
    const front = spokePosition(y, 1, 3, 0);
    const back = spokePosition(y, 1, 3, data.lane.buildZone.depth - 1);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - y.centre.x, p.y - y.centre.y);
    expect(dist(front)).toBeLessThan(dist(back));
  });

  it('knows the triangle from the spokes', () => {
    expect(inCentre(y, y.centre)).toBe(true);
    for (let i = 0; i < 3; i++) {
      const d = y.spokes[i]!;
      // Just short of where the spoke's own ground starts, and just past it.
      const inside = { x: y.centre.x + (y.hub - 0.01) * d.x, y: y.centre.y + (y.hub - 0.01) * d.y };
      const outside = {
        x: y.centre.x + (y.hub + 0.01) * d.x,
        y: y.centre.y + (y.hub + 0.01) * d.y,
      };
      expect(inCentre(y, inside)).toBe(true);
      expect(inCentre(y, outside)).toBe(false);
    }
  });

  it('blocks a shot exactly when the line leaves the Y', () => {
    // Random pairs of standing points, against a brute-force walk along the
    // line. The walk can only miss a sliver too thin to sample, so it is held
    // to the cases it can decide.
    const rng = new Rng(1234);
    const point = () => {
      for (;;) {
        const p = { x: rng.next() * y.width, y: rng.next() * y.depth };
        if (insideY(p, 0.3)) return p;
      }
    };
    let blocked = 0;
    for (let n = 0; n < 2000; n++) {
      const a = point();
      const b = point();
      let worst = Infinity;
      for (let k = 0; k <= 400; k++) {
        const t = k / 400;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        // How far inside the Y this sample is: the best spoke's margin.
        const margin = Math.max(
          ...y.spokes.map((_, i) => {
            const { along, across } = frame(p, i);
            return Math.min(along, y.reach - along, half - Math.abs(across));
          }),
        );
        worst = Math.min(worst, margin);
      }
      const crosses = crossesTheVoid(y, a, b);
      expect(crossesTheVoid(y, b, a)).toBe(crosses);
      if (worst < -1e-3) expect(crosses, `${JSON.stringify([a, b])} leaves the Y`).toBe(true);
      if (worst > 1e-3) expect(crosses, `${JSON.stringify([a, b])} stays in it`).toBe(false);
      if (crosses) blocked++;
    }
    // Both answers came up often enough to mean something.
    expect(blocked).toBeGreaterThan(200);
    expect(blocked).toBeLessThan(1800);
  });

  it('lets the front ranks of neighbouring spokes see each other through the middle', () => {
    // The middle of each front row, either side of an inside corner.
    const stem = spokePosition(y, 0, 3, 0);
    const left = spokePosition(y, 1, 4, 0);
    expect(crossesTheVoid(y, stem, left)).toBe(false);
    // But not round the inside corner itself: the outer files are walled off
    // from each other, as on the cross.
    const stemEdge = spokePosition(y, 0, 0, 2);
    const leftEdge = spokePosition(y, 1, 7, 2);
    expect(crossesTheVoid(y, stemEdge, leftEdge)).toBe(true);
  });

  it('keeps every body inside the Y through a whole fight, and finishes it', () => {
    const { state, ctx } = threePlayers(8);
    reachShowdown(ctx, state);
    expect(state.showdown!.layout).toBe('y');

    let guard = 0;
    while (!state.finished && guard++ < 40000) {
      step(ctx, state);
      for (const army of state.showdown!.armies) {
        for (const unit of army.units) {
          if (!unit.alive) continue;
          expect(insideY(unit.pos, unit.radius - 1e-6), `${unit.pos.x},${unit.pos.y}`).toBe(true);
        }
      }
    }
    expect(state.finished).toBe(true);
    const placements = state.teams.map((t) => t.placement).sort();
    expect(placements).toEqual([1, 2, 3, 4]);
  });

  it('walks every army at the middle of the triangle', () => {
    const { state, ctx } = threePlayers(2);
    reachShowdown(ctx, state);
    startFighting(ctx, state);
    const before = new Map<number, number>();
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - y.centre.x, p.y - y.centre.y);
    for (const army of state.showdown!.armies) {
      for (const unit of army.units) before.set(unit.id, dist(unit.pos));
    }
    for (let i = 0; i < TICKS_PER_SECOND; i++) step(ctx, state);
    for (const army of state.showdown!.armies) {
      for (const unit of army.units) expect(dist(unit.pos)).toBeLessThan(before.get(unit.id)!);
    }
  });

  it('gives the hill to whoever has the most bodies in the triangle', () => {
    const { state, ctx } = threePlayers(3);
    reachShowdown(ctx, state);
    startFighting(ctx, state);
    const army = state.showdown!.armies.find((x) => x.teamId === 'c')!;
    army.units.forEach((unit, i) => {
      unit.pos.x = y.centre.x - 0.8 + i * 0.8;
      unit.pos.y = y.centre.y;
      unit.moveSpeed = 0;
    });
    step(ctx, state);
    expect(state.showdown!.centreHolders).toEqual(['c']);
  });

  it('tells the viewer which shape and which spoke', () => {
    const { state, ctx } = threePlayers(2);
    reachShowdown(ctx, state);
    const view = viewFor(ctx, state, 'a').showdown!;
    expect(view.layout).toBe('y');
    expect(view.armies.map((a) => [a.seat, a.spoke])).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
    ]);
  });
});

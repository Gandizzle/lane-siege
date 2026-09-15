/**
 * Besieging the fortress. DESIGN.md §5.5, §4.
 *
 * When a lane is clear of defenders the monsters go for the fortress, and that
 * is the losing condition the whole game is arranged around. Two things have to
 * hold for it to work at all: a monster that reaches the fortress must actually
 * be able to hit it, and the fortress must be wide enough that a wave can bring
 * its weight to bear rather than queueing up to take turns.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { createContext, createMatch, step } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

/**
 * A lane with no defenders, a silent fortress weapon and a fortress that
 * cannot fall, so what is measured is whether monsters can reach and hit the
 * fortress rather than whether they survive long enough to try.
 *
 * The HP pool is a fixture, not a balance number. Without it these runs end
 * early: an undefended wall now takes a whole wave's weight at once and a
 * wave-14 lane goes down inside twenty seconds, which wipes the lane (§13) and
 * leaves nothing to measure.
 */
function undefended(wave: number): { state: MatchState; ctx: SimContext } {
  const state = createMatch(data, { seed: 5, teams: [{ id: 'l1', playerIds: ['p'] }] });
  const ctx = createContext(data);
  state.wave = wave;
  state.lanes.l1!.fortress.weaponDamage = 0;
  state.lanes.l1!.fortress.maxHp = 1e9;
  state.lanes.l1!.fortress.hp = 1e9;

  let guard = 0;
  while (state.phase !== 'combat' && guard++ < 5000) step(ctx, state);
  return { state, ctx };
}

function run(ctx: SimContext, state: MatchState, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(ctx, state);
}

describe('a monster that reaches the fortress can hit it (§5.5)', () => {
  it('engages it and takes its HP down', () => {
    const { state, ctx } = undefended(14);
    const lane = state.lanes.l1!;

    run(ctx, state, 400);
    expect(lane.monsters.some((m) => m.alive && m.engaged)).toBe(true);
    expect(lane.fortress.hp).toBeLessThan(lane.fortress.maxHp);
  });

  it('keeps hitting it rather than stalling once the front row is full', () => {
    // The failure this guards against is silent: monsters stand at the wall
    // looking correct while the fortress takes no damage at all.
    const { state, ctx } = undefended(14);
    const lane = state.lanes.l1!;

    run(ctx, state, 400);
    const midway = lane.fortress.hp;
    run(ctx, state, 200);

    expect(lane.fortress.hp).toBeLessThan(midway);
  });

  it('brings a whole wave to bear, not one monster at a time', () => {
    // §4: the fortress is the width of the lane's end, so a wave arrives along
    // a front. A fortress narrow enough to admit two attackers turns the
    // losing condition into a queue.
    const { state, ctx } = undefended(16);
    const lane = state.lanes.l1!;

    let mostAtOnce = 0;
    for (let i = 0; i < 700; i++) {
      step(ctx, state);
      const attacking = lane.monsters.filter((m) => m.alive && m.engaged).length;
      if (attacking > mostAtOnce) mostAtOnce = attacking;
    }

    expect(mostAtOnce).toBeGreaterThanOrEqual(6);
  });
});

describe('a crowd at the wall (§4, §5.5)', () => {
  it('fills it from end to end, rather than piling into the middle', () => {
    // §4's whole reason for a wide fortress: a wave brings its weight to bear
    // along the whole face. This fails when a monster closes on the fortress's
    // CENTRE instead of the nearest point of it - arriving at one end, it then
    // walks the length of the wall through everything already fighting there.
    const { state, ctx } = undefended(18);
    const lane = state.lanes.l1!;
    run(ctx, state, 700);

    const engaged = lane.monsters.filter((m) => m.alive && m.engaged).map((m) => m.pos.x);
    expect(engaged.length).toBeGreaterThanOrEqual(8);
    expect(engaged.some((x) => x < 1.5)).toBe(true);
    expect(engaged.some((x) => x > 6.5)).toBe(true);
  });

  it('gets everybody in while there is still room for everybody', () => {
    // The "stuck behind an ally" a player sees: a body wedged behind two
    // others with a slot between them that is a hair too narrow to pass, which
    // the field offers it anyway. It presses into the notch for the rest of
    // the wave while free wall stands empty a few tiles away.
    const { state, ctx } = undefended(16);
    const lane = state.lanes.l1!;
    run(ctx, state, 700);

    const atWall = lane.monsters.filter((m) => m.alive && m.pos.y > 8);
    expect(atWall.length).toBeGreaterThanOrEqual(10);
    expect(atWall.filter((m) => m.engaged)).toHaveLength(atWall.length);
  });

  it('leaves the ones that genuinely do not fit standing still, not grinding', () => {
    // A wave big enough to fill the wall twice over. What is behind the front
    // rank has nowhere to go, and a body with nowhere to go stands: a knot of
    // monsters shuffling against each other for the rest of the wave is the
    // same bug wearing a different face.
    const { state, ctx } = undefended(20);
    const lane = state.lanes.l1!;
    run(ctx, state, 700);

    const waiting = lane.monsters.filter((m) => m.alive && !m.engaged && m.pos.y > 8);
    expect(waiting.length).toBeGreaterThan(0);

    const before = waiting.map((m) => ({ x: m.pos.x, y: m.pos.y }));
    run(ctx, state, 40);
    const moved = waiting.map((m, i) => Math.hypot(m.pos.x - before[i]!.x, m.pos.y - before[i]!.y));

    expect(Math.max(...moved)).toBeLessThan(0.05);
  });
});

describe('the fortress is a body like any other', () => {
  it('is as wide as the data says, and sits inside its own zone', () => {
    const ctx = createContext(data);
    const { fortress } = ctx;
    const lane = data.lane;

    // Wholly within the fortress zone: it must not swallow buildable tiles.
    expect(fortress.pos.y - fortress.radius).toBeGreaterThanOrEqual(lane.buildZone.depth);
    expect(fortress.pos.y + fortress.radius).toBeLessThanOrEqual(
      lane.buildZone.depth + lane.fortressZoneDepth,
    );

    // And inside the lane's side walls.
    expect(fortress.pos.x - fortress.halfWidth - fortress.radius).toBeGreaterThanOrEqual(0);
    expect(fortress.pos.x + fortress.halfWidth + fortress.radius).toBeLessThanOrEqual(
      lane.buildZone.width,
    );
  });

  it('is something monsters stop at rather than walk through', () => {
    const { state, ctx } = undefended(14);
    const lane = state.lanes.l1!;
    run(ctx, state, 600);

    for (const monster of lane.monsters) {
      if (!monster.alive) continue;
      // Nothing may end up past the wall's front face by more than contact
      // tolerance: the fortress is solid.
      expect(monster.pos.y).toBeLessThan(ctx.fortress.pos.y);
    }
  });
});

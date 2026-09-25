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
function undefended(
  wave: number,
  crowd?: { monsterId: string; count: number }[],
): { state: MatchState; ctx: SimContext } {
  const d = crowd ? withCrowd(wave + 1, crowd) : data;
  const state = createMatch(d, { seed: 5, teams: [{ id: 'l1', playerIds: ['p'] }] });
  const ctx = createContext(d);
  state.wave = wave;
  state.lanes.l1!.fortress.weaponDamage = 0;
  state.lanes.l1!.fortress.maxHp = 1e9;
  state.lanes.l1!.fortress.hp = 1e9;

  let guard = 0;
  while (state.phase !== 'combat' && guard++ < 5000) step(ctx, state);
  return { state, ctx };
}

/**
 * THE CROWD these tests measure, as a fixture: 27 slow, heavy bodies, a few of
 * which reach far enough to fight from the second rank.
 *
 * It used to be whatever the data said wave 21 was, and that is balance data:
 * when wave 21 became twenty Spitters that stop two tiles short of the wall,
 * the crowd never arrived and the tests failed on a wave that was working
 * exactly as designed. What a crowd at the wall does is a question about
 * movement, so the crowd is written down here.
 */
const CROWD = [
  { monsterId: 'carapace', count: 10 },
  { monsterId: 'revenant', count: 8 },
  { monsterId: 'stalker', count: 9 },
];
const CROWD_WAVE = 20;

function withCrowd(wave: number, entries: { monsterId: string; count: number }[]) {
  const d = structuredClone(data);
  const at = d.waves.composition.find((w) => w.wave === wave);
  if (at) at.entries = entries;
  return d;
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
    const { state, ctx } = undefended(CROWD_WAVE, CROWD);
    const lane = state.lanes.l1!;
    run(ctx, state, 700);

    const engaged = lane.monsters.filter((m) => m.alive && m.engaged).map((m) => m.pos.x);
    expect(engaged.length).toBeGreaterThanOrEqual(8);
    expect(engaged.some((x) => x < 1.5)).toBe(true);
    expect(engaged.some((x) => x > 6.5)).toBe(true);
  });

  it('spends its time there attacking rather than queueing', () => {
    // The "stuck behind an ally" a player sees, as a number: of all the time
    // bodies spend down at the wall, how much of it is spent swinging.
    //
    // Body-ticks rather than a head count at the end, because a head count is
    // a photograph - somebody is always still walking in, and which instant
    // you look at decides the answer. This is the whole run.
    const { state, ctx } = undefended(CROWD_WAVE, CROWD);
    const lane = state.lanes.l1!;

    let atWall = 0;
    let attacking = 0;
    for (let t = 0; t < 700; t++) {
      step(ctx, state);
      for (const monster of lane.monsters) {
        if (!monster.alive || monster.pos.y < 9) continue;
        atWall++;
        if (monster.engaged) attacking++;
      }
    }

    expect(atWall).toBeGreaterThan(2000);
    expect(attacking / atWall).toBeGreaterThan(0.87);
  });

  it('leaves nobody wobbling on the spot', () => {
    // A wave big enough to fill the wall twice over, so there are bodies that
    // cannot get in. Each of them should be doing one of two things: standing,
    // or going somewhere. What a player reported - and what this measures - is
    // the third: shuffling back and forth behind the body in front for the
    // rest of the wave, walking the whole time and arriving nowhere.
    const { state, ctx } = undefended(CROWD_WAVE, CROWD);
    const lane = state.lanes.l1!;
    run(ctx, state, 700);

    const waiting = lane.monsters.filter((m) => m.alive && !m.engaged && m.pos.y > 8);
    expect(waiting.length).toBeGreaterThan(0);

    const from = waiting.map((m) => ({ x: m.pos.x, y: m.pos.y }));
    const last = waiting.map((m) => ({ x: m.pos.x, y: m.pos.y }));
    const walked = waiting.map(() => 0);
    for (let t = 0; t < 40; t++) {
      step(ctx, state);
      waiting.forEach((m, i) => {
        walked[i] = walked[i]! + Math.hypot(m.pos.x - last[i]!.x, m.pos.y - last[i]!.y);
        last[i]!.x = m.pos.x;
        last[i]!.y = m.pos.y;
      });
    }

    waiting.forEach((m, i) => {
      // Two seconds of walking has to be two seconds of getting somewhere.
      if (walked[i]! < 0.1) return;
      const net = Math.hypot(m.pos.x - from[i]!.x, m.pos.y - from[i]!.y);
      expect(net / walked[i]!, `${m.defId} walked ${walked[i]!.toFixed(2)}`).toBeGreaterThan(0.8);
    });
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

/**
 * Solo mode (§3.3, solo): one lane, every send lands on yourself, and after
 * the last wave an endless one in place of the Final Showdown.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  applyCommand,
  createContext,
  createMatch,
  endlessPool,
  secondsToTicks,
  step,
  viewFor,
} from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();
const LAST = data.waves.showdown.afterWave;
const cfg = data.waves.endless;

function solo(seed = 5): { state: MatchState; ctx: SimContext } {
  return {
    state: createMatch(data, { seed, mode: 'solo', teams: [{ id: 'me', playerIds: ['me'] }] }),
    ctx: createContext(data),
  };
}

/** The tick after the last wave's last monster died. */
function clearLastWave(ctx: SimContext, state: MatchState): void {
  state.wave = LAST;
  state.phase = 'combat';
  state.phaseTicksLeft = 0;
  const lane = state.lanes.me!;
  lane.monsters.length = 0;
  lane.reserve.length = 0;
  state.waveClocks.length = 0;
  step(ctx, state);
}

/** Step until `done`, or fail loudly rather than hang if it never comes. */
function stepUntil(ctx: SimContext, state: MatchState, done: () => boolean, limit = 100_000): void {
  for (let i = 0; i < limit && !done(); i++) step(ctx, state);
  if (!done()) throw new Error('stepUntil: never happened');
}

/** Into the endless wave: the last wave cleared and the build phase after it run out. */
function openEndless(ctx: SimContext, state: MatchState): void {
  clearLastWave(ctx, state);
  stepUntil(ctx, state, () => state.phase !== 'build');
}

/** A unit the lane can build, and gold and supply to build plenty of them. */
function fund(state: MatchState): string {
  const lane = state.lanes.me!;
  lane.economy.gold = 100_000;
  lane.economy.gems = 10_000;
  lane.economy.supplyCap = 500;
  return data.units.units.find((u) => u.builderId === lane.builderId && u.mark === 1)!.id;
}

describe('solo mode', () => {
  it('is one lane', () => {
    expect(() =>
      createMatch(data, {
        seed: 1,
        mode: 'solo',
        teams: [
          { id: 'a', playerIds: ['a'] },
          { id: 'b', playerIds: ['b'] },
        ],
      }),
    ).toThrow(/one lane/);
  });

  it('lands every send in your own next wave, and pays its income', () => {
    const { state, ctx } = solo();
    const lane = state.lanes.me!;
    lane.economy.gems = 100;
    const send = data.sends.sends.find((s) => (s.fromWave ?? 1) <= 1)!;
    // Whatever the command names, it comes home.
    const result = applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'me',
      targetTeamId: 'somebody',
      sendId: send.id,
    });
    expect(result.ok).toBe(true);
    expect(lane.incomingSends.map((s) => s.defId)).toEqual(send.monsters);
    expect(lane.economy.passiveIncome).toBe(send.incomeGranted);

    // And they walk in with the next wave, as a send at anybody does.
    stepUntil(ctx, state, () => state.phase !== 'build');
    expect(lane.incomingSends).toHaveLength(0);
    const sent = [...lane.monsters, ...lane.reserve].filter(
      (m) => 'sendId' in m && m.sendId === send.id,
    );
    expect(sent).toHaveLength(send.monsters.length);
  });

  it('still refuses a send at yourself in a standard match', () => {
    const state = createMatch(data, {
      seed: 1,
      teams: [
        { id: 'a', playerIds: ['a'] },
        { id: 'b', playerIds: ['b'] },
      ],
    });
    const ctx = createContext(data);
    state.lanes.a!.economy.gems = 100;
    const send = data.sends.sends.find((s) => (s.fromWave ?? 1) <= 1)!;
    const result = applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'a',
      sendId: send.id,
    });
    expect(result.rejection).toBe('invalid-target');
  });

  it('follows the last wave with a build phase, not the Final Showdown', () => {
    const { state, ctx } = solo();
    clearLastWave(ctx, state);
    expect(state.showdown).toBeNull();
    expect(state.phase).toBe('build');
    expect(state.wave).toBe(LAST);
  });

  it('then opens the endless wave, which never goes back to building', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    expect(state.phase).toBe('combat');
    expect(state.wave).toBe(LAST + 1);
    expect(state.endless).not.toBeNull();

    // Kill everything as it arrives: the lane is empty again and again, and
    // the wave still does not end.
    const lane = state.lanes.me!;
    for (let i = 0; i < secondsToTicks(20); i++) {
      for (const m of lane.monsters) m.hp = 0;
      step(ctx, state);
      expect(state.phase).toBe('combat');
    }
    expect(state.showdown).toBeNull();
    expect(state.finished).toBe(false);
  });

  it('draws its stream from every monster the waves used, and a boss on its clock', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    const pool = endlessPool(data);
    const seen = new Set<string>();
    const ticks = secondsToTicks(cfg.bossEverySeconds) + 1;
    for (let i = 0; i < ticks; i++) {
      for (const m of lane.monsters) seen.add(m.defId);
      for (const m of lane.monsters) m.hp = 0;
      step(ctx, state);
    }
    for (const m of lane.monsters) seen.add(m.defId);
    for (const id of seen) {
      expect([...pool.monsters, ...pool.bosses]).toContain(id);
    }
    // A minute of stream covers most of the twelve kinds and brings a boss.
    expect([...seen].filter((id) => pool.monsters.includes(id)).length).toBeGreaterThan(6);
    expect([...seen].some((id) => pool.bosses.includes(id))).toBe(true);
    expect(pool.monsters).not.toContain('brood_sire');
  });

  it('streams the same monsters from the same seed, whatever the player does', () => {
    const drawn = (seed: number, killEverything: boolean): string[] => {
      const { state, ctx } = solo(seed);
      openEndless(ctx, state);
      const lane = state.lanes.me!;
      const ids: string[] = [];
      const known = new Set<number>();
      for (let i = 0; i < secondsToTicks(15); i++) {
        for (const m of lane.monsters) {
          if (!known.has(m.id) && m.sendId === null) {
            known.add(m.id);
            ids.push(m.defId);
          }
        }
        if (killEverything) for (const m of lane.monsters) m.hp = 0;
        step(ctx, state);
      }
      return ids;
    };
    const a = drawn(11, true);
    expect(a.length).toBeGreaterThan(5);
    expect(drawn(11, true)).toEqual(a);
    expect(drawn(12, true)).not.toEqual(a);
  });

  it('grows its bodies and quickens as it climbs', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    const grubHp = (): number[] =>
      lane.monsters.filter((m) => m.defId === 'grub').map((m) => m.maxHp);
    const early: number[] = [];
    const late: number[] = [];
    const stepTicks = secondsToTicks(cfg.stepSeconds);
    let early20 = 0;
    let late20 = 0;
    for (let i = 0; i < stepTicks * 4; i++) {
      const before = state.endless!.spawned;
      for (const m of lane.monsters) m.hp = 0;
      step(ctx, state);
      const arrived = state.endless!.spawned - before;
      if (i < stepTicks) {
        early.push(...grubHp());
        early20 += arrived;
      }
      if (i >= stepTicks * 3) {
        late.push(...grubHp());
        late20 += arrived;
      }
    }
    expect(Math.max(...late)).toBeGreaterThan(Math.max(...early));
    expect(late20).toBeGreaterThan(early20);
  });

  it('counts every kill, and shows the count', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    let killed = 0;
    for (let i = 0; i < secondsToTicks(10); i++) {
      for (const m of lane.monsters) {
        if (m.alive && m.hp > 0) {
          m.hp = 0;
          killed++;
        }
      }
      step(ctx, state);
    }
    expect(killed).toBeGreaterThan(3);
    expect(lane.kills).toBe(killed);
    const view = viewFor(ctx, state, 'me');
    expect(view.solo?.kills).toBe(killed);
    expect(view.solo?.endless?.ageTicks).toBe(state.endless!.age);
  });

  it('keeps the board open during the endless wave, and only then', () => {
    const { state, ctx } = solo();
    const unitDefId = fund(state);
    // A standard wave: the line is shut while it runs.
    stepUntil(ctx, state, () => state.phase !== 'build');
    expect(
      applyCommand(ctx, state, { kind: 'placeUnit', teamId: 'me', unitDefId, tileX: 0, tileY: 0 })
        .rejection,
    ).toBe('not-build-phase');

    openEndless(ctx, state);
    fund(state);
    const placed = applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'me',
      unitDefId,
      tileX: 1,
      tileY: 1,
    });
    expect(placed.ok).toBe(true);
  });

  it('stands a fallen unit back up on its tile after a while', () => {
    const { state, ctx } = solo();
    const unitDefId = fund(state);
    applyCommand(ctx, state, { kind: 'placeUnit', teamId: 'me', unitDefId, tileX: 2, tileY: 3 });
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    const unit = lane.units[0]!;
    unit.hp = 0;
    step(ctx, state);
    expect(unit.alive).toBe(false);
    // One unit cannot hold a wave-26 stream, so the stream is cleared off and
    // the wall kept up while the clock runs.
    for (let i = 0; i < secondsToTicks(cfg.respawnSeconds) + 2; i++) {
      lane.monsters.length = 0;
      lane.reserve.length = 0;
      lane.fortress.hp = lane.fortress.maxHp;
      if (i === 5) expect(unit.alive).toBe(false);
      step(ctx, state);
    }
    expect(unit.alive).toBe(true);
    expect(unit.hp).toBe(unit.maxHp);
    expect(unit.homeTileX).toBe(2);
  });

  it('pays the passive income every step, as a wave would', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    lane.economy.passiveIncome = 77;
    const stepTicks = secondsToTicks(cfg.stepSeconds);
    // The wall is kept standing so the clock keeps running, and the monsters
    // are lifted off without dying, so no bounty muddies the count.
    const clear = () => {
      lane.fortress.hp = lane.fortress.maxHp;
      lane.monsters.length = 0;
      lane.reserve.length = 0;
    };
    for (let i = 0; i < 10_000 && state.endless!.age % stepTicks !== stepTicks - 1; i++) {
      clear();
      step(ctx, state);
    }
    clear();
    const goldBefore = lane.economy.gold;
    step(ctx, state);
    expect(lane.economy.gold - goldBefore).toBe(77);
  });

  it('lands a send made during the endless wave straight away', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    lane.economy.gems = 1000;
    const send = data.sends.sends[0]!;
    applyCommand(ctx, state, { kind: 'send', teamId: 'me', targetTeamId: 'me', sendId: send.id });
    step(ctx, state);
    expect(lane.incomingSends).toHaveLength(0);
    const arrived = [...lane.monsters, ...lane.reserve] as { sendId?: string | null }[];
    expect(arrived.some((m) => m.sendId === send.id)).toBe(true);
  });

  it('ends when the fortress falls', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    state.lanes.me!.fortress.hp = 0;
    step(ctx, state);
    expect(state.finished).toBe(true);
    expect(viewFor(ctx, state, 'me').eliminated).toBe(true);
  });

  it('is a standard match unless asked', () => {
    const state = createMatch(data, { seed: 1, teams: [{ id: 'x', playerIds: ['x'] }] });
    expect(state.mode).toBe('standard');
    expect(viewFor(createContext(data), state, 'x').solo).toBeNull();
  });
});

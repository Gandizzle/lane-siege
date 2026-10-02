/**
 * Solo mode (§3.3, solo): one lane, every send lands on yourself, and after
 * the last wave an endless one in place of the Final Showdown.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  applyCommand,
  bossBatchSize,
  countLiving,
  createContext,
  createMatch,
  endlessPool,
  secondsToTicks,
  step,
  viewFor,
} from './index.ts';
import type { Command, MatchState, SimContext } from './index.ts';

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

  it('then opens the endless wave, which never goes back to building', { timeout: 60_000 }, () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    expect(state.phase).toBe('combat');
    expect(state.wave).toBe(LAST + 1);
    expect(state.endless).not.toBeNull();

    // Kill everything as it arrives: the lane is empty again and again, and
    // the wave still does not end.
    const lane = state.lanes.me!;
    for (let i = 0; i < secondsToTicks(10); i++) {
      for (const m of lane.monsters) m.hp = 0;
      step(ctx, state);
      expect(state.phase).toBe('combat');
    }
    expect(state.showdown).toBeNull();
    expect(state.finished).toBe(false);
  });

  it('draws its stream from every monster the waves used', { timeout: 60_000 }, () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    const pool = endlessPool(data);
    const seen = new Set<string>();
    for (let i = 0; i < secondsToTicks(20); i++) {
      for (const m of lane.monsters) seen.add(m.defId);
      for (const m of lane.monsters) m.hp = 0;
      step(ctx, state);
    }
    for (const id of seen) expect(pool.monsters).toContain(id);
    expect(seen.size).toBeGreaterThan(6);
    expect(pool.monsters).not.toContain('brood_sire');
  });

  it('fills the field to its cap at once, and replaces every monster that dies', () => {
    // Not a trickle that speeds up: thirty on the field from the start (§8.1),
    // and one more for each that falls.
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    const cap = data.waves.maxConcurrentMonsters;
    let ticks = 0;
    for (; ticks < secondsToTicks(5) && countLiving(lane, 'wave') < cap; ticks++) {
      lane.fortress.hp = lane.fortress.maxHp;
      step(ctx, state);
    }
    expect(countLiving(lane, 'wave')).toBe(cap);
    // The clump spawns together; any the zone has no ground for follow within
    // a second or two, as the front of it walks out.
    expect(ticks).toBeLessThan(secondsToTicks(3));

    // Never more than the cap, and every death made good.
    for (let round = 0; round < 5; round++) {
      const victims = lane.monsters.filter((m) => m.alive).slice(0, 4);
      for (const m of victims) m.hp = 0;
      for (let i = 0; i < 4; i++) {
        lane.fortress.hp = lane.fortress.maxHp;
        step(ctx, state);
        expect(countLiving(lane, 'wave')).toBeLessThanOrEqual(cap);
      }
      expect(countLiving(lane, 'wave')).toBe(cap);
    }
    // The stream never queues: it is drawn when there is room for it.
    expect(lane.reserve).toHaveLength(0);
  });

  it('brings bosses in batches on a clock, more of them as it goes', { timeout: 60_000 }, () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    const pool = endlessPool(data);
    const isBoss = (defId: string) => pool.bosses.includes(defId);
    const batch = secondsToTicks(cfg.bossEverySeconds);
    const batches = 4;
    const sizes = Array.from({ length: batches }, (_, b) => bossBatchSize(data, b));
    expect(sizes[batches - 1]!).toBeGreaterThan(sizes[0]!);

    // A place made for every boss that is due, so each walks in as it falls
    // due rather than when the wall's weapon happens to free one.
    let bosses = 0;
    const known = new Set<number>();
    for (let i = 0; i < batch * batches + 10; i++) {
      let room = state.endless!.bossesDue;
      for (const m of lane.monsters) {
        if (!m.alive) continue;
        if (isBoss(m.defId)) {
          if (!known.has(m.id)) bosses++;
          known.add(m.id);
        } else if (room > 0) {
          m.hp = 0;
          room--;
        }
      }
      lane.fortress.hp = lane.fortress.maxHp;
      step(ctx, state);
    }
    for (const m of lane.monsters) if (m.alive && isBoss(m.defId) && !known.has(m.id)) bosses++;
    expect(state.endless!.batches).toBe(batches);
    expect(bosses).toBe(sizes.reduce((a, b) => a + b, 0));
    expect(state.endless!.bossesDue).toBe(0);
    // And the view says what the next batch brings.
    expect(viewFor(ctx, state, 'me').solo!.endless!.nextBosses).toBe(bossBatchSize(data, batches));
  });

  it('gives a boss that falls due the next place free, ahead of the stream', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    const pool = endlessPool(data);
    const isBoss = (defId: string) => pool.bosses.includes(defId);
    // Nothing dies on an empty board with a wall that cannot fall, so the
    // field stays full and the first batch has to wait.
    stepUntil(ctx, state, () => {
      lane.fortress.hp = lane.fortress.maxHp;
      return state.endless!.bossesDue > 0;
    });
    expect(lane.monsters.some((m) => m.alive && isBoss(m.defId))).toBe(false);
    // One place frees up: the boss takes it.
    lane.monsters.find((m) => m.alive)!.hp = 0;
    for (let i = 0; i < 3; i++) {
      lane.fortress.hp = lane.fortress.maxHp;
      step(ctx, state);
    }
    expect(lane.monsters.filter((m) => m.alive && isBoss(m.defId))).toHaveLength(1);
    expect(state.endless!.bossesDue).toBe(cfg.firstBosses - 1);
  });

  it('grows its bodies as it climbs', () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    // How many times its written health a stream body has: the growth curve
    // at the step it was drawn in (§9.1).
    const growth = (): number => {
      const body = lane.monsters.find((m) => m.alive && m.sendId === null)!;
      const def = data.monsters.monsters.find((d) => d.id === body.defId)!;
      return body.maxHp / def.hp!;
    };
    step(ctx, state);
    const first = growth();
    // Three steps on, everything drawn is grown three waves further.
    for (const m of lane.monsters) m.hp = 0;
    state.endless!.age = secondsToTicks(cfg.stepSeconds) * 3;
    step(ctx, state);
    step(ctx, state);
    expect(growth()).toBeGreaterThan(first);
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

  it('sells nothing once the endless wave opens: only sends', () => {
    const { state, ctx } = solo();
    const unitDefId = fund(state);
    // The last build phase is the last chance to spend.
    clearLastWave(ctx, state);
    expect(
      applyCommand(ctx, state, { kind: 'placeUnit', teamId: 'me', unitDefId, tileX: 0, tileY: 0 })
        .ok,
    ).toBe(true);
    stepUntil(ctx, state, () => state.phase !== 'build');
    expect(state.endless).not.toBeNull();
    fund(state);
    const lane = state.lanes.me!;
    const unitId = lane.units[0]!.id;
    const refused = (command: Command) => applyCommand(ctx, state, command).rejection;

    expect(refused({ kind: 'placeUnit', teamId: 'me', unitDefId, tileX: 1, tileY: 1 })).toBe(
      'sends-only',
    );
    expect(refused({ kind: 'upgradeUnit', teamId: 'me', unitId })).toBe('sends-only');
    expect(refused({ kind: 'sellUnit', teamId: 'me', unitId })).toBe('sends-only');
    expect(refused({ kind: 'buyTech', teamId: 'me', trackId: 'dmg_pierce' })).toBe('sends-only');
    expect(refused({ kind: 'buyFortressUpgrade', teamId: 'me', upgradeId: 'hp' })).toBe(
      'sends-only',
    );
    expect(refused({ kind: 'buySupply', teamId: 'me' })).toBe('sends-only');
    expect(refused({ kind: 'setWeaponType', teamId: 'me', damageType: 'arcane' })).toBe(
      'sends-only',
    );
    expect(refused({ kind: 'setAura', teamId: 'me', aura: 'regeneration' })).toBe('sends-only');
    expect(lane.units).toHaveLength(1);

    const send = data.sends.sends[0]!;
    expect(
      applyCommand(ctx, state, { kind: 'send', teamId: 'me', targetTeamId: 'me', sendId: send.id })
        .ok,
    ).toBe(true);
  });

  it(
    'leaves a fallen unit fallen: there is no build phase to stand it back up',
    { timeout: 60_000 },
    () => {
      const { state, ctx } = solo();
      const unitDefId = fund(state);
      clearLastWave(ctx, state);
      applyCommand(ctx, state, { kind: 'placeUnit', teamId: 'me', unitDefId, tileX: 2, tileY: 3 });
      stepUntil(ctx, state, () => state.phase !== 'build');
      const lane = state.lanes.me!;
      const unit = lane.units[0]!;
      unit.hp = 0;
      step(ctx, state);
      expect(unit.alive).toBe(false);
      // Past the fifteen seconds it used to stand back up after, with a wall
      // that cannot fall so nothing else ends the test early.
      lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
      for (let i = 0; i < secondsToTicks(20); i++) {
        lane.fortress.hp = lane.fortress.maxHp;
        step(ctx, state);
        expect(unit.alive).toBe(false);
      }
    },
  );

  it(
    'pays no gold once it opens: there is nothing left to spend it on',
    { timeout: 60_000 },
    () => {
      const { state, ctx } = solo();
      openEndless(ctx, state);
      const lane = state.lanes.me!;
      lane.economy.passiveIncome = 77;
      lane.economy.gems = 10_000;
      const goldBefore = lane.economy.gold;
      // Two steps' worth, every body killed as it comes and a send made as
      // often as its cooldown allows.
      for (let i = 0; i < secondsToTicks(cfg.stepSeconds) * 2 + 2; i++) {
        if (i % 10 === 0) for (const m of lane.monsters) m.hp = 0;
        lane.fortress.hp = lane.fortress.maxHp;
        applyCommand(ctx, state, {
          kind: 'send',
          teamId: 'me',
          targetTeamId: 'me',
          sendId: data.sends.sends[0]!.id,
        });
        step(ctx, state);
      }
      expect(lane.kills).toBeGreaterThan(30);
      expect(lane.economy.gold).toBe(goldBefore);
    },
  );

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

  it(
    'lets a send in beside a stream that has filled its own pool, so switching sends off stops them at once',
    { timeout: 60_000 },
    () => {
      // The playtest report: auto-send on through the endless wave, then off -
      // and swarmlings kept walking in for minutes, with no gems spent. They
      // had been paid for; they were queued behind the stream. Sends have a
      // pool of their own (§8.1, amended), so a full field holds none back.
      const { state, ctx } = solo();
      openEndless(ctx, state);
      const lane = state.lanes.me!;
      // A wall nothing can bring down in one tick, however far the stream climbs.
      lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
      const wall = () => {
        lane.fortress.hp = lane.fortress.maxHp;
      };
      stepUntil(ctx, state, () => {
        wall();
        return countLiving(lane, 'wave') === data.waves.maxConcurrentMonsters;
      });

      // Auto-send, as the build bar does it: again whenever the cooldown allows.
      const send = data.sends.sends[0]!;
      lane.economy.gems = 10_000;
      let sent = 0;
      while (sent < 10) {
        wall();
        const command = {
          kind: 'send',
          teamId: 'me',
          targetTeamId: 'me',
          sendId: send.id,
        } as const;
        if (applyCommand(ctx, state, command).ok) sent++;
        step(ctx, state);
        // Every one walks straight in: nothing of theirs is queued.
        expect(lane.reserve.some((queued) => queued.sendId)).toBe(false);
      }

      // Switched off: there is nothing still to come.
      expect(viewFor(ctx, state, 'me').lane!.reserveSends).toBe(0);
      expect(countLiving(lane)).toBeGreaterThan(data.waves.maxConcurrentMonsters);
    },
  );

  it('queues sends only behind sends, when their own pool is full', { timeout: 60_000 }, () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    const wall = () => {
      lane.fortress.hp = lane.fortress.maxHp;
    };
    stepUntil(ctx, state, () => {
      wall();
      return countLiving(lane, 'wave') === data.waves.maxConcurrentMonsters;
    });

    // More sends than their pool holds, bought at once.
    const sendCap = data.waves.maxConcurrentSends;
    lane.economy.gems = 100_000;
    for (let i = 0; i < sendCap + 4; i++) {
      lane.sendCooldowns = {};
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'me',
        targetTeamId: 'me',
        sendId: data.sends.sends[0]!.id,
      });
    }
    // Some may wait a tick or two for ground in the spawn zone, too.
    for (let i = 0; i < 40 && countLiving(lane, 'sends') < sendCap; i++) {
      wall();
      step(ctx, state);
    }
    expect(countLiving(lane, 'sends')).toBe(sendCap);
    const sendsQueued = () => lane.reserve.filter((queued) => queued.sendId).length;
    expect(sendsQueued()).toBe(4);
    expect(viewFor(ctx, state, 'me').lane!.reserveSends).toBe(4);

    // A send dies: the next send walks in.
    lane.monsters.find((m) => m.alive && m.sendId)!.hp = 0;
    for (let i = 0; i < 3; i++) {
      wall();
      step(ctx, state);
    }
    expect(sendsQueued()).toBe(3);
    expect(countLiving(lane, 'sends')).toBe(sendCap);
  });

  it('keeps its own thirty on the field however many sends are queued', { timeout: 60_000 }, () => {
    const { state, ctx } = solo();
    openEndless(ctx, state);
    const lane = state.lanes.me!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    const wall = () => {
      lane.fortress.hp = lane.fortress.maxHp;
    };
    lane.economy.gems = 100_000;
    for (let i = 0; i < data.waves.maxConcurrentSends * 2; i++) {
      lane.sendCooldowns = {};
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'me',
        targetTeamId: 'me',
        sendId: data.sends.sends[0]!.id,
      });
    }
    for (let i = 0; i < secondsToTicks(3); i++) {
      wall();
      step(ctx, state);
    }
    expect(lane.reserve.filter((queued) => queued.sendId).length).toBeGreaterThan(0);
    expect(countLiving(lane, 'wave')).toBe(data.waves.maxConcurrentMonsters);

    // Stream bodies die: stream bodies replace them, and no send jumps in.
    const queued = lane.reserve.length;
    for (const m of lane.monsters.filter((b) => b.alive && !b.sendId).slice(0, 5)) m.hp = 0;
    for (let i = 0; i < 3; i++) {
      wall();
      step(ctx, state);
    }
    expect(countLiving(lane, 'wave')).toBe(data.waves.maxConcurrentMonsters);
    expect(lane.reserve.length).toBe(queued);
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

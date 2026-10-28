/**
 * Saved builds (ghost.ts): what is kept of a lane's play, and how it is played
 * back in a match it was not recorded in.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  applyCommand,
  createContext,
  createMatch,
  step,
  type Command,
  type CommandResult,
  type MatchState,
} from '../sim/index.ts';
import { AutoBuilder } from './autoBuilder.ts';
import {
  GhostPlayer,
  GhostRecorder,
  moment,
  portable,
  type GhostAction,
  type GhostCommand,
} from './ghost.ts';

const { data } = loadDataFromDisk();
const SEATS = ['a', 'b', 'c', 'd'];

/**
 * Lane `a` for the lane under test, and three that cannot fall and hold
 * nothing up, as the bot tests have it: a match that runs its waves.
 */
function table(seed: number) {
  const builders = data.units.builders.map((b) => b.id);
  const state = createMatch(data, {
    seed,
    teams: SEATS.map((id, i) => ({
      id,
      playerIds: [id],
      builderId: builders[i % builders.length]!,
    })),
  });
  const ctx = createContext(data);
  const tick = (): void => {
    step(ctx, state, []);
    for (const id of ['b', 'c', 'd']) {
      const lane = state.lanes[id]!;
      for (const monster of lane.monsters) if (monster.alive) monster.hp = 0;
      lane.fortress.hp = lane.fortress.maxHp;
    }
  };
  return { state, ctx, tick };
}

/** Lane a's board, as what stands where. */
function board(state: MatchState): string[] {
  return state.lanes.a!.units.map((u) => `${u.defId}@${u.homeTileX},${u.homeTileY}`).sort();
}

/** Until the build phase after `wave`, or a long while. */
function until(state: MatchState, wave: number, tick: () => void): void {
  for (let i = 0; i < 40_000 && !(state.wave === wave && state.phase === 'build'); i++) tick();
}

/** A bot's play in lane a, recorded as the server records a player's. */
function record(seed: number, waves: number): GhostAction[] {
  const { state, ctx, tick } = table(seed);
  const bot = new AutoBuilder(data, 'a', state.lanes.a!.builderId, { seed, sends: false });
  const recorder = new GhostRecorder();
  until(state, waves, () => {
    for (const command of bot.plan(state)) {
      const kept = portable(command, state, SEATS);
      if (applyCommand(ctx, state, command).ok && kept) recorder.add('a', state, kept);
    }
    tick();
  });
  return recorder.actionsOf('a');
}

/** A recording played in lane a of a fresh match. */
function replay(actions: GhostAction[], seed: number, waves: number) {
  const { state, ctx, tick } = table(seed);
  const ghost = new GhostPlayer('a', actions, SEATS);
  until(state, waves, () => {
    ghost.act(state, (command) => applyCommand(ctx, state, command));
    tick();
  });
  return { state, ghost };
}

const SLOW = { timeout: 60_000 };

describe('a saved build played back', SLOW, () => {
  it('builds what was built, where it was built, in the match it came from', () => {
    const actions = record(3, 3);
    expect(actions.length).toBeGreaterThan(5);
    const original = table(3);
    const bot = new AutoBuilder(data, 'a', original.state.lanes.a!.builderId, {
      seed: 3,
      sends: false,
    });
    until(original.state, 3, () => {
      for (const command of bot.plan(original.state))
        applyCommand(original.ctx, original.state, command);
      original.tick();
    });

    const { state } = replay(actions, 3, 3);
    expect(board(original.state).length).toBeGreaterThan(3);
    expect(board(state)).toEqual(board(original.state));
  });

  it('opens the same way in a match it was not recorded in, and keeps playing', () => {
    const actions = record(3, 3);
    const opening = actions.filter(
      (a) => moment(a.wave, a.combat) === 0 && a.do.kind === 'placeUnit',
    );
    const { state, ghost } = replay(actions, 11, 3);
    const placed = new Set(board(state));
    for (const a of opening) {
      const place = a.do as Extract<GhostCommand, { kind: 'placeUnit' }>;
      const tile = `@${place.tileX},${place.tileY}`;
      expect(
        [...placed].some((u) => u.endsWith(tile)),
        tile,
      ).toBe(true);
    }
    // Whatever waits for gold that came slower this time is still in hand,
    // not thrown away: the backlog is small, not the whole recording.
    expect(ghost.remaining).toBeLessThan(actions.length / 2);
  });
});

describe('what is kept of a lane', () => {
  it('names a unit by its tile, and a target by its seat round the table', () => {
    const { state, ctx } = table(5);
    const lane = state.lanes.a!;
    const def = data.units.units.find((u) => u.builderId === lane.builderId && u.mark === 1)!;
    const place: Command = {
      kind: 'placeUnit',
      teamId: 'a',
      unitDefId: def.id,
      tileX: 2,
      tileY: 3,
    };
    expect(applyCommand(ctx, state, place).ok).toBe(true);
    const unit = lane.units[0]!;
    expect(portable({ kind: 'upgradeUnit', teamId: 'a', unitId: unit.id }, state, SEATS)).toEqual({
      kind: 'upgradeUnit',
      tileX: 2,
      tileY: 3,
    });
    expect(portable({ kind: 'sellUnit', teamId: 'a', unitId: 999_999 }, state, SEATS)).toBeNull();
    expect(
      portable({ kind: 'send', teamId: 'c', targetTeamId: 'a', sendId: 's' }, state, SEATS),
    ).toEqual({ kind: 'send', sendId: 's', seat: 2 });
  });

  it('keeps a unit placed and sold in one build phase as nothing, and a later sale as a sale', () => {
    const recorder = new GhostRecorder();
    const at = (wave: number, phase: MatchState['phase']) => ({ wave, phase }) as MatchState;
    const place: GhostCommand = { kind: 'placeUnit', unitDefId: 'x', tileX: 1, tileY: 1 };
    const tile = { tileX: 1, tileY: 1 };
    recorder.add('a', at(2, 'build'), place);
    recorder.add('a', at(2, 'build'), { kind: 'upgradeUnit', ...tile });
    recorder.add('a', at(2, 'build'), { kind: 'buySupply' });
    recorder.add('a', at(2, 'build'), { kind: 'sellUnit', ...tile });
    expect(recorder.actionsOf('a').map((a) => a.do.kind)).toEqual(['buySupply']);

    recorder.add('a', at(2, 'build'), place);
    recorder.add('a', at(3, 'build'), { kind: 'sellUnit', ...tile });
    expect(recorder.actionsOf('a').map((a) => a.do.kind)).toEqual([
      'buySupply',
      'placeUnit',
      'sellUnit',
    ]);
  });

  it('dates the fighting of a wave between the build phases either side of it', () => {
    expect(moment(3, false)).toBeLessThan(moment(4, true));
    expect(moment(4, true)).toBeLessThan(moment(4, false));
  });
});

describe('playing it back', () => {
  /** A match in its first build phase, and every command the ghost tries, answered by `answer`. */
  function harness(actions: GhostAction[], answer: (c: Command) => CommandResult) {
    const { state } = table(5);
    const tried: Command[] = [];
    const ghost = new GhostPlayer('a', actions, SEATS);
    const act = () =>
      ghost.act(state, (command) => {
        tried.push(command);
        return answer(command);
      });
    return { state, ghost, tried, act };
  }
  const now = (command: GhostCommand): GhostAction => ({ wave: 0, combat: false, do: command });

  it('waits for the money, and lets nothing after it go first', () => {
    let gold = false;
    const { ghost, tried, act } = harness(
      [
        now({ kind: 'placeUnit', unitDefId: 'x', tileX: 0, tileY: 0 }),
        now({ kind: 'buyTech', trackId: 't' }),
      ],
      (c) =>
        c.kind === 'placeUnit' && !gold
          ? { ok: false, rejection: 'insufficient-gold' }
          : { ok: true },
    );
    act();
    expect(tried.map((c) => c.kind)).toEqual(['placeUnit']);
    expect(ghost.remaining).toBe(2);
    gold = true;
    act();
    expect(tried.map((c) => c.kind)).toEqual(['placeUnit', 'placeUnit', 'buyTech']);
    expect(ghost.remaining).toBe(0);
  });

  it('lets a cooling ladder wait without holding up the rest', () => {
    const { ghost, tried, act } = harness(
      [
        now({ kind: 'buyTech', trackId: 't' }),
        now({ kind: 'buyTech', trackId: 't' }),
        now({ kind: 'buySupply' }),
      ],
      (c) => (c.kind === 'buyTech' ? { ok: false, rejection: 'on-cooldown' } : { ok: true }),
    );
    act();
    expect(tried.map((c) => c.kind)).toEqual(['buyTech', 'buySupply']);
    expect(ghost.remaining).toBe(2);
  });

  it('lets go of what cannot happen here, and waits for what is still to come', () => {
    const { ghost, tried, act } = harness(
      [
        now({ kind: 'placeUnit', unitDefId: 'x', tileX: 0, tileY: 0 }),
        now({ kind: 'upgradeUnit', tileX: 5, tileY: 5 }),
        { wave: 3, combat: false, do: { kind: 'buySupply' } },
      ],
      () => ({ ok: false, rejection: 'tile-occupied' }),
    );
    act();
    // The upgrade names a tile with nothing on it: never tried at all.
    expect(tried.map((c) => c.kind)).toEqual(['placeUnit']);
    expect(ghost.remaining).toBe(1);
  });

  it('sends at the seat it sent at before, or the next one round still standing', () => {
    const { state, tried, act } = harness(
      [now({ kind: 'send', sendId: 's', seat: 1 }), now({ kind: 'send', sendId: 'r', seat: 3 })],
      () => ({ ok: true }),
    );
    state.teams.find((t) => t.id === 'b')!.eliminated = true;
    act();
    expect(tried).toEqual([
      { kind: 'send', teamId: 'a', targetTeamId: 'c', sendId: 's' },
      { kind: 'send', teamId: 'a', targetTeamId: 'd', sendId: 'r' },
    ]);
  });
});

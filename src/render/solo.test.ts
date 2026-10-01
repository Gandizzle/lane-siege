/**
 * What the renderer makes of a solo match (§3.3, solo): which preview the lane
 * draws, when the board is open, and how the endless wave's clock reads. The
 * simulation's side is src/sim/solo.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { boardOpenIn, createContext, createMatch, step, viewFor } from '../sim/index.ts';
import type { MatchState } from '../sim/index.ts';
import { comesNext } from './laneView.ts';
import { clock } from './ui/text.ts';

const { data } = loadDataFromDisk();
const ctx = createContext(data);
const last = data.waves.showdown.afterWave;

function solo(): MatchState {
  return createMatch(data, { seed: 5, mode: 'solo', teams: [{ id: 'me', playerIds: ['me'] }] });
}

function standard(): MatchState {
  return createMatch(data, {
    seed: 5,
    teams: ['a', 'b'].map((id) => ({ id, playerIds: [id] })),
  });
}

/** The build phase after the last wave, and then the endless wave itself. */
function lastBuild(state: MatchState): MatchState {
  state.wave = last;
  state.phase = 'build';
  state.phaseTicksLeft = 1;
  return state;
}

function endless(state: MatchState): MatchState {
  lastBuild(state);
  for (let guard = 0; !state.endless && guard < 10_000; guard++) step(ctx, state);
  return state;
}

describe('the solo renderer', () => {
  it('previews the next wave until the last one is behind you', () => {
    const state = solo();
    expect(comesNext(data, viewFor(ctx, state, 'me'))).toBe('wave');
    state.wave = last - 1;
    expect(comesNext(data, viewFor(ctx, state, 'me'))).toBe('wave');
    state.phase = 'combat';
    state.wave = last;
    expect(comesNext(data, viewFor(ctx, state, 'me'))).toBe('wave');
  });

  it('previews the endless wave from the build phase before it, and during it', () => {
    const state = lastBuild(solo());
    expect(comesNext(data, viewFor(ctx, state, 'me'))).toBe('endless');
    endless(state);
    expect(state.endless).not.toBeNull();
    expect(comesNext(data, viewFor(ctx, state, 'me'))).toBe('endless');
  });

  it('never previews an endless wave in a standard match', () => {
    const state = lastBuild(standard());
    expect(comesNext(data, viewFor(ctx, state, 'a'))).toBe('wave');
  });

  it('opens the board in the build phase and the endless wave, and not in an ordinary fight', () => {
    const state = solo();
    expect(boardOpenIn(viewFor(ctx, state, 'me'))).toBe(true);
    state.phase = 'combat';
    expect(boardOpenIn(viewFor(ctx, state, 'me'))).toBe(false);
    endless(state);
    expect(state.phase).toBe('combat');
    expect(boardOpenIn(viewFor(ctx, state, 'me'))).toBe(true);
  });

  it('reads the endless clock as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9.6)).toBe('0:09');
    expect(clock(61)).toBe('1:01');
    expect(clock(3600)).toBe('60:00');
  });
});

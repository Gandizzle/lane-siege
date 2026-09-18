/**
 * The §15.1 guarantee, tested end to end.
 *
 * If two runs of the same seed ever diverge, everything DESIGN.md builds on top
 * of the pure-module decision collapses: replays stop being exact, desync
 * detection starts firing on honest clients, and headless balance sweeps stop
 * meaning anything. So this is the test that matters most in the file tree.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { createContext, createMatch, step } from './index.ts';
import type { Command, MatchState } from './index.ts';

const { data } = loadDataFromDisk();

function runMatch(seed: number, ticks: number, players = 2): MatchState {
  const teams = Array.from({ length: players }, (_, i) => ({
    id: `lane${i + 1}`,
    playerIds: [`p${i + 1}`],
  }));

  const state = createMatch(data, { seed, teams });
  const ctx = createContext(data);

  for (let t = 0; t < ticks; t++) {
    const commands: Command[] = [];
    // Build a line on the first tick so there is real combat to diverge over.
    if (t === 0) {
      for (const team of teams) {
        commands.push(
          { kind: 'placeUnit', teamId: team.id, unitDefId: 'pledge', tileX: 3, tileY: 3 },
          { kind: 'placeUnit', teamId: team.id, unitDefId: 'sentinel', tileX: 4, tileY: 5 },
          { kind: 'placeUnit', teamId: team.id, unitDefId: 'sanction', tileX: 3, tileY: 7 },
        );
      }
    }
    step(ctx, state, commands);
  }
  return state;
}

/** Uint8Array does not survive JSON.stringify usefully; normalise it first. */
function fingerprint(state: MatchState): string {
  return JSON.stringify(state, (key, value) =>
    key === 'cells' ? Array.from(value as Uint8Array) : value,
  );
}

describe('determinism (DESIGN.md §15.1)', () => {
  it('produces an identical state from an identical seed', () => {
    expect(fingerprint(runMatch(4242, 2600))).toEqual(fingerprint(runMatch(4242, 2600)));
  });

  it('produces a different state from a different seed, or at least not by luck', () => {
    // Waves are seeded, so two seeds should not coincidentally agree on
    // everything. This guards against a fingerprint that accidentally captures
    // nothing.
    const a = runMatch(1, 2600);
    const b = runMatch(2, 2600);
    expect(a.tick).toEqual(b.tick);
    expect(fingerprint(a)).not.toEqual(fingerprint(b));
  });

  it('gives every lane the same wave (§9.2)', () => {
    // Lane divergence comes only from sends; with none, four lanes facing the
    // same clock must hold identical monster rosters.
    const state = runMatch(99, 700, 4);
    const rosters = Object.values(state.lanes).map((lane) =>
      lane.monsters
        .map((m) => m.defId)
        .sort()
        .join(','),
    );
    for (const roster of rosters) expect(roster).toEqual(rosters[0]);
  });

  it('advances exactly one tick per step', () => {
    const state = runMatch(7, 137, 1);
    expect(state.tick).toBe(137);
  });
});

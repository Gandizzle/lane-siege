/**
 * M4 rules that live in the simulation: sends (§11.5) and fog of war (§12).
 *
 * These are the parts a client must not be trusted with. The server runs this
 * same module, so anything asserted here is enforced for every player whatever
 * their client does.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step, viewFor } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

function fourPlayerMatch(): { state: MatchState; ctx: SimContext } {
  const state = createMatch(data, {
    seed: 7,
    teams: [
      { id: 'a', playerIds: ['pa'] },
      { id: 'b', playerIds: ['pb'] },
      { id: 'c', playerIds: ['pc'] },
      { id: 'd', playerIds: ['pd'] },
    ],
  });
  return { state, ctx: createContext(data) };
}

function fund(state: MatchState, teamId: string, gems: number): void {
  state.lanes[teamId]!.economy.gems = gems;
}

describe('sends (§11.5)', () => {
  it('adds monsters to the target lane and pays the sender income', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 100);

    const incomeBefore = state.lanes.a!.economy.passiveIncome;
    const result = applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'grub_pack',
    });

    expect(result.ok).toBe(true);
    expect(state.lanes.b!.incomingSends).toHaveLength(5);
    expect(state.lanes.b!.incomingSends.every((s) => s.fromTeamId === 'a')).toBe(true);
    // §11.5: sending grants the sender permanent passive income.
    expect(state.lanes.a!.economy.passiveIncome).toBeGreaterThan(incomeBefore);
    // Nothing lands in the sender's own lane.
    expect(state.lanes.a!.incomingSends).toHaveLength(0);
  });

  it('gives the kill bounty to the defender, not the sender', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 100);
    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'grub_pack',
    });

    // Into combat, so the sent monsters actually spawn.
    while (state.phase !== 'combat') step(ctx, state);

    const sentIn = state.lanes.b!.monsters.filter((m) => m.defId === 'grub');
    expect(sentIn.length).toBeGreaterThan(0);

    const senderGold = state.lanes.a!.economy.gold;
    const defenderGold = state.lanes.b!.economy.gold;
    for (const m of sentIn) m.hp = 0;
    step(ctx, state);

    expect(state.lanes.b!.economy.gold).toBeGreaterThan(defenderGold);
    expect(state.lanes.a!.economy.gold).toBe(senderGold);
  });

  it('refuses a send at yourself, at nobody, and from the grave', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'a',
        sendId: 'grub_pack',
      }).rejection,
    ).toBe('invalid-target');

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'nobody',
        sendId: 'grub_pack',
      }).rejection,
    ).toBe('invalid-target');

    // §13: no kingmaking - an eliminated player may not send.
    state.teams.find((t) => t.id === 'a')!.eliminated = true;
    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'b',
        sendId: 'grub_pack',
      }).rejection,
    ).toBe('eliminated');
  });

  it('refuses a send at an eliminated player, and one you cannot afford', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);
    state.teams.find((t) => t.id === 'b')!.eliminated = true;

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'b',
        sendId: 'grub_pack',
      }).rejection,
    ).toBe('target-eliminated');

    fund(state, 'a', 0);
    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'c',
        sendId: 'grub_pack',
      }).rejection,
    ).toBe('insufficient-gems');
  });

  it('happens in the build phase, like every other purchase (§3.1)', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);
    while (state.phase !== 'combat') step(ctx, state);

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'b',
        sendId: 'grub_pack',
      }).rejection,
    ).toBe('not-build-phase');
  });

  it('closes with every other purchase at wave 25 (§3.3)', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);
    state.wave = data.waves.attritionStartWave;

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'b',
        sendId: 'grub_pack',
      }).rejection,
    ).toBe('building-closed');
  });

  it('grants timed vision only for the sends that say so', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);

    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'grub_pack',
    });
    expect(state.teams.find((t) => t.id === 'a')!.vision.b ?? 0).toBe(0);

    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'swarm_probe',
    });
    const granted = state.teams.find((t) => t.id === 'a')!.vision.b ?? 0;
    expect(granted).toBeGreaterThan(0);

    // It runs out rather than lasting the match.
    for (let i = 0; i < granted + 1; i++) step(ctx, state);
    expect(state.teams.find((t) => t.id === 'a')!.vision.b ?? 0).toBe(0);
  });
});

describe('fog of war (§12)', () => {
  it('shows an opponent only their fortress and whether they are alive', () => {
    const { state, ctx } = fourPlayerMatch();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'b',
      unitDefId: 'hammer',
      tileX: 2,
      tileY: 5,
    });

    const view = viewFor(state, 'a');
    const b = view.opponents.find((o) => o.teamId === 'b')!;

    expect(b.fortressMaxHp).toBeGreaterThan(0);
    expect(b.eliminated).toBe(false);
    expect(b.watching).toBe(false);
    // Their lane contents are simply absent, not merely unrendered.
    expect(view.watching.b).toBeUndefined();
  });

  it('gives you your own lane in full, wallet included', () => {
    const { state } = fourPlayerMatch();
    const view = viewFor(state, 'a');

    expect(view.lane).not.toBeNull();
    expect(view.lane!.economy).not.toBeNull();
    expect(view.lane!.teamId).toBe('a');
  });

  it('reveals a lane you bought sight of, but never its wallet', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'b',
      unitDefId: 'hammer',
      tileX: 3,
      tileY: 6,
    });
    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'swarm_probe',
    });

    const view = viewFor(state, 'a');
    expect(view.watching.b).toBeDefined();
    expect(view.watching.b!.units).toHaveLength(1);
    expect(view.watching.b!.economy).toBeNull();

    // Nobody else got a look.
    expect(viewFor(state, 'c').watching.b).toBeUndefined();
  });

  it('lets an eliminated player spectate every lane (§13)', () => {
    const { state } = fourPlayerMatch();
    state.teams.find((t) => t.id === 'a')!.eliminated = true;

    const view = viewFor(state, 'a');
    expect(Object.keys(view.watching).sort()).toEqual(['b', 'c', 'd']);
    expect(view.eliminated).toBe(true);
    // Still not their wallets.
    expect(Object.values(view.watching).every((l) => l.economy === null)).toBe(true);
  });

  it('serialises without leaking anything the view left out', () => {
    const { state, ctx } = fourPlayerMatch();
    applyCommand(ctx, state, {
      kind: 'buyTech',
      teamId: 'b',
      trackId: data.economy.tech.tracks[0]!.id,
    });
    state.lanes.b!.economy.gold = 4242;

    // What the server would actually put on the wire.
    const view = viewFor(state, 'a');
    const wire = JSON.stringify(view);

    // b's gold is not on it anywhere.
    expect(wire).not.toContain('4242');
    // An opponent entry carries exactly the §12 public record and nothing else,
    // so a field added to Team or Lane later cannot quietly become public.
    for (const opponent of view.opponents) {
      expect(Object.keys(opponent).sort()).toEqual([
        'eliminated',
        'fortressHp',
        'fortressMaxHp',
        'placement',
        'teamId',
        'visionTicksLeft',
        'watching',
      ]);
    }
    // And the filter is not simply removing everything: your own wallet is there.
    expect(wire).toContain('supplyCap');
  });
});

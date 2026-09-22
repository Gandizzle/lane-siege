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
      sendId: 'grub',
    });

    expect(result.ok).toBe(true);
    // Exactly what the definition lists, which is one body per send today
    // (sends.json) and is read from the data rather than written down here.
    const pack = data.sends.sends.find((s) => s.id === 'grub')!.monsters;
    expect(state.lanes.b!.incomingSends).toHaveLength(pack.length);
    expect(state.lanes.b!.incomingSends.map((s) => s.defId)).toEqual(pack);
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
      sendId: 'grub',
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
        sendId: 'grub',
      }).rejection,
    ).toBe('invalid-target');

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'nobody',
        sendId: 'grub',
      }).rejection,
    ).toBe('invalid-target');

    // §13: no kingmaking - an eliminated player may not send.
    state.teams.find((t) => t.id === 'a')!.eliminated = true;
    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'b',
        sendId: 'grub',
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
        sendId: 'grub',
      }).rejection,
    ).toBe('target-eliminated');

    fund(state, 'a', 0);
    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'c',
        sendId: 'grub',
      }).rejection,
    ).toBe('insufficient-gems');
  });

  it('can be bought mid-combat, and still lands on the NEXT wave', () => {
    // A send aims at the target's next wave whenever it is bought, so the
    // build-phase restriction only ever decided when the player was allowed to
    // think about it. The monsters queue and wait either way.
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);
    // Nobody here builds anything, so every wall would fall and the match
    // would end before the next wave - which is a statement about how hard
    // wave 1 is and not about when a send lands.
    for (const lane of Object.values(state.lanes)) {
      lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
      lane.fortress.hp = lane.fortress.maxHp;
    }
    while (state.phase !== 'combat') step(ctx, state);
    const waveDuring = state.wave;
    const inLaneBefore = state.lanes.b!.monsters.length;

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'b',
        sendId: 'grub',
      }).ok,
    ).toBe(true);

    // Queued, not spawned: the wave already on the board is untouched.
    expect(state.lanes.b!.incomingSends.length).toBeGreaterThan(0);
    expect(state.lanes.b!.monsters.length).toBe(inLaneBefore);

    // They arrive when the next wave does.
    let guard = 0;
    while (state.wave === waveDuring && guard++ < 40000) step(ctx, state);
    expect(state.wave).toBe(waveDuring + 1);
    expect(state.lanes.b!.incomingSends).toHaveLength(0);
  });

  it('closes with every other purchase once the showdown begins (§3.3, replaced)', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 500);
    state.phase = 'showdown';

    expect(
      applyCommand(ctx, state, {
        kind: 'send',
        teamId: 'a',
        targetTeamId: 'b',
        sendId: 'grub',
      }).rejection,
    ).toBe('building-closed');
  });

  it('grants timed vision only for the sends that say so', () => {
    const { state, ctx } = fourPlayerMatch();
    fund(state, 'a', 5000);

    // Read from data rather than named: which send carries sight is a pricing
    // decision (sends.json `_vision`) and has moved once already.
    const blind = data.sends.sends.find((s) => !s.grantsVision)!;
    const seeing = data.sends.sends.find((s) => s.grantsVision)!;

    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: blind.id,
    });
    expect(state.teams.find((t) => t.id === 'a')!.vision.b ?? 0).toBe(0);

    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: seeing.id,
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
      unitDefId: 'pledge',
      tileX: 2,
      tileY: 5,
    });

    const view = viewFor(ctx, state, 'a');
    const b = view.opponents.find((o) => o.teamId === 'b')!;

    expect(b.fortressMaxHp).toBeGreaterThan(0);
    expect(b.eliminated).toBe(false);
    expect(b.watching).toBe(false);
    // Their lane contents are simply absent, not merely unrendered.
    expect(view.watching.b).toBeUndefined();
  });

  it('gives you your own lane in full, wallet included', () => {
    const { state, ctx } = fourPlayerMatch();
    const view = viewFor(ctx, state, 'a');

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
      unitDefId: 'pledge',
      tileX: 3,
      tileY: 6,
    });
    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: data.sends.sends.find((s) => s.grantsVision)!.id,
    });

    const view = viewFor(ctx, state, 'a');
    expect(view.watching.b).toBeDefined();
    expect(view.watching.b!.units).toHaveLength(1);
    expect(view.watching.b!.economy).toBeNull();

    // Nobody else got a look.
    expect(viewFor(ctx, state, 'c').watching.b).toBeUndefined();
  });

  it('lets an eliminated player spectate every lane (§13)', () => {
    const { state, ctx } = fourPlayerMatch();
    state.teams.find((t) => t.id === 'a')!.eliminated = true;

    const view = viewFor(ctx, state, 'a');
    expect(Object.keys(view.watching).sort()).toEqual(['b', 'c', 'd']);
    expect(view.eliminated).toBe(true);
    // Still not their wallets.
    expect(Object.values(view.watching).every((l) => l.economy === null)).toBe(true);
  });

  it('opens every lane during a wave when that is the setting, and closes them after', () => {
    const { state, ctx } = fourPlayerMatch();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'b',
      unitDefId: 'pledge',
      tileX: 2,
      tileY: 5,
    });

    // The build phase stays private: what you are BUILDING is still yours.
    state.phase = 'build';
    expect(viewFor(ctx, state, 'a', 'combat').watching.b).toBeUndefined();
    expect(
      viewFor(ctx, state, 'a', 'combat').opponents.find((o) => o.teamId === 'b')!.watching,
    ).toBe(false);

    // Once the wave is running, everyone can watch everyone.
    state.phase = 'combat';
    const watching = viewFor(ctx, state, 'a', 'combat');
    expect(Object.keys(watching.watching).sort()).toEqual(['b', 'c', 'd']);
    expect(watching.watching.b!.units).toHaveLength(1);
    // And still never the balance sheet, whatever the setting.
    expect(Object.values(watching.watching).every((l) => l.economy === null)).toBe(true);
  });

  it('never closes a lane when the setting says always', () => {
    const { state, ctx } = fourPlayerMatch();
    state.phase = 'build';
    expect(Object.keys(viewFor(ctx, state, 'a', 'always').watching).sort()).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('keeps §12 as written when the setting says granted, which is the default', () => {
    const { state, ctx } = fourPlayerMatch();
    state.phase = 'combat';
    expect(viewFor(ctx, state, 'a', 'granted').watching.b).toBeUndefined();
    expect(viewFor(ctx, state, 'a').watching.b).toBeUndefined();
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
    const view = viewFor(ctx, state, 'a');
    const wire = JSON.stringify(view);

    // b's gold is not on it anywhere.
    expect(wire).not.toContain('4242');
    // An opponent entry carries exactly the §12 public record and nothing else,
    // so a field added to Team or Lane later cannot quietly become public.
    // `name` is on the list deliberately: §12's fog is about what somebody has
    // BUILT, and who they are is the opposite of a secret - four labelled tabs
    // across the top is the whole point of playing against people.
    for (const opponent of view.opponents) {
      expect(Object.keys(opponent).sort()).toEqual([
        'eliminated',
        'fortressHp',
        'fortressMaxHp',
        'name',
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

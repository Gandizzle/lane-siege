/**
 * The wire format. See protocol.ts for why frames are rows of numbers.
 *
 * Two things need proving: that a frame says what the view said, and that it
 * does not say anything the view left out. The second is the one that matters -
 * an encoder is a place a fog-of-war leak could hide, because it touches both
 * halves of the match.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step, viewFor } from '../sim/index.ts';
import type { MatchState, SimContext } from '../sim/index.ts';
import { buildTables, decodeFrame, encodeFrame } from './protocol.ts';

const { data } = loadDataFromDisk();
const TEAMS = ['a', 'b', 'c', 'd'];
const SEED = 11;

function match(): { state: MatchState; ctx: SimContext } {
  const state = createMatch(data, {
    seed: SEED,
    teams: TEAMS.map((id) => ({ id, playerIds: [id] })),
  });
  return { state, ctx: createContext(data) };
}

const tables = buildTables(data, TEAMS, SEED);

function roundTrip(state: MatchState, teamId: string) {
  const original = viewFor(state, teamId);
  const decoded = decodeFrame(encodeFrame(original, tables), tables);
  return { original, decoded };
}

describe('a frame survives the round trip', () => {
  it('carries the match header', () => {
    const { state, ctx } = match();
    for (let i = 0; i < 30; i++) step(ctx, state);

    const { original, decoded } = roundTrip(state, 'a');
    expect(decoded.teamId).toBe(original.teamId);
    expect(decoded.tick).toBe(original.tick);
    expect(decoded.wave).toBe(original.wave);
    expect(decoded.phase).toBe(original.phase);
    expect(decoded.phaseTicksLeft).toBe(original.phaseTicksLeft);
    expect(decoded.finished).toBe(original.finished);
    expect(decoded.eliminated).toBe(original.eliminated);
    // Public and constant (§9.2), so it rides along with the tables rather
    // than in every frame - but it still has to arrive.
    expect(decoded.seed).toBe(original.seed);
  });

  it('carries every body, with its position to a hundredth of a tile', () => {
    const { state, ctx } = match();
    state.lanes.a!.economy.gold = 99_999;
    state.lanes.a!.economy.supplyCap = 99;
    for (let x = 0; x < 6; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'a',
        unitDefId: 'pledge',
        tileX: x,
        tileY: 5,
      });
    }
    while (state.phase !== 'combat') step(ctx, state);
    for (let i = 0; i < 40; i++) step(ctx, state);

    const { original, decoded } = roundTrip(state, 'a');
    expect(decoded.lane!.units).toHaveLength(original.lane!.units.length);
    expect(decoded.lane!.monsters).toHaveLength(original.lane!.monsters.length);
    expect(decoded.lane!.monsters.length).toBeGreaterThan(0);

    for (const [i, monster] of original.lane!.monsters.entries()) {
      const landed = decoded.lane!.monsters[i]!;
      expect(landed.id).toBe(monster.id);
      expect(landed.defId).toBe(monster.defId);
      // Quantisation is the documented cost: a hundredth of a tile, which is a
      // fortieth of a body radius.
      expect(Math.abs(landed.x - monster.x)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(landed.y - monster.y)).toBeLessThanOrEqual(0.005);
      // Derived from the definition rather than sent, so it must come back exact.
      expect(landed.radius).toBe(monster.radius);
      expect(landed.armour).toBe(monster.armour);
      expect(landed.damageType).toBe(monster.damageType);
    }
  });

  it('carries this tick\u2019s blows, so a watcher sees the same fight', () => {
    const { state, ctx } = match();
    for (let x = 1; x < 7; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'a',
        unitDefId: 'pledge',
        tileX: x,
        tileY: 5,
      });
    }
    while (state.phase !== 'combat') step(ctx, state);

    // Run until a tick actually lands a blow: attacks are what this is about,
    // and an empty list would pass a test that proves nothing.
    let attacks = 0;
    for (let i = 0; i < 400 && attacks === 0; i++) {
      step(ctx, state);
      attacks = state.lanes.a!.attacks.length;
    }
    expect(attacks).toBeGreaterThan(0);

    const { original, decoded } = roundTrip(state, 'a');
    expect(decoded.lane!.attacks).toEqual(original.lane!.attacks);
  });

  it('carries an empty attack list as an empty list, not as absent', () => {
    const { state } = match();
    const { decoded } = roundTrip(state, 'a');
    expect(decoded.lane!.attacks).toEqual([]);
  });

  it('carries your own wallet, including what you have bought', () => {
    const { state, ctx } = match();
    const trackId = data.economy.tech.tracks[0]!.id;
    state.lanes.a!.economy.gold = 99_999;
    // Fortress upgrades cost gems (§10), which start at zero.
    state.lanes.a!.economy.gems = 500;
    applyCommand(ctx, state, { kind: 'buyTech', teamId: 'a', trackId });
    applyCommand(ctx, state, { kind: 'buyFortressUpgrade', teamId: 'a', upgradeId: 'weapon' });

    const { original, decoded } = roundTrip(state, 'a');
    const wallet = decoded.lane!.economy!;
    expect(wallet.gold).toBe(Math.round(original.lane!.economy!.gold));
    expect(wallet.supplyCap).toBe(original.lane!.economy!.supplyCap);
    expect(wallet.tech[trackId]).toBe(1);
    expect(wallet.upgrades.weapon).toBe(1);
  });

  it('carries what each unit cost, so the sell price needs no round trip', () => {
    const { state, ctx } = match();
    state.lanes.a!.economy.gold = 99_999;
    state.lanes.a!.economy.supplyCap = 99;
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'a',
      unitDefId: 'pledge',
      tileX: 1,
      tileY: 1,
    });
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'a',
      unitDefId: 'oathwall',
      tileX: 2,
      tileY: 1,
    });

    const { original, decoded } = roundTrip(state, 'a');
    expect(decoded.lane!.unitSpend).toEqual(original.lane!.unitSpend);
    // Parallel to `units`, which is the whole reason it needs no ids of its own.
    expect(decoded.lane!.unitSpend).toHaveLength(decoded.lane!.units.length);
    expect(decoded.lane!.unitSpend[0]!.thisPhase).toBeGreaterThan(0);
  });

  it("carries the round's damage rows, dead units included", () => {
    const { state, ctx } = match();
    state.lanes.a!.economy.gold = 99_999;
    state.lanes.a!.economy.supplyCap = 99;
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'a',
      unitDefId: 'pledge',
      tileX: 1,
      tileY: 1,
    });
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'a',
      unitDefId: 'oathwall',
      tileX: 2,
      tileY: 1,
    });

    const [first, second] = state.lanes.a!.units;
    first!.damageDealt = 1234.6;
    second!.damageDealt = 7;
    // The second one was overrun. Its row is exactly the one worth keeping.
    second!.alive = false;

    const { decoded } = roundTrip(state, 'a');
    const rows = decoded.lane!.unitDamage;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.unitId)).toEqual([first!.id, second!.id]);
    expect(rows.map((r) => r.defId)).toEqual([first!.defId, second!.defId]);
    // Whole points: the panel shows whole points (see `dm` in protocol.ts).
    expect(rows[0]!.damage).toBe(1235);
    expect(decoded.lane!.units).toHaveLength(1);
  });

  it('carries the fortress, the reserve and the send log', () => {
    const { state, ctx } = match();
    // The send comes from b, so b is the one who needs the gems.
    state.lanes.b!.economy.gems = 500;
    applyCommand(ctx, state, { kind: 'setWeaponType', teamId: 'a', damageType: 'arcane' });
    applyCommand(ctx, state, { kind: 'setAura', teamId: 'a', aura: 'armour' });
    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'b',
      targetTeamId: 'a',
      sendId: 'grub_pack',
    });

    const { original, decoded } = roundTrip(state, 'a');
    expect(decoded.lane!.fortress.weaponDamageType).toBe('arcane');
    expect(decoded.lane!.fortress.activeAura).toBe('armour');
    expect(decoded.lane!.fortress.hp).toBe(Math.round(original.lane!.fortress.hp));
    expect(decoded.lane!.sendLog).toEqual([{ sendId: 'grub_pack', fromTeamId: 'b' }]);
  });

  it('carries the opponents and, when you have sight, their lanes', () => {
    const { state, ctx } = match();
    state.lanes.a!.economy.gems = 500;
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'b',
      unitDefId: 'pledge',
      tileX: 4,
      tileY: 7,
    });
    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'swarm_probe',
    });

    const { original, decoded } = roundTrip(state, 'a');
    expect(decoded.opponents.map((o) => o.teamId)).toEqual(original.opponents.map((o) => o.teamId));
    expect(decoded.watching.b).toBeDefined();
    expect(decoded.watching.b!.units).toHaveLength(1);
    expect(decoded.watching.c).toBeUndefined();
  });
});

describe('a frame cannot leak what the view withheld', () => {
  it('omits an opponent wallet even when they are being watched', () => {
    const { state, ctx } = match();
    state.lanes.a!.economy.gems = 500;
    state.lanes.b!.economy.gold = 31_337;
    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'swarm_probe',
    });

    const frame = encodeFrame(viewFor(state, 'a'), tables);
    expect(JSON.stringify(frame)).not.toContain('31337');

    // The watched lane is there; its wallet is not.
    const decoded = decodeFrame(frame, tables);
    expect(decoded.watching.b).toBeDefined();
    expect(decoded.watching.b!.economy).toBeNull();
  });

  it('omits what an opponent paid for their units', () => {
    // Spend rides with the wallet, and §12 keeps the wallet private. A watcher
    // seeing it would be reading the balance sheet through the side door.
    const { state, ctx } = match();
    state.lanes.a!.economy.gems = 500;
    state.lanes.b!.economy.gold = 99_999;
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'b',
      unitDefId: 'pledge',
      tileX: 1,
      tileY: 1,
    });
    applyCommand(ctx, state, {
      kind: 'send',
      teamId: 'a',
      targetTeamId: 'b',
      sendId: 'swarm_probe',
    });

    const decoded = decodeFrame(encodeFrame(viewFor(state, 'a'), tables), tables);
    expect(decoded.watching.b!.units).toHaveLength(1);
    expect(decoded.watching.b!.unitSpend).toEqual([]);
    // Nor what somebody else's line is worth (§12).
    expect(decoded.watching.b!.unitDamage).toEqual([]);
  });

  it('omits lanes nobody can see', () => {
    const { state, ctx } = match();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'c',
      unitDefId: 'pledge',
      tileX: 2,
      tileY: 2,
    });

    const decoded = decodeFrame(encodeFrame(viewFor(state, 'a'), tables), tables);
    expect(Object.keys(decoded.watching)).toHaveLength(0);
  });
});

describe('the Final Showdown on the wire (§3.3, replaced)', () => {
  /** Arm every lane and jump to the tick the last wave is cleared. */
  function showdownMatch() {
    const { state, ctx } = match();
    for (const id of TEAMS) {
      const lane = state.lanes[id]!;
      lane.economy.gold = 99_999;
      lane.economy.supplyCap = 999;
      for (let x = 0; x < 4; x++) {
        applyCommand(ctx, state, {
          kind: 'placeUnit',
          teamId: id,
          unitDefId: 'pledge',
          tileX: x,
          tileY: 2,
        });
      }
    }

    state.wave = data.waves.showdown.afterWave;
    state.phase = 'combat';
    state.phaseTicksLeft = 0;
    for (const lane of Object.values(state.lanes)) {
      lane.monsters.length = 0;
      lane.reserve.length = 0;
    }
    state.waveClocks.length = 0;
    step(ctx, state);
    return { state, ctx };
  }

  it('carries the phase, which is now one of three', () => {
    const { state } = showdownMatch();
    const { original, decoded } = roundTrip(state, 'a');
    expect(original.phase).toBe('showdown');
    expect(decoded.phase).toBe('showdown');
  });

  it('carries every army, its seat and every body in it', () => {
    const { state } = showdownMatch();
    const { original, decoded } = roundTrip(state, 'a');

    expect(decoded.showdown).not.toBeNull();
    expect(decoded.showdown!.countdown).toBe(original.showdown!.countdown);
    expect(decoded.showdown!.armies).toHaveLength(original.showdown!.armies.length);

    original.showdown!.armies.forEach((army, i) => {
      const got = decoded.showdown!.armies[i]!;
      expect(got.teamId).toBe(army.teamId);
      expect(got.seat).toBe(army.seat);
      expect(got.units).toHaveLength(army.units.length);
      army.units.forEach((unit, j) => {
        const row = got.units[j]!;
        expect(row.id).toBe(unit.id);
        expect(row.defId).toBe(unit.defId);
        expect(row.x).toBeCloseTo(unit.x, 2);
        expect(row.y).toBeCloseTo(unit.y, 2);
      });
    });
  });

  it('carries the blows, so the arena animates like a lane', () => {
    const { state, ctx } = showdownMatch();
    let guard = 0;
    while (state.showdown!.attacks.length === 0 && guard++ < 20000) step(ctx, state);

    const { original, decoded } = roundTrip(state, 'a');
    expect(original.showdown!.attacks.length).toBeGreaterThan(0);
    expect(decoded.showdown!.attacks).toEqual(original.showdown!.attacks);
  });

  it('shows the same arena to everybody, eliminated or not', () => {
    // Nothing about four armies in one square is hideable, and a player who
    // cannot see what is walking at them cannot play the fight.
    const { state } = showdownMatch();
    state.teams[3]!.eliminated = true;

    const alive = roundTrip(state, 'a').decoded.showdown!;
    const out = roundTrip(state, 'd').decoded.showdown!;
    expect(out.armies.map((a) => a.teamId)).toEqual(alive.armies.map((a) => a.teamId));
    expect(out.armies[0]!.units).toHaveLength(alive.armies[0]!.units.length);
  });

  it('says nothing about a showdown that has not started', () => {
    const { state } = match();
    const { decoded } = roundTrip(state, 'a');
    expect(decoded.showdown).toBeNull();
  });
});

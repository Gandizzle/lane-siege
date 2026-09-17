/**
 * M3 systems: global tech, fortress and resource upgrades, supply, auras, and
 * the two windows they open in - the shop and the board. DESIGN.md §3.1,
 * §3.3 (replaced), §7.4, §10.1, §10.2, §11.4.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, secondsToTicks, step } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();

function rich(): { state: MatchState; ctx: SimContext } {
  const state = createMatch(data, { seed: 1, teams: [{ id: 'l1', playerIds: ['p'] }] });
  const ctx = createContext(data);
  const lane = state.lanes.l1!;
  lane.economy.gold = 99999;
  lane.economy.gems = 99999;
  lane.economy.supplyCap = 999;
  return { state, ctx };
}

describe('global tech (§7.4)', () => {
  it('is tied to damage types, not unit types', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    // Spike is Pierce, Mortar is Blast.
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'spike',
      tileX: 1,
      tileY: 1,
    });
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'mortar',
      tileX: 2,
      tileY: 1,
    });

    expect(
      applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'dmg_pierce' }).ok,
    ).toBe(true);

    const spike = lane.units.find((u) => u.defId === 'spike')!;
    const mortar = lane.units.find((u) => u.defId === 'mortar')!;

    expect(spike.techDamage).toBeGreaterThan(1);
    expect(mortar.techDamage).toBe(1);
  });

  it('applies to units bought after the purchase too', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'dmg_impact' });
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 1,
      tileY: 1,
    });

    expect(lane.units[0]!.techDamage).toBeGreaterThan(1);
  });

  it('raises unit maximum HP without healing the damage already taken', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 1,
      tileY: 1,
    });
    const unit = lane.units[0]!;
    unit.hp = unit.maxHp * 0.5;

    applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'def_hp' });

    expect(unit.maxHp).toBeGreaterThan(stat(data.units.units.find((u) => u.id === 'hammer')!.hp));
    expect(unit.hp / unit.maxHp).toBeCloseTo(0.5, 4);
  });

  it('escalates in cost and stops at the top of the track', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const track = data.economy.tech.tracks.find((t) => t.id === 'dmg_blast')!;

    let previous = 0;
    for (const level of track.levels) {
      const before = lane.economy.gold;
      expect(
        applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'dmg_blast' }).ok,
      ).toBe(true);
      const spent = before - lane.economy.gold;
      expect(spent).toBeGreaterThan(previous);
      previous = spent;
      expect(lane.economy.tech.dmg_blast).toBe(level.level);
    }

    expect(
      applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'dmg_blast' }),
    ).toEqual({ ok: false, rejection: 'max-tier' });
  });

  it('refuses when gold is short', () => {
    const { state, ctx } = rich();
    state.lanes.l1!.economy.gold = 0;
    expect(
      applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'dmg_impact' }),
    ).toEqual({ ok: false, rejection: 'insufficient-gold' });
  });
});

describe('fortress upgrades (§10.1, §10.2)', () => {
  it('are bought with gems, not gold (§11.3)', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const gold = lane.economy.gold;
    const gems = lane.economy.gems;

    expect(
      applyCommand(ctx, state, {
        kind: 'buyFortressUpgrade',
        teamId: 'l1',
        upgradeId: 'weapon',
      }).ok,
    ).toBe(true);

    expect(lane.economy.gems).toBeLessThan(gems);
    expect(lane.economy.gold).toBe(gold);
  });

  it('raises the weapon, HP, regen, aura and gem production', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const before = {
      weapon: lane.fortress.weaponDamage,
      maxHp: lane.fortress.maxHp,
      regen: lane.fortress.regenPerSecond,
      strength: lane.fortress.auraStrength,
      radius: lane.fortress.auraRadius,
      gemsPerPayout: lane.fortress.gemsPerPayout,
      payoutTicks: lane.fortress.gemPayoutTicks,
    };

    for (const id of [
      'weapon',
      'hp',
      'regen',
      'auraStrength',
      'auraRadius',
      'gemOutput',
      'gemRate',
    ]) {
      expect(
        applyCommand(ctx, state, {
          kind: 'buyFortressUpgrade',
          teamId: 'l1',
          upgradeId: id,
        }).ok,
      ).toBe(true);
    }

    expect(lane.fortress.weaponDamage).toBeGreaterThan(before.weapon);
    expect(lane.fortress.maxHp).toBeGreaterThan(before.maxHp);
    expect(lane.fortress.regenPerSecond).toBeGreaterThan(before.regen);
    expect(lane.fortress.auraStrength).toBeGreaterThan(before.strength);
    expect(lane.fortress.auraRadius).toBeGreaterThan(before.radius);
    expect(lane.fortress.gemsPerPayout).toBeGreaterThan(before.gemsPerPayout);
    // A faster rate is a SHORTER interval between payouts.
    expect(lane.fortress.gemPayoutTicks).toBeLessThan(before.payoutTicks);
  });

  it('makes the weapon actually hit harder, not just the number on the sheet', () => {
    // The ladder writes `lane.fortress.weaponDamage`, and for a while the
    // weapon fired from `data.fortress.weapon.damage` instead - so every level
    // of it was gold spent on nothing, and nothing said so. What the weapon
    // fires with has to be what the upgrade raised.
    function shotDamage(buy: number): number {
      const { state, ctx } = rich();
      const lane = state.lanes.l1!;
      for (let i = 0; i < buy; i++) {
        expect(
          applyCommand(ctx, state, {
            kind: 'buyFortressUpgrade',
            teamId: 'l1',
            upgradeId: 'weapon',
          }).ok,
        ).toBe(true);
      }

      // Into combat, then hold a single monster in front of the wall and see
      // what one shot takes off it.
      let guard = 0;
      while (state.phase !== 'combat' && guard++ < 5000) step(ctx, state);
      for (const monster of lane.monsters.slice(1)) monster.hp = 0;
      lane.reserve.length = 0;
      step(ctx, state);

      const monster = lane.monsters.find((m) => m.alive)!;
      monster.hp = 1e9;
      monster.maxHp = 1e9;
      monster.pos.x = 4;
      monster.pos.y = 9.5;
      lane.fortress.weaponCooldown = 0;
      const before = monster.hp;
      step(ctx, state);
      return before - monster.hp;
    }

    const base = shotDamage(0);
    expect(base).toBeGreaterThan(0);
    expect(shotDamage(2)).toBeGreaterThan(base);
  });

  it('heals by the HP gained rather than to full', () => {
    // An upgrade should not double as a panic button mid-siege.
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    lane.fortress.hp = 100;
    const before = lane.fortress.maxHp;

    applyCommand(ctx, state, { kind: 'buyFortressUpgrade', teamId: 'l1', upgradeId: 'hp' });

    const gained = lane.fortress.maxHp - before;
    expect(lane.fortress.hp).toBe(100 + gained);
    expect(lane.fortress.hp).toBeLessThan(lane.fortress.maxHp);
  });

  it('rejects an unknown upgrade', () => {
    const { state, ctx } = rich();
    expect(
      applyCommand(ctx, state, {
        kind: 'buyFortressUpgrade',
        teamId: 'l1',
        upgradeId: 'nope',
      }),
    ).toEqual({ ok: false, rejection: 'unknown-definition' });
  });
});

describe('the resource building (§10.2, amended)', () => {
  const building = data.fortress.resourceBuilding;

  it('starts at one gem every two seconds', () => {
    const { state } = rich();
    const fortress = state.lanes.l1!.fortress;
    expect(fortress.gemsPerPayout).toBe(1);
    expect(building.payoutSeconds).toBe(2);
    expect(fortress.gemPayoutTicks).toBe(secondsToTicks(2));
  });

  it('pays while you are building, not only while you are fighting', () => {
    // The whole point of moving off a per-wave lump: the building earns during
    // the thirty seconds you spend deciding what to do with what it earned.
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    lane.economy.gems = 0;
    expect(state.phase).toBe('build');

    for (let t = 0; t < lane.fortress.gemPayoutTicks * 2; t++) step(ctx, state);
    expect(state.phase).toBe('build');
    expect(lane.economy.gems).toBe(2);
  });

  it('adds a gem per payout for each level of output', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const levels = building.output.upgrades.length;

    for (let i = 1; i <= levels; i++) {
      expect(
        applyCommand(ctx, state, {
          kind: 'buyFortressUpgrade',
          teamId: 'l1',
          upgradeId: 'gemOutput',
        }).ok,
      ).toBe(true);
      expect(lane.fortress.gemsPerPayout).toBe(1 + i);
    }
  });

  it('adds half the base rate per level, additively rather than compounding', () => {
    // 1.5x, 2x, 2.5x ... not 1.5x, 2.25x, 3.375x. The interval is the base
    // divided by that, so it shrinks toward a floor rather than toward zero.
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    const base = secondsToTicks(building.payoutSeconds ?? 0);

    building.rate.upgrades.forEach((level, i) => {
      expect(level.value, `level ${i + 1}`).toBeCloseTo(1 + 0.5 * (i + 1), 6);
      applyCommand(ctx, state, {
        kind: 'buyFortressUpgrade',
        teamId: 'l1',
        upgradeId: 'gemRate',
      });
      expect(lane.fortress.gemPayoutTicks).toBe(Math.max(1, Math.round(base / (level.value ?? 1))));
    });
  });

  it('actually pays out faster once the rate is bought', () => {
    const paidIn = (ticks: number, rateLevels: number): number => {
      const { state, ctx } = rich();
      const lane = state.lanes.l1!;
      for (let i = 0; i < rateLevels; i++) {
        applyCommand(ctx, state, {
          kind: 'buyFortressUpgrade',
          teamId: 'l1',
          upgradeId: 'gemRate',
        });
      }
      lane.economy.gems = 0;
      for (let t = 0; t < ticks; t++) step(ctx, state);
      return lane.economy.gems;
    };

    const window = secondsToTicks(20);
    expect(paidIn(window, 1)).toBeGreaterThan(paidIn(window, 0));
    expect(paidIn(window, 2)).toBeGreaterThan(paidIn(window, 1));
  });

  it('is bought with gold, not gems (§11.3, amended)', () => {
    // A building that makes gems, paid for in gems, is a loop that only opens
    // once you are already winning it.
    for (const level of [...building.output.upgrades, ...building.rate.upgrades]) {
      expect(level.gemCost ?? 0).toBe(0);
      expect(level.goldCost ?? 0).toBeGreaterThan(0);
    }

    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    lane.economy.gems = 0;
    const goldBefore = lane.economy.gold;

    for (const id of ['gemOutput', 'gemRate']) {
      expect(
        applyCommand(ctx, state, { kind: 'buyFortressUpgrade', teamId: 'l1', upgradeId: id }).ok,
        id,
      ).toBe(true);
    }
    expect(lane.economy.gems).toBe(0);
    expect(lane.economy.gold).toBeLessThan(goldBefore);
  });

  it('refuses when the gold is not there', () => {
    const { state, ctx } = rich();
    state.lanes.l1!.economy.gold = 0;
    expect(
      applyCommand(ctx, state, {
        kind: 'buyFortressUpgrade',
        teamId: 'l1',
        upgradeId: 'gemOutput',
      }),
    ).toEqual({ ok: false, rejection: 'insufficient-gold' });
  });
});

describe('supply cap (§11.4)', () => {
  it('does not grow on its own, and grows when bought', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    lane.economy.supplyCap = data.economy.supply.capBase!;

    const before = lane.economy.supplyCap;
    expect(applyCommand(ctx, state, { kind: 'buySupply', teamId: 'l1' }).ok).toBe(true);
    expect(lane.economy.supplyCap).toBeGreaterThan(before);
  });
});

describe('auras (§10.1)', () => {
  it('buff only units inside the radius', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;
    lane.fortress.activeAura = 'damage';
    lane.fortress.auraRadius = 2.5;

    // The fortress sits below the grid, so a high tileY is near it.
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 4,
      tileY: 9,
    });
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 4,
      tileY: 0,
    });

    const near = lane.units[0]!;
    const far = lane.units[1]!;

    const fortress = ctx.fortressPosition;
    const dNear = Math.hypot(near.pos.x - fortress.x, near.pos.y - fortress.y);
    const dFar = Math.hypot(far.pos.x - fortress.x, far.pos.y - fortress.y);

    expect(dNear).toBeLessThan(lane.fortress.auraRadius);
    expect(dFar).toBeGreaterThan(lane.fortress.auraRadius);
  });

  it('only one is active at a time', () => {
    const { state, ctx } = rich();
    const lane = state.lanes.l1!;

    applyCommand(ctx, state, { kind: 'setAura', teamId: 'l1', aura: 'damage' });
    expect(lane.fortress.activeAura).toBe('damage');
    applyCommand(ctx, state, { kind: 'setAura', teamId: 'l1', aura: 'armour' });
    expect(lane.fortress.activeAura).toBe('armour');
  });
});

describe('the shop stays open in combat; the board does not (§3.1, amended)', () => {
  /** A funded lane with one unit on it, mid-wave. */
  function fighting() {
    const { state, ctx } = rich();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 1,
      tileY: 1,
    });
    const unitId = state.lanes.l1!.units[0]!.id;
    while (state.phase !== 'combat') step(ctx, state);
    return { state, ctx, unitId };
  }

  it('sells tech, fortress ladders and supply while a wave is running', () => {
    // Nothing about any of these touches the line the wave is hitting, and a
    // player with nothing to do for the length of a fight is a player watching
    // a screen rather than playing.
    const { state, ctx } = fighting();

    expect(
      applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'dmg_impact' }).ok,
    ).toBe(true);
    expect(
      applyCommand(ctx, state, { kind: 'buyFortressUpgrade', teamId: 'l1', upgradeId: 'weapon' })
        .ok,
    ).toBe(true);
    expect(applyCommand(ctx, state, { kind: 'buySupply', teamId: 'l1' }).ok).toBe(true);
  });

  it('switches the weapon type and the aura while a wave is running (§10.1)', () => {
    const { state, ctx } = fighting();

    expect(
      applyCommand(ctx, state, { kind: 'setWeaponType', teamId: 'l1', damageType: 'arcane' }).ok,
    ).toBe(true);
    expect(applyCommand(ctx, state, { kind: 'setAura', teamId: 'l1', aura: 'armour' }).ok).toBe(
      true,
    );
    expect(state.lanes.l1!.fortress.activeAura).toBe('armour');
  });

  it('still refuses to place, upgrade or sell a unit', () => {
    // The board is what the wave is about to hit. Rearranging it mid-fight
    // would make every wave a reaction test rather than a plan (§3.1).
    const { state, ctx, unitId } = fighting();
    const closed = { ok: false, rejection: 'not-build-phase' };

    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: 3,
        tileY: 3,
      }),
    ).toEqual(closed);
    expect(applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'l1', unitId })).toEqual(closed);
    expect(applyCommand(ctx, state, { kind: 'sellUnit', teamId: 'l1', unitId })).toEqual(closed);
  });
});

describe('the Final Showdown closes the shop (§3.3, replaced)', () => {
  it('closes new construction once the showdown has begun', () => {
    const { state, ctx } = rich();
    state.phase = 'showdown';

    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: 1,
        tileY: 1,
      }),
    ).toEqual({ ok: false, rejection: 'building-closed' });
  });

  it('closes EVERY purchase, not just construction', () => {
    // The arena is fought with the army you brought. A last shopping trip
    // between the final wave and the showdown would make the last build phase
    // the only one that mattered.
    const { state, ctx } = rich();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 1,
      tileY: 1,
    });
    const id = state.lanes.l1!.units[0]!.id;

    state.phase = 'showdown';
    const closed = { ok: false, rejection: 'building-closed' };

    expect(applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: 'l1', unitId: id })).toEqual(
      closed,
    );
    expect(
      applyCommand(ctx, state, { kind: 'buyTech', teamId: 'l1', trackId: 'dmg_impact' }),
    ).toEqual(closed);
    expect(applyCommand(ctx, state, { kind: 'buySupply', teamId: 'l1' })).toEqual(closed);
    expect(
      applyCommand(ctx, state, { kind: 'buyFortressUpgrade', teamId: 'l1', upgradeId: 'weapon' }),
    ).toEqual(closed);
  });

  it('keeps the shop open for the build phase before the last wave', () => {
    // §3.3 used to close it AT wave 25 so its attrition endgame was fought
    // with whatever survived. The showdown is fought with what you built, so
    // the last build phase is a real one.
    const { state, ctx } = rich();
    state.wave = data.waves.showdown.afterWave - 1;
    state.phase = 'build';

    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'hammer',
        tileX: 1,
        tileY: 1,
      }).ok,
    ).toBe(true);
  });

  it('respawns losses at every build phase, including the last', () => {
    const { state, ctx } = rich();
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'l1',
      unitDefId: 'hammer',
      tileX: 4,
      tileY: 4,
    });
    const unit = state.lanes.l1!.units[0]!;

    unit.alive = false;
    unit.hp = 0;

    let guard = 0;
    while (state.phase !== 'combat' && guard++ < 5000) step(ctx, state);
    guard = 0;
    while (state.phase !== 'build' && guard++ < 20000) step(ctx, state);

    expect(unit.alive).toBe(true);
  });
});

function stat(v: number | null): number {
  return v ?? 0;
}

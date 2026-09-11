/**
 * Command validation and application. DESIGN.md §15.1.
 *
 * Every cost, supply and phase check lives HERE, inside the simulation, never
 * in the UI. The server runs this same module, so a client that fakes an
 * affordable price simply computes a different state and is caught as a desync
 * rather than getting away with it.
 *
 * Nothing throws. A refused command returns a `CommandRejection` the UI can
 * show, because "you cannot afford that" is a normal outcome of tapping a
 * button, not an error.
 */

import type { UnitDef } from '../data/schema.ts';
import type { Command, CommandRejection } from './commands.ts';
import type { DefIndex } from './defs.ts';
import { stat } from './defs.ts';
import { inBounds, tileOccupiedByUnit } from './grid.ts';
import { createUnit } from './spawn.ts';
import { recomputeUnitBuffs } from './buffs.ts';
import type { UpgradeLevel } from '../data/schema.ts';
import type { GameData } from '../data/schema.ts';
import type { Lane, MatchState } from './types.ts';

export interface CommandResult {
  ok: boolean;
  rejection?: CommandRejection;
}

const OK: CommandResult = { ok: true };

function fail(rejection: CommandRejection): CommandResult {
  return { ok: false, rejection };
}

/**
 * §3.3, decided: from wave 25 NOTHING can be bought - no new units, no tier
 * upgrades, no tech, no fortress or supply purchases.
 *
 * DESIGN.md left this OPEN and recommended keeping upgrades available so gold
 * had a sink. Decided against: the attrition endgame is meant to be a hard,
 * terminating grind fought with whatever you brought, not a last shopping trip.
 * Whatever gold is on hand at wave 25 simply stops mattering.
 *
 * The free per-build-phase choices - the fortress weapon's damage type and the
 * active aura (§10.1) - still work. They cost nothing, so they are not
 * purchases.
 */
function purchasesOpen(data: GameData, state: MatchState): boolean {
  return state.wave < data.waves.attritionStartWave;
}

function laneFor(state: MatchState, teamId: string): Lane | null {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team || team.eliminated) return null;
  return state.lanes[teamId] ?? null;
}

function placeUnit(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  lane: Lane,
  def: UnitDef,
  tileX: number,
  tileY: number,
): CommandResult {
  // §3.1: building happens in the build phase.
  if (state.phase !== 'build') return fail('not-build-phase');
  if (!purchasesOpen(ctx.data, state)) return fail('building-closed');

  if (!inBounds(lane.occupancy, tileX, tileY)) return fail('tile-out-of-bounds');
  if (tileOccupiedByUnit(lane.units, tileX, tileY)) return fail('tile-occupied');

  const goldCost = stat(def.goldCost);
  const supplyCost = stat(def.supplyCost);

  if (lane.economy.gold < goldCost) return fail('insufficient-gold');
  // §11.4: supply is a hard cap, one shared budget across offence, defence and
  // economy. It does not grow on its own - raising it is a purchase.
  if (lane.economy.supplyUsed + supplyCost > lane.economy.supplyCap) {
    return fail('insufficient-supply');
  }

  lane.economy.gold -= goldCost;
  lane.economy.supplyUsed += supplyCost;
  lane.units.push(createUnit(state, def, tileX, tileY));
  lane.occupancyDirty = true;
  recomputeUnitBuffs(ctx.data, ctx.defs, lane);

  return OK;
}

/** The next unbought level of a ladder, or undefined at the top. */
function nextLevel(ladder: readonly UpgradeLevel[], current: number): UpgradeLevel | undefined {
  return ladder.find((l) => l.level === current + 1);
}

/**
 * Charge a ladder purchase. Gold and gems are separate currencies with separate
 * sinks (§11.3), and either may also cost supply - one shared budget across
 * offence, defence and economy (§11.4).
 */
function chargeUpgrade(lane: Lane, level: UpgradeLevel): CommandRejection | null {
  const gold = stat(level.goldCost);
  const gems = stat(level.gemCost);
  const supply = stat(level.supplyCost);

  if (lane.economy.gold < gold) return 'insufficient-gold';
  if (lane.economy.gems < gems) return 'insufficient-gems';
  if (lane.economy.supplyUsed + supply > lane.economy.supplyCap) return 'insufficient-supply';

  lane.economy.gold -= gold;
  lane.economy.gems -= gems;
  lane.economy.supplyUsed += supply;
  return null;
}

/**
 * §7.4: global tech, bought with gold, tied to damage types rather than unit
 * types - one purchase lifts every unit of that type you own, now and later.
 */
function buyTech(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  lane: Lane,
  trackId: string,
): CommandResult {
  if (state.phase !== 'build') return fail('not-build-phase');
  if (!purchasesOpen(ctx.data, state)) return fail('building-closed');

  const track = ctx.data.economy.tech.tracks.find((t) => t.id === trackId);
  if (!track) return fail('unknown-definition');

  const level = nextLevel(track.levels, lane.economy.tech[trackId] ?? 0);
  if (!level) return fail('max-tier');

  const rejection = chargeUpgrade(lane, level);
  if (rejection) return fail(rejection);

  lane.economy.tech[trackId] = level.level;
  recomputeUnitBuffs(ctx.data, ctx.defs, lane);
  return OK;
}

/** §11.4: the supply cap does not grow on its own - raising it is a purchase. */
function buySupply(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  lane: Lane,
): CommandResult {
  if (state.phase !== 'build') return fail('not-build-phase');
  if (!purchasesOpen(ctx.data, state)) return fail('building-closed');

  const ladder = ctx.data.economy.supply.capUpgrades;
  const current = lane.fortress.upgrades.supply ?? 0;
  const level = nextLevel(ladder, current);
  if (!level) return fail('max-tier');

  const rejection = chargeUpgrade(lane, level);
  if (rejection) return fail(rejection);

  lane.fortress.upgrades.supply = level.level;
  lane.economy.supplyCap = stat(level.value);
  return OK;
}

/**
 * §10.1 and §10.2: fortress and resource-building upgrades, bought with GEMS -
 * which is what makes offence and defence compete for the same currency (§11.3).
 */
function buyFortressUpgrade(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  lane: Lane,
  upgradeId: string,
): CommandResult {
  if (state.phase !== 'build') return fail('not-build-phase');
  if (!purchasesOpen(ctx.data, state)) return fail('building-closed');

  const f = ctx.data.fortress;
  const ladders: Record<string, readonly UpgradeLevel[]> = {
    hp: f.hp.upgrades,
    regen: f.regenOnLaneClear.upgrades,
    weapon: f.weapon.upgrades,
    auraStrength: f.auras.strength.upgrades,
    auraRadius: f.auras.radius.upgrades,
    gemProduction: f.resourceBuilding.upgrades,
  };

  const ladder = ladders[upgradeId];
  if (!ladder) return fail('unknown-definition');

  const level = nextLevel(ladder, lane.fortress.upgrades[upgradeId] ?? 0);
  if (!level) return fail('max-tier');

  const rejection = chargeUpgrade(lane, level);
  if (rejection) return fail(rejection);

  lane.fortress.upgrades[upgradeId] = level.level;
  const value = stat(level.value);

  switch (upgradeId) {
    case 'hp': {
      // Raising the cap heals by the difference rather than to full: an upgrade
      // should not be a panic button mid-siege.
      const gained = value - lane.fortress.maxHp;
      lane.fortress.maxHp = value;
      lane.fortress.hp = Math.min(value, lane.fortress.hp + Math.max(0, gained));
      break;
    }
    case 'regen':
      lane.fortress.regenPerClear = value;
      break;
    case 'weapon':
      lane.fortress.weaponDamage = value;
      break;
    case 'auraStrength':
      lane.fortress.auraStrength = value;
      break;
    case 'auraRadius':
      lane.fortress.auraRadius = value;
      break;
    case 'gemProduction':
      lane.fortress.gemsPerWave = value;
      break;
  }

  // §11.6: passive income from fortress upgrades, paid out each wave.
  lane.economy.passiveIncome += stat(level.passiveIncome ?? null);
  return OK;
}

/**
 * §7.3: the upgrade happens IN PLACE - the unit keeps its tile and its identity,
 * gains stats and possibly an ability. Priced at roughly 1.6x base for 2.2x
 * value, so going tall is more gold-efficient than going wide but requires board
 * presence you already paid for.
 */
function upgradeUnit(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  lane: Lane,
  unitId: number,
): CommandResult {
  if (state.phase !== 'build') return fail('not-build-phase');
  if (!purchasesOpen(ctx.data, state)) return fail('building-closed');

  const unit = lane.units.find((u) => u.id === unitId && u.alive);
  if (!unit) return fail('no-such-unit');

  const current = ctx.defs.units.get(unit.defId);
  if (!current) return fail('unknown-definition');
  if (!current.upgradesTo) return fail('max-tier');

  const next = ctx.defs.units.get(current.upgradesTo);
  if (!next) return fail('unknown-definition');

  const goldCost = stat(next.goldCost);
  // Some upgrades cost additional supply; that is a per-unit data field, not a
  // global rule (§7.3).
  const supplyCost = stat(next.supplyCost);

  if (lane.economy.gold < goldCost) return fail('insufficient-gold');
  if (lane.economy.supplyUsed + supplyCost > lane.economy.supplyCap) {
    return fail('insufficient-supply');
  }

  lane.economy.gold -= goldCost;
  lane.economy.supplyUsed += supplyCost;

  // In place: same id, same tile. Only the definition and the stats change.
  unit.defId = next.id;
  unit.maxHp = stat(next.hp);
  unit.hp = unit.maxHp;
  unit.armour = next.armour;
  unit.damageType = next.damageType;
  unit.moveSpeed = stat(next.moveSpeed);
  unit.targetId = null;
  recomputeUnitBuffs(ctx.data, ctx.defs, lane);

  return OK;
}

export function applyCommand(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  command: Command,
): CommandResult {
  const lane = laneFor(state, command.teamId);
  if (!lane) return fail('eliminated');

  switch (command.kind) {
    case 'placeUnit': {
      const def = ctx.defs.units.get(command.unitDefId);
      if (!def) return fail('unknown-definition');
      return placeUnit(ctx, state, lane, def, command.tileX, command.tileY);
    }

    case 'upgradeUnit':
      return upgradeUnit(ctx, state, lane, command.unitId);

    case 'buyTech':
      return buyTech(ctx, state, lane, command.trackId);

    case 'buyFortressUpgrade':
      return buyFortressUpgrade(ctx, state, lane, command.upgradeId);

    case 'buySupply':
      return buySupply(ctx, state, lane);

    // §10.1: free and instant, once per build phase. A small per-wave decision
    // that keeps every player engaging with the damage matrix.
    case 'setWeaponType':
      if (state.phase !== 'build') return fail('not-build-phase');
      lane.fortress.weaponDamageType = command.damageType;
      return OK;

    case 'setAura':
      if (state.phase !== 'build') return fail('not-build-phase');
      lane.fortress.activeAura = command.aura;
      return OK;

    // M4: the send catalogue does not exist yet (§11.5, §18).
    case 'send':
      return fail('unknown-definition');
  }
}

export function applyCommands(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  commands: readonly Command[],
): void {
  for (const command of commands) applyCommand(ctx, state, command);
}

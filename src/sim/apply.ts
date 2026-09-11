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
 * §3.3: from wave 25 players can no longer build new defensive units. Gold keeps
 * accumulating and stays spendable - the attrition endgame is a sink problem,
 * not a freeze.
 */
function buildingOpen(data: GameData, state: MatchState): boolean {
  return state.wave <= data.waves.lastBuildWave;
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
  if (!buildingOpen(ctx.data, state)) return fail('building-closed');

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
  unit.targetId = null;

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

    // M3/M4 territory: tech, fortress upgrades, supply cap and sends all need
    // upgrade ladders and a send catalogue that data/ does not carry yet.
    case 'buyTech':
    case 'buyFortressUpgrade':
    case 'buySupply':
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

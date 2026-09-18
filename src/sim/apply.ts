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
import { secondsToTicks } from './constants.ts';
import { inBounds, tileOccupiedByUnit } from './grid.ts';
import { createUnit } from './spawn.ts';
import { recomputeUnitBuffs } from './buffs.ts';
import { gemPayoutTicks } from './state.ts';
import type { UpgradeLevel } from '../data/schema.ts';
import type { GameData } from '../data/schema.ts';
import type { Lane, MatchState, UnitSpend } from './types.ts';

export interface CommandResult {
  ok: boolean;
  rejection?: CommandRejection;
}

const OK: CommandResult = { ok: true };

function fail(rejection: CommandRejection): CommandResult {
  return { ok: false, rejection };
}

/**
 * WHEN THE SHOP IS OPEN, and when the BOARD is.
 *
 * Two different windows, and conflating them was a mistake worth naming. The
 * board - placing a unit, upgrading one in place, selling one back - is a
 * build-phase thing (§3.1): the line is what the wave is about to hit, and
 * rearranging it mid-wave would make every fight a reaction test. Everything
 * else is not. Tech, fortress and supply ladders, the weapon's damage type,
 * the active aura and sends are all decisions about the NEXT wave or about the
 * match as a whole, and there is no reason a player should have to sit and
 * watch a fight they cannot act on for want of a tab.
 *
 * So the shop stays open in combat, and closes only when the Final Showdown
 * starts (§3.3, replaced): the arena is fought with the army you brought, and
 * whatever gold is still on hand when the armies march stops mattering.
 *
 * A send bought during combat behaves exactly as one bought during a build
 * phase: its monsters join the target's NEXT wave (`spawnWave` in tick.ts),
 * because `incomingSends` is drained when a wave spawns rather than when it is
 * queued. Nothing lands on a fight already in progress.
 *
 * `shopOpen` is checked BEFORE the build-phase check wherever both apply, so
 * that a tap during the showdown is answered with "there is nothing left to
 * buy" rather than with "wait for the build phase", which would be a lie about
 * a build phase that is never coming.
 */
function shopOpen(state: MatchState): boolean {
  return state.phase !== 'showdown';
}

/** §3.1: the line itself is only editable while a wave is not running. */
function boardOpen(state: MatchState): boolean {
  return state.phase === 'build';
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
  if (!shopOpen(state)) return fail('building-closed');
  // §3.1: building happens in the build phase.
  if (!boardOpen(state)) return fail('not-build-phase');

  // §7.1: you play one builder. Checked here rather than left to the UI,
  // because the UI is a client and a client is not trusted with rules (§15.1).
  if (def.builderId !== lane.builderId) return fail('wrong-builder');

  if (!inBounds(ctx.data.lane.buildZone, tileX, tileY)) return fail('tile-out-of-bounds');
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

  const unit = createUnit(state, def, tileX, tileY, stat(ctx.data.abilities.energy.max));
  // Stamped here rather than in `createUnit`, which also builds units for
  // tests and fixtures that nobody paid for.
  unit.spend.thisPhase = goldCost;
  unit.supplyPaid = supplyCost;
  lane.units.push(unit);
  recomputeUnitBuffs(ctx.data, ctx.defs, lane);

  return OK;
}

/**
 * What selling this unit returns right now (§11, decided).
 *
 * Per purchase, not per unit: gold spent in the build phase now in progress
 * comes back in full and gold spent earlier at the discount, so an upgrade
 * bought by mistake is as undoable as a unit bought by mistake.
 */
export function sellValue(data: GameData, spend: UnitSpend): number {
  const rates = data.economy.sell;
  const full = stat(rates.sameBuildPhase);
  const later = stat(rates.later);
  return Math.floor(spend.thisPhase * full + spend.earlier * later);
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
  if (!shopOpen(state)) return fail('building-closed');

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
  if (!shopOpen(state)) return fail('building-closed');

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
  if (!shopOpen(state)) return fail('building-closed');

  const f = ctx.data.fortress;
  const ladders: Record<string, readonly UpgradeLevel[]> = {
    hp: f.hp.upgrades,
    regen: f.regen.upgrades,
    weapon: f.weapon.upgrades,
    auraStrength: f.auras.strength.upgrades,
    auraRadius: f.auras.radius.upgrades,
    gemOutput: f.resourceBuilding.output.upgrades,
    gemRate: f.resourceBuilding.rate.upgrades,
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
      lane.fortress.regenPerSecond = value;
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
    case 'gemOutput':
      lane.fortress.gemsPerPayout = value;
      break;
    case 'gemRate': {
      // `value` is a multiple of the base rate, so it divides the interval.
      // The countdown already running is left where it is: an upgrade speeds
      // up every payout after this one, it does not hand you the current one.
      const was = lane.fortress.gemPayoutTicks;
      lane.fortress.gemPayoutTicks = gemPayoutTicks(ctx.data, value);
      lane.fortress.gemCooldown = Math.min(lane.fortress.gemCooldown, was);
      break;
    }
  }

  // §11.6: passive income from fortress upgrades, paid out each wave.
  lane.economy.passiveIncome += stat(level.passiveIncome ?? null);
  return OK;
}

/**
 * Every fortress upgrade ladder there is (§10.1).
 *
 * Exported because the wire format indexes upgrades by position rather than
 * sending their names, and two lists that have to agree should be one list.
 */
export const FORTRESS_UPGRADE_IDS = [
  'hp',
  'regen',
  'weapon',
  'auraStrength',
  'auraRadius',
  'gemOutput',
  'gemRate',
] as const;

/**
 * §11.5: add monsters to an opponent's next wave.
 *
 * The three rules that make this the gang-up-on-the-leader mechanic rather than
 * a random grief button, all of them from §11.5 and §13:
 *
 *   - The SENDER picks the target. That is intentional, and it is what lets
 *     three players cooperate against whoever is ahead without a mechanism for
 *     cooperating.
 *   - The DEFENDER gets the bounty, so a send is not a way to starve someone.
 *     That falls out for free: the monsters spawn in their lane, and bounty is
 *     paid to the lane that kills them.
 *   - An eliminated player may not send. §13 calls this no kingmaking: someone
 *     with nothing left to play for should not get to decide who wins.
 *
 * Sending also grants the sender permanent passive income, which is what makes
 * an early send an investment and a late one a pure attack (§11.6).
 */
function send(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  lane: Lane,
  targetTeamId: string,
  sendId: string,
): CommandResult {
  // §11.5 does not say when you may send. Any time the shop is open: a send
  // aims at the target's NEXT wave whenever it is bought (`spawnWave` drains
  // `incomingSends` on spawn), so buying one mid-combat changes nothing about
  // where the monsters land - only about when the player got to decide. It was
  // build-phase-only at first, on the argument that one shopping window is
  // tidier than two; watching a wave you have no way to act on is worse than
  // untidy.
  if (!shopOpen(state)) return fail('building-closed');

  const def = ctx.defs.sends.get(sendId);
  if (!def) return fail('unknown-definition');

  // Sending at yourself would be a way to farm your own income grant.
  if (targetTeamId === lane.teamId) return fail('invalid-target');

  const target = state.teams.find((t) => t.id === targetTeamId);
  if (!target) return fail('invalid-target');
  if (target.eliminated) return fail('target-eliminated');

  const targetLane = state.lanes[targetTeamId];
  if (!targetLane) return fail('invalid-target');

  const gemCost = stat(def.gemCost);
  if (lane.economy.gems < gemCost) return fail('insufficient-gems');

  lane.economy.gems -= gemCost;
  lane.economy.passiveIncome += stat(def.incomeGranted);

  for (const monsterId of def.monsters) {
    targetLane.incomingSends.push({ defId: monsterId, fromTeamId: lane.teamId, sendId: def.id });
  }
  targetLane.sendLog.push({ sendId: def.id, fromTeamId: lane.teamId });

  // §12: some sends buy a look at the lane you just attacked. Vision is
  // refreshed rather than stacked, so spamming probes does not bank hours of it.
  if (def.grantsVision) {
    const sender = state.teams.find((t) => t.id === lane.teamId);
    if (sender) {
      const ticks = secondsToTicks(stat(def.visionDurationSeconds));
      sender.vision[targetTeamId] = Math.max(sender.vision[targetTeamId] ?? 0, ticks);
    }
  }

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
  if (!shopOpen(state)) return fail('building-closed');
  if (!boardOpen(state)) return fail('not-build-phase');

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
  unit.spend.thisPhase += goldCost;
  unit.supplyPaid += supplyCost;

  // In place: same id, same tile. Only the definition and the stats change.
  unit.defId = next.id;
  unit.baseMaxHp = stat(next.hp);
  unit.maxHp = unit.baseMaxHp;
  unit.hp = unit.maxHp;
  // A tier is a different unit with different abilities, so the clocks and the
  // threshold latches of the old one mean nothing (abilityRuntime.ts). The
  // statuses on it are left alone: a slow cast on this body is still on this
  // body, and buying an upgrade should not be a way to shrug one off.
  unit.clocks = {};
  unit.latched = [];
  unit.armour = next.armour;
  unit.damageType = next.damageType;
  unit.moveSpeed = stat(next.moveSpeed);
  unit.radius = stat(next.bodyRadius);
  unit.range = stat(next.range);
  unit.targetId = null;
  recomputeUnitBuffs(ctx.data, ctx.defs, lane);

  return OK;
}

/**
 * §11, decided: sell a unit back for what `sellValue` says.
 *
 * Build phase only, and closed once the showdown starts like every other
 * transaction (§3.3, replaced) - the arena is fought with what you brought, and
 * converting a line into gold nobody can spend would be a strange exception to
 * that.
 *
 * The unit is REMOVED rather than killed. A dead unit respawns at the next
 * build phase (§5.4); a sold one is gone, and its tile is free again.
 */
function sellUnit(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  lane: Lane,
  unitId: number,
): CommandResult {
  if (!shopOpen(state)) return fail('building-closed');
  if (!boardOpen(state)) return fail('not-build-phase');

  const unit = lane.units.find((u) => u.id === unitId);
  if (!unit) return fail('no-such-unit');

  lane.economy.gold += sellValue(ctx.data, unit.spend);
  // Supply comes back whole whatever the gold does: it is a slot the unit was
  // occupying, not a price it paid.
  lane.economy.supplyUsed = Math.max(0, lane.economy.supplyUsed - unit.supplyPaid);
  lane.units = lane.units.filter((u) => u !== unit);
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

    case 'sellUnit':
      return sellUnit(ctx, state, lane, command.unitId);

    case 'buyTech':
      return buyTech(ctx, state, lane, command.trackId);

    case 'buyFortressUpgrade':
      return buyFortressUpgrade(ctx, state, lane, command.upgradeId);

    case 'buySupply':
      return buySupply(ctx, state, lane);

    // §10.1: free and instant. A small decision that keeps every player
    // engaging with the damage matrix, and one of the things there is no
    // reason to make somebody wait for a build phase to take (`shopOpen`).
    case 'setWeaponType':
      if (!shopOpen(state)) return fail('building-closed');
      lane.fortress.weaponDamageType = command.damageType;
      return OK;

    case 'setAura':
      if (!shopOpen(state)) return fail('building-closed');
      lane.fortress.activeAura = command.aura;
      return OK;

    case 'send':
      return send(ctx, state, lane, command.targetTeamId, command.sendId);
  }
}

export function applyCommands(
  ctx: { data: GameData; defs: DefIndex },
  state: MatchState,
  commands: readonly Command[],
): void {
  for (const command of commands) applyCommand(ctx, state, command);
}

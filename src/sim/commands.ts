/**
 * Player inputs. DESIGN.md §15.1: the simulation takes state + inputs and
 * returns new state, so every player action must be expressible as one of
 * these - not as a method call from the UI.
 *
 * Commands are validated inside the simulation, never by the renderer. The
 * server runs the identical module, so a client that fakes an affordable cost
 * simply desyncs and is caught.
 */

import type { DamageType, AuraType } from '../data/schema.ts';
import type { EntityId, TeamId } from './types.ts';

export interface PlaceUnitCommand {
  kind: 'placeUnit';
  teamId: TeamId;
  unitDefId: string;
  tileX: number;
  tileY: number;
}

/** Upgrade in place: the unit keeps its tile and its identity (§7.3). */
export interface UpgradeUnitCommand {
  kind: 'upgradeUnit';
  teamId: TeamId;
  unitId: EntityId;
}

export interface BuyTechCommand {
  kind: 'buyTech';
  teamId: TeamId;
  trackId: string;
}

export interface BuyFortressUpgradeCommand {
  kind: 'buyFortressUpgrade';
  teamId: TeamId;
  /** e.g. 'hp' | 'weapon' | 'auraStrength' | 'auraRadius' | 'gemProduction'. */
  upgradeId: string;
}

export interface BuySupplyCommand {
  kind: 'buySupply';
  teamId: TeamId;
}

/** Free and instant, once per build phase (§10.1). */
export interface SetWeaponTypeCommand {
  kind: 'setWeaponType';
  teamId: TeamId;
  damageType: DamageType;
}

export interface SetAuraCommand {
  kind: 'setAura';
  teamId: TeamId;
  aura: AuraType;
}

/** The sender picks the target: this is the gang-up-on-the-leader mechanic. */
export interface SendCommand {
  kind: 'send';
  teamId: TeamId;
  targetTeamId: TeamId;
  sendId: string;
}

export type Command =
  | PlaceUnitCommand
  | UpgradeUnitCommand
  | BuyTechCommand
  | BuyFortressUpgradeCommand
  | BuySupplyCommand
  | SetWeaponTypeCommand
  | SetAuraCommand
  | SendCommand;

/** Why a command was refused. Surfaced to the UI; never thrown. */
export type CommandRejection =
  | 'not-build-phase'
  | 'tile-occupied'
  | 'tile-out-of-bounds'
  | 'insufficient-gold'
  | 'insufficient-gems'
  | 'insufficient-supply'
  | 'unknown-definition'
  | 'no-such-unit'
  | 'max-tier'
  | 'building-closed'
  | 'eliminated'
  | 'target-eliminated'
  /** §7.1: that unit belongs to a builder this lane is not playing. */
  | 'wrong-builder'
  /** No such opponent, or the sender aimed at their own lane. */
  | 'invalid-target';

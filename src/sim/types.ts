/**
 * Simulation state. DESIGN.md §15.1.
 *
 * Everything here is plain data - no classes with behaviour, no references to
 * renderer objects - so a state can be snapshotted, diffed for desync
 * detection, and sent over the wire.
 *
 * Positions are in TILE coordinates, not pixels. The renderer converts. y
 * increases toward the fortress: y = 0 is the spawn edge, y = depth is the
 * fortress. Nothing in the simulation knows the screen size.
 */

import type { ArmourType, DamageType } from '../data/schema.ts';
import type { OccupancyGrid } from './grid.ts';

export type EntityId = number;
export type PlayerId = string;
export type TeamId = string;

export type Phase = 'build' | 'combat';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * §2: model a lane as owned by a team of one or more players from day one, so
 * 2v2 is configuration rather than a rewrite. v1 fills these with one player.
 */
export interface Team {
  id: TeamId;
  playerIds: PlayerId[];
  eliminated: boolean;
  /** Locked in at the moment of elimination (§13). */
  placement: number | null;
}

export interface DefensiveUnit {
  id: EntityId;
  /** Key into units.json. Tier upgrades swap this in place (§7.3). */
  defId: string;
  tileX: number;
  tileY: number;
  hp: number;
  maxHp: number;
  armour: ArmourType;
  damageType: DamageType;
  /** Ticks until the next attack may fire. */
  cooldown: number;
  /**
   * Held until the target dies or leaves range - never re-evaluated before
   * then (§5.2). This is what stops target-switch jitter.
   */
  targetId: EntityId | null;
  alive: boolean;
}

export interface Monster {
  id: EntityId;
  defId: string;
  /**
   * Stats resolved at spawn from the definition and the wave's scaling (§9.1),
   * so a tick never looks a definition up or recomputes a growth curve.
   */
  damage: number;
  attackSpeed: number;
  moveSpeed: number;
  range: number;
  bounty: number;
  /**
   * Which wave this monster belongs to. Enrage is tracked per wave, not per
   * lane or per monster (§8): a fresh wave joining a still-alive enraged wave
   * does not inherit its multiplier.
   */
  waveNumber: number;
  pos: Vec2;
  hp: number;
  maxHp: number;
  armour: ArmourType;
  damageType: DamageType;
  cooldown: number;
  targetId: EntityId | null;
  /** Ticks until this monster re-evaluates nearest target (§5.1). */
  retargetIn: number;
  /** Position at the start of the current stuck-detection window (§5.3). */
  stuckAnchor: Vec2;
  stuckTicks: number;
  /** True once stuck detection has fired; the monster attacks what is nearest. */
  isStuck: boolean;
  /** True when besieging the fortress: all defenders dead (§5.5). */
  besieging: boolean;
  alive: boolean;
}

/** A wave's own enrage clock, which stops when its last monster dies (§8). */
export interface WaveClock {
  waveNumber: number;
  /** Ticks since this wave spawned. */
  age: number;
  /** Monsters of this wave still alive or still in reserve. */
  remaining: number;
}

export interface Fortress {
  hp: number;
  maxHp: number;
  /**
   * HP restored when the lane goes fully clear (§5.5).
   *
   * Lives on the lane rather than being read from data each time, because it is
   * bought rather than given: it starts at whatever `fortress.regenOnLaneClear`
   * says (currently 0 - self-healing is an upgrade, not a default) and a
   * purchased upgrade raises it.
   */
  regenPerClear: number;
  /** Player-selectable each build phase, free and instant (§10.1). */
  weaponDamageType: DamageType;
  weaponCooldown: number;
  /** One aura active at a time, chosen by the player (§10.1). */
  activeAura: string | null;
  destroyed: boolean;
}

export interface Economy {
  gold: number;
  gems: number;
  supplyUsed: number;
  supplyCap: number;
  /** Gold per wave from fortress upgrades and from sending (§11.6). */
  passiveIncome: number;
  /** Tech track id -> level purchased (§7.4). */
  tech: Record<string, number>;
}

export interface Lane {
  teamId: TeamId;
  units: DefensiveUnit[];
  monsters: Monster[];
  /**
   * Which tiles are impassable (§4.2 - units block movement). Rebuilt when
   * units change, never per tick (§15.3); `occupancyDirty` says when.
   */
  occupancy: OccupancyGrid;
  occupancyDirty: boolean;
  /** §3.2: all living players ready skips the rest of the build phase. */
  ready: boolean;
  /**
   * Overflow beyond maxConcurrentMonsters. Spawns one at a time as active
   * monsters die, into its own wave's current enrage state (§8.1).
   */
  reserve: { defId: string; waveNumber: number }[];
  /** Extra monsters sent by opponents, merged into the next wave (§11.5). */
  incomingSends: { defId: string; fromTeamId: TeamId }[];
  fortress: Fortress;
  economy: Economy;
}

export interface MatchState {
  /** One seed per match, shared by every client and the server (§9.2). */
  seed: number;
  rngState: number;
  /** Ticks since match start. The only clock the simulation has. */
  tick: number;
  wave: number;
  phase: Phase;
  /** Ticks remaining in the current phase. */
  phaseTicksLeft: number;
  teams: Team[];
  /** Keyed by team id. Every living team owns exactly one lane. */
  lanes: Record<TeamId, Lane>;
  /** Enrage clocks for every wave with monsters still alive anywhere. */
  waveClocks: WaveClock[];
  nextEntityId: EntityId;
  /** Set when one team (or none) remains (§13). */
  finished: boolean;
  /** How many teams have been eliminated, so placements do not collide (§13). */
  eliminatedCount: number;
}

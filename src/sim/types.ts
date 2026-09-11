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
  /**
   * The tile it was built on. Kept so an upgrade stays "in place" (§7.3) and so
   * respawn returns it to formation rather than wherever it died.
   */
  homeTileX: number;
  homeTileY: number;
  /**
   * Current position in tile coordinates.
   *
   * DESIGN CHANGE from §5.2, which had units permanently stationary: a unit
   * with nothing in range now advances toward the nearest monster. It still
   * never chases a target it is already fighting - once something is in range
   * it plants and holds, which is what keeps §5.2's no-jitter guarantee.
   */
  pos: Vec2;
  /** Tiles per second while advancing. */
  moveSpeed: number;
  /** Distance to this unit's goal from the flow field; the yielding order. */
  pathCost: number;
  /**
   * The monster this unit is walking toward, held until it dies or something
   * is clearly closer. Without this hysteresis a unit flips between two
   * near-equidistant monsters every tick and visibly shivers.
   */
  advanceTargetId: EntityId | null;
  /** Stuck-detection window, same fallback the monsters use (§5.3). */
  stuckAnchor: Vec2;
  /** Last candidate direction taken; steering hysteresis (see steering.ts). */
  lastStepIndex: number;
  stuckTicks: number;
  isStuck: boolean;
  hp: number;
  maxHp: number;
  armour: ArmourType;
  damageType: DamageType;
  /**
   * Cached tech multipliers (§7.4). Recomputed when something is bought or
   * upgraded and on wave start - never per tick (§15.3).
   */
  techDamage: number;
  techAttackSpeed: number;
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
  /** Distance to this monster's goal from the flow field; the yielding order. */
  pathCost: number;
  /** Position at the start of the current stuck-detection window (§5.3). */
  stuckAnchor: Vec2;
  /** Last candidate direction taken; steering hysteresis (see steering.ts). */
  lastStepIndex: number;
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
  /**
   * Resolved fortress stats. These live on the lane rather than being read from
   * data each tick because they are BOUGHT: each starts at its data base and a
   * purchased upgrade raises it (§10.1).
   */
  weaponDamage: number;
  weaponAttackSpeed: number;
  weaponRange: number;
  auraStrength: number;
  auraRadius: number;
  gemsPerWave: number;
  /** Upgrade id -> level purchased, e.g. `{ hp: 2, weapon: 1 }`. */
  upgrades: Record<string, number>;
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

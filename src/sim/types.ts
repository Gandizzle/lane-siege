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
  /**
   * Ticks of sight this team currently has of each other team's lane, granted
   * by sends (§11.5, §12). Counts down every tick.
   *
   * Vision lives on the WATCHER, not on the lane being watched: two opponents
   * can be watching the same lane with different time left, and the lane has no
   * business knowing who is looking at it.
   */
  vision: Record<TeamId, number>;
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
  /** Tiles per second while advancing. 0 pins it: it is then terrain. */
  moveSpeed: number;
  /**
   * Body radius in tiles. The one circle that is collision shape, hit shape and
   * drawn size at once - the silhouette is drawn inside it.
   */
  radius: number;
  /** Reach, edge to edge, in tiles. Copied from the definition on build and upgrade. */
  range: number;
  /**
   * In range of something and attacking it. An engaged body does not move and
   * nothing moves it: it is an obstacle to everyone else, ally or enemy. That
   * one asymmetry is what keeps two bodies in contact perfectly still - see
   * motion.ts.
   */
  engaged: boolean;
  /**
   * Where it is going to be this tick: engaged, pinned, or already moved. A
   * seeker that has not moved yet yields to those that have (motion.ts).
   */
  settled: boolean;
  /**
   * Distance to the nearest free attack position, from the distance field.
   * The priority order among seekers: whoever is nearer moves first and the
   * rest slide around it.
   */
  pathCost: number;
  /**
   * Which field cell it steered to last tick, or -1. Hysteresis only: a body on
   * a cell boundary with no memory alternates between two equal neighbours.
   */
  fieldCell: number;
  /** The direction it wants to walk this tick, decided before anyone moves. */
  moveX: number;
  moveY: number;
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
  /** Body radius in tiles: collision, hit and drawn size at once. */
  radius: number;
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
  /** In range and attacking; immovable. See DefensiveUnit.engaged. */
  engaged: boolean;
  /** See DefensiveUnit.settled. */
  settled: boolean;
  /** Distance to the nearest free attack position; the priority order. */
  pathCost: number;
  /** Field cell steered to last tick, or -1; steering hysteresis. */
  fieldCell: number;
  /** The direction it wants to walk this tick, decided before anyone moves. */
  moveX: number;
  moveY: number;
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

/**
 * One blow landed this tick: who swung, and at what. Purely a record for the
 * renderer to animate from (§14.2) - nothing in the simulation reads it back,
 * and the match plays out identically whether or not anybody is looking.
 *
 * Ids rather than positions, because the renderer already has every body's
 * position and its own interpolation history, and two numbers on the wire is a
 * twentieth of what four would cost at the §15.3 load.
 *
 * `FORTRESS_ID` stands in on either side: a monster besieging the fortress
 * (§5.5) attacks it, and the fortress weapon (§10.1) attacks from it.
 */
export interface Attack {
  attackerId: EntityId;
  targetId: EntityId;
}

/** Neither a unit nor a monster: the fortress, as an attacker or a target. */
export const FORTRESS_ID = -1;

export interface Lane {
  teamId: TeamId;
  /**
   * Which of the four rosters this lane builds from (§7.1).
   *
   * Chosen before the match and fixed for it: §6.1 makes a builder a complete
   * package - all four damage types, at that builder's quality - and mixing two
   * would hand a player the best unit of each and delete the choice.
   */
  builderId: string;
  units: DefensiveUnit[];
  monsters: Monster[];
  /**
   * Overflow beyond maxConcurrentMonsters. Spawns one at a time as active
   * monsters die, into its own wave's current enrage state (§8.1).
   */
  reserve: { defId: string; waveNumber: number }[];
  /** Extra monsters sent by opponents, merged into the next wave (§11.5). */
  incomingSends: { defId: string; fromTeamId: TeamId }[];
  /**
   * Sends this lane has received, newest last, for the "you are being attacked
   * by X" notice. Cleared when the wave they joined spawns.
   */
  sendLog: { sendId: string; fromTeamId: TeamId }[];
  /**
   * Blows landed on THIS tick, cleared at the top of the next one. Written by
   * the combat stages and read by nothing in the simulation - see `Attack`.
   */
  attacks: Attack[];
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

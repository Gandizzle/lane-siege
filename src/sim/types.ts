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
import type { Status } from './status.ts';

export type EntityId = number;
export type PlayerId = string;
export type TeamId = string;

/**
 * §3.1, plus §3.3's ending, replaced. `showdown` is the Final Showdown: no lanes, no
 * monsters, no building - every surviving army in one arena at once.
 */
export type Phase = 'build' | 'combat' | 'showdown';

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
  /**
   * What to call this team on screen, or empty for "nobody has said".
   *
   * Public, and never secret: §12's fog is about what somebody has BUILT, and
   * who they are is the opposite of that - the whole point of four tabs across
   * the top is knowing who is being worn down. Empty rather than defaulted
   * here, so the fallback label ("Lane 2") stays a presentation decision in
   * one place rather than a string the simulation invents.
   */
  name: string;
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

/**
 * What has been paid for one unit, split by WHEN it was paid, so selling can
 * refund a mistake in full and an old investment at a discount (§11, sell).
 *
 * `thisPhase` is everything spent on it during the build phase now in progress
 * - the unit itself and any upgrade bought since - and rolls into `earlier`
 * when the next build phase opens. Splitting per PURCHASE rather than per unit
 * is what makes an upgrade bought by mistake undoable too: the alternative
 * refunds a fresh upgrade at half price because the body under it is old.
 */
export interface UnitSpend {
  /** Gold spent during the build phase now in progress. */
  thisPhase: number;
  /** Gold spent in any earlier build phase. */
  earlier: number;
}

export interface DefensiveUnit {
  id: EntityId;
  /** Key into units.json. Mark upgrades swap this in place (§7.3). */
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
  /**
   * Half-length of the horizontal spine the radius is swept along (motion.ts).
   * 0: a unit is a circle. The fortress is the only body that is not.
   */
  halfWidth: number;
  /** Always false for a unit; see `Body` in motion.ts. */
  monster: boolean;
  /** Always false for a unit: only a boss phases, and only through monsters. */
  phasesMonsters: boolean;
  /** Reach, edge to edge, in tiles. Copied from the definition on build and upgrade. */
  range: number;
  /** What has been paid for this unit, and when (§11, sell). */
  spend: UnitSpend;
  /** Supply this unit occupies, returned in full when it is sold. */
  supplyPaid: number;
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
  /**
   * Damage this unit has landed in the round now in progress (§14.1, added).
   *
   * Counted after the matrix, the tech and the aura - what the monster
   * actually lost, not what the definition says the swing is worth - and
   * never more than the target had left, so overkill on the last hit does not
   * flatter a slow, heavy unit. The lane's rows therefore add up to the HP the
   * line actually destroyed.
   *
   * Zeroed when a wave spawns, not when the build phase opens, so the numbers
   * from the fight just finished survive the whole build phase to be read.
   */
  damageDealt: number;
  /**
   * Abilities, running (§7, §18, extended). One block of fields on both kinds
   * of body, because a burn on a monster and a ward on a unit are the same
   * machinery (status.ts).
   *
   *   statuses  - every effect currently on it, with its own clock and source.
   *   energy    - the resource an expensive ability spends (abilities.json).
   *   clocks    - ticks until each ability may fire again, by ability id.
   *   latched   - threshold abilities that have fired and not yet rearmed.
   *   control*  - §18's diminishing returns: how many control effects have
   *               landed inside the current window, and how long this body is
   *               immune for once that ladder is spent.
   */
  statuses: Status[];
  energy: number;
  clocks: Record<string, number>;
  latched: string[];
  controlUses: number;
  controlWindowLeft: number;
  controlImmuneLeft: number;
  /**
   * Whether this body has had its `onSpawn` abilities fired yet.
   *
   * Fired on a body's FIRST TICK rather than by whoever created it, because
   * there are five ways onto the field - a wave spawning, the reserve admitting
   * one as a slot opens, a unit being built, a unit respawning at a build
   * phase, and the showdown transplant - and a rule with five call sites has
   * five places to be forgotten (abilityRuntime.ts).
   */
  spawnFired: boolean;
  /**
   * Maximum HP before any ability touched it. `maxHp` is the effective figure
   * and is recomputed from this whenever a `maxHealth` modifier changes, which
   * is the only way to raise a ceiling without either healing the body or
   * quietly wounding it (abilityRuntime.ts).
   */
  baseMaxHp: number;
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
   * The fortress weapon landed the killing blow (§11.1, amended).
   *
   * Set at the moment its HP crosses zero and read once, by `reapDead`, to
   * decide who is paid: a kill the wall made pays every OTHER lane a flat
   * gold, and pays this one nothing. A body is reaped on the tick it dies, so
   * the flag never has to be cleared.
   */
  killedByFortress: boolean;
  /** Body radius in tiles: collision, hit and drawn size at once. */
  radius: number;
  /**
   * Half-length of the horizontal spine the radius is swept along (motion.ts).
   * 0: a monster is a circle. The fortress is the only body that is not.
   */
  halfWidth: number;
  /** Always true. See `Body` in motion.ts. */
  monster: boolean;
  /** §3.4: a boss passes through the swarm it arrives with, and it through it. */
  phasesMonsters: boolean;
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
  /**
   * Which send delivered it, or null for a monster the wave brought (§11.5).
   *
   * Kept so the send's own abilities can be found: a paid husk arrives braced
   * and a wave's husk does not, and that difference lives on the send rather
   * than on a second husk definition.
   */
  sendId: string | null;
  /**
   * Abilities, running (§7, §18, extended). One block of fields on both kinds
   * of body, because a burn on a monster and a ward on a unit are the same
   * machinery (status.ts).
   *
   *   statuses  - every effect currently on it, with its own clock and source.
   *   energy    - the resource an expensive ability spends (abilities.json).
   *   clocks    - ticks until each ability may fire again, by ability id.
   *   latched   - threshold abilities that have fired and not yet rearmed.
   *   control*  - §18's diminishing returns: how many control effects have
   *               landed inside the current window, and how long this body is
   *               immune for once that ladder is spent.
   */
  statuses: Status[];
  energy: number;
  clocks: Record<string, number>;
  latched: string[];
  controlUses: number;
  controlWindowLeft: number;
  controlImmuneLeft: number;
  /**
   * Whether this body has had its `onSpawn` abilities fired yet.
   *
   * Fired on a body's FIRST TICK rather than by whoever created it, because
   * there are five ways onto the field - a wave spawning, the reserve admitting
   * one as a slot opens, a unit being built, a unit respawning at a build
   * phase, and the showdown transplant - and a rule with five call sites has
   * five places to be forgotten (abilityRuntime.ts).
   */
  spawnFired: boolean;
  /**
   * Maximum HP before any ability touched it. `maxHp` is the effective figure
   * and is recomputed from this whenever a `maxHealth` modifier changes, which
   * is the only way to raise a ceiling without either healing the body or
   * quietly wounding it (abilityRuntime.ts).
   */
  baseMaxHp: number;
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
   * HP restored per second, applied every tick in both phases (§5.5, amended).
   *
   * Lives on the lane rather than being read from data each time, because it is
   * bought rather than given: it starts at whatever `fortress.regen` says and a
   * purchased upgrade raises it. A steady trickle rather than a lump sum when
   * the lane goes clear - chip damage heals while you play, and a wall that is
   * losing HP faster than this is a wall that is actually under threat.
   */
  regenPerSecond: number;
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
  /**
   * §10.2, amended: the resource building pays out on its own clock.
   *
   * `gemPayoutTicks` is the interval in SIMULATION ticks, resolved from the
   * base seconds and whatever the rate ladder has been bought up to; an
   * integer countdown rather than an accumulating fraction, so a payout lands
   * on an exact tick and every client agrees on which one.
   */
  gemsPerPayout: number;
  gemPayoutTicks: number;
  gemCooldown: number;
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

/**
 * Neither a unit nor a monster: the middle of the Final Showdown's arena, as
 * somewhere to walk (§3.3, replaced).
 *
 * A unit in the arena with nothing inside its acquisition range heads for the
 * centre, so the field needs a goal to mark and the goal needs an id. Nothing
 * ever attacks it or is attacked by it.
 */
export const ARENA_CENTRE_ID = -2;

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
  incomingSends: { defId: string; fromTeamId: TeamId; sendId: string }[];
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

/**
 * One player's army in the Final Showdown (§3.3, replaced).
 *
 * The units are the SAME objects that fought the waves, moved here rather than
 * copied: what a player spent twenty-five waves building is what they bring,
 * and a copy would leave two of every unit for `snapshot` to duplicate and for
 * the view to have to choose between. `lane.units` is emptied as they move.
 */
export interface ShowdownArmy {
  teamId: TeamId;
  /**
   * Seat at the table, which is the whole of where this army fights from:
   * `legForSeat(seat)` (arena.ts) turns it into a spoke. Stored rather than
   * the spoke itself because the seat is the fact and the spoke is a reading
   * of it - and an eliminated player's spoke stays empty rather than being
   * handed to somebody else.
   */
  seat: number;
  units: DefensiveUnit[];
}

/**
 * The Final Showdown (§3.3, replaced). Null until the last wave is cleared.
 *
 * Nothing in here is private: four armies converging on one square is not a
 * thing fog of war can usefully hide, and a player who cannot see what is
 * walking at them cannot play the fight at all.
 */
export interface Showdown {
  /**
   * Ticks of fighting so far, not counting the countdown. Dampening is a
   * function of this and nothing else, so a slow client, a pause or a rejoin
   * cannot change how hard it bites (§3.3, replaced).
   */
  age: number;
  armies: ShowdownArmy[];
  /** Blows landed on this tick, as in a lane. See `Attack`. */
  attacks: Attack[];
  /**
   * Who holds the centre square this tick, and so who is hitting harder and
   * taking less (`holdTheCentre` in showdown.ts). Everyone tied for the most
   * bodies inside it; empty when nobody is standing there at all.
   *
   * Recomputed every tick rather than remembered, so it is a fact about where
   * the bodies ARE rather than about who got there first.
   */
  centreHolders: TeamId[];
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
  /**
   * The Final Showdown, once the last wave is cleared (§3.3, replaced). Null before
   * then, and `phase === 'showdown'` exactly when it is not.
   *
   * `phaseTicksLeft` is the countdown card's clock while this is running: the
   * armies stand still until it reaches zero, which is what the "Final
   * Showdown in 3..." card is counting.
   */
  showdown: Showdown | null;
  nextEntityId: EntityId;
  /** Set when one team (or none) remains (§13). */
  finished: boolean;
  /** How many teams have been eliminated, so placements do not collide (§13). */
  eliminatedCount: number;
}

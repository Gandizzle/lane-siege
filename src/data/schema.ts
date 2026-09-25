/**
 * Types for the JSON in `data/`. DESIGN.md §16.
 *
 * The doc's rule: every number is a placeholder and none of them may be
 * hardcoded. These types describe the *shape* of the balance data; the values
 * live in JSON and are edited without touching code.
 *
 * `null` in a numeric field means "not decided yet", not "zero". `loadData`
 * reports nulls as missing rather than letting them reach the simulation.
 */

export * from './abilities.ts';
import type { AbilityRef, AbilitiesFile } from './abilities.ts';

export const DAMAGE_TYPES = ['impact', 'pierce', 'blast', 'arcane'] as const;
export const ARMOUR_TYPES = ['flesh', 'plate', 'swarm', 'ward'] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];
export type ArmourType = (typeof ARMOUR_TYPES)[number];

/** A value still awaiting a playtested number. */
export type Unfilled<T> = T | null;

/** An upgrade level: what it costs and what it grants. */
export interface UpgradeLevel {
  level: number;
  goldCost: Unfilled<number>;
  gemCost: Unfilled<number>;
  supplyCost: Unfilled<number>;
  /** Flat value this level sets the stat to. */
  value: Unfilled<number>;
  /** Gold per wave this upgrade adds permanently (§11.6). */
  passiveIncome?: Unfilled<number>;
}

/** A stat that starts somewhere and can be upgraded. */
export interface UpgradableStat {
  base: Unfilled<number>;
  upgrades: UpgradeLevel[];
}

// ---------------------------------------------------------------- matrix.json

export type DamageMatrix = Record<DamageType, Record<ArmourType, number>>;

export interface MatrixFile {
  damageTypes: readonly DamageType[];
  armourTypes: readonly ArmourType[];
  multipliers: DamageMatrix;
}

// ------------------------------------------------------------------ lane.json

export interface LaneFile {
  buildZone: { width: number; depth: number };
  /** Open ground above the build grid, in tiles. Monsters spawn at its centre. */
  spawnZoneDepth: number;
  fortressZoneDepth: number;
  /**
   * The fortress as a body: what "in range of it" is measured against (§5.5).
   * It is a disc of `fortressRadius` swept along a horizontal spine of
   * `fortressHalfWidth` either side of the lane's centre - a wall, not a
   * pebble - so a wave can bring its whole front to bear on it at once.
   * Setting the half-width to 0 makes it the circle it used to be.
   */
  fortressRadius: number;
  fortressHalfWidth: number;
  /**
   * §5.1, decided: how far a monster looks for something to fight, edge to
   * edge in tiles. Outside it a monster ignores defenders and walks at the
   * fortress; inside it takes the nearest and holds it. Defensive units have no
   * equivalent cap - they have no fortress of their own to walk at, so their
   * default is "the nearest monster in the lane".
   */
  monsterAcquireRange: number;
  /**
   * §4.2, decided: units DO block movement. A monster treats every unit as a
   * solid circle it must route around.
   */
  unitsBlockMovement: Unfilled<boolean>;
  /** Cells per tile for the distance field. Finer routing, linearly more work. */
  pathSubdivision: number;
  /**
   * §12, decided: how much of an opponent's lane a player may see.
   *
   *   - `combat`  every lane while a wave is running, nothing during the build
   *               phase. The default: watching the fight is most of the fun and
   *               costs nothing, while what you are BUILDING stays yours until
   *               it fights.
   *   - `granted` only what a send bought (§11.5), which is §12 as written.
   *   - `always`  no fog at all.
   *
   * A word rather than a boolean because "no fog" and "fog except during a
   * wave" are different games, and the register in docs/OPEN-QUESTIONS.md needs
   * to be able to say which one is being played.
   */
  opponentLanes?: 'granted' | 'combat' | 'always';
}

// ----------------------------------------------------------------- units.json

export interface BuilderDef {
  id: string;
  name: string;
  /**
   * True once all six units exist. The §6.1 coverage rule - every builder must
   * field all four damage types - is only meaningful against a finished roster,
   * so it is enforced for complete builders and merely reported for the rest.
   */
  complete: boolean;
}

/**
 * Every body on the field has its own silhouette. DESIGN CHANGE from §14.2,
 * which gave one shape per armour type: with 24 units and 13 monsters that is
 * four shapes doing the work of thirty-seven, and a crowd of identical
 * hexagons tells you nothing about which of your units is which.
 *
 * What §14.2 was protecting is kept: the shape's FAMILY still says the armour
 * type, so the counter-read survives at a glance and without colour. Round
 * things are Flesh, angular things are Plate, pointed and stellar things are
 * Ward, clusters of small things are Swarm. Within a family every member is
 * distinct, and `validate.ts` refuses data in which two bodies share one, or in
 * which a shape sits in the wrong family for its armour.
 *
 * The names describe the geometry, not the unit, so a shape can be reassigned
 * without being renamed. The drawing is in render/shapes.ts.
 */
export type ShapeId =
  // Flesh: round.
  | 'orb'
  | 'egg'
  | 'bean'
  | 'pill'
  | 'teardrop'
  | 'tadpole'
  | 'bulb'
  | 'blob'
  | 'moon'
  | 'pebble'
  | 'cloud'
  | 'spindle'
  // Plate: angular.
  | 'hexagon'
  | 'pentagon'
  | 'slab'
  | 'square'
  | 'shield'
  | 'wedge'
  | 'chevron'
  | 'keep'
  // Ward: pointed.
  | 'diamond'
  | 'kite'
  | 'star4'
  | 'star5'
  | 'star6'
  | 'cross'
  | 'hourglass'
  | 'spear'
  | 'dart'
  | 'crown'
  // Swarm: many small things.
  | 'cluster3'
  | 'dots3'
  | 'dots4'
  | 'dots5'
  | 'ring6'
  | 'tri4'
  | 'diamonds3'
  | 'squares4'
  | 'flock'
  | 'hive';

/** Which armour type each silhouette belongs to. The counter-read lives here. */
export const SHAPE_FAMILY: Record<ShapeId, ArmourType> = {
  orb: 'flesh',
  egg: 'flesh',
  bean: 'flesh',
  pill: 'flesh',
  teardrop: 'flesh',
  tadpole: 'flesh',
  bulb: 'flesh',
  blob: 'flesh',
  moon: 'flesh',
  pebble: 'flesh',
  cloud: 'flesh',
  spindle: 'flesh',
  hexagon: 'plate',
  pentagon: 'plate',
  slab: 'plate',
  square: 'plate',
  shield: 'plate',
  wedge: 'plate',
  chevron: 'plate',
  keep: 'plate',
  diamond: 'ward',
  kite: 'ward',
  star4: 'ward',
  star5: 'ward',
  star6: 'ward',
  cross: 'ward',
  hourglass: 'ward',
  spear: 'ward',
  dart: 'ward',
  crown: 'ward',
  cluster3: 'swarm',
  dots3: 'swarm',
  dots4: 'swarm',
  dots5: 'swarm',
  ring6: 'swarm',
  tri4: 'swarm',
  diamonds3: 'swarm',
  squares4: 'swarm',
  flock: 'swarm',
  hive: 'swarm',
};

export interface UnitDef {
  id: string;
  builderId: string;
  name: string;
  /**
   * Which of the builder's six lines this is: 1 (cheapest) to 6 (dearest).
   *
   * The power ladder, and what the price bands in docs/BALANCE.md are set
   * against. Shared by every mark of a line, because upgrading a Pledge does
   * not turn it into a different one of Ironvow's six.
   */
  rung: number;
  /**
   * How far up its own upgrade chain this is: 1, 2 or 3. Every one of the
   * twenty-four lines has all three (§7.3).
   *
   * Was called `tier`, which also had to mean `rung` and so meant neither.
   */
  mark: number;
  /** A mark is bought in place: same tile, same identity (§7.3). */
  upgradesTo?: string;
  goldCost: Unfilled<number>;
  supplyCost: Unfilled<number>;
  /**
   * What this unit is worth BEYOND its raw numbers, as a multiple.
   *
   * The price ladder values a body as `sqrt(offence x defence)`, which is blind
   * to everything a unit does that is not damage, reach or hit points: a taunt,
   * a shield, a slow, an execute, a roster that happens to fight well together.
   * This is where a measurement of that goes.
   *
   * Above 1 means the unit is worth more than it looks, so `npm run reprice`
   * gives it FEWER raw stats for the same price. Below 1 is the reverse.
   * Absent is 1, which is "nothing measured yet" rather than "nothing there".
   *
   * It is the one balance knob that is meant to be set from evidence rather
   * than from a ladder - `npm run showdown` is where the evidence comes from -
   * so every value here should be able to name the run that justified it.
   */
  valueWeight?: Unfilled<number>;
  hp: Unfilled<number>;
  armour: ArmourType;
  /** Its own silhouette, in `armour`'s family. Shared along the upgrade chain. */
  shape: ShapeId;
  /** Damage per attack, before the matrix multiplier. */
  damage: Unfilled<number>;
  damageType: DamageType;
  /** Attacks per second. */
  attackSpeed: Unfilled<number>;
  /**
   * Attack reach in tiles, measured EDGE TO EDGE rather than centre to centre.
   * A melee value near zero therefore means "walk up until the bodies touch",
   * which is what melee should look like; centre-to-centre range left a gap the
   * width of both bodies.
   */
  range: Unfilled<number>;
  /** Collision and drawn radius in tiles. */
  bodyRadius: Unfilled<number>;
  /**
   * Short lines describing what is special about this unit, shown in the panel
   * when it is selected.
   *
   * DESCRIPTIVE ONLY. Nothing in the simulation reads these: a line here does
   * not give a unit an ability, it describes one the rules already give it. Add
   * the mechanic first and the line second, or the panel starts lying.
   */
  traits?: string[];
  /**
   * What this unit DOES beyond its stats, by id into `abilities.json`.
   *
   * The theory the roster is built on: a unit that differs from the next one
   * only in armour type and damage type is not a unit anybody remembers, so
   * every unit has an ability - some from Mark I, some earned by upgrading.
   * `"thorn_bite"` is rank 1; `{ "id": "thorn_bite", "rank": 2 }` is the same
   * ability with the mark's numbers (abilities.ts).
   *
   * Unlike `traits` these are not decorative: `validate.ts` refuses a
   * reference to an ability the simulation does not honour, so what the panel
   * says about a unit is a rule the unit has.
   */
  abilities?: AbilityRef[];
  /**
   * Tiles per second while advancing on a distant monster. DESIGN CHANGE from
   * §5.2 (units were stationary); 0 restores the original behaviour per unit.
   */
  moveSpeed: Unfilled<number>;
}

export interface UnitsFile {
  builders: BuilderDef[];
  units: UnitDef[];
}

// -------------------------------------------------------------- monsters.json

export interface MonsterDef {
  id: string;
  name: string;
  hp: Unfilled<number>;
  armour: ArmourType;
  /** Its own silhouette, in `armour`'s family. */
  shape: ShapeId;
  damage: Unfilled<number>;
  damageType: DamageType;
  attackSpeed: Unfilled<number>;
  range: Unfilled<number>;
  /** Tiles per second. */
  moveSpeed: Unfilled<number>;
  /** Gold paid to the defender on kill, always (§11.1). */
  bounty: Unfilled<number>;
  /** Collision and drawn radius in tiles. Bosses are genuinely bigger. */
  bodyRadius: Unfilled<number>;
  /**
   * What this monster does beyond walking and hitting (abilities.json).
   *
   * Deliberately not every monster. A wave whose every member has something
   * special is a wave with nothing special in it, and the cheap bodies are
   * there to be cheap bodies - so the ones that carry an ability are the ones
   * a defence should recognise on sight and answer differently.
   */
  abilities?: AbilityRef[];
  isBoss?: boolean;
}

export interface MonstersFile {
  monsters: MonsterDef[];
  bosses: MonsterDef[];
}

// ----------------------------------------------------------------- waves.json

export interface EnrageConfig {
  /** Seconds after the wave spawns before enrage starts (§8). */
  delaySeconds: number;
  /** Additive: multiplier = 1 + rate * secondsEnraged. */
  ratePerSecond: number;
  cap: number;
}

/** How many of a monster type appear in a given wave. */
export interface WaveEntry {
  monsterId: string;
  count: Unfilled<number>;
}

export interface WaveDef {
  wave: number;
  entries: WaveEntry[];
  /**
   * The gold of army this wave is TUNED to be beaten by, and the number the
   * sandbox (`src/balance/sandbox.ts`) measures against.
   *
   * It is deliberately less than the gold a player could have by then, and the
   * gap is the slack: the room to bank gold, buy economy, or take a risk. A
   * wave a player must spend every coin to survive has taken that room away
   * and is too hard whatever its clear rate says; a wave beaten at half this
   * is not asking anything.
   *
   * Optional, because waves past the authored ladder are generated rather than
   * designed and have nothing to be tuned against.
   */
  armyGold?: number;
}

/**
 * The stalemate brake (§3.3, replaced). Everything that restores or prolongs - healing,
 * health regeneration, a summon's starting HP, a crowd-control duration - is
 * scaled down the longer the Final Showdown runs, so two armies that cannot
 * quite finish each other are eventually decided rather than left standing.
 *
 * Additive, not compounding, and expressed per SECOND: at `perSecond` 0.01 and
 * a 30-second grace, a fight 90 seconds old has lost 60% of its healing, and
 * at 130 seconds it has lost all of it.
 */
export interface DampeningConfig {
  /** Seconds of full strength before any of it is taken away. */
  graceSeconds: number;
  /** Fraction removed per second past the grace period. */
  perSecond: number;
}

/**
 * The Final Showdown (§3.3, replaced).
 *
 * After `afterWave`, the four armies are moved into one cross-shaped arena and
 * fight a free-for-all. The last player with anything standing wins.
 */
export interface ShowdownFile {
  /** The last wave of monsters. The showdown opens when it is cleared. */
  afterWave: number;
  /** How long the "Final Showdown in 3..." card holds the armies still. */
  countdownSeconds: number;
  /** Rows of open ground between a player's build grid and the centre. */
  approachDepth: number;
  /**
   * King of the hill: what holding the centre square is worth.
   *
   * The army with the most living bodies inside the centre holds it, and every
   * body it owns - wherever that body is standing - gets both of these. A tie
   * is held by everyone tied, so contesting is never worse than conceding.
   *
   * Without it the arena rewards exactly one strategy: mass the slowest,
   * longest-ranged units affordable, let the other three fight, walk in and mop
   * up. A reason to stand in the middle is a reason to own a front line.
   *
   * Fractions, in an ability's `modify` convention: 0.5 is +50%, -0.5 is -50%.
   */
  centre: { damageDealt: Unfilled<number>; damageTaken: Unfilled<number> };
  /**
   * Whether the four corners of the arena's bounding square block shots.
   *
   * They are not arena - nothing stands or walks there - and with this on they
   * are not transparent either, so a body at the back of one spoke cannot
   * shoot one at the back of the next across the gap between them.
   *
   * Off, the corners are glass, and reach is worth far more than the price
   * ladder charges for it: a long enough gun covers two spokes from a standing
   * start while nothing can walk to it, which makes the back of your own spoke
   * the safest ground in the game. A switch rather than a constant so the
   * difference can be measured (`npm run showdown`).
   */
  lineOfSight?: Unfilled<boolean>;
  /**
   * How far a unit looks for something to fight in the arena, edge to edge in
   * tiles: `max(minimum, its own range + margin)`. There is no global sight -
   * a unit with nothing inside this walks at the centre of the map instead.
   */
  acquire: { margin: number; minimum: number };
  dampening: DampeningConfig;
}

export interface WavesFile {
  buildPhaseSeconds: number;
  bossEveryNWaves: number;
  showdown: ShowdownFile;
  /** Lane cap; the excess waits in the reserve queue (§8.1). */
  maxConcurrentMonsters: number;
  enrage: EnrageConfig;
  scaling: {
    count: Unfilled<number>;
    hp: Unfilled<number>;
    damage: Unfilled<number>;
    bounty: Unfilled<number>;
  };
  /**
   * §3.4, added: how a BOSS grows from one boss wave to the next.
   *
   * Compounded per boss wave rather than per wave - a boss appears on
   * multiples of `bossEveryNWaves` and nowhere else, so a per-wave factor
   * applied to it is a curve nobody chose. Wave 5's boss is the bank as
   * authored; wave 10's is this once over, and so on.
   *
   * It is also what lets the bank be four bodies of equal power in four
   * armour types. Without it the bank had to carry the difficulty curve in its
   * own HP numbers, which made wave 5 a 1,400 HP fight or a 3,100 HP fight
   * depending on which one the draw picked.
   */
  bossScaling?: {
    hp: Unfilled<number>;
    damage: Unfilled<number>;
  };
  composition: WaveDef[];
  bossBank: string[];
}

// -------------------------------------------------------------- fortress.json

export type AuraType = 'damage' | 'attackSpeed' | 'armour' | 'regeneration';

export interface FortressFile {
  /**
   * The matrix applies in both directions (§6), so monsters besieging the
   * fortress need something to resolve their damage type against. Not stated
   * in DESIGN.md.
   */
  armour: ArmourType;
  hp: UpgradableStat;
  /** HP per second, applied every tick (§5.5, amended). */
  regen: UpgradableStat;
  weapon: {
    damage: Unfilled<number>;
    attackSpeed: Unfilled<number>;
    range: Unfilled<number>;
    upgrades: UpgradeLevel[];
  };
  auras: {
    types: AuraType[];
    strength: UpgradableStat;
    radius: UpgradableStat;
  };
  /**
   * §10.2, amended: the resource building pays out on its own repeating clock
   * rather than once per wave, and both of its ladders are bought with GOLD.
   *
   * A "payout" is what the player calls a gem tick. It is not called a tick
   * here because `tick` already means the simulation's 20Hz step (§15.1), and
   * a word that means two different intervals in one codebase is a bug waiting
   * to be written.
   */
  resourceBuilding: {
    /** Gems handed over per payout, before the `output` ladder. */
    gemsPerPayout: Unfilled<number>;
    /** Seconds between payouts, before the `rate` ladder. */
    payoutSeconds: Unfilled<number>;
    /** `value` is the resolved gems per payout at that level. */
    output: { upgrades: UpgradeLevel[] };
    /**
     * `value` is the payout rate as a multiple of the base. Additive, not
     * compounding: each level adds half the base rate.
     */
    rate: { upgrades: UpgradeLevel[] };
  };
}

// ----------------------------------------------------------------- sends.json

export interface SendDef {
  id: string;
  name: string;
  gemCost: Unfilled<number>;
  /** Monster ids added to the target's next wave. */
  monsters: string[];
  /** Permanent gold per wave granted to the sender (§11.5). */
  incomeGranted: Unfilled<number>;
  grantsVision: boolean;
  visionDurationSeconds: Unfilled<number>;
  /**
   * Abilities granted to every monster this send delivers, on top of whatever
   * that monster has of its own (abilities.json).
   *
   * This is what makes a send a THING rather than a quantity of monsters. The
   * same husk arriving in a wave and arriving in a paid attack should not
   * behave identically - and putting the difference on the send rather than on
   * a duplicate monster definition means one entry to tune and no second
   * husk to keep in step with the first.
   */
  abilities?: AbilityRef[];
}

export interface SendsFile {
  sends: SendDef[];
}

// --------------------------------------------------------------- economy.json

export interface TechTrack {
  id: string;
  name: string;
  /** Offensive tracks buff one damage type; defensive tracks leave this unset. */
  damageType?: DamageType;
  levels: UpgradeLevel[];
}

export interface EconomyFile {
  startingGold: Unfilled<number>;
  startingGems: Unfilled<number>;
  /**
   * §11.1, amended: gold paid to every OTHER living lane when the fortress
   * kills a monster. The lane it died in is paid nothing.
   */
  fortressKillBounty: Unfilled<number>;
  /**
   * §11.1, REPLACED: a wave pays this much gold in total, split evenly between
   * the monsters in it, whatever they are and however many there are.
   *
   * Monster bounties used to be authored per monster, which made a wave's
   * payout a consequence of its composition: wave 24 paid 545 gold and wave 12
   * paid 101, for no reason anybody chose. A fixed pool makes the gold curve a
   * decision rather than an accident, and it takes the snowball out of clearing
   * fast - you cannot farm a wave, only survive it.
   *
   * `monsters.json` still carries a `bounty` per monster. It is now a WEIGHT
   * within the pool rather than an amount: a monster worth twice another takes
   * twice the share. Set every weight equal for a flat split.
   */
  waveBounty: Unfilled<number>;
  /**
   * §3.4, added: gold a BOSS pays on death, on top of its share of the wave
   * pool.
   *
   * A boss wave is several times the work of the wave before it and the pool
   * is fixed, so without a purse it pays exactly the same 200. The purse is
   * what makes surviving one buy the army that survives the next five. Paid on
   * the kill, so a boss that walks past the line pays nothing.
   */
  bossBounty: Unfilled<number>;
  /**
   * §11.5, decided: gold the DEFENDER is paid for killing a sent monster, per
   * ten gems its sender spent, on top of its share of the wave pool.
   *
   * A send buys its sender permanent income and hands its target gold now. That
   * is the trade that makes being ganged up on survivable: three opponents
   * piling on one lane fund that lane's rebuild, so the reward for surviving it
   * is real rather than moral.
   */
  sendBountyPerTenGems: Unfilled<number>;
  supply: {
    capBase: Unfilled<number>;
    capUpgrades: UpgradeLevel[];
  };
  tech: { tracks: TechTrack[] };
  /**
   * §11, decided: what selling a unit returns. A fraction of what was paid,
   * split by when it was paid - full price inside the build phase that bought
   * it, so a misclick is undoable, and a discount afterwards so that churning
   * the board is a real cost.
   */
  sell: {
    /** Refund on gold spent during the build phase now in progress. */
    sameBuildPhase: Unfilled<number>;
    /** Refund on gold spent in any earlier build phase. */
    later: Unfilled<number>;
  };
}

// ---------------------------------------------------------------------- bundle

/** Everything the simulation needs to run. Passed in; never imported by it. */
export interface GameData {
  matrix: MatrixFile;
  lane: LaneFile;
  units: UnitsFile;
  monsters: MonstersFile;
  waves: WavesFile;
  fortress: FortressFile;
  sends: SendsFile;
  economy: EconomyFile;
  abilities: AbilitiesFile;
}

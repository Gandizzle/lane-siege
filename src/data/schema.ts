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
  spawnZoneDepth: number;
  fortressZoneDepth: number;
  /**
   * §4.2, decided: units DO block movement. Monsters steer around occupied
   * tiles and attack whatever is nearest when boxed in.
   */
  unitsBlockMovement: Unfilled<boolean>;
  /**
   * Body radii in tiles. Two entities of the same kind never come closer than
   * the sum of their radii, so nothing overlaps anything it is drawn touching.
   */
  unitRadius: number;
  monsterRadius: number;
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

export interface UnitDef {
  id: string;
  builderId: string;
  name: string;
  /** 1, 2 or 3. Every unit has at least a tier 2 (§7.3). */
  tier: number;
  /** Tier upgrades happen in place: same tile, same identity (§7.3). */
  upgradesTo?: string;
  goldCost: Unfilled<number>;
  supplyCost: Unfilled<number>;
  hp: Unfilled<number>;
  armour: ArmourType;
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
}

export interface WavesFile {
  buildPhaseSeconds: number;
  bossEveryNWaves: number;
  /** Last wave on which defensive units may be built (§3.3). */
  lastBuildWave: number;
  attritionStartWave: number;
  /** Lane cap; the excess waits in the reserve queue (§8.1). */
  maxConcurrentMonsters: number;
  enrage: EnrageConfig;
  scaling: {
    count: Unfilled<number>;
    hp: Unfilled<number>;
    damage: Unfilled<number>;
    bounty: Unfilled<number>;
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
  regenOnLaneClear: UpgradableStat;
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
  resourceBuilding: {
    gemsPerWave: Unfilled<number>;
    upgrades: UpgradeLevel[];
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
  gemProduction: UpgradableStat;
  supply: {
    capBase: Unfilled<number>;
    capUpgrades: UpgradeLevel[];
  };
  tech: { tracks: TechTrack[] };
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
}

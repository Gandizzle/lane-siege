/**
 * Abilities: the vocabulary, and how a definition becomes numbers. DESIGN.md
 * §7 and §18, extended.
 *
 * THE PROBLEM
 *
 * Thirty-seven bodies that differ only in HP, damage, armour type and damage
 * type is a spreadsheet, not a roster. An ability is what makes a unit worth
 * recognising - and because every ability is a balance decision, not one of
 * them may live in code. So this file is the SHAPE of an ability and
 * `data/abilities.json` is the abilities; the same division as every other
 * number in `data/`.
 *
 * FOUR PARTS, ALWAYS THE SAME FOUR
 *
 * Every ability in the game is a trigger, a target, some effects, and a price:
 *
 *     trigger   WHEN it happens      - on a hit, on death, every 3 seconds
 *     target    WHO it happens to    - self, what I just hit, allies nearby
 *     effects   WHAT happens         - damage, a stat change, a stun, a shield
 *     cost      WHAT IT COSTS        - a cooldown, energy, charges, or nothing
 *
 * A "stacking slow on hit" and a "shield for three allies every six seconds"
 * are the same four fields with different values, which is the whole point: a
 * new ability is a JSON entry, and a new KIND of ability is one handler.
 *
 * NUMBERS AND RANKS
 *
 * A unit's tier 2 usually wants the same ability, harder. Duplicating the
 * entry per tier is how the stat blocks work (hammer, hammer_2, hammer_3), and
 * it would triple this catalogue for the sake of one figure - so an ability
 * instead has a small named `numbers` map, refers to it as `"@reduction"`
 * wherever a number goes, and lists `ranks` that override those names:
 *
 *     numbers: { reduction: 0.12, radius: 1.6 }
 *     ranks:   [ {}, { reduction: 0.2 }, { reduction: 0.3, radius: 2.0 } ]
 *
 * Rank 1 is the map as authored, rank 2 is the map with `reduction` at 0.2.
 * A unit asks for `{ id: "shield_wall", rank: 2 }`. One row per tier, one
 * number per row, and `resolveAbility` hands the simulation a struct in which
 * every field is already a number - so a tick never resolves anything.
 *
 * WHAT IS LIVE AND WHAT IS VOCABULARY
 *
 * `IMPLEMENTED_EFFECTS` is the list of effect kinds the simulation actually
 * honours. Everything else in `EFFECT_KINDS` is vocabulary: typed, validated,
 * documented and inert. `validate.ts` refuses data in which a unit, monster or
 * send references an ability using an inert kind, which is the same rule the
 * `traits` lines have - the panel may only describe rules the game has. The
 * inert kinds have a home in `abilities.json`'s `planned` list instead, where
 * they are designs rather than promises.
 */

import type { DamageType, Unfilled } from './schema.ts';

/**
 * A number, or a reference to one in the ability's own `numbers` map.
 *
 * The template literal type is not decoration: it is what makes a plain
 * `"reduction"` - a typo for `"@reduction"` - a compile error in a fixture and
 * a validator error in the JSON, rather than a silent zero.
 */
export type NumberRef = `@${string}`;
export type Tunable = Unfilled<number> | NumberRef;

/**
 * Everything an effect can change about a body, as a multiplier or a flat
 * amount. One list, because a status effect is the same machinery whichever of
 * these it touches, and because the aggregation in `status.ts` is one loop.
 *
 * `damageDealt` and `damageTaken` are the two that carry most of the game:
 * "deals less damage", "takes more damage", "armour shred" and "vulnerable"
 * are all one of those two pointed in a direction.
 */
export const STAT_KEYS = [
  'damageDealt',
  'damageTaken',
  'attackSpeed',
  'moveSpeed',
  'maxHealth',
  /** What one point of incoming healing is worth. 0 is full anti-heal. */
  'healingTaken',
  'critChance',
  /** Multiplier applied to a critical hit's damage. */
  'critDamage',
  'evasion',
  /** Fraction of damage dealt returned to the attacker as HP. */
  'lifesteal',
  /** Fraction of damage taken dealt back to the attacker. */
  'reflect',
  'energyRegen',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/**
 * Which stats are fractions, so a `flat` amount would be meaningless on them.
 *
 * Two things the user's wish-list asks for are NOT in `STAT_KEYS` and are
 * effect kinds in the vocabulary below instead: selling a unit back for more
 * than §11's half price, and making nearby building cheaper. Both are economy,
 * and the economy's numbers are quoted to the player before they are charged -
 * the sell button says what it will pay. A modifier the quote did not know
 * about is a button that lies, so those two wait for the view and the wire to
 * carry the rate rather than being half-honoured here.
 */
export const PERCENT_ONLY_STATS: readonly StatKey[] = [
  'critChance',
  'critDamage',
  'evasion',
  'lifesteal',
  'reflect',
  'healingTaken',
  'damageTaken',
  'attackSpeed',
  'energyRegen',
];

export const TRIGGERS = [
  /** Always on, for as long as the body is alive. */
  'passive',
  /** This body landed a hit. */
  'onAttack',
  /** This body was hit. */
  'onHurt',
  /** This body's hit killed something. */
  'onKill',
  /** This body died. A deathrattle. */
  'onDeath',
  /** This body arrived - built, respawned or spawned into a wave. */
  'onSpawn',
  /** Every `everySeconds`, while alive. */
  'interval',
  /** Its HP crossed below `fraction` of maximum. Fires once per crossing. */
  'healthBelow',
  /** Its HP crossed back above `fraction` of maximum. */
  'healthAbove',
  /** It evaded an attack. */
  'onEvade',
] as const;
export type TriggerWhen = (typeof TRIGGERS)[number];

export interface AbilityTrigger {
  when: TriggerWhen;
  /**
   * Probability in 0..1. Absent means certain.
   *
   * This is where critical strikes and procs come from: "20% of hits deal
   * double damage" is `onAttack` with `chance: 0.2` and a damage effect, and
   * the roll goes through the match's seeded generator so a replay crits in
   * the same places (§15.1).
   */
  chance?: Tunable;
  /** `interval` only: seconds between firings. */
  everySeconds?: Tunable;
  /** `healthBelow` / `healthAbove` only: the fraction of maximum HP. */
  fraction?: Tunable;
}

export const TARGETS = [
  'self',
  /** Whatever this body just hit. */
  'attackTarget',
  /** Whoever just hit this body. */
  'attacker',
  'enemiesInRadius',
  'alliesInRadius',
  /** The `max` nearest allies, wherever they are inside `radius`. */
  'nearestAllies',
  'lowestHealthAlly',
  'randomEnemy',
  /** From the attack target outward: each jump finds the next nearest enemy. */
  'chain',
  /** A rectangle `length` long and `width` across, pointed at the target. */
  'enemiesInLine',
  /** An arc `degrees` wide and `length` deep, pointed at the target. */
  'enemiesInCone',
  /** Vocabulary: for a resurrection, which needs a corpse. */
  'deadAllyNearby',
  /** Vocabulary: the ally this body is bonded to. */
  'bondedAlly',
] as const;
export type TargetWhat = (typeof TARGETS)[number];

export interface AbilityTarget {
  what: TargetWhat;
  radius?: Tunable;
  length?: Tunable;
  width?: Tunable;
  degrees?: Tunable;
  /** How many bodies at most. Absent means every one found. */
  max?: Tunable;
  /** `chain` only: how many times it jumps after the first target. */
  jumps?: Tunable;
  /**
   * Each successive target takes this fraction of what the one before it took.
   * 1 is no falloff. This is what keeps a chain or a cone from being strictly
   * better than a single hit at the same numbers.
   */
  falloff?: Tunable;
  /** `alliesInRadius` / `nearestAllies`: whether the source counts as one. */
  includeSelf?: boolean;
  /** Only bodies carrying this tag - the other half of a synergy. */
  requiresTag?: string;
}

/**
 * Crowd control, which is one effect kind with a named flavour rather than
 * eight kinds, because everything about applying it is identical: a duration,
 * dampening (§3.3 replaced), and the diminishing returns below.
 */
export const CONTROL_KINDS = [
  /** Cannot move, cannot attack. */
  'stun',
  /** Cannot move. */
  'root',
  /** Cannot attack. */
  'disarm',
  /** Cannot fire abilities. */
  'silence',
  /** Must attack the source, and cannot move away from it. */
  'taunt',
  /** Vocabulary: walks the other way. */
  'fear',
  /** Vocabulary: fights its own side. */
  'charm',
  /** Vocabulary: cannot act and cannot be touched. */
  'banish',
] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const EFFECT_KINDS = [
  /** Change a stat, for a duration or for as long as the source lives. */
  'modify',
  /** Deal damage now. */
  'damage',
  /** Deal damage per second for a duration. */
  'damageOverTime',
  /** Restore HP now. */
  'heal',
  /** Restore HP per second for a duration. */
  'regen',
  /** Absorb the next `blocks` incoming attacks outright. */
  'shield',
  'control',
  /** Kill outright below a fraction of maximum HP. */
  'execute',
  /** Ignore control, or ignore abilities altogether. */
  'immunity',
  /** Grant energy, the resource active abilities spend. */
  'energy',
  // ---- vocabulary from here down: typed, validated, and not yet honoured.
  /** Bring a body of your own onto the field for a while. */
  'summon',
  /** Raise a dead ally as a weaker body. */
  'resurrect',
  /** Shove a body away along the lane. */
  'knockback',
  /** Drag a body toward the source. */
  'pull',
  /** Send a body back to where it came from. */
  'teleport',
  /** Become a different definition entirely, permanently. */
  'transform',
  /** Remove a small body from the field outright. */
  'consume',
  /** Share damage between several bodies at once. */
  'spiritLink',
  /** Store damage taken, then release it as a burst. */
  'amplify',
  /** Put something solid in the lane for a while. */
  'pathBlock',
  /** Make nearby building cheaper. */
  'costReduction',
  /** Return more than §11's half price when sold. */
  'sellValue',
  /** Tie this body to an ally, so each carries some of the other. */
  'bond',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * The effect kinds `src/sim` actually honours. See the header: the difference
 * between this list and `EFFECT_KINDS` is the difference between a rule and a
 * design, and `validate.ts` will not let a unit reference the second kind.
 */
export const IMPLEMENTED_EFFECTS: readonly EffectKind[] = [
  'modify',
  'damage',
  'damageOverTime',
  'heal',
  'regen',
  'shield',
  'control',
  'execute',
  'immunity',
  'energy',
];

/**
 * How many copies of one status may sit on one body, and where they may come
 * from. A stack rule is what separates "a slow" from "a slow that four units
 * can grind into a standstill".
 */
export interface StackRule {
  /**
   * Never more than this many at once. 1 is the common case.
   *
   * A `Tunable` rather than a plain number because a tier that raises the cap
   * is a real upgrade - Pyre's Stoke goes from five stacks of heat to six -
   * and `"@max"` with a `ranks` row is how that is said without a second
   * entry in the catalogue.
   */
  max: Tunable;
  /**
   *   `any`              - every application adds a stack.
   *   `perSource`        - one stack per source body; a single unit cannot
   *                        stack its own debuff by attacking faster.
   *   `perSourceType`    - one stack per unit TYPE, so stacking it means
   *                        building different units rather than more of one.
   */
  from: 'any' | 'perSource' | 'perSourceType';
  /** Whether a fresh application resets the clock on the stacks already there. */
  refresh?: boolean;
}

export interface AbilityEffect {
  kind: EffectKind;

  // ---- modify
  stat?: StatKey;
  /** `percent` multiplies (0.2 is +20%); `flat` adds in the stat's own units. */
  mode?: 'percent' | 'flat';
  amount?: Tunable;

  // ---- damage, in any combination: they add up before the matrix.
  /** Flat damage, before the §6 matrix. */
  flat?: Tunable;
  /** A fraction of the target's maximum HP. */
  ofMaxHealth?: Tunable;
  /** A fraction of the target's current HP. */
  ofCurrentHealth?: Tunable;
  /** A fraction of the HP the target has already lost. */
  ofMissingHealth?: Tunable;
  /** A multiple of the source's own attack damage. */
  ofAttack?: Tunable;
  /** Overrides the source's own damage type. */
  damageType?: DamageType;
  /** Skip the §6 matrix and every mitigation: true damage. */
  bypassArmour?: boolean;

  // ---- damageOverTime, regen
  perSecond?: Tunable;

  // ---- anything with a clock
  durationSeconds?: Tunable;
  stacks?: StackRule;

  // ---- shield
  blocks?: Tunable;

  // ---- control
  control?: ControlKind;

  // ---- execute
  belowFraction?: Tunable;

  // ---- immunity
  immuneTo?: 'control' | 'abilities';

  // ---- energy
  /** Energy granted. Negative spends it. */
  energy?: Tunable;

  // ---- tags: the synergy channel (§18, "elemental combos").
  /** A word this effect leaves on its target, e.g. `soaked`, `burning`. */
  appliesTag?: string;
  /** Multiply this effect when the target already carries `tag`. */
  bonusIfTag?: { tag: string; multiplier: Tunable };

  // ---- vocabulary
  /** `summon` / `resurrect` / `transform`: which definition to bring in. */
  defId?: string;
  count?: Tunable;
  /** A ceiling on how many may exist at once. */
  max?: Tunable;
  /** `knockback` / `pull`: tiles. */
  tiles?: Tunable;
  /** A generic fraction, for the kinds that take one. */
  fraction?: Tunable;
}

/** What an ability is FOR, so a roster can be read at a glance. */
export const ABILITY_ROLES = ['offence', 'defence', 'support', 'control', 'economy'] as const;
export type AbilityRole = (typeof ABILITY_ROLES)[number];

export interface AbilityDef {
  id: string;
  /** What it is called. This is the flavour, and it is shown to the player. */
  name: string;
  /**
   * One line describing what it does, for the unit panel.
   *
   * Unlike `traits` this one cannot lie by accident: `validate.ts` checks that
   * every referenced ability is built out of implemented effects, so a line
   * here describes a rule the simulation has.
   */
  text: string;
  role: AbilityRole;
  /** Named numbers, referred to as `"@name"` anywhere a number goes. */
  numbers?: Record<string, Unfilled<number>>;
  /** Per-rank overrides of `numbers`. `ranks[0]` is rank 1. */
  ranks?: Record<string, Unfilled<number>>[];
  trigger: AbilityTrigger;
  target: AbilityTarget;
  effects: AbilityEffect[];
  /** Seconds before it may fire again. An active ability has one of these. */
  cooldownSeconds?: Tunable;
  /** Energy it spends to fire. */
  energyCost?: Tunable;
  /** Fraction of the source's CURRENT HP it spends to fire (§18, health as a resource). */
  healthCost?: Tunable;
}

/**
 * §18's diminishing returns, so a table of stun units cannot hold a wave
 * still forever.
 *
 * `scale` is read by how many times this body has already been controlled
 * inside `windowSeconds`: the first is full length, the second half, and so
 * on, and once the list runs out the body is immune for `immuneSeconds`.
 */
export interface ControlConfig {
  scale: number[];
  windowSeconds: Unfilled<number>;
  immuneSeconds: Unfilled<number>;
}

/** The resource active abilities spend (§18, "resource systems beyond mana"). */
export interface EnergyConfig {
  /** Everything starts with this much and this much is the ceiling. */
  max: Unfilled<number>;
  /** Regenerated per second, passively. */
  regenPerSecond: Unfilled<number>;
  /** Granted for a kill, on top of the passive trickle. */
  perKill: Unfilled<number>;
}

export interface AbilitiesFile {
  control: ControlConfig;
  energy: EnergyConfig;
  abilities: AbilityDef[];
  /**
   * Designs using the vocabulary the simulation does not honour yet.
   *
   * Kept in the same file, and deliberately in a different list: these are the
   * shape of the next batch of mechanics, written down while the thinking is
   * fresh, and nothing may reference them until their effect kinds are live.
   */
  planned: AbilityDef[];
}

/** How a unit, monster or send names an ability: by id, at a rank. */
export type AbilityRef = string | { id: string; rank?: number };

export function refId(ref: AbilityRef): string {
  return typeof ref === 'string' ? ref : ref.id;
}

export function refRank(ref: AbilityRef): number {
  return typeof ref === 'string' ? 1 : (ref.rank ?? 1);
}

// ------------------------------------------------------------------- resolving

/** An ability with every `@name` and every null turned into a number. */
export interface ResolvedAbility {
  id: string;
  name: string;
  text: string;
  role: AbilityRole;
  rank: number;
  trigger: { when: TriggerWhen; chance: number; everySeconds: number; fraction: number };
  target: ResolvedTarget;
  effects: ResolvedEffect[];
  cooldownSeconds: number;
  energyCost: number;
  healthCost: number;
}

export interface ResolvedTarget {
  what: TargetWhat;
  radius: number;
  length: number;
  width: number;
  degrees: number;
  max: number;
  jumps: number;
  falloff: number;
  includeSelf: boolean;
  requiresTag: string | null;
}

export interface ResolvedEffect {
  kind: EffectKind;
  stat: StatKey | null;
  mode: 'percent' | 'flat';
  amount: number;
  flat: number;
  ofMaxHealth: number;
  ofCurrentHealth: number;
  ofMissingHealth: number;
  ofAttack: number;
  damageType: DamageType | null;
  bypassArmour: boolean;
  perSecond: number;
  durationSeconds: number;
  stacks: { max: number; from: StackRule['from']; refresh: boolean };
  blocks: number;
  control: ControlKind | null;
  belowFraction: number;
  immuneTo: 'control' | 'abilities' | null;
  energy: number;
  appliesTag: string | null;
  bonusIfTag: { tag: string; multiplier: number } | null;
  defId: string | null;
  count: number;
  max: number;
  tiles: number;
  fraction: number;
}

/** A missing number is zero once resolved; `validate.ts` is what complains. */
function num(value: Tunable | undefined, numbers: Record<string, number>): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  return numbers[value.slice(1)] ?? 0;
}

/** The `numbers` map at a rank: the base overlaid with that rank's overrides. */
export function rankNumbers(def: AbilityDef, rank: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(def.numbers ?? {})) {
    if (value !== null) out[key] = value;
  }
  const overrides = def.ranks?.[Math.max(0, rank - 1)];
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== null) out[key] = value;
  }
  return out;
}

const NO_STACK: StackRule = { max: 1, from: 'any', refresh: true };

/**
 * Turn a definition into numbers, once.
 *
 * Called when the definition index is built, never inside a tick: §15.3's rule
 * is that resolved values are cached and recomputed on events, and an ability
 * definition cannot change during a match at all.
 */
export function resolveAbility(def: AbilityDef, rank = 1): ResolvedAbility {
  const n = rankNumbers(def, rank);
  const t = def.target;

  return {
    id: def.id,
    name: def.name,
    text: def.text,
    role: def.role,
    rank,
    trigger: {
      when: def.trigger.when,
      chance: def.trigger.chance === undefined ? 1 : num(def.trigger.chance, n),
      everySeconds: num(def.trigger.everySeconds, n),
      fraction: num(def.trigger.fraction, n),
    },
    target: {
      what: t.what,
      radius: num(t.radius, n),
      length: num(t.length, n),
      width: num(t.width, n),
      degrees: num(t.degrees, n),
      max: t.max === undefined ? Infinity : num(t.max, n),
      jumps: num(t.jumps, n),
      falloff: t.falloff === undefined ? 1 : num(t.falloff, n),
      includeSelf: t.includeSelf === true,
      requiresTag: t.requiresTag ?? null,
    },
    effects: def.effects.map((e) => resolveEffect(e, n)),
    cooldownSeconds: num(def.cooldownSeconds, n),
    energyCost: num(def.energyCost, n),
    healthCost: num(def.healthCost, n),
  };
}

function resolveEffect(e: AbilityEffect, n: Record<string, number>): ResolvedEffect {
  const stacks = e.stacks ?? NO_STACK;
  return {
    kind: e.kind,
    stat: e.stat ?? null,
    mode: e.mode ?? 'percent',
    amount: num(e.amount, n),
    flat: num(e.flat, n),
    ofMaxHealth: num(e.ofMaxHealth, n),
    ofCurrentHealth: num(e.ofCurrentHealth, n),
    ofMissingHealth: num(e.ofMissingHealth, n),
    ofAttack: num(e.ofAttack, n),
    damageType: e.damageType ?? null,
    bypassArmour: e.bypassArmour === true,
    perSecond: num(e.perSecond, n),
    durationSeconds: num(e.durationSeconds, n),
    stacks: {
      max: Math.max(1, num(stacks.max, n)),
      from: stacks.from,
      refresh: stacks.refresh !== false,
    },
    blocks: num(e.blocks, n),
    control: e.control ?? null,
    belowFraction: num(e.belowFraction, n),
    immuneTo: e.immuneTo ?? null,
    energy: num(e.energy, n),
    appliesTag: e.appliesTag ?? null,
    bonusIfTag: e.bonusIfTag
      ? { tag: e.bonusIfTag.tag, multiplier: num(e.bonusIfTag.multiplier, n) }
      : null,
    defId: e.defId ?? null,
    count: num(e.count, n),
    max: e.max === undefined ? Infinity : num(e.max, n),
    tiles: num(e.tiles, n),
    fraction: num(e.fraction, n),
  };
}

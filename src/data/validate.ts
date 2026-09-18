/**
 * Turns raw JSON into a `GameData` bundle and reports what is still unfilled.
 *
 * This is deliberately not a schema validator library. The point is a readable
 * list of "which numbers does DESIGN.md still owe us", so a half-filled data
 * set fails with a to-do list instead of a stack trace ten frames into a tick.
 */

import type {
  AbilityDef,
  AbilityEffect,
  AbilityRef,
  ArmourType,
  GameData,
  Tunable,
} from './schema.ts';
import {
  CONTROL_KINDS,
  EFFECT_KINDS,
  IMPLEMENTED_EFFECTS,
  PERCENT_ONLY_STATS,
  SHAPE_FAMILY,
  STAT_KEYS,
  TARGETS,
  TRIGGERS,
  rankNumbers,
  refId,
  refRank,
} from './schema.ts';

export interface DataReport {
  /** Dotted paths whose value is still `null`, e.g. `economy.startingGold`. */
  missing: string[];
  /** Things that are wrong rather than merely absent. */
  errors: string[];
  /** Expected-for-now gaps worth seeing but not worth failing on. */
  notes: string[];
}

// Keys that carry prose for whoever edits the JSON, not data for the sim.
const IGNORED_KEYS = new Set([
  '_comment',
  '_tags',
  '_planned',
  '_abilities',
  '_tuning',
  '_vision',
  '_open',
  '_clockNote',
  '_decided',
  '_armourNote',
  '_roster',
  '_todo',
  '_note',
]);

/** Every dotted path under `value` whose leaf is `null`. */
function collectNulls(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectNulls(item, `${path}[${i}]`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (IGNORED_KEYS.has(key)) continue;
      collectNulls(child, path ? `${path}.${key}` : key, out);
    }
  }
}

/**
 * DESIGN.md §6: every row and every column of the matrix sums to 4.1, so no
 * damage type is globally stronger. Worth checking on load - it is the one
 * balance invariant the design states outright, and it is easy to break while
 * hand-editing JSON on a phone.
 */
function checkMatrix(data: GameData, errors: string[]): void {
  const { damageTypes, armourTypes, multipliers } = data.matrix;
  const EXPECTED = 4.1;
  const EPSILON = 1e-9;

  for (const dmg of damageTypes) {
    const row = multipliers[dmg];
    if (!row) {
      errors.push(`matrix.multipliers.${dmg} is missing`);
      continue;
    }
    const sum = armourTypes.reduce((acc, arm) => acc + (row[arm] ?? 0), 0);
    if (Math.abs(sum - EXPECTED) > EPSILON) {
      errors.push(`matrix row '${dmg}' sums to ${sum}, expected ${EXPECTED} (§6)`);
    }
  }

  for (const arm of armourTypes) {
    const sum = damageTypes.reduce((acc, dmg) => acc + (multipliers[dmg]?.[arm] ?? 0), 0);
    if (Math.abs(sum - EXPECTED) > EPSILON) {
      errors.push(`matrix column '${arm}' sums to ${sum}, expected ${EXPECTED} (§6)`);
    }
  }
}

/**
 * DESIGN.md §6.1: every builder must cover all four damage types across its six
 * units, or it simply loses the wave that counters it.
 *
 * A half-built roster failing this is expected, not broken - builder A is three
 * units in at M1 - so the rule is an ERROR only for builders marked complete,
 * and a NOTE for the rest. Flipping `complete` to true is what arms it.
 */
function checkBuilderCoverage(data: GameData, errors: string[], notes: string[]): void {
  for (const builder of data.units.builders) {
    const owned = data.units.units.filter((u) => u.builderId === builder.id);
    if (owned.length === 0) continue;

    const covered = new Set(owned.map((u) => u.damageType));
    const gaps = data.matrix.damageTypes.filter((t) => !covered.has(t));
    if (gaps.length === 0) continue;

    const message = `builder '${builder.id}' has no ${gaps.join('/')} unit (§6.1 coverage rule)`;
    if (builder.complete) {
      errors.push(message);
    } else {
      notes.push(`${message} - roster incomplete, so not yet enforced`);
    }
  }
}

/** Every monster named in a wave must actually exist (§9.2). */
function checkWaveReferences(data: GameData, errors: string[]): void {
  const known = new Set([
    ...data.monsters.monsters.map((m) => m.id),
    ...data.monsters.bosses.map((m) => m.id),
  ]);
  for (const wave of data.waves.composition) {
    for (const entry of wave.entries) {
      if (!known.has(entry.monsterId)) {
        errors.push(`wave ${wave.wave} references unknown monster '${entry.monsterId}'`);
      }
    }
  }
  for (const id of data.waves.bossBank) {
    if (!known.has(id)) errors.push(`bossBank references unknown monster '${id}'`);
  }
}

/** A tier upgrade must point at a unit that exists (§7.3). */
function checkUpgradeChain(data: GameData, errors: string[]): void {
  const known = new Set(data.units.units.map((u) => u.id));
  for (const unit of data.units.units) {
    if (unit.upgradesTo && !known.has(unit.upgradesTo)) {
      errors.push(`unit '${unit.id}' upgrades to unknown unit '${unit.upgradesTo}'`);
    }
  }
}

/**
 * Every body on the field has its own silhouette, and it is in its armour's
 * family. §14.2, amended - see `ShapeId` in schema.ts.
 *
 * Checked on load for the same reason the matrix is: it is an invariant that
 * is trivial to break while hand-editing JSON - copy a unit, forget to change
 * its shape - and the failure is silent on screen. Two hexagons do not look
 * wrong; they just stop telling you which is which.
 */
function checkShapes(data: GameData, errors: string[]): void {
  const families = SHAPE_FAMILY as Record<string, ArmourType | undefined>;
  const monsters = [...data.monsters.monsters, ...data.monsters.bosses];
  const byId = new Map(data.units.units.map((u) => [u.id, u]));

  // The right family, and a shape that exists at all - JSON cannot spell-check.
  for (const body of [...data.units.units, ...monsters]) {
    const family = families[body.shape];
    if (family === undefined) {
      errors.push(`'${body.id}' has unknown shape '${body.shape}'`);
    } else if (family !== body.armour) {
      errors.push(
        `'${body.id}' is ${body.armour} but its shape '${body.shape}' is a ${family} silhouette (§14.2)`,
      );
    }
  }

  // An upgrade is the same unit (§7.3), so it keeps the same silhouette.
  for (const unit of data.units.units) {
    const next = unit.upgradesTo ? byId.get(unit.upgradesTo) : undefined;
    if (next && next.shape !== unit.shape) {
      errors.push(
        `'${unit.id}' is '${unit.shape}' but upgrades to '${next.id}' which is '${next.shape}' - a tier keeps its shape (§7.3)`,
      );
    }
  }

  // One silhouette per body. Tiers of one unit share theirs on purpose, so only
  // the base of each chain counts; monsters and units share a field, so they
  // are checked against each other as well.
  const owners = new Map<string, string>();
  const claim = (shape: string, owner: string): void => {
    const other = owners.get(shape);
    if (other) {
      errors.push(
        `shape '${shape}' is used by both '${other}' and '${owner}' - every body on the field has its own silhouette (§14.2)`,
      );
    } else {
      owners.set(shape, owner);
    }
  };
  for (const unit of data.units.units) if (unit.tier === 1) claim(unit.shape, unit.id);
  for (const monster of monsters) claim(monster.shape, monster.id);
}

/**
 * Which fields each effect kind actually reads, so an entry with a number in
 * the wrong field fails loudly instead of quietly doing nothing.
 *
 * This table is also the documentation: `modify` needs a stat, `control` needs
 * a flavour, a `damage` effect needs at least one of the five ways of saying
 * how much. A kind with an empty list needs nothing beyond being named.
 */
const REQUIRED_FIELDS: Partial<Record<(typeof EFFECT_KINDS)[number], (keyof AbilityEffect)[]>> = {
  modify: ['stat'],
  control: ['control'],
  shield: ['blocks'],
  execute: ['belowFraction'],
  immunity: ['immuneTo'],
  energy: ['energy'],
};

/** The five ways a `damage` effect can say how much, any one of which will do. */
const DAMAGE_FIELDS: (keyof AbilityEffect)[] = [
  'flat',
  'ofMaxHealth',
  'ofCurrentHealth',
  'ofMissingHealth',
  'ofAttack',
];

/** Targets that are meaningless without a distance. */
const NEEDS_RADIUS = new Set([
  'enemiesInRadius',
  'alliesInRadius',
  'nearestAllies',
  'lowestHealthAlly',
  'randomEnemy',
  'chain',
  'deadAllyNearby',
  'bondedAlly',
]);

/** Every `"@name"` in this value, or nothing if it is a plain number. */
function refsIn(value: unknown): string[] {
  if (typeof value === 'string' && value.startsWith('@')) return [value.slice(1)];
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(refsIn);
  }
  return [];
}

/**
 * DESIGN.md §7 and §18, extended: the ability catalogue.
 *
 * The rule worth having a validator for at all is the last one. `traits` are
 * prose and can describe a rule the game does not have; an ability's `text` is
 * shown to the player in the same panel and must NOT be able to, so an ability
 * that a unit, monster or send references may only be built out of effect kinds
 * the simulation honours (`IMPLEMENTED_EFFECTS`). The rest of the vocabulary
 * lives in `planned`, where it is a design rather than a promise, and referring
 * to one of those is an error.
 */
function checkAbilities(data: GameData, errors: string[], notes: string[]): void {
  const file = data.abilities;
  if (!file || !Array.isArray(file.abilities)) {
    errors.push('abilities.json has no `abilities` list');
    return;
  }

  const live = new Map<string, AbilityDef>();
  const planned = new Map<string, AbilityDef>();
  const implemented = new Set<string>(IMPLEMENTED_EFFECTS);

  for (const [name, list] of [
    ['abilities', file.abilities],
    ['planned', file.planned ?? []],
  ] as const) {
    const into = name === 'abilities' ? live : planned;
    for (const ability of list) {
      if (live.has(ability.id) || planned.has(ability.id)) {
        errors.push(`two abilities share the id ${ability.id}`);
        continue;
      }
      into.set(ability.id, ability);
      checkOneAbility(ability, `abilities.${name}`, errors);
    }
  }

  // Which words anything actually applies, so a synergy that can never fire is
  // reported rather than silently never firing.
  const applied = new Set<string>();
  for (const ability of [...live.values(), ...planned.values()]) {
    for (const effect of ability.effects) if (effect.appliesTag) applied.add(effect.appliesTag);
  }
  for (const ability of live.values()) {
    const wanted = [
      ability.target.requiresTag,
      ...ability.effects.map((e) => e.bonusIfTag?.tag),
    ].filter((tag): tag is string => typeof tag === 'string');
    for (const tag of wanted) {
      if (!applied.has(tag)) {
        notes.push(`${ability.id} pays off the tag "${tag}", which nothing applies`);
      }
    }
  }

  const referenced = new Set<string>();
  const check = (refs: AbilityRef[] | undefined, owner: string): void => {
    for (const ref of refs ?? []) {
      const id = refId(ref);
      const rank = refRank(ref);
      referenced.add(id);

      if (planned.has(id)) {
        errors.push(
          `${owner} references ${id}, which is in \`planned\` - it uses effect kinds the ` +
            `simulation does not honour yet, so the panel would describe a rule the game has not got`,
        );
        continue;
      }
      const ability = live.get(id);
      if (!ability) {
        errors.push(`${owner} references ability ${id}, which does not exist`);
        continue;
      }
      if (rank < 1) errors.push(`${owner} asks for rank ${rank} of ${id}`);
      if (ability.ranks && rank > ability.ranks.length) {
        errors.push(`${owner} asks for rank ${rank} of ${id}, which has ${ability.ranks.length}`);
      }
      for (const effect of ability.effects) {
        if (!implemented.has(effect.kind)) {
          errors.push(
            `${owner} references ${id}, whose \`${effect.kind}\` effect is vocabulary rather ` +
              `than a rule (IMPLEMENTED_EFFECTS in abilities.ts)`,
          );
        }
      }
    }
  };

  for (const unit of data.units.units) {
    check(unit.abilities, `unit ${unit.id}`);
    // The roster's whole premise (units.json): a unit that differs from the
    // next one only in armour type and damage type is not a unit anybody
    // remembers. Enforced rather than intended.
    if (!unit.abilities || unit.abilities.length === 0) {
      errors.push(`unit ${unit.id} has no ability`);
    }
  }
  for (const monster of [...data.monsters.monsters, ...data.monsters.bosses]) {
    check(monster.abilities, `monster ${monster.id}`);
  }
  for (const send of data.sends.sends) {
    check(send.abilities, `send ${send.id}`);
  }

  for (const id of live.keys()) {
    if (!referenced.has(id)) notes.push(`ability ${id} is in the catalogue but nothing has it`);
  }
}

/** One entry's own shape: its numbers resolve, and each effect has its fields. */
function checkOneAbility(ability: AbilityDef, where: string, errors: string[]): void {
  const at = `${where} ${ability.id}`;
  if (!TRIGGERS.includes(ability.trigger.when)) {
    errors.push(`${at} has trigger "${ability.trigger.when}", which is not a trigger`);
  }
  if (!TARGETS.includes(ability.target.what)) {
    errors.push(`${at} targets "${ability.target.what}", which is not a target`);
  }
  if (ability.trigger.when === 'interval' && !ability.trigger.everySeconds) {
    errors.push(`${at} fires on an interval but does not say how often`);
  }
  if (NEEDS_RADIUS.has(ability.target.what) && ability.target.radius === undefined) {
    errors.push(`${at} targets "${ability.target.what}" without a radius`);
  }

  // Every `"@name"` has to exist in `numbers` AT EVERY RANK, which is the whole
  // safety of the rank mechanism: a rank row that renames a key silently
  // zeroes the effect that referred to the old one.
  const ranks = ability.ranks?.length ?? 1;
  for (let rank = 1; rank <= ranks; rank++) {
    const numbers = rankNumbers(ability, rank);
    for (const name of refsIn([
      ability.trigger,
      ability.target,
      ability.effects,
      ability.cooldownSeconds,
      ability.energyCost,
      ability.healthCost,
    ] as Tunable[])) {
      if (!(name in numbers)) {
        errors.push(`${at} refers to "@${name}" at rank ${rank}, which its numbers do not define`);
      }
    }
  }
  for (const [key, value] of Object.entries(ability.numbers ?? {})) {
    if (value === null) errors.push(`${at} leaves the number "${key}" unfilled`);
  }

  if (ability.effects.length === 0) errors.push(`${at} has no effects`);
  for (const effect of ability.effects) {
    if (!EFFECT_KINDS.includes(effect.kind)) {
      errors.push(`${at} has an effect of kind "${effect.kind}", which is not a kind`);
      continue;
    }
    for (const field of REQUIRED_FIELDS[effect.kind] ?? []) {
      if (effect[field] === undefined) {
        errors.push(`${at}'s ${effect.kind} effect needs a ${String(field)}`);
      }
    }
    if (effect.kind === 'damage' && !DAMAGE_FIELDS.some((f) => effect[f] !== undefined)) {
      errors.push(`${at}'s damage effect never says how much`);
    }
    if (
      (effect.kind === 'damageOverTime' || effect.kind === 'regen') &&
      effect.perSecond === undefined &&
      effect.ofMaxHealth === undefined
    ) {
      errors.push(`${at}'s ${effect.kind} effect has no rate`);
    }
    if (effect.kind === 'modify') {
      if (effect.stat !== undefined && !STAT_KEYS.includes(effect.stat)) {
        errors.push(`${at} modifies "${effect.stat}", which is not a stat`);
      }
      if (effect.mode === 'flat' && effect.stat && PERCENT_ONLY_STATS.includes(effect.stat)) {
        errors.push(`${at} gives ${effect.stat} a flat amount; it is a fraction`);
      }
    }
    if (effect.kind === 'control' && effect.control && !CONTROL_KINDS.includes(effect.control)) {
      errors.push(`${at} applies "${effect.control}", which is not a control effect`);
    }
    if (effect.kind === 'control' && !effect.durationSeconds) {
      errors.push(`${at} applies control with no duration`);
    }
    if (effect.stacks !== undefined) {
      const max = effect.stacks.max;
      if (max === null || (typeof max === 'number' && max < 1)) {
        errors.push(`${at} has a stack rule with a maximum below one`);
      }
    }
  }
}

/** Assembles the bundle and reports its gaps. Never throws. */
export function validateData(raw: Record<string, unknown>): {
  data: GameData;
  report: DataReport;
} {
  const data = raw as unknown as GameData;
  const missing: string[] = [];
  const errors: string[] = [];
  const notes: string[] = [];

  collectNulls(raw, '', missing);
  checkMatrix(data, errors);
  checkBuilderCoverage(data, errors, notes);
  checkWaveReferences(data, errors);
  checkUpgradeChain(data, errors);
  checkShapes(data, errors);
  checkAbilities(data, errors, notes);

  return { data, report: { missing, errors, notes } };
}

/** Human-readable summary for the headless runner and the dev console. */
export function formatReport(report: DataReport): string {
  const lines: string[] = [];
  if (report.errors.length > 0) {
    lines.push(`${report.errors.length} data error(s):`);
    for (const e of report.errors) lines.push(`  ✗ ${e}`);
  }
  if (report.missing.length > 0) {
    lines.push(`${report.missing.length} value(s) still unfilled:`);
    for (const m of report.missing) lines.push(`  · ${m}`);
  }
  if (report.notes.length > 0) {
    lines.push(`${report.notes.length} note(s):`);
    for (const n of report.notes) lines.push(`  ~ ${n}`);
  }
  if (lines.length === 0) lines.push('Data complete.');
  return lines.join('\n');
}

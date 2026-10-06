/**
 * Abilities, in words a player can act on. DESIGN.md §7, §18, §14.1.
 *
 * WHAT THE CARD SAYS
 *
 * Three things, in order: the authored one-liner (`text`, what the ability is
 * FOR), the authored paragraph (`description`, exactly what it does, in whole
 * sentences), and the notes - the rules every ability of a kind shares, like
 * how energy refills or how stuns wear thin with repetition, said once here
 * rather than in every paragraph.
 *
 * WHY THE PARAGRAPH IS WRITTEN AND ITS NUMBERS ARE NOT
 *
 * A generated description is always true and reads like a form: "+8% damage
 * · up to 3 stacks, one per unit". A written one reads like a person and
 * stops being true the first time somebody tunes the ability. So the words
 * are written and the numbers are placeholders (`fillDescription` in
 * abilities.ts), filled from the RESOLVED ability at the unit's own rank: the
 * card and the data cannot disagree, and a balance pass never leaves a lie
 * behind it. The notes are built from the same data files the simulation
 * reads.
 *
 * The generated lines below (`triggerLine`, `targetLine`, `effectLine`) are
 * what an ability without a paragraph falls back to - in practice the
 * `planned` designs, which nothing on the field may carry.
 */

import type {
  ControlConfig,
  DampeningConfig,
  EnergyConfig,
  ResolvedAbility,
  ResolvedEffect,
  ResolvedTarget,
  StatKey,
} from '../../data/schema.ts';
import { fillDescription } from '../../data/schema.ts';

/** A number with at most one decimal, and no trailing `.0`. */
function n(value: number, decimals = 1): string {
  const rounded = Number(value.toFixed(decimals));
  return String(rounded);
}

/** A multiplier as a signed percentage: 0.08 reads `+8%`, -0.2 reads `-20%`. */
function percent(value: number): string {
  const rounded = Math.round(value * 1000) / 10;
  return `${rounded >= 0 ? '+' : ''}${n(rounded)}%`;
}

function seconds(value: number): string {
  return `${n(value)}s`;
}

const STAT_WORDS: Record<StatKey, string> = {
  damageDealt: 'damage',
  damageTaken: 'damage taken',
  attackSpeed: 'attack speed',
  moveSpeed: 'move speed',
  maxHealth: 'max health',
  healingTaken: 'healing received',
  critChance: 'critical chance',
  critDamage: 'critical damage',
  evasion: 'evasion',
  lifesteal: 'lifesteal',
  reflect: 'damage reflected',
  energyRegen: 'energy regeneration',
};

/** When it happens, and what it costs to make it happen. */
export function triggerLine(ability: ResolvedAbility): string {
  const t = ability.trigger;
  const chance = t.chance < 1 ? `${Math.round(t.chance * 100)}% of ` : '';

  let when: string;
  switch (t.when) {
    case 'passive':
      // The question the flavour line kept raising: does it stop when they
      // move apart? Yes - a passive is re-checked every tick, and saying
      // "while they are in range" is the whole answer. A passive on ITSELF
      // has no range to be in, so it just says always.
      when = ability.target.what === 'self' ? 'Always on' : 'Always on, while they are in range';
      break;
    case 'onAttack':
      when = `On ${chance}its hits`;
      break;
    case 'onHurt':
      when = `When ${chance}something hits it`;
      break;
    case 'onKill':
      when = 'When it kills something';
      break;
    case 'onDeath':
      when = 'When it dies';
      break;
    case 'onSpawn':
      when = 'When it arrives';
      break;
    case 'onEvade':
      when = 'When it turns a blow aside';
      break;
    case 'interval':
      when = `Every ${seconds(t.everySeconds)}`;
      break;
    case 'healthBelow':
      when = `Below ${Math.round(t.fraction * 100)}% health`;
      break;
    case 'healthAbove':
      when = `Above ${Math.round(t.fraction * 100)}% health`;
      break;
  }

  const costs: string[] = [];
  if (ability.energyCost > 0) costs.push(`${Math.round(ability.energyCost)} energy`);
  if (ability.healthCost > 0) costs.push(`${Math.round(ability.healthCost * 100)}% of its health`);
  if (ability.cooldownSeconds > 0 && t.when !== 'interval') {
    costs.push(`${seconds(ability.cooldownSeconds)} cooldown`);
  }
  return costs.length > 0 ? `${when} · costs ${costs.join(' and ')}` : when;
}

/** Who it lands on, how many of them, and how far it reaches. */
export function targetLine(target: ResolvedTarget): string {
  const many = (word: string, radius: number): string => {
    const cap = Number.isFinite(target.max) ? `Up to ${Math.round(target.max)} ` : 'Every ';
    const reach = radius > 0 ? ` within ${n(radius)} tiles` : '';
    return `${cap}${word}${reach}`;
  };
  const tagged = target.requiresTag !== null ? ` already ${target.requiresTag}` : '';

  switch (target.what) {
    case 'self':
      return 'Itself';
    case 'attackTarget':
      return `What it just hit${tagged}`;
    case 'attacker':
      return 'Whatever hit it';
    case 'enemiesInRadius':
      return `${many('enemies', target.radius)}${tagged}`;
    case 'alliesInRadius':
      return many(target.includeSelf ? 'allies, itself included' : 'allies', target.radius);
    case 'nearestAllies':
      return many('of the nearest allies', target.radius);
    case 'frontAllies':
      return many('allies, furthest forward first,', target.radius);
    case 'lowestHealthAlly':
      return `The most wounded ally within ${n(target.radius)} tiles`;
    case 'randomEnemy':
      return `One enemy at random within ${n(target.radius)} tiles`;
    case 'chain':
      return (
        `Jumping to ${Math.round(target.jumps)} more enemies${tagged}, ` +
        `each within ${n(target.radius)} tiles of the last`
      );
    case 'enemiesInLine':
      return many(`enemies in a line ${n(target.length)} tiles long`, 0);
    case 'enemiesInCone':
      return many(
        `enemies in a ${Math.round(target.degrees)}° arc ${n(target.length)} tiles deep`,
        0,
      );
    default:
      return 'Nobody yet';
  }
}

/** How the stacks are counted, or nothing when it does not stack. */
function stackNote(effect: ResolvedEffect): string {
  const { max, from } = effect.stacks;
  if (max <= 1) return '';
  const source =
    from === 'perSource'
      ? ', one per unit'
      : from === 'perSourceType'
        ? ', one per KIND of unit'
        : '';
  return ` · up to ${Math.round(max)} stacks${source}`;
}

function forSeconds(effect: ResolvedEffect): string {
  return effect.durationSeconds > 0 ? ` for ${seconds(effect.durationSeconds)}` : '';
}

/** What a `damage` effect is worth, as the sum of the ways it can be counted. */
function damageAmount(effect: ResolvedEffect): string {
  const parts: string[] = [];
  if (effect.flat > 0) parts.push(`${Math.round(effect.flat)}`);
  if (effect.ofAttack > 0) parts.push(`${Math.round(effect.ofAttack * 100)}% of its own hit`);
  if (effect.ofMaxHealth > 0) {
    parts.push(`${n(effect.ofMaxHealth * 100)}% of the target's max health`);
  }
  if (effect.ofCurrentHealth > 0) {
    parts.push(`${n(effect.ofCurrentHealth * 100)}% of the target's current health`);
  }
  if (effect.ofMissingHealth > 0) {
    parts.push(`${n(effect.ofMissingHealth * 100)}% of the health it has lost`);
  }
  return parts.length > 0 ? parts.join(' + ') : 'nothing';
}

/** One line per effect: what it does, for how long, and how it stacks. */
export function effectLine(effect: ResolvedEffect): string {
  const tag = effect.appliesTag ? ` · marks it ${effect.appliesTag}` : '';
  const bonus = effect.bonusIfTag
    ? ` · ×${n(effect.bonusIfTag.multiplier)} against anything ${effect.bonusIfTag.tag}`
    : '';

  switch (effect.kind) {
    case 'modify': {
      const word = effect.stat ? STAT_WORDS[effect.stat] : 'something';
      const amount =
        effect.mode === 'flat'
          ? `${effect.amount >= 0 ? '+' : ''}${n(effect.amount)}`
          : percent(effect.amount);
      return `${amount} ${word}${forSeconds(effect)}${stackNote(effect)}${tag}`;
    }
    case 'damage': {
      const armor = effect.bypassArmor ? ', ignoring armor' : '';
      return `${damageAmount(effect)} damage${armor}${bonus}${tag}`;
    }
    case 'damageOverTime': {
      const rate = effect.perSecond + effect.ofMaxHealth;
      const per = effect.ofMaxHealth > 0 ? `${n(effect.ofMaxHealth * 100)}% max health` : n(rate);
      return `${per} damage per second${forSeconds(effect)}${stackNote(effect)}${tag}`;
    }
    case 'heal': {
      const flat = effect.flat > 0 ? `${Math.round(effect.flat)} health` : '';
      const share =
        effect.ofMaxHealth > 0 ? `${Math.round(effect.ofMaxHealth * 100)}% of max health` : '';
      return `Heals ${[flat, share].filter(Boolean).join(' + ')}`;
    }
    case 'regen': {
      const share =
        effect.ofMaxHealth > 0
          ? `${n(effect.ofMaxHealth * 100)}% of max health`
          : n(effect.perSecond);
      return `Restores ${share} per second${forSeconds(effect)}`;
    }
    case 'shield':
      return `Blocks the next ${Math.round(effect.blocks)} attack${effect.blocks === 1 ? '' : 's'} outright${forSeconds(effect)}`;
    case 'control': {
      const words: Record<string, string> = {
        stun: 'Stuns',
        root: 'Roots',
        disarm: 'Disarms',
        silence: 'Silences',
        taunt: 'Forces it to attack the caster',
        fear: 'Sends it running',
        charm: 'Turns it on its own side',
        banish: 'Banishes',
      };
      const verb = effect.control ? (words[effect.control] ?? 'Holds') : 'Holds';
      return `${verb}${forSeconds(effect)}`;
    }
    case 'execute':
      return `Kills outright below ${Math.round(effect.belowFraction * 100)}% health`;
    case 'immunity':
      return effect.immuneTo === 'abilities'
        ? `Abilities cannot touch it${forSeconds(effect)}`
        : `Cannot be stunned, rooted or held${forSeconds(effect)}`;
    case 'energy':
      return `Grants ${Math.round(effect.energy)} energy`;
    default:
      return effect.kind;
  }
}

/** The rules every ability of a kind shares, from the data files. */
export interface AbilityRules {
  energy: EnergyConfig;
  control: ControlConfig;
  dampening: DampeningConfig;
}

/** The whole card: what it is for, then exactly what it does, then the shared rules. */
export interface AbilityCard {
  name: string;
  /** The authored line: what it is for. */
  text: string;
  /** The authored paragraph, its numbers filled in at this rank. */
  description: string;
  /** Generated lines, for an ability with no paragraph (see the header). */
  mechanics: string[];
  /** The shared rules this ability is subject to, one sentence or two each. */
  notes: string[];
}

/** "half", "a quarter", or a plain percentage, for a fraction of a duration. */
function asLong(fraction: number): string {
  if (fraction === 0.5) return 'half as long';
  if (fraction === 0.25) return 'a quarter as long';
  return `${n(fraction * 100)}% as long`;
}

/** The notes a card carries: only the ones whose rules this ability touches. */
export function abilityNotes(ability: ResolvedAbility, rules: AbilityRules): string[] {
  const notes: string[] = [];
  const kinds = new Set(ability.effects.map((e) => e.kind));
  const damages = kinds.has('damage') || kinds.has('damageOverTime');
  const ofAttack = ability.effects.some((e) => e.ofAttack > 0);
  const heals =
    kinds.has('heal') ||
    kinds.has('regen') ||
    ability.effects.some((e) => e.kind === 'modify' && e.stat === 'lifesteal');
  const controls = kinds.has('control');

  if (damages) {
    notes.push(
      "Ability damage can't miss, be blocked by a ward or land a critical hit, and it " +
        "never triggers lifesteal or reflection. The user's own damage buffs raise it, " +
        "and unless it ignores armor it goes through the damage chart and the target's " +
        'damage-taken changes like any other hit.' +
        (ofAttack
          ? " Attack damage here is the body's damage per hit before tech: a unit's " +
            "listed damage, or a monster's damage at the current wave."
          : ''),
    );
  }
  if (ability.trigger.when === 'interval') {
    notes.push(
      'A timed ability goes off as soon as it has something to affect and then waits out ' +
        "its timer. With nothing in reach it doesn't go off, and its timer doesn't start" +
        (ability.energyCost > 0
          ? "; if it's short of energy when the timer runs out, it goes off the moment it has enough."
          : '.'),
    );
  }
  if (ability.energyCost > 0) {
    const max = rules.energy.max ?? 0;
    const regen = rules.energy.regenPerSecond ?? 0;
    notes.push(
      `Every body starts each wave with ${n(max)} energy and regains ${n(regen)} a ` +
        'second. Energy is only spent while a wave or the Final Showdown is being fought.',
    );
  }
  if (controls) {
    const scale = rules.control.scale;
    const window = rules.control.windowSeconds ?? 0;
    const immune = rules.control.immuneSeconds ?? 0;
    const later = scale
      .slice(1)
      .map((f, i) => `the ${i === 0 ? 'second' : i === 1 ? 'third' : `${i + 2}th`} ${asLong(f)}`)
      .join(' and ');
    notes.push(
      'Stuns, roots and taunts wear thin on a body that keeps receiving them: within ' +
        `${n(window)} seconds of one landing, ${later}. After the ${scale.length === 3 ? 'third' : `${scale.length}th`}, ` +
        `the body can't be controlled at all for ${n(immune)} seconds.`,
    );
  }
  if (heals || controls) {
    const what =
      heals && controls ? 'healing and control durations' : heals ? 'healing' : 'control durations';
    notes.push(
      `In the Final Showdown, after the first ${n(rules.dampening.graceSeconds)} seconds, ` +
        `${what} lose ${n(rules.dampening.perSecond * 100)}% of their full strength for ` +
        'every second that passes.',
    );
  }
  return notes;
}

export function describeAbility(ability: ResolvedAbility, rules?: AbilityRules): AbilityCard {
  const description = ability.description ? fillDescription(ability).text : '';
  return {
    name: ability.name,
    text: ability.text,
    description,
    mechanics: description
      ? []
      : [triggerLine(ability), targetLine(ability.target), ...ability.effects.map(effectLine)],
    notes: rules ? abilityNotes(ability, rules) : [],
  };
}

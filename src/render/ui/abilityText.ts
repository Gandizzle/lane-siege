/**
 * Abilities, in words a player can act on. DESIGN.md §7, §18, §14.1.
 *
 * WHY THIS IS GENERATED AND NOT AUTHORED
 *
 * An ability's `text` in `abilities.json` says what it is FOR - "sets what it
 * touches burning" - and that is worth writing by hand. What it is WORTH is a
 * dozen numbers, and a hand-written "+8% damage to three allies" is a sentence
 * that stops being true the first time somebody tunes the ability. Every
 * number here is read off the RESOLVED ability instead (abilities.ts), so the
 * panel and the data cannot disagree and a balance pass never leaves a lie
 * behind it.
 *
 * It also answers the questions the flavour line cannot. "Three Pledges in a
 * row are three times braced" left a player asking whether they had to stay in
 * a row - so the trigger line for a passive says "always on, while in range",
 * the target line says how many and how far, and the effect line says how the
 * stacks are counted.
 */

import type {
  ResolvedAbility,
  ResolvedEffect,
  ResolvedTarget,
  StatKey,
} from '../../data/schema.ts';

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
      const armour = effect.bypassArmour ? ', ignoring armour' : '';
      return `${damageAmount(effect)} damage${armour}${bonus}${tag}`;
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

/** The whole card: what it is for, then when, then who, then what. */
export interface AbilityCard {
  name: string;
  /** The authored line: what it is for. */
  text: string;
  /** Generated from the numbers, and therefore always true. */
  mechanics: string[];
}

export function describeAbility(ability: ResolvedAbility): AbilityCard {
  return {
    name: ability.name,
    text: ability.text,
    mechanics: [
      triggerLine(ability),
      targetLine(ability.target),
      ...ability.effects.map(effectLine),
    ],
  };
}

/** Controls are shortened by repetition; say so once, where it is read. */
export const CONTROL_NOTE =
  'Stuns, roots and holds get shorter each time they land on the same body, ' +
  'and stop landing for a while after that.';

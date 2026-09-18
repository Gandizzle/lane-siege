/**
 * The one place a body's HP goes down. DESIGN.md §6, §7, §18.
 *
 * `dampening.ts` is the one place HP goes up, and this is the other half of
 * that pair. Every point of damage in the game - a swing, a shell, a burn
 * ticking, a reflected blow, an ability's splash - is applied by `dealDamage`,
 * and that is what makes the modifiers reliable: an ability that raised the
 * damage a body takes has to raise ALL of it, and a ward that eats the next
 * attack has to be spent by whatever arrives next. Damage applied anywhere else
 * would quietly ignore both.
 *
 * THE ORDER, WHICH IS THE WHOLE OF THE RULES
 *
 *   1. Evasion    - only an attack can be evaded. A burn cannot miss.
 *   2. A ward     - only an attack is eaten. Same reason.
 *   3. Critical   - rolled per attack, and never on a burn.
 *   4. The attacker's own modifiers: flat first, then multipliers.
 *   5. §6's matrix, unless the damage bypasses armour entirely.
 *   6. The target's `damageTaken`, which is where vulnerability and armour
 *      shred both land.
 *   7. Applied. Then lifesteal for the attacker and reflection for the target,
 *      both off the amount that actually landed rather than the amount rolled.
 *
 * Steps 1-3 are what `isAttack` selects. A hit is a thing that can miss, be
 * warded and crit; a burn or a splash is a consequence of a hit that already
 * happened, and letting it miss again would make one dodge worth two.
 *
 * PURITY: the roll comes from the match's own generator, threaded in by the
 * caller, so a replay crits in the same places (§15.1). Nothing here reads a
 * clock or `Math.random`.
 */

import type { DamageMatrix, DamageType } from '../data/schema.ts';
import { resolveDamage } from './damage.ts';
import { healBy } from './dampening.ts';
import type { Rng } from './rng.ts';
import { consumeShield, modifiersOf, type Afflicted } from './status.ts';
import type { ArmourType } from '../data/schema.ts';

/** How much a critical hit is worth when no ability has said otherwise. */
export const BASE_CRIT_DAMAGE = 1.0;

/** A body that can be hit: afflicted, alive, and wearing an armour type. */
export interface Target extends Afflicted {
  armour: ArmourType;
  alive: boolean;
}

/** A body that can hit: afflicted, and crediting what it lands. */
export interface Attacker extends Afflicted {
  damageDealt?: number;
}

export interface StrikeEnv {
  matrix: DamageMatrix;
  rng: Rng;
  /** Dampening's multiplier on any healing this strike causes (§3.3, replaced). */
  healing: number;
  /** Called when a strike is evaded, so `onEvade` abilities can fire. */
  onEvade?: (target: Target) => void;
  /** Called when a strike lands, so `onHurt` abilities can fire. */
  onHurt?: (target: Target, attacker: Attacker | null) => void;
}

export interface Strike {
  /** Damage before the attacker's modifiers and before the matrix. */
  amount: number;
  damageType: DamageType;
  /** Skip the matrix and the target's mitigation: true damage. */
  bypassArmour?: boolean;
  /**
   * Whether this is a blow rather than a consequence of one. Attacks can be
   * evaded, warded and critical; the damage they cause downstream cannot.
   */
  isAttack?: boolean;
  /** Suppress lifesteal and reflection, for damage nobody swung for. */
  noFeedback?: boolean;
}

/**
 * Apply one strike. Returns the HP the target actually lost, never more than it
 * had - so a killing blow worth three times what was left is credited with what
 * was left (§14.1's damage rows add up to the HP destroyed).
 */
export function dealDamage(
  env: StrikeEnv,
  attacker: Attacker | null,
  target: Target,
  strike: Strike,
): number {
  if (!target.alive || target.hp <= 0) return 0;

  const attack = strike.isAttack === true;
  const victim = modifiersOf(target);

  if (attack) {
    if (victim.evasion > 0 && env.rng.next() < victim.evasion) {
      env.onEvade?.(target);
      return 0;
    }
    if (consumeShield(target)) return 0;
  }

  let amount = strike.amount;
  if (attacker) {
    const mine = modifiersOf(attacker);
    if (attack && mine.critChance > 0 && env.rng.next() < mine.critChance) {
      amount *= 1 + BASE_CRIT_DAMAGE + mine.critDamage;
    }
    amount = (amount + mine.damageAdd) * mine.damageMul;
  }
  if (amount <= 0) return 0;

  const resolved = strike.bypassArmour
    ? amount
    : resolveDamage(env.matrix, amount, strike.damageType, target.armour) * victim.damageTakenMul;

  const landed = Math.min(resolved, target.hp);
  target.hp -= resolved;

  if (attacker && attacker.damageDealt !== undefined) attacker.damageDealt += landed;

  if (!strike.noFeedback && attacker) {
    const mine = modifiersOf(attacker);
    if (mine.lifesteal > 0) {
      // Through dampening.ts like every other point of healing, so the
      // showdown reaches it and a dead attacker is not healed out of its death.
      attacker.hp = healBy(attacker.hp, attacker.maxHp, landed * mine.lifesteal, env.healing);
    }
    // Reflection is the target's, off what it actually took, and never itself
    // reflected - `noFeedback` is what stops two reflecting bodies looping.
    if (attack && victim.reflect > 0) {
      dealDamage(env, null, attacker as unknown as Target, {
        amount: landed * victim.reflect,
        damageType: strike.damageType,
        bypassArmour: true,
        noFeedback: true,
      });
    }
  }

  if (landed > 0) env.onHurt?.(target, attacker);
  return landed;
}

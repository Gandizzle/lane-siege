/**
 * The damage matrix. DESIGN.md §6.
 *
 * Four damage types, four armor types, rock-paper-scissors. The matrix
 * applies in BOTH directions - monsters and defensive units each have a damage
 * type and an armor type, and a defender's Blast against a Plate monster is
 * penalised exactly as a monster's Blast against a Plate unit would be.
 */

import type { ArmorType, DamageMatrix, DamageType } from '../data/schema.ts';

export function damageMultiplier(
  matrix: DamageMatrix,
  damageType: DamageType,
  armor: ArmorType,
): number {
  return matrix[damageType]?.[armor] ?? 1;
}

/** Damage per attack after the matrix. Never negative. */
export function resolveDamage(
  matrix: DamageMatrix,
  amount: number,
  damageType: DamageType,
  armor: ArmorType,
): number {
  const dealt = amount * damageMultiplier(matrix, damageType, armor);
  return dealt > 0 ? dealt : 0;
}

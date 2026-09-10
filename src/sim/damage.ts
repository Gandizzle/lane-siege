/**
 * The damage matrix. DESIGN.md §6.
 *
 * Four damage types, four armour types, rock-paper-scissors. The matrix
 * applies in BOTH directions - monsters and defensive units each have a damage
 * type and an armour type, and a defender's Blast against a Plate monster is
 * penalised exactly as a monster's Blast against a Plate unit would be.
 */

import type { ArmourType, DamageMatrix, DamageType } from '../data/schema.ts';

export function damageMultiplier(
  matrix: DamageMatrix,
  damageType: DamageType,
  armour: ArmourType,
): number {
  return matrix[damageType]?.[armour] ?? 1;
}

/** Damage per attack after the matrix. Never negative. */
export function resolveDamage(
  matrix: DamageMatrix,
  amount: number,
  damageType: DamageType,
  armour: ArmourType,
): number {
  const dealt = amount * damageMultiplier(matrix, damageType, armour);
  return dealt > 0 ? dealt : 0;
}

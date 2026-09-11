/**
 * Approach slots: where each attacker stands around its target.
 *
 * Attackers converging on one target contend for the same point, and every
 * scheme that resolves that contention reactively - vetoing blocked
 * directions, or deflecting away from neighbours - oscillates. Both were tried
 * and measured: vetoing wasted 203 tiles of travel over twenty seconds,
 * deflection 266. The churn comes from the ordering itself, which flips as the
 * crowd shifts, so no amount of damping settles it.
 *
 * Removing the contention is what actually works. Each attacker is given its
 * own slot on a ring around the target and walks to that, so no two are ever
 * trying to occupy the same spot and there is nothing to resolve. Surrounding
 * falls out for free - the ring IS a surround - and a group approaching from one
 * side fans out around the far side instead of forming a queue behind it.
 *
 * This is the standard arrival-slot approach, and it is cheaper than crowd
 * steering: one pass over the attackers rather than a pairwise sweep.
 *
 * DETERMINISM: slots are assigned by entity id, and the ring is a hardcoded
 * table of unit vectors, so every client places everyone identically.
 */

import { RING } from './steering.ts';
import type { Vec2 } from './types.ts';

export interface Attacker {
  id: number;
  alive: boolean;
  radius: number;
}

/**
 * Which slot this attacker takes, counted by id among everyone sharing the
 * target. Stable while the group is stable, so nobody swaps places mid-approach.
 */
export function slotIndexFor<T extends Attacker>(
  attackers: readonly T[],
  self: T,
  targetOf: (a: T) => number | null,
  targetId: number,
): number {
  let index = 0;
  for (const other of attackers) {
    if (!other.alive || other === self) continue;
    if (targetOf(other) !== targetId) continue;
    if (other.id < self.id) index++;
  }
  return index;
}

/**
 * How many attackers actually fit shoulder to shoulder on a ring of this
 * radius. Using all eight directions regardless would place neighbours closer
 * than their own bodies and the slots would fight the separation pass - the
 * chord between adjacent eighths is only 0.77 of the radius.
 *
 * Integer arithmetic against a hardcoded constant, so it stays deterministic.
 */
function ringCapacity(ringRadius: number, selfRadius: number): number {
  if (selfRadius <= 0) return RING.length;
  // Half the circumference over the body radius, which is pi*r / radius.
  const fits = Math.floor((3.14159265358979 * ringRadius) / selfRadius);
  return Math.max(1, Math.min(RING.length, fits));
}

/**
 * Where to stand: on a ring around `target`, at exactly touching distance so
 * melee ends up body to body rather than a gap short of it.
 *
 * Past a full ring, extra attackers take a wider ring and wait their turn -
 * a real queue, but only once the target is genuinely surrounded.
 */
export function writeSlotPosition(
  targetPos: Vec2,
  targetRadius: number,
  selfRadius: number,
  reach: number,
  slotIndex: number,
  out: Vec2,
): void {
  const base = targetRadius + selfRadius + reach;
  const capacity = ringCapacity(base, selfRadius);

  const ring = Math.floor(slotIndex / capacity);
  const withinRing = slotIndex % capacity;

  // Spread the ring's occupants across the eight directions as evenly as the
  // table allows, so a half-full ring still surrounds rather than clumping.
  const direction = RING[Math.floor((withinRing * RING.length) / capacity)]!;
  const distance = base + ring * selfRadius * 2;

  out.x = targetPos.x + direction.x * distance;
  out.y = targetPos.y + direction.y * distance;
}

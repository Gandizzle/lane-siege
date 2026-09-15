/**
 * Target acquisition. DESIGN.md §5.1 and §5.2.
 *
 * One rule now serves both kinds: hold the current target while it is alive and
 * within range plus a little slack; otherwise take the nearest enemy that is in
 * range; otherwise there is no target and the body is seeking (motion.ts). The
 * slack is the hysteresis that stops a target drifting across the range
 * boundary from flipping its attacker between fighting and walking every tick.
 *
 * §5.1 has monsters re-evaluating "nearest" continuously and §5.2 has units
 * holding until the target dies or leaves range. Both are satisfied: a monster
 * that is walking has no target and re-reads the field every tick, which is a
 * stronger form of "nearest" than a distance scan; and once anything is in
 * range, holding it is right for both kinds, because switching between two
 * in-range enemies wastes the shots already landed on the first.
 *
 * Range is EDGE TO EDGE: bodies are circles, so "in range" means the gap
 * between the two circles is at most the range. A melee range near zero means
 * "touching", which is what melee should look like.
 *
 * Distances are compared squared. Nothing here needs an actual square root.
 */

import { ENGAGE_SLACK_TILES } from './constants.ts';
import { spineDx } from './motion.ts';
import type { DefensiveUnit, EntityId, Monster, Vec2 } from './types.ts';

/** What acquisition needs from either kind of body. */
export interface Combatant {
  id: EntityId;
  pos: Vec2;
  radius: number;
  /** Half-length of the body's horizontal spine; 0 for a circle (motion.ts). */
  halfWidth: number;
  alive: boolean;
}

export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Centre-to-spine distance squared between two bodies.
 *
 * Range is measured to the nearest point of the other body's spine, not to its
 * centre. For two circles that is the same thing. For the fortress it is the
 * difference between "in range of the wall you are standing at" and "in range
 * of a point five tiles away", which is the difference between a wave
 * besieging it and a wave standing at it.
 */
export function bodyDistanceSquared(a: Combatant, b: Combatant): number {
  const dx = spineDx(a.pos.x, a.halfWidth, b.pos.x, b.halfWidth);
  const dy = a.pos.y - b.pos.y;
  return dx * dx + dy * dy;
}

/** Is `other` within `range` of `self`, edge to edge? */
export function withinRange(self: Combatant, other: Combatant, range: number): boolean {
  const reach = range + self.radius + other.radius;
  return bodyDistanceSquared(self, other) <= reach * reach;
}

/** Nearest living enemy whose edge is within `range` of `self`'s edge, or null. */
export function nearestInRange<T extends Combatant>(
  enemies: readonly T[],
  self: Combatant,
  range: number,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const reach = range + self.radius + enemy.radius;
    const dist = bodyDistanceSquared(self, enemy);
    if (dist <= reach * reach && dist < bestDist) {
      bestDist = dist;
      best = enemy;
    }
  }
  return best;
}

/**
 * Who `self` is going after, under the hold-and-switch rule.
 *
 * Three clauses, and the order of them is the whole behaviour:
 *
 *   1. Keep the held target while it is alive and still inside `acquireRange`.
 *   2. A body already trading blows does not look around. It finishes what it
 *      started.
 *   3. Otherwise take the nearest inside `acquireRange`, but only if it is
 *      strictly closer than what is already held.
 *
 * Nothing inside `acquireRange` returns null, and the caller decides what that
 * means - for a monster it means the fortress (§5.5), which is where it was
 * headed anyway.
 *
 * WHY A RANGE AT ALL
 *
 * Because "nearest enemy in the lane" is a global question, and a body that
 * answers it every tick swerves whenever the answer changes somewhere else.
 * Thirty monsters all recomputing "nearest" against a moving crowd is thirty
 * bodies changing their minds together, which is what a shoal of jitter is made
 * of. A short acquisition range makes the decision local and mostly stable: a
 * monster commits to what is actually in front of it and ignores the rest of
 * the board.
 */
export function holdOrAcquire<T extends Combatant>(
  enemies: readonly T[],
  self: Combatant & { targetId: EntityId | null; engaged: boolean },
  acquireRange: number,
): T | null {
  let held: T | null = null;
  if (self.targetId !== null) {
    for (const enemy of enemies) {
      if (enemy.id !== self.targetId) continue;
      // The slack keeps a target hovering on the boundary from being dropped
      // and retaken every tick.
      if (enemy.alive && withinRange(self, enemy, acquireRange + ENGAGE_SLACK_TILES)) held = enemy;
      break;
    }
  }

  if (held !== null && self.engaged) return held;

  const nearest = nearestInRange(enemies, self, acquireRange);
  if (held === null) return nearest;
  if (nearest === null || nearest === held) return held;
  return bodyDistanceSquared(self, nearest) < bodyDistanceSquared(self, held) ? nearest : held;
}

/**
 * The enemy `self` should be attacking this tick, or null if nothing is in
 * range: the held one while it is alive and within range plus slack, else the
 * nearest in range.
 */
export function acquire<T extends Combatant>(
  enemies: readonly T[],
  self: Combatant & { targetId: EntityId | null },
  range: number,
): T | null {
  if (self.targetId !== null) {
    for (const enemy of enemies) {
      if (enemy.id !== self.targetId) continue;
      if (enemy.alive && withinRange(self, enemy, range + ENGAGE_SLACK_TILES)) return enemy;
      break;
    }
  }
  return nearestInRange(enemies, self, range);
}

/** Nearest living defensive unit to a point, or null if the lane is clear. */
export function nearestUnit(units: readonly DefensiveUnit[], from: Vec2): DefensiveUnit | null {
  let best: DefensiveUnit | null = null;
  let bestDist = Infinity;
  for (const unit of units) {
    if (!unit.alive) continue;
    const dist = distanceSquared(from, unit.pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = unit;
    }
  }
  return best;
}

/** Nearest living monster to a point, or null. */
export function nearestMonster(monsters: readonly Monster[], from: Vec2): Monster | null {
  let best: Monster | null = null;
  let bestDist = Infinity;
  for (const monster of monsters) {
    if (!monster.alive) continue;
    const dist = distanceSquared(from, monster.pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = monster;
    }
  }
  return best;
}

/**
 * Nearest living monster within `range` of a POINT with its own radius - the
 * fortress weapon, which fires from a place rather than from a body.
 */
export function nearestMonsterInRange(
  monsters: readonly Monster[],
  from: Vec2,
  range: number,
  fromRadius = 0,
): Monster | null {
  let best: Monster | null = null;
  let bestDist = Infinity;
  for (const monster of monsters) {
    if (!monster.alive) continue;
    const reach = range + fromRadius + monster.radius;
    const dist = distanceSquared(from, monster.pos);
    if (dist <= reach * reach && dist < bestDist) {
      bestDist = dist;
      best = monster;
    }
  }
  return best;
}

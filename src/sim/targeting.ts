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
import type { DefensiveUnit, EntityId, Monster, Vec2 } from './types.ts';

/** What acquisition needs from either kind of body. */
export interface Combatant {
  id: EntityId;
  pos: Vec2;
  radius: number;
  alive: boolean;
}

export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Is `other` within `range` of `self`, edge to edge? */
export function withinRange(self: Combatant, other: Combatant, range: number): boolean {
  const reach = range + self.radius + other.radius;
  return distanceSquared(self.pos, other.pos) <= reach * reach;
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
    const dist = distanceSquared(self.pos, enemy.pos);
    if (dist <= reach * reach && dist < bestDist) {
      bestDist = dist;
      best = enemy;
    }
  }
  return best;
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

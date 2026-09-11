/**
 * Target acquisition. DESIGN.md §5.1 and §5.2.
 *
 * The two rules are deliberately different, and the difference matters:
 *
 *   Monsters  - target the NEAREST defensive unit and re-evaluate continuously,
 *               switching if something becomes closer. Throttled to a fixed
 *               interval for CPU (§5.1, §15.3), not run every tick.
 *
 *   Units     - acquire the nearest valid target in range and HOLD it until it
 *               dies or leaves range. Only then reacquire. This is what stops
 *               target-switch jitter and wasted damage (§5.2).
 *
 * Distances are compared squared. Nothing here needs an actual square root.
 */

import type { DefensiveUnit, EntityId, Monster, Vec2 } from './types.ts';

export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function unitPosition(unit: DefensiveUnit): Vec2 {
  return { x: unit.pos.x, y: unit.pos.y };
}

/**
 * The same, written into a caller-owned vector. Tick-rate code uses this one:
 * §15.3 forbids per-frame allocation, and unit positions are read for every
 * monster on every tick.
 */
export function writeUnitPosition(unit: DefensiveUnit, out: Vec2): Vec2 {
  out.x = unit.pos.x;
  out.y = unit.pos.y;
  return out;
}

/** Nearest living defensive unit to a point, or null if the lane is clear. */
export function nearestUnit(units: readonly DefensiveUnit[], from: Vec2): DefensiveUnit | null {
  let best: DefensiveUnit | null = null;
  let bestDist = Infinity;
  for (const unit of units) {
    if (!unit.alive) continue;
    const dist = distanceSquared(from, unitPosition(unit));
    if (dist < bestDist) {
      bestDist = dist;
      best = unit;
    }
  }
  return best;
}

/** Nearest living monster within `range` tiles, or null. */
export function nearestMonsterInRange(
  monsters: readonly Monster[],
  from: Vec2,
  range: number,
): Monster | null {
  const rangeSq = range * range;
  let best: Monster | null = null;
  let bestDist = Infinity;
  for (const monster of monsters) {
    if (!monster.alive) continue;
    const dist = distanceSquared(from, monster.pos);
    if (dist <= rangeSq && dist < bestDist) {
      bestDist = dist;
      best = monster;
    }
  }
  return best;
}

export function findMonster(monsters: readonly Monster[], id: EntityId | null): Monster | null {
  if (id === null) return null;
  const found = monsters.find((m) => m.id === id);
  return found && found.alive ? found : null;
}

export function findUnit(
  units: readonly DefensiveUnit[],
  id: EntityId | null,
): DefensiveUnit | null {
  if (id === null) return null;
  const found = units.find((u) => u.id === id);
  return found && found.alive ? found : null;
}

/**
 * A unit's held target stays valid while it is alive AND in range (§5.2).
 * Returns the target to keep, or null meaning "reacquire".
 */
export function holdOrDrop(
  monsters: readonly Monster[],
  unit: DefensiveUnit,
  range: number,
): Monster | null {
  const current = findMonster(monsters, unit.targetId);
  if (!current) return null;
  return distanceSquared(unitPosition(unit), current.pos) <= range * range ? current : null;
}

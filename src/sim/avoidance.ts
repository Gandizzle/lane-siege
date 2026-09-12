/**
 * Getting around an ally that is in the way.
 *
 * Slots (slots.ts) removed the contention over WHERE to stand, but not the
 * problem of getting there: a unit walking at its slot will walk straight into
 * the back of an ally between it and the slot, and stop. Two rows of units, and
 * the back row never arrives - measured at 3 of 8 units reaching a target with
 * open lane either side of it.
 *
 * The fix is tangent steering with side commitment:
 *
 *   1. Find the nearest ally actually blocking the way - inside the corridor
 *      between here and the goal, not merely nearby.
 *   2. Pick the side to go round: whichever tangent points more toward the
 *      goal, so it takes the shorter way.
 *   3. COMMIT to that side until that ally stops blocking. This is the part
 *      that matters. Recomputing the side every tick is what made every
 *      previous attempt oscillate - the choice flips as the geometry shifts by
 *      a fraction, and the unit shuffles on the spot instead of going round.
 *   4. Head for the tangent point rather than the goal. Once past, the ally is
 *      no longer in the corridor and the unit resumes course naturally.
 *
 * This is local: it handles going round one or several allies, not a wall of
 * them spanning the whole lane. That limit turned out to matter - 1 of 8 units
 * through a wall with a gap at one end - so the global case is now answered by
 * the distance field in flowfield.ts, and this handles what the field hands
 * back: the last stretch to a slot, and the units the field has no clear cell
 * to offer at all. The two are complementary, not alternatives. Measured cost
 * of adding the field: 0.25ms to 0.83ms per tick, against a 50ms budget.
 */

import type { Vec2 } from './types.ts';

export interface AvoidableBody {
  id: number;
  pos: Vec2;
  radius: number;
  alive: boolean;
  /** Distance to the goal. Only bodies ahead of us in the queue block. */
  pathCost: number;
}

/** Extra clearance when rounding a body, so the pass is not a scrape. */
const MARGIN = 0.05;

/**
 * The nearest body blocking the straight run from `self` to `goal`, among those
 * with right of way. See `corridorPosition` for what counts as blocking.
 */
export function findBlocker<T extends AvoidableBody>(
  bodies: readonly T[],
  self: T,
  goal: Vec2,
): T | null {
  const gx = goal.x - self.pos.x;
  const gy = goal.y - self.pos.y;
  const goalDist = Math.sqrt(gx * gx + gy * gy);
  if (goalDist < 1e-6) return null;

  const dirX = gx / goalDist;
  const dirY = gy / goalDist;

  let best: T | null = null;
  let bestAlong = Infinity;

  for (const other of bodies) {
    if (!other.alive || other === self) continue;
    // Only yield to those ahead of us; otherwise two units each try to round
    // the other and neither commits.
    if (other.pathCost > self.pathCost) continue;
    if (other.pathCost === self.pathCost && other.id > self.id) continue;

    const along = corridorPosition(self, other, dirX, dirY, goalDist);
    if (along < 0 || along >= bestAlong) continue;

    bestAlong = along;
    best = other;
  }

  return best;
}

/**
 * How far along the path `other` sits, or -1 if it is not in the way.
 *
 * "In the way" means inside the corridor: ahead of us, before the goal, and
 * within both bodies' width of the centre line. A body merely close by but off
 * to one side is not in the way and must not trigger a detour, or units would
 * swerve around each other constantly.
 */
function corridorPosition(
  self: AvoidableBody,
  other: { pos: Vec2; radius: number },
  dirX: number,
  dirY: number,
  goalDist: number,
): number {
  const ox = other.pos.x - self.pos.x;
  const oy = other.pos.y - self.pos.y;

  // Distance along the path, and distance off to the side of it.
  const along = ox * dirX + oy * dirY;
  if (along <= 0 || along > goalDist) return -1;

  const side = Math.abs(ox * dirY - oy * dirX);
  if (side >= self.radius + other.radius + MARGIN) return -1;

  return along;
}

/**
 * Is this one body between `self` and `goal`?
 *
 * For the body a unit is walking AT, rather than the allies around it. Slots
 * ring the target, so a unit's slot is often behind it - and walking straight
 * at a slot on the far side means walking into the target and stopping there,
 * in somebody else's slot. Rounding the target is the same manoeuvre as
 * rounding an ally, so it uses the same tangent.
 */
export function blocksPath(
  self: AvoidableBody,
  other: { pos: Vec2; radius: number },
  goal: Vec2,
): boolean {
  const gx = goal.x - self.pos.x;
  const gy = goal.y - self.pos.y;
  const goalDist = Math.sqrt(gx * gx + gy * gy);
  if (goalDist < 1e-6) return false;

  return corridorPosition(self, other, gx / goalDist, gy / goalDist, goalDist) >= 0;
}

/**
 * Which way round: +1 or -1. Whichever tangent points more toward the goal,
 * which is the shorter way past.
 */
export function chooseSide(
  self: AvoidableBody,
  blocker: { pos: Vec2; radius: number },
  goal: Vec2,
): number {
  const bx = blocker.pos.x - self.pos.x;
  const by = blocker.pos.y - self.pos.y;
  const gx = goal.x - self.pos.x;
  const gy = goal.y - self.pos.y;

  // Sign of the cross product says which side of the blocker the goal lies on.
  const cross = bx * gy - by * gx;
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  // Dead ahead: break the tie deterministically rather than arbitrarily.
  return (self.id & 1) === 0 ? 1 : -1;
}

/**
 * Where to walk to get round the blocker: a point beside it, clear of both
 * bodies, on the committed side.
 */
export function writeTangentWaypoint(
  self: AvoidableBody,
  blocker: { pos: Vec2; radius: number },
  side: number,
  out: Vec2,
): void {
  const bx = blocker.pos.x - self.pos.x;
  const by = blocker.pos.y - self.pos.y;
  const length = Math.sqrt(bx * bx + by * by);

  if (length < 1e-6) {
    out.x = self.pos.x + side * (self.radius + blocker.radius + MARGIN);
    out.y = self.pos.y;
    return;
  }

  const dirX = bx / length;
  const dirY = by / length;
  const clearance = self.radius + blocker.radius + MARGIN;

  // Perpendicular to the line to the blocker, on the committed side, offset
  // from the blocker's centre - and a little past it, so the unit actually
  // clears rather than orbiting at a fixed angle.
  out.x = blocker.pos.x + -dirY * side * clearance + dirX * clearance * 0.5;
  out.y = blocker.pos.y + dirX * side * clearance + dirY * clearance * 0.5;
}

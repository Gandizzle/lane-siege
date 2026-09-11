/**
 * Monster movement. DESIGN.md §5.3.
 *
 * Deliberately no A*, no navmesh, no flow fields. Greedy steering: point at the
 * target and walk. Cheap enough for 4 lanes x ~30 monsters at 20 ticks/second
 * on a mid-range phone.
 *
 * NOTE FOR REVIEW: the pseudocode block in §5.3 of DESIGN.md is empty in the
 * document as supplied - only the prose around it survived. What follows is
 * written from that prose. Check it against the intended algorithm before
 * treating it as settled.
 *
 * The prose specifies three things, all implemented here:
 *   1. Move toward the target until in attack range, then attack.
 *   2. Break ties by preferring the direction closest to straight down the lane.
 *   3. Stuck detection: if net displacement over ~1s is below a threshold,
 *      attack whatever is nearest instead of continuing to steer. This fallback
 *      is the escape from local minima and MUST exist, or monsters vibrate
 *      against obstacles forever.
 */

import { STUCK_DISPLACEMENT_TILES, STUCK_WINDOW_TICKS, SECONDS_PER_TICK } from './constants.ts';
import { distanceSquared } from './targeting.ts';
import type { Monster, Vec2 } from './types.ts';

/** Straight down the lane: toward the fortress, which is +y. */
export const LANE_DIRECTION: Readonly<Vec2> = { x: 0, y: 1 };

/**
 * Unit direction from `from` to `to`. When the two coincide - the tie case -
 * fall back to straight down the lane rather than to an arbitrary axis.
 */
export function steerDirection(from: Vec2, to: Vec2, out: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq < 1e-12) {
    out.x = LANE_DIRECTION.x;
    out.y = LANE_DIRECTION.y;
    return out;
  }

  const length = Math.sqrt(lengthSq);
  out.x = dx / length;
  out.y = dy / length;
  return out;
}

const scratchDir: Vec2 = { x: 0, y: 0 };

/**
 * Advance one monster one tick toward `destination`.
 *
 * `speedMultiplier` carries enrage (§8), which applies to movement speed.
 * Returns true if the monster moved, false if it is already at the destination.
 *
 * TODO(§4.2, OPEN): units may or may not physically block movement. The doc
 * recommends no collision for v1 - monsters target the nearest unit and will
 * not advance past a living one anyway - and this implements that. If collision
 * is adopted, the sidestep goes here, and rule 2 above (prefer the direction
 * closest to straight down the lane) becomes load-bearing for choosing between
 * equally good detours.
 */
export function stepToward(
  monster: Monster,
  destination: Vec2,
  moveSpeed: number,
  speedMultiplier: number,
): boolean {
  const step = moveSpeed * speedMultiplier * SECONDS_PER_TICK;
  if (step <= 0) return false;

  const remainingSq = distanceSquared(monster.pos, destination);
  if (remainingSq <= step * step) {
    monster.pos.x = destination.x;
    monster.pos.y = destination.y;
    return remainingSq > 0;
  }

  const dir = steerDirection(monster.pos, destination, scratchDir);
  monster.pos.x += dir.x * step;
  monster.pos.y += dir.y * step;
  return true;
}

/**
 * Roll the stuck-detection window forward one tick. Sets `isStuck` when net
 * displacement over the window falls below the threshold; clears it as soon as
 * the monster is making progress again.
 */
export function updateStuckDetection(monster: Monster): void {
  monster.stuckTicks += 1;
  if (monster.stuckTicks < STUCK_WINDOW_TICKS) return;

  const moved = distanceSquared(monster.pos, monster.stuckAnchor);
  monster.isStuck = moved < STUCK_DISPLACEMENT_TILES * STUCK_DISPLACEMENT_TILES;

  monster.stuckAnchor.x = monster.pos.x;
  monster.stuckAnchor.y = monster.pos.y;
  monster.stuckTicks = 0;
}

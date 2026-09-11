/**
 * Monster movement. DESIGN.md §5.3.
 *
 * Deliberately no A*, no navmesh, no flow fields. Greedy steering: point at the
 * target, walk, and when something is in the way pick the next best direction.
 * Cheap enough for 4 lanes x ~30 monsters at 20 ticks/second on a mid-range
 * phone.
 *
 * NOTE: the pseudocode block in §5.3 of DESIGN.md is empty in the document as
 * supplied - only the prose around it survived. What follows implements the
 * three things that prose specifies:
 *
 *   1. Move toward the target until in attack range, then attack.
 *   2. Break ties by preferring the direction closest to straight down the lane.
 *   3. Stuck detection: if net displacement over ~1s is below a threshold,
 *      attack whatever is nearest instead of continuing to steer. This is the
 *      escape from local minima and MUST exist, or monsters vibrate against
 *      obstacles forever.
 *
 * §4.2 was OPEN and is now answered: units block movement. That makes rule 2
 * load-bearing - it is what decides between two equally direct detours around a
 * wall - and makes rule 3 a real safety net rather than a formality, because a
 * monster can now be boxed in completely.
 *
 * No trigonometry here: Math.sin/cos are not bit-identical across JavaScript
 * engines and would desync a match. The candidate directions are a constant
 * table and Math.sqrt is IEEE-exact.
 */

import { STUCK_DISPLACEMENT_TILES, STUCK_WINDOW_TICKS, SECONDS_PER_TICK } from './constants.ts';
import { isPositionBlocked, type OccupancyGrid } from './grid.ts';
import { distanceSquared } from './targeting.ts';
import type { Monster, Vec2 } from './types.ts';

/** Straight down the lane: toward the fortress, which is +y. */
export const LANE_DIRECTION: Readonly<Vec2> = { x: 0, y: 1 };

const DIAG = Math.SQRT1_2;

/**
 * The eight directions a monster may take. Ordered so that, all else equal,
 * earlier entries win - and the order runs from straight down the lane outward,
 * which is exactly the tie-break §5.3 asks for.
 */
const CANDIDATES: readonly Vec2[] = [
  { x: 0, y: 1 },
  { x: DIAG, y: DIAG },
  { x: -DIAG, y: DIAG },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: DIAG, y: -DIAG },
  { x: -DIAG, y: -DIAG },
  { x: 0, y: -1 },
];

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
/** Candidate ranking, reused across calls so a tick allocates nothing. */
const order: number[] = [0, 1, 2, 3, 4, 5, 6, 7];
const scores: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Rank the candidate directions by how closely they match `desired`.
 *
 * Insertion sort over eight fixed slots: no allocation, and stable, so equal
 * scores keep the CANDIDATES order - which is ordered lane-forward-first, and
 * is therefore the §5.3 tie-break.
 */
function rankCandidates(desired: Vec2): void {
  for (let i = 0; i < CANDIDATES.length; i++) {
    const c = CANDIDATES[i]!;
    scores[i] = c.x * desired.x + c.y * desired.y;
    order[i] = i;
  }
  for (let i = 1; i < order.length; i++) {
    const key = order[i]!;
    const keyScore = scores[key]!;
    let j = i - 1;
    while (j >= 0 && scores[order[j]!]! < keyScore) {
      order[j + 1] = order[j]!;
      j--;
    }
    order[j + 1] = key;
  }
}

/**
 * Advance one monster one tick toward `destination`.
 *
 * `speedMultiplier` carries enrage (§8), which applies to movement speed.
 * `grid` is the occupancy grid, or null when units do not block (§4.2).
 *
 * Returns true if the monster moved. A false return means every direction was
 * blocked - the caller leaves stuck detection to convert that into an attack.
 */
export function stepToward(
  monster: Monster,
  destination: Vec2,
  moveSpeed: number,
  speedMultiplier: number,
  grid: OccupancyGrid | null,
): boolean {
  const step = moveSpeed * speedMultiplier * SECONDS_PER_TICK;
  if (step <= 0) return false;

  const remainingSq = distanceSquared(monster.pos, destination);

  // Close enough to land exactly on it this tick.
  if (remainingSq <= step * step) {
    if (grid && isPositionBlocked(grid, destination.x, destination.y)) return false;
    const moved = remainingSq > 0;
    monster.pos.x = destination.x;
    monster.pos.y = destination.y;
    return moved;
  }

  const desired = steerDirection(monster.pos, destination, scratchDir);

  if (!grid) {
    monster.pos.x += desired.x * step;
    monster.pos.y += desired.y * step;
    return true;
  }

  // A monster standing inside a blocked tile - a unit was built on top of it -
  // must be free to leave by any route, or it is trapped permanently.
  const escaping = isPositionBlocked(grid, monster.pos.x, monster.pos.y);

  rankCandidates(desired);
  for (let i = 0; i < order.length; i++) {
    const c = CANDIDATES[order[i]!]!;
    const nx = monster.pos.x + c.x * step;
    const ny = monster.pos.y + c.y * step;
    if (!escaping && isPositionBlocked(grid, nx, ny)) continue;
    monster.pos.x = nx;
    monster.pos.y = ny;
    return true;
  }

  return false;
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

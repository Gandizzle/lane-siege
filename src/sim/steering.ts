/**
 * Movement. DESIGN.md §5.3.
 *
 * Deliberately no A*, no navmesh, no flow fields. Greedy steering: point at the
 * target, walk, and when something is in the way take the next best direction.
 *
 * NOTE: the pseudocode block in §5.3 of DESIGN.md is empty in the document as
 * supplied - only the prose survived. This implements that prose:
 *
 *   1. Move toward the target until in attack range, then attack.
 *   2. Break ties by preferring the direction closest to straight down the lane.
 *   3. Stuck detection: if net displacement over ~1s is below a threshold,
 *      attack whatever is nearest instead of continuing to steer.
 *
 * Rule 3 is a FALLBACK FOR ATTACKING, never a brake on movement. An earlier
 * version gated movement on the stuck flag, which deadlocked: a monster that
 * stopped because it was in attack range got flagged stuck, and from then on it
 * could not move, so its displacement stayed zero, so the flag never cleared.
 * Monsters froze in place permanently once their target died. Always attempt to
 * move; let the occupancy grid be the only thing that refuses.
 *
 * No trigonometry: Math.sin/cos are not bit-identical across JavaScript engines
 * and would desync a match. Candidate directions are a constant table and
 * Math.sqrt is IEEE-exact.
 */

import { STUCK_DISPLACEMENT_TILES, STUCK_WINDOW_TICKS, SECONDS_PER_TICK } from './constants.ts';
import { isPositionBlocked, type OccupancyGrid } from './grid.ts';
import { blockedByPriority, type SeparableBody } from './separation.ts';
import { distanceSquared } from './targeting.ts';
import type { Vec2 } from './types.ts';

/** Straight down the lane: toward the fortress, which is +y. */
export const LANE_DIRECTION: Readonly<Vec2> = { x: 0, y: 1 };

const DIAG = Math.SQRT1_2;

/**
 * The eight directions a mover may take, ordered from straight down the lane
 * outward - so that when two are equally good, the earlier one wins and the
 * §5.3 tie-break falls out of the ordering itself.
 *
 * Also doubles as the ring of approach slots around a target (see slots.ts).
 * Hardcoded rather than generated with trigonometry: Math.sin and Math.cos are
 * not bit-identical across engines, and a table built at load time would by a
 * ulp between clients and desync them.
 */
export const RING: readonly Vec2[] = [
  { x: 0, y: 1 },
  { x: DIAG, y: DIAG },
  { x: -DIAG, y: DIAG },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: DIAG, y: -DIAG },
  { x: -DIAG, y: -DIAG },
  { x: 0, y: -1 },
];

/** Anything that walks: a monster, or now a defensive unit out of range. */
export interface Mover {
  pos: Vec2;
  stuckAnchor: Vec2;
  stuckTicks: number;
  isStuck: boolean;
  /**
   * Which candidate direction was taken last tick, or -1.
   *
   * Sidestepping without memory oscillates: with the way forward blocked, the
   * ranking picks left, the step changes the geometry a fraction, next tick it
   * picks right, and the agent shuffles on the spot forever at exactly two
   * ticks per cycle. Remembering the choice and preferring it breaks the cycle.
   */
  lastStepIndex: number;
}

/**
 * Bodies to steer around while moving.
 *
 * Only bodies that OUTRANK the mover - closer to the goal - block a candidate
 * direction. That asymmetry is what lets a blocked agent flow around an ally
 * rather than deadlocking against it, and what stops two agents from each
 * refusing to move because of the other.
 *
 * Combined with the direction hysteresis below, an agent that has to go around
 * commits to one side instead of alternating, which is what turns a shuffling
 * scrum into units fanning out and surrounding their target.
 */
export interface Separation {
  others: readonly SeparableBody[];
  self: SeparableBody;
}

/**
 * Unit direction from `from` to `to`. When the two coincide - the tie case -
 * fall back to straight down the lane rather than an arbitrary axis.
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
 * How much to favour last tick's direction, in units of the dot-product score.
 * Enough to survive the small geometry change one step makes, not enough to
 * keep an agent committed to a direction that has become clearly wrong.
 */
const HYSTERESIS = 0.35;

/**
 * Rank candidates by how closely each matches `desired`. Insertion sort over
 * eight fixed slots: no allocation, and stable, so equal scores keep the
 * lane-forward-first CANDIDATES order - which is the §5.3 tie-break.
 */
function rankCandidates(desired: Vec2, lastIndex: number): void {
  for (let i = 0; i < RING.length; i++) {
    const c = RING[i]!;
    scores[i] = c.x * desired.x + c.y * desired.y;
    if (i === lastIndex) scores[i] = scores[i]! + HYSTERESIS;
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
 * Advance one mover one tick toward `destination`.
 *
 * `speedMultiplier` carries enrage (§8), which applies to movement speed.
 * `grid` is the occupancy grid, or null when nothing blocks.
 *
 * Returns true if it moved. False means every direction was blocked - the
 * caller turns that into an attack via stuck detection, never into a pause.
 */
export function stepToward(
  mover: Mover,
  destination: Vec2,
  moveSpeed: number,
  speedMultiplier: number,
  grid: OccupancyGrid | null,
  separation: Separation | null = null,
): boolean {
  const step = moveSpeed * speedMultiplier * SECONDS_PER_TICK;
  if (step <= 0) return false;

  const remainingSq = distanceSquared(mover.pos, destination);

  // Close enough to land exactly on it this tick.
  if (remainingSq <= step * step) {
    if (grid && isPositionBlocked(grid, destination.x, destination.y)) return false;
    if (
      separation &&
      blockedByPriority(separation.others, separation.self, destination.x, destination.y)
    ) {
      return false;
    }
    const moved = remainingSq > 0;
    mover.pos.x = destination.x;
    mover.pos.y = destination.y;
    return moved;
  }

  const desired = steerDirection(mover.pos, destination, scratchDir);

  if (!grid && !separation) {
    mover.pos.x += desired.x * step;
    mover.pos.y += desired.y * step;
    return true;
  }

  // A mover standing inside a blocked tile - a unit was built on top of it, or
  // it is the unit occupying that tile - must be free to leave by any route, or
  // it is trapped there forever.
  const escaping = grid !== null && isPositionBlocked(grid, mover.pos.x, mover.pos.y);

  rankCandidates(desired, mover.lastStepIndex);
  for (let i = 0; i < order.length; i++) {
    const index = order[i]!;
    const c = RING[index]!;
    const nx = mover.pos.x + c.x * step;
    const ny = mover.pos.y + c.y * step;

    if (grid && !escaping && isPositionBlocked(grid, nx, ny)) continue;
    if (separation && blockedByPriority(separation.others, separation.self, nx, ny)) continue;

    mover.pos.x = nx;
    mover.pos.y = ny;
    mover.lastStepIndex = index;
    return true;
  }

  mover.lastStepIndex = -1;
  return false;
}

/**
 * Roll the stuck-detection window forward one tick.
 *
 * Call this only while the mover is actually trying to travel. A mover standing
 * still because it is in attack range is not stuck, and counting those ticks is
 * what caused the freeze described at the top of this file - use
 * `clearStuck` for that case instead.
 */
export function updateStuckDetection(mover: Mover): void {
  mover.stuckTicks += 1;
  if (mover.stuckTicks < STUCK_WINDOW_TICKS) return;

  const moved = distanceSquared(mover.pos, mover.stuckAnchor);
  mover.isStuck = moved < STUCK_DISPLACEMENT_TILES * STUCK_DISPLACEMENT_TILES;

  mover.stuckAnchor.x = mover.pos.x;
  mover.stuckAnchor.y = mover.pos.y;
  mover.stuckTicks = 0;
}

/** Standing still on purpose - in range, or nothing to walk to - is not stuck. */
export function clearStuck(mover: Mover): void {
  mover.isStuck = false;
  mover.stuckTicks = 0;
  mover.stuckAnchor.x = mover.pos.x;
  mover.stuckAnchor.y = mover.pos.y;
}

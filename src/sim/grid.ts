/**
 * The build grid, as a grid. DESIGN.md §4.2.
 *
 * Tiles matter for exactly one thing now: where a unit may be BUILT. Movement
 * stopped caring about tiles when bodies became circles that collide as
 * circles (motion.ts) - a unit is a solid round thing a monster walks around,
 * not a square it may not enter - so the occupancy grid that used to sit here
 * is gone with the tile-based steering that read it.
 */

import type { DefensiveUnit } from './types.ts';

export function inBounds(
  grid: { width: number; depth: number },
  tileX: number,
  tileY: number,
): boolean {
  return tileX >= 0 && tileY >= 0 && tileX < grid.width && tileY < grid.depth;
}

/**
 * Is any living unit standing on this tile? Used to validate a build tap.
 *
 * Units advance during combat (§5.2, amended), so this reads where they ARE
 * rather than where they were built; in the build phase those are the same
 * thing, because respawn returns the line to its home tiles.
 */
export function tileOccupiedByUnit(
  units: readonly DefensiveUnit[],
  tileX: number,
  tileY: number,
): boolean {
  return units.some(
    (u) => u.alive && Math.floor(u.pos.x) === tileX && Math.floor(u.pos.y) === tileY,
  );
}

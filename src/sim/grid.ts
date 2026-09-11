/**
 * Tile occupancy. DESIGN.md §4.2.
 *
 * §4.2 was OPEN and has been answered: units DO physically block monster
 * movement. So monsters need to know which tiles are impassable, and steering
 * (§5.3) needs to route around them without pathfinding.
 *
 * The grid is rebuilt only when units are added, removed, upgraded or killed -
 * never per tick (§15.3). `Lane.occupancyDirty` is the flag that says so.
 *
 * Cells are a flat Uint8Array rather than a 2D array: one allocation for the
 * whole lane, and `structuredClone` copies it correctly for snapshots.
 */

import type { DefensiveUnit } from './types.ts';

export interface OccupancyGrid {
  width: number;
  depth: number;
  /** 1 = a living unit stands here. */
  cells: Uint8Array;
}

export function createGrid(width: number, depth: number): OccupancyGrid {
  return { width, depth, cells: new Uint8Array(width * depth) };
}

export function inBounds(grid: OccupancyGrid, tileX: number, tileY: number): boolean {
  return tileX >= 0 && tileY >= 0 && tileX < grid.width && tileY < grid.depth;
}

export function isTileBlocked(grid: OccupancyGrid, tileX: number, tileY: number): boolean {
  if (!inBounds(grid, tileX, tileY)) return false;
  return grid.cells[tileY * grid.width + tileX] === 1;
}

/**
 * World position -> blocked. Positions outside the build grid are always free:
 * the spawn zone above it and the fortress zone below it are open ground.
 */
export function isPositionBlocked(grid: OccupancyGrid, x: number, y: number): boolean {
  return isTileBlocked(grid, Math.floor(x), Math.floor(y));
}

/**
 * Rebuild from the living units' CURRENT positions.
 *
 * Units used to be pinned to their build tile, so this ran only when one was
 * added, removed or killed. They now advance when nothing is in range (§5.2,
 * amended), so it is rebuilt whenever any of them has moved. One `fill` over 80
 * bytes plus a write per unit is cheap against the §15.3 budget, and far
 * cheaper than letting units walk through each other.
 */
export function rebuildOccupancy(grid: OccupancyGrid, units: readonly DefensiveUnit[]): void {
  grid.cells.fill(0);
  for (const unit of units) {
    if (!unit.alive) continue;
    const tileX = Math.floor(unit.pos.x);
    const tileY = Math.floor(unit.pos.y);
    if (!inBounds(grid, tileX, tileY)) continue;
    grid.cells[tileY * grid.width + tileX] = 1;
  }
}

/** Is any living unit standing on this tile? Used to validate a build tap. */
export function tileOccupiedByUnit(
  units: readonly DefensiveUnit[],
  tileX: number,
  tileY: number,
): boolean {
  return units.some(
    (u) => u.alive && Math.floor(u.pos.x) === tileX && Math.floor(u.pos.y) === tileY,
  );
}

/**
 * Temporarily clear the tile a mover is standing on, so its own body does not
 * block its own step. Returns the previous value for `restoreSelf`.
 */
export function withoutSelf(grid: OccupancyGrid, x: number, y: number): number {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  if (!inBounds(grid, tileX, tileY)) return 0;
  const index = tileY * grid.width + tileX;
  const previous = grid.cells[index] ?? 0;
  grid.cells[index] = 0;
  return previous;
}

export function restoreSelf(grid: OccupancyGrid, x: number, y: number, value: number): void {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  if (!inBounds(grid, tileX, tileY)) return;
  grid.cells[tileY * grid.width + tileX] = value;
}

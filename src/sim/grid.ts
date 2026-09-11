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

/** Rebuild from the living units. Called on change, not on tick. */
export function rebuildOccupancy(grid: OccupancyGrid, units: readonly DefensiveUnit[]): void {
  grid.cells.fill(0);
  for (const unit of units) {
    if (!unit.alive) continue;
    if (!inBounds(grid, unit.tileX, unit.tileY)) continue;
    grid.cells[unit.tileY * grid.width + unit.tileX] = 1;
  }
}

/** Is any living unit already standing on this tile? Used to validate builds. */
export function tileOccupiedByUnit(
  units: readonly DefensiveUnit[],
  tileX: number,
  tileY: number,
): boolean {
  return units.some((u) => u.alive && u.tileX === tileX && u.tileY === tileY);
}

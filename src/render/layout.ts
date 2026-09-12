/**
 * Portrait layout. DESIGN.md §4.1 and §14.1.
 *
 * Fixed camera. The entire lane fits on one portrait screen: no panning, no
 * zooming, no scrolling. That is a hard constraint, and it is what removes an
 * entire class of mobile UX problems and keeps the renderer simple - there is
 * exactly one transform from tile space to screen space and it changes only on
 * resize.
 *
 * Top to bottom: opponent tabs, spawn zone, build zone, fortress + resource
 * building, build bar. The build bar sits at the bottom because that is the
 * thumb zone for one-handed play.
 */

import type { LaneFile } from '../data/schema.ts';

/**
 * Vertical share of the screen for each band. Presentation, not balance.
 *
 * The top band grew at M4: §4.1 always reserved it for opponent tabs, and now
 * there are opponents to put in it. It carries the wave clock and your
 * resources on one row and the four lanes on another, and the build zone gives
 * up the difference - the grid is square-fitted and centred, so it loses a
 * little height rather than changing shape.
 */
const BAND_WEIGHTS = {
  tabs: 0.115,
  spawn: 0.07,
  build: 0.465,
  fortress: 0.1,
  buildBar: 0.25,
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaneLayout {
  screen: Rect;
  tabs: Rect;
  spawn: Rect;
  build: Rect;
  fortress: Rect;
  buildBar: Rect;
  /** Pixels per tile. Square: tiles are not stretched. */
  tileSize: number;
  /** Top-left of the build grid in screen pixels, after centring. */
  gridOrigin: { x: number; y: number };
  grid: { width: number; depth: number };
}

/**
 * Computes the layout for a viewport. Called on boot and on resize, never per
 * frame.
 */
export function computeLayout(width: number, height: number, lane: LaneFile): LaneLayout {
  const band = (offset: number, weight: number): Rect => ({
    x: 0,
    y: height * offset,
    width,
    height: height * weight,
  });

  const tabs = band(0, BAND_WEIGHTS.tabs);
  const spawn = band(BAND_WEIGHTS.tabs, BAND_WEIGHTS.spawn);
  const build = band(BAND_WEIGHTS.tabs + BAND_WEIGHTS.spawn, BAND_WEIGHTS.build);
  const fortress = band(
    BAND_WEIGHTS.tabs + BAND_WEIGHTS.spawn + BAND_WEIGHTS.build,
    BAND_WEIGHTS.fortress,
  );
  const buildBar = band(1 - BAND_WEIGHTS.buildBar, BAND_WEIGHTS.buildBar);

  const grid = { width: lane.buildZone.width, depth: lane.buildZone.depth };

  // Square tiles, fitted to whichever axis binds first, then centred.
  const tileSize = Math.min(build.width / grid.width, build.height / grid.depth);
  const gridOrigin = {
    x: build.x + (build.width - tileSize * grid.width) / 2,
    y: build.y + (build.height - tileSize * grid.depth) / 2,
  };

  return {
    screen: { x: 0, y: 0, width, height },
    tabs,
    spawn,
    build,
    fortress,
    buildBar,
    tileSize,
    gridOrigin,
    grid,
  };
}

/** Tile space -> screen pixels. The simulation never sees pixels. */
export function tileToScreen(
  layout: LaneLayout,
  tileX: number,
  tileY: number,
): { x: number; y: number } {
  return {
    x: layout.gridOrigin.x + tileX * layout.tileSize,
    y: layout.gridOrigin.y + tileY * layout.tileSize,
  };
}

/** Screen pixels -> tile indices, or null outside the build grid. */
export function screenToTile(
  layout: LaneLayout,
  screenX: number,
  screenY: number,
): { tileX: number; tileY: number } | null {
  const tileX = Math.floor((screenX - layout.gridOrigin.x) / layout.tileSize);
  const tileY = Math.floor((screenY - layout.gridOrigin.y) / layout.tileSize);
  if (tileX < 0 || tileY < 0 || tileX >= layout.grid.width || tileY >= layout.grid.depth) {
    return null;
  }
  return { tileX, tileY };
}

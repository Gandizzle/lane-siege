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
 * there are opponents to put in it. The lane - spawn zone, build grid and
 * fortress zone together - is one band, because they are one continuous
 * stretch of ground in tile space and are square-fitted as one: a tile is the
 * same size in the spawn zone as on the grid, so a monster standing in the
 * open is the same size as one standing on the line.
 */
const BAND_WEIGHTS = {
  tabs: 0.115,
  lane: 0.635,
  buildBar: 0.25,
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The one transform from tile space to screen pixels.
 *
 * Narrower than a `LaneLayout` on purpose: the layers that draw BODIES - the
 * entities and the swings between them - need a scale and an origin and
 * nothing else, and saying so is what lets the same two layers draw a lane and
 * the Final Showdown's arena, which have nothing else in common (§3.3, replaced).
 */
export interface Camera {
  /** Pixels per tile. Square: tiles are not stretched. */
  tileSize: number;
  /** Where tile (0, 0) of the drawn grid sits in screen pixels. */
  gridOrigin: { x: number; y: number };
}

export interface LaneLayout extends Camera {
  screen: Rect;
  tabs: Rect;
  spawn: Rect;
  build: Rect;
  fortress: Rect;
  buildBar: Rect;
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
  const laneBand = band(BAND_WEIGHTS.tabs, BAND_WEIGHTS.lane);
  const buildBar = band(1 - BAND_WEIGHTS.buildBar, BAND_WEIGHTS.buildBar);

  const grid = { width: lane.buildZone.width, depth: lane.buildZone.depth };
  const tilesDeep = lane.spawnZoneDepth + grid.depth + lane.fortressZoneDepth;

  // Square tiles, fitted to whichever axis binds first, then centred - the
  // whole lane at once, so the spawn zone is drawn at the same scale it is
  // simulated at.
  const tileSize = Math.min(laneBand.width / grid.width, laneBand.height / tilesDeep);
  const laneTop = laneBand.y + (laneBand.height - tileSize * tilesDeep) / 2;
  const gridOrigin = {
    x: laneBand.x + (laneBand.width - tileSize * grid.width) / 2,
    y: laneTop + lane.spawnZoneDepth * tileSize,
  };

  const spawn: Rect = { x: 0, y: laneTop, width, height: lane.spawnZoneDepth * tileSize };
  const build: Rect = { x: 0, y: gridOrigin.y, width, height: grid.depth * tileSize };
  const fortress: Rect = {
    x: 0,
    y: gridOrigin.y + grid.depth * tileSize,
    width,
    height: lane.fortressZoneDepth * tileSize,
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

/**
 * The fortress as the screen sees it, in pixels: a stadium of `radius` swept
 * along a horizontal spine `halfWidth` either side of (cx, cy).
 *
 * One function because two things draw it - the lane draws the wall and the HUD
 * draws the health inside it - and a fortress whose gauge did not line up with
 * its stonework would look like a bug in both.
 */
export function fortressShape(
  layout: LaneLayout,
  lane: LaneFile,
): { cx: number; cy: number; halfWidth: number; radius: number } {
  const centre = tileToScreen(
    layout,
    lane.buildZone.width / 2,
    lane.buildZone.depth + lane.fortressZoneDepth * 0.5,
  );
  return {
    cx: centre.x,
    cy: centre.y,
    halfWidth: lane.fortressHalfWidth * layout.tileSize,
    radius: lane.fortressRadius * layout.tileSize,
  };
}

/** Tile space -> screen pixels. The simulation never sees pixels. */
export function tileToScreen(
  layout: Camera,
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

/**
 * The Final Showdown's camera. DESIGN.md §3.3 replaced, amending §14.1's fixed camera.
 *
 * §14.1's whole-lane-on-one-screen rule cannot hold here: the arena is 32
 * tiles on a side against a lane's 8 by 14, and shrinking it to fit a portrait
 * phone would leave a body four pixels across. So this is the one place the
 * camera moves, and the rules it moves under are:
 *
 *   - **Zoom out, but only as far as necessary.** The arena is fitted to the
 *     LONGER screen axis, which on a phone means its full height is on screen
 *     and the scrolling is sideways. It is never zoomed IN past the tile size
 *     the lane was drawn at, so a body in the arena is at most the size it was
 *     in the lane and usually a little smaller - the "slightly zoomed out" the
 *     showdown is meant to read as, not a different game.
 *   - **Scroll, never lose it.** The offset is clamped so the arena always
 *     covers the screen; along an axis it already fits, it is centred and the
 *     offset is ignored. You cannot drag the battlefield away and be left
 *     looking at the background.
 */
export function arenaCamera(
  width: number,
  height: number,
  arenaTiles: number,
  laneTileSize: number,
  offset: { x: number; y: number },
): Camera {
  const tileSize = Math.min(laneTileSize, Math.max(width, height) / arenaTiles);
  const span = arenaTiles * tileSize;
  return {
    tileSize,
    gridOrigin: {
      x: clampAxis(offset.x, span, width),
      y: clampAxis(offset.y, span, height),
    },
  };
}

/** Where the arena's top-left has to be for `tile` to sit at the screen centre. */
export function centredOn(
  width: number,
  height: number,
  tileSize: number,
  tile: { x: number; y: number },
): { x: number; y: number } {
  return { x: width / 2 - tile.x * tileSize, y: height / 2 - tile.y * tileSize };
}

function clampAxis(offset: number, span: number, screen: number): number {
  if (span <= screen) return (screen - span) / 2;
  return Math.min(0, Math.max(screen - span, offset));
}

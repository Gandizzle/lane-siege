/**
 * Where everything goes. DESIGN.md §4.1 and §14.1.
 *
 * Fixed camera: the entire lane fits on one screen, no panning, no zooming, no
 * scrolling. That is the hard constraint, and it is what removes an entire
 * class of mobile UX problems and keeps the renderer simple - there is exactly
 * one transform from tile space to screen space and it changes only on resize.
 *
 * TWO ARRANGEMENTS OF THE SAME THREE THINGS
 *
 * A screen holds three things: the HUD (the wave, your wallet, the four
 * opponent tabs), the LANE, and the BUILD BAR. §4.1 stacks them for a phone
 * held upright - HUD at the top, lane in the middle, bar at the bottom, where
 * the thumb is.
 *
 * Turned sideways, that stack is wrong twice over: the lane gets a third of a
 * short screen, and the two panels get long thin strips they cannot use. So
 * landscape puts the same three things in COLUMNS instead - HUD on the left,
 * lane in the middle, build bar on the right - which is the same reading order
 * rotated a quarter turn, and gives every one of them the full height.
 *
 * The lane is unchanged either way: 8 x 14 tiles, square-fitted, whole. What
 * changes is only which axis the furniture is stacked along, so the simulation
 * is untouched and both orientations are the same game (§15.1).
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
/** Portrait: the share of the SCREEN HEIGHT each band takes. */
const BAND_WEIGHTS = {
  tabs: 0.115,
  buildBar: 0.25,
} as const;

/**
 * Landscape: the share of the SCREEN WIDTH each column takes, and the least it
 * can be given.
 *
 * The lane takes what is left, which is more than it needs: a landscape screen
 * is short, so the lane's tile size is set by the height and the extra width
 * goes to centring it. That is not waste - the wave preview (§9.3) is drawn
 * across the top of the lane column, and at the tile width alone it would have
 * room for one chip.
 */
const COLUMN_WEIGHTS = {
  hud: 0.26,
  buildBar: 0.34,
} as const;
const COLUMN_MINIMUM = {
  hud: 150,
  buildBar: 240,
} as const;

/** Height of one opponent tab. They sit in a row in portrait, a column in landscape. */
const TAB_ROW_HEIGHT = 30;

/** Landscape: the block the four stacked opponent tabs are given, with gaps. */
const LANDSCAPE_TAB_BLOCK = 4 * (TAB_ROW_HEIGHT + 8) + 3 * 4;

/**
 * The least the top band can be, in pixels, whatever the screen height says.
 *
 * Three rows of text above the tab row - the wave, the phase, and the
 * incoming-send notice - plus the tabs themselves. A share of the screen is
 * the right way to divide a tall phone and the wrong way to divide a short
 * one: at 640 pixels 11.5% is 74, which is less than the HUD's own text needs,
 * and the notice ended up drawn behind the tabs. So the band takes what it
 * needs and the lane gives it up, because a lane one tile shorter is a
 * cosmetic loss and a warning you cannot read is not.
 */
const TABS_MIN_HEIGHT = 102;

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

/** Which way the furniture is stacked. Decided by the screen, never stored. */
export type Orientation = 'portrait' | 'landscape';

/**
 * A screen too short for the front screens' natural vertical rhythm.
 *
 * Home, the builder picker and the lobby are single centred columns of cards,
 * sized for an upright phone. Turned sideways there is half the height and
 * twice the width, so they lay the same cards out in two columns and tighten
 * the spacing rather than running off the bottom. The board itself does not
 * use this - it has `orientation` for the same question, asked properly.
 */
export function isCompact(height: number): boolean {
  return height < COMPACT_HEIGHT;
}

const COMPACT_HEIGHT = 560;

export interface LaneLayout extends Camera {
  /** Portrait stacks the three areas; landscape puts them in columns. */
  orientation: Orientation;
  /** Short enough that the front screens need two columns. See `isCompact`. */
  compact: boolean;
  screen: Rect;
  /** The HUD: the top band in portrait, the left column in landscape. */
  tabs: Rect;
  /**
   * The opponent tabs, inside the HUD area: a row across the bottom of the
   * band in portrait, a column down it in landscape.
   *
   * In the layout rather than computed by whoever draws it, because two things
   * need it and they disagreed: the tabs drew themselves from the bottom of
   * the band while the HUD placed its rows from the top, so on a short screen
   * the last row of text went behind the first row of tabs.
   */
  tabStrip: Rect;
  /** The whole board area - spawn zone, build grid and fortress zone together. */
  lane: Rect;
  spawn: Rect;
  build: Rect;
  fortress: Rect;
  /** The build bar: the bottom band in portrait, the right column in landscape. */
  buildBar: Rect;
  grid: { width: number; depth: number };
}

/**
 * Computes the layout for a viewport. Called on boot and on resize, never per
 * frame.
 *
 * Wider than it is tall means landscape. A square screen is portrait, because
 * a tie has to go somewhere and the stacked arrangement is the one the game
 * was designed around.
 */
export function computeLayout(width: number, height: number, lane: LaneFile): LaneLayout {
  const bands = width > height ? landscapeBands(width, height) : portraitBands(width, height);
  return fitLane(width, height, lane, bands);
}

/** The three areas, and which way they were stacked to get there. */
interface Bands {
  orientation: Orientation;
  tabs: Rect;
  tabStrip: Rect;
  laneBand: Rect;
  buildBar: Rect;
}

/**
 * §4.1's stack: opponent tabs, lane, build bar. The bar is at the bottom
 * because that is the thumb zone for one-handed play.
 *
 * Top and bottom bands first, then the lane gets what is left: the two bands
 * hold text and controls at a size a thumb and an eye need, and the lane is the
 * one thing that scales gracefully.
 */
function portraitBands(width: number, height: number): Bands {
  const tabsHeight = Math.max(height * BAND_WEIGHTS.tabs, TABS_MIN_HEIGHT);
  const buildBarHeight = height * BAND_WEIGHTS.buildBar;

  const tabs: Rect = { x: 0, y: 0, width, height: tabsHeight };
  return {
    orientation: 'portrait',
    tabs,
    // A row across the bottom of the band.
    tabStrip: {
      x: 6,
      y: tabs.y + tabs.height - TAB_ROW_HEIGHT - 4,
      width: width - 12,
      height: TAB_ROW_HEIGHT,
    },
    laneBand: {
      x: 0,
      y: tabsHeight,
      width,
      height: Math.max(0, height - tabsHeight - buildBarHeight),
    },
    buildBar: { x: 0, y: height - buildBarHeight, width, height: buildBarHeight },
  };
}

/**
 * The same three areas as columns: HUD, lane, build bar, left to right.
 *
 * The same reading order turned a quarter turn, and it is the arrangement a
 * short screen wants: stacked, the lane would get a third of four hundred
 * pixels and the two panels would get strips too thin to put a button in. In
 * columns every one of them has the full height, and the lane's tile size is
 * set by that height rather than by a third of it.
 *
 * The build bar takes the larger share because it holds the most: six tabs and
 * a grid of up to eight buttons, against the HUD's few rows of text and four
 * opponent tabs.
 */
function landscapeBands(width: number, height: number): Bands {
  const hudWidth = Math.max(COLUMN_MINIMUM.hud, width * COLUMN_WEIGHTS.hud);
  const barWidth = Math.max(COLUMN_MINIMUM.buildBar, width * COLUMN_WEIGHTS.buildBar);
  const laneWidth = Math.max(0, width - hudWidth - barWidth);

  const tabs: Rect = { x: 0, y: 0, width: hudWidth, height };
  return {
    orientation: 'landscape',
    tabs,
    // A column of four, anchored to the BOTTOM of the HUD so the rows of text
    // above it get everything else. Sideways the HUD says more than it does
    // upright - the resources split across two lines - and a fixed reservation
    // at the top ran the last rows behind the first tab.
    tabStrip: {
      x: 6,
      y: Math.max(0, height - LANDSCAPE_TAB_BLOCK - 6),
      width: hudWidth - 12,
      height: Math.min(LANDSCAPE_TAB_BLOCK, height - 12),
    },
    laneBand: { x: hudWidth, y: 0, width: laneWidth, height },
    buildBar: { x: width - barWidth, y: 0, width: barWidth, height },
  };
}

/**
 * The lane, square-fitted into whatever space the bands left, and the three
 * zone rectangles drawn from it.
 *
 * Shared, because this is the part that must not differ between the two
 * arrangements: the same 8 x 14 tiles, whole, at one scale, however the
 * furniture around them is stacked.
 */
function fitLane(width: number, height: number, lane: LaneFile, bands: Bands): LaneLayout {
  const { laneBand } = bands;
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

  // The zone bands span the lane COLUMN rather than the screen. In portrait
  // the column is the screen, so nothing about that layout changes.
  const band = (y: number, tiles: number): Rect => ({
    x: laneBand.x,
    y,
    width: laneBand.width,
    height: tiles * tileSize,
  });

  return {
    orientation: bands.orientation,
    compact: isCompact(height),
    screen: { x: 0, y: 0, width, height },
    tabs: bands.tabs,
    tabStrip: bands.tabStrip,
    lane: laneBand,
    spawn: band(laneTop, lane.spawnZoneDepth),
    build: band(gridOrigin.y, grid.depth),
    fortress: band(gridOrigin.y + grid.depth * tileSize, lane.fortressZoneDepth),
    buildBar: bands.buildBar,
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

/**
 * Screen pixels -> TILE SPACE, as a fractional point.
 *
 * `screenToTile` answers "which build tile is this", which is the question a
 * placement asks. This one answers "where in the lane is this", which is the
 * question everything else asks - and in particular the one picking a body
 * asks, since a body is a circle standing wherever it has walked to rather
 * than a thing that occupies a tile.
 */
export function screenToTilePoint(
  layout: Camera,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - layout.gridOrigin.x) / layout.tileSize,
    y: (screenY - layout.gridOrigin.y) / layout.tileSize,
  };
}

/** Enough of a body to point at it: where it is and how big it is. */
export interface Pickable {
  id: number;
  x: number;
  y: number;
  radius: number;
}

/**
 * How far past its own edge a body can still be tapped, in PIXELS.
 *
 * A body is a circle and the circle is everything - collision shape, hit
 * shape, drawn size (§14.2) - so the circle is what a tap hits. Exactly the
 * circle turned out to be too small to aim at: a unit is about half a tile
 * wide, which is twenty-odd pixels on a phone, against the 44 a thumb wants.
 * So the tap circle is the body plus this, which takes a tier-1 unit's target
 * to roughly that 44 without letting go of the rule that you are aiming at
 * the body rather than at the tile it happens to be standing in.
 *
 * Pixels rather than tiles because a finger is a physical size and a tile is
 * not: the allowance should be the same width of skin on every screen, which
 * means a different fraction of a tile on each.
 *
 * Short on purpose. Half a tile of slack would make a tap next to a line
 * select the line instead of placing beside it, and placing beside a line is
 * most of what the build phase is.
 */
export const TOUCH_SLACK_PX = 11;

/**
 * The body a tap landed on, in tile space, or null.
 *
 * The nearest body whose circle - plus `slack` of forgiveness - covers the
 * point. The tile was the old rule and it was wrong twice over: a unit that
 * had advanced off its tile could not be tapped where it was, and a tap on an
 * empty corner of an occupied tile selected a unit nowhere near it.
 *
 * Nearest CENTRE wins rather than nearest edge, and it decides both the
 * overlap case - bodies in a packed line overlap, and the one whose middle is
 * closest to the finger is the one meant - and the slack case, where two
 * neighbours are both within reach of a tap between them.
 */
export function bodyNear<T extends Pickable>(
  bodies: readonly T[],
  x: number,
  y: number,
  slack = 0,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const body of bodies) {
    const distance = Math.hypot(body.x - x, body.y - y);
    if (distance > body.radius + slack || distance >= bestDistance) continue;
    bestDistance = distance;
    best = body;
  }
  return best;
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

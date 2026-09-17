/**
 * What a tick needs that is not match state. DESIGN.md §15.1.
 *
 * Two things live here: the definitions index, built once from `data/`, and
 * the geometry of the places bodies can be. Both are derived entirely from the
 * data files, both are constant for a match, and neither belongs in
 * `MatchState` - they are how the match is read, not part of it.
 */

import type { GameData } from '../data/schema.ts';
import { arenaCentre, arenaShape, type ArenaShape } from './arena.ts';
import { buildDefIndex, type DefIndex } from './defs.ts';
import type { FlowField } from './flowfield.ts';
import type { Body, Bounds } from './motion.ts';
import { ARENA_CENTRE_ID, FORTRESS_ID, type Vec2 } from './types.ts';

/**
 * A place bodies can be: its size, its edges, and whatever is solid in it and
 * never moves.
 *
 * There are two. A LANE is one player's 8-wide strip with the fortress across
 * the end of it, and every lane has the same shape. The ARENA is the cross the
 * Final Showdown is fought in (§3.3, replaced): four spokes of lane width around a
 * shared centre, no fortress, everybody in it at once. The movement code takes
 * a world rather than reaching for the lane's numbers, so one set of rules
 * runs in both.
 */
export interface World {
  /** Field-cache prefix. Two worlds never share a field. */
  id: string;
  /** Grid size in TILES, and where row 0 of the field sits in tile space. */
  width: number;
  depth: number;
  originY: number;
  subdivision: number;
  /** Where a body may stand. The field blocks everything outside it. */
  bounds: Bounds;
  /** Solid to everyone and never moving: the fortress in a lane, nothing yet in the arena. */
  solids: readonly Body[];
}

/** Everything a tick needs that is not match state: the data and its index. */
export interface SimContext {
  data: GameData;
  defs: DefIndex;
  /** Where monsters go once the lane is clear. Constant for a match (§5.5). */
  fortressPosition: Vec2;
  /** The fortress as a body, for what counts as being in range of it. */
  fortress: Body;
  /**
   * The same body as a one-element contact set, so the movement code can
   * include it without allocating an array every tick (§15.3).
   */
  fortressBodies: readonly Body[];
  /** The lane's edges. Bodies stay inside them. */
  bounds: Bounds;
  /** One player's lane, as the movement code sees it. */
  lane: World;
  /** The cross the Final Showdown is fought in (§3.3, replaced). */
  arena: World;
  /** The arena's geometry, so a transplant does not recompute it per body. */
  arenaShape: ArenaShape;
  /**
   * The middle of the arena, as a body with no size.
   *
   * What a unit walks at when nothing is inside its acquisition range
   * (§3.3, replaced). Four armies converge because all four are walking at the
   * same point, not because any of them can see across the board. A point
   * rather than the whole centre square on purpose: stopping at the near edge
   * of an eight-tile square would leave two melee lines eight tiles apart and
   * blind to each other, which is a stalemate rather than a showdown.
   */
  arenaCentre: Body;
  /**
   * Distance fields, one per lane per (kind, radius, range) that has needed one.
   * Scratch, derived entirely from the lane's contents and rebuilt each tick,
   * so it lives here rather than in MatchState - it is a way of looking at the
   * match, not part of it.
   */
  fields: Map<string, FlowField>;
}

export function createContext(data: GameData): SimContext {
  const lane = data.lane;
  const fortressPosition = {
    x: lane.buildZone.width / 2,
    y: lane.buildZone.depth + lane.fortressZoneDepth * 0.5,
  };
  // §4: a wall across the end of the lane, not a pebble at the middle of it -
  // a horizontal spine with a radius swept along it (motion.ts). Settled and
  // alive forever: it never moves and it is never removed, and a destroyed
  // fortress ends the lane rather than clearing the obstacle.
  const fortress: Body = {
    id: FORTRESS_ID,
    pos: fortressPosition,
    radius: lane.fortressRadius,
    halfWidth: lane.fortressHalfWidth,
    alive: true,
    settled: true,
    // Not a monster, and solid to every one of them - including bosses, which
    // pass through their own side and nothing else.
    monster: false,
    phasesMonsters: false,
  };

  const bounds: Bounds = {
    minX: 0,
    maxX: lane.buildZone.width,
    minY: -lane.spawnZoneDepth,
    maxY: lane.buildZone.depth + lane.fortressZoneDepth,
  };
  const shape = arenaShape(data);

  return {
    data,
    defs: buildDefIndex(data),
    fortressPosition,
    fortress,
    fortressBodies: [fortress],
    bounds,
    lane: {
      id: 'lane',
      width: lane.buildZone.width,
      depth: lane.spawnZoneDepth + lane.buildZone.depth + lane.fortressZoneDepth,
      originY: -lane.spawnZoneDepth,
      subdivision: lane.pathSubdivision,
      bounds,
      solids: [fortress],
    },
    arena: {
      id: 'arena',
      width: shape.size,
      depth: shape.size,
      originY: 0,
      subdivision: lane.pathSubdivision,
      bounds: shape.bounds,
      // Nobody's fortress comes to the showdown (§3.3, replaced): the armies are the
      // only solid things in it.
      solids: [],
    },
    arenaShape: shape,
    arenaCentre: {
      id: ARENA_CENTRE_ID,
      pos: arenaCentre(shape),
      radius: 0,
      halfWidth: 0,
      alive: true,
      settled: true,
      monster: false,
      phasesMonsters: false,
    },
    fields: new Map(),
  };
}

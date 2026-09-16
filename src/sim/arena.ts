/**
 * The Final Showdown arena. DESIGN.md §3.3, replaced.
 *
 * §3.3 ended a match with an attrition endgame: from wave 25 nothing could be
 * built, nothing respawned, and increasingly nasty waves ground the table down
 * until one player was left. That is a war of attrition against the clock and
 * it is decided by who happened to bank the most gold. The Final Showdown
 * decides it by putting the four armies in one place and letting them fight.
 *
 * THE SHAPE
 *
 * A cross. Four spokes of lane width meeting at a square centre:
 *
 *                 +--------+
 *                 |  north |          Each spoke is `spokeWidth` across - the
 *                 |  grid  |          same 8 as a lane - and `spokeLength`
 *                 |--------|          long: the player's whole 10-row build
 *        +--------+ appr.  +--------+ grid, plus `approachDepth` rows of open
 *        | grid   | CENTRE | grid   | ground ahead of it. The centre is the
 *        | west   |  8x8   | east   | square where the four spokes meet, which
 *        +--------+ appr.  +--------+ is spokeWidth on a side by construction.
 *                 |--------|
 *                 |  grid  |          The four corners of the bounding square
 *                 |  south |          are not part of the arena: `bounds.band`
 *                 +--------+          is what keeps bodies out of them.
 *
 * Every army starts where it was built. A unit standing on tile (3, 7) of its
 * owner's build grid stands on the same tile of that owner's spoke, so the line
 * a player spent twenty-five waves arranging is the line they take into the
 * showdown - and the row they built nearest their fortress is the row furthest
 * from the fight.
 *
 * SEATING is by the team's place in the match, not by who is still alive: lane
 * one always fights from the south spoke, lane two from the west, and so on
 * clockwise. A player who was eliminated during the waves simply leaves their
 * spoke empty, which is easier to read than a table that reshuffles.
 */

import type { GameData } from '../data/schema.ts';
import type { Bounds } from './motion.ts';
import type { Vec2 } from './types.ts';

/** Which spoke an army fights from, in seating order: clockwise from south. */
export const LEGS = ['south', 'west', 'north', 'east'] as const;
export type Leg = (typeof LEGS)[number];

export interface ArenaShape {
  /** Across a spoke, in tiles: the lane's own width. */
  spokeWidth: number;
  /** Along a spoke: the build grid plus the open ground ahead of it. */
  spokeLength: number;
  /** Rows of open ground between a player's grid and the centre. */
  approachDepth: number;
  /** The bounding square's side. Spoke, centre, spoke. */
  size: number;
  /** Where bodies may stand, corners excluded. */
  bounds: Bounds;
}

export function arenaShape(data: GameData): ArenaShape {
  const spokeWidth = data.lane.buildZone.width;
  const approachDepth = data.waves.showdown.approachDepth;
  const spokeLength = data.lane.buildZone.depth + approachDepth;
  const size = spokeLength * 2 + spokeWidth;

  return {
    spokeWidth,
    spokeLength,
    approachDepth,
    size,
    bounds: {
      minX: 0,
      maxX: size,
      minY: 0,
      maxY: size,
      // Inside this band on either axis is inside a spoke or the centre.
      // Outside it on both is a corner, and there is no arena there.
      band: { min: spokeLength, max: spokeLength + spokeWidth },
    },
  };
}

/** The middle of the arena, which is the middle of the centre square. */
export function arenaCentre(shape: ArenaShape): Vec2 {
  return { x: shape.size / 2, y: shape.size / 2 };
}

/**
 * Where a unit built on tile (tileX, tileY) of its lane stands in the arena.
 *
 * The south spoke is the layout written out: the player's grid at the bottom
 * with its far row - the one that faced the monsters - nearest the centre.
 * Every other spoke is that same layout turned a quarter turn clockwise, once
 * per seat, so all four armies are arranged identically with respect to their
 * own fight.
 */
export function legPosition(shape: ArenaShape, leg: Leg, tileX: number, tileY: number): Vec2 {
  const { spokeLength, spokeWidth, approachDepth } = shape;
  // The south spoke, in arena tiles: x across the spoke, y down its length,
  // with tileY 0 - the row that faced the spawn - closest to the centre.
  let x = spokeLength + tileX + 0.5;
  let y = spokeLength + spokeWidth + approachDepth + tileY + 0.5;

  const centre = shape.size / 2;
  for (let turn = LEGS.indexOf(leg); turn > 0; turn--) {
    // A quarter turn clockwise on a screen whose y points down.
    const dx = x - centre;
    const dy = y - centre;
    x = centre - dy;
    y = centre + dx;
  }
  return { x, y };
}

/** The spoke a team fights from, by its seat at the table. */
export function legForSeat(seat: number): Leg {
  return LEGS[seat % LEGS.length]!;
}

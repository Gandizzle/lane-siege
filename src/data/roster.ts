/**
 * What a builder's six lines are, in the order they are shown, and what each
 * one is FOR.
 *
 * The build bar lays the six out as two rows of three, and the order is not
 * decoration: it is how a player reads the roster. Top row is rungs 1, 2 and 3
 * left to right - the cheap end, what you can afford in wave two - and the
 * bottom row is rungs 4, 5 and 6, which is what the endgame is fought with.
 * Reading down a column is reading up the ladder.
 *
 * EVERY ROW HOLDS A TANK AND A GUN. A row of three that is all range is a row
 * a player cannot open with, and a row that is all melee is a row that cannot
 * kill anything at reach - so whichever half of the ladder you are buying from,
 * you can build a front line and something to stand behind it. That rule is
 * enforced in `validate.ts` rather than left to whoever edits the JSON next,
 * because it is exactly the sort of thing that survives one edit and quietly
 * dies on the second.
 *
 * The classifications are read off the numbers rather than written on the
 * definitions, so a unit cannot claim to be a tank and then be restatted into
 * a glass cannon while still claiming it.
 */

import type { GameData, UnitDef } from './schema.ts';

/** Lines per builder, and per row of the build bar. */
export const LINES_PER_BUILDER = 6;
export const LINES_PER_ROW = 3;

/**
 * Reach at or under this is melee: the body walks up and touches. Measured
 * edge to edge, so a shade over zero is "close enough to be in the scrum".
 */
export const MELEE_RANGE = 0.5;

/**
 * Hit points per point of damage a second, above which a body is a TANK.
 *
 * A wall is not defined by how much health it has - a rung 6 body has plenty -
 * but by how little of its price went on hurting anybody. 25 sits well clear
 * of the fighters, which run from 4 to 18, and comfortably under the walls,
 * which run from 40 up.
 */
export const TANK_HP_PER_DPS = 25;

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

/** Damage a second, before anything modifies it. */
export function baseDps(unit: UnitDef): number {
  return num(unit.damage) * num(unit.attackSpeed);
}

/** How many hit points this body carries per point of damage a second. */
export function bulk(unit: UnitDef): number {
  const dps = baseDps(unit);
  return dps > 0 ? num(unit.hp) / dps : Infinity;
}

export function isMelee(unit: UnitDef): boolean {
  return num(unit.range) <= MELEE_RANGE;
}

export function isRanged(unit: UnitDef): boolean {
  return !isMelee(unit);
}

/** A body built to be hit rather than to hit: melee, and mostly hit points. */
export function isTank(unit: UnitDef): boolean {
  return isMelee(unit) && bulk(unit) >= TANK_HP_PER_DPS;
}

/**
 * A builder's six buildable lines, IN RUNG ORDER.
 *
 * Only Mark I: the higher marks are reached by upgrading in place, not by
 * building, so they are never slots on the bar. Sorted here rather than at
 * each call site, because "the order they are shown" is one fact and three
 * screens read it.
 */
export function buildableUnits(data: GameData, builderId: string): UnitDef[] {
  return data.units.units
    .filter((unit) => unit.mark === 1 && unit.builderId === builderId)
    .sort((a, b) => a.rung - b.rung);
}

/** The six split into the two rows the build bar draws them in. */
export function rosterRows(data: GameData, builderId: string): UnitDef[][] {
  const units = buildableUnits(data, builderId);
  const rows: UnitDef[][] = [];
  for (let i = 0; i < units.length; i += LINES_PER_ROW) {
    rows.push(units.slice(i, i + LINES_PER_ROW));
  }
  return rows;
}

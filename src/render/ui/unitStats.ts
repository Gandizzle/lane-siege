/**
 * What the selected-unit panel says about a unit. See buildBar.ts for where it
 * is drawn.
 *
 * Separate from the panel because the panel cannot be built without a canvas to
 * measure text against, and this is the part with decisions in it.
 */

import type { GameData, MonsterDef, UnitDef } from '../../data/schema.ts';
import { refId, refRank } from '../../data/schema.ts';
import { RANGED_MIN_TILES } from '../attackStyle.ts';
import type { StatMods } from '../../sim/index.ts';
import type { Chip } from './abilityChips.ts';

/**
 * The selected-unit stat block, laid out two across and three down in reading
 * order. Six cells rather than every number a unit has: these are the ones that
 * decide whether it belongs on a tile, and a wall of numbers on a phone reads
 * as no numbers at all.
 *
 * `Dmg/s` is derived rather than authored, because damage and attack speed are
 * only meaningful together - a tier that trades one for the other looks like an
 * upgrade in one cell and a downgrade in the next until you multiply them.
 *
 * These are DEFINITION numbers. Tech (§7.4) and the fortress aura (§10.1)
 * multiply on top of them and are shown on their own tabs; folding them in here
 * would make the tier comparison - which is what the panel is for - move for
 * reasons that have nothing to do with the tier.
 */
export type StatKey = 'hp' | 'range' | 'damage' | 'attackSpeed' | 'dps' | 'moveSpeed';
export const STAT_CELLS: { key: StatKey; name: string }[] = [
  { key: 'hp', name: 'HP' },
  { key: 'range', name: 'Range' },
  { key: 'damage', name: 'Damage' },
  { key: 'attackSpeed', name: 'Atk spd' },
  { key: 'dps', name: 'Dmg/s' },
  { key: 'moveSpeed', name: 'Move' },
];
export const STAT_COLUMNS = 2;
export const STAT_ROW_HEIGHT = 15;
/** How far the value sits from its name. Fixed, so the values line up. */
export const STAT_VALUE_INSET = 58;

/**
 * How each stat cell is scaled by what is currently on the body.
 *
 * `Dmg/s` is the only one that is not a straight lookup: it is damage times
 * attack speed, so anything changing either changes it, which is exactly why
 * the cell exists. Range and HP are not multiplied - reach is not modifiable
 * at all (abilities.ts), and the HP cell is the body's MAXIMUM, which is what
 * `maxHealth` moves.
 */
function scaleFor(key: StatKey, mods: StatMods): number {
  switch (key) {
    case 'damage':
      return mods.damage;
    case 'attackSpeed':
      return mods.attackSpeed;
    case 'dps':
      return mods.damage * mods.attackSpeed;
    case 'moveSpeed':
      return mods.moveSpeed;
    case 'hp':
      return mods.maxHealth;
    case 'range':
      return 1;
  }
}

/** Unmodified, to within the hundredth the wire quantises to (protocol.ts). */
export function isPlain(scale: number): boolean {
  return Math.abs(scale - 1) < 0.005;
}

/**
 * One stat, as `now` or `now → then` - the arrow only where the tier actually
 * changes it, so what an upgrade buys is what stands out.
 *
 * `mods` is what is on the body RIGHT NOW: an aura it is standing in, a slow
 * somebody put on it, the tech its owner bought (`EntityView.mods`). The cell
 * shows the number the body is actually fighting with, because that is the
 * question a player looking at a selected body is asking - and the SAME
 * multiplier is applied to the next tier's reading, so the comparison stays
 * between two tiers rather than between a buffed body and an unbuffed one.
 */
export function statText(
  key: StatKey,
  current: UnitDef,
  next: UnitDef | null,
  mods: StatMods | null = null,
): string {
  const scale = mods ? scaleFor(key, mods) : 1;
  const now = reading(key, current, scale);
  const then = next ? reading(key, next, scale) : null;
  const body = then === null || then === now ? now : `${now} → ${then}`;
  // The unit goes on the outside, so a change reads "2.4 → 2.6 tiles" rather
  // than saying "tiles" twice about one number.
  return body + unitFor(key, current);
}

/** Which way a cell's number has moved, for the colour it is drawn in. */
export type StatDirection = 'plain' | 'up' | 'down';

export function statDirection(key: StatKey, mods: StatMods | null): StatDirection {
  if (!mods) return 'plain';
  const scale = scaleFor(key, mods);
  if (isPlain(scale)) return 'plain';
  return scale > 1 ? 'up' : 'down';
}

function reading(key: StatKey, def: UnitDef, scale = 1): string {
  const damage = (def.damage ?? 0) * scale;
  const attackSpeed = def.attackSpeed ?? 0;
  switch (key) {
    case 'hp':
      return String(Math.round((def.hp ?? 0) * scale));
    case 'damage':
      return String(Math.round(damage));
    case 'attackSpeed':
      return trim(attackSpeed * scale);
    case 'dps':
      // `scale` is already damage × attack speed here, so the base pair is
      // multiplied once rather than twice.
      return trim((def.damage ?? 0) * attackSpeed * scale);
    case 'moveSpeed':
      // Two decimals: every unit in the game walks between 0.2 and 0.65 tiles a
      // second, so one decimal rounds most of a tier's gain away.
      return trim((def.moveSpeed ?? 0) * scale, 2);
    case 'range':
      // A melee reach is a hair over zero (§5.2, edge to edge), so the number
      // says nothing a player can use. The word does.
      return isMelee(def) ? 'melee' : trim(def.range ?? 0);
  }
}

/** What the reading is measured in, or nothing where the word says it already. */
function unitFor(key: StatKey, def: UnitDef): string {
  if (key === 'attackSpeed') return '/s';
  if (key === 'range') return isMelee(def) ? '' : ' tiles';
  return '';
}

function isMelee(def: UnitDef): boolean {
  return (def.range ?? 0) < RANGED_MIN_TILES;
}

/** Rounded to `places`, without a trailing `.0` on whole numbers. */
function trim(value: number, places = 1): string {
  const scale = 10 ** places;
  const rounded = Math.round(value * scale) / scale;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Where each part of the selected-body panel goes, from the outside in.
 *
 * THE RULE THIS EXISTS FOR: the buttons are pinned to the bottom of the panel
 * and the ability text above them grows with what it has to say, so on a short
 * screen the two used to meet - and it was the text that lost, because the
 * buttons are drawn after it. Making the text's box a SUBTRACTION rather than
 * a guess is what fixes that at every screen size and both orientations: the
 * title takes its line, the stats take their rows, the buttons take a touch
 * target at the bottom, and the text gets exactly what is left over. It can be
 * nothing, and nothing is a legible outcome; what it can never be is the
 * buttons' space.
 *
 * Pure and out here rather than inside the panel, so a test can assert the
 * subtraction at a dozen viewport sizes without a canvas to measure against.
 */
export interface PanelRegions {
  /** One line: the name, with its damage and armour types beside it. */
  title: Rect;
  /** The six stat cells, two across. */
  stats: Rect;
  /** What the body does. Whatever is left, and it takes what it is given. */
  text: Rect;
  /**
   * How many rows of stat cells actually fit. The panel hides the rest: a cell
   * drawn outside its box is a number sitting on top of the ability text.
   */
  statRows: number;
  /** Upgrade and Sell, or nothing at all for a body you do not own. */
  buttons: Rect;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Inset from the bar's edges, so the panel is not flush against them. */
export const PANEL_INSET = 18;
/** A touch target, from §14.1's one-thumb rule. */
export const PANEL_BUTTON_HEIGHT = 44;
/** The title's line, including the gap under it. */
const TITLE_HEIGHT = 24;
/** Between the text block and whatever is under it. */
const TEXT_GAP = 6;
/**
 * The text's floor: two short lines, which is two ability NAMES.
 *
 * Claimed ahead of the stat rows rather than after them. On a 360x640 phone
 * the leftovers came to seven pixels and the panel showed a unit's name, its
 * numbers and nothing whatever about what it does - and what it does is the
 * half a player cannot read anywhere else, where every number here is either
 * on the build button or derivable from two cells that are still shown. So on
 * a panel that cannot hold everything, the stat grid loses its last row and
 * the abilities keep their names.
 */
const TEXT_MIN_HEIGHT = 26;

export function panelRegions(
  bar: Rect,
  top: number,
  height: number,
  /** False for a monster, which has no buttons and gets their space instead. */
  hasButtons = true,
): PanelRegions {
  const x = bar.x + PANEL_INSET;
  const width = Math.max(0, bar.width - PANEL_INSET * 2);
  const statRows = Math.ceil(STAT_CELLS.length / STAT_COLUMNS);

  // The buttons are taken off the bottom FIRST, because being able to act on
  // the thing you selected outranks reading about it. Clamped to the top of
  // the panel so that a panel shorter than one touch target reports a
  // degenerate layout rather than boxes in the wrong order.
  const buttonHeight = hasButtons ? PANEL_BUTTON_HEIGHT + 2 : 0;
  const buttonTop = Math.max(top, top + height - buttonHeight);

  // Everything else is allocated from the top down, each part taking what it
  // wants or what is left, whichever is less.
  let y = top + 2;
  const title = { x, y, width, height: Math.min(TITLE_HEIGHT, Math.max(0, buttonTop - y)) };
  y += title.height;

  // Whole rows only - half a row of stat cells is a row of clipped numbers -
  // and never so many that the text is left with nothing (see
  // `TEXT_MIN_HEIGHT`).
  const roomForStats = Math.max(0, buttonTop - y - TEXT_GAP - TEXT_MIN_HEIGHT);
  const rowsThatFit = Math.max(0, Math.min(statRows, Math.floor(roomForStats / STAT_ROW_HEIGHT)));
  const stats = { x, y, width, height: rowsThatFit * STAT_ROW_HEIGHT };
  y += stats.height + (stats.height > 0 ? TEXT_GAP : 0);

  const textTop = Math.min(y, buttonTop);
  return {
    title,
    stats,
    statRows: rowsThatFit,
    // The subtraction, and the whole point of this function: the text gets what
    // is left between the stats and the buttons, and nothing else. It can be
    // nothing, and nothing is a legible outcome.
    text: { x, y: textTop, width, height: Math.max(0, buttonTop - textTop) },
    buttons: { x, y: buttonTop + 2, width, height: hasButtons ? PANEL_BUTTON_HEIGHT : 0 },
  };
}

/**
 * The shortest a grid row may be drawn, when even dropping to one column
 * cannot give every row a touch target. Below this a button is not a button.
 */
export const MIN_ROW_HEIGHT = 30;

/**
 * How many columns to put `count` buttons in, given the box they have.
 *
 * Two constraints pull opposite ways: a button needs width for its words, and
 * a row needs height to be worth tapping. More columns means wider buttons but
 * more rows to stack, so both are functions of the same choice - and on a
 * short phone neither can be fully satisfied.
 *
 * So it is a preference order rather than a rule: rows at a full touch target
 * and buttons wide enough to read; then buttons wide enough with shorter rows;
 * then tappable rows however narrow; and finally as many columns as there are
 * buttons. Within each step it takes the MOST columns that qualify, which is
 * the fewest rows - five sends two across is three rows of half-height buttons
 * with a gap beside the last, and three across is two rows that fill the tab.
 * Whichever is chosen, the rows FIT: a button drawn past the bottom of the bar
 * can be neither read nor tapped, which is worse than anything being traded.
 */
export function columnsThatFit(
  count: number,
  width: number,
  height: number,
  minWidth: number,
  gap: number,
): number {
  const room = (cols: number) => {
    const rows = Math.ceil(count / cols);
    return {
      width: (width - gap * (cols - 1)) / cols,
      height: (height - gap * (rows - 1)) / rows,
    };
  };
  const preferences: ((cols: number) => boolean)[] = [
    (c) => room(c).width >= minWidth && room(c).height >= PANEL_BUTTON_HEIGHT,
    (c) => room(c).width >= minWidth && room(c).height >= MIN_ROW_HEIGHT,
    (c) => room(c).height >= MIN_ROW_HEIGHT,
  ];
  for (const wanted of preferences) {
    for (let cols = count; cols >= 1; cols--) {
      if (wanted(cols)) return cols;
    }
  }
  return count;
}

/**
 * The type line beside a body's name: what it deals and what it is made of.
 *
 * Beside rather than under, because the tier it is about to become was the
 * other half of that row and is gone - a player upgrading a Vigil does not
 * need to be told the next one is called "Vigil II", and the tier number is
 * already on the Upgrade button's pips.
 */
export function typeLine(damageType: string, armour: string): string {
  return `${damageType} · ${armour}`;
}

/**
 * What the selected body does, as one chip per ability.
 *
 * A chip is a NAME. The description and every number behind it are one tap
 * away on a card (abilityCard.ts), because a name always fits the panel's two
 * lines and a sentence has to be shrunk until it does - which is how a tier-1
 * Oathwall came to show "Hold the Line" and nothing else at all.
 *
 * The next tier's NEW abilities are chips too, marked `upcoming`: what an
 * upgrade unlocks is exactly the sort of thing to read before buying it. An
 * ability the next tier merely improves is not a chip, because the stat block
 * above already shows what the tier moves.
 */
export function unitChips(data: GameData, current: UnitDef, next: UnitDef | null): Chip[] {
  const chips: Chip[] = [];
  const held = new Set<string>();

  for (const ref of current.abilities ?? []) {
    const ability = data.abilities.abilities.find((a) => a.id === refId(ref));
    if (!ability) continue;
    held.add(ability.id);
    chips.push({ abilityId: ability.id, rank: refRank(ref), name: ability.name, upcoming: false });
  }

  for (const ref of next?.abilities ?? []) {
    const id = refId(ref);
    if (held.has(id)) continue;
    const ability = data.abilities.abilities.find((a) => a.id === id);
    if (!ability) continue;
    chips.push({ abilityId: id, rank: refRank(ref), name: ability.name, upcoming: true });
  }
  return chips;
}

/** The same for a monster, which has no tiers and therefore nothing upcoming. */
export function monsterChips(data: GameData, def: MonsterDef): Chip[] {
  const chips: Chip[] = [];
  for (const ref of def.abilities ?? []) {
    const ability = data.abilities.abilities.find((a) => a.id === refId(ref));
    if (!ability) continue;
    chips.push({ abilityId: ability.id, rank: refRank(ref), name: ability.name, upcoming: false });
  }
  return chips;
}

/**
 * What a body with no abilities says.
 *
 * Most monsters do nothing special, and saying so is the answer to the
 * question the tap asked. A blank block reads as a panel that failed to load.
 */
export const NOTHING_SPECIAL = 'Nothing special. It walks at you and hits things.';

/**
 * A monster's stat cells. The same six readings as a unit's, minus the tier
 * comparison a monster has no use for.
 */
export function monsterStatText(
  key: StatKey,
  def: MonsterDef,
  mods: StatMods | null = null,
): string {
  const scale = mods ? scaleFor(key, mods) : 1;
  const damage = (def.damage ?? 0) * scale;
  const attackSpeed = def.attackSpeed ?? 0;
  switch (key) {
    case 'hp':
      return String(Math.round((def.hp ?? 0) * scale));
    case 'damage':
      return String(Math.round(damage));
    case 'attackSpeed':
      return `${trim(attackSpeed * scale)}/s`;
    case 'dps':
      return trim((def.damage ?? 0) * attackSpeed * scale);
    case 'moveSpeed':
      return `${trim((def.moveSpeed ?? 0) * scale, 2)} t/s`;
    case 'range':
      return (def.range ?? 0) < RANGED_MIN_TILES ? 'melee' : `${trim(def.range ?? 0)} tiles`;
  }
}

/**
 * What the selected-unit panel says about a unit. See buildBar.ts for where it
 * is drawn.
 *
 * Separate from the panel because the panel cannot be built without a canvas to
 * measure text against, and this is the part with decisions in it.
 */

import type { GameData, MonsterDef, UnitDef } from '../../data/schema.ts';
import { refId } from '../../data/schema.ts';
import { RANGED_MIN_TILES } from '../attackStyle.ts';

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
 * One stat, as `now` or `now → then` - the arrow only where the tier actually
 * changes it, so what an upgrade buys is what stands out.
 */
export function statText(key: StatKey, current: UnitDef, next: UnitDef | null): string {
  const now = reading(key, current);
  const then = next ? reading(key, next) : null;
  const body = then === null || then === now ? now : `${now} → ${then}`;
  // The unit goes on the outside, so a change reads "2.4 → 2.6 tiles" rather
  // than saying "tiles" twice about one number.
  return body + unitFor(key, current);
}

function reading(key: StatKey, def: UnitDef): string {
  const damage = def.damage ?? 0;
  const attackSpeed = def.attackSpeed ?? 0;
  switch (key) {
    case 'hp':
      return String(Math.round(def.hp ?? 0));
    case 'damage':
      return String(Math.round(damage));
    case 'attackSpeed':
      return trim(attackSpeed);
    case 'dps':
      return trim(damage * attackSpeed);
    case 'moveSpeed':
      // Two decimals: every unit in the game walks between 0.2 and 0.65 tiles a
      // second, so one decimal rounds most of a tier's gain away.
      return trim(def.moveSpeed ?? 0, 2);
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
 * The ability lines for the panel: what this unit does, and what the next tier
 * would add.
 *
 * Every unit has an ability (units.json), so this block is never empty and the
 * panel can rely on it. It is also the one place a player reads what they are
 * buying, which is why the wording comes from `abilities.json` rather than from
 * here: the ability's own `text` is authored beside its numbers, and
 * `validate.ts` refuses an ability whose effects the simulation does not
 * honour - so a line here always describes a rule the unit actually has.
 *
 * The next tier is summarised rather than restated. A tier usually keeps its
 * signature and raises one figure, which reads as "improved"; when it unlocks
 * something new, the new thing is worth the whole line.
 */
export function abilityLines(data: GameData, current: UnitDef, next: UnitDef | null): string[] {
  const lines: string[] = [];
  const held = new Set<string>();

  for (const ref of current.abilities ?? []) {
    const ability = data.abilities.abilities.find((a) => a.id === refId(ref));
    if (!ability) continue;
    held.add(ability.id);
    lines.push(`${ability.name} — ${ability.text}`);
  }

  if (!next) return lines;

  for (const ref of next.abilities ?? []) {
    const id = refId(ref);
    const ability = data.abilities.abilities.find((a) => a.id === id);
    if (!ability) continue;
    // A NEW ability is worth a line; the same one with a bigger number is not
    // - "Kindle, improved" tells a player nothing they can act on, and the
    // stat block above already shows what the tier moves.
    if (!held.has(id)) lines.push(`Next tier · ${ability.name} — ${ability.text}`);
  }
  return lines;
}

/** The same lines with the descriptions stripped, for a panel with no room. */
export function briefAbilityLines(
  data: GameData,
  current: UnitDef,
  next: UnitDef | null,
): string[] {
  return briefLines(abilityLines(data, current, next));
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
 * A monster's stat cells. The same six readings as a unit's, minus the tier
 * comparison a monster has no use for.
 *
 * Separate from `statText` rather than folded into it because the two take
 * different definitions and the shared version would be a function of a union
 * that branches on every line. Six identical strings are cheaper to read.
 */
export function monsterStatText(key: StatKey, def: MonsterDef): string {
  const damage = def.damage ?? 0;
  const attackSpeed = def.attackSpeed ?? 0;
  switch (key) {
    case 'hp':
      return String(Math.round(def.hp ?? 0));
    case 'damage':
      return String(Math.round(damage));
    case 'attackSpeed':
      return `${trim(attackSpeed)}/s`;
    case 'dps':
      return trim(damage * attackSpeed);
    case 'moveSpeed':
      return `${trim(def.moveSpeed ?? 0, 2)} t/s`;
    case 'range':
      return (def.range ?? 0) < RANGED_MIN_TILES ? 'melee' : `${trim(def.range ?? 0)} tiles`;
  }
}

/**
 * What a monster does, for the panel that opens when one is tapped.
 *
 * Most monsters do nothing special, and saying so is the answer to the
 * question the tap asked. A blank block would read as a panel that failed to
 * load.
 */
export function monsterAbilityLines(data: GameData, def: MonsterDef): string[] {
  const lines = (def.abilities ?? [])
    .map((ref) => data.abilities.abilities.find((a) => a.id === refId(ref)))
    .filter((ability): ability is NonNullable<typeof ability> => ability !== undefined)
    .map((ability) => `${ability.name} — ${ability.text}`);

  return lines.length > 0 ? lines : ['Nothing special. It walks at you and hits things.'];
}

/** Any ability lines with their descriptions stripped, for a panel with no room. */
export function briefLines(lines: string[]): string[] {
  return lines.map((line) => line.split(' — ')[0] ?? line);
}

/**
 * What the selected-unit panel says about a unit. See buildBar.ts for where it
 * is drawn.
 *
 * Separate from the panel because the panel cannot be built without a canvas to
 * measure text against, and this is the part with decisions in it.
 */

import type { GameData, UnitDef } from '../../data/schema.ts';
import { refId, refRank } from '../../data/schema.ts';
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
  const held = new Map<string, number>();

  for (const ref of current.abilities ?? []) {
    const ability = data.abilities.abilities.find((a) => a.id === refId(ref));
    if (!ability) continue;
    held.set(ability.id, refRank(ref));
    lines.push(`${ability.name} — ${ability.text}`);
  }

  if (!next) return lines;

  for (const ref of next.abilities ?? []) {
    const id = refId(ref);
    const ability = data.abilities.abilities.find((a) => a.id === id);
    if (!ability) continue;
    const before = held.get(id);
    if (before === undefined) {
      lines.push(`Next tier · ${ability.name} — ${ability.text}`);
    } else if (refRank(ref) > before) {
      lines.push(`Next tier · ${ability.name}, improved`);
    }
  }
  return lines;
}

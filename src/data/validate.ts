/**
 * Turns raw JSON into a `GameData` bundle and reports what is still unfilled.
 *
 * This is deliberately not a schema validator library. The point is a readable
 * list of "which numbers does DESIGN.md still owe us", so a half-filled data
 * set fails with a to-do list instead of a stack trace ten frames into a tick.
 */

import type { ArmourType, GameData } from './schema.ts';
import { SHAPE_FAMILY } from './schema.ts';

export interface DataReport {
  /** Dotted paths whose value is still `null`, e.g. `economy.startingGold`. */
  missing: string[];
  /** Things that are wrong rather than merely absent. */
  errors: string[];
  /** Expected-for-now gaps worth seeing but not worth failing on. */
  notes: string[];
}

// Keys that carry prose for whoever edits the JSON, not data for the sim.
const IGNORED_KEYS = new Set([
  '_comment',
  '_open',
  '_clockNote',
  '_decided',
  '_armourNote',
  '_roster',
  '_todo',
  '_note',
]);

/** Every dotted path under `value` whose leaf is `null`. */
function collectNulls(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectNulls(item, `${path}[${i}]`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (IGNORED_KEYS.has(key)) continue;
      collectNulls(child, path ? `${path}.${key}` : key, out);
    }
  }
}

/**
 * DESIGN.md §6: every row and every column of the matrix sums to 4.1, so no
 * damage type is globally stronger. Worth checking on load - it is the one
 * balance invariant the design states outright, and it is easy to break while
 * hand-editing JSON on a phone.
 */
function checkMatrix(data: GameData, errors: string[]): void {
  const { damageTypes, armourTypes, multipliers } = data.matrix;
  const EXPECTED = 4.1;
  const EPSILON = 1e-9;

  for (const dmg of damageTypes) {
    const row = multipliers[dmg];
    if (!row) {
      errors.push(`matrix.multipliers.${dmg} is missing`);
      continue;
    }
    const sum = armourTypes.reduce((acc, arm) => acc + (row[arm] ?? 0), 0);
    if (Math.abs(sum - EXPECTED) > EPSILON) {
      errors.push(`matrix row '${dmg}' sums to ${sum}, expected ${EXPECTED} (§6)`);
    }
  }

  for (const arm of armourTypes) {
    const sum = damageTypes.reduce((acc, dmg) => acc + (multipliers[dmg]?.[arm] ?? 0), 0);
    if (Math.abs(sum - EXPECTED) > EPSILON) {
      errors.push(`matrix column '${arm}' sums to ${sum}, expected ${EXPECTED} (§6)`);
    }
  }
}

/**
 * DESIGN.md §6.1: every builder must cover all four damage types across its six
 * units, or it simply loses the wave that counters it.
 *
 * A half-built roster failing this is expected, not broken - builder A is three
 * units in at M1 - so the rule is an ERROR only for builders marked complete,
 * and a NOTE for the rest. Flipping `complete` to true is what arms it.
 */
function checkBuilderCoverage(data: GameData, errors: string[], notes: string[]): void {
  for (const builder of data.units.builders) {
    const owned = data.units.units.filter((u) => u.builderId === builder.id);
    if (owned.length === 0) continue;

    const covered = new Set(owned.map((u) => u.damageType));
    const gaps = data.matrix.damageTypes.filter((t) => !covered.has(t));
    if (gaps.length === 0) continue;

    const message = `builder '${builder.id}' has no ${gaps.join('/')} unit (§6.1 coverage rule)`;
    if (builder.complete) {
      errors.push(message);
    } else {
      notes.push(`${message} - roster incomplete, so not yet enforced`);
    }
  }
}

/** Every monster named in a wave must actually exist (§9.2). */
function checkWaveReferences(data: GameData, errors: string[]): void {
  const known = new Set([
    ...data.monsters.monsters.map((m) => m.id),
    ...data.monsters.bosses.map((m) => m.id),
  ]);
  for (const wave of data.waves.composition) {
    for (const entry of wave.entries) {
      if (!known.has(entry.monsterId)) {
        errors.push(`wave ${wave.wave} references unknown monster '${entry.monsterId}'`);
      }
    }
  }
  for (const id of data.waves.bossBank) {
    if (!known.has(id)) errors.push(`bossBank references unknown monster '${id}'`);
  }
}

/** A tier upgrade must point at a unit that exists (§7.3). */
function checkUpgradeChain(data: GameData, errors: string[]): void {
  const known = new Set(data.units.units.map((u) => u.id));
  for (const unit of data.units.units) {
    if (unit.upgradesTo && !known.has(unit.upgradesTo)) {
      errors.push(`unit '${unit.id}' upgrades to unknown unit '${unit.upgradesTo}'`);
    }
  }
}

/**
 * Every body on the field has its own silhouette, and it is in its armour's
 * family. §14.2, amended - see `ShapeId` in schema.ts.
 *
 * Checked on load for the same reason the matrix is: it is an invariant that
 * is trivial to break while hand-editing JSON - copy a unit, forget to change
 * its shape - and the failure is silent on screen. Two hexagons do not look
 * wrong; they just stop telling you which is which.
 */
function checkShapes(data: GameData, errors: string[]): void {
  const families = SHAPE_FAMILY as Record<string, ArmourType | undefined>;
  const monsters = [...data.monsters.monsters, ...data.monsters.bosses];
  const byId = new Map(data.units.units.map((u) => [u.id, u]));

  // The right family, and a shape that exists at all - JSON cannot spell-check.
  for (const body of [...data.units.units, ...monsters]) {
    const family = families[body.shape];
    if (family === undefined) {
      errors.push(`'${body.id}' has unknown shape '${body.shape}'`);
    } else if (family !== body.armour) {
      errors.push(
        `'${body.id}' is ${body.armour} but its shape '${body.shape}' is a ${family} silhouette (§14.2)`,
      );
    }
  }

  // An upgrade is the same unit (§7.3), so it keeps the same silhouette.
  for (const unit of data.units.units) {
    const next = unit.upgradesTo ? byId.get(unit.upgradesTo) : undefined;
    if (next && next.shape !== unit.shape) {
      errors.push(
        `'${unit.id}' is '${unit.shape}' but upgrades to '${next.id}' which is '${next.shape}' - a tier keeps its shape (§7.3)`,
      );
    }
  }

  // One silhouette per body. Tiers of one unit share theirs on purpose, so only
  // the base of each chain counts; monsters and units share a field, so they
  // are checked against each other as well.
  const owners = new Map<string, string>();
  const claim = (shape: string, owner: string): void => {
    const other = owners.get(shape);
    if (other) {
      errors.push(
        `shape '${shape}' is used by both '${other}' and '${owner}' - every body on the field has its own silhouette (§14.2)`,
      );
    } else {
      owners.set(shape, owner);
    }
  };
  for (const unit of data.units.units) if (unit.tier === 1) claim(unit.shape, unit.id);
  for (const monster of monsters) claim(monster.shape, monster.id);
}

/** Assembles the bundle and reports its gaps. Never throws. */
export function validateData(raw: Record<string, unknown>): {
  data: GameData;
  report: DataReport;
} {
  const data = raw as unknown as GameData;
  const missing: string[] = [];
  const errors: string[] = [];
  const notes: string[] = [];

  collectNulls(raw, '', missing);
  checkMatrix(data, errors);
  checkBuilderCoverage(data, errors, notes);
  checkWaveReferences(data, errors);
  checkUpgradeChain(data, errors);
  checkShapes(data, errors);

  return { data, report: { missing, errors, notes } };
}

/** Human-readable summary for the headless runner and the dev console. */
export function formatReport(report: DataReport): string {
  const lines: string[] = [];
  if (report.errors.length > 0) {
    lines.push(`${report.errors.length} data error(s):`);
    for (const e of report.errors) lines.push(`  ✗ ${e}`);
  }
  if (report.missing.length > 0) {
    lines.push(`${report.missing.length} value(s) still unfilled:`);
    for (const m of report.missing) lines.push(`  · ${m}`);
  }
  if (report.notes.length > 0) {
    lines.push(`${report.notes.length} note(s):`);
    for (const n of report.notes) lines.push(`  ~ ${n}`);
  }
  if (lines.length === 0) lines.push('Data complete.');
  return lines.join('\n');
}

/**
 * Lookup index over the JSON definitions.
 *
 * Built once per match rather than searched per tick - DESIGN.md §15.3 forbids
 * per-frame work that can be precomputed.
 */

import type { GameData, MonsterDef, SendDef, UnitDef } from '../data/schema.ts';

export interface DefIndex {
  units: Map<string, UnitDef>;
  monsters: Map<string, MonsterDef>;
  sends: Map<string, SendDef>;
}

export function buildDefIndex(data: GameData): DefIndex {
  const monsters = new Map<string, MonsterDef>();
  for (const m of data.monsters.monsters) monsters.set(m.id, m);
  for (const b of data.monsters.bosses) monsters.set(b.id, b);

  return {
    units: new Map(data.units.units.map((u) => [u.id, u])),
    monsters,
    sends: new Map(data.sends.sends.map((s) => [s.id, s])),
  };
}

/** Stat reads go through here so a null never reaches arithmetic silently. */
export function stat(value: number | null): number {
  return value ?? 0;
}

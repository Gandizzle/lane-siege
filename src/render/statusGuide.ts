/**
 * What causes each kind of status marker, worked out from the data rather than
 * written down, for the effects guide (ui/effectsPanel.ts).
 *
 * Every ability in `abilities.json` is sorted by the same rule the board uses
 * (`markOfEffect`, sim/statusMarks.ts), and every unit, monster, boss and send
 * that carries one is listed as a source. So a new ability shows up under the
 * right marker the moment a unit carries it, and a retuned one moves if its
 * effect changes kind - nobody has to remember to update a list.
 *
 * Left out, as on the board: a passive that only ever lands on its own
 * carrier. That is a trait and shows no marker, so listing it under one would
 * send a player looking for something that is never drawn.
 */

import type { AbilityDef, AbilityRef, GameData, UnitDef } from '../data/schema.ts';
import { refId, resolveAbility } from '../data/schema.ts';
import { STATUS_MARKS, markOfEffect, type StatusMark } from '../sim/index.ts';

export interface Cause {
  /** The ability's own name. */
  ability: string;
  /** Who can use it: "Ember (Pyre)", "Grub", "Brood Sire (boss)", "Warden (send)". */
  owners: string[];
}

/** Which abilities can put each kind of marker on a body, and who has them. */
export function causesByMark(data: GameData): Record<StatusMark, Cause[]> {
  const owners = ownersByAbility(data);
  const out = Object.fromEntries(STATUS_MARKS.map((m) => [m, [] as Cause[]])) as Record<
    StatusMark,
    Cause[]
  >;

  for (const def of data.abilities.abilities) {
    const who = owners.get(def.id);
    // Written but not carried by anything yet: nothing in a match can cause it.
    if (!who || who.length === 0) continue;
    for (const mark of marksOf(def)) out[mark].push({ ability: def.name, owners: who });
  }
  for (const mark of STATUS_MARKS) out[mark].sort((a, b) => a.ability.localeCompare(b.ability));
  return out;
}

/** The kinds of marker one ability can leave, each once. */
export function marksOf(def: AbilityDef): StatusMark[] {
  const ability = resolveAbility(def, 1);
  // A passive aimed at nothing but its carrier is a trait: no marker, ever.
  if (ability.trigger.when === 'passive' && ability.target.what === 'self') return [];
  const marks = new Set<StatusMark>();
  for (const effect of ability.effects) {
    const mark = markOfEffect(effect);
    if (mark) marks.add(mark);
  }
  return [...marks];
}

/**
 * Every ability id, with the names of what carries it.
 *
 * A unit line is named once, at the lowest mark that has the ability - "Ember"
 * for Kindle, which every Ember has, but "Ember III" for Conflagration, which
 * only the top of the line gets.
 */
function ownersByAbility(data: GameData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (abilityId: string, who: string) => {
    const list = out.get(abilityId) ?? [];
    if (!list.includes(who)) list.push(who);
    out.set(abilityId, list);
  };
  const ids = (refs: AbilityRef[] | undefined) => (refs ?? []).map(refId);

  const builderName = new Map(data.units.builders.map((b) => [b.id, b.name]));
  const byId = new Map(data.units.units.map((u) => [u.id, u]));
  const upgraded = new Set(data.units.units.map((u) => u.upgradesTo).filter(Boolean));
  for (const first of data.units.units) {
    if (upgraded.has(first.id)) continue;
    // Walk the line from its first mark, naming each ability where it appears.
    const seen = new Set<string>();
    for (let unit: UnitDef | undefined = first; unit; unit = byId.get(unit.upgradesTo ?? '')) {
      for (const id of ids(unit.abilities)) {
        if (seen.has(id)) continue;
        seen.add(id);
        add(id, `${unit.name} (${builderName.get(unit.builderId) ?? unit.builderId})`);
      }
      if (unit.upgradesTo === unit.id) break;
    }
  }
  for (const monster of data.monsters.monsters) {
    for (const id of ids(monster.abilities)) add(id, monster.name);
  }
  for (const boss of data.monsters.bosses) {
    for (const id of ids(boss.abilities)) add(id, `${boss.name} (boss)`);
  }
  for (const send of data.sends.sends) {
    for (const id of ids(send.abilities)) add(id, `${send.name} (send)`);
  }
  return out;
}

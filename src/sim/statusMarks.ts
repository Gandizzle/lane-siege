/**
 * Which of a body's statuses a player can SEE, sorted into the few kinds the
 * renderer draws a marker for (render/statusMarks.ts).
 *
 * The simulation knows what every status is; the view sends a bitmask of
 * kinds rather than the statuses themselves, because what the screen needs is
 * "this body is burning", not whose burn it is or how long it has left - and a
 * mask is one number per affected body on the wire (protocol.ts).
 *
 * WHAT IS LEFT OUT
 *
 * A body's own passives. A Carapace's plated shell and a Sentinel's parry are
 * what those bodies ARE, not something happening to them, and marking them
 * would put a permanent badge on every one of them and bury the marks that
 * mean something changed. A passive reaching a DIFFERENT body is kept: a
 * neighbour's aura, or an enemy's dampening field slowing your line, is
 * exactly the kind of thing a player needs to see is landing.
 *
 * Everything else is kept: every timed effect, from any source, including a
 * body's own triggered ones (a Stoke, a Brood Surge), which are events.
 */

import type { ControlKind, DamageType, ResolvedEffect, StatKey } from '../data/schema.ts';
import type { Afflicted } from './status.ts';

/**
 * The kinds, in bit order. Append only: the order is the wire format, so a
 * reorder would make an old replay draw the wrong markers.
 *
 * A kind added here also needs `markOf` below to produce it, and an entry in
 * `MARK_INFO` (render/statusMarks.ts) - the compiler insists on that one -
 * which is what draws it and explains it in the effects guide.
 */
export const STATUS_MARKS = [
  /** A blast damage-over-time: Pyre's embers and fires. */
  'burning',
  /** Any other damage-over-time: spores, blight. */
  'blighted',
  /** Moving or attacking slower. */
  'slowed',
  /** Cannot move. */
  'rooted',
  /** Cannot act: stunned, or any other control that stops a body. */
  'stunned',
  /** Made to fight the one that taunted it. */
  'taunted',
  /** A ward that eats attacks. */
  'shielded',
  /** Healing over time. */
  'regenerating',
  /** Hitting harder or faster, or moving faster. */
  'empowered',
  /** Hitting softer, taking more, or healed less. */
  'weakened',
  /** Taking less, dodging, reflecting, or immune to something. */
  'fortified',
] as const;

export type StatusMark = (typeof STATUS_MARKS)[number];

export function markBit(mark: StatusMark): number {
  return 1 << STATUS_MARKS.indexOf(mark);
}

export function hasMark(marks: number, mark: StatusMark): boolean {
  return (marks & markBit(mark)) !== 0;
}

/**
 * What deciding a marker needs of an effect: a status on a body and an effect
 * in `abilities.json` both have it, so the board and the catalogue of what
 * causes each marker (render/statusGuide.ts) sort with the same rule.
 */
export interface MarkSource {
  kind: string;
  stat: StatKey | null;
  amount: number;
  damageType: DamageType | null;
  tag: string | null;
  blocks: number;
  control: ControlKind | null;
}

/** The kind of marker one status shows, or null for one that shows nothing. */
export function markOf(status: MarkSource): StatusMark | null {
  switch (status.kind) {
    case 'damageOverTime':
      return status.damageType === 'blast' || status.tag === 'burning' ? 'burning' : 'blighted';
    case 'regen':
      return 'regenerating';
    case 'shield':
      return status.blocks > 0 ? 'shielded' : null;
    case 'immunity':
      return 'fortified';
    case 'control':
      if (status.control === 'root') return 'rooted';
      if (status.control === 'taunt') return 'taunted';
      return status.control === null ? null : 'stunned';
    case 'modify': {
      if (status.stat === null || status.amount === 0) return null;
      // Every amount is a signed change - a fraction for a percentage, the
      // stat's own units for a flat - so its sign is its direction.
      const up = status.amount > 0;
      switch (status.stat) {
        case 'moveSpeed':
        case 'attackSpeed':
          return up ? 'empowered' : 'slowed';
        case 'damageDealt':
        case 'critChance':
        case 'critDamage':
        case 'lifesteal':
        case 'energyRegen':
          return up ? 'empowered' : 'weakened';
        case 'damageTaken':
          return up ? 'weakened' : 'fortified';
        case 'healingTaken':
          return up ? 'regenerating' : 'weakened';
        case 'evasion':
        case 'maxHealth':
        case 'reflect':
          return up ? 'fortified' : 'weakened';
      }
    }
  }
  return null;
}

/**
 * The marker an ability's effect will leave, as written in the data, or null
 * for one that leaves none (instant damage, a heal, energy).
 */
export function markOfEffect(effect: ResolvedEffect): StatusMark | null {
  return markOf({ ...effect, tag: effect.appliesTag });
}

/**
 * Every kind of marker a body should show, as bits.
 *
 * `isPassive` answers whether an ability fires on its own every tick; a
 * status from one of those that the body put on ITSELF is a trait, and is left
 * out (see the note at the top).
 */
export function statusMarks(body: Afflicted, isPassive: (abilityId: string) => boolean): number {
  let marks = 0;
  for (const status of body.statuses) {
    if (status.sourceId === body.id && isPassive(status.abilityId)) continue;
    const mark = markOf(status);
    if (mark) marks |= markBit(mark);
  }
  return marks;
}

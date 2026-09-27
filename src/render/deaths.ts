/**
 * Which bodies died between two views of one board.
 *
 * The view only says what is there, so a death is a body that was in the last
 * view and is not in this one. Shared by the pop a death leaves (effects.ts)
 * and the sound it makes (src/audio/cues.ts), so the two cannot disagree about
 * what died.
 */

import type { EntityView, LaneView } from '../sim/index.ts';

/**
 * Which disappearances are deaths.
 *
 *   `all`      - anything that leaves the board died (a lane in combat, the
 *                Final Showdown).
 *   `monsters` - a unit leaving in the build phase was SOLD, and a sale is not
 *                a death; a monster only ever leaves by dying.
 *   `none`     - nothing leaving means anything: the armies walking out of
 *                their lanes into the showdown, say.
 */
export type DeathRule = 'all' | 'monsters' | 'none';

export interface Deaths {
  monsters: EntityView[];
  units: EntityView[];
}

/**
 * The bodies in `outgoing` that are gone from `incoming`, as they were last
 * seen.
 *
 * Only when both views are of the SAME board: switching which lane is on screen
 * swaps every body at once, and none of them died.
 */
export function findDeaths(incoming: LaneView, outgoing: LaneView | null, rule: DeathRule): Deaths {
  const deaths: Deaths = { monsters: [], units: [] };
  if (!outgoing || rule === 'none' || outgoing.teamId !== incoming.teamId) return deaths;

  const present = new Set<number>();
  for (const body of incoming.units) present.add(body.id);
  for (const body of incoming.monsters) present.add(body.id);

  for (const monster of outgoing.monsters) {
    if (!present.has(monster.id)) deaths.monsters.push(monster);
  }
  if (rule === 'all') {
    for (const unit of outgoing.units) {
      if (!present.has(unit.id)) deaths.units.push(unit);
    }
  }
  return deaths;
}

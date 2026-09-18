/**
 * What a send button says, and who it is aimed at. DESIGN.md §11.5, §14.2.
 *
 * Pure, because both of these are rules rather than pixels and both are worth
 * pinning down: a send button carrying the wrong silhouette teaches the player
 * something false, and a random target that can pick a dead lane throws gems
 * away.
 *
 * WHY THE MONSTER'S OWN SHAPE
 *
 * A send IS a pack of monsters (§11.5) - `grub_pack` puts five grubs in
 * somebody's next wave - so the honest icon for it is the grub. That is also
 * the useful one: it is the same silhouette, in the same armour family, in the
 * same damage-type fill that §14.2 draws in the lane, in the wave preview and
 * on a unit button. A player who learns "hexagon means plate, and that one is
 * a Husk" learns it once and reads it everywhere. A send-only shape vocabulary
 * would be five more shapes that appear nowhere else.
 *
 * The button therefore carries the send's name, the monster's name, what that
 * monster will DO, and the monster's silhouette - "Plated Push / Husk ·
 * Siegework" over a hexagon.
 *
 * WHY AN ABILITY NAME AND NOT A COUNT
 *
 * A send delivers one monster (sends.json), so a count would say "1x" on every
 * button in the tab. The line is better spent on the thing a player actually
 * has to weigh: a Husk that arrives braced is a different purchase from a Husk,
 * and the ability's name is the shorthand for it. The send's OWN ability comes
 * first when it has one, because that is what the send adds over the monster
 * walking in with a wave; otherwise the monster's own. The full wording is one
 * tap away - a monster in the lane can be selected and read (buildBar.ts).
 */

import type { AbilityRef, GameData, MonsterDef } from '../../data/schema.ts';
import { refId } from '../../data/schema.ts';
import type { OpponentView } from '../../sim/index.ts';
import type { EntityStyle } from '../shapes.ts';

/** Everything a send button draws about what it throws. */
export interface SendIcon {
  /** The body, drawn by the same `drawEntity` the lane uses. */
  style: EntityStyle;
  /** The monster's own name, so the shape has a word attached to it. */
  monsterName: string;
  /** How many of them the send delivers. One, today. */
  count: number;
  /** What it does when it gets there, or null for a body that just walks. */
  abilityName: string | null;
}

/**
 * The icon for one send, or null if its monsters are not in `data`.
 *
 * The FIRST monster in the pack. Every send in `sends.json` is a pack of one
 * kind, and a mixed one would need a different button rather than a different
 * icon - so taking the first is not a guess, it is the shape of the data.
 */
export function sendIcon(data: GameData, sendId: string): SendIcon | null {
  const send = data.sends.sends.find((s) => s.id === sendId);
  if (!send) return null;

  const first = send.monsters[0];
  if (first === undefined) return null;
  const monster: MonsterDef | undefined = [...data.monsters.monsters, ...data.monsters.bosses].find(
    (m) => m.id === first,
  );
  if (!monster) return null;

  return {
    // Outlined, because it is a monster (§14.2), and tier 1 because monsters
    // have no tiers.
    style: { shape: monster.shape, damageType: monster.damageType, tier: 1, outlined: true },
    monsterName: monster.name,
    count: send.monsters.length,
    abilityName: sendAbilityName(data, send.abilities, monster.abilities),
  };
}

/**
 * The one ability worth putting on a send button: the send's, or the
 * monster's.
 *
 * The send's first. `plated_push` grants Siegework to a husk that has nothing
 * of its own, and that IS the purchase; `ward_raid` grants Raider's Haste to a
 * Revenant that is already Unhallowed, and the haste is what the gems bought.
 * Where the send grants nothing, the monster's own ability is still worth
 * naming - a Bloater ruptures whether or not anybody paid for it.
 */
function sendAbilityName(
  data: GameData,
  sendAbilities: AbilityRef[] | undefined,
  monsterAbilities: AbilityRef[] | undefined,
): string | null {
  const first = (sendAbilities ?? [])[0] ?? (monsterAbilities ?? [])[0];
  if (first === undefined) return null;
  return data.abilities.abilities.find((a) => a.id === refId(first))?.name ?? null;
}

/**
 * What makes two icons the same picture, for the check that no two sends draw
 * the same one.
 *
 * Shape and fill, which are the two channels §14.2 spends on a monster. Two
 * sends that agreed on both would be two buttons a player cannot tell apart.
 */
export function sendIconKey(icon: SendIcon): string {
  return `${icon.style.shape}:${icon.style.damageType}`;
}

/**
 * Who this send is actually going to, or null if nobody can be sent at.
 *
 * `atRandom` spreads sends across the table instead of stacking them on one
 * player - useful when the leader is not obvious, and the only way to pressure
 * three lanes at once without three taps per send. Drawn from the LIVING
 * opponents each time, so it can never aim at somebody who is already out
 * (§13: eliminated lanes take no more monsters, and the simulation would
 * refuse it anyway).
 *
 * `random` is passed in rather than taken from `Math.random`, so the rule is
 * testable. It is a UI choice either way: the command that leaves here names a
 * concrete lane, which is what keeps the simulation deterministic (§15.1).
 */
export function pickSendTarget(
  opponents: readonly OpponentView[],
  chosen: string | null,
  atRandom: boolean,
  random: () => number,
): string | null {
  const living = opponents.filter((o) => !o.eliminated);
  if (living.length === 0) return null;

  if (atRandom) {
    const index = Math.min(living.length - 1, Math.max(0, Math.floor(random() * living.length)));
    return living[index]!.teamId;
  }
  return living.some((o) => o.teamId === chosen) ? chosen : null;
}

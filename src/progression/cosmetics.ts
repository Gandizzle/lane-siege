/**
 * Cosmetics: which ones a player has, and which they have switched on.
 *
 * THE RULE THAT DOES NOT BEND
 *
 * Nothing here touches what §14.2 spends on information. Silhouette is armor,
 * fill is damage type, size and pips are mark, and a player reading a crowd at
 * a glance must be able to trust all of them on everybody's screen. So a
 * cosmetic is decoration around the fight - a title, a badge, a fortress's
 * stonework, a trail, a floor, a flourish at the end - and never a change to a
 * body.
 *
 * HAVING ONE, AND WEARING IT
 *
 * A cosmetic is unlocked by any one of the ways its data lists (`Unlock`):
 * everybody has it, a level reached, Supporter, Founder, or keys spent on it.
 * Titles, and the badges that mean something, come by what they mean; the
 * rest cost keys, which every level pays (progression.json) - and nothing is
 * bought with money. Once unlocked a cosmetic can be switched on or off. In a
 * slot that holds one at a time (a title, a fortress) switching one on
 * switches the others off; badges are worn together. A cosmetic switched on
 * and later locked again - Supporter undone, say - simply stops counting, and
 * comes back with the unlock.
 *
 * Keys are only spent on what the game can draw: a slot it does not draw yet
 * is "coming soon", and nothing in it can be unlocked until it is (`forSale`).
 */

import type { Cosmetic, CosmeticSlot, CosmeticsConfig } from './config.ts';

/** What unlocking reads off a player. */
export interface Holder {
  level: number;
  /** Has a Supporter's perks: bought, or as a Founder. */
  supporter: boolean;
  founder: boolean;
  /** What keys have unlocked, by id. */
  unlocked: readonly string[];
}

export function slotOf(config: CosmeticsConfig, cosmetic: Cosmetic): CosmeticSlot | null {
  return config.slots.find((s) => s.id === cosmetic.slot) ?? null;
}

export function cosmeticById(config: CosmeticsConfig, id: string): Cosmetic | null {
  return config.cosmetics.find((c) => c.id === id) ?? null;
}

export function isUnlocked(cosmetic: Cosmetic, holder: Holder): boolean {
  const u = cosmetic.unlock;
  if (u.free) return true;
  if (u.level !== null && holder.level >= u.level) return true;
  if (u.supporter && holder.supporter) return true;
  if (u.founder && holder.founder) return true;
  if (u.keys !== null && holder.unlocked.includes(cosmetic.id)) return true;
  return false;
}

/** Whether keys can unlock it now: it has a cost, and its slot is drawn. */
export function forSale(config: CosmeticsConfig, cosmetic: Cosmetic): boolean {
  return cosmetic.unlock.keys !== null && (slotOf(config, cosmetic)?.live ?? false);
}

/** "1 key", "3 keys". */
export function keyCount(n: number): string {
  return `${n} ${n === 1 ? 'key' : 'keys'}`;
}

/**
 * How to get one, in a few words, for a locked card. `founders` is who becomes
 * one (store.json), said in place of the bare word when it is known.
 */
export function howToUnlock(
  cosmetic: Cosmetic,
  founders?: { count: number; level: number },
): string {
  const u = cosmetic.unlock;
  const ways: string[] = [];
  if (u.free) ways.push('Everyone has this');
  if (u.level !== null) ways.push(`Reach level ${u.level}`);
  if (u.supporter) ways.push('For Supporters');
  if (u.founder) {
    ways.push(founders ? `First ${founders.count} to level ${founders.level}` : 'For Founders');
  }
  if (u.keys !== null) ways.push(keyCount(u.keys));
  return ways.join(' · ');
}

/**
 * The enabled list after switching `cosmetic` on or off. Switching one on in a
 * one-at-a-time slot switches the rest of that slot off.
 */
export function setEnabled(
  config: CosmeticsConfig,
  enabled: readonly string[],
  cosmetic: Cosmetic,
  on: boolean,
): string[] {
  const rest = enabled.filter((id) => id !== cosmetic.id);
  if (!on) return rest;
  const exclusive = slotOf(config, cosmetic)?.exclusive ?? true;
  const kept = exclusive
    ? rest.filter((id) => cosmeticById(config, id)?.slot !== cosmetic.slot)
    : rest;
  return [...kept, cosmetic.id];
}

/** What is being worn in `slotId`: switched on, and still unlocked. */
export function wornIn(
  config: CosmeticsConfig,
  enabled: readonly string[],
  slotId: string,
  holder: Holder,
): Cosmetic[] {
  return config.cosmetics.filter(
    (c) => c.slot === slotId && enabled.includes(c.id) && isUnlocked(c, holder),
  );
}

/**
 * What a player has earned and owns across matches: their XP, the boosts they
 * have going, how much of today's practice allowance is spent, and what they
 * have bought and switched on.
 *
 * Kept on the device for now (store.ts), which makes all of it a claim rather
 * than a fact - exactly as strong as the player id it sits beside
 * (net/identity.ts). That is fine while the only thing a level buys is the
 * right to show it off, and it is why the shape is plain data: when there is a
 * server to award XP and record purchases, this record moves there unchanged
 * and the device keeps a copy.
 *
 * Read back field by field, like the preferences, so a field added later
 * defaults in rather than throwing an old save away.
 */

/** A calendar day on this device, as `YYYY-MM-DD`. Daily limits reset when it changes. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface Profile {
  /** Every point of XP ever earned. The level is worked out from it (levels.ts). */
  xp: number;
  /** The opt-in ad's boost: how many XP-earning matches it has left, and today's count. */
  adBoost: { matchesLeft: number; day: string; watched: number };
  /** Practice and solo games that have earned XP today. */
  casual: { day: string; games: number };
  /** Has bought Supporter (placeholder: nothing can be bought yet). */
  supporter: boolean;
  /** Store items owned: cosmetics, builders and bundles, by id. */
  owned: string[];
  /** Cosmetics switched on, by id. Only an unlocked one counts. */
  cosmetics: string[];
  /** Has opened the store, so its button stops saying NEW. */
  seenStore: boolean;
}

export const NEW_PROFILE: Profile = {
  xp: 0,
  adBoost: { matchesLeft: 0, day: '', watched: 0 },
  casual: { day: '', games: 0 },
  supporter: false,
  owned: [],
  cosmetics: [],
  seenStore: false,
};

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function day(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

export function parseProfile(raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) return structuredClone(NEW_PROFILE);
  const r = raw as Record<string, unknown>;
  const ad = (typeof r.adBoost === 'object' && r.adBoost !== null ? r.adBoost : {}) as Record<
    string,
    unknown
  >;
  const casual = (typeof r.casual === 'object' && r.casual !== null ? r.casual : {}) as Record<
    string,
    unknown
  >;
  return {
    xp: count(r.xp),
    adBoost: { matchesLeft: count(ad.matchesLeft), day: day(ad.day), watched: count(ad.watched) },
    casual: { day: day(casual.day), games: count(casual.games) },
    supporter: r.supporter === true,
    owned: ids(r.owned),
    cosmetics: ids(r.cosmetics),
    seenStore: r.seenStore === true,
  };
}

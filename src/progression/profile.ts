/**
 * What a player has earned across matches: their XP, the boosts they have
 * going, how much of today's practice allowance is spent, Supporter or
 * Founder, what their keys have unlocked, and what they have switched on.
 *
 * Kept on the device for now (store.ts), which makes all of it a claim rather
 * than a fact - exactly as strong as the player id it sits beside
 * (net/identity.ts). That is fine while what a level buys is a builder that
 * is no stronger than the starter and the right to show it off, and it is why
 * the shape is plain data: when there is a server to award XP and record a
 * purchase, this record moves there unchanged and the device keeps a copy.
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
  /** The opt-in ad's boost: how many XP-earning waves it has left. */
  adBoost: { wavesLeft: number };
  /** XP practice and solo have earned today, against the daily cap. */
  casual: { day: string; xp: number };
  /** Has bought Supporter (placeholder: nothing can be bought yet). */
  supporter: boolean;
  /**
   * One of the first players to reach the Founders' level (store.json,
   * founders): everything a Supporter has, free.
   */
  founder: boolean;
  /**
   * Which Founder: #1 for the first there, as the game server counted them.
   * Null for anyone else - and for a Founder from before they were numbered.
   */
  founderNumber: number | null;
  /** What keys have unlocked: a cosmetic by its id, a builder as `builder:<id>`. */
  unlocked: string[];
  /** Keys spent. What is left is what the levels have paid, less these. */
  keysSpent: number;
  /** Cosmetics switched on, by id. Only an unlocked one counts. */
  cosmetics: string[];
}

export const NEW_PROFILE: Profile = {
  xp: 0,
  adBoost: { wavesLeft: 0 },
  casual: { day: '', xp: 0 },
  supporter: false,
  founder: false,
  founderNumber: null,
  unlocked: [],
  keysSpent: 0,
  cosmetics: [],
};

/** A Supporter's perks: bought, or a Founder's for free. */
export function hasSupporterPerks(profile: Profile): boolean {
  return profile.supporter || profile.founder;
}

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
    // A save from when the boost was counted in matches has no waves, and
    // starts again from none.
    adBoost: { wavesLeft: count(ad.wavesLeft) },
    // A save from when practice paid by the game has no XP counted, and
    // starts the day afresh.
    casual: { day: day(casual.day), xp: count(casual.xp) },
    supporter: r.supporter === true,
    founder: r.founder === true,
    founderNumber:
      r.founder === true && typeof r.founderNumber === 'number' && r.founderNumber >= 1
        ? Math.floor(r.founderNumber)
        : null,
    // A save from when things were bought has an `owned` list instead. Only
    // the test build could fill it, and it is left behind.
    unlocked: ids(r.unlocked),
    keysSpent: count(r.keysSpent),
    cosmetics: ids(r.cosmetics),
  };
}

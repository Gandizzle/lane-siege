/**
 * The numbers progression runs on: data/progression.json, data/store.json and
 * data/cosmetics.json, read and checked once.
 *
 * Not part of `GameData` (src/data), on purpose. The simulation never sees any
 * of this: XP, levels, the store and cosmetics are about a player ACROSS
 * matches, and a match plays out the same whoever is in it and whatever they
 * own. Keeping them out of the bundle the simulation is built from is what
 * makes that true by construction rather than by care.
 *
 * Checked strictly, and loudly: a typo in a price file is a crash at start-up
 * with the field named, not a store that quietly shows "undefined".
 */

import progressionJson from '../../data/progression.json' with { type: 'json' };
import storeJson from '../../data/store.json' with { type: 'json' };
import cosmeticsJson from '../../data/cosmetics.json' with { type: 'json' };

/** XP to climb from level L to L + 1 is `first + step × (L − 1)`. */
export interface LevelCurve {
  first: number;
  step: number;
}

export interface ProgressionConfig {
  levels: LevelCurve;
  /** A normal match: see data/progression.json for what each one is for. */
  match: { played: number; perWave: number; placement: number[]; showdown: number };
  /** Practice and solo: paid as a normal match is, up to `dailyCap` XP a day. */
  casual: { dailyCap: number };
  /**
   * The opt-in ad's reward: `bonus` extra for the next `waves` waves that earn
   * XP. Offered before a game whenever fewer than `offerBelow` are left, so it
   * stacks, to `maxWaves` at most.
   */
  adBoost: { bonus: number; waves: number; offerBelow: number; maxWaves: number };
  supporter: { bonus: number };
}

export interface Bundle {
  id: string;
  name: string;
  blurb: string;
  price: string;
  /** What it would cost bought piece by piece, struck through beside the price. */
  was: string | null;
  /** Every builder, or these. */
  builders: 'all' | string[];
  cosmetics: string[];
  /** The banner at the top of the store. */
  featured: boolean;
}

export interface StoreConfig {
  builderPrice: string;
  /** Said under a builder's price while every builder is free. */
  builderNote: string;
  bundles: Bundle[];
  supporter: { price: string; pitch: string; perks: string[] };
}

/** The little shapes a badge is drawn as (ui/nameCard.ts). */
export const BADGE_GLYPHS = ['heart', 'shield', 'star'] as const;
export type BadgeGlyph = (typeof BADGE_GLYPHS)[number];

/** Ways a cosmetic is unlocked. Any one of them is enough. */
export interface Unlock {
  /** Everybody has it. */
  free: boolean;
  /** Reach this level. */
  level: number | null;
  /** Be a Supporter. */
  supporter: boolean;
  /** Buy it, alone or in a bundle. */
  store: boolean;
}

export interface CosmeticSlot {
  id: string;
  name: string;
  blurb: string;
  /** One at a time: switching one on switches the others in the slot off. */
  exclusive: boolean;
  /** Whether the game draws this slot yet. Off means "coming soon". */
  live: boolean;
}

export interface Cosmetic {
  id: string;
  slot: string;
  name: string;
  /** A badge's shape; null for anything that is not a badge. */
  glyph: BadgeGlyph | null;
  unlock: Unlock;
  /** Its own price in the store, or null when it only comes in a bundle or by playing. */
  price: string | null;
}

export interface CosmeticsConfig {
  slots: CosmeticSlot[];
  cosmetics: Cosmetic[];
}

// ------------------------------------------------------------------ reading

type Raw = Record<string, unknown>;

function object(value: unknown, at: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected an object`);
  }
  return value as Raw;
}

function number(value: unknown, at: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${at}: expected a number of at least ${min}`);
  }
  return value;
}

function integer(value: unknown, at: string, min = 0): number {
  const n = number(value, at, min);
  if (!Number.isInteger(n)) throw new Error(`${at}: expected a whole number`);
  return n;
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${at}: expected some text`);
  }
  return value;
}

function bool(value: unknown, at: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${at}: expected true or false`);
  return value;
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at}: expected a list`);
  return value;
}

export function parseProgression(raw: unknown): ProgressionConfig {
  const r = object(raw, 'progression');
  const levels = object(r.levels, 'progression.levels');
  const match = object(r.match, 'progression.match');
  const casual = object(r.casual, 'progression.casual');
  const ad = object(r.adBoost, 'progression.adBoost');
  const supporter = object(r.supporter, 'progression.supporter');
  const adWaves = integer(ad.waves, 'progression.adBoost.waves', 1);
  const maxWaves = integer(ad.maxWaves, 'progression.adBoost.maxWaves', 1);
  if (maxWaves < adWaves) {
    throw new Error('progression.adBoost.maxWaves: expected at least adBoost.waves');
  }
  const placement = list(match.placement, 'progression.match.placement').map((xp, i) =>
    integer(xp, `progression.match.placement[${i}]`),
  );
  if (placement.length === 0) throw new Error('progression.match.placement: expected a list');
  return {
    levels: {
      first: integer(levels.first, 'progression.levels.first', 1),
      step: integer(levels.step, 'progression.levels.step'),
    },
    match: {
      played: integer(match.played, 'progression.match.played'),
      perWave: integer(match.perWave, 'progression.match.perWave'),
      placement,
      showdown: integer(match.showdown, 'progression.match.showdown'),
    },
    casual: { dailyCap: integer(casual.dailyCap, 'progression.casual.dailyCap') },
    adBoost: {
      bonus: number(ad.bonus, 'progression.adBoost.bonus'),
      waves: adWaves,
      offerBelow: integer(ad.offerBelow, 'progression.adBoost.offerBelow'),
      maxWaves,
    },
    supporter: { bonus: number(supporter.bonus, 'progression.supporter.bonus') },
  };
}

export function parseStore(raw: unknown): StoreConfig {
  const r = object(raw, 'store');
  const supporter = object(r.supporter, 'store.supporter');
  return {
    builderPrice: text(r.builderPrice, 'store.builderPrice'),
    builderNote: text(r.builderNote, 'store.builderNote'),
    bundles: list(r.bundles, 'store.bundles').map((value, i) => {
      const at = `store.bundles[${i}]`;
      const b = object(value, at);
      const builders =
        b.builders === 'all'
          ? 'all'
          : list(b.builders, `${at}.builders`).map((id, j) => text(id, `${at}.builders[${j}]`));
      return {
        id: text(b.id, `${at}.id`),
        name: text(b.name, `${at}.name`),
        blurb: text(b.blurb, `${at}.blurb`),
        price: text(b.price, `${at}.price`),
        was: b.was === null || b.was === undefined ? null : text(b.was, `${at}.was`),
        builders,
        cosmetics: list(b.cosmetics, `${at}.cosmetics`).map((id, j) =>
          text(id, `${at}.cosmetics[${j}]`),
        ),
        featured: bool(b.featured, `${at}.featured`, false),
      };
    }),
    supporter: {
      price: text(supporter.price, 'store.supporter.price'),
      pitch: text(supporter.pitch, 'store.supporter.pitch'),
      perks: list(supporter.perks, 'store.supporter.perks').map((perk, i) =>
        text(perk, `store.supporter.perks[${i}]`),
      ),
    },
  };
}

export function parseCosmetics(raw: unknown): CosmeticsConfig {
  const r = object(raw, 'cosmetics');
  const slots = list(r.slots, 'cosmetics.slots').map((value, i): CosmeticSlot => {
    const at = `cosmetics.slots[${i}]`;
    const s = object(value, at);
    return {
      id: text(s.id, `${at}.id`),
      name: text(s.name, `${at}.name`),
      blurb: text(s.blurb, `${at}.blurb`),
      exclusive: bool(s.exclusive, `${at}.exclusive`),
      live: bool(s.live, `${at}.live`),
    };
  });
  const slotIds = new Set(slots.map((s) => s.id));
  const seen = new Set<string>();

  const cosmetics = list(r.cosmetics, 'cosmetics.cosmetics').map((value, i): Cosmetic => {
    const at = `cosmetics.cosmetics[${i}]`;
    const c = object(value, at);
    const id = text(c.id, `${at}.id`);
    if (seen.has(id)) throw new Error(`${at}.id: ${id} is listed twice`);
    seen.add(id);
    const slot = text(c.slot, `${at}.slot`);
    if (!slotIds.has(slot)) throw new Error(`${at}.slot: no slot called ${slot}`);
    const u = object(c.unlock, `${at}.unlock`);
    const unlock: Unlock = {
      free: bool(u.free, `${at}.unlock.free`, false),
      level: u.level === undefined ? null : integer(u.level, `${at}.unlock.level`, 1),
      supporter: bool(u.supporter, `${at}.unlock.supporter`, false),
      store: bool(u.store, `${at}.unlock.store`, false),
    };
    if (!unlock.free && unlock.level === null && !unlock.supporter && !unlock.store) {
      throw new Error(`${at}.unlock: nothing unlocks it`);
    }
    let glyph: BadgeGlyph | null = null;
    if (slot === 'badge') {
      const shape = c.glyph;
      if (!BADGE_GLYPHS.includes(shape as BadgeGlyph)) {
        throw new Error(`${at}.glyph: a badge needs one of ${BADGE_GLYPHS.join(', ')}`);
      }
      glyph = shape as BadgeGlyph;
    }
    return {
      id,
      slot,
      name: text(c.name, `${at}.name`),
      glyph,
      unlock,
      price: c.price === null || c.price === undefined ? null : text(c.price, `${at}.price`),
    };
  });
  return { slots, cosmetics };
}

export const PROGRESSION = parseProgression(progressionJson);
export const STORE = parseStore(storeJson);
export const COSMETICS = parseCosmetics(cosmeticsJson);

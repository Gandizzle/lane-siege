/**
 * What the server keeps about each player. (docs/ARCHITECTURE.md, "What the
 * server keeps")
 *
 * Three things a device cannot be trusted to say about itself:
 *
 *   - WHO IT IS. A player id is public - every lobby shows it - so the record
 *     also holds a hash of the player's key (net/identity.ts). The first key
 *     the server sees for an id becomes its key, and the id means nothing with
 *     any other: no seat, no record, no star.
 *   - WHAT IT HAS EARNED. The server's own count of the player's XP, by the
 *     same rules the device counts with (progression/award.ts): every online
 *     match it hosted, counted as the match ended for them (room.ts), and
 *     practice and solo as the device reports them, under the same daily cap
 *     - so a device that lies about a practice match gets one day's allowance
 *     out of it, the same as one that tells the truth. The level this makes is
 *     what the Founders are counted by (founderStore.ts), with a number of
 *     online matches on top, which nothing but playing can fake.
 *   - WHAT IT MAY WEAR. The badges the others see are checked against this
 *     record before anyone is shown them (`shownBadges`): Veteran by the
 *     server's level, Supporter by a purchase the server has checked, the
 *     Founder's star by the Founders' own list.
 *
 * And what a Supporter chose to be called in the credits.
 *
 * The device keeps its own count as before, and shows it; the two agree for
 * anyone who plays with the server reachable, since they are the same
 * function of the same matches. This one is the one that decides anything.
 *
 * `PlayerStore` is the rules, in memory; `FilePlayerStore` keeps one small
 * JSON file per player, named by a hash of the id, read in at start-up. The
 * interface is what a database would sit behind when it outgrows that.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CasualReport, Credits, PlayerSummary } from '../src/net/playerApi.ts';
import { isPlayerKey } from '../src/net/identity.ts';
import { MAX_SHOWN_BADGES } from '../src/net/lobby.ts';
import {
  awardXp,
  boostStatus,
  startBoost,
  type MatchResult,
  type XpAward,
} from '../src/progression/award.ts';
import type { CosmeticsConfig, ProgressionConfig } from '../src/progression/config.ts';
import { isUnlocked, type Holder } from '../src/progression/cosmetics.ts';
import { levelOf } from '../src/progression/levels.ts';
import { NEW_PROFILE, type Profile } from '../src/progression/profile.ts';
import type { WornBadge } from '../src/sim/index.ts';
import type { FounderStore } from './founderStore.ts';

export type { CasualReport, Credits, PlayerSummary };

/** How the server knows somebody is a Supporter. */
export type SupporterSource = 'test' | 'revenuecat';

export interface PlayerRecord {
  playerId: string;
  /** SHA-256 of the player's key, in hex. The key itself is never kept. */
  keyHash: string;
  /** When the server first saw this player, as an ISO date. */
  since: string;
  /** When it last heard from them. */
  seen: string;
  /** The name they last played under, as the name filter let it through; '' for none. */
  name: string;
  /** Every point of XP the server counts for them (see the top of this file). */
  xp: number;
  /** Online matches played to their end on this server. */
  onlineMatches: number;
  /**
   * Practice and solo XP counted, by day (`YYYY-MM-DD`), against the daily
   * cap: the last few days each kept, so a device that says "yesterday" for
   * one match and "today" for the next gets each day's allowance once.
   */
  casual: Record<string, number>;
  /** The ad's boost, as the server counts it: boosted waves left. */
  adBoost: { wavesLeft: number };
  /** When the last ad boost was counted: the next has to wait `BOOST_GAP_MS`. */
  lastBoostAt: string;
  /** A Supporter the server has checked, how, and since when; null for anyone else. */
  supporter: { via: SupporterSource; at: string } | null;
  /** The badges they wear, by id, as they last said. Checked whenever shown. */
  badges: string[];
  /** The name they chose for the credits; '' for none. */
  creditName: string;
  /** The admin took their credits name away: it cannot be set again. */
  creditBlocked: boolean;
}

/** What the store needs to know about the game to count like the device does. */
export interface PlayerRules {
  progression: ProgressionConfig;
  cosmetics: CosmeticsConfig;
  /** The top level (progression/store.ts): XP past it does not count. */
  topLevel: number;
}

/** What checking a player's key came to. */
export type Proof =
  | { ok: true; record: PlayerRecord; created: boolean }
  | { ok: false; reason: 'badKey' | 'wrongKey' };

/** What counting a practice or solo match came to. */
export type CasualOutcome = { ok: true; award: XpAward } | { ok: false; reason: 'malformed' };

/**
 * The longest a reported match can have been, in waves: solo's endless last
 * wave keeps counting, so the game's own wave list is no ceiling. Anything
 * past this is not a match anybody played.
 */
const MAX_WAVES = 1000;

/** Days of practice and solo XP a record keeps count of: today, and a day either side. */
const CASUAL_DAYS_KEPT = 4;

/** An ad is half a minute, so two boosts closer together than this were not two ads. */
export const BOOST_GAP_MS = 15_000;

/** `YYYY-MM-DD` in UTC: the server's own calendar day. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The day a reported match is counted on: the device's, if it is within a day of the server's. */
export function countingDay(reported: string, now: Date): string {
  const today = utcDay(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reported)) return today;
  const gap = Math.abs(Date.parse(`${reported}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`));
  // Time zones put a device as much as a day either side of UTC.
  return gap <= 86_400_000 ? reported : today;
}

function wholeNumber(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : null;
}

/** A practice or solo match as a client reported it, or null for one that cannot have happened. */
export function parseCasualReport(raw: unknown): CasualReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== 'practice' && r.mode !== 'solo') return null;
  const wavesPlayed = wholeNumber(r.wavesPlayed, MAX_WAVES);
  const wavesSurvived = wholeNumber(r.wavesSurvived, MAX_WAVES);
  if (wavesPlayed === null || wavesSurvived === null) return null;
  if (wavesPlayed < 1 || wavesSurvived > wavesPlayed) return null;
  const placement = r.placement === null ? null : wholeNumber(r.placement, 4);
  if (r.placement !== null && (placement === null || placement < 1)) return null;
  // Solo has nobody to place against and no arena to reach.
  if (r.mode === 'solo' && (placement !== null || r.reachedShowdown === true)) return null;
  return {
    mode: r.mode,
    placement,
    wavesSurvived,
    wavesPlayed,
    reachedShowdown: r.reachedShowdown === true,
    day: typeof r.day === 'string' ? r.day : '',
  };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** A record for a player seen for the first time. */
function newRecord(playerId: string, key: string, now: Date): PlayerRecord {
  const at = now.toISOString();
  return {
    playerId,
    keyHash: hashKey(key),
    since: at,
    seen: at,
    name: '',
    xp: 0,
    onlineMatches: 0,
    casual: {},
    adBoost: { wavesLeft: 0 },
    lastBoostAt: '',
    supporter: null,
    badges: [],
    creditName: '',
    creditBlocked: false,
  };
}

/** The rules, in memory. Also what the tests and the headless checks use. */
export class PlayerStore {
  protected readonly players = new Map<string, PlayerRecord>();

  constructor(
    protected readonly rules: PlayerRules,
    protected readonly founders: FounderStore,
  ) {}

  /**
   * The player's record, if `key` is theirs. An id the server has never seen
   * is taken by the first valid key it comes with; after that, only that key.
   */
  prove(playerId: string, key: unknown, now = new Date()): Proof {
    if (!isPlayerKey(key)) return { ok: false, reason: 'badKey' };
    const known = this.players.get(playerId);
    if (known) {
      if (!sameHash(known.keyHash, hashKey(key))) return { ok: false, reason: 'wrongKey' };
      // Not written for this alone: it is saved with the record's next change.
      known.seen = now.toISOString();
      return { ok: true, record: known, created: false };
    }
    const record = newRecord(playerId, key, now);
    this.players.set(playerId, record);
    this.wrote(record);
    return { ok: true, record, created: true };
  }

  /** Whether a player id has a key yet: an id with none is anybody's to take. */
  has(playerId: string): boolean {
    return this.players.has(playerId);
  }

  /** A record without proof, for what the server shows about a player to others. */
  get(playerId: string): PlayerRecord | null {
    return this.players.get(playerId) ?? null;
  }

  /** The level the server counts this player at. */
  level(record: PlayerRecord): number {
    return levelOf(record.xp, this.rules.progression.levels, this.rules.topLevel).level;
  }

  /** What the player's own device is told about their record. */
  summary(record: PlayerRecord, nameHidden = false): PlayerSummary {
    return {
      xp: record.xp,
      level: this.level(record),
      onlineMatches: record.onlineMatches,
      founderNumber: this.founders.numberOf(record.playerId),
      supporter: record.supporter !== null,
      creditName: record.creditName,
      creditBlocked: record.creditBlocked,
      badges: this.shownBadges(record),
      nameHidden,
    };
  }

  /** The name a player is playing under now, for the admin page and the reports. */
  noteName(record: PlayerRecord, name: string): void {
    if (name === record.name) return;
    record.name = name;
    this.wrote(record);
  }

  // ---------------------------------------------------------------- XP

  /** What award.ts counts from: the parts of a profile this record has, on `day`. */
  private profileOf(record: PlayerRecord, day: string): Profile {
    const founderNumber = this.founders.numberOf(record.playerId);
    return {
      ...NEW_PROFILE,
      xp: record.xp,
      adBoost: { ...record.adBoost },
      casual: { day, xp: record.casual[day] ?? 0 },
      supporter: record.supporter !== null,
      founder: founderNumber !== null,
      founderNumber,
    };
  }

  private took(record: PlayerRecord, profile: Profile): void {
    record.xp = profile.xp;
    record.adBoost = { ...profile.adBoost };
    if (profile.casual.day) {
      record.casual[profile.casual.day] = profile.casual.xp;
      // Days long past can no longer be counted on (`countingDay`): let them go.
      const days = Object.keys(record.casual).sort();
      for (const day of days.slice(0, Math.max(0, days.length - CASUAL_DAYS_KEPT))) {
        delete record.casual[day];
      }
    }
  }

  /**
   * An online match this server hosted ended for the player: count it, and
   * see whether it made them a Founder.
   */
  recordOnline(record: PlayerRecord, result: MatchResult, now = new Date()): XpAward {
    const { award, profile } = awardXp(
      this.rules.progression,
      this.profileOf(record, utcDay(now)),
      { ...result, mode: 'online' },
      utcDay(now),
      this.rules.topLevel,
    );
    this.took(record, profile);
    record.onlineMatches += 1;
    this.wrote(record);
    this.checkFounder(record, now);
    return award;
  }

  /** A practice or solo match the device reported: counted under the daily cap, like the device does. */
  recordCasual(record: PlayerRecord, report: CasualReport, now = new Date()): CasualOutcome {
    const checked = parseCasualReport(report);
    if (!checked) return { ok: false, reason: 'malformed' };
    const day = countingDay(checked.day, now);
    const { award, profile } = awardXp(
      this.rules.progression,
      this.profileOf(record, day),
      {
        mode: checked.mode,
        placement: checked.placement,
        wavesSurvived: checked.wavesSurvived,
        wavesPlayed: checked.wavesPlayed,
        reachedShowdown: checked.reachedShowdown,
      },
      day,
      this.rules.topLevel,
    );
    this.took(record, profile);
    this.wrote(record);
    this.checkFounder(record, now);
    return { ok: true, award };
  }

  /**
   * The ad's boost was earned: its waves, if one was due and the last was not
   * a moment ago. False, and nothing counted, otherwise.
   */
  boost(record: PlayerRecord, now = new Date()): boolean {
    const last = Date.parse(record.lastBoostAt);
    if (Number.isFinite(last) && now.getTime() - last < BOOST_GAP_MS) return false;
    const profile = this.profileOf(record, utcDay(now));
    const atTop = this.level(record) >= this.rules.topLevel;
    if (!boostStatus(this.rules.progression, profile, atTop).offer) return false;
    this.took(record, startBoost(this.rules.progression, profile));
    record.lastBoostAt = now.toISOString();
    this.wrote(record);
    return true;
  }

  /** At the Founders' level, with the online matches: their number, while there are any. */
  private checkFounder(record: PlayerRecord, now: Date): void {
    if (this.founders.numberOf(record.playerId) !== null) return;
    this.founders.claim(record.playerId, this.level(record), record.onlineMatches, now);
  }

  // ---------------------------------------------------------------- badges

  /** What the badges are checked against: the server's level, purchase and Founders' list. */
  holder(record: PlayerRecord): Holder {
    const founder = this.founders.numberOf(record.playerId) !== null;
    return {
      level: this.level(record),
      supporter: record.supporter !== null || founder,
      founder,
      unlocked: [],
    };
  }

  /** The badges the player wears, by id: kept, to be checked whenever they are shown. */
  wear(record: PlayerRecord, ids: readonly string[]): void {
    const badges = ids.slice(0, MAX_SHOWN_BADGES);
    if (badges.join() === record.badges.join()) return;
    record.badges = [...badges];
    this.wrote(record);
  }

  /**
   * What the others see beside the player's name: each badge they wear that
   * this record says they have earned, a Founder's star with its number, in
   * the order the game lists badges.
   */
  shownBadges(record: PlayerRecord, ids: readonly string[] = record.badges): WornBadge[] {
    const holder = this.holder(record);
    const number = this.founders.numberOf(record.playerId);
    return this.rules.cosmetics.cosmetics
      .filter((c) => c.slot === 'badge' && ids.includes(c.id) && isUnlocked(c, holder))
      .slice(0, MAX_SHOWN_BADGES)
      .map((c) => ({ id: c.id, number: c.unlock.founder ? number : null }));
  }

  // ---------------------------------------------------- Supporter and credits

  /** A purchase the server has checked (supporterCheck.ts), or, on a test server, a test one. Null takes it back. */
  setSupporter(record: PlayerRecord, via: SupporterSource | null, now = new Date()): void {
    record.supporter = via ? { via, at: record.supporter?.at ?? now.toISOString() } : null;
    this.wrote(record);
  }

  /** A Supporter's perks: bought, or a Founder's. What the credits are for. */
  hasPerks(record: PlayerRecord): boolean {
    return record.supporter !== null || this.founders.numberOf(record.playerId) !== null;
  }

  /**
   * The name to show in the credits, already cleaned and checked by the
   * caller; '' takes them out. Only for a Supporter or a Founder, and never
   * after the admin has taken one away.
   */
  setCreditName(record: PlayerRecord, name: string): 'ok' | 'notSupporter' | 'blocked' {
    if (record.creditBlocked) return 'blocked';
    if (!this.hasPerks(record)) return 'notSupporter';
    record.creditName = name;
    this.wrote(record);
    return 'ok';
  }

  /** The admin took a credits name away, for good. */
  blockCredit(record: PlayerRecord): void {
    record.creditName = '';
    record.creditBlocked = true;
    this.wrote(record);
  }

  /**
   * Who is in the credits: every Founder by number, with the name they chose;
   * every other Supporter who chose one, in the order they supported.
   */
  credits(): Credits {
    const founders = this.founders.claims().map((claim) => ({
      number: claim.number,
      name: this.players.get(claim.playerId)?.creditName ?? '',
    }));
    const supporters = [...this.players.values()]
      .filter((r) => r.supporter !== null && r.creditName !== '')
      .filter((r) => this.founders.numberOf(r.playerId) === null)
      .sort((a, b) => (a.supporter?.at ?? '').localeCompare(b.supporter?.at ?? ''))
      .map((r) => ({ name: r.creditName }));
    return { founders, supporters };
  }

  // ---------------------------------------------------------------- admin

  all(): PlayerRecord[] {
    return [...this.players.values()];
  }

  /** Players whose id or name contains `query`, for the admin page. */
  find(query: string, limit = 20): PlayerRecord[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.all()
      .filter(
        (r) =>
          r.playerId.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.creditName.toLowerCase().includes(q),
      )
      .slice(0, limit);
  }

  /** Forget a player entirely: they asked for their data to be deleted. */
  delete(playerId: string): boolean {
    if (!this.players.delete(playerId)) return false;
    this.removed(playerId);
    return true;
  }

  /** Where `FilePlayerStore` writes. Nothing to do in memory. */
  protected wrote(_record: PlayerRecord): void {}
  protected removed(_playerId: string): void {}
}

/**
 * The same rules on disk: `<dir>/<hash>.json`, named by a hash of the player
 * id so that no id can name a path, read in at start-up. Each write is a
 * whole small file written beside its place and renamed into it, so a crash
 * mid-write leaves the old record, never half of a new one.
 */
export class FilePlayerStore extends PlayerStore {
  constructor(
    rules: PlayerRules,
    founders: FounderStore,
    private readonly dir: string,
  ) {
    super(rules, founders);
    mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const record = readRecord(join(dir, file));
      if (record) this.players.set(record.playerId, record);
    }
  }

  protected override wrote(record: PlayerRecord): void {
    const path = this.path(record.playerId);
    const temp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(record));
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      console.error(`[lane-siege] could not save a player to ${path}:`, error);
    }
  }

  protected override removed(playerId: string): void {
    rmSync(this.path(playerId), { force: true });
  }

  private path(playerId: string): string {
    const name = createHash('sha256').update(playerId).digest('hex').slice(0, 32);
    return join(this.dir, `${name}.json`);
  }
}

/** A record file, or null for one that is missing or damaged. Read field by field, so an older one defaults in. */
export function readRecord(path: string): PlayerRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  return parseRecord(raw);
}

/** A record as stored, field by field; null for anything that is not one. */
export function parseRecord(raw: unknown): PlayerRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.playerId !== 'string' || typeof r.keyHash !== 'string') return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const n = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  const casual: Record<string, number> = {};
  if (typeof r.casual === 'object' && r.casual !== null) {
    for (const [day, xp] of Object.entries(r.casual as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) casual[day] = n(xp);
    }
  }
  const ad = (typeof r.adBoost === 'object' && r.adBoost !== null ? r.adBoost : {}) as Record<
    string,
    unknown
  >;
  const supporter = (
    typeof r.supporter === 'object' && r.supporter !== null ? r.supporter : null
  ) as Record<string, unknown> | null;
  return {
    playerId: r.playerId,
    keyHash: r.keyHash,
    since: text(r.since),
    seen: text(r.seen),
    name: text(r.name),
    xp: n(r.xp),
    onlineMatches: n(r.onlineMatches),
    casual,
    adBoost: { wavesLeft: n(ad.wavesLeft) },
    lastBoostAt: text(r.lastBoostAt),
    supporter:
      supporter && (supporter.via === 'test' || supporter.via === 'revenuecat')
        ? { via: supporter.via, at: text(supporter.at) }
        : null,
    badges: Array.isArray(r.badges)
      ? r.badges.filter((b): b is string => typeof b === 'string').slice(0, MAX_SHOWN_BADGES)
      : [],
    creditName: text(r.creditName),
    creditBlocked: r.creditBlocked === true,
  };
}

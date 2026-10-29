/**
 * The Founders: the first players to reach the Founders' level, numbered #1,
 * #2, #3 in the order they got there (data/store.json, founders). Counted here
 * because the server is the one place that sees everybody, and so the one place
 * that can say who was first. (docs/ARCHITECTURE.md, "Founders")
 *
 * The level is the server's own count (playerStore.ts): XP from the matches it
 * can vouch for, and at least `onlineMatches` of them played on it. A number
 * is handed out the moment a player's count gets there, once and for good:
 * the same player asking again is told the same number, and once every number
 * is gone the answer is that they are gone. Nothing a device says about its
 * own level counts here.
 *
 * Kept as one small file, written beside its place and renamed into it, so a
 * crash mid-write leaves the old list, never half of a new one; and read in at
 * start-up, since it is a few dozen lines at most.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** Who reached the Founders' level, which number that made them, and when. */
export interface FounderClaim {
  playerId: string;
  number: number;
  /** The level the claim was made at. */
  level: number;
  /** When, as an ISO date. */
  at: string;
}

/** What a claim comes to. */
export type FounderAnswer =
  | { result: 'founder'; number: number }
  | { result: 'full' }
  | { result: 'notYet'; level: number; onlineMatches: number };

/** How many there are to be, what makes one, and how far the claims have got. */
export interface FounderStatus {
  count: number;
  level: number;
  /** Online matches a Founder must have played, as well as reaching the level. */
  onlineMatches: number;
  left: number;
}

export interface FounderRules {
  /** How many Founders there will be. */
  count: number;
  /** The level that makes one. */
  level: number;
  /** Online matches played on this server that a Founder needs as well. */
  onlineMatches: number;
}

export interface FounderStore {
  /**
   * A player the server counts at `level`, with `onlineMatches` played on it:
   * their number, if they are among the first.
   */
  claim(playerId: string, level: number, onlineMatches: number, now?: Date): FounderAnswer;
  /** A player's number, or null for anyone who is not a Founder. */
  numberOf(playerId: string): number | null;
  /** Every number handed out, in order. */
  claims(): readonly FounderClaim[];
  status(): FounderStatus;
  /**
   * A player asked to be forgotten: their number stays taken, so nobody's
   * changes, but no longer says whose it was.
   */
  forget(playerId: string): void;
}

/** The rules, in memory. Also what the tests use. */
export class MemoryFounderStore implements FounderStore {
  protected list: FounderClaim[] = [];

  constructor(protected readonly rules: FounderRules) {}

  claim(playerId: string, level: number, onlineMatches: number, now = new Date()): FounderAnswer {
    // Asked again - a lost answer, a second device - the same number.
    const known = this.numberOf(playerId);
    if (known !== null) return { result: 'founder', number: known };
    if (!(level >= this.rules.level) || !(onlineMatches >= this.rules.onlineMatches)) {
      return { result: 'notYet', level: this.rules.level, onlineMatches: this.rules.onlineMatches };
    }
    if (this.list.length >= this.rules.count) return { result: 'full' };
    const claim: FounderClaim = {
      playerId,
      number: this.list.length + 1,
      level: Math.floor(level),
      at: now.toISOString(),
    };
    this.list.push(claim);
    this.wrote();
    return { result: 'founder', number: claim.number };
  }

  numberOf(playerId: string): number | null {
    return this.list.find((c) => c.playerId === playerId)?.number ?? null;
  }

  claims(): readonly FounderClaim[] {
    return this.list;
  }

  status(): FounderStatus {
    return {
      count: this.rules.count,
      level: this.rules.level,
      onlineMatches: this.rules.onlineMatches,
      left: Math.max(0, this.rules.count - this.list.length),
    };
  }

  forget(playerId: string): void {
    const claim = this.list.find((c) => c.playerId === playerId);
    if (!claim) return;
    claim.playerId = `forgotten:${claim.number}`;
    this.wrote();
  }

  /** Where `FileFounderStore` writes. Nothing to do in memory. */
  protected wrote(): void {}
}

/** The same rules, kept in one file. */
export class FileFounderStore extends MemoryFounderStore {
  constructor(
    rules: FounderRules,
    private readonly path: string,
  ) {
    super(rules);
    this.list = readClaims(path);
  }

  protected override wrote(): void {
    const temp = `${this.path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ claims: this.list }, null, 1));
      renameSync(temp, this.path);
    } catch (error) {
      rmSync(temp, { force: true });
      // The number has been handed out; losing it on disk must not unsay it,
      // but somebody has to hear about it.
      console.error(`[lane-siege] could not save the Founders to ${this.path}:`, error);
    }
  }
}

/** The claims in a Founders file, in order; none for a file that is missing or damaged. */
function readClaims(path: string): FounderClaim[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const list = (raw as { claims?: unknown } | null)?.claims;
  if (!Array.isArray(list)) return [];
  const claims: FounderClaim[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.playerId !== 'string' || typeof c.number !== 'number') continue;
    claims.push({
      playerId: c.playerId,
      number: c.number,
      level: typeof c.level === 'number' ? c.level : 0,
      at: typeof c.at === 'string' ? c.at : '',
    });
  }
  return claims.sort((a, b) => a.number - b.number);
}

/**
 * The Founders: the first players to reach the Founders' level, numbered #1,
 * #2, #3 in the order they got there (data/store.json, founders). Counted here
 * because the server is the one place that sees everybody, and so the one place
 * that can say who was first. (docs/ARCHITECTURE.md, "Founders")
 *
 * A player's device claims its number the moment its level gets there
 * (founderRoutes.ts). The claim is answered once and for good: the same player
 * asking again is told the same number, the level is checked, and once every
 * number is gone the answer is that they are gone. The level is the device's
 * claim, as it is everywhere else (src/progression/profile.ts) - until the
 * server keeps players' progress itself, that is as strong as this can be.
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
  { result: 'founder'; number: number } | { result: 'full' } | { result: 'notYet'; level: number };

/** How many there are to be, and how far the claims have got. */
export interface FounderStatus {
  count: number;
  level: number;
  left: number;
}

export interface FounderRules {
  /** How many Founders there will be. */
  count: number;
  /** The level that makes one. */
  level: number;
}

export interface FounderStore {
  /** A player says they have reached `level`: their number, if they are among the first. */
  claim(playerId: string, level: number, now?: Date): FounderAnswer;
  /** A player's number, or null for anyone who is not a Founder. */
  numberOf(playerId: string): number | null;
  status(): FounderStatus;
}

/** The rules, in memory. Also what the tests use. */
export class MemoryFounderStore implements FounderStore {
  protected claims: FounderClaim[] = [];

  constructor(protected readonly rules: FounderRules) {}

  claim(playerId: string, level: number, now = new Date()): FounderAnswer {
    // Asked again - a lost answer, a second device - the same number.
    const known = this.numberOf(playerId);
    if (known !== null) return { result: 'founder', number: known };
    if (!(level >= this.rules.level)) return { result: 'notYet', level: this.rules.level };
    if (this.claims.length >= this.rules.count) return { result: 'full' };
    const claim: FounderClaim = {
      playerId,
      number: this.claims.length + 1,
      level: Math.floor(level),
      at: now.toISOString(),
    };
    this.claims.push(claim);
    this.wrote();
    return { result: 'founder', number: claim.number };
  }

  numberOf(playerId: string): number | null {
    return this.claims.find((c) => c.playerId === playerId)?.number ?? null;
  }

  status(): FounderStatus {
    return {
      count: this.rules.count,
      level: this.rules.level,
      left: Math.max(0, this.rules.count - this.claims.length),
    };
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
    this.claims = readClaims(path);
  }

  protected override wrote(): void {
    const temp = `${this.path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ claims: this.claims }, null, 1));
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

/**
 * How often anyone may ask the server for something: a count per asker per
 * kind of question, in fixed windows. (docs/ARCHITECTURE.md, "What the server
 * keeps")
 *
 * Not a defence against somebody with a thousand addresses; a defence against
 * the one script on one machine that would otherwise make a thousand player
 * ids a minute, report the same name a hundred times, or fill the crash file.
 * The limits that matter are on the things that are cheap to ask and costly
 * to answer, or that a person never needs to do quickly.
 *
 * In memory, and lost on a restart, which costs an abuser nothing they did
 * not already have: one fresh window.
 */

export interface Limit {
  /** Questions allowed in one window. */
  max: number;
  /** The window, in milliseconds. */
  windowMs: number;
}

/** Each kind of question the server counts, and how many of it an asker gets. */
export const LIMITS = {
  /** New player ids: a household's worth an hour, not a script's. */
  register: { max: 10, windowMs: 60 * 60_000 },
  /** Changes to a player's own record: matches, boosts, badges, names. */
  write: { max: 240, windowMs: 60 * 60_000 },
  /** Questions anyone may ask: a record, the credits, how many stars are left. */
  read: { max: 1200, windowMs: 60 * 60_000 },
  /** Name reports. */
  report: { max: 30, windowMs: 60 * 60_000 },
  /** Crash reports: a broken build reports often, but not this often. */
  crash: { max: 60, windowMs: 60 * 60_000 },
  /** Wrong admin tokens: enough for typos, too few to guess one. */
  adminFail: { max: 10, windowMs: 60 * 60_000 },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limits: Record<string, Limit> = LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Count one question of this kind from `who`. False once their window is full. */
  allow(kind: string, who: string): boolean {
    const limit = this.limits[kind];
    if (!limit) return true;
    const now = this.now();
    this.sweep(now);
    const key = `${kind}\u0000${who}`;
    const window = this.windows.get(key);
    if (!window || now - window.start >= limit.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    if (window.count >= limit.max) return false;
    window.count += 1;
    return true;
  }

  /** Forget windows that have run out, once a minute, so the map stays the size of the last hour. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    const longest = Math.max(...Object.values(this.limits).map((l) => l.windowMs));
    for (const [key, window] of this.windows) {
      if (now - window.start >= longest) this.windows.delete(key);
    }
  }
}

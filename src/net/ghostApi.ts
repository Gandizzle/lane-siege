/**
 * A player's saved build, from the client's side: how it has done, and keeping
 * the last one. (docs/ARCHITECTURE.md, "Saved builds"; the server's half is
 * server/ghostRoutes.ts.)
 *
 * Plain HTTP to the game server's own port, the websocket's address with the
 * scheme swapped. Every call is allowed to fail: no server, an old server, a
 * phone between towers - each is a null, and the game carries on without the
 * news rather than stopping for it.
 *
 * "While you were away" is worked out here, against what this device last
 * showed: the server only counts, and a player on two devices sees the news on
 * each, which is the right way round for news.
 */

import type { Identity, KeyValueStore } from './identity.ts';

/** What the server says about a player's builds: everything but the plays themselves. */
export interface GhostReport {
  saved: {
    savedAt: string;
    builderId: string;
    wave: number;
    placement: number | null;
    /** Matches played in other people's games, by where it placed: 1st, 2nd, 3rd, 4th. */
    results: number[];
  } | null;
  last: { playedAt: string; builderId: string; wave: number; placement: number | null } | null;
}

/** Results since this device last showed them, for the build they are for. */
export interface GhostNews {
  /** Matches by place, 1st to 4th, since the last look. */
  results: number[];
  /** All of them since it was saved. */
  total: number[];
}

const SEEN_KEY = 'lane-siege.savedBuildSeen';

/** `ws://host:2567` → `http://host:2567`: the same server, asked over HTTP. */
export function httpBase(server: string): string {
  return server.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
}

function isReport(value: unknown): value is GhostReport {
  return typeof value === 'object' && value !== null && 'saved' in value && 'last' in value;
}

export class SavedBuilds {
  private readonly base: string;

  private readonly playerId: string;

  constructor(
    server: string,
    /** Who is asking: the id names the builds, and the key proves they are this player's. */
    private readonly identity: Pick<Identity, 'playerId' | 'key'>,
    private readonly storage: KeyValueStore | null,
  ) {
    this.base = httpBase(server);
    this.playerId = identity.playerId;
  }

  /** How the saved build has done, and whether there is a last one. Null if the server cannot say. */
  async report(): Promise<GhostReport | null> {
    try {
      const response = await fetch(
        `${this.base}/ghosts/report?playerId=${encodeURIComponent(this.playerId)}`,
      );
      const body: unknown = response.ok ? await response.json() : null;
      return isReport(body) ? body : null;
    } catch {
      return null;
    }
  }

  /** Keep the last build: it becomes the saved one. Null if it could not be kept. */
  async keep(): Promise<GhostReport | null> {
    try {
      const response = await fetch(`${this.base}/ghosts/keep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.playerId, key: this.identity.key }),
      });
      const body: unknown = response.ok ? await response.json() : null;
      return isReport(body) ? body : null;
    } catch {
      return null;
    }
  }

  /** What has happened since this device last showed it, or null for nothing new. */
  news(report: GhostReport): GhostNews | null {
    const saved = report.saved;
    if (!saved) return null;
    const seen = this.seen();
    const before = seen?.savedAt === saved.savedAt ? seen.results : [];
    const results = saved.results.map((n, i) => Math.max(0, n - (before[i] ?? 0)));
    return results.some((n) => n > 0) ? { results, total: [...saved.results] } : null;
  }

  /** The news has been shown: next time, count from here. */
  markSeen(report: GhostReport): void {
    if (!report.saved) return;
    try {
      this.storage?.setItem(
        SEEN_KEY,
        JSON.stringify({ savedAt: report.saved.savedAt, results: report.saved.results }),
      );
    } catch {
      // No storage: the same news again next time, which is the lesser harm.
    }
  }

  private seen(): { savedAt: string; results: number[] } | null {
    try {
      const raw: unknown = JSON.parse(this.storage?.getItem(SEEN_KEY) ?? 'null');
      if (typeof raw !== 'object' || raw === null) return null;
      const r = raw as { savedAt?: unknown; results?: unknown };
      if (typeof r.savedAt !== 'string' || !Array.isArray(r.results)) return null;
      return { savedAt: r.savedAt, results: r.results.map((n) => (typeof n === 'number' ? n : 0)) };
    } catch {
      return null;
    }
  }
}

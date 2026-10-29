/**
 * Saved builds, kept by the server. (docs/ARCHITECTURE.md, "Saved builds")
 *
 * Two to a player at most:
 *
 *   - their LAST build: the quick match they most recently played to its end,
 *     kept until their next one, so it can still be chosen once the match is
 *     over and the room is gone;
 *   - their SAVED build: the one they chose to keep, which fills empty seats in
 *     other people's quick matches, with a count of where it placed there.
 *     Keeping a new one replaces it, count and all.
 *
 * One saved build a player is what keeps the pool the size of the player base
 * rather than of the number of matches ever played: it grows with the people,
 * and each of them is in it with the build they are proudest of.
 *
 * A player id is a claim, not a proof (net/identity.ts), so this is as strong
 * as that and no stronger - but every build in it was played on this server,
 * through this server's simulation. Nothing a client sends becomes a build;
 * only what the room watched happen.
 *
 * `MemoryGhostStore` is the rules; `FileGhostStore` keeps them on disk as one
 * small JSON file per build, which is all a pool this size needs, and the
 * interface is what a database would sit behind when it outgrows that.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GhostAction } from '../src/bot/ghost.ts';
import type { GhostReport } from '../src/net/ghostApi.ts';
import { cleanLooks } from '../src/net/lobby.ts';
import type { Looks } from '../src/sim/index.ts';

export type { GhostReport };

/** A lane's play in one quick match, as the server watched it. */
export interface GhostBuild {
  playerId: string;
  name: string;
  level: number;
  /** What its player was seen in, so it plays in other people's matches looking as they did. */
  looks: Looks;
  builderId: string;
  /** The wave it held to, and where it placed, the time it was played. */
  wave: number;
  placement: number | null;
  /** When it was played, as an ISO date. */
  playedAt: string;
  actions: GhostAction[];
}

export interface SavedGhost extends GhostBuild {
  /** When it was kept: tells this saved build from the one before it. */
  savedAt: string;
  /** Matches played in other people's games, by where it placed: 1st, 2nd, 3rd, 4th. */
  results: number[];
}

export interface PickOptions {
  /** Players whose builds may not be picked: the ones in the room. */
  exclude: ReadonlySet<string>;
  /** The level the picks should be near: the room's. */
  level: number;
  random: () => number;
}

export interface GhostStore {
  /** A player's quick match just ended for them: keep it, in place of the one before. */
  setLast(build: GhostBuild): void;
  /** Make the last build the saved one. Null if there is no last build. */
  keep(playerId: string, now?: Date): SavedGhost | null;
  /** Up to `count` saved builds for a room's empty seats. */
  pick(count: number, options: PickOptions): SavedGhost[];
  /** A saved build finished somebody's match in `placement`. */
  recordResult(playerId: string, savedAt: string, placement: number): void;
  report(playerId: string): GhostReport;
  /** Every saved build: the admin page's backup. */
  savedBuilds(): SavedGhost[];
  /** A player asked to be forgotten: their builds go. */
  forget(playerId: string): void;
}

/** Places a result is counted in: 1st to 4th. */
export const PLACES = 4;

/**
 * How many of the nearest in level a pick is drawn from, at least: enough that
 * the same few do not come round every match, few enough that a new player
 * mostly meets builds from players near where they are.
 */
const DRAW_FROM = 8;

/** The rules, in memory. Also what the tests and the headless checks use. */
export class MemoryGhostStore implements GhostStore {
  protected readonly last = new Map<string, GhostBuild>();
  protected readonly saved = new Map<string, SavedGhost>();

  setLast(build: GhostBuild): void {
    this.last.set(build.playerId, build);
    this.wrote('last', build.playerId, build);
  }

  keep(playerId: string, now = new Date()): SavedGhost | null {
    const build = this.lastOf(playerId);
    if (!build) return null;
    const saved: SavedGhost = {
      ...build,
      savedAt: now.toISOString(),
      results: new Array<number>(PLACES).fill(0),
    };
    this.saved.set(playerId, saved);
    this.wrote('saved', playerId, saved);
    return saved;
  }

  pick(count: number, { exclude, level, random }: PickOptions): SavedGhost[] {
    const pool = [...this.saved.values()].filter((g) => !exclude.has(g.playerId));
    // Nearest in level first, then a random draw among the nearest few.
    pool.sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level));
    const near = pool.slice(0, Math.max(count * 4, DRAW_FROM));
    const picked: SavedGhost[] = [];
    while (picked.length < count && near.length > 0) {
      const index = Math.min(near.length - 1, Math.floor(random() * near.length));
      picked.push(near.splice(index, 1)[0]!);
    }
    return picked;
  }

  recordResult(playerId: string, savedAt: string, placement: number): void {
    const saved = this.saved.get(playerId);
    // Kept again since this match began: the result was the old build's.
    if (!saved || saved.savedAt !== savedAt) return;
    const place = Math.round(placement);
    if (place < 1 || place > PLACES) return;
    saved.results[place - 1] = (saved.results[place - 1] ?? 0) + 1;
    this.wrote('saved', playerId, saved);
  }

  report(playerId: string): GhostReport {
    const saved = this.saved.get(playerId);
    const last = this.lastOf(playerId);
    return {
      saved: saved
        ? {
            savedAt: saved.savedAt,
            builderId: saved.builderId,
            wave: saved.wave,
            placement: saved.placement,
            results: [...saved.results],
          }
        : null,
      last: last
        ? {
            playedAt: last.playedAt,
            builderId: last.builderId,
            wave: last.wave,
            placement: last.placement,
          }
        : null,
    };
  }

  savedBuilds(): SavedGhost[] {
    return [...this.saved.values()];
  }

  forget(playerId: string): void {
    this.saved.delete(playerId);
    this.last.delete(playerId);
    this.removed(playerId);
  }

  protected lastOf(playerId: string): GhostBuild | null {
    return this.last.get(playerId) ?? null;
  }

  /** Where `FileGhostStore` writes. Nothing to do in memory. */
  protected wrote(_kind: 'last' | 'saved', _playerId: string, _value: GhostBuild): void {}
  protected removed(_playerId: string): void {}
}

/**
 * The same rules, on disk: `<dir>/saved/<hash>.json` and `<dir>/last/<hash>.json`,
 * named by a hash of the player id so that no id can name a path. Saved builds
 * are read in at start-up, since a kickoff picks from all of them mid-tick;
 * last builds are read when asked for, since most are never kept.
 *
 * Each write is a whole small file written beside its place and renamed into
 * it, so a crash mid-write leaves the old file, never half of a new one.
 */
export class FileGhostStore extends MemoryGhostStore {
  constructor(private readonly dir: string) {
    super();
    for (const kind of ['saved', 'last'] as const) mkdirSync(join(dir, kind), { recursive: true });
    for (const file of readdirSync(join(dir, 'saved'))) {
      if (!file.endsWith('.json')) continue;
      const ghost = readGhost(join(dir, 'saved', file));
      if (ghost && 'savedAt' in ghost) this.saved.set(ghost.playerId, ghost as SavedGhost);
    }
  }

  protected override lastOf(playerId: string): GhostBuild | null {
    const build = readGhost(this.path('last', playerId));
    return build && build.playerId === playerId ? build : null;
  }

  protected override wrote(kind: 'last' | 'saved', playerId: string, value: GhostBuild): void {
    const path = this.path(kind, playerId);
    const temp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(value));
      renameSync(temp, path);
    } catch (error) {
      rmSync(temp, { force: true });
      console.error(`[lane-siege] could not save a build to ${path}:`, error);
    }
    // Last builds are on disk to be read when kept; memory holds the saved.
    if (kind === 'last') this.last.delete(playerId);
  }

  protected override removed(playerId: string): void {
    for (const kind of ['last', 'saved'] as const)
      rmSync(this.path(kind, playerId), { force: true });
  }

  private path(kind: 'last' | 'saved', playerId: string): string {
    const name = createHash('sha256').update(playerId).digest('hex').slice(0, 32);
    return join(this.dir, kind, `${name}.json`);
  }
}

/** A build file, or null for one that is missing or not a build. */
function readGhost(path: string): GhostBuild | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.playerId !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.builderId !== 'string' ||
    !Array.isArray(r.actions)
  ) {
    return null;
  }
  const results = Array.isArray(r.results)
    ? r.results.slice(0, PLACES).map((n) => (typeof n === 'number' && n > 0 ? Math.floor(n) : 0))
    : null;
  return {
    playerId: r.playerId,
    name: r.name,
    level: typeof r.level === 'number' ? r.level : 0,
    // A build kept before looks were has none.
    looks: cleanLooks(r.looks),
    builderId: r.builderId,
    wave: typeof r.wave === 'number' ? r.wave : 0,
    placement: typeof r.placement === 'number' ? r.placement : null,
    playedAt: typeof r.playedAt === 'string' ? r.playedAt : '',
    actions: r.actions as GhostAction[],
    ...(typeof r.savedAt === 'string' && results
      ? { savedAt: r.savedAt, results: [...results, 0, 0, 0, 0].slice(0, PLACES) }
      : {}),
  };
}

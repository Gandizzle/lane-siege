/**
 * Crash reports: errors on players' phones and browsers, and in the server
 * itself, kept where the admin page can show them. (docs/ARCHITECTURE.md,
 * "Crash reports")
 *
 * A report says what went wrong (the message and the stack), which build it
 * was (version, commit, web or Android), on what (the browser's own
 * description of itself, the screen's size) and what the game was doing (the
 * screen it was on, and the last few things that happened). It carries no
 * player id and no name: what broke is the question, not who it broke for.
 *
 * Appended to one file, a line per report, which starts again in a second
 * file once it is `MAX_FILE_BYTES` long - so the crash file of a game that
 * breaks badly stays a few megabytes, not the disk. The admin page groups
 * them: the same message thrown from the same place is one problem, however
 * many players it happened to.
 */

import { appendFileSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import type { CrashPayload } from '../src/net/crashReporter.ts';

export type { CrashPayload };

/** A report as kept: what the device sent, and when the server got it. */
export interface StoredCrash extends CrashPayload {
  received: string;
}

/** Reports of one problem: the same message thrown from the same place. */
export interface CrashGroup {
  kind: string;
  message: string;
  /** Where it was thrown: the stack's first line that names a file. */
  where: string;
  count: number;
  first: string;
  last: string;
  versions: string[];
  editions: string[];
  scenes: string[];
  /** The latest of them, whole. */
  latest: StoredCrash;
}

/** Reports kept in memory for the admin page. The file keeps more. */
const KEPT = 1000;

/** When the crash file starts again. */
const MAX_FILE_BYTES = 2_000_000;

const KINDS = new Set(['error', 'rejection', 'webgl', 'server']);

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** A report as a device sent it, cut down to size; null for one that is not a report. */
export function parseCrash(raw: unknown): CrashPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !KINDS.has(r.kind)) return null;
  const message = text(r.message, 300);
  if (!message) return null;
  return {
    kind: r.kind as CrashPayload['kind'],
    message,
    stack: text(r.stack, 4000),
    source: text(r.source, 300),
    version: text(r.version, 40),
    build: text(r.build, 60),
    edition: text(r.edition, 20),
    agent: text(r.agent, 300),
    screen: text(r.screen, 40),
    scene: text(r.scene, 60),
    trail: Array.isArray(r.trail)
      ? r.trail
          .filter((s): s is string => typeof s === 'string')
          .slice(-12)
          .map((s) => s.slice(0, 80))
      : [],
    session: text(r.session, 40),
    at: text(r.at, 40),
  };
}

/** The first line of a stack that names a file: where it was thrown. */
export function thrownFrom(crash: CrashPayload): string {
  const line = crash.stack
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /[\w-]+\.(?:js|ts|mjs)(?::\d+)*/.test(l));
  return line ?? crash.source;
}

export class CrashStore {
  protected recent: StoredCrash[] = [];

  add(crash: CrashPayload, now = new Date()): void {
    const stored: StoredCrash = { ...crash, received: now.toISOString() };
    this.recent.push(stored);
    if (this.recent.length > KEPT) this.recent.splice(0, this.recent.length - KEPT);
    this.wrote(stored);
  }

  /** The reports kept, grouped by problem, the most recent problem first. */
  groups(): CrashGroup[] {
    const groups = new Map<string, CrashGroup>();
    for (const crash of this.recent) {
      const where = thrownFrom(crash);
      const key = `${crash.kind}\u0000${crash.message}\u0000${where}`;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, {
          kind: crash.kind,
          message: crash.message,
          where,
          count: 1,
          first: crash.received,
          last: crash.received,
          versions: crash.version ? [crash.version] : [],
          editions: crash.edition ? [crash.edition] : [],
          scenes: crash.scene ? [crash.scene] : [],
          latest: crash,
        });
        continue;
      }
      group.count += 1;
      group.last = crash.received;
      group.latest = crash;
      if (crash.version && !group.versions.includes(crash.version))
        group.versions.push(crash.version);
      if (crash.edition && !group.editions.includes(crash.edition))
        group.editions.push(crash.edition);
      if (crash.scene && !group.scenes.includes(crash.scene) && group.scenes.length < 8) {
        group.scenes.push(crash.scene);
      }
    }
    return [...groups.values()].sort((a, b) => b.last.localeCompare(a.last));
  }

  /** How many reports came in since `since`. */
  countSince(since: Date): number {
    const from = since.toISOString();
    return this.recent.filter((c) => c.received >= from).length;
  }

  /** The admin has read them: start again. */
  clear(): void {
    this.recent = [];
    this.cleared();
  }

  /** Where `FileCrashStore` writes. Nothing to do in memory. */
  protected wrote(_crash: StoredCrash): void {}
  protected cleared(): void {}
}

/** The same, appended to a file. */
export class FileCrashStore extends CrashStore {
  constructor(private readonly path: string) {
    super();
    // The tail of what is on disk, so the admin page survives a restart.
    for (const file of [`${path}.old`, path]) {
      let lines: string[];
      try {
        lines = readFileSync(file, 'utf8').split('\n');
      } catch {
        continue;
      }
      for (const line of lines) {
        if (!line) continue;
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          const crash = parseCrash(raw);
          if (crash) this.recent.push({ ...crash, received: String(raw.received ?? '') });
        } catch {
          // A line cut short by a crash of our own: skipped.
        }
      }
    }
    if (this.recent.length > 1000) this.recent.splice(0, this.recent.length - 1000);
  }

  protected override wrote(crash: StoredCrash): void {
    try {
      let size = 0;
      try {
        size = statSync(this.path).size;
      } catch {
        // No file yet.
      }
      if (size > MAX_FILE_BYTES) renameSync(this.path, `${this.path}.old`);
      appendFileSync(this.path, `${JSON.stringify(crash)}\n`);
    } catch (error) {
      console.error(`[lane-siege] could not save a crash report to ${this.path}:`, error);
    }
  }

  protected override cleared(): void {
    rmSync(this.path, { force: true });
    rmSync(`${this.path}.old`, { force: true });
  }
}

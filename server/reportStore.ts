/**
 * Name reports: a player saw a name they think nobody should have to see, and
 * said so. (docs/ARCHITECTURE.md, "Name reports")
 *
 * Counted by the name and the player showing it, and by WHO reported it, not
 * how often: one player reporting the same name ten times is one report. When
 * `autoHide` different players have reported the same name, it is hidden
 * from everyone (moderation.ts) until the admin looks - one player alone can
 * only hide it from their own screen, which the reporting device does by
 * itself. A name the admin has allowed is set aside, and reports about it no
 * longer hide it.
 *
 * Kept as one small file of report groups, written beside its place and
 * renamed in, like the Founders.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { Moderation } from './moderation.ts';

/** Reports about one name one player was showing. */
export interface ReportGroup {
  /** Whose name it is. A saved build's seat is reported as the player who saved it. */
  playerId: string;
  name: string;
  /** Who reported it, by player id: each counted once. */
  reporters: string[];
  /** Where it was seen: in a lobby, or across the top of a match. */
  places: string[];
  first: string;
  last: string;
}

/** What one report came to. */
export type ReportOutcome = 'counted' | 'repeat' | 'hidden' | 'allowed';

/** Different players reporting a name before it is hidden from everyone, until the admin looks. */
export const AUTO_HIDE = 3;

/** Most groups kept: the oldest go first. Far more than one admin reads. */
const MAX_GROUPS = 2000;

/** The id a report names, with a saved build's seat (`ghost:<id>`, server/room.ts) taken back to its player. */
export function reportedId(seen: string): string {
  return seen.startsWith('ghost:') ? seen.slice('ghost:'.length) : seen;
}

export class ReportStore {
  protected groups: ReportGroup[] = [];

  constructor(
    protected readonly moderation: Moderation,
    protected readonly autoHide = AUTO_HIDE,
  ) {}

  /** `reporter` saw `playerId` showing `name` at `place`, and reported it. */
  add(
    reporter: string,
    playerId: string,
    name: string,
    place: string,
    now = new Date(),
  ): ReportOutcome {
    const at = now.toISOString();
    let group = this.groups.find((g) => g.playerId === playerId && g.name === name);
    if (!group) {
      group = { playerId, name, reporters: [], places: [], first: at, last: at };
      this.groups.push(group);
      if (this.groups.length > MAX_GROUPS) this.groups.shift();
    }
    if (group.reporters.includes(reporter)) return 'repeat';
    group.reporters.push(reporter);
    if (!group.places.includes(place)) group.places.push(place);
    group.last = at;
    let outcome: ReportOutcome = 'counted';
    if (this.moderation.isAllowed(playerId, name)) {
      outcome = 'allowed';
    } else if (
      group.reporters.length >= this.autoHide &&
      !this.moderation.isHidden(playerId, name)
    ) {
      this.moderation.hide(playerId, name, 'reports', now);
      outcome = 'hidden';
    }
    this.wrote();
    return outcome;
  }

  /** Every group, newest first, for the admin page. */
  list(): ReportGroup[] {
    return [...this.groups].sort((a, b) => b.last.localeCompare(a.last));
  }

  /** The admin dealt with a name: its reports are cleared. */
  clear(playerId: string, name: string): void {
    this.groups = this.groups.filter((g) => !(g.playerId === playerId && g.name === name));
    this.wrote();
  }

  /** A player asked to be forgotten: reports about them, and their own reports, go. */
  forget(playerId: string): void {
    this.groups = this.groups.filter((g) => g.playerId !== playerId);
    for (const group of this.groups)
      group.reporters = group.reporters.filter((r) => r !== playerId);
    this.wrote();
  }

  /** Where `FileReportStore` writes. Nothing to do in memory. */
  protected wrote(): void {}
}

/** The same, kept in one file. */
export class FileReportStore extends ReportStore {
  constructor(
    moderation: Moderation,
    private readonly path: string,
    autoHide = AUTO_HIDE,
  ) {
    super(moderation, autoHide);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return;
    }
    const list = (raw as { groups?: unknown } | null)?.groups;
    if (!Array.isArray(list)) return;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue;
      const g = item as Record<string, unknown>;
      if (typeof g.playerId !== 'string' || typeof g.name !== 'string') continue;
      this.groups.push({
        playerId: g.playerId,
        name: g.name,
        reporters: strings(g.reporters),
        places: strings(g.places),
        first: String(g.first ?? ''),
        last: String(g.last ?? ''),
      });
    }
  }

  protected override wrote(): void {
    const temp = `${this.path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ groups: this.groups }));
      renameSync(temp, this.path);
    } catch (error) {
      rmSync(temp, { force: true });
      console.error(`[lane-siege] could not save the name reports to ${this.path}:`, error);
    }
  }
}

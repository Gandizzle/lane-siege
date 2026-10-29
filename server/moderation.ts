/**
 * Names the server will not show. (docs/ARCHITECTURE.md, "Name reports")
 *
 * The name filter (net/nameFilter.ts) stops the words it knows. What it does
 * not know, players report (reportStore.ts), and a name hidden here is shown
 * to everyone as that player's default ("Player 4F2K") - in lobbies, on the
 * tabs across the top of a match, and on their saved build in other people's
 * matches - until they choose another.
 *
 * Three things the admin page can do with a player (adminRoutes.ts):
 *
 *   - HIDE one name. Enough different players reporting it does this by
 *     itself; the admin can too. A new name shows again.
 *   - ALLOW one name: the admin looked, and it is fine. Reports about it are
 *     set aside, and do not hide it again.
 *   - LOCK the player: every name they choose is hidden, for whoever keeps
 *     coming back with another.
 *
 * Kept as one small file, written beside its place and renamed in, like the
 * Founders.
 */

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** A name hidden from everyone, and why. */
export interface HiddenName {
  name: string;
  /** When, as an ISO date. */
  at: string;
  /** Reported by enough players, or hidden by the admin. */
  by: 'reports' | 'admin';
}

interface ModerationFile {
  hidden: Record<string, HiddenName>;
  allowed: Record<string, string>;
  locked: string[];
}

export class Moderation {
  protected hidden = new Map<string, HiddenName>();
  protected allowed = new Map<string, string>();
  protected locked = new Set<string>();

  /** The name to show for a player: their own, or '' (their default) when it is not to be shown. */
  shownName(playerId: string | null, name: string): string {
    if (!playerId || !name) return name;
    return this.isHidden(playerId, name) ? '' : name;
  }

  isHidden(playerId: string, name: string): boolean {
    if (this.locked.has(playerId)) return true;
    return this.hidden.get(playerId)?.name === name;
  }

  /** Whether the admin has looked at this name and let it stand. */
  isAllowed(playerId: string, name: string): boolean {
    return this.allowed.get(playerId) === name;
  }

  isLocked(playerId: string): boolean {
    return this.locked.has(playerId);
  }

  hide(playerId: string, name: string, by: HiddenName['by'], now = new Date()): void {
    this.hidden.set(playerId, { name, at: now.toISOString(), by });
    if (this.allowed.get(playerId) === name) this.allowed.delete(playerId);
    this.wrote();
  }

  /** The admin let this name stand: shown again, and reports about it set aside. */
  allow(playerId: string, name: string): void {
    if (this.hidden.get(playerId)?.name === name) this.hidden.delete(playerId);
    this.allowed.set(playerId, name);
    this.wrote();
  }

  setLocked(playerId: string, locked: boolean): void {
    if (locked) this.locked.add(playerId);
    else this.locked.delete(playerId);
    this.wrote();
  }

  /** Everything hidden, for the admin page. */
  hiddenList(): { playerId: string; hidden: HiddenName }[] {
    return [...this.hidden].map(([playerId, hidden]) => ({ playerId, hidden }));
  }

  lockedList(): string[] {
    return [...this.locked];
  }

  /** A player asked to be forgotten. */
  forget(playerId: string): void {
    this.hidden.delete(playerId);
    this.allowed.delete(playerId);
    this.locked.delete(playerId);
    this.wrote();
  }

  snapshot(): ModerationFile {
    return {
      hidden: Object.fromEntries(this.hidden),
      allowed: Object.fromEntries(this.allowed),
      locked: [...this.locked],
    };
  }

  /** Where `FileModeration` writes. Nothing to do in memory. */
  protected wrote(): void {}
}

/** The same, kept in one file. */
export class FileModeration extends Moderation {
  constructor(private readonly path: string) {
    super();
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return;
    }
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ModerationFile>;
    for (const [id, h] of Object.entries(r.hidden ?? {})) {
      if (typeof h?.name === 'string') {
        this.hidden.set(id, {
          name: h.name,
          at: String(h.at ?? ''),
          by: h.by === 'admin' ? 'admin' : 'reports',
        });
      }
    }
    for (const [id, name] of Object.entries(r.allowed ?? {})) {
      if (typeof name === 'string') this.allowed.set(id, name);
    }
    for (const id of r.locked ?? []) if (typeof id === 'string') this.locked.add(id);
  }

  protected override wrote(): void {
    const temp = `${this.path}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(this.snapshot(), null, 1));
      renameSync(temp, this.path);
    } catch (error) {
      rmSync(temp, { force: true });
      console.error(`[lane-siege] could not save the hidden names to ${this.path}:`, error);
    }
  }
}

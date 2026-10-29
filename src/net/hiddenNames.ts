/**
 * Names this player has reported, which this device no longer shows.
 * (docs/ARCHITECTURE.md, "Name reports")
 *
 * A report goes to the server (playerApi.ts), which hides a name from everyone
 * once enough different players have reported it. The player who reported it
 * should not have to wait for that: from the moment they report it, their
 * own screens show that player's default name instead - in lobbies, on the
 * tabs across the top of a match, wherever it would have been. Kept by player
 * AND name, so the same player under a new name is shown again.
 */

import type { KeyValueStore } from './identity.ts';

const STORAGE_KEY = 'lane-siege.hiddenNames';
/** The most a device keeps: the oldest go first. */
const LIMIT = 200;

interface Hidden {
  playerId: string;
  name: string;
}

export class HiddenNames {
  private list: Hidden[] = [];

  constructor(private readonly storage: KeyValueStore | null) {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        this.list = parsed.filter(
          (h): h is Hidden =>
            typeof h === 'object' &&
            h !== null &&
            typeof (h as Hidden).playerId === 'string' &&
            typeof (h as Hidden).name === 'string',
        );
      }
    } catch {
      // Corrupt or blocked: nothing hidden, which is what a new device shows.
    }
  }

  /** Stop showing this player's name here, as of now. */
  hide(playerId: string, name: string): void {
    const id = withoutGhost(playerId);
    if (this.isHidden(id, name)) return;
    this.list = [...this.list, { playerId: id, name }].slice(-LIMIT);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.list));
    } catch {
      // Storage full or blocked: hidden for this visit.
    }
  }

  isHidden(playerId: string | null, name: string): boolean {
    if (!playerId || !name) return false;
    const id = withoutGhost(playerId);
    return this.list.some((h) => h.playerId === id && h.name === name);
  }

  /** The name to show: theirs, or '' (their default) once it has been reported here. */
  shown(playerId: string | null, name: string): string {
    return this.isHidden(playerId, name) ? '' : name;
  }
}

/** A saved build's seat (`ghost:<id>`) is its player: hiding one hides the other. */
function withoutGhost(playerId: string): string {
  return playerId.startsWith('ghost:') ? playerId.slice('ghost:'.length) : playerId;
}

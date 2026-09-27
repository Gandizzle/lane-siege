/**
 * What the player has chosen about what is drawn, kept between visits. The
 * menu edits it (ui/menu.ts); the sound's equivalent is audio/settings.ts.
 *
 * One field so far. Read back field by field, like the sound settings, so a
 * field added later defaults in rather than throwing an old save away.
 */

import type { KeyValueStore } from '../net/identity.ts';

export interface DisplaySettings {
  /**
   * The small animated markers for what is happening to a body - burning,
   * slowed, shielded (statusMarks.ts). On by default: they are how a player
   * finds out that a slow landed at all.
   */
  statusEffects: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  statusEffects: true,
};

const STORAGE_KEY = 'lane-siege.display';

export function parseDisplaySettings(raw: unknown): DisplaySettings {
  const d = DEFAULT_DISPLAY_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    statusEffects: typeof r.statusEffects === 'boolean' ? r.statusEffects : d.statusEffects,
  };
}

/** The settings in force, and a way to change them that saves as it goes. */
export class DisplayOptions {
  private current: DisplaySettings;

  constructor(private readonly storage: KeyValueStore | null) {
    let saved: unknown;
    try {
      const text = storage?.getItem(STORAGE_KEY);
      saved = text ? JSON.parse(text) : null;
    } catch {
      // Corrupt or blocked: the defaults, rather than no game.
    }
    this.current = parseDisplaySettings(saved);
  }

  get settings(): Readonly<DisplaySettings> {
    return this.current;
  }

  configure(change: Partial<DisplaySettings>): void {
    this.current = parseDisplaySettings({ ...this.current, ...change });
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      // Storage full or blocked: the choice lasts this visit.
    }
  }
}

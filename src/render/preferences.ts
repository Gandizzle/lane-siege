/**
 * What the player has chosen about how the game is shown and run, kept between
 * visits. The menu edits it (ui/menu.ts); the sound's equivalent is
 * audio/settings.ts.
 *
 * Read back field by field, like the sound settings, so a field added later
 * defaults in rather than throwing an old save away.
 */

import type { KeyValueStore } from '../net/identity.ts';

/**
 * How fast a match in this tab runs: a multiple of real time. Slower is for
 * watching a fight closely, faster is for getting through the early waves.
 */
export const GAME_SPEEDS = [0.5, 1, 2, 3] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

/** A game speed as the menu and the HUD write it: ½×, 1×, 2×, 3×. */
export function speedLabel(speed: GameSpeed): string {
  return speed === 0.5 ? '½×' : `${speed}×`;
}

export interface Preferences {
  /**
   * The small animated markers for what is happening to a body - burning,
   * slowed, shielded (statusMarks.ts). On by default: they are how a player
   * finds out that a slow landed at all.
   */
  statusEffects: boolean;
  /**
   * Game speed for a match simulated in this tab: practice, or the Final
   * Showdown set up by hand. An online match always runs at 1, because three
   * other people are playing it at 1.
   */
  practiceSpeed: GameSpeed;
  /**
   * The tutorial chapters finished, by id (src/tutorial). The chapter list
   * ticks them, and the home screen stops pointing a new player at the
   * tutorial once there is one.
   */
  tutorialDone: string[];
  /**
   * The most monsters killed in one solo match on this device (§3.3, solo),
   * 0 before the first. Solo's score is a tally, and a tally is only a score
   * when there is a number to beat.
   */
  soloBest: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  statusEffects: true,
  practiceSpeed: 1,
  tutorialDone: [],
  soloBest: 0,
};

const STORAGE_KEY = 'lane-siege.preferences';
/** Where the status-marker switch was saved before this store had a second field. */
const OLD_STORAGE_KEY = 'lane-siege.display';

export function parsePreferences(raw: unknown): Preferences {
  const d = DEFAULT_PREFERENCES;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    statusEffects: typeof r.statusEffects === 'boolean' ? r.statusEffects : d.statusEffects,
    practiceSpeed: GAME_SPEEDS.includes(r.practiceSpeed as GameSpeed)
      ? (r.practiceSpeed as GameSpeed)
      : d.practiceSpeed,
    tutorialDone: Array.isArray(r.tutorialDone)
      ? [...new Set(r.tutorialDone.filter((id): id is string => typeof id === 'string'))]
      : [...d.tutorialDone],
    soloBest:
      typeof r.soloBest === 'number' && Number.isFinite(r.soloBest) && r.soloBest > 0
        ? Math.floor(r.soloBest)
        : d.soloBest,
  };
}

/** The preferences in force, and a way to change them that saves as it goes. */
export class PreferenceStore {
  private current: Preferences;

  constructor(private readonly storage: KeyValueStore | null) {
    let saved: unknown;
    try {
      const text = storage?.getItem(STORAGE_KEY) ?? storage?.getItem(OLD_STORAGE_KEY);
      saved = text ? JSON.parse(text) : null;
    } catch {
      // Corrupt or blocked: the defaults, rather than no game.
    }
    this.current = parsePreferences(saved);
  }

  get settings(): Readonly<Preferences> {
    return this.current;
  }

  configure(change: Partial<Preferences>): void {
    this.current = parsePreferences({ ...this.current, ...change });
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      // Storage full or blocked: the choice lasts this visit.
    }
  }
}

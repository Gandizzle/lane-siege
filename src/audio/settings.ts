/**
 * What the player has chosen about sound, kept between visits.
 *
 * There is no settings menu yet. This is the shape one will edit: every choice
 * a menu would offer is a field here, `AudioEngine.configure` applies a change
 * on the spot and saves it, and anything a menu adds later (a per-cue toggle,
 * say) is a new field with a default, read back leniently so an old save still
 * loads.
 */

import type { KeyValueStore } from '../net/identity.ts';
import { MUSIC_TRACKS, SOUND_PACKS, type MusicTrack } from './catalog.ts';

/**
 * Which music plays: `'shuffle'` picks at random from the whole list each time
 * a piece ends; a track's id plays that one, again and again.
 */
export type MusicChoice = 'shuffle' | (string & {});

export interface AudioSettings {
  /** 0..1 on everything. */
  master: number;
  /** 0..1 on the music. */
  music: number;
  /** 0..1 on the sound effects. */
  effects: number;
  /** Silences everything without losing the levels. */
  muted: boolean;
  musicChoice: MusicChoice;
  /** A `SoundPack` id (catalog.ts). */
  soundPack: string;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  master: 0.8,
  // Under the effects: the music is there to fill the silence, and the effects
  // are telling the player something.
  music: 0.45,
  effects: 0.8,
  muted: false,
  musicChoice: 'shuffle',
  soundPack: 'synth',
};

const STORAGE_KEY = 'lane-siege.audio';

function level(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/**
 * Read back whatever was saved, keeping each field that is still valid and
 * defaulting the rest - a track or a pack that has since been removed from the
 * catalog falls back rather than leaving the game silent.
 */
export function parseAudioSettings(raw: unknown): AudioSettings {
  const d = DEFAULT_AUDIO_SETTINGS;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  const choice = r.musicChoice;
  const pack = r.soundPack;
  return {
    master: level(r.master, d.master),
    music: level(r.music, d.music),
    effects: level(r.effects, d.effects),
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    musicChoice:
      choice === 'shuffle' || MUSIC_TRACKS.some((t) => t.id === choice)
        ? (choice as MusicChoice)
        : d.musicChoice,
    soundPack: SOUND_PACKS.some((p) => p.id === pack) ? (pack as string) : d.soundPack,
  };
}

export function loadAudioSettings(storage: KeyValueStore | null): AudioSettings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return parseAudioSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(storage: KeyValueStore | null, settings: AudioSettings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: the choice lasts this visit, which is still
    // better than refusing to make it.
  }
}

/**
 * The next piece to play, after `previousId` (null at the start).
 *
 * Shuffle does not repeat the piece that just ended unless it is the only one,
 * because a random pick that plays the same thing twice running sounds broken.
 */
export function nextTrack(
  tracks: readonly MusicTrack[],
  choice: MusicChoice,
  previousId: string | null,
  random: () => number,
): MusicTrack | null {
  if (tracks.length === 0) return null;
  if (choice !== 'shuffle') {
    const fixed = tracks.find((t) => t.id === choice);
    if (fixed) return fixed;
  }
  const pool = tracks.length > 1 ? tracks.filter((t) => t.id !== previousId) : tracks;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}

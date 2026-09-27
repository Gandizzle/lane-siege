/**
 * Every sound the game can make, and the files that make them.
 *
 * The game never names a file. It plays a CUE - "a monster died", "a wave
 * started" - and a sound pack says what that cue sounds like. Swapping the
 * game's sound is then a matter of adding a pack, not of finding every place a
 * sound is played: a pack of downloaded effects (Kenney, OpenGameArt - see
 * public/audio/CREDITS.md for what a pack must record) is a new entry in
 * `SOUND_PACKS` pointing at new files, and choosing it is one setting
 * (settings.ts), which is what a settings menu will change.
 *
 * Music works the same way: `MUSIC_TRACKS` is the list, and the setting either
 * names one track or says to pick at random each time one ends.
 *
 * Paths are relative to public/audio/, which Vite serves at the site root
 * under the build's base path (engine.ts prefixes it).
 */

import type { DamageType } from '../data/schema.ts';

export const CUES = [
  // The fight on screen: one blow, by the attacker's damage type.
  'attack.impact',
  'attack.pierce',
  'attack.blast',
  'attack.arcane',
  // Bodies leaving the board by dying (effects.ts `DeathRule` says which count).
  'death.monster',
  'death.unit',
  'death.boss',
  /** Your fortress losing health. */
  'fortress.hit',
  'wave.start',
  'wave.cleared',
  /** An opponent has sent something at your lane. */
  'send.incoming',
  /** One of your sends has gone out, by hand or by auto-send. */
  'send.launch',
  'build.place',
  'build.upgrade',
  'build.sell',
  /** Tech, a fortress upgrade or supply. */
  'buy',
  /** The fortress weapon's damage type or the aura, changed. */
  'ui.switch',
  /** Any button. */
  'ui.tap',
  /** A command the game refused. */
  'ui.denied',
  'match.victory',
  'match.defeat',
  'showdown.start',
  /** Each second of the countdown to it. */
  'showdown.tick',
] as const;

export type CueId = (typeof CUES)[number];

/**
 * The cue for a blow of this damage type. A damage type added to the data
 * without an attack cue fails the type check here, rather than playing silence.
 */
export function attackCue(damageType: DamageType): CueId {
  return `attack.${damageType}`;
}

export interface CueSound {
  /** Files under public/audio/. One is picked at random each time it plays. */
  files: readonly string[];
  /** 0..1, on top of the effects volume. */
  volume: number;
  /**
   * How many plays of this cue may sound at once. One more is dropped, not
   * queued: a sound late enough to need queuing is a sound about something
   * that has already stopped happening.
   */
  maxVoices: number;
  /** The least time between two starts of this cue, in ms. */
  minGapMs: number;
  /** Random pitch spread, as a fraction either way: 0.06 is ±6%. */
  pitchJitter: number;
}

export interface SoundPack {
  id: string;
  name: string;
  /** Who made it and under what licence (CREDITS.md has the detail). */
  credit: string;
  cues: Record<CueId, CueSound>;
}

export interface MusicTrack {
  id: string;
  title: string;
  /** Under public/audio/. */
  file: string;
  credit: string;
}

/** A cue in the synth pack: one file, named after the cue. */
function synth(
  file: string,
  volume: number,
  maxVoices: number,
  minGapMs: number,
  pitchJitter = 0,
): CueSound {
  return { files: [`sfx/synth/${file}.wav`], volume, maxVoices, minGapMs, pitchJitter };
}

/**
 * The game's own sounds (src/audio/synth/sfx.ts, `npm run audio`).
 *
 * The fight is the busy part: at the height of a late wave the lane lands
 * dozens of blows a second, so attacks are quiet, capped at a few voices and
 * spaced out, and pitch-jittered so a run of the same one does not machine-gun.
 * Anything about you - a sale, an alarm, the fortress - is louder and rarer.
 */
const SYNTH: SoundPack = {
  id: 'synth',
  name: 'Synth',
  credit: 'Original, made for Lane Siege (public domain)',
  cues: {
    'attack.impact': synth('attack-impact', 0.32, 3, 55, 0.08),
    'attack.pierce': synth('attack-pierce', 0.3, 3, 55, 0.1),
    'attack.blast': synth('attack-blast', 0.35, 2, 90, 0.08),
    'attack.arcane': synth('attack-arcane', 0.28, 3, 60, 0.08),
    'death.monster': synth('death-monster', 0.5, 4, 40, 0.12),
    'death.unit': synth('death-unit', 0.75, 2, 80, 0.06),
    'death.boss': synth('death-boss', 1, 1, 400),
    'fortress.hit': synth('fortress-hit', 0.8, 1, 500, 0.05),
    'wave.start': synth('wave-start', 0.85, 1, 1000),
    'wave.cleared': synth('wave-cleared', 0.8, 1, 1000),
    'send.incoming': synth('send-incoming', 0.7, 1, 1500),
    'send.launch': synth('send-launch', 0.45, 2, 150, 0.05),
    'build.place': synth('build-place', 0.7, 2, 40, 0.05),
    'build.upgrade': synth('build-upgrade', 0.7, 1, 100),
    'build.sell': synth('build-sell', 0.7, 1, 80),
    buy: synth('buy', 0.7, 1, 100),
    'ui.switch': synth('ui-switch', 0.7, 1, 40),
    'ui.tap': synth('ui-tap', 0.6, 2, 30),
    'ui.denied': synth('ui-denied', 0.7, 1, 250),
    'match.victory': synth('match-victory', 1, 1, 3000),
    'match.defeat': synth('match-defeat', 1, 1, 3000),
    'showdown.start': synth('showdown-start', 1, 1, 2000),
    'showdown.tick': synth('showdown-tick', 0.8, 1, 400),
  },
};

export const SOUND_PACKS: readonly SoundPack[] = [SYNTH];

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    id: 'hold-the-line',
    title: 'Hold the Line',
    file: 'music/hold-the-line.mp3',
    credit: 'Original, made for Lane Siege (public domain)',
  },
  {
    id: 'between-waves',
    title: 'Between Waves',
    file: 'music/between-waves.mp3',
    credit: 'Original, made for Lane Siege (public domain)',
  },
];

export function soundPack(id: string): SoundPack {
  return SOUND_PACKS.find((p) => p.id === id) ?? SYNTH;
}

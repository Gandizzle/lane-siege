/**
 * Plays the game's sound: effects on cue, and music from a playlist.
 *
 * Web Audio, with one graph for the whole app:
 *
 *     effect voices ─┐
 *                    ├─ effects bus ─┐
 *     music track ───── music bus ───┴─ master ── speakers
 *
 * Each level in settings.ts is one gain on it, so a volume slider or the mute
 * is a change to one number and takes effect mid-sound.
 *
 * BROWSERS START SILENT. A page may not make a sound until it has been touched,
 * so the context is created suspended and resumed on the first tap or key
 * press anywhere (`attach`). Nothing is fetched before that either: a player
 * who never taps downloads no audio at all.
 *
 * Effects are decoded into memory, because they are short and must start on
 * the frame they are asked for. Music is streamed through an <audio> element,
 * because it is long, and routed into the same graph so the volume and the
 * mute apply to it.
 *
 * A hidden tab, or an app sent to the background, is suspended rather than left
 * playing to nobody.
 */

import { MUSIC_TRACKS, soundPack, type CueId, type MusicTrack, type SoundPack } from './catalog.ts';
import { VoiceLimiter } from './limiter.ts';
import {
  loadAudioSettings,
  nextTrack,
  parseAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from './settings.ts';
import type { KeyValueStore } from '../net/identity.ts';

export interface PlayOptions {
  /** -1 left to 1 right. */
  pan?: number;
}

/** What the game needs from sound: somewhere to send a cue. */
export interface Sound {
  play(cue: CueId, options?: PlayOptions): void;
}

/** For tests, the headless runs and anywhere else with nothing to hear. */
export const SILENT: Sound = { play() {} };

/** What a settings menu needs: the choices in force, and a way to change them. */
export interface SoundSystem extends Sound {
  readonly settings: Readonly<AudioSettings>;
  /** The piece playing now, or null between pieces. */
  readonly nowPlaying: MusicTrack | null;
  /** Apply and save a change to any settings. */
  configure(change: Partial<AudioSettings>): void;
  /** Fade out the current piece and move to the next. */
  skipTrack(): void;
}

/** Seconds of silence between one piece of music ending and the next beginning. */
const TRACK_GAP_S = 4;
/** After a track fails to load, how long before trying another. */
const TRACK_RETRY_S = 20;
/** A music change fades the old piece out over this long. */
const FADE_S = 1.2;

/**
 * Loudness is roughly logarithmic and a slider is linear, so a slider's value
 * is squared on the way to a gain: halfway sounds like about half.
 */
function gainFor(level: number): number {
  return level * level;
}

interface Playing {
  track: MusicTrack;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

export class AudioEngine implements SoundSystem {
  private readonly context: AudioContext | null;
  private readonly master: GainNode | null = null;
  private readonly musicBus: GainNode | null = null;
  private readonly effectsBus: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer | 'loading' | 'failed'>();
  private readonly limiter = new VoiceLimiter();
  private current: AudioSettings;
  private pack: SoundPack;
  private unlocked = false;
  private hidden = false;
  private playing: Playing | null = null;
  private previousTrackId: string | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** Where public/ is served: Vite's base path, ending in '/'. */
    private readonly base: string,
    private readonly storage: KeyValueStore | null,
    private readonly random: () => number = Math.random,
  ) {
    this.current = loadAudioSettings(storage);
    this.pack = soundPack(this.current.soundPack);

    const Context = globalThis.AudioContext;
    this.context = Context ? new Context({ latencyHint: 'interactive' }) : null;
    const ctx = this.context;
    if (ctx) {
      this.master = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.effectsBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.effectsBus.connect(this.master);
      this.master.connect(ctx.destination);
      this.applyLevels();
    }
  }

  /** The settings in force, for a menu to show. */
  get settings(): Readonly<AudioSettings> {
    return this.current;
  }

  /** What is playing now, for a menu to show. Null between pieces. */
  get nowPlaying(): MusicTrack | null {
    return this.playing?.track ?? null;
  }

  /**
   * Change any settings - what a settings menu calls. Applied at once and
   * saved, so it holds next visit.
   */
  configure(change: Partial<AudioSettings>): void {
    const before = this.current;
    this.current = parseAudioSettings({ ...before, ...change });
    saveAudioSettings(this.storage, this.current);
    this.applyLevels();

    if (this.current.soundPack !== before.soundPack) {
      this.pack = soundPack(this.current.soundPack);
      if (this.unlocked) this.preload();
    }
    if (this.current.muted !== before.muted) {
      if (this.current.muted) this.playing?.element.pause();
      else this.resumeMusic();
    }
    // Choosing a particular piece plays it now; choosing shuffle leaves the
    // current piece to finish.
    const choice = this.current.musicChoice;
    if (
      choice !== before.musicChoice &&
      choice !== 'shuffle' &&
      this.playing?.track.id !== choice
    ) {
      this.skipTrack();
    }
  }

  /** Fade out whatever is playing and move to the next piece. */
  skipTrack(): void {
    this.stopMusic(FADE_S);
    this.scheduleNext(FADE_S);
  }

  /** Listen for the first touch, and for the page being hidden and shown. */
  attach(target: Window): void {
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchend']) {
      target.addEventListener(type, unlock, { capture: true, passive: true });
    }
    target.document.addEventListener('visibilitychange', () => {
      this.setHidden(target.document.visibilityState === 'hidden');
    });
  }

  play(cue: CueId, options: PlayOptions = {}): void {
    const ctx = this.context;
    if (!ctx || !this.effectsBus || !this.unlocked || this.hidden) return;
    if (this.current.muted || this.current.effects <= 0 || this.current.master <= 0) return;
    if (ctx.state !== 'running') return;

    const sound = this.pack.cues[cue];
    const file = sound.files[Math.floor(this.random() * sound.files.length)];
    if (!file) return;
    const buffer = this.buffers.get(file);
    if (!(buffer instanceof AudioBuffer)) {
      // Not loaded yet (or a pack switched mid-match): this play is skipped,
      // and the next one will have it.
      this.load(file);
      return;
    }

    const rate = 1 + (this.random() * 2 - 1) * sound.pitchJitter;
    const now = ctx.currentTime * 1000;
    if (!this.limiter.admit(cue, sound, now, (buffer.duration * 1000) / rate)) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = sound.volume;
    source.connect(gain);
    let out: AudioNode = gain;
    if (options.pan && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      gain.connect(panner);
      out = panner;
    }
    out.connect(this.effectsBus);
    source.addEventListener('ended', () => {
      source.disconnect();
      out.disconnect();
      if (out !== gain) gain.disconnect();
    });
    source.start();
  }

  // ------------------------------------------------------------- internals

  private url(file: string): string {
    return `${this.base}audio/${file}`;
  }

  private applyLevels(): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.musicBus || !this.effectsBus) return;
    const t = ctx.currentTime;
    // A short ramp rather than a jump, so moving a slider does not click.
    this.master.gain.setTargetAtTime(
      this.current.muted ? 0 : gainFor(this.current.master),
      t,
      0.02,
    );
    this.musicBus.gain.setTargetAtTime(gainFor(this.current.music), t, 0.02);
    this.effectsBus.gain.setTargetAtTime(gainFor(this.current.effects), t, 0.02);
  }

  private unlock(): void {
    const ctx = this.context;
    if (!ctx) return;
    if (ctx.state === 'suspended' && !this.hidden) void ctx.resume();
    if (this.unlocked) return;
    this.unlocked = true;
    this.preload();
    // A piece may already be waiting, if a choice was made before the first
    // touch and the browser refused to start it then.
    if (this.playing) this.resumeMusic();
    else this.startMusic();
  }

  private setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.context;
    if (!ctx || !this.unlocked) return;
    if (hidden) {
      this.playing?.element.pause();
      void ctx.suspend();
    } else {
      void ctx.resume();
      this.resumeMusic();
    }
  }

  private preload(): void {
    for (const sound of Object.values(this.pack.cues))
      for (const file of sound.files) this.load(file);
  }

  private load(file: string): void {
    const ctx = this.context;
    if (!ctx || this.buffers.has(file)) return;
    this.buffers.set(file, 'loading');
    fetch(this.url(file))
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${file}`);
        return response.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => this.buffers.set(file, buffer))
      .catch((error: unknown) => {
        // A missing file is a silent cue, not a broken game.
        this.buffers.set(file, 'failed');
        console.warn('[audio] could not load', file, error);
      });
  }

  private startMusic(): void {
    const ctx = this.context;
    // Before the first touch nothing starts: the unlock will start it.
    if (!ctx || !this.musicBus || this.playing || !this.unlocked) return;
    const track = nextTrack(
      MUSIC_TRACKS,
      this.current.musicChoice,
      this.previousTrackId,
      this.random,
    );
    if (!track) return;

    const element = new Audio();
    element.preload = 'auto';
    element.src = this.url(track.file);
    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.musicBus);
    const playing: Playing = { track, element, source, gain };
    this.playing = playing;
    this.previousTrackId = track.id;

    element.addEventListener('ended', () => {
      if (this.playing !== playing) return;
      this.stopMusic(0);
      this.scheduleNext(TRACK_GAP_S);
    });
    element.addEventListener('error', () => {
      if (this.playing !== playing) return;
      console.warn('[audio] could not play', track.file);
      this.stopMusic(0);
      this.scheduleNext(TRACK_RETRY_S);
    });

    // A fade in, so a piece never starts on a jolt.
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
    this.resumeMusic();
  }

  private resumeMusic(): void {
    const element = this.playing?.element;
    if (!element || this.hidden || this.current.muted) return;
    element.play().catch(() => {
      // Refused (no gesture yet, or the page went away): the next unlock or
      // visibility change tries again.
    });
  }

  /** Stop the current piece, fading it over `fade` seconds. */
  private stopMusic(fade: number): void {
    const ctx = this.context;
    const playing = this.playing;
    if (!ctx || !playing) return;
    this.playing = null;
    const { element, source, gain } = playing;
    const stop = () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
      source.disconnect();
      gain.disconnect();
    };
    if (fade <= 0) {
      stop();
      return;
    }
    gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
    setTimeout(stop, fade * 1000);
  }

  private scheduleNext(delay: number): void {
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.startMusic();
    }, delay * 1000);
  }
}

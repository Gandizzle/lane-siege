/**
 * Which sounds are allowed to start, so a busy fight is a texture rather than a
 * wall of noise.
 *
 * Three rules, all per cue except the last: no more than `maxVoices` of it
 * sounding at once, no two starts closer than `minGapMs`, and no more than
 * `MAX_VOICES` sounds of any kind at once. A sound refused is dropped, never
 * delayed. Pure bookkeeping on times the caller supplies, so it is tested
 * without an audio device (limiter.test.ts).
 */

import type { CueId, CueSound } from './catalog.ts';

/** Sounds at once across every cue. A phone's mixer is not free. */
export const MAX_VOICES = 24;

export class VoiceLimiter {
  /** When each sounding voice ends, by cue. */
  private readonly ends = new Map<CueId, number[]>();
  private readonly lastStart = new Map<CueId, number>();

  /**
   * Whether a play of `cue` may start at `now` (ms); if so, it is counted as
   * sounding until `now + durationMs`.
   */
  admit(cue: CueId, sound: CueSound, now: number, durationMs: number): boolean {
    const last = this.lastStart.get(cue);
    if (last !== undefined && now - last < sound.minGapMs) return false;

    const ends = this.prune(cue, now);
    if (ends.length >= sound.maxVoices) return false;
    if (this.sounding(now) >= MAX_VOICES) return false;

    ends.push(now + durationMs);
    this.lastStart.set(cue, now);
    return true;
  }

  /** Voices still sounding at `now`, across every cue. */
  sounding(now: number): number {
    let total = 0;
    for (const cue of this.ends.keys()) total += this.prune(cue, now).length;
    return total;
  }

  /**
   * The cue's voices still sounding at `now`, pruned IN PLACE: `admit` holds on
   * to this array while `sounding` prunes every cue, so a copy here would leave
   * `admit` pushing onto an array nobody keeps.
   */
  private prune(cue: CueId, now: number): number[] {
    let ends = this.ends.get(cue);
    if (!ends) {
      ends = [];
      this.ends.set(cue, ends);
    }
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i]! <= now) ends.splice(i, 1);
    return ends;
  }
}

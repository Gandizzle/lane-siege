/**
 * Renders the game's own sounds and music into public/audio/.
 *
 *     npm run audio              everything
 *     npm run audio -- sfx       sound effects only
 *     npm run audio -- music     music only (the slow part: a few seconds a song)
 *
 * The recipes are src/audio/synth/; this only runs them and writes files.
 * Output is deterministic - noise is seeded from each file's name - so
 * regenerating an unchanged recipe rewrites identical bytes, and a changed
 * file in a diff means a changed recipe.
 *
 * Sound effects are 16-bit mono WAV at 22.05kHz: small, and a WAV starts on
 * its first sample, where a compressed file would add a few milliseconds of
 * decoder padding in front of every shot. Music is stereo MP3, because it is
 * long and every browser and Android WebView plays it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';
import {
  RATE,
  db,
  dcBlock,
  fadeEdges,
  halveRate,
  loudness,
  peak,
  rms,
  scale,
  seeded,
  toInt16,
  trimTail,
  wav,
} from '../audio/synth/dsp.ts';
import { SFX } from '../audio/synth/sfx.ts';
import { SONGS } from '../audio/synth/music.ts';

const ROOT = join(import.meta.dirname, '..', '..', 'public', 'audio');
const SFX_DIR = join(ROOT, 'sfx', 'synth');
const MUSIC_DIR = join(ROOT, 'music');
const MP3_KBPS = 96;
/** No sound effect peaks above -1dBFS, whatever its loudness target asks. */
const CEILING = Math.pow(10, -1 / 20);

/** FNV-1a, so each file's noise is its own and does not shift when another changes. */
function seedFor(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function row(cells: (string | number)[]): string {
  return cells.map((c, i) => String(c).padEnd(i === 0 ? 18 : 10)).join('');
}

function makeSfx(): void {
  mkdirSync(SFX_DIR, { recursive: true });
  console.log(row(['sound', 'seconds', 'peak dB', 'loudness', 'bytes']));
  for (const recipe of SFX) {
    let sound = dcBlock(recipe.render(seeded(seedFor(recipe.id))));
    // Cut the tail where it drops out of earshot under the game, and fade the
    // cut so it is not heard as one.
    sound = fadeEdges(trimTail(sound, -54), 0.001, 0.04);
    sound = halveRate(sound);
    // Levelled last, on what is actually written: the resample takes the top
    // octave off, and with it some of the peak of anything bright.
    scale(sound, Math.pow(10, (recipe.loudness - loudness(sound, RATE / 2)) / 20));
    const limited = peak(sound) > CEILING;
    if (limited) scale(sound, CEILING / peak(sound));
    const file = wav([sound], RATE / 2);
    writeFileSync(join(SFX_DIR, `${recipe.id}.wav`), file);
    console.log(
      row([
        recipe.id,
        (sound.length / (RATE / 2)).toFixed(2),
        db(peak(sound)).toFixed(1),
        loudness(sound, RATE / 2).toFixed(1) + (limited ? ' (peak-limited)' : ''),
        file.length,
      ]),
    );
  }
}

function mp3(l: Float32Array, r: Float32Array): Uint8Array {
  const encoder = new Mp3Encoder(2, RATE, MP3_KBPS);
  const chunks: Uint8Array[] = [];
  const block = 1152;
  const left = new Int16Array(block);
  const right = new Int16Array(block);
  for (let i = 0; i < l.length; i += block) {
    const n = Math.min(block, l.length - i);
    for (let k = 0; k < n; k++) {
      left[k] = toInt16(l[i + k]!);
      right[k] = toInt16(r[i + k]!);
    }
    const chunk = encoder.encodeBuffer(left.subarray(0, n), right.subarray(0, n));
    if (chunk.length > 0) chunks.push(chunk);
  }
  chunks.push(encoder.flush());
  const out = new Uint8Array(chunks.reduce((total, c) => total + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function makeMusic(): void {
  mkdirSync(MUSIC_DIR, { recursive: true });
  console.log(row(['song', 'seconds', 'peak dB', 'rms dB', 'bytes']));
  for (const song of SONGS) {
    const { l, r } = song.render(seeded(seedFor(song.id)));
    const file = mp3(l, r);
    writeFileSync(join(MUSIC_DIR, `${song.id}.mp3`), file);
    console.log(
      row([
        song.id,
        (l.length / RATE).toFixed(1),
        db(peak(l, r)).toFixed(1),
        db(rms(l, r)).toFixed(1),
        file.length,
      ]),
    );
  }
}

const which = process.argv[2] ?? 'all';
if (which === 'all' || which === 'sfx') makeSfx();
if (which === 'all' || which === 'music') makeMusic();

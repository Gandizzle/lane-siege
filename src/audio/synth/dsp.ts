/**
 * A small offline synthesizer: enough to make the game's own sound effects and
 * music from nothing (src/headless/makeAudio.ts).
 *
 * Why make them rather than download them: every sound the game ships is then
 * original, owes nobody a credit and carries no licence at all - and the
 * recipe is committed next to the file, so a sound can be changed by editing a
 * number and regenerating rather than by hunting for a replacement.
 *
 * Offline and deterministic. Nothing here runs in the browser; the game plays
 * the rendered files (src/audio/engine.ts). Noise comes from a seeded
 * generator, so regenerating produces the same bytes and a diff of
 * public/audio/ means a recipe changed.
 *
 * Everything is mono Float32 at `RATE` unless it says `Stereo`. Durations are
 * seconds; frequencies are Hz; a `Param` is a constant or a function of time
 * in seconds, which is how every sweep in the recipes is written.
 */

export const RATE = 44100;

export type Param = number | ((t: number) => number);

function read(p: Param, t: number): number {
  return typeof p === 'number' ? p : p(t);
}

export function samples(duration: number): number {
  return Math.max(1, Math.round(duration * RATE));
}

/** mulberry32: small, fast, and the same numbers on every machine. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frequency of a MIDI note number: 69 is A4, 440Hz. */
export function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A glide from `from` to `to`, exponential in pitch, arriving at `time` and
 * holding there. What a falling thud or a rising zap is made of.
 */
export function glide(from: number, to: number, time: number): (t: number) => number {
  return (t) => from * Math.pow(to / from, Math.min(1, t / time));
}

// --------------------------------------------------------------- oscillators

export type Wave = 'sine' | 'triangle' | 'square' | 'saw';

/** Softens a saw's or a square's jump, so a high note does not alias into hash. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export interface OscOptions {
  /** Square only: the fraction of a cycle spent high. */
  duty?: number;
  /** Starting phase, 0..1. */
  phase?: number;
  /** Vibrato: depth in semitones and rate in Hz, fading in over `delay` s. */
  vibrato?: { depth: number; rate: number; delay?: number };
}

export function osc(
  wave: Wave,
  duration: number,
  freq: Param,
  options: OscOptions = {},
): Float32Array {
  const n = samples(duration);
  const out = new Float32Array(n);
  const duty = options.duty ?? 0.5;
  const vib = options.vibrato;
  let phase = options.phase ?? 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let f = read(freq, t);
    if (vib) {
      const ramp = vib.delay ? Math.min(1, t / vib.delay) : 1;
      f *= Math.pow(2, (ramp * vib.depth * Math.sin(2 * Math.PI * vib.rate * t)) / 12);
    }
    const dt = f / RATE;
    let s: number;
    switch (wave) {
      case 'sine':
        s = Math.sin(2 * Math.PI * phase);
        break;
      case 'triangle':
        s = 1 - 4 * Math.abs(phase - 0.5);
        break;
      case 'saw':
        s = 2 * phase - 1 - polyBlep(phase, dt);
        break;
      case 'square':
        s = phase < duty ? 1 : -1;
        s += polyBlep(phase, dt);
        s -= polyBlep((phase + 1 - duty) % 1, dt);
        break;
    }
    out[i] = s;
    phase += dt;
    phase -= Math.floor(phase);
  }
  return out;
}

/**
 * Two-operator FM: a sine whose phase is pushed around by another sine at
 * `ratio` times its frequency. `index` is how hard, and falling index is what
 * makes a bell or a zap sound struck rather than held.
 */
export function fm(duration: number, freq: Param, ratio: number, index: Param): Float32Array {
  const n = samples(duration);
  const out = new Float32Array(n);
  let carrier = 0;
  let modulator = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = read(freq, t);
    out[i] = Math.sin(2 * Math.PI * carrier + read(index, t) * Math.sin(2 * Math.PI * modulator));
    carrier = (carrier + f / RATE) % 1;
    modulator = (modulator + (f * ratio) / RATE) % 1;
  }
  return out;
}

export function noise(duration: number, random: () => number): Float32Array {
  const n = samples(duration);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = random() * 2 - 1;
  return out;
}

/**
 * Struck partials at fixed, usually inharmonic, frequencies: a gong, a bell, a
 * shattering thing. Each partial is `[hz, level, decaySeconds]`.
 */
export function partials(
  duration: number,
  set: readonly (readonly [number, number, number])[],
): Float32Array {
  const out = new Float32Array(samples(duration));
  for (const [f, level, decay] of set) {
    const tone = osc('sine', duration, f);
    mul(tone, perc(duration, 0.001, decay));
    add(out, tone, 0, level);
  }
  return out;
}

/**
 * A plucked string (Karplus-Strong): a burst of noise circulating in a delay
 * line one period long, softened a little on every pass.
 */
export function pluck(
  duration: number,
  freq: number,
  random: () => number,
  brightness = 0.5,
): Float32Array {
  const n = samples(duration);
  const out = new Float32Array(n);
  const period = Math.max(2, Math.round(RATE / freq));
  const line = new Float32Array(period);
  for (let i = 0; i < period; i++) line[i] = random() * 2 - 1;
  // Pre-soften the burst: a dark pluck starts dark rather than getting there.
  for (let pass = 0; pass < Math.round((1 - brightness) * 4); pass++) {
    for (let i = 1; i < period; i++) line[i] = (line[i]! + line[i - 1]!) * 0.5;
  }
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const j = i % period;
    const v = line[j]!;
    out[i] = v;
    line[j] = (v + prev) * 0.5 * 0.996;
    prev = v;
  }
  return out;
}

// --------------------------------------------------------------- envelopes

/** Up in `attack`, then an exponential fall reaching -60dB at `attack + decay`. */
export function perc(duration: number, attack: number, decay: number): Float32Array {
  const n = samples(duration);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out[i] = t < attack ? t / attack : Math.exp((-6.9 * (t - attack)) / decay);
  }
  return out;
}

export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/** A held note: `gate` seconds of attack-decay-sustain, then the release. */
export function adsr(gate: number, shape: Adsr): Float32Array {
  const { attack, decay, sustain, release } = shape;
  const n = samples(gate + release);
  const out = new Float32Array(n);
  let level = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    if (t < gate) {
      if (t < attack) level = t / attack;
      else level = sustain + (1 - sustain) * Math.exp((-5 * (t - attack)) / Math.max(decay, 1e-4));
      out[i] = level;
    } else {
      const x = Math.min(1, (t - gate) / release);
      out[i] = level * (1 - x) * (1 - x);
    }
  }
  return out;
}

// --------------------------------------------------------------- arithmetic

/** In place: a *= b, over the shorter of the two; anything past b is silenced. */
export function mul(a: Float32Array, b: Float32Array): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] = i < b.length ? a[i]! * b[i]! : 0;
  return a;
}

export function scale(a: Float32Array, g: number): Float32Array {
  for (let i = 0; i < a.length; i++) a[i] = a[i]! * g;
  return a;
}

/** In place: target += src * gain, starting `offset` samples in. */
export function add(target: Float32Array, src: Float32Array, offset = 0, gain = 1): Float32Array {
  const end = Math.min(target.length, offset + src.length);
  for (let i = Math.max(0, offset); i < end; i++) target[i] = target[i]! + src[i - offset]! * gain;
  return target;
}

/** A sum of layers, as long as the longest. */
export function sum(...layers: [Float32Array, number][]): Float32Array {
  const n = Math.max(...layers.map(([l]) => l.length));
  const out = new Float32Array(n);
  for (const [layer, gain] of layers) add(out, layer, 0, gain);
  return out;
}

/** `sound`, starting `delay` seconds late: for layering one thing after another. */
export function at(delay: number, sound: Float32Array): Float32Array {
  const out = new Float32Array(samples(delay) + sound.length);
  out.set(sound, samples(delay));
  return out;
}

// --------------------------------------------------------------- filters

export type FilterKind = 'lowpass' | 'highpass' | 'bandpass';

/**
 * An RBJ biquad whose cutoff may move. Coefficients are recomputed every 16
 * samples, which is smooth to the ear and cheap enough to use on everything.
 */
export function filter(
  input: Float32Array,
  kind: FilterKind,
  cutoff: Param,
  q = Math.SQRT1_2,
): Float32Array {
  const out = new Float32Array(input.length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    if (i % 16 === 0) {
      const f = Math.min(RATE * 0.45, Math.max(10, read(cutoff, i / RATE)));
      const w = (2 * Math.PI * f) / RATE;
      const cos = Math.cos(w);
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      if (kind === 'lowpass') {
        b0 = (1 - cos) / 2 / a0;
        b1 = (1 - cos) / a0;
        b2 = b0;
      } else if (kind === 'highpass') {
        b0 = (1 + cos) / 2 / a0;
        b1 = -(1 + cos) / a0;
        b2 = b0;
      } else {
        b0 = alpha / a0;
        b1 = 0;
        b2 = -alpha / a0;
      }
      a1 = (-2 * cos) / a0;
      a2 = (1 - alpha) / a0;
    }
    const x = input[i]!;
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Removes any DC offset a recipe left behind: a one-pole highpass near 20Hz. */
export function dcBlock(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  const r = 1 - (2 * Math.PI * 20) / RATE;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Gentle saturation that never exceeds ±1: glue for a busy mix. */
export function softClip(input: Float32Array, drive = 1): Float32Array {
  const norm = Math.tanh(drive);
  for (let i = 0; i < input.length; i++) input[i] = Math.tanh(input[i]! * drive) / norm;
  return input;
}

// --------------------------------------------------------------- stereo

export interface Stereo {
  l: Float32Array;
  r: Float32Array;
}

export function stereo(length: number): Stereo {
  return { l: new Float32Array(length), r: new Float32Array(length) };
}

/** Mix a mono sound into a stereo bus: equal-power pan, -1 left to 1 right. */
export function place(bus: Stereo, src: Float32Array, offset: number, gain: number, pan = 0): void {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  add(bus.l, src, offset, gain * Math.cos(angle));
  add(bus.r, src, offset, gain * Math.sin(angle));
}

export function addStereo(target: Stereo, src: Stereo, gain = 1): void {
  add(target.l, src.l, 0, gain);
  add(target.r, src.r, 0, gain);
}

class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private store = 0;
  constructor(
    size: number,
    private readonly feedback: number,
    private readonly damp: number,
  ) {
    this.buffer = new Float32Array(size);
  }
  run(x: number): number {
    const y = this.buffer[this.index]!;
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buffer[this.index] = x + this.store * this.feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return y;
  }
}

class Allpass {
  private readonly buffer: Float32Array;
  private index = 0;
  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }
  run(x: number): number {
    const b = this.buffer[this.index]!;
    this.buffer[this.index] = x + b * 0.5;
    this.index = (this.index + 1) % this.buffer.length;
    return b - x;
  }
}

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

/**
 * Freeverb (Jezar's public-domain design): eight damped combs and four
 * allpasses per side. Returns the WET signal only, `tail` seconds longer than
 * the input so nothing is cut off.
 */
export function reverb(input: Stereo, room = 0.8, damp = 0.4, tail = 2.5): Stereo {
  const n = input.l.length + samples(tail);
  const out = stereo(n);
  const feedback = room * 0.28 + 0.7;
  const damping = damp * 0.4;
  for (const [side, offset] of [
    ['l', 0],
    ['r', SPREAD],
  ] as const) {
    const combs = COMBS.map((size) => new Comb(size + offset, feedback, damping));
    const allpasses = ALLPASSES.map((size) => new Allpass(size + offset));
    const target = out[side];
    for (let i = 0; i < n; i++) {
      const x = ((input.l[i] ?? 0) + (input.r[i] ?? 0)) * 0.015;
      let y = 0;
      for (const comb of combs) y += comb.run(x);
      for (const allpass of allpasses) y = allpass.run(y);
      target[i] = y;
    }
  }
  return out;
}

/**
 * A ping-pong echo: each repeat crosses to the other side and loses some top
 * end. WET only, with room for the repeats to die away.
 */
export function echo(input: Stereo, delay: number, feedback: number, tone = 0.35): Stereo {
  const d = samples(delay);
  const repeats = Math.ceil(Math.log(0.001) / Math.log(Math.max(0.01, feedback)));
  const n = input.l.length + d * (repeats + 1);
  const out = stereo(n);
  const lineL = new Float32Array(d);
  const lineR = new Float32Array(d);
  let lowL = 0;
  let lowR = 0;
  for (let i = 0; i < n; i++) {
    const j = i % d;
    const fromL = lineL[j]!;
    const fromR = lineR[j]!;
    lowL += (fromL - lowL) * (1 - tone);
    lowR += (fromR - lowR) * (1 - tone);
    out.l[i] = lowL;
    out.r[i] = lowR;
    const inMono = ((input.l[i] ?? 0) + (input.r[i] ?? 0)) * 0.5;
    lineL[j] = inMono + lowR * feedback;
    lineR[j] = lowL * feedback;
  }
  return out;
}

// --------------------------------------------------------------- finishing

export function peak(...channels: Float32Array[]): number {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]!));
  return p;
}

export function rms(...channels: Float32Array[]): number {
  let total = 0;
  let count = 0;
  for (const c of channels) {
    for (let i = 0; i < c.length; i++) total += c[i]! * c[i]!;
    count += c.length;
  }
  return Math.sqrt(total / Math.max(1, count));
}

export function db(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-9));
}

/**
 * How loud a sound is to the ear, roughly: the RMS of its loudest 50ms. Peak
 * alone says little - a square wave and a click can share one and be twenty
 * decibels apart to listen to.
 */
export function loudness(input: Float32Array, rate = RATE): number {
  const window = Math.round(0.05 * rate);
  const hop = Math.round(0.01 * rate);
  let loudest = 0;
  for (let start = 0; start + window <= Math.max(window, input.length); start += hop) {
    let total = 0;
    const end = Math.min(input.length, start + window);
    for (let i = start; i < end; i++) total += input[i]! * input[i]!;
    loudest = Math.max(loudest, total / window);
  }
  return db(Math.sqrt(loudest));
}

/** Scale so the loudest sample sits at `peakDb` (0 is full scale). */
export function normalise(peakDb: number, ...channels: Float32Array[]): void {
  const p = peak(...channels);
  if (p === 0) return;
  const g = Math.pow(10, peakDb / 20) / p;
  for (const c of channels) scale(c, g);
}

/** Ramps both ends, so no sound starts or stops on a click. */
export function fadeEdges(
  input: Float32Array,
  inSeconds = 0.001,
  outSeconds = 0.008,
): Float32Array {
  const a = Math.min(input.length, samples(inSeconds));
  const b = Math.min(input.length, samples(outSeconds));
  for (let i = 0; i < a; i++) input[i] = input[i]! * (i / a);
  for (let i = 0; i < b; i++) {
    const k = input.length - 1 - i;
    input[k] = input[k]! * (i / b);
  }
  return input;
}

/** Drops the silent end: everything after the last sample above `floorDb`. */
export function trimTail(input: Float32Array, floorDb = -66): Float32Array {
  const floor = Math.pow(10, floorDb / 20) * peak(input);
  let end = input.length;
  while (end > 1 && Math.abs(input[end - 1]!) < floor) end--;
  return input.slice(0, Math.min(input.length, end + samples(0.005)));
}

/**
 * Halve the sample rate, behind a windowed-sinc lowpass so nothing above the
 * new Nyquist folds back down. Sound effects ship at 22.05kHz: half the bytes,
 * and a thud or a click has nothing up there worth keeping.
 */
export function halveRate(input: Float32Array): Float32Array {
  const taps = 63;
  const mid = (taps - 1) / 2;
  const cutoff = 0.225; // of the input rate: just under the new Nyquist
  const kernel = new Float32Array(taps);
  let total = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const blackman =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) +
      0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * blackman;
    total += kernel[i]!;
  }
  const out = new Float32Array(Math.floor(input.length / 2));
  for (let o = 0; o < out.length; o++) {
    const centre = o * 2;
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const j = centre + k - mid;
      if (j >= 0 && j < input.length) acc += input[j]! * kernel[k]!;
    }
    out[o] = acc / total;
  }
  return out;
}

/** 16-bit PCM WAV, mono or stereo. */
export function wav(channels: Float32Array[], rate: number): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = frames * count * 2;
  const out = new Uint8Array(44 + bytes);
  const view = new DataView(out.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      view.setInt16(offset, toInt16(channel[i]!), true);
      offset += 2;
    }
  }
  return out;
}

export function toInt16(x: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
}

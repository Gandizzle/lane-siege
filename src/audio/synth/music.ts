/**
 * The game's own music, composed as data and rendered offline (dsp.ts,
 * src/headless/makeAudio.ts).
 *
 * Placeholder music, honestly labelled: two short pieces so the playlist has a
 * real choice to make (catalog.ts, settings.ts), written so that nobody has to
 * be credited or asked. Each is a complete piece with a beginning and an
 * ending rather than a seamless loop - the player takes the next one from the
 * list when a piece ends, which is also how a list of downloaded tracks would
 * be played, and nothing depends on a file looping without a gap.
 *
 * A song is an `Arrangement`: parts, each an instrument with a level, a pan and
 * how much of it goes to the reverb and the echo; and notes, placed in beats.
 * The two songs below are written against that with a few helpers for chords,
 * bass lines, arpeggios and drum patterns.
 */

import {
  addStereo,
  adsr,
  db,
  dcBlock,
  echo,
  filter,
  fm,
  glide,
  hz,
  mul,
  noise,
  normalise,
  osc,
  perc,
  place,
  pluck,
  reverb,
  rms,
  samples,
  scale,
  softClip,
  stereo,
  sum,
  type Stereo,
} from './dsp.ts';

/** Renders one note: MIDI number, how long it is held in seconds, 0..1 velocity. */
type Instrument = (
  note: number,
  seconds: number,
  velocity: number,
  random: () => number,
) => Float32Array;

// ------------------------------------------------------------- instruments

function hiss(
  random: () => number,
  duration: number,
  kind: 'lowpass' | 'highpass' | 'bandpass',
  cutoff: number | ((t: number) => number),
  envelope: Float32Array,
  q?: number,
): Float32Array {
  return mul(filter(noise(duration, random), kind, cutoff, q), envelope);
}

const kick: Instrument = (_n, _s, v, random) =>
  sum(
    [mul(osc('sine', 0.45, glide(160, 46, 0.08)), perc(0.45, 0.001, 0.38)), v],
    [hiss(random, 0.01, 'highpass', 3000, perc(0.01, 0.0005, 0.006)), 0.3 * v],
  );

const softKick: Instrument = (_n, _s, v) =>
  scaleCopy(mul(osc('sine', 0.4, glide(120, 50, 0.06)), perc(0.4, 0.003, 0.3)), v);

const snare: Instrument = (_n, _s, v, random) =>
  sum(
    [hiss(random, 0.25, 'highpass', 1200, perc(0.25, 0.001, 0.16)), 1.1 * v],
    [hiss(random, 0.25, 'bandpass', 1800, perc(0.25, 0.001, 0.18), 0.8), 0.9 * v],
    [hiss(random, 0.12, 'highpass', 5000, perc(0.12, 0.001, 0.09)), 0.7 * v],
    [mul(osc('sine', 0.1, 185), perc(0.1, 0.001, 0.08)), 0.5 * v],
  );

const rim: Instrument = (_n, _s, v, random) =>
  sum(
    [mul(osc('sine', 0.05, 1650), perc(0.05, 0.0005, 0.02)), 0.6 * v],
    [hiss(random, 0.04, 'bandpass', 3200, perc(0.04, 0.0005, 0.02), 2), 0.6 * v],
  );

const hat: Instrument = (_n, seconds, v, random) =>
  scaleCopy(
    hiss(
      random,
      seconds > 0.3 ? 0.35 : 0.06,
      'highpass',
      7500,
      perc(seconds > 0.3 ? 0.35 : 0.06, 0.0005, seconds > 0.3 ? 0.28 : 0.045),
    ),
    v,
  );

const shaker: Instrument = (_n, _s, v, random) =>
  scaleCopy(hiss(random, 0.09, 'highpass', 6000, adsrFixed(0.02, 0.012, 0.06)), v);

const tom: Instrument = (note, _s, v) =>
  scaleCopy(
    mul(osc('sine', 0.45, glide(hz(note) * 1.5, hz(note), 0.05)), perc(0.45, 0.001, 0.32)),
    v,
  );

const crash: Instrument = (_n, _s, v, random) =>
  sum(
    [hiss(random, 2.4, 'highpass', 3500, perc(2.4, 0.002, 2.1)), 0.6 * v],
    [hiss(random, 1.2, 'bandpass', 6500, perc(1.2, 0.002, 0.9), 1), 0.4 * v],
  );

const bass: Instrument = (note, seconds, v) => {
  const f = hz(note);
  const len = seconds + 0.08;
  const body = sum([osc('saw', len, f), 0.6], [osc('square', len, f * 0.5, { duty: 0.5 }), 0.5]);
  const shaped = filter(body, 'lowpass', (t) => 180 + 1100 * Math.exp(-t * 14), 1.1);
  return scaleCopy(
    mul(shaped, adsr(seconds, { attack: 0.004, decay: 0.12, sustain: 0.7, release: 0.06 })),
    v,
  );
};

/** A held bass for the quieter song: rounder, with no bite on the front. */
const softBass: Instrument = (note, seconds, v) => {
  const f = hz(note);
  const len = seconds + 0.3;
  const body = sum([osc('triangle', len, f), 0.9], [osc('sine', len, f * 0.5), 0.5]);
  return scaleCopy(
    mul(body, adsr(seconds, { attack: 0.02, decay: 0.4, sustain: 0.7, release: 0.25 })),
    v,
  );
};

const pad: Instrument = (note, seconds, v) => {
  const f = hz(note);
  const len = seconds + 0.9;
  const voices = sum(
    [osc('saw', len, f * Math.pow(2, -0.1 / 12), { phase: 0.1 }), 0.35],
    [osc('saw', len, f, { phase: 0.5 }), 0.35],
    [osc('saw', len, f * Math.pow(2, 0.1 / 12), { phase: 0.8 }), 0.35],
  );
  const shaped = filter(voices, 'lowpass', (t) => 1500 + 500 * Math.sin(t * 1.3), 0.9);
  return scaleCopy(
    mul(shaped, adsr(seconds, { attack: 0.35, decay: 0.6, sustain: 0.8, release: 0.85 })),
    v,
  );
};

const arpSynth: Instrument = (note, _s, v) => {
  const f = hz(note);
  const body = sum([osc('square', 0.32, f, { duty: 0.3 }), 0.5], [osc('triangle', 0.32, f), 0.5]);
  return scaleCopy(
    mul(filter(body, 'lowpass', glide(9000, 2800, 0.15)), perc(0.32, 0.002, 0.22)),
    v,
  );
};

const harp: Instrument = (note, _s, v, random) =>
  scaleCopy(mul(pluck(1.3, hz(note), random, 0.8), perc(1.3, 0.001, 1.2)), v);

const lead: Instrument = (note, seconds, v) => {
  const f = hz(note);
  const len = seconds + 0.2;
  const vibrato = { depth: 0.15, rate: 5.5, delay: 0.25 };
  const body = sum(
    [osc('saw', len, f, { vibrato }), 0.5],
    [osc('square', len, f * Math.pow(2, 0.08 / 12), { duty: 0.5, vibrato }), 0.3],
  );
  const shaped = filter(body, 'lowpass', (t) => 3200 + 3000 * Math.exp(-t * 6), 1.2);
  return scaleCopy(
    mul(shaped, adsr(seconds, { attack: 0.02, decay: 0.2, sustain: 0.75, release: 0.18 })),
    v,
  );
};

const bellLead: Instrument = (note, seconds, v) => {
  const f = hz(note);
  const len = Math.max(1.2, seconds + 0.8);
  return sum(
    [mul(fm(len, f, 3.5, glide(2.5, 0.3, 0.8)), perc(len, 0.002, len * 0.9)), 0.6 * v],
    [mul(osc('sine', len, f * 2), perc(len, 0.002, len * 0.4)), 0.3 * v],
    [mul(osc('sine', len, f * 4.02), perc(len, 0.001, 0.25)), 0.1 * v],
  );
};

function scaleCopy(sound: Float32Array, g: number): Float32Array {
  for (let i = 0; i < sound.length; i++) sound[i] = sound[i]! * g;
  return sound;
}

/** Rise over `attack`, hold, fall over `release`: a shaker's swish. */
function adsrFixed(attack: number, hold: number, release: number): Float32Array {
  return adsr(attack + hold, { attack, decay: 0.01, sustain: 1, release });
}

// ------------------------------------------------------------- arrangement

/** The average level every song is written at, in dBFS RMS. */
const SONG_RMS_DB = -16.5;

interface PartConfig {
  instrument: Instrument;
  gain: number;
  pan?: number;
  /** Send level to the reverb. */
  reverb?: number;
  /** Send level to the echo. */
  echo?: number;
}

interface Note {
  beat: number;
  beats: number;
  midi: number;
  velocity: number;
  pan: number;
}

export class Arrangement {
  private readonly parts = new Map<string, { config: PartConfig; notes: Note[] }>();
  /** The last beat anything is still sounding on, for the length of the file. */
  private end = 0;

  constructor(readonly bpm: number) {}

  part(name: string, config: PartConfig): void {
    this.parts.set(name, { config, notes: [] });
  }

  note(part: string, beat: number, beats: number, midi: number, velocity = 0.8, pan = 0): void {
    const entry = this.parts.get(part);
    if (!entry) throw new Error(`no part "${part}"`);
    entry.notes.push({ beat, beats, midi, velocity, pan });
    this.end = Math.max(this.end, beat + beats);
  }

  seconds(beats: number): number {
    return (beats * 60) / this.bpm;
  }

  /** The whole song, mixed and mastered, with `tail` seconds for the last notes to ring. */
  render(random: () => number, tail: number): Stereo {
    const length = samples(this.seconds(this.end) + tail);
    const dry = stereo(length);
    const verbSend = stereo(length);
    const echoSend = stereo(length);

    for (const { config, notes } of this.parts.values()) {
      for (const n of notes) {
        const sound = config.instrument(n.midi, this.seconds(n.beats), n.velocity, random);
        const offset = samples(this.seconds(n.beat));
        const pan = Math.max(-1, Math.min(1, (config.pan ?? 0) + n.pan));
        place(dry, sound, offset, config.gain, pan);
        if (config.reverb) place(verbSend, sound, offset, config.gain * config.reverb, pan);
        if (config.echo) place(echoSend, sound, offset, config.gain * config.echo, pan);
      }
    }

    // Echo first, so the repeats sit in the same room as everything else.
    const echoes = echo(echoSend, this.seconds(0.75), 0.38, 0.4);
    addStereo(verbSend, echoes, 0.5);
    addStereo(dry, echoes, 1);
    addStereo(dry, reverb(verbSend, 0.82, 0.45, tail), 3);

    const out = { l: dcBlock(dry.l.subarray(0, length)), r: dcBlock(dry.r.subarray(0, length)) };
    // The last two seconds fade, so the piece ends on silence rather than on
    // whatever the reverb was doing when the buffer ran out.
    const fade = samples(Math.min(2, tail));
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      const k = length - 1 - i;
      out.l[k] = out.l[k]! * g;
      out.r[k] = out.r[k]! * g;
    }
    normalise(-3, out.l, out.r);
    softClip(out.l, 1.6);
    softClip(out.r, 1.6);
    normalise(-1, out.l, out.r);
    // Every song at one loudness, so the playlist does not jump between them.
    const level = Math.min(1, Math.pow(10, (SONG_RMS_DB - db(rms(out.l, out.r))) / 20));
    scale(out.l, level);
    scale(out.r, level);
    return out;
  }
}

// ------------------------------------------------------------- harmony

interface Chord {
  /** The bass note, as a MIDI number. */
  root: number;
  /** Semitones above the root. */
  intervals: readonly number[];
}

const MINOR = [0, 3, 7] as const;
const MAJOR = [0, 4, 7] as const;

function chord(root: number, intervals: readonly number[]): Chord {
  return { root, intervals };
}

/** Every note of the chord between `low` (inclusive) and `high` (exclusive). */
function spread(c: Chord, low: number, high: number): number[] {
  const classes = c.intervals.map((i) => (((c.root + i) % 12) + 12) % 12);
  const out: number[] = [];
  for (let n = low; n < high; n++) if (classes.includes(n % 12)) out.push(n);
  return out;
}

/** A melody line: [beat within the section, length in beats, MIDI note]. */
type Line = readonly (readonly [number, number, number])[];

// ------------------------------------------------------------- songs

export interface Song {
  id: string;
  title: string;
  render(random: () => number): Stereo;
}

/**
 * "Hold the Line": D minor, 112bpm, forty bars. Driving - bass in eighths, an
 * arpeggio in sixteenths, a lead that comes in on the second pass.
 */
function holdTheLine(): Arrangement {
  const a = new Arrangement(112);
  a.part('pad', { instrument: pad, gain: 0.12, reverb: 0.45 });
  a.part('bass', { instrument: bass, gain: 0.24 });
  a.part('arp', { instrument: arpSynth, gain: 0.24, pan: 0.25, reverb: 0.2, echo: 0.35 });
  a.part('lead', { instrument: lead, gain: 0.18, pan: -0.1, reverb: 0.35, echo: 0.2 });
  a.part('kick', { instrument: kick, gain: 0.42 });
  a.part('snare', { instrument: snare, gain: 0.42, reverb: 0.25 });
  a.part('hat', { instrument: hat, gain: 0.5, pan: 0.3 });
  a.part('tom', { instrument: tom, gain: 0.35, reverb: 0.2 });
  a.part('crash', { instrument: crash, gain: 0.18, pan: -0.2, reverb: 0.2 });

  const Dm = chord(38, MINOR);
  const Bb = chord(34, MAJOR);
  const F = chord(41, MAJOR);
  const C = chord(36, MAJOR);
  const Gm = chord(43, MINOR);
  const A = chord(33, MAJOR);

  const verse = [Dm, Bb, F, C, Dm, Bb, Gm, A];
  const bridge = [Bb, C, Dm, Dm, Gm, Bb, A, A];

  // One bar to a line: [beat in the section, beats held, MIDI note].
  // prettier-ignore
  const melody: Line = [
    [0, 2, 69], [2, 1, 74], [3, 1, 76],
    [4, 1.5, 77], [5.5, 0.5, 76], [6, 1, 74], [7, 1, 70],
    [8, 2, 72], [10, 1, 69], [11, 1, 72],
    [12, 1, 72], [13, 1, 70], [14, 1, 69], [15, 1, 67],
    [16, 1.5, 69], [17.5, 0.5, 74], [18, 2, 77],
    [20, 1, 79], [21, 1, 77], [22, 2, 74],
    [24, 1, 74], [25, 1, 76], [26, 1, 77], [27, 1, 79],
    [28, 2, 76], [30, 1, 73], [31, 1, 69],
  ];
  // One bar to a line: [beat in the section, beats held, MIDI note].
  // prettier-ignore
  const counter: Line = [
    [0, 4, 74],
    [4, 2, 76], [6, 2, 79],
    [8, 4, 77],
    [12, 2, 81], [14, 2, 77],
    [16, 4, 79],
    [20, 2, 77], [22, 2, 74],
    [24, 4, 76],
    [28, 2, 73], [30, 2, 76],
  ];

  let bar = 0;
  type Drums = 'none' | 'pulse' | 'full' | 'half';
  const section = (
    chords: Chord[],
    opts: {
      pad?: boolean;
      bass?: 'eighths' | 'whole';
      arp?: boolean;
      drums: Drums;
      crash?: boolean;
      line?: Line;
      fill?: boolean;
    },
  ) => {
    chords.forEach((c, i) => {
      const b = (bar + i) * 4;
      if (opts.pad) {
        spread(c, 53, 67).forEach((n, k) =>
          a.note('pad', b, 4, n, 0.8, k % 2 === 0 ? -0.35 : 0.35),
        );
      }
      if (opts.bass === 'eighths') {
        const pattern = [0, 0, 12, 0, 0, 0, 12, 7];
        pattern.forEach((step, k) =>
          a.note('bass', b + k * 0.5, 0.45, c.root + step, k % 2 === 0 ? 0.9 : 0.7),
        );
      } else if (opts.bass === 'whole') {
        a.note('bass', b, 3.8, c.root, 0.8);
      }
      if (opts.arp) {
        const tones = spread(c, 62, 84).slice(0, 5);
        const order = [0, 1, 2, 3, 4, 3, 2, 1];
        for (let k = 0; k < 16; k++) {
          const note = tones[order[k % order.length]! % tones.length]!;
          a.note('arp', b + k * 0.25, 0.25, note, k % 4 === 0 ? 0.9 : 0.6);
        }
      }
      const last = i === chords.length - 1;
      if (opts.drums === 'pulse') {
        a.note('kick', b, 1, 0, 0.8);
        a.note('kick', b + 2, 1, 0, 0.6);
      }
      if (opts.drums === 'full') {
        for (const k of [0, 1.5, 2, 2.75]) a.note('kick', b + k, 1, 0, k === 0 ? 0.95 : 0.75);
        a.note('snare', b + 1, 1, 0, 0.8);
        if (!(last && opts.fill)) a.note('snare', b + 3, 1, 0, 0.85);
        for (let k = 0; k < 8; k++) a.note('hat', b + k * 0.5, 0.1, 0, k % 2 === 1 ? 0.8 : 0.45);
      }
      if (opts.drums === 'half') {
        a.note('kick', b, 1, 0, 0.9);
        a.note('kick', b + 2.5, 1, 0, 0.6);
        a.note('snare', b + 2, 1, 0, 0.8);
        for (let k = 0; k < 4; k++) a.note('hat', b + k, k === 3 ? 0.5 : 0.1, 0, 0.6);
      }
      if (last && opts.fill) {
        [50, 50, 45, 45, 41, 41].forEach((n, k) =>
          a.note('tom', b + 3 + k * (1 / 6), 0.2, n, 0.8, k < 2 ? 0.4 : k < 4 ? 0 : -0.4),
        );
      }
    });
    if (opts.crash) a.note('crash', bar * 4, 4, 0, 0.9);
    for (const [beat, beats, midi] of opts.line ?? [])
      a.note('lead', bar * 4 + beat, beats, midi, 0.8);
    bar += chords.length;
  };

  section([Dm, Bb, F, C], { pad: true, arp: true, drums: 'none' });
  section(verse, { pad: true, bass: 'eighths', arp: true, drums: 'full', crash: true, fill: true });
  section(verse, {
    pad: true,
    bass: 'eighths',
    arp: true,
    drums: 'full',
    crash: true,
    line: melody,
    fill: true,
  });
  section(bridge, { pad: true, bass: 'whole', drums: 'half', line: counter, fill: true });
  section(verse, {
    pad: true,
    bass: 'eighths',
    arp: true,
    drums: 'full',
    crash: true,
    line: melody,
    fill: true,
  });

  // The ending: two bars of the tune's cadence, then the tonic held out.
  section([Dm, Bb], { pad: true, bass: 'eighths', arp: true, drums: 'full' });
  section([A], { pad: true, bass: 'whole', drums: 'half' });
  const b = bar * 4;
  spread(Dm, 50, 70).forEach((n, k) => a.note('pad', b, 6, n, 0.9, k % 2 === 0 ? -0.35 : 0.35));
  a.note('bass', b, 5, 38, 0.9);
  a.note('lead', b, 5, 74, 0.8);
  a.note('kick', b, 1, 0, 1);
  a.note('crash', b, 4, 0, 1);
  return a;
}

/**
 * "Between Waves": E minor, 88bpm, thirty-two bars. Quieter - a plucked
 * arpeggio, a soft bass and a bell tune over light percussion.
 */
function betweenWaves(): Arrangement {
  const a = new Arrangement(88);
  a.part('pad', { instrument: pad, gain: 0.11, reverb: 0.55 });
  a.part('bass', { instrument: softBass, gain: 0.2 });
  a.part('harp', { instrument: harp, gain: 0.3, pan: -0.2, reverb: 0.3, echo: 0.25 });
  a.part('bell', { instrument: bellLead, gain: 0.24, pan: 0.15, reverb: 0.45, echo: 0.2 });
  a.part('kick', { instrument: softKick, gain: 0.4 });
  a.part('rim', { instrument: rim, gain: 0.26, pan: -0.25, reverb: 0.3 });
  a.part('shaker', { instrument: shaker, gain: 0.18, pan: 0.35 });

  const Em = chord(40, MINOR);
  const Cmaj = chord(36, MAJOR);
  const Am = chord(45, MINOR);
  const B = chord(35, MAJOR);
  const D = chord(38, MAJOR);

  const verse = [Em, Cmaj, Am, B, Em, Cmaj, D, B];
  const turn = [Cmaj, D, Em, Em, Am, Cmaj, B, B];

  // One bar to a line: [beat in the section, beats held, MIDI note].
  // prettier-ignore
  const melody: Line = [
    [0, 1, 71], [1, 1, 76], [2, 2, 79],
    [4, 1, 76], [5, 0.5, 79], [5.5, 0.5, 76], [6, 2, 72],
    [8, 1, 69], [9, 1, 72], [10, 1.5, 76], [11.5, 0.5, 74],
    [12, 2, 75], [14, 1, 78], [15, 1, 71],
    [16, 2, 79], [18, 1, 78], [19, 1, 76],
    [20, 1, 79], [21, 1, 76], [22, 2, 72],
    [24, 1.5, 78], [25.5, 0.5, 76], [26, 1, 74], [27, 1, 69],
    [28, 2, 71], [30, 1, 75], [31, 1, 78],
  ];
  // One bar to a line: [beat in the section, beats held, MIDI note].
  // prettier-ignore
  const counter: Line = [
    [0, 2, 76], [2, 2, 79],
    [4, 4, 78],
    [8, 2, 79], [10, 2, 83],
    [12, 4, 76],
    [16, 2, 81], [18, 2, 76],
    [20, 2, 79], [22, 2, 76],
    [24, 4, 75],
    [28, 2, 78], [30, 2, 71],
  ];

  let bar = 0;
  const section = (
    chords: Chord[],
    opts: { pad?: boolean; bass?: boolean; drums?: boolean; line?: Line },
  ) => {
    chords.forEach((c, i) => {
      const b = (bar + i) * 4;
      if (opts.pad)
        spread(c, 52, 67).forEach((n, k) => a.note('pad', b, 4, n, 0.7, k % 2 === 0 ? -0.4 : 0.4));
      if (opts.bass) {
        a.note('bass', b, 2.8, c.root, 0.85);
        a.note('bass', b + 3, 0.9, c.root + 7, 0.6);
      }
      // Up and back down the chord in eighths, two octaves wide.
      const tones = spread(c, 59, 84).slice(0, 5);
      [0, 1, 2, 3, 4, 3, 2, 1].forEach((t, k) =>
        a.note('harp', b + k * 0.5, 0.5, tones[t % tones.length]!, k === 0 ? 0.9 : 0.6),
      );
      if (opts.drums) {
        a.note('kick', b, 1, 0, 0.9);
        a.note('kick', b + 2.5, 1, 0, 0.5);
        a.note('rim', b + 1, 1, 0, 0.8);
        a.note('rim', b + 3, 1, 0, 0.8);
        for (let k = 0; k < 8; k++) a.note('shaker', b + k * 0.5, 0.1, 0, k % 2 === 1 ? 0.9 : 0.5);
      }
    });
    for (const [beat, beats, midi] of opts.line ?? [])
      a.note('bell', bar * 4 + beat, beats, midi, 0.8);
    bar += chords.length;
  };

  section([Em, Cmaj, Am, B], { pad: true });
  section(verse, { pad: true, bass: true });
  section(verse, { pad: true, bass: true, drums: true, line: melody });
  section(turn, { pad: true, bass: true, drums: true, line: counter });
  section([Em, Cmaj, B], { pad: true, bass: true });
  const b = bar * 4;
  spread(Em, 52, 72).forEach((n, k) => a.note('pad', b, 6, n, 0.8, k % 2 === 0 ? -0.4 : 0.4));
  a.note('bass', b, 5, 40, 0.8);
  a.note('bell', b, 4, 76, 0.8);
  a.note('harp', b, 1, 64, 0.8);
  return a;
}

export const SONGS: readonly Song[] = [
  {
    id: 'hold-the-line',
    title: 'Hold the Line',
    render: (random) => holdTheLine().render(random, 4),
  },
  {
    id: 'between-waves',
    title: 'Between Waves',
    render: (random) => betweenWaves().render(random, 4),
  },
];

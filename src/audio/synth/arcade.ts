/**
 * The Arcade sound pack, as recipes (dsp.ts): every cue again, the way an old
 * games console would have made it. One per file in public/audio/sfx/arcade/,
 * under the same names as the Synth pack's (sfx.ts), so catalog.ts plays the
 * same cue from either folder.
 *
 * Where Synth is smooth and roomy - filtered noise, falling sines, a reverb on
 * the big moments - this is a sound chip: square waves at a few fixed widths,
 * a triangle for the low end, noise that is a coin flipped at a set rate
 * rather than hiss, volume in sixteen steps, and no room at all. Tunes are
 * quick runs of notes, a pitch slide is a slide, and nothing is pretending to
 * be a real object.
 *
 * The same jobs as Synth's, though, because they are the game's jobs: the four
 * damage types each own a register so a fight can be heard apart - impact a
 * low thud, pierce a thin high "pew", blast a burst of noise, arcane a quick
 * run upward - and anything about YOU is a tune, where the fight is mostly
 * noise and slides. Every melody here was written for the game.
 */

import { RATE, add, adsr, glide, hz, mul, osc, perc, samples, sum, type Param } from './dsp.ts';
import type { SfxRecipe } from './sfx.ts';

/** A value now: a constant, or a function of seconds. */
function valueAt(param: Param, t: number): number {
  return typeof param === 'function' ? param(t) : param;
}

/**
 * Volume in sixteen steps, the way a sound chip holds it. A fading sound is
 * cut off once it is below the lowest step - about a thirtieth of full - so a
 * `perc` decay of `d` is heard for about half of `d`: the decays below are
 * written twice as long as the sounds they make.
 */
function stepped(envelope: Float32Array): Float32Array {
  const out = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i++) out[i] = Math.round(envelope[i]! * 15) / 15;
  return out;
}

/**
 * One chip voice: a square of the given width (an eighth, a quarter or a half
 * high) or a triangle, at a pitch that may slide, its volume stepped.
 */
function chip(
  wave: 'square' | 'triangle',
  duration: number,
  freq: Param,
  envelope: Float32Array,
  width = 0.5,
  vibrato?: { depth: number; rate: number; delay?: number },
): Float32Array {
  const options = vibrato ? { duty: width, vibrato } : { duty: width };
  return mul(osc(wave, duration, freq, options), stepped(envelope));
}

/**
 * A chip's noise: a coin flipped `rate` times a second, the level held between
 * flips. Lower is deeper - a rumble at a few hundred, a hiss at many thousand.
 */
function crunch(
  random: () => number,
  duration: number,
  rate: Param,
  envelope: Float32Array,
): Float32Array {
  const n = samples(duration);
  const out = new Float32Array(n);
  let level = 0;
  let phase = 1;
  for (let i = 0; i < n; i++) {
    phase += valueAt(rate, i / RATE) / RATE;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      level = random() < 0.5 ? -1 : 1;
    }
    out[i] = level;
  }
  return mul(out, stepped(envelope));
}

/** Notes one after another, `step` seconds apart, each its own blip. */
function run(
  notes: readonly number[],
  step: number,
  length: number,
  voice: (freq: number, length: number) => Float32Array,
): Float32Array {
  const out = new Float32Array(samples(step * (notes.length - 1) + length));
  notes.forEach((note, i) => add(out, voice(hz(note), length), samples(i * step)));
  return out;
}

/** A plain square blip at one pitch: the most of what a chip says. */
function blip(width: number, decay = 1.6) {
  return (freq: number, length: number) =>
    chip('square', length, freq, perc(length, 0.001, length * decay), width);
}

/** Held, with a little vibrato once it has settled: the end of a tune. */
function held(freq: number, length: number, width = 0.5): Float32Array {
  return chip(
    'square',
    length,
    freq,
    adsr(length * 0.75, { attack: 0.005, decay: 0.15, sustain: 0.7, release: length * 0.25 }),
    width,
    { depth: 0.2, rate: 6, delay: 0.12 },
  );
}

export const ARCADE_SFX: readonly SfxRecipe[] = [
  // ------------------------------------------------------------ the fight
  {
    // A blunt blow: a low square thud falling away, with a scuff of noise.
    id: 'attack-impact',
    loudness: -17,
    render: (random) =>
      sum(
        [chip('square', 0.12, glide(220, 70, 0.08), perc(0.12, 0.001, 0.18)), 1],
        [crunch(random, 0.05, 3500, perc(0.05, 0.001, 0.06)), 0.35],
      ),
  },
  {
    // A dart: a thin "pew", an eighth-wide square sliding down.
    id: 'attack-pierce',
    loudness: -18,
    render: () => chip('square', 0.1, glide(1900, 900, 0.07), perc(0.1, 0.001, 0.16), 0.125),
  },
  {
    // A shell: a burst of noise that deepens as it goes, over a falling triangle.
    id: 'attack-blast',
    loudness: -16,
    render: (random) =>
      sum(
        [crunch(random, 0.32, glide(6000, 700, 0.22), perc(0.32, 0.002, 0.55)), 1],
        [chip('triangle', 0.28, glide(140, 50, 0.18), perc(0.28, 0.002, 0.45)), 0.8],
      ),
  },
  {
    // A mote: three quick notes upward, a quarter-wide square.
    id: 'attack-arcane',
    loudness: -18,
    render: () => run([79, 86, 91], 0.03, 0.07, blip(0.25)),
  },
  {
    // A monster popping: a square diving to nothing through a crackle.
    id: 'death-monster',
    loudness: -16,
    render: (random) =>
      sum(
        [chip('square', 0.14, glide(700, 120, 0.1), perc(0.14, 0.001, 0.25)), 0.8],
        [crunch(random, 0.18, glide(3000, 800, 0.12), perc(0.18, 0.001, 0.3)), 0.6],
      ),
  },
  {
    // One of yours breaking: three notes falling, a little crunch under the first.
    id: 'death-unit',
    loudness: -15,
    render: (random) =>
      sum(
        [run([76, 72, 67], 0.08, 0.14, blip(0.5)), 0.8],
        [crunch(random, 0.1, 2000, perc(0.1, 0.001, 0.15)), 0.4],
      ),
  },
  {
    // A boss going down: a long rumble running down to nothing, a square
    // diving under it, and a wobble as it goes.
    id: 'death-boss',
    loudness: -11,
    render: (random) =>
      sum(
        [crunch(random, 1.3, glide(5000, 180, 0.9), perc(1.3, 0.004, 2.4)), 1],
        [
          chip('square', 1.1, glide(260, 40, 0.9), perc(1.1, 0.003, 2.0), 0.5, {
            depth: 1.2,
            rate: 11,
          }),
          0.45,
        ],
      ),
  },
  {
    // The fortress taking a blow: a deep triangle thud and a hard crunch.
    id: 'fortress-hit',
    loudness: -13,
    render: (random) =>
      sum(
        [chip('triangle', 0.35, glide(110, 50, 0.15), perc(0.35, 0.002, 0.65)), 1],
        [crunch(random, 0.14, 1400, perc(0.14, 0.001, 0.25)), 0.7],
        [chip('square', 0.22, 165, perc(0.22, 0.001, 0.35), 0.25), 0.3],
      ),
  },

  // ------------------------------------------------------------ the match
  {
    // A call to arms: a bugle run up a chord to a held top note, a drum under it.
    id: 'wave-start',
    loudness: -13,
    render: (random) => {
      const out = new Float32Array(samples(1.0));
      add(out, run([67, 72, 76], 0.075, 0.09, blip(0.5, 0.9)), 0, 0.7);
      add(out, held(hz(79), 0.65), samples(0.225), 0.75);
      add(out, chip('triangle', 0.75, hz(48), perc(0.75, 0.005, 1.4)), samples(0.225), 0.8);
      add(out, crunch(random, 0.14, 900, perc(0.14, 0.001, 0.22)), samples(0.225), 0.5);
      return out;
    },
  },
  {
    // A wave beaten: a bright run up to a held note.
    id: 'wave-cleared',
    loudness: -15,
    render: () => {
      const out = new Float32Array(samples(0.9));
      add(out, run([72, 76, 79, 84], 0.055, 0.1, blip(0.25)), 0, 0.7);
      add(out, held(hz(88), 0.55, 0.25), samples(0.22), 0.6);
      return out;
    },
  },
  {
    // Something sent at you: a two-note siren, twice.
    id: 'send-incoming',
    loudness: -17,
    render: () => {
      const env = adsr(0.075, { attack: 0.002, decay: 0.03, sustain: 0.8, release: 0.015 });
      const out = new Float32Array(samples(0.46));
      [988, 740, 988, 740].forEach((f, i) =>
        add(out, chip('square', 0.1, f, env, 0.5), samples(i * 0.11)),
      );
      return out;
    },
  },
  {
    // A send leaving: a thin square sliding up through rising noise.
    id: 'send-launch',
    loudness: -18,
    render: (random) => {
      const swell = adsr(0.12, { attack: 0.08, decay: 0.05, sustain: 0.8, release: 0.12 });
      return sum(
        [chip('square', 0.26, glide(300, 1500, 0.2), swell, 0.125), 0.8],
        [crunch(random, 0.26, glide(1500, 8000, 0.2), swell), 0.3],
      );
    },
  },

  // ------------------------------------------------------------ building
  {
    // A unit set down: two quick notes, up.
    id: 'build-place',
    loudness: -16,
    render: () => run([67, 74], 0.04, 0.07, blip(0.5)),
  },
  {
    // A unit upgraded: a quick climb up a major chord.
    id: 'build-upgrade',
    loudness: -16,
    render: () => run([67, 71, 74, 79, 83], 0.035, 0.08, blip(0.25)),
  },
  {
    // A unit sold: two coins' worth, up a fifth, the second ringing on.
    id: 'build-sell',
    loudness: -17,
    render: () => {
      const out = new Float32Array(samples(0.35));
      add(out, chip('square', 0.06, hz(84), perc(0.06, 0.001, 0.12), 0.5), 0, 0.7);
      add(out, chip('square', 0.28, hz(91), perc(0.28, 0.001, 0.5), 0.5), samples(0.06), 0.7);
      return out;
    },
  },
  {
    // Anything bought that is not a unit: a triangle chime up a fifth, a square
    // shadowing it an octave up.
    id: 'buy',
    loudness: -16,
    render: () =>
      sum(
        [run([81, 88], 0.07, 0.25, (f, l) => chip('triangle', l, f, perc(l, 0.001, 0.45))), 1],
        [run([93, 100], 0.07, 0.12, blip(0.125)), 0.25],
      ),
  },

  // ------------------------------------------------------------ the interface
  {
    // A toggle: one short quarter-wide click.
    id: 'ui-switch',
    loudness: -21,
    render: () => chip('square', 0.035, 1320, perc(0.035, 0.0005, 0.06), 0.25),
  },
  {
    // Any button: a tick small enough to hear a hundred times.
    id: 'ui-tap',
    loudness: -25,
    render: () => chip('triangle', 0.025, 1760, perc(0.025, 0.0005, 0.04)),
  },
  {
    // A refusal: two low buzzes, falling.
    id: 'ui-denied',
    loudness: -18,
    render: () => run([57, 52], 0.1, 0.09, blip(0.5, 0.9)),
  },

  // ------------------------------------------------------------ the end
  {
    // Winning: a run up two octaves and a held chord on top, the bass under it.
    id: 'match-victory',
    loudness: -12,
    render: () => {
      const out = new Float32Array(samples(2.2));
      add(out, run([60, 64, 67, 72, 76], 0.07, 0.1, blip(0.5)), 0, 0.6);
      add(out, run([67, 72], 0.36, 0.3, blip(0.25)), samples(0.35), 0.45);
      for (const [note, width] of [
        [79, 0.25],
        [84, 0.5],
      ] as const) {
        add(out, held(hz(note), 1.4, width), samples(0.72), 0.45);
      }
      add(out, chip('triangle', 1.45, hz(48), perc(1.45, 0.005, 2.8)), samples(0.72), 0.9);
      return out;
    },
  },
  {
    // Losing: down a minor chord, slowly, to a low note that sags.
    id: 'match-defeat',
    loudness: -13,
    render: () => {
      const out = new Float32Array(samples(2.4));
      [67, 63, 60].forEach((note, i) =>
        add(out, held(hz(note), 0.36, 0.5), samples(i * 0.32), 0.55),
      );
      add(
        out,
        chip('triangle', 1.4, glide(hz(48), hz(46), 1.2), perc(1.4, 0.01, 2.6)),
        samples(0.96),
        0.9,
      );
      add(out, held(hz(55), 1.2, 0.125), samples(0.96), 0.35);
      return out;
    },
  },
  {
    // The Final Showdown opening: a long crash over a held, shaking power chord.
    id: 'showdown-start',
    loudness: -11,
    render: (random) => {
      const out = new Float32Array(samples(1.8));
      add(out, crunch(random, 1.6, glide(9000, 1800, 1.2), perc(1.6, 0.003, 3.0)), 0, 0.7);
      for (const note of [38, 45, 50]) {
        add(
          out,
          chip('square', 1.6, hz(note), perc(1.6, 0.01, 3.0), 0.5, { depth: 0.15, rate: 7 }),
          0,
          0.3,
        );
      }
      add(out, chip('triangle', 1.6, hz(26), perc(1.6, 0.005, 3.0)), 0, 0.8);
      return out;
    },
  },
  {
    // The count down to it: a single square blip.
    id: 'showdown-tick',
    loudness: -17,
    render: () => chip('square', 0.06, 1047, perc(0.06, 0.0008, 0.1), 0.5),
  },
];

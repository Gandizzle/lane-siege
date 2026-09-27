/**
 * The game's own sound effects, as recipes (dsp.ts). One per file in
 * public/audio/sfx/synth/; which cue plays which file is catalog.ts's call.
 *
 * The palette follows the pictures. The board is flat geometric shapes, so the
 * sounds are plainly synthetic rather than pretend-recorded: a thud is a
 * falling sine, a shot is a burst of filtered noise. What each one has to do is
 * be told apart from the rest in the middle of a fight, so the four damage
 * types each own a register - impact low and round, pierce high and short,
 * blast low and noisy, arcane a pitched zap - and anything that is about YOU
 * (a build, a sale, an alarm) is tonal, where the fight is mostly noise.
 *
 * `loudness` is how loud the file is written: the RMS of its loudest 50ms, in
 * dBFS (`loudness` in dsp.ts). Measured that way rather than by peak because a
 * square-wave alarm and a noise burst with the same peak are nowhere near the
 * same loudness. Relative loudness between cues is set here, roughly;
 * catalog.ts's `volume` is the fine adjustment, so a pack made of downloaded
 * files can be balanced without re-recording anything.
 */

import {
  add,
  adsr,
  at,
  filter,
  fm,
  glide,
  hz,
  mul,
  noise,
  osc,
  partials,
  perc,
  reverb,
  samples,
  stereo,
  sum,
  type Stereo,
} from './dsp.ts';

export interface SfxRecipe {
  /** The file name, without extension. */
  id: string;
  /** RMS of the loudest 50ms, in dBFS, that the file is written at. */
  loudness: number;
  render(random: () => number): Float32Array;
}

/** A tone shaped by an envelope: the building block of most of these. */
function tone(
  wave: 'sine' | 'triangle' | 'square' | 'saw',
  duration: number,
  freq: number | ((t: number) => number),
  envelope: Float32Array,
  duty?: number,
): Float32Array {
  return mul(osc(wave, duration, freq, duty === undefined ? {} : { duty }), envelope);
}

/** A burst of noise through a filter, shaped by an envelope. */
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

/** A soft bell: a sine with a quiet, faster-dying partial above it. */
function bell(freq: number, duration: number, decay: number): Float32Array {
  return partials(duration, [
    [freq, 1, decay],
    [freq * 2.76, 0.25, decay * 0.35],
    [freq * 5.4, 0.08, decay * 0.15],
  ]);
}

/** Mono through a short room, folded back to mono. For the bigger moments. */
function roomy(dry: Float32Array, wet: number, room = 0.7): Float32Array {
  const bus: Stereo = stereo(dry.length);
  add(bus.l, dry);
  add(bus.r, dry);
  const tail = reverb(bus, room, 0.5, 1.2);
  const out = new Float32Array(tail.l.length);
  add(out, dry);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + (tail.l[i]! + tail.r[i]!) * 0.5 * wet;
  return out;
}

export const SFX: readonly SfxRecipe[] = [
  // ------------------------------------------------------------ the fight
  {
    // A blunt blow: a round thump with a little grit on the front of it.
    id: 'attack-impact',
    loudness: -16,
    render: (random) =>
      sum(
        [tone('sine', 0.14, glide(170, 55, 0.09), perc(0.14, 0.002, 0.12)), 1],
        [hiss(random, 0.03, 'lowpass', 2500, perc(0.03, 0.001, 0.025)), 0.6],
      ),
  },
  {
    // A dart: a short high hiss with a thin ring on it.
    id: 'attack-pierce',
    loudness: -16,
    render: (random) =>
      sum(
        [hiss(random, 0.06, 'highpass', 3000, perc(0.06, 0.001, 0.04)), 0.7],
        [tone('triangle', 0.11, glide(2400, 1300, 0.05), perc(0.11, 0.001, 0.08)), 0.45],
      ),
  },
  {
    // A shell going off: a falling rumble over a sub drop.
    id: 'attack-blast',
    loudness: -16,
    render: (random) =>
      sum(
        [hiss(random, 0.35, 'lowpass', glide(3000, 150, 0.12), perc(0.35, 0.003, 0.3)), 1],
        [tone('sine', 0.35, glide(110, 38, 0.15), perc(0.35, 0.002, 0.28)), 0.8],
      ),
  },
  {
    // A mote: a rising FM zap with a glint at the top.
    id: 'attack-arcane',
    loudness: -16,
    render: () =>
      sum(
        [
          mul(fm(0.18, glide(700, 1500, 0.1), 2.01, glide(4, 0.5, 0.15)), perc(0.18, 0.004, 0.14)),
          1,
        ],
        [tone('sine', 0.12, 3200, perc(0.12, 0.001, 0.06)), 0.25],
      ),
  },
  {
    // A monster popping: a falling square blip over a crunch.
    id: 'death-monster',
    loudness: -15,
    render: (random) =>
      sum(
        [
          filter(
            tone('square', 0.12, glide(520, 90, 0.05), perc(0.12, 0.001, 0.1)),
            'lowpass',
            2000,
          ),
          0.5,
        ],
        [hiss(random, 0.22, 'bandpass', glide(2400, 500, 0.08), perc(0.22, 0.001, 0.18), 1.2), 1],
      ),
  },
  {
    // One of yours breaking: glassy inharmonic partials over a dull knock, and
    // a small falling note so it reads as a loss rather than a hit.
    id: 'death-unit',
    loudness: -14,
    render: (random) =>
      sum(
        [
          partials(0.45, [
            [1320, 0.5, 0.18],
            [1757, 0.4, 0.14],
            [2311, 0.35, 0.1],
            [2990, 0.3, 0.08],
            [3730, 0.2, 0.06],
          ]),
          0.6,
        ],
        [tone('sine', 0.2, glide(140, 60, 0.1), perc(0.2, 0.002, 0.16)), 0.9],
        [hiss(random, 0.12, 'bandpass', 3500, perc(0.12, 0.001, 0.08), 0.8), 0.5],
        [
          filter(tone('square', 0.3, glide(660, 330, 0.2), perc(0.3, 0.01, 0.25)), 'lowpass', 1800),
          0.18,
        ],
      ),
  },
  {
    // A boss going down: a long falling roar, a sub drop and a room behind it.
    id: 'death-boss',
    loudness: -10,
    render: (random) =>
      roomy(
        sum(
          [hiss(random, 1.3, 'lowpass', glide(5000, 120, 0.6), perc(1.3, 0.005, 1.1)), 1],
          [tone('sine', 1.0, glide(80, 30, 0.5), perc(1.0, 0.003, 0.9)), 0.9],
          [hiss(random, 0.5, 'bandpass', 900, perc(0.5, 0.001, 0.3), 3), 0.5],
        ),
        0.35,
      ),
  },
  {
    // The fortress taking a blow: a heavy thump and a struck-metal ring.
    id: 'fortress-hit',
    loudness: -12,
    render: (random) =>
      sum(
        [tone('sine', 0.4, glide(95, 45, 0.12), perc(0.4, 0.002, 0.35)), 1],
        [
          partials(0.6, [
            [220, 0.4, 0.5],
            [347, 0.3, 0.4],
            [516, 0.25, 0.3],
            [731, 0.15, 0.2],
          ]),
          0.5,
        ],
        [hiss(random, 0.08, 'lowpass', 1200, perc(0.08, 0.001, 0.06)), 0.6],
      ),
  },

  // ------------------------------------------------------------ the match
  {
    // A war horn: root and fifth in saws, the filter opening like breath, over
    // a single drum.
    id: 'wave-start',
    loudness: -12,
    render: (random) => {
      const horn = new Float32Array(samples(1.3));
      const env = adsr(0.8, { attack: 0.08, decay: 0.3, sustain: 0.8, release: 0.45 });
      for (const [f, level] of [
        [110, 1],
        [110.6, 0.7],
        [165, 0.6],
        [220, 0.35],
      ] as const) {
        const voice = osc('saw', 1.25, f, { vibrato: { depth: 0.12, rate: 5, delay: 0.3 } });
        add(horn, mul(voice, env), 0, level);
      }
      const shaped = filter(horn, 'lowpass', (t) =>
        t < 0.25 ? 400 + t * 5600 : 1800 - (t - 0.25) * 900,
      );
      return roomy(
        sum(
          [shaped, 0.5],
          [tone('sine', 0.5, glide(120, 45, 0.1), perc(0.5, 0.002, 0.4)), 0.9],
          [hiss(random, 0.1, 'lowpass', 1500, perc(0.1, 0.001, 0.07)), 0.4],
        ),
        0.3,
      );
    },
  },
  {
    // A wave beaten: a bright arpeggio up a major chord.
    id: 'wave-cleared',
    loudness: -15,
    render: () => {
      const out = new Float32Array(samples(1.0));
      [72, 76, 79, 84].forEach((note, i) =>
        add(out, bell(hz(note), 0.7, 0.5), samples(i * 0.08), 0.6),
      );
      return out;
    },
  },
  {
    // Something sent at you: a two-tone alarm, twice.
    id: 'send-incoming',
    loudness: -17,
    render: () => {
      const out = new Float32Array(samples(0.46));
      [880, 660, 880, 660].forEach((f, i) =>
        add(
          out,
          filter(
            tone(
              'square',
              0.1,
              f,
              adsr(0.08, { attack: 0.004, decay: 0.05, sustain: 0.7, release: 0.02 }),
            ),
            'lowpass',
            3000,
          ),
          samples(i * 0.11),
        ),
      );
      return out;
    },
  },
  {
    // A send leaving: a whoosh of rising noise and a rising tone.
    id: 'send-launch',
    loudness: -18,
    render: (random) => {
      const swell = adsr(0.12, { attack: 0.1, decay: 0.05, sustain: 0.8, release: 0.16 });
      return sum(
        [hiss(random, 0.28, 'bandpass', glide(600, 3500, 0.25), swell, 2), 1],
        [tone('sine', 0.28, glide(300, 900, 0.25), swell), 0.3],
      );
    },
  },

  // ------------------------------------------------------------ building
  {
    // A unit set down: a wooden clack.
    id: 'build-place',
    loudness: -16,
    render: (random) =>
      sum(
        [tone('triangle', 0.1, glide(520, 480, 0.05), perc(0.1, 0.001, 0.06)), 0.7],
        [hiss(random, 0.02, 'highpass', 1500, perc(0.02, 0.0005, 0.015)), 0.5],
        [tone('sine', 0.08, 180, perc(0.08, 0.001, 0.06)), 0.6],
      ),
  },
  {
    // A unit upgraded: a quick rising triad.
    id: 'build-upgrade',
    loudness: -16,
    render: () => {
      const out = new Float32Array(samples(0.45));
      [79, 83, 86].forEach((note, i) =>
        add(
          out,
          filter(tone('square', 0.28, hz(note), perc(0.28, 0.002, 0.2), 0.25), 'lowpass', 4000),
          samples(i * 0.06),
          0.6,
        ),
      );
      return out;
    },
  },
  {
    // A unit sold: a coin.
    id: 'build-sell',
    loudness: -17,
    render: () => {
      const low = tone('square', 0.07, hz(83), perc(0.07, 0.001, 0.06), 0.5);
      const high = tone('square', 0.28, hz(88), perc(0.28, 0.001, 0.22), 0.5);
      return filter(sum([low, 0.7], [at(0.06, high), 0.7]), 'lowpass', 5000);
    },
  },
  {
    // Anything bought that is not a unit: a two-note chime up a fifth.
    id: 'buy',
    loudness: -16,
    render: () => sum([bell(hz(81), 0.3, 0.2), 0.6], [at(0.07, bell(hz(88), 0.3, 0.25)), 0.6]),
  },

  // ------------------------------------------------------------ the interface
  {
    // A toggle: the weapon's damage type, the aura.
    id: 'ui-switch',
    loudness: -20,
    render: (random) =>
      sum(
        [tone('triangle', 0.07, glide(1200, 900, 0.04), perc(0.07, 0.001, 0.05)), 1],
        [hiss(random, 0.015, 'highpass', 4000, perc(0.015, 0.0005, 0.01)), 0.3],
      ),
  },
  {
    // Any button: a small tick, quiet enough to hear a hundred times.
    id: 'ui-tap',
    loudness: -24,
    render: (random) =>
      sum(
        [tone('sine', 0.05, glide(1800, 1400, 0.03), perc(0.05, 0.0005, 0.03)), 1],
        [hiss(random, 0.01, 'highpass', 5000, perc(0.01, 0.0005, 0.006)), 0.25],
      ),
  },
  {
    // A refusal: two low notes, falling.
    id: 'ui-denied',
    loudness: -18,
    render: () => {
      const env = (gate: number) =>
        adsr(gate, { attack: 0.004, decay: 0.05, sustain: 0.8, release: 0.03 });
      return filter(
        sum(
          [tone('square', 0.12, 196, env(0.09)), 0.6],
          [at(0.1, tone('square', 0.15, 147, env(0.12))), 0.6],
        ),
        'lowpass',
        1500,
      );
    },
  },

  // ------------------------------------------------------------ the end
  {
    // Winning: a quick run up to a held major chord.
    id: 'match-victory',
    loudness: -12,
    render: () => {
      const out = new Float32Array(samples(2.4));
      [72, 76, 79].forEach((note, i) => add(out, bell(hz(note), 0.4, 0.3), samples(i * 0.1), 0.5));
      const chord = new Float32Array(samples(2.2));
      for (const note of [60, 64, 67, 72]) {
        add(
          chord,
          mul(
            osc('saw', 2.2, hz(note)),
            adsr(1.3, { attack: 0.04, decay: 0.4, sustain: 0.6, release: 0.8 }),
          ),
          0,
          0.25,
        );
      }
      add(
        out,
        filter(chord, 'lowpass', (t) => 900 + 2500 * Math.exp(-t * 2)),
        samples(0.3),
        0.6,
      );
      add(out, bell(hz(84), 2.0, 1.6), samples(0.3), 0.7);
      return roomy(out, 0.4);
    },
  },
  {
    // Losing: a slow fall through a minor chord over a low drone.
    id: 'match-defeat',
    loudness: -13,
    render: () => {
      const out = new Float32Array(samples(2.6));
      [67, 63, 60].forEach((note, i) => {
        const len = i === 2 ? 1.6 : 0.5;
        const voice = mul(
          osc('triangle', len + 0.4, hz(note)),
          adsr(len, { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.4 }),
        );
        add(out, voice, samples(i * 0.42), 0.5);
      });
      const drone = new Float32Array(samples(2.4));
      for (const note of [36, 43, 48, 51]) {
        add(
          drone,
          mul(
            osc('saw', 2.4, hz(note)),
            adsr(1.7, { attack: 0.3, decay: 0.5, sustain: 0.7, release: 0.7 }),
          ),
          0,
          0.2,
        );
      }
      add(out, filter(drone, 'lowpass', 700), 0, 0.6);
      return roomy(out, 0.4);
    },
  },
  {
    // The Final Showdown opening: a gong under a low horn chord.
    id: 'showdown-start',
    loudness: -10,
    render: (random) => {
      const gong = partials(2.0, [
        [80, 1, 1.8],
        [128.5, 0.6, 1.5],
        [181, 0.5, 1.2],
        [237, 0.35, 1.0],
        [312, 0.3, 0.8],
        [402, 0.2, 0.6],
      ]);
      const horn = new Float32Array(samples(1.8));
      for (const note of [38, 45, 50, 53]) {
        add(
          horn,
          mul(
            osc('saw', 1.8, hz(note)),
            adsr(1.0, { attack: 0.12, decay: 0.3, sustain: 0.7, release: 0.7 }),
          ),
          0,
          0.25,
        );
      }
      return roomy(
        sum(
          [gong, 0.8],
          [filter(horn, 'lowpass', (t) => 500 + 1200 * Math.min(1, t * 4)), 0.5],
          [hiss(random, 0.15, 'lowpass', 2000, perc(0.15, 0.001, 0.1)), 0.4],
        ),
        0.45,
      );
    },
  },
  {
    // The count down to it: a woodblock.
    id: 'showdown-tick',
    loudness: -16,
    render: (random) =>
      sum(
        [tone('sine', 0.1, 1100, perc(0.1, 0.0008, 0.05)), 1],
        [tone('sine', 0.1, 1750, perc(0.1, 0.0008, 0.025)), 0.3],
        [hiss(random, 0.02, 'bandpass', 2500, perc(0.02, 0.0005, 0.012), 2), 0.4],
      ),
  },
];

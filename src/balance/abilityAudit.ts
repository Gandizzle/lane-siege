/**
 * What each ability is worth, measured. docs/BALANCE.md §4j.
 *
 * An ability is worth what an army loses without it. So this stands an army in
 * a lane against a wave it only just beats, switches one ability off, and
 * reads how much weaker a wave the army can then beat. "Weaker" is the wave's
 * `scale` - the multiple on every monster's health and damage (waves.ts) - so
 * the answer is a percentage of wave strength, and it means the same thing at
 * wave 4 as at wave 22.
 *
 * THE ARMIES are three, a tier each, and every builder fields the same shape:
 *
 *   early  600 gold of Mark I from its four cheaper lines
 *   mid    3,000 gold of Mark II from all six
 *   late   12,000 gold of Mark III from all six - the second abilities too
 *
 * with the gold split evenly between the lines (`army`), so every ability has
 * the same money standing behind it. Placement and the silent fortress are
 * the sandbox's (sandbox.ts): nothing the wall does is in the number.
 *
 * THE WAVES are every one of the sixteen armor-and-damage combinations, once,
 * twice or four times over, interleaved (`mixedWave`). Mixed on purpose: a
 * combination wave is a test of counters, and a counter is not an ability.
 * And `bossFight` puts one boss at a time against the same armies, because
 * some abilities are built for a big target and a crowd of small ones never
 * shows what they are for.
 *
 * THE ESTIMATE. Searching for the breaking wave with each ability off is the
 * obvious method and a noisy one: a fight is chaotic, an ability that rolls a
 * chance shifts every roll after it, and a search makes ten noisy decisions in
 * a row. Fighting every configuration at the one breaking wave is cheaper and
 * steadier but has a trap of its own: near that wave each fight is close to
 * the edge where an army collapses, and one point on a curve that bends
 * sharply there can say an ability that helps is hurting.
 *
 * And the curve does bend sharply. Margin falls gently while the army holds
 * and then drops off a cliff where it collapses, so an ability can do two
 * different things, and they are reported apart:
 *
 *   SURVIVAL  where the cliff is: the strongest wave the army still beats.
 *             Moving it is turning a loss into a win.
 *   COMFORT   how high the curve sits below the cliff: what is left of the
 *             army after a wave it beats. Raising it is turning a narrow win
 *             into an easy one.
 *
 * A seed is a different fight, not the same one again: the wave comes in a
 * different order and the army's rows stand in a different order along
 * themselves (`marginAt`). The game's dice alone are not enough - an army that
 * rolls none would fight one fight under every seed, and its mean would be a
 * single chaotic sample however many seeds were asked for.
 *
 * So the breaking wave is searched for once, with everything on, and then
 * every configuration is fought across a band of waves either side of it
 * (`GRID`, 0.6 to 1.4 times as strong) over many shared seeds. Where its mean
 * curve crosses an even fight (`crossing`), against where the full army's
 * does, is the survival figure; the mean gap between the two curves on the
 * easy side of the band is the comfort figure.
 */

import type { GameData } from '../data/schema.ts';
import { refId } from '../data/schema.ts';
import { Rng } from '../sim/index.ts';
import { chainPrice, lines } from './builds.ts';
import { runWave, type Buy, type Shopping } from './sandbox.ts';

export interface Tier {
  id: 'early' | 'mid' | 'late';
  /** The mark every body in the army is. */
  mark: number;
  gold: number;
  /** The lines it buys from. */
  rungs: readonly number[];
  /** Copies of each combination in its mixed wave. */
  perCombination: number;
  /** The wave row the fight borrows (any row: its scale is overwritten). */
  wave: number;
  /** Where to start looking for the breaking wave. */
  guess: number;
  /** The same for a lone boss. */
  bossGuess: number;
}

export const TIERS: readonly Tier[] = [
  {
    id: 'early',
    mark: 1,
    gold: 600,
    rungs: [1, 2, 3, 4],
    perCombination: 1,
    wave: 4,
    guess: 4.8,
    bossGuess: 4,
  },
  {
    id: 'mid',
    mark: 2,
    gold: 3000,
    rungs: [1, 2, 3, 4, 5, 6],
    perCombination: 2,
    wave: 12,
    guess: 18,
    bossGuess: 20,
  },
  {
    id: 'late',
    mark: 3,
    gold: 12000,
    rungs: [1, 2, 3, 4, 5, 6],
    perCombination: 4,
    wave: 22,
    guess: 50,
    bossGuess: 120,
  },
];

/** The margin of an even fight: what is left of the army equals what is left of the wave. */
const TARGET_MARGIN = 0;

/** The tier's army for a builder: its gold split evenly between its lines. */
export function army(data: GameData, builderId: string, tier: Tier): Shopping {
  const chains = lines(data, builderId);
  const buys: Buy[] = [];
  let gold = 0;
  let supply = 0;
  const share = tier.gold / tier.rungs.length;
  for (const rung of tier.rungs) {
    const price = chainPrice(chains.get(rung) ?? [], tier.mark);
    const count = Math.max(1, Math.round(share / price.gold));
    for (let i = 0; i < count; i++) buys.push({ rung, mark: tier.mark });
    gold += count * price.gold;
    supply += count * price.supply;
  }
  return { buys, gold, supply };
}

/** The data with the tier's wave row replaced by a mixed wave of every combination. */
export function mixedWave(data: GameData, tier: Tier): GameData {
  const copy = structuredClone(data);
  const entries: { monsterId: string; count: number }[] = [];
  for (let i = 0; i < tier.perCombination; i++) {
    for (const c of copy.waves.combinations) entries.push({ monsterId: c.monsterId, count: 1 });
  }
  const row = copy.waves.composition.find((w) => w.wave === tier.wave)!;
  row.entries = entries;
  return copy;
}

/** The data with the tier's wave row replaced by one boss, alone. */
export function bossFight(data: GameData, tier: Tier, bossId: string): GameData {
  const copy = structuredClone(data);
  const row = copy.waves.composition.find((w) => w.wave === tier.wave)!;
  row.entries = [{ monsterId: bossId, count: 1 }];
  return copy;
}

/** Set how strong the borrowed row's monsters are, boss or not. */
function setStrength(data: GameData, tier: Tier, scale: number, boss: boolean): void {
  const row = data.waves.composition.find((w) => w.wave === tier.wave)!;
  if (boss) row.bossScale = scale;
  else row.scale = scale;
}

/** The data with one ability taken off whichever units or monsters carry it. */
export function without(data: GameData, abilityId: string): GameData {
  const copy = structuredClone(data);
  const strip = (refs: (typeof copy.units.units)[number]['abilities']) =>
    (refs ?? []).filter((ref) => refId(ref) !== abilityId);
  for (const unit of copy.units.units) unit.abilities = strip(unit.abilities);
  for (const m of [...copy.monsters.monsters, ...copy.monsters.bosses])
    m.abilities = strip(m.abilities);
  return copy;
}

export interface Fight {
  data: GameData;
  builderId: string;
  tier: Tier;
  shopping: Shopping;
  boss: boolean;
  /** Seeds are `seedBase + 1` on; a different base is an independent sample. */
  seedBase?: number;
}

/**
 * Mean margin over `seeds` fights at this strength.
 *
 * Each seed is a different fight: the wave arrives in a different order and
 * every row of the army stands in a different order along itself. Without that
 * an army that rolls no dice fights the same fight under every seed - the wave
 * and the formation are fixed - and a mean over a dozen seeds is one sample.
 */
export function marginAt(fight: Fight, scale: number, seeds: number): number {
  setStrength(fight.data, fight.tier, scale, fight.boss);
  const row = fight.data.waves.composition.find((w) => w.wave === fight.tier.wave)!;
  const authored = row.entries ?? [];
  let total = 0;
  try {
    for (let s = 1; s <= seeds; s++) {
      const seed = (fight.seedBase ?? 1000) + s;
      row.entries = shuffled(authored, new Rng(seed));
      total += runWave(fight.data, fight.builderId, fight.shopping, fight.tier.wave, seed, {
        shuffle: true,
      }).margin;
    }
  } finally {
    row.entries = authored;
  }
  return total / seeds;
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The wave strength this army beats with `TARGET_MARGIN` to spare. */
export function breakingStrength(fight: Fight, around: number, seeds: number, steps = 12): number {
  let lo = around / 12;
  let hi = around * 12;
  for (let i = 0; i < steps; i++) {
    const mid = Math.sqrt(lo * hi);
    if (marginAt(fight, mid, seeds) > TARGET_MARGIN) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** The band of wave strengths every configuration is fought across, as multiples of the breaking wave. */
export const GRID = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4] as const;

/** The part of the band where the army is expected to win: comfort is read here. */
const EASY = 0.9;

/** Mean margin at each strength in `GRID` around `scale`. */
export function curveAt(fight: Fight, scale: number, seeds: number): number[] {
  return GRID.map((m) => marginAt(fight, scale * m, seeds));
}

/**
 * Where a curve first falls to an even fight, as a multiple of the breaking
 * wave, interpolated in log strength between the two grid points either side.
 * Off the band at either end it is pinned to the end, which the report marks.
 */
export function crossing(curve: readonly number[]): number {
  if (curve[0]! <= TARGET_MARGIN) return GRID[0];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (b > TARGET_MARGIN) continue;
    const t = (a - TARGET_MARGIN) / (a - b);
    const la = Math.log(GRID[i - 1]!);
    const lb = Math.log(GRID[i]!);
    return Math.exp(la + t * (lb - la));
  }
  return GRID[GRID.length - 1]!;
}

/** What taking something away cost, by both measures. */
export interface Worth {
  /** Strongest wave beaten, as a fraction lost: 0.1 is a wave 10% weaker. */
  survival: number;
  /** Margin lost on the waves it still beats, in points of the whole fight. */
  comfort: number;
  /** True when either curve ran off the band, so `survival` is a bound. */
  offBand: boolean;
}

export function worth(full: readonly number[], reduced: readonly number[]): Worth {
  const a = crossing(full);
  const b = crossing(reduced);
  let gap = 0;
  let n = 0;
  GRID.forEach((m, i) => {
    if (m > EASY) return;
    gap += full[i]! - reduced[i]!;
    n += 1;
  });
  const ends = [GRID[0], GRID[GRID.length - 1]] as number[];
  return {
    survival: 1 - b / a,
    comfort: n > 0 ? gap / n : 0,
    offBand: ends.includes(a) || ends.includes(b),
  };
}

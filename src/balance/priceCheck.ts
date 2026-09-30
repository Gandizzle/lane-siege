/**
 * Whether a price is right, read off a wave sweep. docs/BALANCE.md §4e.
 *
 * Two questions, both answered from the outcomes `npm run waves` already
 * produces, and both what the price pass was tuned against:
 *
 *   `lineWorth`      is each line's gold worth more or less than the gold spent
 *                    on the lines it competes with - the other builders' units
 *                    at the same rung and mark, which is the same role at the
 *                    same ladder price? A line well ahead is underpriced.
 *   `goldToClearHalf` how much gold each builder needs, as a fraction of the
 *                    wave's nominal, before half the armies it could buy clear
 *                    the wave. Lower is stronger. Averaged over five-wave
 *                    blocks it says which builder is ahead in which part of the
 *                    game, which is what a builder's prices as a whole move.
 */

import type { GameData } from '../data/schema.ts';
import { Rng } from '../sim/rng.ts';
import type { WaveOutcome } from './sandbox.ts';

export interface LineWorth {
  defId: string;
  builderId: string;
  rung: number;
  mark: number;
  goldCost: number;
  /**
   * Margin the line's gold bought over the average of its rung-mates', per
   * whole army's worth of gold spent on it. The raw regression number.
   */
  relative: number;
  /** Its bootstrap standard error. */
  error: number;
  /**
   * `relative` as gold: 1.1 means a gold spent on this line did what 1.1 gold
   * spent on its rung-mates did. The price that would even it out is roughly
   * the current one times this.
   */
  worth: number;
  /** More than twice its error from even, and more than 8% off. */
  clear: boolean;
}

export interface LineWorthOptions {
  /** Ridge penalty. Lines that are rarely bought are pulled towards even. */
  ridge?: number;
  /** Bootstrap resamples, for the error. */
  resamples?: number;
  seed?: number;
}

/**
 * Per line, how its gold did against its rung-mates'.
 *
 * Within every (wave, builder, gold band) the armies differ only in what the
 * same gold was spent on, so a regression of margin on the SHARE of the gold
 * each line took - centred within that group, so the wave and the band drop
 * out - says what moving the army's gold into that line did to the margin.
 * Lines always appear alongside others, so it is one regression over all of
 * them rather than a comparison of averages, and ridge so that a line bought
 * in a handful of armies is not credited with a heroic coefficient.
 *
 * The margin is then turned into gold using how margin moves with gold in the
 * same sweep (`marginPerLogGold`), which needs at least two bands.
 */
export function lineWorth(
  data: GameData,
  outcomes: readonly WaveOutcome[],
  options: LineWorthOptions = {},
): LineWorth[] {
  const ridge = options.ridge ?? 2;
  const resamples = options.resamples ?? 60;
  const defs = new Map(data.units.units.map((u) => [u.id, u]));
  const ids = [...new Set(outcomes.flatMap((o) => o.lines.map((l) => l.defId)))].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const k = ids.length;

  // One centred block per group, as flat rows.
  const groups: { x: Float64Array[]; y: number[] }[] = [];
  for (const group of groupBy(outcomes, (o) => `${o.wave}|${o.builderId}|${o.goldBudget}`)) {
    if (group.length < 3) continue;
    const xs = group.map((o) => {
      const row = new Float64Array(k);
      const total = o.lines.reduce((sum, l) => sum + l.gold, 0) || 1;
      for (const l of o.lines) row[index.get(l.defId)!]! += l.gold / total;
      return row;
    });
    const ys = group.map((o) => o.margin);
    const meanX = new Float64Array(k);
    for (const row of xs) for (let j = 0; j < k; j++) meanX[j]! += row[j]! / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    groups.push({
      x: xs.map((row) => row.map((v, j) => v - meanX[j]!)),
      y: ys.map((v) => v - meanY),
    });
  }
  if (groups.length === 0) return [];

  const fit = (pick: readonly number[]): Float64Array => {
    const a = Array.from({ length: k }, () => new Float64Array(k));
    const b = new Float64Array(k);
    for (const g of pick) {
      const { x, y } = groups[g]!;
      for (let r = 0; r < x.length; r++) {
        const row = x[r]!;
        for (let i = 0; i < k; i++) {
          const xi = row[i]!;
          if (xi === 0) continue;
          b[i]! += xi * y[r]!;
          const ai = a[i]!;
          for (let j = 0; j < k; j++) ai[j]! += xi * row[j]!;
        }
      }
    }
    for (let i = 0; i < k; i++) a[i]![i]! += ridge;
    return solve(a, b);
  };

  const all = groups.map((_, i) => i);
  const beta = fit(all);
  const rng = new Rng(options.seed ?? 1);
  const boots = Array.from({ length: resamples }, () => fit(all.map(() => rng.int(groups.length))));

  const slope = marginPerLogGold(outcomes);
  const peers = groupBy(ids, (id) => {
    const d = defs.get(id);
    return `${d?.rung ?? 0}|${d?.mark ?? 0}`;
  });
  const out: LineWorth[] = [];
  for (const row of peers) {
    const at = row.map((id) => index.get(id)!);
    const centre = (v: ArrayLike<number>): number => at.reduce((s, i) => s + v[i]!, 0) / at.length;
    const mid = centre(beta);
    const bootMids = boots.map(centre);
    for (const id of row) {
      const i = index.get(id)!;
      const d = defs.get(id)!;
      const relative = beta[i]! - mid;
      const spread = boots.map((b, n) => b[i]! - bootMids[n]!);
      const mean = spread.reduce((a, b) => a + b, 0) / spread.length;
      const error = Math.sqrt(spread.reduce((s, v) => s + (v - mean) ** 2, 0) / spread.length);
      const worth = Math.exp(relative / slope);
      out.push({
        defId: id,
        builderId: d.builderId,
        rung: d.rung,
        mark: d.mark,
        goldCost: d.goldCost ?? 0,
        relative,
        error,
        worth,
        clear: Math.abs(relative) > 2 * error && Math.abs(worth - 1) > 0.08,
      });
    }
  }
  return out.sort(
    (a, b) => a.rung - b.rung || a.mark - b.mark || a.builderId.localeCompare(b.builderId),
  );
}

/**
 * How much margin a doubling of gold buys, per natural log of gold: the median
 * over every (wave, builder) of the mean margin's rise from the lowest band to
 * the highest. About 1.65 in the sweep the price pass was tuned on. With one
 * band there is nothing to read, and that figure stands in.
 */
export function marginPerLogGold(outcomes: readonly WaveOutcome[]): number {
  const slopes: number[] = [];
  for (const group of groupBy(outcomes, (o) => `${o.wave}|${o.builderId}`)) {
    const bands = groupBy(group, (o) => String(o.goldBudget)).map((b) => ({
      gold: b[0]!.goldBudget,
      margin: b.reduce((s, o) => s + o.margin, 0) / b.length,
    }));
    if (bands.length < 2) continue;
    bands.sort((a, b) => a.gold - b.gold);
    const lo = bands[0]!;
    const hi = bands[bands.length - 1]!;
    if (hi.gold > lo.gold) slopes.push((hi.margin - lo.margin) / Math.log(hi.gold / lo.gold));
  }
  if (slopes.length === 0) return 1.65;
  slopes.sort((a, b) => a - b);
  return Math.max(0.5, slopes[slopes.length >> 1]!);
}

/**
 * Per (builder, wave): the gold, as a fraction of the middle band, at which
 * half the builder's armies clear. Read between the bands on a log scale; past
 * the ends, extrapolated along the sweep's own slope (never flatter than 0.8
 * of clear rate per log of gold, so a wave everything clears does not run off
 * to zero).
 */
export function goldToClearHalf(outcomes: readonly WaveOutcome[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const group of groupBy(outcomes, (o) => `${o.builderId}|${o.wave}`)) {
    const bands = groupBy(group, (o) => String(o.goldBudget))
      .map((b) => ({
        gold: b[0]!.goldBudget,
        clear: b.filter((o) => o.cleared).length / b.length,
      }))
      .sort((a, b) => a.gold - b.gold);
    if (bands.length < 2) continue;
    const nominal = bands[bands.length >> 1]!.gold;
    const pts = bands.map((b) => ({ x: Math.log(b.gold / nominal), y: b.clear }));
    let x: number | null = null;
    for (let i = 1; i < pts.length && x === null; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if ((a.y - 0.5) * (b.y - 0.5) <= 0 && a.y !== b.y) {
        x = a.x + ((0.5 - a.y) * (b.x - a.x)) / (b.y - a.y);
      }
    }
    if (x === null) {
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      const slope = Math.max(0.8, (last.y - first.y) / (last.x - first.x));
      const end = first.y > 0.5 ? first : last;
      x = end.x + (0.5 - end.y) / slope;
    }
    out.set(`${group[0]!.builderId}|${group[0]!.wave}`, Math.exp(x));
  }
  return out;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return [...map.values()];
}

/** Gaussian elimination with partial pivoting. `a` is consumed. */
function solve(a: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const p = a[col]![col]!;
    if (p === 0) continue;
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / p;
      if (f === 0) continue;
      const ar = a[r]!;
      const ac = a[col]!;
      for (let c = col; c < n; c++) ar[c]! -= f * ac[c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]!;
    for (let c = r + 1; c < n; c++) sum -= a[r]![c]! * x[c]!;
    x[r] = a[r]![r]! !== 0 ? sum / a[r]![r]! : 0;
  }
  return x;
}

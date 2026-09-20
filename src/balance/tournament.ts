/**
 * The round robin, and the controls that have to pass before its numbers mean
 * anything. docs/BALANCE.md.
 *
 * THE CONTROLS COME FIRST, and they are not a formality.
 *
 *   MIRROR - four copies of one builder running one build. The correct answer
 *            is 25% a seat. Anything else is the ARENA being unfair, not the
 *            roster, and every builder number in the report would inherit it.
 *   SEATS  - win rate by seat across every four-way fight, with the seating
 *            drawn at random. The arena is a cross whose four spokes are meant
 *            to be one spoke rotated; if they are not, a builder's result is
 *            partly a statement about where it happened to stand.
 *
 * THEN THE DUELS, which are the primary signal. A four-way free-for-all is
 * confounded by who converges on whom: a player nobody walks at wins fights
 * they never fought. One-on-one has no such thing, so builder parity is settled
 * there and the four-way is a check for what only emerges with four.
 *
 * MARGIN, NOT JUST WINS. A 51/49 matchup and a 51/49 matchup where the loser is
 * wiped to the last body are different problems, and only surviving supply
 * tells them apart.
 *
 * PLAN, RUN, SUMMARISE - in three pieces on purpose. The plan is a pure
 * function of the options, so a run is reproducible and can be SHARDED: four
 * processes each running a quarter of the list produce the same records as one
 * process running all of it, and the summary is built from the concatenation.
 * A four-way fight between diverse armies costs about fifteen seconds - every
 * distinct (radius, range) among the seekers needs its own flow field, every
 * tick - so sharding is what makes a run with enough fights to mean something
 * finish inside a coffee break.
 */

import type { GameData } from '../data/schema.ts';
import { Rng } from '../sim/index.ts';
import { computeBudget } from './budget.ts';
import { BUILD_SPECS, realise, type Army, type BuildSpec } from './builds.ts';
import { runArena } from './arena.ts';

export interface TournamentOptions {
  /** Duels per builder pair. Each is played at both seatings, so ×2 fights. */
  duelsPerPair: number;
  /** Four-way fights, with builds drawn at random and seating shuffled. */
  freeForAlls: number;
  /** Mirror fights per builder: four copies of it, all on one build. */
  mirrors: number;
  seed: number;
  /** Which builds to draw from. Defaults to all of BUILD_SPECS. */
  specIds?: readonly string[];
}

export const DEFAULTS: TournamentOptions = {
  duelsPerPair: 40,
  freeForAlls: 80,
  mirrors: 20,
  seed: 20260920,
};

export type FightKind = 'mirror' | 'duel' | 'ffa';

/** One fight, named entirely by data, so it can be sent to another process. */
export interface FightPlan {
  kind: FightKind;
  /** Seat order. Each entry is the builder and the build standing in that seat. */
  seats: { builderId: string; specId: string }[];
  seed: number;
  /**
   * Both seatings of one duel share this, so the pair can be scored as a pair
   * rather than as two unrelated fights.
   */
  pairKey?: string;
}

/** What one seat did in one fight. The raw material every number is built from. */
export interface FightRecord {
  kind: FightKind;
  pairKey?: string;
  seat: number;
  builderId: string;
  specId: string;
  won: boolean;
  placement: number | null;
  survivingSupply: number;
  seats: number;
  ticks: number;
  timedOut: boolean;
}

/**
 * Every fight the tournament will run, in order, decided before any of them
 * happens.
 *
 * Pure in the options: two callers with the same options get the same list,
 * which is what makes `--shard` sound. Nothing here touches the arena.
 */
export function planFights(data: GameData, options: Partial<TournamentOptions> = {}): FightPlan[] {
  const opts: TournamentOptions = { ...DEFAULTS, ...options };
  const specs = specsFor(opts);
  const builders = data.units.builders.filter((b) => b.complete).map((b) => b.id);
  const rng = new Rng(opts.seed);
  const plans: FightPlan[] = [];

  // Mirrors. Four copies of one builder on one build: the only thing that can
  // separate them is where they stand.
  for (const builderId of builders) {
    for (let i = 0; i < opts.mirrors; i++) {
      const specId = specs[rng.int(specs.length)]!.id;
      plans.push({
        kind: 'mirror',
        seats: [0, 1, 2, 3].map(() => ({ builderId, specId })),
        seed: rng.int(1e9),
      });
    }
  }

  // Duels, both seatings of each, so a matchup cannot be a statement about
  // which spoke the arena favours.
  for (let i = 0; i < builders.length; i++) {
    for (let j = i + 1; j < builders.length; j++) {
      const a = builders[i]!;
      const b = builders[j]!;
      for (let n = 0; n < opts.duelsPerPair; n++) {
        const specA = specs[rng.int(specs.length)]!.id;
        const specB = specs[rng.int(specs.length)]!.id;
        const seed = rng.int(1e9);
        const pairKey = `${a}|${b}`;
        plans.push({
          kind: 'duel',
          pairKey,
          seed,
          seats: [
            { builderId: a, specId: specA },
            { builderId: b, specId: specB },
          ],
        });
        plans.push({
          kind: 'duel',
          pairKey,
          seed,
          seats: [
            { builderId: b, specId: specB },
            { builderId: a, specId: specA },
          ],
        });
      }
    }
  }

  // Four-ways: one of each builder, each on its own build, seated at random.
  for (let i = 0; i < opts.freeForAlls; i++) {
    const order = shuffle(builders, rng);
    plans.push({
      kind: 'ffa',
      seats: order.map((builderId) => ({ builderId, specId: specs[rng.int(specs.length)]!.id })),
      seed: rng.int(1e9),
    });
  }

  return plans;
}

/** Run a list of plans. `onFight` is for progress on a run that takes minutes. */
export function runFights(
  data: GameData,
  plans: readonly FightPlan[],
  onFight?: (done: number, total: number) => void,
): FightRecord[] {
  const budget = computeBudget(data);
  const cache = new Map<string, Army>();
  const armyFor = (builderId: string, specId: string): Army => {
    const key = `${builderId}/${specId}`;
    let army = cache.get(key);
    if (!army) {
      const spec = BUILD_SPECS.find((s) => s.id === specId);
      if (!spec) throw new Error(`no such build: ${specId}`);
      army = realise(data, builderId, spec, budget.armyGold, budget.armySupply);
      cache.set(key, army);
    }
    return army;
  };

  const records: FightRecord[] = [];
  for (const [i, plan] of plans.entries()) {
    const armies = plan.seats.map((s) => armyFor(s.builderId, s.specId));
    const result = runArena(data, armies, plan.seed);
    for (const seat of result.seats) {
      records.push({
        kind: plan.kind,
        ...(plan.pairKey !== undefined && { pairKey: plan.pairKey }),
        seat: seat.seat,
        builderId: seat.builderId,
        specId: seat.specId,
        won: seat.won,
        placement: seat.placement,
        survivingSupply: seat.survivingSupply,
        seats: plan.seats.length,
        ticks: result.ticks,
        timedOut: result.timedOut,
      });
    }
    onFight?.(i + 1, plans.length);
  }
  return records;
}

// ------------------------------------------------------------------ summary

/** Wins and margin for one thing being counted - a builder, a build, a seat. */
export interface Tally {
  key: string;
  fights: number;
  wins: number;
  winRate: number;
  /** Standard error on that rate, so a difference can be told from noise. */
  error: number;
  /** Mean surviving supply as a fraction of what walked in. */
  margin: number;
  /** Mean placement, where 1 is a win. Lower is better. */
  placement: number;
}

export interface Matchup {
  a: string;
  b: string;
  fights: number;
  /** Fights `a` won, as a fraction. 0.5 is even. */
  aWinRate: number;
  error: number;
  aMargin: number;
  bMargin: number;
}

export interface SpendRow {
  specId: string;
  builderId: string;
  bodies: number;
  goldSpent: number;
  goldBudget: number;
  supplyUsed: number;
  supplyBudget: number;
  tilesShort: number;
}

export interface TournamentReport {
  options: TournamentOptions;
  budget: { gold: number; supply: number };
  mirror: Tally[];
  seats: Tally[];
  duels: Matchup[];
  duelBuilders: Tally[];
  ffaBuilders: Tally[];
  builds: Tally[];
  spend: SpendRow[];
  fights: number;
  timeouts: number;
  meanSeconds: number;
}

/**
 * The standard error on a win rate.
 *
 * Printed beside every headline number, because the most expensive mistake
 * available here is nerfing a builder over forty fights of noise. At an even
 * 50% and n fights it is sqrt(0.25 / n): plus or minus 3 points needs about
 * 280 fights, and plus or minus 1 needs 2,500.
 */
export function standardError(rate: number, fights: number): number {
  if (fights <= 0) return 0;
  return Math.sqrt((rate * (1 - rate)) / fights);
}

class Counter {
  private readonly rows = new Map<
    string,
    { fights: number; wins: number; margin: number; placement: number }
  >();

  add(key: string, r: FightRecord): void {
    const row = this.rows.get(key) ?? { fights: 0, wins: 0, margin: 0, placement: 0 };
    row.fights += 1;
    row.wins += r.won ? 1 : 0;
    row.margin += r.survivingSupply;
    // A fight the tick cap cut off has no placement. Counting it as last is the
    // least flattering reading and keeps the mean defined; the report says how
    // many there were so a run full of them is not mistaken for a result.
    row.placement += r.placement ?? r.seats;
    this.rows.set(key, row);
  }

  tallies(): Tally[] {
    return [...this.rows.entries()]
      .map(([key, r]) => {
        const winRate = r.fights > 0 ? r.wins / r.fights : 0;
        return {
          key,
          fights: r.fights,
          wins: r.wins,
          winRate,
          error: standardError(winRate, r.fights),
          margin: r.fights > 0 ? r.margin / r.fights : 0,
          placement: r.fights > 0 ? r.placement / r.fights : 0,
        };
      })
      .sort((a, b) => b.winRate - a.winRate);
  }
}

export function summarise(
  data: GameData,
  records: readonly FightRecord[],
  options: Partial<TournamentOptions> = {},
): TournamentReport {
  const opts: TournamentOptions = { ...DEFAULTS, ...options };
  const budget = computeBudget(data);

  const mirror = new Counter();
  const seats = new Counter();
  const duelBuilders = new Counter();
  const ffaBuilders = new Counter();
  const builds = new Counter();
  const matchups = new Map<
    string,
    { fights: number; aWins: number; aMargin: number; bMargin: number }
  >();

  let ticks = 0;
  let fights = 0;
  let timeouts = 0;

  for (const r of records) {
    if (r.kind === 'mirror') mirror.add(`seat ${r.seat}`, r);
    if (r.kind === 'ffa') {
      ffaBuilders.add(r.builderId, r);
      seats.add(`seat ${r.seat}`, r);
      builds.add(r.specId, r);
    }
    if (r.kind === 'duel') {
      duelBuilders.add(r.builderId, r);
      builds.add(r.specId, r);
    }
  }

  // Duels are scored as pairs: a record for `a` and a record for `b` in the
  // same fight, joined by the seat order they were planned in.
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.kind !== 'duel' || r.seat !== 0 || !r.pairKey) continue;
    const other = records[i + 1];
    if (!other || other.kind !== 'duel' || other.seat !== 1) continue;

    const [a] = r.pairKey.split('|') as [string, string];
    const forA = r.builderId === a ? r : other;
    const forB = r.builderId === a ? other : r;

    const row = matchups.get(r.pairKey) ?? { fights: 0, aWins: 0, aMargin: 0, bMargin: 0 };
    row.fights += 1;
    row.aWins += forA.won ? 1 : 0;
    row.aMargin += forA.survivingSupply;
    row.bMargin += forB.survivingSupply;
    matchups.set(r.pairKey, row);
  }

  // One row per fight, for the totals.
  for (let i = 0; i < records.length;) {
    const r = records[i]!;
    fights += 1;
    ticks += r.ticks;
    if (r.timedOut) timeouts += 1;
    i += r.seats;
  }

  const specIds = specsFor(opts).map((s) => s.id);
  const spend: SpendRow[] = [];
  for (const builder of data.units.builders.filter((b) => b.complete)) {
    for (const specId of specIds) {
      const spec = BUILD_SPECS.find((s) => s.id === specId)!;
      const army = realise(data, builder.id, spec, budget.armyGold, budget.armySupply);
      spend.push({
        specId,
        builderId: builder.id,
        bodies: army.units.length,
        goldSpent: army.goldSpent,
        goldBudget: army.goldBudget,
        supplyUsed: army.supplyUsed,
        supplyBudget: army.supplyBudget,
        tilesShort: army.tilesShort,
      });
    }
  }

  return {
    options: opts,
    budget: { gold: budget.armyGold, supply: budget.armySupply },
    mirror: mirror.tallies().sort((x, y) => x.key.localeCompare(y.key)),
    seats: seats.tallies().sort((x, y) => x.key.localeCompare(y.key)),
    duels: [...matchups.entries()].map(([key, row]) => {
      const [a, b] = key.split('|') as [string, string];
      const aWinRate = row.fights > 0 ? row.aWins / row.fights : 0;
      return {
        a,
        b,
        fights: row.fights,
        aWinRate,
        error: standardError(aWinRate, row.fights),
        aMargin: row.fights > 0 ? row.aMargin / row.fights : 0,
        bMargin: row.fights > 0 ? row.bMargin / row.fights : 0,
      };
    }),
    duelBuilders: duelBuilders.tallies(),
    ffaBuilders: ffaBuilders.tallies(),
    builds: builds.tallies(),
    spend,
    fights,
    timeouts,
    meanSeconds: fights > 0 ? ticks / fights / 20 : 0,
  };
}

function specsFor(opts: TournamentOptions): readonly BuildSpec[] {
  if (!opts.specIds) return BUILD_SPECS;
  const wanted = new Set(opts.specIds);
  return BUILD_SPECS.filter((s) => wanted.has(s.id));
}

/** Fisher-Yates, on the simulation's own generator so a plan is reproducible. */
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

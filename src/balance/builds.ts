/**
 * Armies to bring to the Final Showdown, and how to spend a budget on one.
 *
 * A BUILD is not a list of units. It is a share of the supply budget per rung -
 * "a quarter of my supply in rung 5, the rest split low" - which is the shape
 * of the decision a player actually makes and the shape the balance question
 * is asked in. Naming units instead would make every build a statement about
 * one line rather than about the ladder, and there would be no way to ask
 * whether rung 5 is too strong without also asking about Sanction in
 * particular.
 *
 * `realise` turns a share into a real army, against real prices, through the
 * real purchase rules: fill the supply at Mark I, then spend what is left
 * going tall. A build that cannot afford its own shape comes back short, and
 * the report says so rather than quietly handing it a smaller army and calling
 * the result a balance finding.
 *
 * PLACEMENT IS BY REACH. Shortest range at the front, longest at the back,
 * filling outward from the middle of each row. That is what a competent player
 * does and it is what the arena rewards (a spoke's tileY 0 is the row nearest
 * the centre), so doing anything else would make every result a statement
 * about placement rather than about the roster.
 */

import type { GameData, UnitDef } from '../data/schema.ts';
import { markStepCost, markStepSupply } from './pricing.ts';

/** A share of the supply budget per rung, rung 1 first. Need not sum to 1. */
export type RungShares = readonly [number, number, number, number, number, number];

export interface BuildSpec {
  id: string;
  name: string;
  shares: RungShares;
}

/** One body in a realised army: which line, how far up it, and where it stands. */
export interface PlacedUnit {
  defId: string;
  rung: number;
  mark: number;
  tileX: number;
  tileY: number;
}

export interface Army {
  builderId: string;
  spec: BuildSpec;
  units: PlacedUnit[];
  goldSpent: number;
  supplyUsed: number;
  /** What it was given, so a build that could not spend it is visible. */
  goldBudget: number;
  supplyBudget: number;
  /** Bodies wanted but not placed, because the grid ran out of tiles. */
  tilesShort: number;
}

/**
 * The twenty builds every builder is measured on.
 *
 * Six of them are a single rung and nothing else. They are the diagnostic that
 * matters most: if rung 5 alone beats every mixed build in the game, rung 5 is
 * overpriced in value and no amount of staring at mixed results would separate
 * that from "the builder is strong". The rest span the shapes a player might
 * actually bring - bottom-heavy, top-heavy, barbell, and the even spread the
 * budget was designed around.
 */
export const BUILD_SPECS: readonly BuildSpec[] = [
  { id: 'pure1', name: 'All rung 1', shares: [1, 0, 0, 0, 0, 0] },
  { id: 'pure2', name: 'All rung 2', shares: [0, 1, 0, 0, 0, 0] },
  { id: 'pure3', name: 'All rung 3', shares: [0, 0, 1, 0, 0, 0] },
  { id: 'pure4', name: 'All rung 4', shares: [0, 0, 0, 1, 0, 0] },
  { id: 'pure5', name: 'All rung 5', shares: [0, 0, 0, 0, 1, 0] },
  { id: 'pure6', name: 'All rung 6', shares: [0, 0, 0, 0, 0, 1] },

  // The shape the budget was designed around, and its neighbours.
  { id: 'design', name: 'Designed spread', shares: [0.1, 0.1, 0.15, 0.15, 0.25, 0.25] },
  { id: 'even', name: 'Even sixths', shares: [1, 1, 1, 1, 1, 1] },
  { id: 'topheavy', name: 'Top heavy', shares: [0.05, 0.05, 0.1, 0.1, 0.3, 0.4] },
  { id: 'bottomheavy', name: 'Bottom heavy', shares: [0.3, 0.25, 0.2, 0.15, 0.1, 0] },
  { id: 'barbell', name: 'Barbell', shares: [0.3, 0.1, 0, 0, 0.2, 0.4] },
  { id: 'middle', name: 'Middle out', shares: [0.05, 0.15, 0.3, 0.3, 0.15, 0.05] },

  // Pairs, which is how a player who has found two units they like builds.
  { id: 'low2', name: 'Rungs 1 and 2', shares: [0.5, 0.5, 0, 0, 0, 0] },
  { id: 'mid2', name: 'Rungs 3 and 4', shares: [0, 0, 0.5, 0.5, 0, 0] },
  { id: 'high2', name: 'Rungs 5 and 6', shares: [0, 0, 0, 0, 0.5, 0.5] },
  { id: 'anchor', name: 'Cheap line, dear guns', shares: [0.35, 0, 0, 0, 0, 0.65] },
  { id: 'wall', name: 'Wall and artillery', shares: [0, 0, 0.45, 0, 0, 0.55] },

  // And three that deliberately refuse part of the ladder.
  { id: 'nolow', name: 'Nothing under rung 3', shares: [0, 0, 0.25, 0.25, 0.25, 0.25] },
  { id: 'nohigh', name: 'Nothing over rung 4', shares: [0.25, 0.25, 0.25, 0.25, 0, 0] },
  { id: 'skip', name: 'Every other rung', shares: [0.33, 0, 0.33, 0, 0.34, 0] },
];

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

/** Each of a builder's six lines, as the chain of marks it can reach. */
export function lines(data: GameData, builderId: string): Map<number, UnitDef[]> {
  const byId = new Map(data.units.units.map((u) => [u.id, u]));
  const out = new Map<number, UnitDef[]>();

  for (const unit of data.units.units) {
    if (unit.builderId !== builderId || unit.mark !== 1) continue;
    const chain: UnitDef[] = [];
    let current: UnitDef | undefined = unit;
    while (current) {
      chain.push(current);
      current = current.upgradesTo ? byId.get(current.upgradesTo) : undefined;
    }
    out.set(unit.rung, chain);
  }
  return out;
}

/**
 * The order tiles are filled: front row first, and outward from the middle of
 * each row so a line grows around the centre rather than from one edge.
 *
 * tileY 0 is the row a wave arrives at, and in the arena it is the row nearest
 * the centre (arena.ts). Front is front in both.
 */
export function placementOrder(data: GameData): { tileX: number; tileY: number }[] {
  const { width, depth } = data.lane.buildZone;
  const mid = Math.floor(width / 2);

  const columns: number[] = [];
  for (let offset = 0; offset < width; offset++) {
    const x = offset % 2 === 0 ? mid + (offset >> 1) : mid - 1 - (offset >> 1);
    if (x >= 0 && x < width) columns.push(x);
  }

  const tiles: { tileX: number; tileY: number }[] = [];
  for (let tileY = 0; tileY < depth; tileY++) {
    for (const tileX of columns) tiles.push({ tileX, tileY });
  }
  return tiles;
}

/**
 * Spend a budget on a build.
 *
 * Two passes, in the order a player spends. First BODIES: walk the rungs in
 * descending share so the shape survives a budget that runs out, and buy Mark I
 * bodies until each rung has its share of the supply. Then MARKS: upgrade the
 * highest-rung bodies first, because a mark is worth more on a dearer body and
 * a supply-capped player has nothing else to spend gold on.
 *
 * Neither pass is clever, and that is the point. A cleverer spender would be
 * measuring itself rather than the roster, and the harness reports gold left
 * over so a build the spender could not use is visible as exactly that.
 */
export function realise(
  data: GameData,
  builderId: string,
  spec: BuildSpec,
  goldBudget: number,
  supplyBudget: number,
): Army {
  const chains = lines(data, builderId);
  const total = spec.shares.reduce((a, b) => a + b, 0);
  let gold = goldBudget;
  let supply = supplyBudget;

  // rung -> how many bodies of it are standing, and at what mark.
  const bought: { rung: number; mark: number; def: UnitDef }[] = [];

  const order = [...spec.shares.entries()]
    .map(([i, share]) => ({ rung: i + 1, share }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share);

  for (const { rung, share } of order) {
    const chain = chains.get(rung);
    if (!chain || chain.length === 0) continue;
    const base = chain[0]!;

    const want = total > 0 ? (share / total) * supplyBudget : 0;
    let spent = 0;
    while (spent + num(base.supplyCost) <= want) {
      const cost = num(base.goldCost);
      if (cost > gold || num(base.supplyCost) > supply) break;
      gold -= cost;
      supply -= num(base.supplyCost);
      spent += num(base.supplyCost);
      bought.push({ rung, mark: 1, def: base });
    }
  }

  // Marks, dearest rung first. A body already at the top of its chain is
  // skipped; a chain with only two marks simply stops sooner.
  for (let mark = 2; mark <= 3; mark++) {
    const candidates = bought.filter((b) => b.mark === mark - 1).sort((a, b) => b.rung - a.rung);
    for (const body of candidates) {
      const chain = chains.get(body.rung)!;
      const next = chain[mark - 1];
      if (!next) continue;
      const cost = markStepCost(body.rung, mark);
      const supplyCost = markStepSupply(body.rung, mark);
      if (cost > gold || supplyCost > supply) continue;
      gold -= cost;
      supply -= supplyCost;
      body.mark = mark;
      body.def = next;
    }
  }

  // Shortest reach at the front. A stable sort keeps same-range bodies in the
  // order they were bought, which keeps a mirror match a mirror.
  bought.sort((a, b) => num(a.def.range) - num(b.def.range));

  const tiles = placementOrder(data);
  const units: PlacedUnit[] = [];
  for (const [i, body] of bought.entries()) {
    const tile = tiles[i];
    if (!tile) break;
    units.push({ defId: body.def.id, rung: body.rung, mark: body.mark, ...tile });
  }

  return {
    builderId,
    spec,
    units,
    goldSpent: goldBudget - gold,
    supplyUsed: supplyBudget - supply,
    goldBudget,
    supplyBudget,
    tilesShort: Math.max(0, bought.length - tiles.length),
  };
}

/**
 * "10/10/15/15/25/25": the shares as a player reads them off, normalised so
 * they sum to a hundred however they were typed in.
 */
export function sharesLabel(shares: RungShares): string {
  const total = shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'nothing';
  return shares.map((s) => Math.round((s / total) * 100)).join('/');
}

/**
 * Each rung's line name, so a row of an editor says "3. Vigil" rather than
 * only "3". A builder with a gap in its ladder gets an empty string rather
 * than a shifted list - `validate.ts` refuses that data, but a UI that
 * silently renumbered would hide it if it ever got through.
 */
export function lineNames(data: GameData, builderId: string): string[] {
  const out: string[] = [];
  for (let rung = 1; rung <= 6; rung++) {
    const def = data.units.units.find(
      (u) => u.builderId === builderId && u.rung === rung && u.mark === 1,
    );
    out.push(def?.name ?? '');
  }
  return out;
}

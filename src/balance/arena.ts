/**
 * Put armies in the Final Showdown's arena and see who is left. docs/BALANCE.md.
 *
 * This is the measuring instrument the whole first phase of balancing rests on,
 * so what it does and does not control for matters more than how fast it is.
 *
 * WHAT IT CONTROLS FOR
 *
 *   - Every seat gets the same gold and the same supply, from `computeBudget`.
 *   - Every seat gets the same tech: the two defensive ladders at the level the
 *     budget pays for, and one damage track chosen by what the army actually
 *     fields. A build of mostly-Blast units buys Blast, which is what a player
 *     would do, and every build gets exactly one track so nobody is buying
 *     four.
 *   - Seating is assigned by the caller, so a tournament can rotate it and ask
 *     whether the arena itself has a bias (`seatParity`). Until that comes back
 *     flat, no builder result means anything.
 *
 * WHAT IT DELIBERATELY DOES NOT
 *
 *   - The waves. Nothing here fights a monster. An army arrives at full health
 *     with full energy, which is what `beginShowdown` hands a real one, so this
 *     measures armies rather than the twenty-five waves that produced them.
 *     Whether a builder can AFFORD its showdown army is the wave phase's
 *     question and is asked separately.
 *   - Who focuses whom. Four armies converge on the centre and fight whatever
 *     they meet, which is what the arena does; it is also why a four-way result
 *     is confounded by who happened to be adjacent and why the duels are the
 *     primary signal.
 */

import type { GameData } from '../data/schema.ts';
import {
  createContext,
  createMatch,
  createUnit,
  recomputeUnitBuffs,
  buildDefIndex,
  stat,
  step,
  type MatchState,
  type SimContext,
} from '../sim/index.ts';
import type { Army } from './builds.ts';
import { totalCost } from './pricing.ts';

/** How a single arena fight came out, per seat. */
export interface SeatResult {
  teamId: string;
  seat: number;
  builderId: string;
  specId: string;
  /** 1 is the winner. Null only if the fight was cut off by the tick cap. */
  placement: number | null;
  won: boolean;
  /** Supply still standing at the end, as a fraction of what walked in. */
  survivingSupply: number;
  unitsBuilt: number;
  unitsLeft: number;
  goldSpent: number;
  supplyUsed: number;
}

export interface ArenaResult {
  seats: SeatResult[];
  /** Ticks the fight took, and whether it was still going when time ran out. */
  ticks: number;
  timedOut: boolean;
}

/**
 * A fight has to end. Dampening (waves.json `showdown.dampening`) is what makes
 * that true in the game, by fading healing and crowd control until two armies
 * that cannot finish each other finally do. This is the backstop for the case
 * where it does not - two armies that literally cannot reach each other - and a
 * run that hits it is reported rather than scored, because a draw is not a
 * result and averaging one in would quietly flatten every number in the report.
 */
export const MAX_SHOWDOWN_TICKS = 20 * 60 * 6;

/** Tech levels the budget pays for. Discrete, so the model's 3.5 rounds down. */
export const TECH_LEVEL = 3;

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

/**
 * The damage track an army would buy: whichever type most of its damage is.
 *
 * Weighted by each body's damage per second rather than counted by body, since
 * one rung 6 gun is most of an army's output and three rung 1 bodies are not.
 */
export function dominantDamageTrack(data: GameData, army: Army): string {
  const byId = new Map(data.units.units.map((u) => [u.id, u]));
  const weight = new Map<string, number>();

  for (const placed of army.units) {
    const def = byId.get(placed.defId);
    if (!def) continue;
    const dps = num(def.damage) * num(def.attackSpeed);
    weight.set(def.damageType, (weight.get(def.damageType) ?? 0) + dps);
  }

  let best = 'impact';
  let bestWeight = -1;
  for (const [type, w] of weight) {
    if (w > bestWeight) {
      best = type;
      bestWeight = w;
    }
  }
  return `dmg_${best}`;
}

/**
 * Run one fight. `armies` are seated in the order given, which is what a
 * tournament rotates.
 */
export function runArena(data: GameData, armies: readonly Army[], seed: number): ArenaResult {
  const teams = armies.map((army, seat) => ({
    id: `seat${seat}`,
    playerIds: [`p${seat}`],
    builderId: army.builderId,
  }));

  const state = createMatch(data, { seed, teams });
  const ctx = createContext(data);
  const defs = buildDefIndex(data);
  const byId = new Map(data.units.units.map((u) => [u.id, u]));
  const energyMax = stat(data.abilities.energy.max);

  armies.forEach((army, seat) => {
    const lane = state.lanes[`seat${seat}`]!;

    // The tech the budget bought. Set directly rather than purchased: the
    // purchase rules are the wave phase's business and the gold for it has
    // already been taken out of `armyGold` by the budget model.
    lane.economy.tech.def_hp = TECH_LEVEL;
    lane.economy.tech.def_speed = TECH_LEVEL;
    lane.economy.tech[dominantDamageTrack(data, army)] = TECH_LEVEL;

    for (const placed of army.units) {
      const def = byId.get(placed.defId);
      if (!def) continue;
      lane.units.push(createUnit(state, def, placed.tileX, placed.tileY, energyMax));
    }
    recomputeUnitBuffs(data, defs, lane);
  });

  const built = armies.map((_, seat) => state.lanes[`seat${seat}`]!.units.length);
  const supplyIn = armies.map((army) => army.supplyUsed);

  // Hand the match to the showdown the way a cleared wave 25 does, so the
  // transition is the simulation's own (`beginShowdown`, via `step`).
  state.wave = data.waves.showdown.afterWave;
  state.phase = 'combat';
  state.phaseTicksLeft = 0;

  let ticks = 0;
  while (!state.finished && ticks < MAX_SHOWDOWN_TICKS) {
    step(ctx, state);
    ticks++;
  }

  return {
    ticks,
    timedOut: !state.finished,
    seats: armies.map((army, seat) => {
      const team = state.teams.find((t) => t.id === `seat${seat}`)!;
      const alive = survivors(state, seat, byId);
      return {
        teamId: team.id,
        seat,
        builderId: army.builderId,
        specId: army.spec.id,
        placement: team.placement,
        won: team.placement === 1,
        survivingSupply: supplyIn[seat]! > 0 ? alive.supply / supplyIn[seat]! : 0,
        unitsBuilt: built[seat]!,
        unitsLeft: alive.count,
        goldSpent: army.goldSpent,
        supplyUsed: army.supplyUsed,
      };
    }),
  };
}

/**
 * What a seat has left, counted in SUPPLY rather than bodies.
 *
 * Bodies would say a build of thirty rung 1 units beat one of ten rung 6 units
 * by surviving with more of them, which is a statement about how the build was
 * priced rather than about how the fight went. Supply is the budget both of
 * them spent, so it is the currency a margin should be quoted in.
 */
function survivors(
  state: MatchState,
  seat: number,
  byId: Map<string, { rung: number; mark: number }>,
): { count: number; supply: number } {
  // After `beginShowdown` the bodies live on the army, not the lane.
  const army = state.showdown?.armies.find((a) => a.teamId === `seat${seat}`);
  const units = army ? army.units : (state.lanes[`seat${seat}`]?.units ?? []);

  let count = 0;
  let supply = 0;
  for (const unit of units) {
    if (!unit.alive) continue;
    count++;
    // A body's supply is its WHOLE chain, not the last step it took: a Mark II
    // carries a step cost of zero and still occupies the supply its Mark I
    // paid for. `supplyPaid` is no help here - the harness stands these up
    // rather than buying them - so it is read off the ladder.
    const def = byId.get(unit.defId);
    supply += def ? totalCost(def.rung, def.mark).supply : 1;
  }
  return { count, supply };
}

export type { SimContext };

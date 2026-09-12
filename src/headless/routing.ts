/**
 * Routing measurements. `npm run routing`.
 *
 * The numbers quoted in docs/PATHING.md come from here. Movement is the only
 * thing being measured, so both sides are disarmed and monsters are pinned
 * unless a case needs them moving: with monsters armed, "units that reached
 * contact" quietly becomes "units that arrived and then survived", which is a
 * different question and was briefly the wrong answer to this one.
 *
 * Each case prints one line. They are deliberately the cases that were
 * reported from play rather than cases chosen to pass.
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step } from '../sim/index.ts';
import type { GameData } from '../data/schema.ts';
import type { MatchState, SimContext } from '../sim/index.ts';

const { data } = loadDataFromDisk();

interface Body {
  pos: { x: number; y: number };
  radius: number;
}

function passive(options: { immobileUnit?: string; monsterSpeed?: number } = {}): GameData {
  const d = structuredClone(data);
  d.fortress.weapon.damage = 0;
  for (const u of d.units.units) {
    u.damage = 0;
    if (u.id === options.immobileUnit) u.moveSpeed = 0;
  }
  for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) {
    m.damage = 0;
    m.moveSpeed = options.monsterSpeed ?? 0;
  }
  return d;
}

function setup(d: GameData): {
  state: MatchState;
  ctx: SimContext;
  lane: NonNullable<MatchState['lanes'][string]>;
} {
  const state = createMatch(d, { seed: 1, teams: [{ id: 'l1', playerIds: ['p'] }] });
  const ctx = createContext(d);
  const lane = state.lanes.l1!;
  lane.economy.gold = 9_999_999;
  lane.economy.supplyCap = 999;
  lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
  lane.fortress.hp = lane.fortress.maxHp;
  return { state, ctx, lane };
}

function place(
  ctx: SimContext,
  state: MatchState,
  unitDefId: string,
  tileX: number,
  tileY: number,
): void {
  applyCommand(ctx, state, { kind: 'placeUnit', teamId: 'l1', unitDefId, tileX, tileY });
}

function startCombat(ctx: SimContext, state: MatchState): void {
  while (state.phase !== 'combat') step(ctx, state);
}

/** One stationary monster, everything else cleared away. */
function loneTarget(state: MatchState, x: number, y: number) {
  const lane = state.lanes.l1!;
  const target = lane.monsters.find((m) => m.alive)!;
  for (const m of lane.monsters) if (m !== target) m.alive = false;
  target.pos.x = x;
  target.pos.y = y;
  return target;
}

function gap(a: Body, b: Body): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) - a.radius - b.radius;
}

function run(ctx: SimContext, state: MatchState, ticks: number): void {
  for (let t = 0; t < ticks; t++) step(ctx, state);
}

const results: string[] = [];

// Two rows converging on a target off to one side. The reported bug was the
// back row jamming behind the front row. Six is the geometric maximum: the
// first ring holds six at these body sizes, so two of the eight belong on a
// second ring by construction.
{
  const { state, ctx, lane } = setup(passive());
  for (const y of [7, 8]) for (let x = 2; x < 6; x++) place(ctx, state, 'hammer', x, y);
  startCombat(ctx, state);
  const target = loneTarget(state, 1.5, 2.5);
  run(ctx, state, 1200);

  const contact = lane.units.filter((u) => u.alive && gap(u, target) < 0.4).length;
  results.push(
    `two rows, target off to one side   ${contact}/8 in contact (6 is the geometric max)`,
  );
}

// A wall of allies with a gap at one end: the local minimum that local steering
// cannot solve, and the case the distance field exists for.
{
  const { state, ctx, lane } = setup(passive({ immobileUnit: 'mortar' }));
  for (let x = 0; x < 7; x++) place(ctx, state, 'mortar', x, 5);
  for (let x = 2; x < 6; x++) for (const y of [8, 9]) place(ctx, state, 'hammer', x, y);
  startCombat(ctx, state);
  const movers = lane.units.filter((u) => u.defId === 'hammer');
  const target = loneTarget(state, 3.5, 1.5);
  run(ctx, state, 1200);

  const through = movers.filter((u) => u.pos.y < 4.5).length;
  const contact = movers.filter((u) => gap(u, target) < 0.5).length;
  results.push(`wall of allies, gap at one end     ${through}/8 through, ${contact}/8 in contact`);
}

// A unit that gave up in a crowd, after the crowd is gone. The park used to be
// permanent: bests-ever baselines that a stationary unit can never beat.
{
  const { state, ctx, lane } = setup(passive());
  for (const y of [7, 8]) for (let x = 2; x < 6; x++) place(ctx, state, 'hammer', x, y);
  startCombat(ctx, state);
  const target = loneTarget(state, 1.5, 2.5);
  run(ctx, state, 900);

  const parked = lane.units.filter(
    (u) => u.alive && gap(u, target) > 0.4 && u.slotStallTicks > 200,
  );
  const before = parked.map((u) => gap(u, target));
  for (const u of lane.units) if (gap(u, target) < 0.4) u.hp = 0;
  run(ctx, state, 400);
  const resumed = parked.filter((u, i) => gap(u, target) < before[i]! - 0.1).length;
  results.push(`parked units released once clear   ${resumed}/${parked.length} resumed`);
}

// A real wave against a real formation, for regression rather than for a claim:
// how many monsters end up engaged, and how much the crowd still moves once it
// should have settled.
{
  const { state, ctx, lane } = setup(passive({ monsterSpeed: 1.2 }));
  for (let y = 5; y < 8; y++) for (let x = 1; x < 7; x++) place(ctx, state, 'hammer', x, y);
  startCombat(ctx, state);
  run(ctx, state, 600);

  const last = new Map(lane.monsters.map((m) => [m.id, { x: m.pos.x, y: m.pos.y }]));
  let travelled = 0;
  for (let t = 0; t < 40; t++) {
    step(ctx, state);
    for (const m of lane.monsters) {
      const previous = last.get(m.id);
      if (!previous || !m.alive) continue;
      travelled += Math.hypot(m.pos.x - previous.x, m.pos.y - previous.y);
      previous.x = m.pos.x;
      previous.y = m.pos.y;
    }
  }

  const alive = lane.monsters.filter((m) => m.alive);
  const engaged = alive.filter((m) => lane.units.some((u) => u.alive && gap(u, m) < 0.5)).length;
  results.push(
    `real wave vs a 3-deep block        ${engaged}/${alive.length} monsters engaged, ${travelled.toFixed(1)} tiles of movement in the last 2s`,
  );
}

console.log(results.join('\n'));

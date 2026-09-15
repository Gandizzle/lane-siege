/**
 * Movement measurements. `npm run routing`.
 *
 * The numbers quoted in docs/PATHING.md come from here. Movement is the only
 * thing being measured, so both sides are disarmed and monsters are pinned
 * unless a case needs them moving: with monsters armed, "units that reached
 * contact" quietly becomes "units that arrived and then survived", which is a
 * different question and was briefly the wrong answer to this one.
 *
 * Each case prints one line. They are the cases the model was designed
 * against - thirty melee bodies on one tank, and the gap that opens when one
 * of them dies - plus the ones reported from play under earlier versions.
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, gap, step } from '../sim/index.ts';
import type { GameData } from '../data/schema.ts';
import type { Body, MatchState, SimContext } from '../sim/index.ts';

const { data } = loadDataFromDisk();

function passive(options: { immobileUnit?: string; monsterSpeed?: number } = {}): GameData {
  const d = structuredClone(data);
  d.fortress.weapon.damage = 0;
  for (const u of d.units.units) {
    u.damage = 0;
    if (u.id === options.immobileUnit) u.moveSpeed = 0;
  }
  for (const m of [...d.monsters.monsters, ...d.monsters.bosses]) {
    m.damage = 0;
    if (options.monsterSpeed !== undefined) m.moveSpeed = options.monsterSpeed;
  }
  return d;
}

function setup(
  d: GameData,
  seed = 1,
): {
  state: MatchState;
  ctx: SimContext;
  lane: NonNullable<MatchState['lanes'][string]>;
} {
  const state = createMatch(d, { seed, teams: [{ id: 'l1', playerIds: ['p'] }] });
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

function run(ctx: SimContext, state: MatchState, ticks: number): void {
  for (let t = 0; t < ticks; t++) step(ctx, state);
}

type Fighter = Body & { engaged: boolean };

/** Deepest overlap among living bodies; with `engagedOnly`, only pairs touching an engaged one. */
function worstOverlap(sets: readonly (readonly Fighter[])[], engagedOnly = false): number {
  const all: Fighter[] = [];
  for (const set of sets) for (const b of set) if (b.alive) all.push(b);
  let worst = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (engagedOnly && !all[i]!.engaged && !all[j]!.engaged) continue;
      const g = gap(all[i]!, all[j]!);
      if (-g > worst) worst = -g;
    }
  }
  return worst;
}

const results: string[] = [];

// Thirty melee monsters on one tank: the ring fills, the rest wait, and when a
// ring member dies the hole is filled. The hole killed each round is the one
// whose neighbours are furthest apart - ring members are immovable, so a hole
// between two that packed tightly can be narrower than a body, and that one
// staying open is geometry rather than pathing.
{
  const d = passive();
  d.waves.composition = [{ wave: 1, entries: [{ monsterId: 'grub', count: 30 }] }];
  d.waves.maxConcurrentMonsters = 40;
  const { state, ctx, lane } = setup(d);
  place(ctx, state, 'bulwark', 3, 6);
  startCombat(ctx, state);
  run(ctx, state, 500);
  const tank = lane.units[0]!;

  const ringSize = lane.monsters.filter((m) => m.alive && m.engaged).length;
  const angle = (m: Body) => Math.atan2(m.pos.y - tank.pos.y, m.pos.x - tank.pos.x);

  let slowestFill = 0;
  let unfilled = 0;
  let ringMoved = 0;
  let overlap = 0;
  for (let round = 0; round < 8; round++) {
    const ring = lane.monsters
      .filter((m) => m.alive && m.engaged)
      .sort((a, b) => angle(a) - angle(b));
    const n = ring.length;
    let loosest = 0;
    let widest = -1;
    for (let i = 0; i < n; i++) {
      let span = angle(ring[(i + 1) % n]!) - angle(ring[(i + n - 1) % n]!);
      while (span <= 0) span += Math.PI * 2;
      if (span > widest) {
        widest = span;
        loosest = i;
      }
    }
    const victim = ring[loosest]!;
    const survivors = ring.filter((m) => m !== victim);
    const before = survivors.map((m) => ({ x: m.pos.x, y: m.pos.y }));
    victim.hp = 0;

    let filledAt = -1;
    for (let t = 1; t <= 100; t++) {
      step(ctx, state);
      const engaged = lane.monsters.filter((m) => m.alive && m.engaged).length;
      if (engaged >= n && filledAt < 0) filledAt = t;
      overlap = Math.max(overlap, worstOverlap([lane.units, lane.monsters], true));
    }
    if (filledAt < 0) unfilled++;
    else slowestFill = Math.max(slowestFill, filledAt);
    survivors.forEach((m, i) => {
      ringMoved = Math.max(ringMoved, Math.hypot(m.pos.x - before[i]!.x, m.pos.y - before[i]!.y));
    });
  }
  results.push(
    `thirty melee on one tank           ring of ${ringSize}; 8 kills, ${8 - unfilled} holes refilled, slowest in ${slowestFill} ticks; ring members moved ${ringMoved.toFixed(3)} tiles; deepest overlap on an engaged body ${overlap.toFixed(4)}`,
  );
}

// Face to face: two bodies in contact, and whether either moves at all.
{
  const { state, ctx, lane } = setup(passive());
  place(ctx, state, 'hammer', 3, 5);
  startCombat(ctx, state);
  const target = lane.monsters.find((m) => m.alive)!;
  for (const m of lane.monsters) if (m !== target) m.alive = false;
  run(ctx, state, 200);
  const unit = lane.units[0]!;
  const before = [unit.pos.x, unit.pos.y, target.pos.x, target.pos.y];
  run(ctx, state, 400);
  const moved = Math.max(
    Math.hypot(unit.pos.x - before[0]!, unit.pos.y - before[1]!),
    Math.hypot(target.pos.x - before[2]!, target.pos.y - before[3]!),
  );
  results.push(
    `face to face for 20s               both engaged: ${unit.engaged && target.engaged}; movement ${moved.toFixed(6)} tiles`,
  );
}

// Two rows converging on a target off to one side. The reported bug was the
// back row jamming behind the front row. Six is the geometric maximum: a 0.22
// body is ringed by six 0.26 bodies at these ranges, so two of the eight
// belong on a second layer by construction.
{
  const { state, ctx, lane } = setup(passive({ monsterSpeed: 0 }));
  for (const y of [7, 8]) for (let x = 2; x < 6; x++) place(ctx, state, 'hammer', x, y);
  startCombat(ctx, state);
  loneTarget(state, 1.5, 2.5);
  run(ctx, state, 1200);

  const engaged = lane.units.filter((u) => u.alive && u.engaged).length;
  results.push(`two rows, target off to one side   ${engaged}/8 engaged (6 is the geometric max)`);
}

// A wall of immobile allies with a gap at one end: the local minimum that
// local steering cannot solve, and the case the distance field exists for.
{
  const { state, ctx, lane } = setup(passive({ immobileUnit: 'mortar', monsterSpeed: 0 }));
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

// A monster crossing open ground with nothing to distract it: how straight it
// walks to the fortress, which is where §5.1 says it is going by default.
{
  const { state, ctx, lane } = setup(passive());
  startCombat(ctx, state);
  const monster = loneTarget(state, 3.5, -1.5);
  const start = { x: monster.pos.x, y: monster.pos.y };
  let travelled = 0;
  while (!monster.engaged && travelled < 30) {
    const px = monster.pos.x;
    const py = monster.pos.y;
    step(ctx, state);
    travelled += Math.hypot(monster.pos.x - px, monster.pos.y - py);
  }
  const straight = Math.hypot(monster.pos.x - start.x, monster.pos.y - start.y);
  results.push(
    `open ground, spawn to fortress     path efficiency ${((straight / travelled) * 100).toFixed(1)}%`,
  );
  void lane;
}

// HANDEDNESS. Nothing in this model is left- or right-handed, so a defender
// against one wall must cost a wave exactly what the same defender against the
// other wall costs. It did not: a broken bucket queue in the distance field
// left roughly half of every field holding costs no route justified, and which
// half depended on the order cells were scanned in. The left half of the lane
// was 7.9% more expensive to attack than the right, and one mirrored pair
// differed by 22.9%.
{
  const lane = data.lane.buildZone.width;
  const walkedTo = (tileX: number, seed: number): number => {
    const { state, ctx, lane: l } = setup(passive(), seed);
    place(ctx, state, 'hammer', tileX, 5);
    startCombat(ctx, state);
    let total = 0;
    const previous = l.monsters.map((m) => ({ x: m.pos.x, y: m.pos.y }));
    for (let t = 0; t < 400; t++) {
      step(ctx, state);
      l.monsters.forEach((m, i) => {
        total += Math.hypot(m.pos.x - previous[i]!.x, m.pos.y - previous[i]!.y);
        previous[i] = { x: m.pos.x, y: m.pos.y };
      });
      if (l.monsters.filter((m) => m.alive && m.engaged).length >= 6) break;
    }
    return total;
  };

  let left = 0;
  let right = 0;
  let worst = 0;
  const seeds = 12;
  for (let seed = 1; seed <= seeds; seed++) {
    for (let tileX = 0; tileX < lane / 2; tileX++) {
      const a = walkedTo(tileX, seed);
      const b = walkedTo(lane - 1 - tileX, seed);
      left += a;
      right += b;
      worst = Math.max(worst, Math.abs(a - b) / Math.min(a, b));
    }
  }
  const skew = ((left - right) / ((left + right) / 2)) * 100;
  results.push(
    `left wall against right wall       skew ${skew.toFixed(1)}% over ${seeds} seeds, ` +
      `worst mirrored pair ${(worst * 100).toFixed(1)}%`,
  );
}

// A real wave against a real formation, for regression rather than for a claim:
// how many monsters end up engaged, and how much the crowd still moves once it
// should have settled.
{
  const { state, ctx, lane } = setup(passive());
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
  const engaged = alive.filter((m) => m.engaged).length;
  results.push(
    `real wave vs a 3-deep block        ${engaged}/${alive.length} monsters engaged, ${travelled.toFixed(2)} tiles of movement in the last 2s`,
  );
}

console.log(results.join('\n'));

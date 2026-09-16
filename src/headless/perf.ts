/**
 * Tick-cost harness. DESIGN.md §15.3.
 *
 * "4 lanes x ~30 monsters + ~40 units + projectiles" is the stated budget, and
 * at 20 ticks a second a tick has 50ms to play with. This loads exactly that
 * and reports what a tick actually costs, so a pathing or collision change that
 * quietly blows the budget shows up as a number rather than as a slow phone.
 *
 *   npm run perf
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step } from '../sim/index.ts';

const { data } = loadDataFromDisk();
const state = createMatch(data, {
  seed: 1,
  teams: Array.from({ length: 4 }, (_, i) => ({ id: `l${i + 1}`, playerIds: [`p${i + 1}`] })),
});
const ctx = createContext(data);

for (const team of state.teams) {
  const lane = state.lanes[team.id]!;
  lane.economy.gold = 999999;
  lane.economy.supplyCap = 9999;
  lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
  lane.fortress.hp = lane.fortress.maxHp;
  for (let x = 0; x < 8; x++)
    for (let y = 4; y < 9; y++)
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: team.id,
        unitDefId: 'hammer',
        tileX: x,
        tileY: y,
      });
}

// Jump to a late wave so the lanes are at the §15.3 budget: 4 lanes,
// ~30 monsters and ~40 units each.
state.wave = 21;
while (state.phase !== 'combat') step(ctx, state);
for (let i = 0; i < 200; i++) step(ctx, state);

const lanes = state.teams.map((t) => state.lanes[t.id]!);
console.log(
  `load: ${lanes.length} lanes, ` +
    `${lanes.reduce((n, l) => n + l.monsters.filter((m) => m.alive).length, 0)} monsters, ` +
    `${lanes.reduce((n, l) => n + l.units.filter((u) => u.alive).length, 0)} units`,
);

const TICKS = 2000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < TICKS; i++) step(ctx, state);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

console.log(`${TICKS} ticks in ${ms.toFixed(1)}ms = ${(ms / TICKS).toFixed(3)}ms per tick`);
console.log(
  `budget is 50ms per tick at 20 ticks/s; using ${((ms / TICKS / 50) * 100).toFixed(2)}%`,
);

// -------------------------------------------------- the Final Showdown (§3.3, replaced)
//
// The arena is a 32x32 square of tiles against a lane's 8x14, so a distance
// field over it costs about nine times as much to sweep - and four armies of
// forty need one each. Whether that fits in the same 50ms is not something to
// find out on a phone.

const arena = createMatch(data, {
  seed: 1,
  teams: Array.from({ length: 4 }, (_, i) => ({ id: `l${i + 1}`, playerIds: [`p${i + 1}`] })),
});
const arenaCtx = createContext(data);

for (const team of arena.teams) {
  const lane = arena.lanes[team.id]!;
  lane.economy.gold = 999999;
  lane.economy.supplyCap = 9999;
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 5; y++)
      applyCommand(arenaCtx, arena, {
        kind: 'placeUnit',
        teamId: team.id,
        unitDefId: 'hammer',
        tileX: x,
        tileY: y,
      });
  // A wall nobody can knock down: the transplant is what is being measured,
  // not whether the line holds wave 25.
  lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
  lane.fortress.hp = lane.fortress.maxHp;
}

arena.wave = data.waves.showdown.afterWave;
arena.phase = 'combat';
arena.phaseTicksLeft = 0;
for (const lane of Object.values(arena.lanes)) {
  lane.monsters.length = 0;
  lane.reserve.length = 0;
}
arena.waveClocks.length = 0;
step(arenaCtx, arena);
while (arena.phaseTicksLeft > 0) step(arenaCtx, arena);

const armies = arena.showdown?.armies ?? [];
console.log(
  `\nshowdown: ${armies.length} armies, ` +
    `${armies.reduce((n, a) => n + a.units.filter((u) => u.alive).length, 0)} units`,
);

const SHOWDOWN_TICKS = 600;
const s0 = process.hrtime.bigint();
let ticked = 0;
for (let i = 0; i < SHOWDOWN_TICKS && !arena.finished; i++, ticked++) step(arenaCtx, arena);
const sms = Number(process.hrtime.bigint() - s0) / 1e6;

console.log(
  `${ticked} ticks in ${sms.toFixed(1)}ms = ${(sms / ticked).toFixed(3)}ms per tick ` +
    `(${((sms / ticked / 50) * 100).toFixed(2)}% of budget)`,
);

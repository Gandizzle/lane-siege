/**
 * Tick-cost harness. DESIGN.md §15.3.
 *
 * "4 lanes x ~30 monsters + ~40 units + projectiles" is the stated budget, and
 * at 20 ticks a second a tick has 50ms to play with. Sends have a pool of
 * their own on the field since (§8.1, amended), so the worst a lane can hold
 * is a full wave AND a full pool of sends - twice the monsters §15.3 counted.
 * This loads that and reports what a tick actually costs, so a pathing or
 * collision change that quietly blows the budget shows up as a number rather
 * than as a slow phone.
 *
 *   npm run perf
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step } from '../sim/index.ts';

const { data } = loadDataFromDisk();
const builders = data.units.builders.map((b) => b.id);

/**
 * Four lanes, one per builder, each with a real line: every unit its builder
 * has at mark 1, mixed through five rows. A line of one melee unit was the
 * load this used to measure, and it read a third of the true cost - the
 * expensive part of a tick is each unit KIND's field ringing every monster
 * at that kind's reach, so a line with long-reach units in it is the case
 * that matters. Optionally a full pool of sends at every lane (§8.1, amended),
 * every kind there is in turn.
 */
function laneLoad(label: string, withSends: boolean): void {
  const state = createMatch(data, {
    seed: 1,
    teams: Array.from({ length: 4 }, (_, i) => ({
      id: `l${i + 1}`,
      playerIds: [`p${i + 1}`],
      builderId: builders[i % builders.length]!,
    })),
  });
  const ctx = createContext(data);

  for (const team of state.teams) {
    const lane = state.lanes[team.id]!;
    lane.economy.gold = 999999;
    lane.economy.supplyCap = 9999;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    lane.fortress.hp = lane.fortress.maxHp;
    const kinds = data.units.units.filter((u) => u.builderId === lane.builderId && u.mark === 1);
    for (let x = 0; x < 8; x++)
      for (let y = 4; y < 9; y++)
        applyCommand(ctx, state, {
          kind: 'placeUnit',
          teamId: team.id,
          unitDefId: kinds[(x + y) % kinds.length]!.id,
          tileX: x,
          tileY: y,
        });
    if (!withSends) continue;
    for (let i = 0; i < data.waves.maxConcurrentSends; i++) {
      const send = data.sends.sends[i % data.sends.sends.length]!;
      for (const defId of send.monsters) {
        lane.incomingSends.push({ defId, fromTeamId: 'elsewhere', sendId: send.id });
      }
    }
  }

  // A late wave, measured from a few seconds in, while the crowd is at its
  // biggest and the line is still standing.
  state.wave = 21;
  while (state.phase !== 'combat') step(ctx, state);
  for (let i = 0; i < 60; i++) step(ctx, state);

  const lanes = state.teams.map((t) => state.lanes[t.id]!);
  const monsters = lanes.reduce((n, l) => n + l.monsters.filter((m) => m.alive).length, 0);
  const units = lanes.reduce((n, l) => n + l.units.filter((u) => u.alive).length, 0);

  const TICKS = 200;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < TICKS; i++) step(ctx, state);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / TICKS;
  console.log(
    `${label}: ${lanes.length} lanes, ${monsters} monsters, ${units} units - ` +
      `${ms.toFixed(3)}ms per tick, ${((ms / 50) * 100).toFixed(1)}% of the 50ms budget`,
  );
}

laneLoad('a full wave           ', false);
laneLoad('a full wave and sends ', true);

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
        unitDefId: 'pledge',
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

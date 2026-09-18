/**
 * Wire-format measurement. `npm run wire`.
 *
 * Two numbers matter: what a player's own-lane frame costs at the §15.3 load,
 * and what a spectator watching all four lanes costs, since that is the worst
 * case the server can be asked for.
 *
 * JSON length is the figure reported. Colyseus puts messages through msgpack,
 * which is smaller still - notably for the arrays of small integers this format
 * is almost entirely made of - so these are upper bounds.
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step, viewFor } from '../sim/index.ts';
import { buildTables, decodeFrame, encodeFrame } from '../net/protocol.ts';
import { TICKS_PER_SECOND } from '../sim/constants.ts';

const { data } = loadDataFromDisk();
const teamIds = ['a', 'b', 'c', 'd'];

const state = createMatch(data, {
  seed: 3,
  teams: teamIds.map((id) => ({ id, playerIds: [id] })),
});
const ctx = createContext(data);
const tables = buildTables(data, teamIds, state.seed);

// §15.3's stated load: four lanes, ~40 units and ~30 monsters each.
for (const id of teamIds) {
  const lane = state.lanes[id]!;
  lane.economy.gold = 9_999_999;
  lane.economy.supplyCap = 999;
  lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
  lane.fortress.hp = lane.fortress.maxHp;
  for (let y = 4; y < 9; y++) {
    for (let x = 0; x < 8; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: id,
        unitDefId: 'pledge',
        tileX: x,
        tileY: y,
      });
    }
  }
}
// A late wave, so the monster count is the one §15.3 budgets for rather than
// wave one's handful.
state.wave = 19;
while (state.phase !== 'combat') step(ctx, state);
for (let i = 0; i < 40; i++) step(ctx, state);

const lane = state.lanes.a!;
const monsters = lane.monsters.filter((m) => m.alive).length;
console.log(`load: ${lane.units.length} units and ${monsters} monsters per lane, 4 lanes`);

function report(label: string, teamId: string): void {
  const view = viewFor(state, teamId);
  const asObjects = JSON.stringify(view).length;
  const asFrame = JSON.stringify(encodeFrame(view, tables)).length;
  const perSecond = (asFrame * TICKS_PER_SECOND) / 1024;
  const saving = (100 * (1 - asFrame / asObjects)).toFixed(0);
  console.log(
    `${label.padEnd(12)} ${(asFrame / 1024).toFixed(2)} KiB/frame  ${perSecond.toFixed(1)} KiB/s at ${TICKS_PER_SECOND}Hz` +
      `   (${(asObjects / 1024).toFixed(1)} KiB as objects, ${saving}% smaller)`,
  );
}

report('player', 'a');
state.teams.find((t) => t.id === 'a')!.eliminated = true;
report('spectator', 'a');

/**
 * The attack list (§14.2's animations) is the one part of a frame that varies
 * tick to tick: it is empty between swings and full when a whole line fires at
 * once. An average would flatter it, so this reports the worst tick over two
 * seconds of real combat - which is the one the connection has to carry.
 */
{
  let worstFrame = 0;
  let worstAttacks = 0;
  let totalAttacks = 0;
  const ticks = TICKS_PER_SECOND * 2;
  for (let i = 0; i < ticks; i++) {
    step(ctx, state);
    const view = viewFor(state, 'a');
    const attacks = Object.values(view.watching).reduce(
      (sum, l) => sum + l.attacks.length,
      view.lane?.attacks.length ?? 0,
    );
    totalAttacks += attacks;
    const size = JSON.stringify(encodeFrame(view, tables)).length;
    if (size > worstFrame) {
      worstFrame = size;
      worstAttacks = attacks;
    }
  }
  console.log(
    `spectator worst tick over 2s: ${(worstFrame / 1024).toFixed(2)} KiB ` +
      `with ${worstAttacks} attacks (${(totalAttacks / ticks).toFixed(1)} per tick on average)`,
  );
}
state.teams.find((t) => t.id === 'a')!.eliminated = false;

// And prove the frame still says what the view said.
const original = viewFor(state, 'a');
const round = decodeFrame(encodeFrame(original, tables), tables);
const drift = Math.max(
  ...round.lane!.monsters.map((m, i) => Math.abs(m.x - original.lane!.monsters[i]!.x)),
  0,
);
console.log(
  `round trip: ${round.lane!.units.length} units, ${round.lane!.monsters.length} monsters, worst position drift ${drift.toFixed(4)} tiles`,
);

// ------------------------------------- the Final Showdown (§3.3, replaced)
//
// The arena frame is the whole board, for everybody, because there is nothing
// in it to hide (§12) - so what a player pays is what a spectator pays. Four
// armies of forty is the same body count as one lane's units times four, and
// no monsters, so it should come in under the spectator figure above. Worth
// measuring rather than assuming: it is the one frame with no fog in it.
{
  const arena = createMatch(data, {
    seed: 3,
    teams: teamIds.map((id) => ({ id, playerIds: [id] })),
  });
  const arenaCtx = createContext(data);

  for (const id of teamIds) {
    const laneToArm = arena.lanes[id]!;
    laneToArm.economy.gold = 9_999_999;
    laneToArm.economy.supplyCap = 999;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 8; x++) {
        applyCommand(arenaCtx, arena, {
          kind: 'placeUnit',
          teamId: id,
          unitDefId: 'pledge',
          tileX: x,
          tileY: y,
        });
      }
    }
  }

  arena.wave = data.waves.showdown.afterWave;
  arena.phase = 'combat';
  arena.phaseTicksLeft = 0;
  step(arenaCtx, arena);
  while (arena.phaseTicksLeft > 0) step(arenaCtx, arena);
  for (let i = 0; i < 60; i++) step(arenaCtx, arena);

  const view = viewFor(arena, 'a');
  const bodies = view.showdown?.armies.reduce((n, army) => n + army.units.length, 0) ?? 0;
  const asObjects = JSON.stringify(view).length;
  const asFrame = JSON.stringify(encodeFrame(view, tables)).length;
  console.log(
    `showdown: ${bodies} bodies in the arena   ` +
      `${(asFrame / 1024).toFixed(2)} KiB/frame  ` +
      `${((asFrame * TICKS_PER_SECOND) / 1024).toFixed(1)} KiB/s at ${TICKS_PER_SECOND}Hz` +
      `   (${(asObjects / 1024).toFixed(1)} KiB as objects)`,
  );
}

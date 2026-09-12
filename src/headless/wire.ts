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
        unitDefId: 'hammer',
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

// And prove the frame still says what the view said.
state.teams.find((t) => t.id === 'a')!.eliminated = false;
const original = viewFor(state, 'a');
const round = decodeFrame(encodeFrame(original, tables), tables);
const drift = Math.max(
  ...round.lane!.monsters.map((m, i) => Math.abs(m.x - original.lane!.monsters[i]!.x)),
  0,
);
console.log(
  `round trip: ${round.lane!.units.length} units, ${round.lane!.monsters.length} monsters, worst position drift ${drift.toFixed(4)} tiles`,
);

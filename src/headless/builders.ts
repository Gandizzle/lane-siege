/**
 * How each roster actually plays. `npm run builders`.
 *
 * §7.1 says builders 2 to 4 are "largely data entry against a proven
 * framework", which is true of the typing and untrue of the consequences: a
 * roster that cannot kill anything, or one that walks every wave, is a data
 * entry bug and looks identical to a balance opinion until somebody plays it.
 *
 * So this plays all four side by side, in the same match, against identical
 * waves (§9.2) with the same scripted builder driving each - and prints what
 * happened. It is a sanity check, not a verdict: the scripted builder is a poor
 * player, and the numbers here are a floor rather than a measure of a roster's
 * ceiling.
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { AutoBuilder } from '../bot/autoBuilder.ts';
import { createContext, createMatch, step, ticksToSeconds } from '../sim/index.ts';
import type { Command } from '../sim/index.ts';

const { data } = loadDataFromDisk();

const waves = Number(process.argv[2] ?? 25);
const seed = Number(process.argv[3] ?? 12345);

const builderIds = data.units.builders.map((b) => b.id);
const teams = builderIds.map((builderId, i) => ({
  id: `lane${i + 1}`,
  playerIds: [`p${i + 1}`],
  builderId,
}));

const state = createMatch(data, { seed, teams });
const ctx = createContext(data);
// Sends off: this is a question about rosters against waves, and three
// opponents piling on the leader (§11.5) would answer a different one.
const bots = teams.map((t) => new AutoBuilder(data, t.id, t.builderId));

interface Record {
  builderId: string;
  firstLeakWave: number | null;
  eliminatedWave: number | null;
  lowestHp: number;
}

const records = new Map<string, Record>(
  teams.map((t) => [
    t.id,
    { builderId: t.builderId, firstLeakWave: null, eliminatedWave: null, lowestHp: 1 },
  ]),
);

while (!state.finished && state.wave <= waves) {
  const commands: Command[] = [];
  for (const bot of bots) {
    // Strip sends: every lane should face the waves, not each other.
    for (const command of bot.plan(state)) {
      if (command.kind !== 'send') commands.push(command);
    }
  }
  step(ctx, state, commands);

  for (const team of teams) {
    const lane = state.lanes[team.id];
    const record = records.get(team.id);
    if (!lane || !record) continue;

    const fraction = lane.fortress.maxHp > 0 ? lane.fortress.hp / lane.fortress.maxHp : 0;
    if (fraction < record.lowestHp) record.lowestHp = fraction;
    if (fraction < 1 && record.firstLeakWave === null) record.firstLeakWave = state.wave;
    if (lane.fortress.destroyed && record.eliminatedWave === null) {
      record.eliminatedWave = state.wave;
    }
  }
}

const names = new Map(data.units.builders.map((b) => [b.id, b.name]));

console.log(`seed ${seed}, ${waves} waves, ${ticksToSeconds(state.tick).toFixed(0)}s simulated\n`);
console.log('builder     first leak   eliminated   lowest fortress   units built   gold left');
for (const team of teams) {
  const lane = state.lanes[team.id]!;
  const record = records.get(team.id)!;
  const built = lane.units.length;
  console.log(
    `${(names.get(record.builderId) ?? record.builderId).padEnd(11)}` +
      `${String(record.firstLeakWave ?? '—').padStart(10)}   ` +
      `${String(record.eliminatedWave ?? '—').padStart(10)}   ` +
      `${`${Math.round(record.lowestHp * 100)}%`.padStart(15)}   ` +
      `${String(built).padStart(11)}   ` +
      `${String(Math.round(lane.economy.gold)).padStart(9)}`,
  );
}

// §5.5 wants the first elimination around wave 13-15. Say so rather than
// leaving the reader to remember the target.
const eliminations = [...records.values()].map((r) => r.eliminatedWave).filter((w) => w !== null);
const first = eliminations.length > 0 ? Math.min(...eliminations) : null;
console.log(
  `\nfirst elimination: ${first ?? 'none'} (§5.5 targets wave 13-15 - a soft curve reads as 'none')`,
);

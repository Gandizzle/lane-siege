/**
 * Headless simulation runner. DESIGN.md §17, milestone M1.
 *
 * "One lane, one builder, 3 units, 5 waves. Text output only. No graphics.
 * Proves the tick loop, targeting, steering, damage matrix, and gold flow."
 *
 * No graphics and no engine: this imports the simulation and nothing else, and
 * is the same harness that will later run thousands of matches headless to check
 * balance curves (§9.2).
 *
 *   npm run sim
 *   npm run sim -- --seed 7 --waves 5 --players 1
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { formatReport } from '../data/validate.ts';
import {
  createContext,
  createMatch,
  countLiving,
  MissingDataError,
  previewWave,
  step,
  TICKS_PER_SECOND,
  ticksToSeconds,
} from '../sim/index.ts';
import type { Command, MatchState, TeamSetup } from '../sim/index.ts';
import { AutoBuilder } from '../bot/autoBuilder.ts';

interface Args {
  seed: number;
  waves: number;
  players: number;
}

function parseArgs(argv: string[]): Args {
  // M1 is a single lane; --players raises it for the multi-lane smoke test.
  const args: Args = { seed: 1, waves: 5, players: 1 };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = Number(argv[i + 1]);
    if (Number.isNaN(value)) continue;
    if (flag === '--seed') args.seed = value;
    if (flag === '--waves') args.waves = value;
    if (flag === '--players') args.players = value;
  }
  return args;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width);
}

function laneLine(state: MatchState, teamId: string): string {
  const lane = state.lanes[teamId];
  if (!lane) return `${teamId}: (no lane)`;

  const alive = lane.units.filter((u) => u.alive).length;
  const hpPercent = Math.max(0, Math.round((lane.fortress.hp / lane.fortress.maxHp) * 100));

  return (
    `${teamId}  fortress ${pad(Math.max(0, Math.round(lane.fortress.hp)), 5)}` +
    ` (${pad(hpPercent, 3)}%)  gold ${pad(Math.round(lane.economy.gold), 4)}` +
    `  gems ${pad(Math.round(lane.economy.gems), 3)}` +
    `  supply ${pad(lane.economy.supplyUsed, 2)}/${lane.economy.supplyCap}` +
    `  units ${pad(alive, 2)}  monsters ${pad(countLiving(lane), 2)}` +
    `  reserve ${pad(lane.reserve.length, 2)}`
  );
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const { data, report } = loadDataFromDisk();

  console.log('Bros Lane Siege — headless simulation (M1)');
  console.log(
    `seed ${args.seed} · ${args.players} lane(s) · ${args.waves} waves · ` +
      `${TICKS_PER_SECOND} ticks/s\n`,
  );

  if (report.errors.length > 0) {
    console.error(formatReport(report));
    return 1;
  }
  if (report.missing.length > 0 || report.notes.length > 0) {
    console.log(formatReport(report));
    console.log('');
  }

  const teams: TeamSetup[] = Array.from({ length: args.players }, (_, i) => ({
    // §2: a lane is owned by a TEAM of one or more players, from day one, so
    // 2v2 later is configuration rather than a rewrite.
    id: `lane${i + 1}`,
    playerIds: [`p${i + 1}`],
  }));

  let state: MatchState;
  try {
    state = createMatch(data, { seed: args.seed, teams });
  } catch (error) {
    if (error instanceof MissingDataError) {
      console.log('The simulation cannot run yet — data/ is incomplete.\n');
      console.log(formatReport(report));
      return 0;
    }
    throw error;
  }

  const ctx = createContext(data);
  const builders = teams.map(
    (t) => new AutoBuilder(data, t.id, state.lanes[t.id]?.builderId ?? ''),
  );

  let lastWave = -1;
  let lastPhase = '';

  while (!state.finished && state.wave <= args.waves) {
    const commands: Command[] = [];
    for (const builder of builders) commands.push(...builder.plan(state));

    step(ctx, state, commands);

    if (state.wave !== lastWave || state.phase !== lastPhase) {
      if (state.phase === 'combat' && state.wave !== lastWave) {
        // §9.3: the incoming wave is public during the build phase - fair,
        // because every lane faces the same thing.
        const preview = previewWave(data, state.seed, state.wave);
        const summary = preview
          .map((e) => `${e.count}x ${e.name} (${e.armour}/${e.damageType})`)
          .join(', ');
        console.log(
          `\n── wave ${state.wave} ` +
            `${state.wave % data.waves.bossEveryNWaves === 0 ? '(BOSS) ' : ''}` +
            `at ${ticksToSeconds(state.tick).toFixed(0)}s ──`,
        );
        console.log(`   incoming: ${summary}`);
      }
      if (state.phase === 'build' && lastPhase === 'combat') {
        // Not necessarily "cleared": §3.2's global clock starts the next build
        // phase whether or not this lane finished the wave.
        console.log(`   build phase at ${ticksToSeconds(state.tick).toFixed(0)}s`);
        for (const team of state.teams) console.log(`   ${laneLine(state, team.id)}`);
      }
      lastWave = state.wave;
      lastPhase = state.phase;
    }
  }

  console.log('\n── final ──');
  for (const team of state.teams) {
    console.log(`   ${laneLine(state, team.id)}`);
    if (team.eliminated) console.log(`      eliminated, placed ${team.placement}`);
  }
  console.log(
    `\n${state.tick} ticks (${ticksToSeconds(state.tick).toFixed(0)}s simulated), ` +
      `wave ${state.wave}`,
  );
  return 0;
}

process.exitCode = main();

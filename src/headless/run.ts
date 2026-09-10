/**
 * Headless simulation runner. DESIGN.md §17, milestone M1.
 *
 * No graphics, no engine, text output only. This is the harness that proves the
 * tick loop, targeting, steering, the damage matrix and gold flow before a
 * single pixel is drawn - and later, the one that runs thousands of simulated
 * matches to check balance curves (§9.2).
 *
 *   npm run sim              -- one match on the default seed
 *   npm run sim -- --seed 7 --waves 5 --players 4
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { formatReport } from '../data/validate.ts';
import { createContext, createMatch, MissingDataError, step } from '../sim/index.ts';
import { TICKS_PER_SECOND } from '../sim/constants.ts';
import type { TeamSetup } from '../sim/index.ts';

interface Args {
  seed: number;
  waves: number;
  players: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: 1, waves: 5, players: 4 };
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

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const { data, report } = loadDataFromDisk();

  console.log('Lane Siege — headless simulation (M1)');
  console.log(
    `seed ${args.seed} · ${args.players} players · ${args.waves} waves · ${TICKS_PER_SECOND} ticks/s\n`,
  );

  if (report.errors.length > 0) {
    console.error(formatReport(report));
    return 1;
  }

  const teams: TeamSetup[] = Array.from({ length: args.players }, (_, i) => ({
    // §2: a lane is owned by a TEAM, one or more players. v1 fills one each,
    // which makes 2v2 configuration rather than a rewrite.
    id: `team${i + 1}`,
    playerIds: [`p${i + 1}`],
  }));

  let state;
  try {
    state = createMatch(data, { seed: args.seed, teams });
  } catch (error) {
    if (error instanceof MissingDataError) {
      console.log('The simulation cannot run yet — data/ is still empty.\n');
      console.log(formatReport(report));
      console.log('\nFill the values above (DESIGN.md §16), then re-run. Nothing is hardcoded,');
      console.log('so this is entirely a JSON editing job — no code changes needed.');
      return 0;
    }
    throw error;
  }

  const ctx = createContext(data);
  let lastReported = -1;

  while (!state.finished && state.wave <= args.waves) {
    step(ctx, state);

    if (state.wave !== lastReported) {
      lastReported = state.wave;
      const alive = state.teams.filter((t) => !t.eliminated).length;
      console.log(`wave ${state.wave.toString().padStart(2)} · ${state.phase} · ${alive} alive`);
      for (const team of state.teams) {
        const lane = state.lanes[team.id];
        if (!lane) continue;
        console.log(
          `   ${team.id}: fortress ${Math.round(lane.fortress.hp)}/${lane.fortress.maxHp}` +
            ` · ${Math.round(lane.economy.gold)}g ${Math.round(lane.economy.gems)}gem` +
            ` · ${lane.units.filter((u) => u.alive).length} units` +
            ` · ${lane.monsters.filter((m) => m.alive).length} monsters`,
        );
      }
    }
  }

  console.log(`\nfinished at tick ${state.tick} (${(state.tick / TICKS_PER_SECOND).toFixed(1)}s)`);
  return 0;
}

process.exitCode = main();

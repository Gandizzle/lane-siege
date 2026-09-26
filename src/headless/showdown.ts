/**
 * The Final Showdown round robin. `npm run showdown`.
 *
 * Runs every builder against every other in the arena, on twenty different
 * builds each, and prints who won and by how much. It is the measuring
 * instrument for the first phase of balancing; docs/BALANCE.md says what the
 * numbers mean and which ones have to be read first.
 *
 *   npm run showdown                     a full run, across every core
 *   npm run showdown -- --quick          a short one, for checking a change
 *   npm run showdown -- --jobs 1         one process, for profiling
 *   npm run showdown -- --duels 100 --ffa 200 --mirrors 40
 *   npm run showdown -- --seed 7
 *   npm run showdown -- --walk 2         arena walking at twice lane speed
 *   npm run showdown -- --centre 0.25    the centre worth +25% dealt, -25% taken
 *   npm run showdown -- --out report.json --records records.json
 *
 * A fight between diverse armies costs about fifteen seconds of CPU, so a full
 * run is forked across every core and merged. `--shard i/n` runs one slice and
 * prints its records as JSON; that is how the forks are driven, and it is also
 * how a run can be split across machines.
 */

import fs from 'node:fs';
import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  DEFAULTS,
  evenness,
  evennessVerdict,
  planFights,
  runFights,
  summarise,
  type FightRecord,
  type Matchup,
  type Tally,
  type TournamentOptions,
  type TournamentReport,
} from '../balance/tournament.ts';

const { data } = loadDataFromDisk();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);
const numberFlag = (name: string, fallback: number): number => {
  const raw = flag(name);
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const quick = has('quick');

// `--sight on|off` overrides waves.showdown.lineOfSight for this run, so the
// difference the corners make can be measured rather than argued about. It
// only shows up in four-ways: a duel sits on opposite spokes and every line
// between them stays inside one bar of the cross.
const sight = flag('sight');
if (sight === 'on' || sight === 'off') data.waves.showdown.lineOfSight = sight === 'on';
// `--walk <n>` overrides waves.showdown.walkSpeed the same way.
const walk = Number(flag('walk'));
if (Number.isFinite(walk) && walk > 0) data.waves.showdown.walkSpeed = walk;
// `--centre <x>`: holding the centre deals +x and takes -x.
const centre = Number(flag('centre'));
if (Number.isFinite(centre) && centre >= 0) {
  data.waves.showdown.centre.damageDealt = centre;
  data.waves.showdown.centre.damageTaken = -centre;
}
const options: TournamentOptions = {
  duelsPerPair: numberFlag('duels', quick ? 4 : DEFAULTS.duelsPerPair),
  freeForAlls: numberFlag('ffa', quick ? 8 : DEFAULTS.freeForAlls),
  mirrors: numberFlag('mirrors', quick ? 2 : DEFAULTS.mirrors),
  seed: numberFlag('seed', DEFAULTS.seed),
};

const plans = planFights(data, options);
// Declared before the two early exits below, both of which report.
const started = Date.now();

// -------------------------------------------- re-reading a run already fought

// `--from records.json` rebuilds the report from saved records without
// re-fighting anything. Fights are the expensive part and the summary is the
// part that gets changed, so a mistake in the reading of a run costs nothing to
// correct - which it did: the matchup table came out empty once.
const from = flag('from');
if (from) {
  const saved = JSON.parse(fs.readFileSync(from, 'utf8')) as FightRecord[];
  console.log(`\n${saved.length} records from ${from}\n`);
  report(summarise(data, saved, options), saved);
  process.exit(0);
}

// ------------------------------------------------------------------- a shard

const shard = flag('shard');
if (shard) {
  const [indexRaw, countRaw] = shard.split('/');
  const index = Number(indexRaw);
  const count = Number(countRaw);
  const mine = plans.filter((_, i) => i % count === index);
  // Written to stdout as one JSON line, which the parent reads back. Progress
  // goes to stderr so it cannot corrupt it.
  const records = runFights(data, mine, (done, total) => {
    if (done % 5 === 0 || done === total)
      process.stderr.write(`shard ${index}: ${done}/${total}\n`);
  });
  process.stdout.write(JSON.stringify(records));
  process.exit(0);
}

// ------------------------------------------------------------- the whole run

const jobs = Math.max(1, Math.min(numberFlag('jobs', os.cpus().length), plans.length));

console.log(
  `\n${plans.length} fights: ${options.mirrors} mirrors a builder, ${options.duelsPerPair} duels a pair ` +
    `(both seatings), ${options.freeForAlls} four-ways. seed ${options.seed}.`,
);
console.log(`running on ${jobs} ${jobs === 1 ? 'process' : 'processes'}...\n`);

const records = jobs === 1 ? runFights(data, plans, progress) : await runSharded(jobs);

report(summarise(data, records, options), records);

function progress(done: number, total: number): void {
  if (done % 10 !== 0 && done !== total) return;
  const each = (Date.now() - started) / done;
  const left = Math.round(((total - done) * each) / 1000);
  process.stderr.write(`  ${done}/${total}  ~${left}s left\n`);
}

/**
 * Fork one process per core, each running every nth fight.
 *
 * Interleaved rather than chunked so the shards finish together: a chunk of
 * four-ways costs several times a chunk of duels, and a run is only as fast as
 * its slowest shard.
 */
async function runSharded(count: number): Promise<FightRecord[]> {
  const self = fileURLToPath(import.meta.url);
  // Everything this process was given, minus what is about to be replaced or
  // is the parent's alone. Forwarded by SUBTRACTION rather than by naming the
  // flags to keep, because the list that named them silently dropped `--sight`
  // - the shards ran on the data file's default and an A/B run came back
  // byte-identical to itself. A new flag must not be able to go missing.
  const PARENT_ONLY = new Set(['--shard', '--jobs', '--out', '--records', '--from']);
  const passthrough: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]!;
    if (!arg.startsWith('--')) continue;
    const value = process.argv[i + 1];
    const hasValue = value !== undefined && !value.startsWith('--');
    if (!PARENT_ONLY.has(arg)) passthrough.push(arg, ...(hasValue ? [value] : []));
    if (hasValue) i++;
  }

  const runs = Array.from(
    { length: count },
    (_, i) =>
      new Promise<FightRecord[]>((resolve, reject) => {
        const child = fork(self, [...passthrough, '--shard', `${i}/${count}`], {
          // tsx is already the loader for this process; the child inherits it.
          execArgv: process.execArgv,
          stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
        });
        let out = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code !== 0) return reject(new Error(`shard ${i} exited ${code}`));
          try {
            resolve(JSON.parse(out) as FightRecord[]);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }),
  );

  // Back into plan order, so `summarise` can pair the two seatings of a duel by
  // adjacency the way `runFights` emits them.
  const slices = await Promise.all(runs);
  const byShard = slices.map((records) => {
    const perFight: FightRecord[][] = [];
    for (let i = 0; i < records.length;) {
      const size = records[i]!.seats;
      perFight.push(records.slice(i, i + size));
      i += size;
    }
    return perFight;
  });

  const merged: FightRecord[] = [];
  const cursor = new Array(count).fill(0) as number[];
  for (let i = 0; i < plans.length; i++) {
    const shardIndex = i % count;
    const fight = byShard[shardIndex]![cursor[shardIndex]!];
    if (fight) merged.push(...fight);
    cursor[shardIndex]! += 1;
  }
  return merged;
}

// -------------------------------------------------------------------- output

// Declarations rather than consts: `report` runs at the top of the module,
// before anything below it has been initialised.
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}
function padEnd(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

function tallyRows(title: string, rows: Tally[], even: number): void {
  console.log(`\n${title}`);
  console.log(`  ${padEnd('', 14)} fights   win rate        margin   mean place`);
  for (const row of rows) {
    const off = row.winRate - even;
    const significant = Math.abs(off) > 2 * row.error;
    console.log(
      `  ${padEnd(row.key, 14)} ${pad(row.fights, 6)}   ` +
        `${pad(pct(row.winRate), 6)} ±${pad(pct(row.error), 5)}  ` +
        `${pad(pct(row.margin), 6)}  ${pad(row.placement.toFixed(2), 10)}` +
        `${significant ? `   <- ${off > 0 ? '+' : ''}${pct(off)} off ${pct(even)}` : ''}`,
    );
  }
}

/**
 * The four seats read together rather than one at a time.
 *
 * With four numbers and a 5% threshold, one of them looks significant one run
 * in five whatever the arena is doing - so a per-seat error bar is exactly the
 * wrong tool for "is this flat". The chi-square asks the question once.
 */
function verdict(rows: Tally[]): void {
  const { chiSquare, df } = evenness(rows.map((row) => row.wins));
  console.log(`  -> ${evennessVerdict(chiSquare, df)}`);
}

function report(r: TournamentReport, raw: readonly FightRecord[]): void {
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n${r.fights} fights in ${seconds}s. ` +
      `Mean fight ${r.meanSeconds.toFixed(0)}s of game time. ` +
      `${r.timeouts} hit the tick cap.`,
  );
  console.log(
    `Every seat got ${Math.round(r.budget.gold).toLocaleString('en-GB')} gold and ${r.budget.supply} supply.`,
  );
  console.log(
    `Line of sight across the arena's corners: ${data.waves.showdown.lineOfSight === true ? 'BLOCKED' : 'open'}. ` +
      `Walking at ${data.waves.showdown.walkSpeed ?? 1}x lane speed. ` +
      `The centre deals +${data.waves.showdown.centre.damageDealt ?? 0}, takes ${data.waves.showdown.centre.damageTaken ?? 0}.`,
  );

  console.log('\n' + '='.repeat(78));
  console.log('CONTROLS - if these are not flat, nothing below them means anything');
  console.log('='.repeat(78));
  tallyRows(
    'MIRROR: four copies of one builder, one build. 25% a seat is correct.',
    r.mirror,
    0.25,
  );
  verdict(r.mirror);
  tallyRows('SEATS: win rate by spoke across the four-ways, seating shuffled.', r.seats, 0.25);
  verdict(r.seats);

  console.log('\n' + '='.repeat(78));
  console.log('DUELS - the primary signal for builder parity');
  console.log('='.repeat(78));
  tallyRows('By builder, across every duel.', r.duelBuilders, 0.5);

  console.log('\nBy matchup. 40/60 either way is the line.');
  console.log(`  ${padEnd('matchup', 26)} fights    first wins       margins`);
  for (const m of [...r.duels].sort(
    (a, b) => Math.abs(b.aWinRate - 0.5) - Math.abs(a.aWinRate - 0.5),
  )) {
    const out = Math.abs(m.aWinRate - 0.5) > 0.1;
    console.log(
      `  ${padEnd(`${m.a} v ${m.b}`, 26)} ${pad(m.fights, 6)}    ` +
        `${pad(pct(m.aWinRate), 6)} ±${pad(pct(m.error), 5)}   ` +
        `${pad(pct(m.aMargin), 6)} / ${pad(pct(m.bMargin), 6)}${out ? '   <- outside 40/60' : ''}`,
    );
  }

  console.log('\n' + '='.repeat(78));
  console.log('FOUR-WAYS - a check on what only shows up with four');
  console.log('='.repeat(78));
  tallyRows('By builder.', r.ffaBuilders, 0.25);

  console.log('\n' + '='.repeat(78));
  console.log('BUILDS - is one shape of army simply correct?');
  console.log('='.repeat(78));
  console.log(`  ${padEnd('', 14)} fights   win rate        margin   mean place`);
  for (const row of r.builds) {
    console.log(
      `  ${padEnd(row.key, 14)} ${pad(row.fights, 6)}   ` +
        `${pad(pct(row.winRate), 6)} ±${pad(pct(row.error), 5)}  ` +
        `${pad(pct(row.margin), 6)}  ${pad(row.placement.toFixed(2), 10)}`,
    );
  }

  // A build that cannot spend what it is given is not losing on merit, and the
  // report has to say so before anyone reads its win rate as a balance finding.
  const short = r.spend.filter(
    (s) =>
      s.tilesShort > 0 || s.goldSpent < s.goldBudget * 0.9 || s.supplyUsed < s.supplyBudget * 0.9,
  );
  if (short.length > 0) {
    console.log('\nBUILDS THAT COULD NOT SPEND THEIR BUDGET');
    console.log('  these lose partly on arithmetic, not on merit\n');
    console.log(
      `  ${padEnd('build', 14)} ${padEnd('builder', 12)} bodies     gold    supply   short`,
    );
    for (const s of short) {
      console.log(
        `  ${padEnd(s.specId, 14)} ${padEnd(s.builderId, 12)} ${pad(s.bodies, 6)}  ` +
          `${pad(`${Math.round((s.goldSpent / s.goldBudget) * 100)}%`, 7)}  ` +
          `${pad(`${Math.round((s.supplyUsed / s.supplyBudget) * 100)}%`, 8)}  ` +
          `${pad(s.tilesShort > 0 ? `${s.tilesShort} tiles` : '', 7)}`,
      );
    }
  }
  console.log();

  const out = flag('out');
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);
    console.log(`  report written to ${out}`);
  }
  const rawOut = flag('records');
  if (rawOut) {
    fs.writeFileSync(rawOut, `${JSON.stringify(raw)}\n`);
    console.log(`  ${raw.length} records written to ${rawOut}`);
  }
  if (out || rawOut) console.log();
}

export type { Matchup };

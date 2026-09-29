/**
 * How long each kind of scripted player lasts (src/bot/style.ts).
 *
 * Plays practice tables headless - three rolled bots and a stand-in for the
 * human (src/bot/table.ts) - and reports, per archetype, how far its bots got.
 * The practice match's opponents are meant to be a spread: some fall early,
 * some go the distance. This is how to see that they still are after a change
 * to the waves, the prices or the bots.
 *
 *   npm run bots                                   24 rolled tables
 *   npm run bots -- --tables 48 --seed 100
 *   npm run bots -- --solo --archetype banker      one bot alone, per builder
 *   npm run bots -- --list                         every seat, one line each
 *   npm run bots -- --archetype warden --style '{"formation":"deep"}'
 *                                                  what if every Warden stood deep
 */

import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { ARCHETYPES, ARCHETYPE_IDS, type ArchetypeId, type BotStyle } from '../bot/style.ts';
import { playTable, type SeatResult } from '../bot/table.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tables = Number(arg('tables') ?? 24);
const firstSeed = Number(arg('seed') ?? 1);
const solo = process.argv.includes('--solo');
const only = arg('archetype') as ArchetypeId | undefined;
if (only && !ARCHETYPE_IDS.includes(only)) {
  console.error(`unknown archetype ${only}: one of ${ARCHETYPE_IDS.join(', ')}`);
  process.exit(1);
}
const shard = arg('shard');
const overrides = arg('style') ? (JSON.parse(arg('style')!) as Partial<BotStyle>) : undefined;

interface Row {
  seed: number;
  seats: SeatResult[];
}

function play(seeds: number[]): Row[] {
  const { data } = loadDataFromDisk();
  return seeds.map((seed) => ({
    seed,
    seats: playTable(data, seed, {
      ...(solo ? { solo: true } : {}),
      ...(only ? { archetypes: solo ? [only] : [only, only, only] } : {}),
      ...(overrides ? { overrides } : {}),
    }),
  }));
}

const seeds = Array.from({ length: tables }, (_, i) => firstSeed + i);

if (shard) {
  const [index, count] = shard.split('/').map(Number) as [number, number];
  process.stdout.write(JSON.stringify(play(seeds.filter((_, i) => i % count === index))));
} else {
  const started = Date.now();
  const jobs = Math.max(1, Math.min(os.cpus().length, seeds.length));
  console.log(
    `\n${tables} ${solo ? 'solo runs' : 'tables'}${only ? ` of ${only}` : ''}, seeds ` +
      `${firstSeed}-${firstSeed + tables - 1}, on ${jobs} processes.\n`,
  );
  const rows = (await shardRows(jobs)).sort((a, b) => a.seed - b.seed);
  console.log(`Played in ${Math.round((Date.now() - started) / 1000)}s.\n`);
  report(rows);
}

async function shardRows(count: number): Promise<Row[]> {
  const self = fileURLToPath(import.meta.url);
  const passthrough = process.argv.slice(2);
  const shards = Array.from(
    { length: count },
    (_, i) =>
      new Promise<Row[]>((resolve, reject) => {
        const child = fork(self, [...passthrough, '--shard', `${i}/${count}`], {
          execArgv: process.execArgv,
          stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
        });
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (c: Buffer) => chunks.push(c));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) return reject(new Error(`shard ${i} exited ${String(code)}`));
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as Row[]);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }),
  );
  return (await Promise.all(shards)).flat();
}

function report(rows: Row[]): void {
  const seats = rows.flatMap((r) => r.seats);
  const line = (label: string, list: SeatResult[]) => {
    if (list.length === 0) return;
    const reached = list.map((s) => s.reached);
    const mean = reached.reduce((a, b) => a + b, 0) / reached.length;
    const share = (w: number) =>
      `${Math.round((100 * reached.filter((r) => r >= w).length) / reached.length)}%`.padStart(6);
    console.log(
      `  ${label.padEnd(12)}${String(list.length).padStart(5)}${mean.toFixed(1).padStart(7)}` +
        `${share(10)}${share(15)}${share(20)}${share(25)}   ${[...reached].sort((a, b) => a - b).join(' ')}`,
    );
  };
  const header = (title: string) =>
    console.log(
      `\n${title}\n  ${''.padEnd(12)}${'bots'.padStart(5)}${'mean'.padStart(7)}` +
        `${'10+'.padStart(6)}${'15+'.padStart(6)}${'20+'.padStart(6)}${'25'.padStart(6)}   waves reached`,
    );

  header('BY ARCHETYPE - the last wave each bot was standing at the end of');
  for (const a of ARCHETYPES)
    line(
      a.name,
      seats.filter((s) => s.archetype === a.id),
    );
  line('all', seats);

  header('BY BUILDER');
  for (const b of [...new Set(seats.map((s) => s.builderId))].sort()) {
    line(
      b,
      seats.filter((s) => s.builderId === b),
    );
  }

  if (!solo) {
    const best = rows.map((r) => Math.max(...r.seats.map((s) => s.reached)));
    console.log(
      `\nTables where some bot reached wave 20: ${best.filter((b) => b >= 20).length}/${rows.length}; ` +
        `wave 25: ${best.filter((b) => b >= 25).length}/${rows.length}.`,
    );
  }

  if (process.argv.includes('--list')) {
    console.log('\nEVERY SEAT');
    for (const row of rows) {
      console.log(
        `  seed ${String(row.seed).padStart(3)}  ` +
          row.seats
            .map(
              (s) =>
                `${s.archetype}/${s.builderId} ${s.fell === null ? `stood ${s.reached}` : `fell ${s.fell}`}`,
            )
            .join('   '),
      );
    }
  }
}

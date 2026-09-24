/**
 * Whole runs, played. docs/BALANCE.md.
 *
 * Every builder under every economy plan, waves 1 to N in the real simulation,
 * with a scripted player that buys its army by looking ahead at the coming wave
 * (`src/balance/run.ts`). The question is how far the economy can be pushed
 * and the player still be alive: the design's line is gem output 20 with two
 * rate levels by wave 10, and a plan that gets there comfortably means the
 * waves are too soft or the builder too strong.
 *
 *   npm run runs
 *   npm run runs -- --waves 10 --plans army,smart --builders pyre
 */

import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { ECONOMY_PLANS, playRun, type RunResult } from '../balance/run.ts';

const { data } = loadDataFromDisk();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function listFlag(name: string): string[] | undefined {
  return flag(name)
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const waves = Number(flag('waves') ?? 10);
const seed = Number(flag('seed') ?? 1);
const builders =
  listFlag('builders') ?? data.units.builders.filter((b) => b.complete).map((b) => b.id);
const plans = ECONOMY_PLANS.filter((p) =>
  (listFlag('plans') ?? ECONOMY_PLANS.map((q) => q.id)).includes(p.id),
);
const jobsList = builders.flatMap((builderId) =>
  plans.map((plan) => ({ builderId, planId: plan.id })),
);

const shard = flag('shard');
if (shard) {
  const [i, n] = shard.split('/').map(Number) as [number, number];
  const mine = jobsList.filter((_, k) => k % n === i);
  const out = mine.map((job) =>
    playRun(
      data,
      job.builderId,
      plans.find((p) => p.id === job.planId)!,
      waves,
      { seed },
    ),
  );
  process.stdout.write(JSON.stringify(out), () => process.exit(0));
} else {
  await whole();
}

async function whole(): Promise<void> {
  const started = Date.now();
  const jobs = Math.max(1, Math.min(os.cpus().length, jobsList.length));
  console.log(
    `\n${jobsList.length} runs: ${builders.length} builders x ${plans.length} plans, ` +
      `waves 1-${waves}, seed ${seed}, on ${jobs} processes.\n`,
  );
  const results = (await shardRuns(jobs)).sort(
    (a, b) =>
      builders.indexOf(a.builderId) - builders.indexOf(b.builderId) ||
      plans.findIndex((p) => p.id === a.planId) - plans.findIndex((p) => p.id === b.planId),
  );
  console.log(`${results.length} runs in ${Math.round((Date.now() - started) / 1000)}s.\n`);
  summary(results);
  for (const r of results) detail(r);
}

async function shardRuns(count: number): Promise<RunResult[]> {
  const self = fileURLToPath(import.meta.url);
  const passthrough = process.argv
    .slice(2)
    .filter((_, i, all) => all[i - 1] !== '--shard' && _ !== '--shard');
  const runs = Array.from(
    { length: count },
    (_, i) =>
      new Promise<RunResult[]>((resolve, reject) => {
        const child = fork(self, [...passthrough, '--shard', `${i}/${count}`], {
          execArgv: process.execArgv,
          stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
        });
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (c: Buffer) => chunks.push(c));
        let exited = false;
        let closed = false;
        let code: number | null = null;
        const finish = (): void => {
          if (!exited || !closed) return;
          if (code !== 0) return reject(new Error(`shard ${i} exited ${String(code)}`));
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as RunResult[]);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        child.on('error', reject);
        child.on('exit', (c) => {
          exited = true;
          code = c;
          finish();
        });
        child.stdout?.on('close', () => {
          closed = true;
          finish();
        });
      }),
  );
  return (await Promise.all(runs)).flat();
}

function rule(title: string): void {
  console.log(`${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function summary(results: RunResult[]): void {
  rule(`WHERE EACH RUN ENDED - the design's line is output 20 and rate 2 by wave ${waves}`);
  console.log(
    `  ${'builder'.padEnd(12)}${'plan'.padEnd(8)}${'reached'.padStart(8)}${'lowest'.padStart(8)}` +
      `${'output'.padStart(8)}${'rate'.padStart(6)}${'gem/s'.padStart(7)}${'income'.padStart(8)}` +
      `${'army$'.padStart(8)}${'eco$'.padStart(7)}${'banked'.padStart(8)}`,
  );
  for (const r of results) {
    const last = r.waves[r.waves.length - 1];
    const lowest = Math.min(...r.waves.map((w) => w.lowest));
    const over = last && last.survived && last.output >= 20 && last.rate >= 2;
    console.log(
      `  ${r.builderId.padEnd(12)}${r.planId.padEnd(8)}` +
        `${(r.survived ? `${r.reached}` : `died ${last?.wave ?? '?'}`).padStart(8)}` +
        `${`${Math.round(lowest * 100)}%`.padStart(8)}` +
        `${String(last?.output ?? 0).padStart(8)}${String(last?.rate ?? 0).padStart(6)}` +
        `${(last?.gemsPerSecond ?? 0).toFixed(1).padStart(7)}${String(last?.income ?? 0).padStart(8)}` +
        `${String(Math.round(last?.armyGold ?? 0)).padStart(8)}${String(Math.round(last?.economyGold ?? 0)).padStart(7)}` +
        `${String(Math.round(last?.gold ?? 0)).padStart(8)}${over ? '   <- past the line' : ''}`,
    );
  }
  console.log('');
}

function detail(r: RunResult): void {
  rule(`${r.builderId} - ${plans.find((p) => p.id === r.planId)?.name ?? r.planId}`);
  console.log(
    '  wave  fort  lowest   gold  income  out rate  gem/s   army$   eco$  bodies  supply  secs',
  );
  for (const w of r.waves) {
    console.log(
      `  ${String(w.wave).padStart(4)}${`${Math.round((100 * w.fortressHp) / w.fortressMaxHp)}%`.padStart(6)}` +
        `${`${Math.round(100 * w.lowest)}%`.padStart(8)}${String(Math.round(w.gold)).padStart(7)}` +
        `${String(w.income).padStart(8)}${String(w.output).padStart(5)}${String(w.rate).padStart(5)}` +
        `${w.gemsPerSecond.toFixed(1).padStart(7)}${String(Math.round(w.armyGold)).padStart(8)}` +
        `${String(Math.round(w.economyGold)).padStart(7)}${String(w.bodies).padStart(8)}` +
        `${`${w.supplyUsed}/${w.supplyCap}`.padStart(8)}${w.seconds.toFixed(0).padStart(6)}` +
        `${w.survived ? '' : '   LOST'}  ${w.army}`,
    );
  }
  console.log('');
}

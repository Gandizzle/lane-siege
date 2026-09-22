/**
 * The wave sandbox, swept. docs/BALANCE.md.
 *
 * For each of waves 1 to 5, for each builder, at gold bands either side of the
 * army value the wave is tuned for, buy every army that gold could buy and send
 * the wave at it. Report how many cleared and, more usefully, by how much.
 *
 *   npm run waves
 *   npm run waves -- --waves 1,2 --cap 40
 *   npm run waves -- --detail 1          the basket-by-basket table for wave 1
 */

import os from 'node:os';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  SWEEP_DEFAULTS,
  generateWaveSummary,
  nominalArmyGold,
  planProbes,
  runProbes,
  shoppingLabel,
  type Probe,
  type SweepOptions,
  type WaveOutcome,
} from '../balance/sandbox.ts';

const { data } = loadDataFromDisk();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function numberFlag(name: string, fallback: number): number {
  const raw = flag(name);
  const value = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
function listFlag(name: string, fallback: number[]): number[] {
  const raw = flag(name);
  if (!raw) return fallback;
  const parsed = raw.split(',').map(Number).filter(Number.isFinite);
  return parsed.length > 0 ? parsed : fallback;
}

const options: SweepOptions = {
  ...SWEEP_DEFAULTS,
  waves: listFlag('waves', SWEEP_DEFAULTS.waves),
  bands: listFlag('bands', SWEEP_DEFAULTS.bands),
  cap: numberFlag('cap', SWEEP_DEFAULTS.cap),
  seed: numberFlag('seed', SWEEP_DEFAULTS.seed),
};

const probes = planProbes(data, options);

// ------------------------------------------------------------------- a shard

const shard = flag('shard');
if (shard) {
  const [indexRaw, countRaw] = shard.split('/');
  const index = Number(indexRaw);
  const count = Number(countRaw);
  const mine = probes.filter((_, i) => i % count === index);
  const outcomes = runProbes(data, mine, options.seed, (done, total) => {
    if (done % 25 === 0 || done === total)
      process.stderr.write(`shard ${index}: ${done}/${total}\n`);
  });
  process.stdout.write(JSON.stringify(outcomes));
  process.exit(0);
}

// ------------------------------------------------------------- the whole run

const jobs = Math.max(1, Math.min(numberFlag('jobs', os.cpus().length), probes.length));
const started = Date.now();

console.log(
  `\n${probes.length} probes across waves ${options.waves.join(', ')}. seed ${options.seed}.`,
);
console.log(
  `gold bands: ${options.bands.map((b) => `${Math.round(b * 100)}%`).join(' ')} of nominal`,
);
console.log(`running on ${jobs} ${jobs === 1 ? 'process' : 'processes'}...\n`);

const outcomes =
  jobs === 1 ? runProbes(data, probes, options.seed, progress) : await runSharded(jobs);

report(outcomes);

function progress(done: number, total: number): void {
  if (done % 50 !== 0 && done !== total) return;
  const each = (Date.now() - started) / done;
  process.stderr.write(
    `  ${done}/${total}  ~${Math.round(((total - done) * each) / 1000)}s left\n`,
  );
}

async function runSharded(count: number): Promise<WaveOutcome[]> {
  const self = fileURLToPath(import.meta.url);
  const PARENT_ONLY = new Set(['--shard', '--jobs']);
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
      new Promise<WaveOutcome[]>((resolve, reject) => {
        const child = fork(self, [...passthrough, '--shard', `${i}/${count}`], {
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
            resolve(JSON.parse(out) as WaveOutcome[]);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }),
  );

  // Interleaved, so the shards finish together.
  const slices = await Promise.all(runs);
  const merged: WaveOutcome[] = [];
  for (let i = 0; ; i++) {
    let any = false;
    for (const slice of slices) {
      if (i < slice.length) {
        merged.push(slice[i]!);
        any = true;
      }
    }
    if (!any) break;
  }
  return merged;
}

// ------------------------------------------------------------------- reading

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function rule(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function report(all: WaveOutcome[]): void {
  console.log(`\n${all.length} probes in ${Math.round((Date.now() - started) / 1000)}s.\n`);

  rule('THE WAVES AS THEY STAND');
  console.log('  wave  monsters   total hp   nominal army   what a player has   slack');
  let earned = 250;
  for (const wave of options.waves) {
    const summary = generateWaveSummary(data, options.seed, wave);
    const nominal = nominalArmyGold(data, wave);
    console.log(
      `  ${String(wave).padStart(4)}  ${String(summary.count).padStart(8)}  ` +
        `${Math.round(summary.hp).toLocaleString().padStart(9)}  ${String(nominal).padStart(13)}  ` +
        `${earned.toLocaleString().padStart(18)}  ${String(earned - nominal).padStart(6)}`,
    );
    earned += 200;
  }

  for (const wave of options.waves) {
    const nominal = nominalArmyGold(data, wave);
    rule(`WAVE ${wave} — tuned for ${nominal} gold of army`);

    console.log(
      `  ${'builder'.padEnd(12)}${'gold'.padStart(6)}${'band'.padStart(6)}` +
        `${'armies'.padStart(8)}${'cleared'.padStart(9)}${'best'.padStart(8)}` +
        `${'median'.padStart(8)}${'worst'.padStart(8)}${'time'.padStart(7)}${'leaks'.padStart(7)}`,
    );

    for (const builder of data.units.builders.filter((b) => b.complete)) {
      for (const band of options.bands) {
        const gold = Math.round(nominal * band);
        const rows = all.filter(
          (o) => o.wave === wave && o.builderId === builder.id && o.goldBudget === gold,
        );
        if (rows.length === 0) continue;
        const margins = rows.map((r) => r.margin);
        const cleared = rows.filter((r) => r.cleared).length;
        console.log(
          `  ${builder.id.padEnd(12)}${String(gold).padStart(6)}${pct(band).padStart(6)}` +
            `${String(rows.length).padStart(8)}${`${cleared}/${rows.length}`.padStart(9)}` +
            `${Math.max(...margins)
              .toFixed(2)
              .padStart(8)}${median(margins).toFixed(2).padStart(8)}` +
            `${Math.min(...margins)
              .toFixed(2)
              .padStart(8)}` +
            `${`${median(rows.map((r) => r.seconds)).toFixed(0)}s`.padStart(7)}` +
            `${median(rows.map((r) => r.leaked))
              .toFixed(0)
              .padStart(7)}`,
        );
      }
      console.log('');
    }

    const atNominal = all.filter((o) => o.wave === wave && o.goldBudget === nominal);
    verdict(nominal, atNominal);
  }

  const detail = flag('detail');
  if (detail) detailTable(all, Number(detail));
}

function verdict(nominal: number, rows: WaveOutcome[]): void {
  if (rows.length === 0) return;
  const byBuilder = data.units.builders
    .filter((b) => b.complete)
    .map((b) => {
      const mine = rows.filter((r) => r.builderId === b.id);
      return {
        id: b.id,
        cleared: mine.filter((r) => r.cleared).length / Math.max(mine.length, 1),
        best: mine.length > 0 ? Math.max(...mine.map((r) => r.margin)) : 0,
      };
    })
    .sort((a, b) => b.best - a.best);

  console.log(`  AT NOMINAL (${nominal}g), best margin each:`);
  for (const b of byBuilder) {
    console.log(
      `    ${b.id.padEnd(12)}${b.best.toFixed(2).padStart(6)}   clears ${pct(b.cleared)} of its armies`,
    );
  }
  const spread = byBuilder[0]!.best - byBuilder[byBuilder.length - 1]!.best;
  console.log(`    spread ${spread.toFixed(2)}`);
}

function detailTable(all: WaveOutcome[], wave: number): void {
  rule(`WAVE ${wave} — every basket, best first`);
  const rows = all.filter((o) => o.wave === wave).sort((a, b) => b.margin - a.margin);
  console.log(
    `  ${'builder'.padEnd(12)}${'basket'.padEnd(26)}${'gold'.padStart(6)}` +
      `${'clr'.padStart(5)}${'army'.padStart(7)}${'wave'.padStart(7)}${'margin'.padStart(8)}${'time'.padStart(7)}`,
  );
  for (const r of rows.slice(0, 60)) {
    console.log(
      `  ${r.builderId.padEnd(12)}${r.label.slice(0, 25).padEnd(26)}${String(r.goldSpent).padStart(6)}` +
        `${(r.cleared ? 'Y' : `${r.leaked}!`).padStart(5)}${pct(r.armyHpLeft).padStart(7)}` +
        `${pct(r.waveHpLeft).padStart(7)}${r.margin.toFixed(2).padStart(8)}${`${r.seconds.toFixed(0)}s`.padStart(7)}`,
    );
  }
}

export type { Probe };
export { shoppingLabel };

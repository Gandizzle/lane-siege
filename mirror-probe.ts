import { loadDataFromDisk } from './src/data/loadNode.ts';
import { BUILD_SPECS, realise } from './src/balance/builds.ts';
import { runArena } from './src/balance/arena.ts';
import { Rng } from './src/sim/index.ts';

const { data } = loadDataFromDisk();
const design = BUILD_SPECS.find((s) => s.id === 'design')!;
const runs = Number(process.argv[2] ?? 200);

// Small armies: this is a question about the ARENA, not about the roster, and
// four identical armies of six bodies answer it as well as four of ninety.
for (const [label, gold, supply] of [
  ['tiny  ', 900, 8],
  ['small ', 2400, 20],
] as const) {
  for (const builderId of data.units.builders.map((b) => b.id)) {
    const army = realise(data, builderId, design, gold, supply);
    const wins = [0, 0, 0, 0];
    const rng = new Rng(4242);
    let timeouts = 0;
    for (let i = 0; i < runs; i++) {
      const r = runArena(data, [army, army, army, army], rng.int(1e9));
      if (r.timedOut) timeouts++;
      for (const s of r.seats) if (s.won) wins[s.seat]! += 1;
    }
    const pct = (n: number) => `${((n / runs) * 100).toFixed(1)}%`;
    console.log(
      label,
      builderId.padEnd(11),
      army.units.length,
      'bodies  ',
      wins.map((w, i) => `s${i} ${pct(w)}`).join('  '),
      timeouts ? `  (${timeouts} timed out)` : '',
    );
  }
}

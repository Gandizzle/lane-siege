/**
 * Browser entry point.
 *
 * Loads the balance data, reports anything still unfilled, and starts the game.
 * `?seed=123` fixes the match seed, which makes a bug reproducible: wave
 * composition is a pure function of (seed, waveNumber) (§9.2).
 */

import { loadBundledData } from './data/bundle.ts';
import { formatReport } from './data/validate.ts';
import { startApp } from './render/app.ts';

const mount = document.getElementById('game');
if (!mount) throw new Error('#game mount point is missing from index.html');

const { data, report } = loadBundledData();

if (report.errors.length > 0 || report.missing.length > 0) {
  // Expected during the design phase: data/ is deliberately empty.
  console.info('[lane-siege] balance data status\n%s', formatReport(report));
}

const seedParam = Number(new URLSearchParams(globalThis.location.search).get('seed'));
const seed = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : undefined;

await startApp(mount, data, seed);

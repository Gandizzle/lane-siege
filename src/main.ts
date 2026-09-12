/**
 * Browser entry point.
 *
 * Loads the balance data, reports anything still unfilled, and starts the game.
 *
 *   `?seed=123`               fixes the match seed, which makes a bug
 *                             reproducible: wave composition is a pure function
 *                             of (seed, waveNumber) (§9.2).
 *   `?server=ws://host:2567`  joins a four-player match on that server instead
 *                             of playing a local practice match (§17, M4).
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

const params = new URLSearchParams(globalThis.location.search);

const seedParam = Number(params.get('seed'));
const seed = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : undefined;

// `?server=ws://host:2567` joins a real match; without it this is a practice
// match against scripted opponents, simulated in this tab (§17, M4).
const server = params.get('server') ?? undefined;

await startApp(mount, data, { ...(seed !== undefined && { seed }), ...(server && { server }) });

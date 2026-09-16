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
 *   `?wave=25`                practice only: starts at the build phase before
 *                             that wave, with every lane funded, so the late
 *                             game can be looked at without playing
 *                             twenty-five waves to reach it.
 *   `?showdown=1`             practice only: starts in the Final Showdown's
 *                             arena, with four scripted armies already in it
 *                             (§3.3, replaced). `?wave=25` is the honest route
 *                             to the ending; this one is for looking at it.
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

const waveParam = Number(params.get('wave'));
const startWave = Number.isFinite(waveParam) && waveParam > 1 ? Math.floor(waveParam) : undefined;

const startInShowdown = params.get('showdown') === '1';

await startApp(mount, data, {
  ...(seed !== undefined && { seed }),
  ...(server && { server }),
  ...(startWave !== undefined && { startWave }),
  ...(startInShowdown && { startInShowdown }),
});

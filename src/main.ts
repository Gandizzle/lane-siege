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
 *   `?sounds=1`               opens a panel over the game for playing every
 *                             sound and piece of music (src/audio/soundBoard.ts).
 *   `?progress=test`          practice and solo earn XP as a normal match does,
 *                             with no daily cap; Supporter and the Founders'
 *                             claim are granted free, on this device; and the
 *                             Collection can climb a level at a tap - so
 *                             levels, keys, unlocks and boosts can all be
 *                             tried before there is a server or a way to pay.
 *
 * Every one of those is the test build's. A RELEASE build - the web version
 * on its own domain, or the Android app (buildInfo.ts) - takes none of them:
 * it connects to the server it was built for (`VITE_SERVER`) and plays the
 * game as players get it.
 *
 * Crash reports start first, before anything that could fail
 * (net/crashReporter.ts), and anything they could not send last time goes now.
 */

import { loadBundledData } from './data/bundle.ts';
import { formatReport } from './data/validate.ts';
import { startApp } from './render/app.ts';
import { mountSoundBoard } from './audio/soundBoard.ts';
import { BUILD_INFO, RELEASE } from './buildInfo.ts';
import { CrashReporter, type CrashTarget } from './net/crashReporter.ts';
import { browserStorage } from './net/identity.ts';

// A release build ignores every switch below: they are the test build's.
const params = new URLSearchParams(RELEASE ? '' : globalThis.location.search);

// `?server=ws://host:2567` joins a real match; without it this is a practice
// match against scripted opponents, simulated in this tab (§17, M4). A
// release build connects to the server it was built for.
const server = params.get('server') ?? (import.meta.env.VITE_SERVER || undefined);

const crash = new CrashReporter(BUILD_INFO, browserStorage(), server ?? null);
crash.install(globalThis as unknown as CrashTarget);
void crash.flush();

const mount = document.getElementById('game');
if (!mount) throw new Error('#game mount point is missing from index.html');

const { data, report } = loadBundledData();

if (report.errors.length > 0 || report.missing.length > 0) {
  // Expected during the design phase: data/ is deliberately empty.
  console.info('[lane-siege] balance data status\n%s', formatReport(report));
}

const seedParam = Number(params.get('seed'));
const seed = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : undefined;

const waveParam = Number(params.get('wave'));
const startWave = Number.isFinite(waveParam) && waveParam > 1 ? Math.floor(waveParam) : undefined;

const startInShowdown = params.get('showdown') === '1';

// `?progress=test`: try XP, levels and the placeholder store without a server
// or a payment provider (render/game.ts, `progressTest`).
const progressTest = params.get('progress') === 'test';

const running = await startApp(mount, data, {
  ...(seed !== undefined && { seed }),
  ...(server && { server }),
  ...(startWave !== undefined && { startWave }),
  ...(startInShowdown && { startInShowdown }),
  ...(progressTest && { progressTest }),
  crash,
});

if (params.get('sounds') === '1') mountSoundBoard(running.sound);

/**
 * Browser entry point.
 *
 * Loads the balance data, reports what is still unfilled, and starts the
 * renderer. The simulation is not driven yet - that is M2 (see DESIGN.md §17).
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

await startApp(mount, data);

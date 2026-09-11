/**
 * Reads `data/*.json` from disk. Used by the headless runner and by tests, so
 * balance sweeps pick up an edited JSON file without a build step.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateData } from './validate.ts';
import { DATA_FILE_NAMES } from './bundle.ts';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

export function loadDataFromDisk(dir: string = DATA_DIR) {
  const raw: Record<string, unknown> = {};
  for (const name of DATA_FILE_NAMES) {
    raw[name] = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  }
  return validateData(raw);
}

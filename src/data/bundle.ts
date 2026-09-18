/**
 * Static JSON imports, bundled by Vite for the browser build.
 *
 * The headless runner reads the same files from disk instead (see loadNode.ts),
 * so `data/` stays the single source of truth for both.
 */

import matrix from '../../data/matrix.json' with { type: 'json' };
import lane from '../../data/lane.json' with { type: 'json' };
import units from '../../data/units.json' with { type: 'json' };
import monsters from '../../data/monsters.json' with { type: 'json' };
import waves from '../../data/waves.json' with { type: 'json' };
import fortress from '../../data/fortress.json' with { type: 'json' };
import sends from '../../data/sends.json' with { type: 'json' };
import economy from '../../data/economy.json' with { type: 'json' };
import abilities from '../../data/abilities.json' with { type: 'json' };

import { validateData } from './validate.ts';

export const DATA_FILE_NAMES = [
  'matrix',
  'lane',
  'units',
  'monsters',
  'waves',
  'fortress',
  'sends',
  'economy',
  'abilities',
] as const;

export function loadBundledData() {
  return validateData({
    matrix,
    lane,
    units,
    monsters,
    waves,
    fortress,
    sends,
    economy,
    abilities,
  });
}

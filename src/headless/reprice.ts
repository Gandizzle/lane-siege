/**
 * Put the whole roster on the price ladder. `npm run reprice`.
 *
 * Reads `data/units.json`, applies src/balance/pricing.ts, and prints what
 * would change. Nothing is written without `--write`, because this rewrites
 * every gold cost, supply cost, damage and hit point figure in the game and
 * that is not a thing to do by accident.
 *
 *   npm run reprice              show the diff
 *   npm run reprice -- --write   apply it
 *   npm run reprice -- --bands   just the ladder, no per-unit rows
 */

import fs from 'node:fs';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { computeBudget } from '../balance/budget.ts';
import {
  GOLD_EFFICIENCY_PER_RUNG,
  MARK_COST,
  MARK_VALUE,
  SUPPLY_BY_RUNG,
  SUPPLY_EFFICIENCY_PER_RUNG,
  markOneCost,
  markStepCost,
  markStepSupply,
  monsterRescale,
  priceRoster,
  rosterScale,
  totalCost,
} from '../balance/pricing.ts';

const { data } = loadDataFromDisk();
const write = process.argv.includes('--write');
const bandsOnly = process.argv.includes('--bands');
const anchor = process.argv.includes('--median') ? 'median' : 'rung1';

const scale = rosterScale(data, anchor);
const priced = priceRoster(data, { anchor });
const byId = new Map(priced.map((p) => [p.id, p]));
const pad = (s: string | number, w: number): string => String(s).padStart(w);

// ------------------------------------------------------------------ the ladder

console.log('\nTHE RUNG LADDER');
console.log(
  `  value per gold   x${GOLD_EFFICIENCY_PER_RUNG} per rung` +
    `   (x${Math.pow(GOLD_EFFICIENCY_PER_RUNG, 5).toFixed(2)} over the six)`,
);
console.log(
  `  value per supply x${SUPPLY_EFFICIENCY_PER_RUNG} per rung` +
    `  (x${Math.pow(SUPPLY_EFFICIENCY_PER_RUNG, 5).toFixed(2)} over the six)\n`,
);
console.log('rung  supply   Mk I   Mk II   Mk III      total  supply  gold/supply');
for (let rung = 1; rung <= 6; rung++) {
  const full = totalCost(rung, 3);
  console.log(
    [
      pad(rung, 4),
      pad(SUPPLY_BY_RUNG[rung - 1]!, 8),
      pad(Math.round(markOneCost(rung)), 6),
      pad(Math.round(markStepCost(rung, 2)), 7),
      pad(Math.round(markStepCost(rung, 3)), 8),
      pad(Math.round(full.gold), 11),
      pad(full.supply, 7),
      pad((full.gold / full.supply).toFixed(0), 12),
    ].join(' '),
  );
}
console.log(
  `\n  a mark costs ${MARK_COST.map((c, i) => (i ? `${(c - MARK_COST[i - 1]!).toFixed(2)}x` : '1x')).join(' then ')}` +
    ` the base body and is worth ${MARK_VALUE.map((v) => `${v}x`).join(' / ')}`,
);
console.log(
  `  mark supply: Mk II free at every rung; Mk III costs the body again -` +
    ` ${[1, 3, 5].map((r) => markStepSupply(r, 3)).join(', ')} at rungs 1-2, 3-4, 5-6`,
);

// -------------------------------------------------------------- what it buys

const budget = computeBudget(data);
console.log('\nWHAT THE BUDGET BUYS');
console.log(
  `  ${Math.round(budget.armyGold).toLocaleString('en-GB')} gold and ${budget.armySupply} supply\n`,
);
console.log('  a Mark I army filling that supply, all of one rung:');
console.log('  rung  bodies    gold   spare gold  tiles (grid holds 80)');
for (let rung = 1; rung <= 6; rung++) {
  const bodies = Math.floor(budget.armySupply / SUPPLY_BY_RUNG[rung - 1]!);
  const capped = Math.min(bodies, 80);
  const cost = capped * markOneCost(rung);
  console.log(
    [
      pad(rung, 6),
      pad(capped, 8),
      pad(Math.round(cost).toLocaleString('en-GB'), 7),
      pad(Math.round(budget.armyGold - cost).toLocaleString('en-GB'), 12),
      pad(bodies > 80 ? `${bodies} wanted, 80 fit` : `${capped}`, 22),
    ].join(' '),
  );
}

// ------------------------------------------------------------- the whole diff

if (!bandsOnly) {
  console.log('\nPER UNIT   (gold, supply, damage, hp; -> is the new value)\n');
  for (const builder of data.units.builders) {
    console.log(`  ${builder.name}`);
    const mine = data.units.units
      .filter((u) => u.builderId === builder.id)
      .sort((a, b) => a.rung - b.rung || a.mark - b.mark);
    for (const unit of mine) {
      const p = byId.get(unit.id)!;
      const arrow = (was: number, now: number): string => {
        const shown = Math.round(now);
        return was === shown ? pad(shown, 6) : `${pad(was, 5)}>${pad(shown, 5)}`;
      };
      console.log(
        `    r${unit.rung} Mk${'I'.repeat(unit.mark).padEnd(3)} ${unit.name.padEnd(14)}` +
          ` gold ${arrow(unit.goldCost ?? 0, p.goldCost)}` +
          `  sup ${arrow(unit.supplyCost ?? 0, p.supplyCost)}` +
          `  dmg ${arrow(unit.damage ?? 0, p.damage)}` +
          `  hp ${arrow(unit.hp ?? 0, p.hp)}` +
          `  x${p.scaleFactor.toFixed(2)}`,
      );
    }
  }
}

const factors = priced.map((p) => p.scaleFactor).sort((a, b) => a - b);
console.log(
  `\n  anchored at ${anchor}: stats move by ${factors[0]!.toFixed(2)} to ` +
    `${factors[factors.length - 1]!.toFixed(2)}, median ${factors[factors.length >> 1]!.toFixed(2)}`,
);
console.log(
  `  the middle of the roster moves x${monsterRescale(data, scale).toFixed(1)}, so monster hp and\n` +
    '  damage want about that to keep the waves as hard as they are (a separate knob).',
);

// -------------------------------------------------------------------- writing

if (!write) {
  console.log('\n  nothing written. Pass --write to apply.\n');
} else {
  const path = 'data/units.json';
  const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as {
    units: Record<string, unknown>[];
  };
  for (const unit of raw.units) {
    const p = byId.get(unit.id as string);
    if (!p) continue;
    unit.goldCost = p.goldCost;
    unit.supplyCost = p.supplyCost;
    unit.damage = Math.round(p.damage);
    unit.hp = Math.round(p.hp);
  }
  fs.writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`\n  wrote ${priced.length} units to ${path}\n`);
}

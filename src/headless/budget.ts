/**
 * What a medium player can afford by the Final Showdown. `npm run budget`.
 *
 * Prints the model in src/balance/budget.ts against the live `data/`, which is
 * the number every unit price in the game is set against. Run it after touching
 * anything in economy.json, sends.json or the resource building: those four
 * files decide the size of the army, and a price change that halves the budget
 * is otherwise invisible until a roster stops fitting in it.
 *
 *   npm run budget            the whole run
 *   npm run budget -- --terse just the totals
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { computeBudget, gemsPerIncome } from '../balance/budget.ts';

const { data } = loadDataFromDisk();
const budget = computeBudget(data);
const terse = process.argv.includes('--terse');

const gold = (n: number): string => Math.round(n).toLocaleString('en-GB');
const pad = (s: string | number, w: number): string => String(s).padStart(w);

if (!terse) {
  console.log('\nTHE MODELLED RUN');
  console.log(
    '  every gem is spent on the cheapest send; one gem-output level a wave, one rate level every five\n',
  );
  console.log(
    [
      'wave',
      ' out',
      'rate',
      '  gems/s',
      '   gems',
      'sends',
      ' income',
      ' bounty',
      'sendBty',
      '  cumul',
    ]
      .map((h, i) => pad(h, [4, 4, 4, 8, 7, 5, 7, 7, 7, 8][i]!))
      .join(' '),
  );
  for (const r of budget.waves) {
    console.log(
      [
        pad(r.wave, 4),
        pad(r.outputLevel, 4),
        pad(r.rateLevel, 4),
        pad(r.gemsPerSecond.toFixed(1), 8),
        pad(gold(r.gems), 7),
        pad(Math.round(r.sends), 5),
        pad(gold(r.income), 7),
        pad(gold(r.bounty), 7),
        pad(gold(r.sendBounty), 7),
        pad(gold(r.cumulativeIncome), 8),
      ].join(' '),
    );
  }
}

const a = budget.assumptions;
console.log('\nASSUMPTIONS');
console.log(
  `  ${a.waves} waves of ${a.secondsPerWave}s (${a.secondsPerWave / 2}s build + a fight)`,
);
console.log(
  `  supply cap ${a.supplyCapTarget}, ${a.techLevels} levels in ${a.techTracks.join(', ')}`,
);
console.log(`  economy floor: ${gemsPerIncome(data)} gems per +1 gold a wave`);

console.log('\nGOLD IN');
console.log(`  starting                ${pad(gold(budget.startingGold), 8)}`);
console.log(`  wave bounty             ${pad(gold(budget.bountyTotal), 8)}`);
console.log(`  passive income          ${pad(gold(budget.passiveTotal), 8)}`);
console.log(`  bounty on sends taken   ${pad(gold(budget.sendBountyTotal), 8)}`);
console.log(`                          ${pad(gold(budget.incomeTotal), 8)}`);

console.log('\nGOLD OUT, BEFORE THE ARMY');
console.log(`  gem output + rate       ${pad(gold(budget.gemLadderTotal), 8)}`);
console.log(
  `  supply cap to ${pad(budget.supplyCap, 3)}       ${pad(gold(budget.supplyCapTotal), 8)}`,
);
for (const [id, cost] of Object.entries(budget.techTotal)) {
  console.log(`  ${id.padEnd(22)}  ${pad(gold(cost), 8)}`);
}
console.log(`                          ${pad(gold(budget.overheadTotal), 8)}`);

console.log('\nWHAT THE ARMY GETS');
console.log(`  gold                    ${pad(gold(budget.armyGold), 8)}`);
console.log(
  `  supply                  ${pad(budget.armySupply, 8)}   (cap ${budget.supplyCap} less ${budget.gemLadderSupply} on gem output)`,
);
console.log(
  `  gold per supply         ${pad((budget.armyGold / budget.armySupply).toFixed(1), 8)}`,
);
console.log(
  `\n  ${gold(budget.gemsTotal)} gems produced, ${gold(budget.sendsTotal)} sends bought\n`,
);

/**
 * `npm run abilities` - what every ability is worth (balance/abilityAudit.ts,
 * docs/BALANCE.md §4j).
 *
 *   --builders ironvow,pyre   which builders (default all four)
 *   --tiers early,mid,late    which armies (default all three)
 *   --seeds 24                fights per configuration
 *   --only kindle,verdict     just these abilities
 *   --lines                   also each line taken out whole, for scale
 *   --monsters                the wave's own monsters' abilities as well
 *   --bosses                  one boss at a time instead of a mixed wave
 *   --seedBase 1000           a different base is an independent sample
 *   --data dir                read the data from another folder
 *
 * Prints a row per ability: the wave strength the army loses without it. One
 * process per builder keeps four cores busy:
 *
 *   for b in ironvow pyre thornweald gloomtide; do npm run abilities -- --builders $b & done
 */

import { loadDataFromDisk } from '../data/loadNode.ts';
import { refId } from '../data/schema.ts';
import {
  TIERS,
  army,
  bossFight,
  breakingStrength,
  curveAt,
  mixedWave,
  without,
  worth,
  type Fight,
} from '../balance/abilityAudit.ts';

const args = process.argv.slice(2);
const option = (name: string): string | null => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? '') : null;
};
const flag = (name: string) => args.includes(`--${name}`);
// Another copy of data/, for trying a change without touching the real one.
const { data } = loadDataFromDisk(option('data') ?? undefined);

const builders = (option('builders') ?? data.units.builders.map((b) => b.id).join(',')).split(',');
const tiers = TIERS.filter((t) => (option('tiers') ?? 'early,mid,late').split(',').includes(t.id));
const seeds = Number(option('seeds') ?? 16);
const only = option('only')?.split(',') ?? null;
const bosses = flag('bosses')
  ? (data.waves.bossBank ?? data.monsters.bosses.map((b) => b.id))
  : null;

const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

for (const builderId of builders) {
  for (const tier of tiers) {
    if (bosses && tier.id === 'early') continue;
    const shopping = army(data, builderId, tier);
    const chains = shopping.buys.map((b) => b.rung);
    const units = data.units.units.filter(
      (u) => u.builderId === builderId && u.mark === tier.mark && chains.includes(u.rung),
    );
    const abilities = [...new Set(units.flatMap((u) => (u.abilities ?? []).map(refId)))].filter(
      (id) => !only || only.includes(id),
    );

    for (const arena of bosses ?? [null]) {
      const base = arena ? bossFight(data, tier, arena) : mixedWave(data, tier);
      const fight: Fight = {
        data: base,
        builderId,
        tier,
        shopping,
        boss: arena !== null,
        seedBase: Number(option('seedBase') ?? 1000),
      };
      const scale = breakingStrength(
        fight,
        arena ? tier.bossGuess : tier.guess,
        Math.max(8, seeds / 2),
      );
      const full = curveAt(fight, scale, seeds);
      const where = arena ?? 'mixed';
      console.log(
        `\n${builderId} ${tier.id} ${where}: ${shopping.buys.length} bodies, ${shopping.gold} gold, ` +
          `breaks at strength ${scale.toFixed(2)}`,
      );
      console.log(`  ${''.padEnd(30)} survival  comfort`);

      const measure = (label: string, variant: Fight, foes = false) => {
        const curve = curveAt(variant, scale, seeds);
        // A monster's ability is worth what the ARMY gains without it.
        const w = foes ? worth(curve, full) : worth(full, curve);
        const comfort = `${w.comfort >= 0 ? '+' : ''}${(w.comfort * 100).toFixed(1)}`;
        console.log(
          `  ${label.padEnd(30)} ${pct(w.survival).padStart(7)}${w.offBand ? '*' : ' '} ${comfort.padStart(7)}`,
        );
        process.stderr.write(
          JSON.stringify({ builderId, tier: tier.id, where, label, ...w, scale, full, curve }) +
            '\n',
        );
      };

      for (const id of abilities) {
        const owner = units.find((u) => (u.abilities ?? []).some((r) => refId(r) === id))!;
        measure(`${owner.id} ${id}`, { ...fight, data: without(base, id) });
      }
      if (flag('lines')) {
        for (const unit of units) {
          const rest = { ...shopping, buys: shopping.buys.filter((b) => b.rung !== unit.rung) };
          measure(`${unit.id} (whole line)`, { ...fight, shopping: rest });
        }
      }
      const foes = arena
        ? data.monsters.bosses.filter((b) => b.id === arena)
        : flag('monsters')
          ? data.monsters.monsters.filter((m) =>
              base.waves.combinations.some((c) => c.monsterId === m.id),
            )
          : [];
      for (const foe of foes) {
        for (const ref of foe.abilities ?? []) {
          measure(
            `${foe.id} ${refId(ref)} (monster)`,
            { ...fight, data: without(base, refId(ref)) },
            true,
          );
        }
      }
    }
  }
}

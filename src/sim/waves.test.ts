import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  generateWave,
  isBossWave,
  previewWave,
  resolveMonsterStats,
  sendBounty,
  sendPrice,
} from './waves.ts';
import { createContext, createMatch, createMonster, step } from './index.ts';

const { data } = loadDataFromDisk();

describe('wave generation (DESIGN.md §9.2)', () => {
  it('is a pure function of (matchSeed, waveNumber)', () => {
    // Not of anything else: wave 7 is identical whatever happened in 1-6.
    const a = generateWave(data, 555, 7);
    const b = generateWave(data, 555, 7);
    expect(a).toEqual(b);
  });

  it('uses the authored composition where one exists', () => {
    // Read off the file rather than written down here. The counts are balance
    // data and move whenever a wave is tuned; a test that names them fails on
    // every tuning pass and says nothing about generation either way.
    const authored = data.waves.composition.find((w) => w.wave === 1)!;
    const wave1 = generateWave(data, 1, 1);
    expect(wave1).toHaveLength(authored.entries.reduce((n, e) => n + (e.count ?? 0), 0));
    for (const entry of authored.entries) {
      expect(
        wave1.filter((s) => s.defId === entry.monsterId),
        entry.monsterId,
      ).toHaveLength(entry.count ?? 0);
    }
  });

  it('stamps each monster with its own wave number (§8)', () => {
    expect(generateWave(data, 1, 3).every((s) => s.waveNumber === 3)).toBe(true);
  });

  it('puts a boss on every fifth wave (§3.4)', () => {
    expect(isBossWave(data, 5)).toBe(true);
    expect(isBossWave(data, 10)).toBe(true);
    expect(isBossWave(data, 4)).toBe(false);

    const bossIds = new Set(data.waves.bossBank);
    expect(generateWave(data, 1, 5).some((s) => bossIds.has(s.defId))).toBe(true);
    expect(generateWave(data, 1, 10).some((s) => bossIds.has(s.defId))).toBe(true);
  });

  it('does not hand an authored boss wave a second boss', () => {
    const bossIds = new Set(data.waves.bossBank);
    const bosses = generateWave(data, 1, 5).filter((s) => bossIds.has(s.defId));
    expect(bosses).toHaveLength(1);
  });

  it('scales count and stats past the authored range (§9.1)', () => {
    // Waves 1-25 are authored; 26 onward reuse the last shape, scaled up -
    // its monsters, that is. Its bosses do not come along: a boss comes from
    // the bank on a boss wave, one of them.
    const bank = new Set(data.waves.bossBank);
    const escort = (wave: number) =>
      generateWave(data, 1, wave).filter((s) => !bank.has(s.defId)).length;
    expect(escort(30)).toBeGreaterThan(escort(25));
    expect(generateWave(data, 1, 31).some((s) => bank.has(s.defId))).toBe(false);
    expect(generateWave(data, 1, 30).filter((s) => bank.has(s.defId))).toHaveLength(1);

    const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;
    const early = resolveMonsterStats(data, grub, 1);
    const late = resolveMonsterStats(data, grub, 32);
    expect(late.hp).toBeGreaterThan(early.hp);
    expect(late.damage).toBeGreaterThan(early.damage);
    // Speed is enrage's job (§8), not the wave curve's - stacking both would
    // make late waves unreadable.
    expect(late.moveSpeed).toBe(early.moveSpeed);
    expect(late.attackSpeed).toBe(early.attackSpeed);
  });

  it('previews the incoming wave for the build phase (§9.3)', () => {
    const preview = previewWave(data, 1, 3);
    expect(preview.length).toBeGreaterThan(0);
    for (const entry of preview) {
      expect(entry.count).toBeGreaterThan(0);
      expect(entry.name).toBeTruthy();
      expect(entry.armour).toBeTruthy();
    }
    const total = preview.reduce((sum, e) => sum + e.count, 0);
    expect(total).toBe(generateWave(data, 1, 3).length);
  });
});

/**
 * §9.1, amended: a monster grows one step a wave, and the panel that shows it
 * resolves against the wave on screen rather than being told per body.
 */
describe('monsters grow with the wave', () => {
  const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;

  it('scales health and damage from wave 1 up', () => {
    const one = resolveMonsterStats(data, grub, 1);
    const five = resolveMonsterStats(data, grub, 5);
    expect(one.hp).toBe(grub.hp);
    expect(one.damage).toBe(grub.damage);
    expect(five.hp).toBeGreaterThan(one.hp * 1.5);
    expect(five.damage).toBeGreaterThan(one.damage * 1.4);
  });

  it('grows by the early rate up to its wave and the later rate after', () => {
    const { hp, damage, after } = data.waves.scaling;
    expect(after, 'the data has a later rate').toBeDefined();
    const at = (wave: number) => resolveMonsterStats(data, grub, wave);
    const last = after!.wave - 1;
    // Up to the wave before, nothing has changed: the early curve.
    expect(at(last).hp / at(last - 1).hp).toBeCloseTo(hp!, 9);
    expect(at(last).damage / at(last - 1).damage).toBeCloseTo(damage!, 9);
    // From it on, every step is the later rate.
    for (const wave of [after!.wave, after!.wave + 1, after!.wave + 6]) {
      expect(at(wave).hp / at(wave - 1).hp, `wave ${wave}`).toBeCloseTo(after!.hp, 9);
      expect(at(wave).damage / at(wave - 1).damage, `wave ${wave}`).toBeCloseTo(after!.damage, 9);
    }
  });

  it('grows a boss once a boss wave, faster from its later wave', () => {
    const boss = data.monsters.bosses[0]!;
    const { hp, damage, after } = data.waves.bossScaling!;
    const every = data.waves.bossEveryNWaves;
    const at = (wave: number) => resolveMonsterStats(data, boss, wave);
    expect(at(2 * every).hp / at(every).hp).toBeCloseTo(hp!, 9);
    expect(at(2 * every).damage / at(every).damage).toBeCloseTo(damage!, 9);
    for (const wave of [after!.wave, after!.wave + every]) {
      expect(at(wave).hp / at(wave - every).hp, `wave ${wave}`).toBeCloseTo(after!.hp, 9);
      expect(at(wave).damage / at(wave - every).damage, `wave ${wave}`).toBeCloseTo(
        after!.damage,
        9,
      );
    }
  });

  it("leaves speed and reach alone, which is enrage's job (§8)", () => {
    const one = resolveMonsterStats(data, grub, 1);
    const twenty = resolveMonsterStats(data, grub, 20);
    expect(twenty.moveSpeed).toBe(one.moveSpeed);
    expect(twenty.attackSpeed).toBe(one.attackSpeed);
    expect(twenty.range).toBe(one.range);
  });

  it('does not scale a boss twice', () => {
    // A boss has its own ladder, per BOSS wave. Taking the per-wave one too
    // would have wave 25's boss at the product of both.
    const boss = data.monsters.bosses[0]!;
    const first = resolveMonsterStats(data, boss, 5);
    expect(first.hp).toBe(boss.hp);
    expect(first.damage).toBe(boss.damage);
  });

  it('puts every living monster in a lane in the wave on screen', () => {
    // The stat panel resolves a monster against the CURRENT wave rather than
    // being told which wave each body came from (buildBar.ts,
    // `showMonsterStats`). That is only right because combat ends when the
    // lane is clear, so a wave can never land on an unfinished one.
    const state = createMatch(data, { seed: 5, teams: [{ id: 'l1', playerIds: ['p'] }] });
    const ctx = createContext(data);
    const lane = state.lanes.l1!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    lane.fortress.hp = lane.fortress.maxHp;

    let seen = 0;
    for (let t = 0; t < 4000; t++) {
      step(ctx, state);
      for (const monster of lane.monsters) {
        if (!monster.alive) continue;
        expect(monster.waveNumber, `tick ${t}`).toBe(state.wave);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

/**
 * §11.1, replaced: a wave pays a fixed pool rather than whatever its monsters
 * happened to be worth. The whole gold curve in docs/BALANCE.md rests on this,
 * so it is worth saying out loud in more than one way.
 */
describe('the wave bounty pool (§11.1, replaced)', () => {
  const pool = data.economy.waveBounty ?? 0;

  const purse = data.economy.bossBounty ?? 0;

  it('pays the same total every wave, whatever walks in', () => {
    for (let wave = 1; wave <= 30; wave++) {
      const paid = generateWave(data, 99, wave).reduce((sum, s) => sum + (s.bounty ?? 0), 0);
      // A boss wave pays the pool AND the boss's purse (§3.4, added); every
      // other wave pays the pool and nothing else, however many walk in.
      const due = pool + (isBossWave(data, wave) ? purse : 0);
      expect(paid, `wave ${wave}`).toBeCloseTo(due, 6);
    }
  });

  it('pays one purse a boss wave, however many bosses are in it', () => {
    const bank = new Set(data.waves.bossBank);
    const council = generateWave(data, 99, data.waves.showdown.afterWave);
    const bosses = council.filter((s) => bank.has(s.defId));
    expect(bosses.length, 'the last wave is a council').toBeGreaterThan(1);
    const paid = council.reduce((sum, s) => sum + (s.bounty ?? 0), 0);
    expect(paid).toBeCloseTo(pool + purse, 6);
  });

  it('pays a boss its purse on top, and only a boss', () => {
    expect(purse).toBeGreaterThan(0);
    const bossIds = new Set(data.waves.bossBank);
    const wave = generateWave(data, 99, 5);
    const boss = wave.find((s) => bossIds.has(s.defId))!;
    const escort = wave.filter((s) => !bossIds.has(s.defId));

    // The escort still shares the plain pool between them; the difference
    // between what the boss takes and its share of that pool is the purse.
    const escortPaid = escort.reduce((sum, s) => sum + (s.bounty ?? 0), 0);
    expect(boss.bounty! - purse).toBeCloseTo(pool - escortPaid, 6);
    expect(boss.bounty!).toBeGreaterThan(escortPaid);
    for (const s of escort) expect(s.bounty!).toBeLessThan(purse);
  });

  it('splits it by the weight on each definition, not evenly', () => {
    // A monster worth twice another takes twice the share: the relative worth
    // survives, the total does not float. The pair is taken from whatever wave
    // 2 actually holds, because which monsters are in it is balance data.
    const byId = new Map(data.monsters.monsters.map((m) => [m.id, m]));
    const wave = generateWave(data, 1, 2);
    const kinds = [...new Set(wave.map((s) => s.defId))]
      .map((id) => ({ id, weight: byId.get(id)?.bounty ?? 0 }))
      .sort((a, b) => a.weight - b.weight);
    const light = wave.find((s) => s.defId === kinds[0]!.id)!;
    const heavy = wave.find((s) => s.defId === kinds[kinds.length - 1]!.id)!;
    expect(kinds[kinds.length - 1]!.weight).toBeGreaterThan(kinds[0]!.weight);

    const ratio = kinds[kinds.length - 1]!.weight / kinds[0]!.weight;
    expect(heavy.bounty! / light.bounty!).toBeCloseTo(ratio, 6);
    expect(heavy.bounty).not.toBeCloseTo(light.bounty!, 6);
  });

  it('does not pay more for a wave with more monsters in it', () => {
    // The old per-monster bounties made the biggest wave worth nineteen times
    // the smallest. Both waves are picked off the file by size and both are
    // non-boss, since a boss carries a purse on top of the pool and comparing
    // one against a plain wave would be comparing two different rules.
    const sizes = data.waves.composition
      .filter((w) => !isBossWave(data, w.wave))
      .map((w) => ({ wave: w.wave, n: w.entries.reduce((sum, e) => sum + (e.count ?? 0), 0) }))
      .sort((a, b) => a.n - b.n);
    const smallest = sizes[0]!;
    const biggest = sizes[sizes.length - 1]!;
    expect(biggest.n).toBeGreaterThan(smallest.n);

    const paid = (wave: number): number =>
      generateWave(data, 7, wave).reduce((sum, s) => sum + (s.bounty ?? 0), 0);
    expect(paid(biggest.wave)).toBeCloseTo(paid(smallest.wave), 6);
  });

  it('prices a sent monster against the gems its sender spent, not the pool', () => {
    const per10 = data.economy.sendBountyPerTenGems ?? 0;
    for (const send of data.sends.sends) {
      const paid = sendPrice(data, send.id).gems;
      expect(sendBounty(data, send.id), send.id).toBeCloseTo((paid * per10) / 10, 6);
    }
    // A dearer send hands its target more gold: that is the trade.
    const cheapest = data.sends.sends.reduce((a, b) =>
      (a.gemCost ?? 0) <= (b.gemCost ?? 0) ? a : b,
    );
    const dearest = data.sends.sends.reduce((a, b) =>
      (a.gemCost ?? 0) >= (b.gemCost ?? 0) ? a : b,
    );
    expect(sendBounty(data, dearest.id)).toBeGreaterThan(sendBounty(data, cheapest.id));
    expect(sendBounty(data, 'no-such-send')).toBe(0);
  });

  it('prices a send as written, in tens, whatever the wave', () => {
    for (const send of data.sends.sends) {
      const price = sendPrice(data, send.id);
      expect(price.gems, send.id).toBe(send.gemCost);
      expect(price.gems % 10, send.id).toBe(0);
      expect(price.income, send.id).toBe(send.incomeGranted);
    }
    expect(sendPrice(data, 'no-such-send')).toEqual({ gems: 0, income: 0 });
  });

  it('delivers a body the same size at every wave, as its send says', () => {
    // The price does not grow, so neither does what it buys (sends.json
    // `_bodies`). A monster walking in with the wave still grows.
    const ctx = createContext(data);
    for (const wave of [1, 12, 22]) {
      const state = createMatch(data, { seed: 1, teams: [{ id: 'a', playerIds: ['a'] }] });
      for (const send of data.sends.sends) {
        const monster = createMonster(
          state,
          data,
          ctx.defs,
          { defId: send.monsters[0]!, waveNumber: wave, sendId: send.id },
          { x: 1, y: -1 },
        )!;
        expect(monster.maxHp, `${send.id} at ${wave}`).toBe(send.hp);
        expect(monster.damage, `${send.id} at ${wave}`).toBe(send.damage);
      }
      const walkedIn = createMonster(
        state,
        data,
        ctx.defs,
        { defId: 'grub', waveNumber: wave },
        {
          x: 1,
          y: -1,
        },
      )!;
      const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;
      expect(walkedIn.maxHp).toBe(resolveMonsterStats(data, grub, wave).hp);
    }
  });
});

/**
 * §11.5: the cheapest send is the floor of the whole economy - the best gems
 * per +1 gold a wave that exists - and docs/BALANCE.md prices every unit in the
 * game against it. A dearer send that was also more efficient would make the
 * budget a fiction.
 */
describe('the send ladder', () => {
  const rate = (s: (typeof data.sends.sends)[number]) =>
    (s.incomeGranted ?? 0) / Math.max(1, s.gemCost ?? 0);

  it('runs fifteen sends from 10 gems to 500, every price a multiple of ten', () => {
    const costs = data.sends.sends.map((s) => s.gemCost ?? 0);
    expect(costs).toHaveLength(15);
    expect(Math.min(...costs)).toBe(10);
    expect(Math.max(...costs)).toBe(500);
    expect(data.sends.sends.find((s) => s.gemCost === 10)!.id).toBe('swarmling');
    for (const cost of costs) expect(cost % 10).toBe(0);
  });

  it('pays the best rate on three economy sends and less on every other', () => {
    const economic = data.sends.sends.filter((s) => s.economic === true);
    expect(economic.map((s) => s.id).sort()).toEqual(['grub', 'husk', 'swarmling']);
    const best = rate(economic[0]!);
    for (const send of economic) expect(rate(send), send.id).toBeCloseTo(best, 9);
    for (const send of data.sends.sends.filter((s) => s.economic !== true)) {
      // What you pay extra for is the body and the ability, never the rate.
      expect(rate(send), send.id).toBeLessThan(best);
    }
  });

  it('buys more body a gem the dearer the attack', () => {
    const attacks = data.sends.sends
      .filter((s) => s.economic !== true)
      .sort((a, b) => (a.gemCost ?? 0) - (b.gemCost ?? 0));
    const perGem = (s: (typeof attacks)[number]) => (s.hp ?? 0) / (s.gemCost ?? 1);
    const cheapest = attacks[0]!;
    const dearest = attacks[attacks.length - 1]!;
    expect(perGem(dearest)).toBeGreaterThan(perGem(cheapest));
    // And an attack buys more body a gem than an economy send does.
    for (const eco of data.sends.sends.filter((s) => s.economic === true)) {
      expect(perGem(cheapest), `${cheapest.id} vs ${eco.id}`).toBeGreaterThan(perGem(eco));
    }
  });

  it('opens the economy from the start and the dearest send last', () => {
    const from = (s: (typeof data.sends.sends)[number]) => s.fromWave ?? 1;
    for (const eco of data.sends.sends.filter((s) => s.economic === true)) {
      expect(from(eco), eco.id).toBe(1);
    }
    const dearest = data.sends.sends.reduce((a, b) =>
      (a.gemCost ?? 0) >= (b.gemCost ?? 0) ? a : b,
    );
    for (const send of data.sends.sends) {
      expect(from(send), send.id).toBeLessThanOrEqual(from(dearest));
    }
    expect(from(dearest)).toBeGreaterThan(1);
  });

  it('holds every send to a cooldown of one to ten seconds', () => {
    for (const send of data.sends.sends) {
      expect(send.cooldownSeconds, send.id).toBeGreaterThanOrEqual(1);
      expect(send.cooldownSeconds, send.id).toBeLessThanOrEqual(10);
    }
  });
});

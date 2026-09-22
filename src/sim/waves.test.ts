import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { generateWave, isBossWave, previewWave, resolveMonsterStats, sendBounty } from './waves.ts';
import { createContext, createMatch, step } from './index.ts';

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
    // Waves 1-25 are authored; 26 onward reuse the last shape, scaled up.
    const authored = generateWave(data, 1, 25).length;
    const beyond = generateWave(data, 1, 30).length;
    expect(beyond).toBeGreaterThan(authored);

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
      expect(sendBounty(data, send.id), send.id).toBeCloseTo(((send.gemCost ?? 0) * per10) / 10, 6);
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
});

/**
 * §11.5: the cheapest send is the floor of the whole economy - the best gems
 * per +1 gold a wave that exists - and docs/BALANCE.md prices every unit in the
 * game against it. A dearer send that was also more efficient would make the
 * budget a fiction.
 */
describe('the send ladder', () => {
  it('makes the cheapest send the best rate and nothing else as good', () => {
    const rates = data.sends.sends
      .filter((s) => (s.incomeGranted ?? 0) > 0)
      .map((s) => ({
        id: s.id,
        gems: s.gemCost ?? 0,
        rate: (s.gemCost ?? 0) / (s.incomeGranted ?? 1),
      }))
      .sort((a, b) => a.gems - b.gems);

    expect(rates.length).toBeGreaterThan(1);
    for (let i = 1; i < rates.length; i++) {
      // Strictly worse per income as it gets dearer: what you pay extra for is
      // the body and the ability, never a better rate.
      expect(rates[i]!.rate, `${rates[i]!.id} vs ${rates[i - 1]!.id}`).toBeGreaterThan(
        rates[i - 1]!.rate,
      );
    }
  });
});

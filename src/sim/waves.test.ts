import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { generateWave, isBossWave, previewWave, resolveMonsterStats, sendBounty } from './waves.ts';

const { data } = loadDataFromDisk();

describe('wave generation (DESIGN.md §9.2)', () => {
  it('is a pure function of (matchSeed, waveNumber)', () => {
    // Not of anything else: wave 7 is identical whatever happened in 1-6.
    const a = generateWave(data, 555, 7);
    const b = generateWave(data, 555, 7);
    expect(a).toEqual(b);
  });

  it('uses the authored composition where one exists', () => {
    const wave1 = generateWave(data, 1, 1);
    expect(wave1).toHaveLength(8);
    expect(wave1.every((s) => s.defId === 'grub')).toBe(true);
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
 * §11.1, replaced: a wave pays a fixed pool rather than whatever its monsters
 * happened to be worth. The whole gold curve in docs/BALANCE.md rests on this,
 * so it is worth saying out loud in more than one way.
 */
describe('the wave bounty pool (§11.1, replaced)', () => {
  const pool = data.economy.waveBounty ?? 0;

  it('pays the same total every wave, whatever walks in', () => {
    for (let wave = 1; wave <= 30; wave++) {
      const paid = generateWave(data, 99, wave).reduce((sum, s) => sum + (s.bounty ?? 0), 0);
      expect(paid, `wave ${wave}`).toBeCloseTo(pool, 6);
    }
  });

  it('splits it by the weight on each definition, not evenly', () => {
    // Wave 2 is grubs (weight 4) and husks (weight 9), so a husk is worth
    // 9/4 of a grub - the relative worth survives, the total does not float.
    const byId = new Map(data.monsters.monsters.map((m) => [m.id, m]));
    const wave = generateWave(data, 1, 2);
    const grub = wave.find((s) => s.defId === 'grub')!;
    const husk = wave.find((s) => s.defId === 'husk')!;

    const ratio = (byId.get('husk')!.bounty ?? 0) / (byId.get('grub')!.bounty ?? 0);
    expect(husk.bounty! / grub.bounty!).toBeCloseTo(ratio, 6);
    expect(husk.bounty).not.toBeCloseTo(grub.bounty!, 6);
  });

  it('does not pay more for a wave with more monsters in it', () => {
    // The old per-monster bounties made wave 25 worth nineteen times wave 1.
    const first = generateWave(data, 7, 1);
    const last = generateWave(data, 7, 25);
    expect(last.length).toBeGreaterThan(first.length * 2);
    expect(last.reduce((s, m) => s + (m.bounty ?? 0), 0)).toBeCloseTo(
      first.reduce((s, m) => s + (m.bounty ?? 0), 0),
      6,
    );
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

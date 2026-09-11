import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { generateWave, isBossWave, previewWave, resolveMonsterStats } from './waves.ts';

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

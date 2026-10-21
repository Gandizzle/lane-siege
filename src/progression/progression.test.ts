/**
 * XP, levels, boosts, the store's placeholders and cosmetics (src/progression).
 */

import { describe, expect, it } from 'vitest';
import { awardXp, boostStatus, ordinal, startBoost, type MatchResult } from './award.ts';
import {
  COSMETICS,
  PROGRESSION,
  STORE,
  parseCosmetics,
  parseProgression,
  type ProgressionConfig,
} from './config.ts';
import { howToUnlock, isUnlocked, setEnabled } from './cosmetics.ts';
import { levelOf, xpToNext, xpToReach } from './levels.ts';
import { NEW_PROFILE, dayKey, parseProfile, type Profile } from './profile.ts';
import { ProgressStore } from './store.ts';

function memory() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
}

/** Fixed numbers, so these tests are about the rules rather than today's tuning. */
const CONFIG: ProgressionConfig = {
  levels: { first: 300, step: 100 },
  match: { played: 100, perWave: 8, placement: [150, 90, 50, 20], showdown: 50 },
  casual: { dailyCap: 500 },
  adBoost: { bonus: 1, waves: 25, offerBelow: 25, maxWaves: 50 },
  supporter: { bonus: 0.25 },
};

const won: MatchResult = {
  mode: 'online',
  placement: 1,
  wavesSurvived: 25,
  wavesPlayed: 25,
  reachedShowdown: true,
};
/** Out in wave 6: five got through, six fought. */
const outEarly: MatchResult = {
  mode: 'online',
  placement: 4,
  wavesSurvived: 5,
  wavesPlayed: 6,
  reachedShowdown: false,
};
const practice: MatchResult = {
  mode: 'practice',
  placement: 2,
  wavesSurvived: 25,
  wavesPlayed: 25,
  reachedShowdown: true,
};

function fresh(): Profile {
  return structuredClone(NEW_PROFILE);
}

describe('the data', () => {
  it('reads the shipped files', () => {
    expect(PROGRESSION.levels.first).toBeGreaterThan(0);
    expect(PROGRESSION.match.placement.length).toBeGreaterThanOrEqual(4);
    expect(STORE.bundles.some((b) => b.featured)).toBe(true);
    expect(COSMETICS.slots.length).toBeGreaterThan(0);
  });

  it('puts every bundled cosmetic in the catalogue, and makes every store cosmetic buyable', () => {
    const ids = new Set(COSMETICS.cosmetics.map((c) => c.id));
    for (const bundle of STORE.bundles) {
      for (const id of bundle.cosmetics) expect(ids.has(id), `${bundle.id}: ${id}`).toBe(true);
    }
    // A store cosmetic with no price of its own has to come in a bundle, or
    // nothing would ever sell it.
    const bundled = new Set(STORE.bundles.flatMap((b) => b.cosmetics));
    for (const c of COSMETICS.cosmetics) {
      if (c.unlock.store && c.price === null) expect(bundled.has(c.id), c.id).toBe(true);
    }
  });

  it('refuses a file it cannot trust, naming the field', () => {
    expect(() => parseProgression({})).toThrow(/progression: expected an object|levels/);
    expect(() =>
      parseCosmetics({
        slots: [{ id: 'title', name: 'T', blurb: 'b', exclusive: true, live: true }],
        cosmetics: [{ id: 'x', slot: 'hat', name: 'X', unlock: { free: true } }],
      }),
    ).toThrow(/no slot called hat/);
    expect(() =>
      parseCosmetics({
        slots: [{ id: 'title', name: 'T', blurb: 'b', exclusive: true, live: true }],
        cosmetics: [{ id: 'x', slot: 'title', name: 'X', unlock: {} }],
      }),
    ).toThrow(/nothing unlocks it/);
  });
});

describe('levels', () => {
  const curve = CONFIG.levels;

  it('asks a fixed step more for each level than for the last', () => {
    expect(xpToNext(1, curve)).toBe(300);
    expect(xpToNext(2, curve)).toBe(400);
    expect(xpToNext(10, curve)).toBe(1200);
    for (let level = 1; level < 200; level++) {
      expect(xpToNext(level + 1, curve) - xpToNext(level, curve)).toBe(curve.step);
    }
  });

  it('starts at level 1 and climbs at the sums of the steps', () => {
    expect(xpToReach(1, curve)).toBe(0);
    expect(xpToReach(2, curve)).toBe(300);
    expect(xpToReach(3, curve)).toBe(700);
    expect(levelOf(0, curve)).toEqual({ level: 1, into: 0, needed: 300, total: 0 });
    expect(levelOf(299, curve).level).toBe(1);
    expect(levelOf(300, curve)).toEqual({ level: 2, into: 0, needed: 400, total: 300 });
    expect(levelOf(699, curve)).toEqual({ level: 2, into: 399, needed: 400, total: 699 });
    expect(levelOf(700, curve).level).toBe(3);
  });

  it('agrees with counting up, everywhere, and has no top', () => {
    let level = 1;
    for (let xp = 0; xp < 60_000; xp += 37) {
      while (xpToReach(level + 1, curve) <= xp) level++;
      const at = levelOf(xp, curve);
      expect(at.level, `${xp} XP`).toBe(level);
      expect(at.into).toBe(xp - xpToReach(level, curve));
    }
    // A billion XP is a level like any other.
    const far = levelOf(1e9, curve);
    expect(far.level).toBeGreaterThan(4000);
    expect(xpToReach(far.level, curve)).toBeLessThanOrEqual(1e9);
    expect(xpToReach(far.level + 1, curve)).toBeGreaterThan(1e9);
  });
});

describe('what a match earns', () => {
  const today = '2026-10-16';

  it('pays a normal match for playing, waves, placement and the showdown', () => {
    const { award } = awardXp(CONFIG, fresh(), won, today);
    expect(award.lines.map((l) => [l.id, l.xp])).toEqual([
      ['played', 100],
      ['waves', 200],
      ['placement', 150],
      ['showdown', 50],
    ]);
    expect(award.total).toBe(500);
    expect(award.lines[2]!.label).toBe('1st place');
  });

  it('still pays a player out early', () => {
    const { award, profile } = awardXp(CONFIG, fresh(), outEarly, today);
    expect(award.total).toBe(100 + 5 * 8 + 20);
    expect(profile.xp).toBe(160);
    expect(award.note).toBeNull();
  });

  it('pays practice line by line, the way a normal match is paid', () => {
    const { award, profile } = awardXp(CONFIG, fresh(), practice, today);
    expect(award.lines.map((l) => [l.id, l.xp])).toEqual([
      ['played', 100],
      ['waves', 200],
      ['placement', 90],
      ['showdown', 50],
    ]);
    expect(award.total).toBe(440);
    expect(award.note).toBe('Practice and solo XP today: 440 of 500.');
    expect(profile.casual).toEqual({ day: today, xp: 440 });
  });

  it('pays solo for playing and for waves, with no one to place against', () => {
    const solo: MatchResult = { ...outEarly, mode: 'solo', placement: 1 };
    const { award } = awardXp(CONFIG, fresh(), solo, today);
    expect(award.lines.map((l) => l.id)).toEqual(['played', 'waves']);
    expect(award.total).toBe(100 + 5 * 8);
  });

  it("stops practice and solo at the day's cap, and starts again tomorrow", () => {
    const first = awardXp(CONFIG, fresh(), practice, today);
    // 440 of 500 spent: the next match earns 60 of its 440, and says so.
    const second = awardXp(CONFIG, first.profile, practice, today);
    expect(second.award.lines.at(-1)).toEqual({
      id: 'limit',
      label: "Over today's limit",
      xp: -380,
    });
    expect(second.award.total).toBe(60);
    expect(second.award.note).toMatch(/today's 500 XP/);
    expect(second.profile.xp).toBe(500);

    // Spent: nothing more today, not even for a boost to work on.
    const third = awardXp(CONFIG, startBoost(CONFIG, second.profile), practice, today);
    expect(third.award.lines).toEqual([]);
    expect(third.award.total).toBe(0);
    expect(third.profile.adBoost.wavesLeft).toBe(25);

    const tomorrow = awardXp(CONFIG, third.profile, { ...practice, mode: 'solo' }, '2026-10-17');
    expect(tomorrow.award.total).toBeGreaterThan(0);
    expect(tomorrow.profile.casual.day).toBe('2026-10-17');
  });

  it('adds boosts to what the cap allows, not to what it took off', () => {
    const spentMost = { ...fresh(), casual: { day: today, xp: 450 } };
    const { award } = awardXp(CONFIG, startBoost(CONFIG, spentMost), practice, today);
    expect(award.base).toBe(50);
    expect(award.boosts).toEqual([{ id: 'adBoost', label: 'Boost +100%', xp: 50 }]);
    expect(award.total).toBe(100);
  });

  it('boosts the waves a match had, keeps the rest, and lets a zero go by', () => {
    // Today's practice XP already had, so practice earns nothing below.
    let profile: Profile = { ...fresh(), casual: { day: today, xp: CONFIG.casual.dailyCap } };
    profile = startBoost(CONFIG, profile);
    expect(profile.adBoost.wavesLeft).toBe(25);

    // Out in wave 6: all six waves boosted, nineteen kept for later.
    const early = awardXp(CONFIG, profile, outEarly, today);
    expect(early.award.boosts).toEqual([{ id: 'adBoost', label: 'Boost +100%', xp: 160 }]);
    expect(early.award.total).toBe(320);
    expect(early.profile.adBoost.wavesLeft).toBe(19);

    // More practice today earns nothing, so there is nothing to boost and
    // the waves are still there.
    const nothing = awardXp(CONFIG, early.profile, practice, today);
    expect(nothing.award.total).toBe(0);
    expect(nothing.profile.adBoost.wavesLeft).toBe(19);

    // A full match: the boost covers 19 of its 25 waves, so 19/25 of it.
    const full = awardXp(CONFIG, nothing.profile, won, today);
    expect(full.award.boosts).toEqual([
      { id: 'adBoost', label: 'Boost +100% (19 of 25 waves)', xp: 380 },
    ]);
    expect(full.award.total).toBe(880);
    expect(full.profile.adBoost.wavesLeft).toBe(0);
    expect(awardXp(CONFIG, full.profile, won, today).award.total).toBe(500);
  });

  it("keeps a Supporter's boost always on, and adds rather than multiplies", () => {
    const supporter = { ...fresh(), supporter: true };
    const { award, profile } = awardXp(CONFIG, supporter, won, today);
    expect(award.boosts.map((b) => [b.id, b.xp])).toEqual([
      ['adBoost', 500],
      ['supporter', 125],
    ]);
    expect(award.total).toBe(1125);
    // No waves to spend: it is just on.
    expect(profile.adBoost.wavesLeft).toBe(0);
    expect(awardXp(CONFIG, profile, won, today).award.total).toBe(1125);
  });

  it('pays nothing for a place past the end of the list', () => {
    const { award } = awardXp(CONFIG, fresh(), { ...outEarly, placement: 6 }, today);
    expect(award.lines.some((l) => l.id === 'placement')).toBe(false);
  });

  it('writes places the way they are said', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
  });
});

describe('the ad boost', () => {
  const today = '2026-10-16';

  it('is offered under 25 waves left, and stacks to under 50', () => {
    let profile = fresh();
    expect(boostStatus(CONFIG, profile)).toEqual({
      wavesLeft: 0,
      alwaysOn: false,
      offer: true,
      wavesAfter: 25,
    });
    profile = startBoost(CONFIG, profile);
    expect(boostStatus(CONFIG, profile).offer).toBe(false);

    // Six waves used: 19 left, so it is offered again, and stacks.
    profile = awardXp(CONFIG, profile, outEarly, today).profile;
    expect(boostStatus(CONFIG, profile)).toMatchObject({ wavesLeft: 19, offer: true });
    profile = startBoost(CONFIG, profile);
    expect(profile.adBoost.wavesLeft).toBe(44);
    expect(boostStatus(CONFIG, profile).offer).toBe(false);
  });

  it('has no daily limit', () => {
    let profile = fresh();
    for (let ad = 0; ad < 12; ad++) {
      expect(boostStatus(CONFIG, profile).offer, `ad ${ad}`).toBe(true);
      profile = startBoost(CONFIG, profile);
      profile = awardXp(CONFIG, profile, won, today).profile;
    }
    expect(profile.adBoost.wavesLeft).toBe(0);
  });

  it('never holds more than the most it stacks to', () => {
    const generous = { ...CONFIG, adBoost: { ...CONFIG.adBoost, offerBelow: 40 } };
    const profile = { ...fresh(), adBoost: { wavesLeft: 30 } };
    expect(boostStatus(generous, profile).wavesAfter).toBe(50);
    expect(startBoost(generous, profile).adBoost.wavesLeft).toBe(50);
  });

  it('is never offered to a Supporter, whose boost is always on', () => {
    const status = boostStatus(CONFIG, { ...fresh(), supporter: true });
    expect(status.alwaysOn).toBe(true);
    expect(status.offer).toBe(false);
  });
});

describe('the saved profile', () => {
  it('reads junk as a new player, and keeps what it can of a partial save', () => {
    expect(parseProfile('junk')).toEqual(NEW_PROFILE);
    // A boost saved when it was counted in matches starts again from none.
    expect(parseProfile({ adBoost: { matchesLeft: 2, day: '2026-10-16', watched: 1 } })).toEqual(
      NEW_PROFILE,
    );
    expect(parseProfile({ xp: 450.7, owned: ['a', 'a', 3], casual: { day: 'today' } })).toEqual({
      ...NEW_PROFILE,
      xp: 450,
      owned: ['a'],
    });
  });

  it('names the day the way daily limits compare it', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('saves an award, and the level it makes, across a reload', () => {
    const storage = memory();
    const now = () => new Date(2026, 9, 16, 12);
    const store = new ProgressStore(storage, now, CONFIG);
    const result = store.award(won);
    expect(result.award.total).toBe(500);
    expect(result.before.level).toBe(1);
    expect(result.after.level).toBe(2);
    expect(new ProgressStore(storage, now, CONFIG).level).toEqual(result.after);
  });

  it('starts a boost only when one is offered', () => {
    const store = new ProgressStore(memory(), () => new Date(2026, 9, 16), CONFIG);
    expect(store.startBoost()).toBe(true);
    expect(store.startBoost()).toBe(false);
    expect(store.boost().wavesLeft).toBe(25);
  });
});

describe('cosmetics', () => {
  const [title, other] = COSMETICS.cosmetics.filter((c) => c.slot === 'title' && c.unlock.free);
  const badges = COSMETICS.cosmetics.filter((c) => c.slot === 'badge');
  const leveled = COSMETICS.cosmetics.find((c) => c.unlock.level !== null && !c.unlock.free)!;
  const supporterOnly = COSMETICS.cosmetics.find((c) => c.unlock.supporter)!;

  it('unlocks by any one of the ways listed', () => {
    const nobody = { level: 1, supporter: false, owned: [] };
    expect(isUnlocked(title!, nobody)).toBe(true);
    expect(isUnlocked(leveled, nobody)).toBe(false);
    expect(isUnlocked(leveled, { ...nobody, level: leveled.unlock.level! })).toBe(true);
    expect(isUnlocked(supporterOnly, nobody)).toBe(false);
    expect(isUnlocked(supporterOnly, { ...nobody, supporter: true })).toBe(true);
    expect(howToUnlock(leveled)).toContain(`Reach level ${leveled.unlock.level}`);
  });

  it('wears one title at a time, and any number of badges', () => {
    // Only one free title ships; a second is made up for the rule.
    const second = other ?? { ...title!, id: 'title_test' };
    const config = { ...COSMETICS, cosmetics: [...COSMETICS.cosmetics, second] };
    let on = setEnabled(config, [], title!, true);
    on = setEnabled(config, on, second, true);
    expect(on).toEqual([second.id]);
    on = setEnabled(config, on, badges[0]!, true);
    on = setEnabled(config, on, badges[1]!, true);
    expect(on).toEqual([second.id, badges[0]!.id, badges[1]!.id]);
    expect(setEnabled(config, on, badges[0]!, false)).toEqual([second.id, badges[1]!.id]);
  });

  it('switches only what is unlocked, and stops wearing what is locked again', () => {
    const store = new ProgressStore(memory(), () => new Date(2026, 9, 16), CONFIG);
    store.setCosmetic(supporterOnly.id, true);
    expect(store.profile.cosmetics).toEqual([]);

    store.grant('supporter');
    store.setCosmetic(supporterOnly.id, true);
    expect(store.worn('badge').map((c) => c.id)).toEqual([supporterOnly.id]);

    store.clearPurchases();
    expect(store.worn('badge')).toEqual([]);
    // Still switched on, and back the moment it is unlocked again.
    store.grant('supporter');
    expect(store.worn('badge').map((c) => c.id)).toEqual([supporterOnly.id]);
  });

  it('gives a bundle its cosmetics', () => {
    const store = new ProgressStore(memory(), () => new Date(2026, 9, 16), CONFIG);
    const bundle = STORE.bundles.find((b) => b.cosmetics.length > 0)!;
    store.grant(bundle.id);
    for (const id of bundle.cosmetics) {
      const cosmetic = COSMETICS.cosmetics.find((c) => c.id === id)!;
      expect(store.isUnlocked(cosmetic), id).toBe(true);
    }
  });
});

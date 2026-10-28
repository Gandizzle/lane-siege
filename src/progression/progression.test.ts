/**
 * XP, levels, boosts, keys and what they unlock, Supporter and Founder, and
 * cosmetics (src/progression).
 */

import { describe, expect, it } from 'vitest';
import { awardXp, boostStatus, ordinal, startBoost, type MatchResult } from './award.ts';
import unitsJson from '../../data/units.json' with { type: 'json' };
import {
  COSMETICS,
  PROGRESSION,
  ROSTER,
  STORE,
  parseCosmetics,
  parseProgression,
  type CosmeticsConfig,
  type ProgressionConfig,
} from './config.ts';
import { forSale, howToUnlock, isUnlocked, setEnabled } from './cosmetics.ts';
import { levelOf, topLevel, xpToNext, xpToReach } from './levels.ts';
import { NEW_PROFILE, dayKey, parseProfile, type Profile } from './profile.ts';
import { ProgressStore, keysForEverything } from './store.ts';

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
  keys: { perLevel: 1, builder: 3, starter: 'ironvow' },
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
    expect(PROGRESSION.keys.perLevel).toBeGreaterThan(0);
    expect(STORE.supporter.perks.length).toBeGreaterThan(0);
    expect(STORE.founders.count).toBeGreaterThan(0);
    expect(COSMETICS.slots.length).toBeGreaterThan(0);
  });

  it('starts everyone with a builder, and opens the rest by level 10', () => {
    const builders = unitsJson.builders.map((b) => b.id);
    expect(builders).toContain(PROGRESSION.keys.starter);
    const toUnlockAll = (builders.length - 1) * PROGRESSION.keys.builder;
    expect(toUnlockAll).toBeLessThanOrEqual((10 - 1) * PROGRESSION.keys.perLevel);
  });

  it('stops levels where the keys for everything keys can unlock now are paid', () => {
    const all = keysForEverything(PROGRESSION, COSMETICS, ROSTER);
    const { topLevel: top } = new ProgressStore(memory());
    const perLevel = PROGRESSION.keys.perLevel;
    expect((top - 1) * perLevel).toBeGreaterThanOrEqual(all);
    expect((top - 2) * perLevel).toBeLessThan(all);
  });

  it('puts every title and badge a level unlocks within reach once everything listed is out', () => {
    const everything: CosmeticsConfig = {
      ...COSMETICS,
      slots: COSMETICS.slots.map((slot) => ({ ...slot, live: true })),
    };
    const top = topLevel(
      keysForEverything(PROGRESSION, everything, ROSTER),
      PROGRESSION.keys.perLevel,
    );
    for (const c of COSMETICS.cosmetics) {
      if (c.unlock.level !== null) expect(c.unlock.level, c.id).toBeLessThanOrEqual(top);
    }
  });

  it('ties titles to what they mean, and prices the decorations in keys', () => {
    for (const c of COSMETICS.cosmetics) {
      if (c.slot === 'title') expect(c.unlock.keys, c.id).toBeNull();
      if (c.unlock.keys !== null) expect([1, 2], c.id).toContain(c.unlock.keys);
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
    expect(() =>
      parseCosmetics({
        slots: [{ id: 'title', name: 'T', blurb: 'b', exclusive: true, live: true }],
        cosmetics: [{ id: 'x', slot: 'title', name: 'X', unlock: { keys: 0 } }],
      }),
    ).toThrow(/unlock\.keys/);
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
    expect(levelOf(0, curve)).toEqual({ level: 1, into: 0, needed: 300, total: 0, atTop: false });
    expect(levelOf(299, curve).level).toBe(1);
    expect(levelOf(300, curve)).toEqual({
      level: 2,
      into: 0,
      needed: 400,
      total: 300,
      atTop: false,
    });
    expect(levelOf(699, curve)).toMatchObject({ level: 2, into: 399, needed: 400, total: 699 });
    expect(levelOf(700, curve).level).toBe(3);
  });

  it('puts the top at the level that pays the last key needed', () => {
    expect(topLevel(9, 1)).toBe(10);
    expect(topLevel(23, 1)).toBe(24);
    // Two a level: five levels pay the nine, with one over.
    expect(topLevel(9, 2)).toBe(6);
    expect(topLevel(0, 1)).toBe(1);
    // Levels that pay nothing bank nothing, and need no top.
    expect(topLevel(9, 0)).toBe(Infinity);
  });

  it('stops at the top, full, with nothing past it counted', () => {
    const top = xpToReach(10, curve);
    expect(levelOf(1e9, curve, 10)).toEqual({
      level: 10,
      into: 0,
      needed: xpToNext(10, curve),
      total: top,
      atTop: true,
    });
    expect(levelOf(top, curve, 10).atTop).toBe(true);
    expect(levelOf(top - 1, curve, 10)).toMatchObject({ level: 9, atTop: false });
    expect(levelOf(0, curve, 1)).toMatchObject({ level: 1, atTop: true });
  });

  it('agrees with counting up, everywhere, and has no top of its own', () => {
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
    expect(far.atTop).toBe(false);
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

  it('gives a Founder everything a Supporter gets, under their own name', () => {
    const founder = { ...fresh(), founder: true };
    const { award } = awardXp(CONFIG, founder, won, today);
    expect(award.total).toBe(1125);
    expect(award.boosts.map((b) => b.label)).toEqual(['Boost +100%', 'Founder +25%']);
  });

  it('takes off what is past the top level, boosts and all, on the match that reaches it', () => {
    const top = xpToReach(10, CONFIG.levels);
    const near = startBoost(CONFIG, { ...fresh(), xp: top - 100 });
    const { award, profile } = awardXp(CONFIG, near, won, today, 10);
    // Everything it earned, shown, then the part past the top taken off.
    expect(award.base).toBe(500);
    expect(award.boosts.map((b) => b.xp)).toEqual([500]);
    expect(award.overTop).toEqual({ id: 'top', label: 'Past the top level', xp: -900 });
    expect(award.total).toBe(100);
    expect(award.note).toMatch(/^Level 10 is the top for now\. New builders and cosmetics/);
    expect(profile.xp).toBe(top);
    // It did earn, so the boost it had was used.
    expect(profile.adBoost.wavesLeft).toBe(0);

    // Landing on the top exactly takes nothing off, and still says so.
    const exact = awardXp(CONFIG, { ...fresh(), xp: top - 500 }, won, today, 10);
    expect(exact.award).toMatchObject({ total: 500, overTop: null });
    expect(exact.award.note).toMatch(/top for now/);
  });

  it('earns nothing at the top level, and uses up nothing: no boosted waves, no allowance', () => {
    const atTop = startBoost(CONFIG, { ...fresh(), xp: xpToReach(10, CONFIG.levels) });
    for (const result of [won, practice, outEarly]) {
      const { award, profile } = awardXp(CONFIG, atTop, result, today, 10);
      expect(award).toMatchObject({ lines: [], boosts: [], overTop: null, base: 0, total: 0 });
      expect(award.note).toMatch(/top for now/);
      expect(profile).toEqual(atTop);
    }
    // A Supporter's boost has nothing to add to there either.
    const supporter = { ...atTop, supporter: true };
    expect(awardXp(CONFIG, supporter, won, today, 10).award.total).toBe(0);
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

  it('is not offered at the top level, where there is no XP for it to boost', () => {
    expect(boostStatus(CONFIG, fresh(), false).offer).toBe(true);
    expect(boostStatus(CONFIG, fresh(), true)).toMatchObject({ wavesLeft: 0, offer: false });
  });

  it('is never offered to a Supporter or a Founder, whose boost is always on', () => {
    for (const perks of [{ supporter: true }, { founder: true }]) {
      const status = boostStatus(CONFIG, { ...fresh(), ...perks });
      expect(status.alwaysOn).toBe(true);
      expect(status.offer).toBe(false);
    }
  });
});

describe('the saved profile', () => {
  it('reads junk as a new player, and keeps what it can of a partial save', () => {
    expect(parseProfile('junk')).toEqual(NEW_PROFILE);
    // A boost saved when it was counted in matches starts again from none.
    expect(parseProfile({ adBoost: { matchesLeft: 2, day: '2026-10-16', watched: 1 } })).toEqual(
      NEW_PROFILE,
    );
    expect(
      parseProfile({ xp: 450.7, unlocked: ['a', 'a', 3], keysSpent: 2.9, casual: { day: 'x' } }),
    ).toEqual({ ...NEW_PROFILE, xp: 450, unlocked: ['a'], keysSpent: 2 });
    // What the test build bought, from before there were keys, is left behind.
    expect(parseProfile({ owned: ['fortress_gilded'], seenStore: true })).toEqual(NEW_PROFILE);
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

describe('keys', () => {
  /** A store at `level`, with nothing spent - or at the top, if that is lower. */
  function at(level: number, cosmetics = COSMETICS) {
    const store = new ProgressStore(memory(), () => new Date(2026, 9, 16), CONFIG, cosmetics);
    for (let climbed = 1; climbed < level; climbed++) store.testLevelUp();
    return store;
  }

  /** A drawn slot and one coming soon, each with something for keys in it. */
  const shop = parseCosmetics({
    slots: [
      { id: 'badge', name: 'B', blurb: 'b', exclusive: false, live: true },
      { id: 'trail', name: 'T', blurb: 't', exclusive: true, live: false },
    ],
    cosmetics: [
      { id: 'badge_x', slot: 'badge', name: 'X', glyph: 'star', unlock: { keys: 2 } },
      { id: 'trail_y', slot: 'trail', name: 'Y', unlock: { keys: 1 } },
    ],
  });

  it('pays one for every level climbed, none for the first', () => {
    expect(at(1).keys).toEqual({ earned: 0, spent: 0, left: 0, nextAt: 2 });
    expect(at(2).keys.left).toBe(1);
    expect(at(10).keys.left).toBe(9);
  });

  it('unlocks a builder once, with enough of them, and never the starter', () => {
    const store = at(3);
    expect(store.ownsBuilder('ironvow')).toBe(true);
    expect(store.unlockBuilder('ironvow')).toBe(false);
    expect(store.ownsBuilder('pyre')).toBe(false);
    expect(store.unlockBuilder('pyre')).toBe(false);
    expect(store.keys.left).toBe(2);

    store.testLevelUp();
    expect(store.unlockBuilder('pyre')).toBe(true);
    expect(store.ownsBuilder('pyre')).toBe(true);
    expect(store.keys).toMatchObject({ earned: 3, spent: 3, left: 0 });
    expect(store.unlockBuilder('pyre')).toBe(false);
  });

  it('opens every builder by level 10', () => {
    const store = at(10);
    for (const id of ['pyre', 'thornweald', 'gloomtide'])
      expect(store.unlockBuilder(id)).toBe(true);
    expect(store.keys.left).toBe(0);
  });

  it('unlocks a cosmetic the game draws, and switches it on', () => {
    const store = at(2, shop);
    const badge = shop.cosmetics[0]!;
    expect(store.unlockCosmetic('badge_x')).toBe(false);
    store.testLevelUp();
    expect(store.unlockCosmetic('badge_x')).toBe(true);
    expect(store.isOn(badge)).toBe(true);
    expect(store.keys.left).toBe(0);
    expect(store.unlockCosmetic('badge_x')).toBe(false);
  });

  it('spends nothing on a slot that is still to come', () => {
    const store = at(5, shop);
    expect(forSale(shop, shop.cosmetics[1]!)).toBe(false);
    expect(store.unlockCosmetic('trail_y')).toBe(false);
    expect(store.keys.spent).toBe(0);
  });

  it('keeps what was spent, and on what, across a reload', () => {
    const storage = memory();
    const now = () => new Date(2026, 9, 16);
    const store = new ProgressStore(storage, now, CONFIG);
    for (let i = 0; i < 3; i++) store.testLevelUp();
    store.unlockBuilder('gloomtide');
    const again = new ProgressStore(storage, now, CONFIG);
    expect(again.ownsBuilder('gloomtide')).toBe(true);
    expect(again.keys).toMatchObject({ spent: 3, left: 0 });
  });

  it('never has fewer than none left', () => {
    const storage = memory();
    storage.setItem('lane-siege.profile', JSON.stringify({ xp: 0, keysSpent: 9 }));
    expect(new ProgressStore(storage, () => new Date(), CONFIG).keys.left).toBe(0);
  });
});

describe('the top level', () => {
  const now = () => new Date(2026, 9, 16);
  /** One builder to unlock, for 3 keys. */
  const roster = ['ironvow', 'pyre'];
  function shop(trailLive: boolean): CosmeticsConfig {
    return parseCosmetics({
      slots: [
        { id: 'badge', name: 'B', blurb: 'b', exclusive: false, live: true },
        { id: 'trail', name: 'T', blurb: 't', exclusive: true, live: trailLive },
      ],
      cosmetics: [
        { id: 'badge_x', slot: 'badge', name: 'X', glyph: 'star', unlock: { keys: 2 } },
        { id: 'badge_y', slot: 'badge', name: 'Y', glyph: 'heart', unlock: { level: 3 } },
        { id: 'trail_z', slot: 'trail', name: 'Z', unlock: { keys: 1 } },
      ],
    });
  }
  function store(storage = memory(), trailLive = false) {
    return new ProgressStore(storage, now, CONFIG, shop(trailLive), STORE, roster);
  }

  it('counts every builder but the starter, and only what the game draws', () => {
    expect(keysForEverything(CONFIG, shop(false), roster)).toBe(3 + 2);
    expect(keysForEverything(CONFIG, shop(true), roster)).toBe(3 + 2 + 1);
    expect(keysForEverything(CONFIG, shop(false), ['ironvow'])).toBe(2);
    expect(store().topLevel).toBe(6);
  });

  it('pays exactly the keys for everything, and then stops', () => {
    const s = store();
    for (let i = 0; i < 20; i++) s.testLevelUp();
    expect(s.level).toMatchObject({ level: 6, into: 0, atTop: true });
    expect(s.keys).toEqual({ earned: 5, spent: 0, left: 5, nextAt: null });
    expect(s.unlockBuilder('pyre')).toBe(true);
    expect(s.unlockCosmetic('badge_x')).toBe(true);
    expect(s.keys.left).toBe(0);
  });

  it('earns nothing past it, and keeps the boost for later', () => {
    const s = store();
    for (let i = 0; i < 20; i++) s.testLevelUp();
    const result = s.award(won);
    expect(result).toMatchObject({ top: 6, before: { atTop: true }, after: { level: 6 } });
    expect(result.award.total).toBe(0);
    expect(s.boost().offer).toBe(false);
    expect(s.startBoost()).toBe(false);
  });

  it('lets go of XP past it from an old save, so a raised top pays nothing out at once', () => {
    const storage = memory();
    storage.setItem('lane-siege.profile', JSON.stringify({ xp: 1_000_000, keysSpent: 3 }));
    const s = store(storage);
    expect(s.level).toMatchObject({ level: 6, atTop: true });
    expect(s.keys).toMatchObject({ earned: 5, left: 2 });
    const saved = JSON.parse(storage.store.get('lane-siege.profile')!) as Profile;
    expect(saved.xp).toBe(xpToReach(6, CONFIG.levels));

    // The trail slot goes live: the top rises by what is in it, and the climb
    // starts again from the bottom of the next level.
    const raised = store(storage, true);
    expect(raised.topLevel).toBe(7);
    expect(raised.level).toMatchObject({ level: 6, into: 0, atTop: false });
    expect(raised.keys).toMatchObject({ left: 2, nextAt: 7 });
    expect(raised.boost().offer).toBe(true);
  });
});

describe('cosmetics', () => {
  const [title, other] = COSMETICS.cosmetics.filter((c) => c.slot === 'title' && c.unlock.free);
  const badges = COSMETICS.cosmetics.filter((c) => c.slot === 'badge');
  const leveled = COSMETICS.cosmetics.find((c) => c.unlock.level !== null && !c.unlock.free)!;
  const supporterOnly = COSMETICS.cosmetics.find((c) => c.unlock.supporter)!;
  const founderOnly = COSMETICS.cosmetics.filter((c) => c.unlock.founder);
  const forKeys = COSMETICS.cosmetics.find((c) => c.unlock.keys !== null)!;

  it('unlocks by any one of the ways listed', () => {
    const nobody = { level: 1, supporter: false, founder: false, unlocked: [] };
    expect(isUnlocked(title!, nobody)).toBe(true);
    expect(isUnlocked(leveled, nobody)).toBe(false);
    expect(isUnlocked(leveled, { ...nobody, level: leveled.unlock.level! })).toBe(true);
    expect(isUnlocked(supporterOnly, nobody)).toBe(false);
    expect(isUnlocked(supporterOnly, { ...nobody, supporter: true })).toBe(true);
    expect(isUnlocked(founderOnly[0]!, { ...nobody, supporter: true })).toBe(false);
    expect(isUnlocked(founderOnly[0]!, { ...nobody, founder: true })).toBe(true);
    expect(isUnlocked(forKeys, nobody)).toBe(false);
    expect(isUnlocked(forKeys, { ...nobody, unlocked: [forKeys.id] })).toBe(true);
    expect(howToUnlock(leveled)).toContain(`Reach level ${leveled.unlock.level}`);
    expect(howToUnlock(forKeys)).toMatch(/^\d keys?$/);
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

    store.grantSupporter();
    store.setCosmetic(supporterOnly.id, true);
    expect(store.worn('badge').map((c) => c.id)).toEqual([supporterOnly.id]);

    store.clearPurchases();
    expect(store.worn('badge')).toEqual([]);
    // Still switched on, and back the moment it is unlocked again.
    store.grantSupporter();
    expect(store.worn('badge').map((c) => c.id)).toEqual([supporterOnly.id]);
  });

  it("gives a Founder the Founder's badge and title, and a Supporter's", () => {
    const store = new ProgressStore(memory(), () => new Date(2026, 9, 16), CONFIG);
    store.grantFounder();
    expect(store.supporter).toBe(true);
    for (const c of [...founderOnly, supporterOnly]) expect(store.isUnlocked(c), c.id).toBe(true);
    expect(founderOnly.map((c) => c.slot).sort()).toEqual(['badge', 'title']);
  });
});

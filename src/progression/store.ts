/**
 * The player's progress, kept between visits: XP and the level it makes,
 * boosts, the day's practice allowance, Supporter and Founder, the keys the
 * levels have paid and what they have unlocked, and what is switched on.
 *
 * On the device for now (profile.ts says why that is acceptable, and what
 * changes when there is a server). Everything that decides an amount lives in
 * award.ts and cosmetics.ts as pure functions of the profile; this class only
 * holds the current one, hands it to them, and saves what comes back.
 *
 * KEYS
 *
 * Every level climbed pays keys (progression.json, keys), and keys are what
 * builders and cosmetics are unlocked with - money buys none of them. What is
 * left is what the levels have paid less what has been spent, so a key is
 * never lost and never paid twice: the level is the record of what was
 * earned, and `keysSpent` of what went on what is in `unlocked`.
 *
 * THE TOP LEVEL
 *
 * Levels stop at the one that pays the last key there is anything to spend on
 * (`keysForEverything`): every builder but the starter, and every cosmetic
 * keys can unlock now - a slot still to come counts once the game draws it.
 * So a player who has played through everything has unlocked everything,
 * with no pile of keys waiting for whatever comes next, and every new builder
 * or cosmetic raises the top and starts the climb again. XP past the top is
 * not kept (award.ts), not even from a save made before there was one.
 */

import type { KeyValueStore } from '../net/identity.ts';
import type { Looks } from '../sim/index.ts';
import {
  awardXp,
  boostStatus,
  startBoost,
  type BoostStatus,
  type MatchResult,
  type XpAward,
} from './award.ts';
import {
  COSMETICS,
  PROGRESSION,
  ROSTER,
  STORE,
  type Cosmetic,
  type CosmeticsConfig,
  type ProgressionConfig,
  type StoreConfig,
} from './config.ts';
import { cosmeticById, forSale, isUnlocked, setEnabled, wornIn, type Holder } from './cosmetics.ts';
import { levelOf, topLevel, xpCeiling, xpToReach, type LevelProgress } from './levels.ts';
import { dayKey, hasSupporterPerks, parseProfile, type Profile } from './profile.ts';

const STORAGE_KEY = 'lane-siege.profile';

/** A match's XP, and where it left the player. */
export interface AwardResult {
  award: XpAward;
  before: LevelProgress;
  after: LevelProgress;
  /** The top level it was counted against. */
  top: number;
}

/** The keys the levels have paid, and what is left of them. */
export interface Keys {
  earned: number;
  spent: number;
  /** Earned less spent, and never below none. */
  left: number;
  /** The level that pays the next ones; null at the top level, where none are coming. */
  nextAt: number | null;
}

/** How a builder is unlocked in `unlocked`, apart from the cosmetics. */
export function builderUnlockId(builderId: string): string {
  return `builder:${builderId}`;
}

/** What a builder costs to unlock: nothing for the starter everyone has. */
function builderCost(config: ProgressionConfig, builderId: string): number {
  return builderId === config.keys.starter ? 0 : config.keys.builder;
}

/**
 * The keys it takes to unlock everything keys can unlock now: every builder in
 * `roster` but the starter, and every cosmetic for keys in a slot the game
 * draws. The top level is the one that pays the last of them.
 */
export function keysForEverything(
  config: ProgressionConfig,
  cosmetics: CosmeticsConfig,
  roster: readonly string[],
): number {
  const builders = roster.reduce((sum, id) => sum + builderCost(config, id), 0);
  const looks = cosmetics.cosmetics
    .filter((c) => forSale(cosmetics, c))
    .reduce((sum, c) => sum + (c.unlock.keys ?? 0), 0);
  return builders + looks;
}

export class ProgressStore {
  private current: Profile;
  /** The top level for now: the one that pays the last key there is anything to spend on. */
  readonly topLevel: number;

  constructor(
    private readonly storage: KeyValueStore | null,
    /** The device's clock: daily allowances reset on its calendar day. */
    private readonly now: () => Date = () => new Date(),
    readonly config: ProgressionConfig = PROGRESSION,
    readonly cosmetics: CosmeticsConfig = COSMETICS,
    readonly store: StoreConfig = STORE,
    /** The builders there are, by id. */
    roster: readonly string[] = ROSTER,
  ) {
    let saved: unknown;
    try {
      const text = storage?.getItem(STORAGE_KEY);
      saved = text ? JSON.parse(text) : null;
    } catch {
      // Corrupt or blocked: a new player, rather than no game.
    }
    this.topLevel = topLevel(keysForEverything(config, cosmetics, roster), config.keys.perLevel);
    this.current = parseProfile(saved);
    // XP past the top is let go, whenever it was earned - a save from before
    // there was a top, say - or the next new builder would pay it all out.
    const ceiling = xpCeiling(this.topLevel, config.levels);
    if (this.current.xp > ceiling) this.save({ ...this.current, xp: ceiling });
  }

  get profile(): Readonly<Profile> {
    return this.current;
  }

  get level(): LevelProgress {
    return levelOf(this.current.xp, this.config.levels, this.topLevel);
  }

  /** A Supporter's perks, bought or a Founder's. */
  get supporter(): boolean {
    return hasSupporterPerks(this.current);
  }

  private get today(): string {
    return dayKey(this.now());
  }

  /** What unlocking reads: the level, Supporter and Founder, and what keys have opened. */
  get holder(): Holder {
    return {
      level: this.level.level,
      supporter: this.supporter,
      founder: this.current.founder,
      unlocked: this.current.unlocked,
    };
  }

  // ---------------------------------------------------------------- XP

  /** Count a finished match, save it, and say what it earned. */
  award(result: MatchResult): AwardResult {
    const before = this.level;
    const top = this.topLevel;
    const { award, profile } = awardXp(this.config, this.current, result, this.today, top);
    this.save(profile);
    return { award, before, after: this.level, top };
  }

  boost(): BoostStatus {
    return boostStatus(this.config, this.current, this.level.atTop);
  }

  /** The ad was watched to the end: add its waves. False if no ad was due. */
  startBoost(): boolean {
    if (!this.boost().offer) return false;
    this.save(startBoost(this.config, this.current));
    return true;
  }

  // ---------------------------------------------------------------- keys

  get keys(): Keys {
    const { level, atTop } = this.level;
    const earned = (level - 1) * this.config.keys.perLevel;
    const spent = this.current.keysSpent;
    return {
      earned,
      spent,
      left: Math.max(0, earned - spent),
      nextAt: atTop ? null : level + 1,
    };
  }

  /** Spend `cost` keys on `unlockId`. False, and nothing spent, if they are not there. */
  private spend(unlockId: string, cost: number): boolean {
    if (this.current.unlocked.includes(unlockId) || this.keys.left < cost) return false;
    this.save({
      ...this.current,
      unlocked: [...this.current.unlocked, unlockId],
      keysSpent: this.current.keysSpent + cost,
    });
    return true;
  }

  /** What a builder costs to unlock: nothing for the starter everyone has. */
  builderCost(builderId: string): number {
    return builderCost(this.config, builderId);
  }

  ownsBuilder(builderId: string): boolean {
    return (
      this.builderCost(builderId) === 0 ||
      this.current.unlocked.includes(builderUnlockId(builderId))
    );
  }

  /** Spend keys on a builder. False if it is owned already or the keys are not there. */
  unlockBuilder(builderId: string): boolean {
    if (this.ownsBuilder(builderId)) return false;
    return this.spend(builderUnlockId(builderId), this.builderCost(builderId));
  }

  /**
   * Spend keys on a cosmetic, and switch it on: it was chosen to be worn.
   * False if it is unlocked already, not for keys, in a slot not drawn yet, or
   * the keys are not there.
   */
  unlockCosmetic(id: string): boolean {
    const cosmetic = cosmeticById(this.cosmetics, id);
    if (!cosmetic || this.isUnlocked(cosmetic) || !forSale(this.cosmetics, cosmetic)) return false;
    if (!this.spend(cosmetic.id, cosmetic.unlock.keys ?? 0)) return false;
    this.setCosmetic(cosmetic.id, true);
    return true;
  }

  // ------------------------------------------------------------ cosmetics

  isUnlocked(cosmetic: Cosmetic): boolean {
    return isUnlocked(cosmetic, this.holder);
  }

  isOn(cosmetic: Cosmetic): boolean {
    return this.current.cosmetics.includes(cosmetic.id) && this.isUnlocked(cosmetic);
  }

  /** Switch an unlocked cosmetic on or off. A locked one stays as it is. */
  setCosmetic(id: string, on: boolean): void {
    const cosmetic = cosmeticById(this.cosmetics, id);
    if (!cosmetic || !this.isUnlocked(cosmetic)) return;
    this.save({
      ...this.current,
      cosmetics: setEnabled(this.cosmetics, this.current.cosmetics, cosmetic, on),
    });
  }

  /** What is being worn in a slot right now. */
  worn(slotId: string): Cosmetic[] {
    return wornIn(this.cosmetics, this.current.cosmetics, slotId, this.holder);
  }

  /**
   * What the others in a match see this player in (`Looks`): what is worn in
   * each of those slots, if the game draws the slot. Sent with the name and
   * the level when a match is joined.
   */
  get looks(): Looks {
    const one = (slotId: keyof Looks): string | null => {
      const slot = this.cosmetics.slots.find((s) => s.id === slotId);
      return slot?.live ? (this.worn(slotId)[0]?.id ?? null) : null;
    };
    return {
      fortress: one('fortress'),
      trail: one('trail'),
      floor: one('floor'),
      victory: one('victory'),
    };
  }

  // ------------------------------------------------- Supporter and Founder

  /**
   * Record Supporter bought. PLACEHOLDER: nothing can be bought yet, and only
   * the `?progress=test` build calls this - so the perks can be tried before
   * a payment provider exists.
   */
  grantSupporter(): void {
    this.save({ ...this.current, supporter: true });
  }

  /**
   * Record a Founder's claim. PLACEHOLDER: counting the first claims needs a
   * server, and only the `?progress=test` build calls this.
   */
  grantFounder(): void {
    this.save({ ...this.current, founder: true });
  }

  /** Undo Supporter and Founder (`?progress=test`). */
  clearPurchases(): void {
    this.save({ ...this.current, supporter: false, founder: false });
  }

  /** Climb straight to the next level, keys and all (`?progress=test`). Not past the top. */
  testLevelUp(): void {
    const { level, atTop } = this.level;
    if (atTop) return;
    this.save({ ...this.current, xp: xpToReach(level + 1, this.config.levels) });
  }

  private save(next: Profile): void {
    this.current = next;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked: the progress lasts this visit.
    }
  }
}

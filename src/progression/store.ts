/**
 * The player's progress, kept between visits: XP and the level it makes,
 * boosts, the day's practice allowance, Supporter, what they own and what they
 * have switched on.
 *
 * On the device for now (profile.ts says why that is acceptable, and what
 * changes when there is a server). Everything that decides an amount lives in
 * award.ts and cosmetics.ts as pure functions of the profile; this class only
 * holds the current one, hands it to them, and saves what comes back.
 */

import type { KeyValueStore } from '../net/identity.ts';
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
  STORE,
  type Cosmetic,
  type CosmeticsConfig,
  type ProgressionConfig,
  type StoreConfig,
} from './config.ts';
import { cosmeticById, isUnlocked, setEnabled, wornIn, type Holder } from './cosmetics.ts';
import { levelOf, type LevelProgress } from './levels.ts';
import { dayKey, parseProfile, type Profile } from './profile.ts';

const STORAGE_KEY = 'lane-siege.profile';

/** A match's XP, and where it left the player. */
export interface AwardResult {
  award: XpAward;
  before: LevelProgress;
  after: LevelProgress;
}

export class ProgressStore {
  private current: Profile;

  constructor(
    private readonly storage: KeyValueStore | null,
    /** The device's clock: daily allowances reset on its calendar day. */
    private readonly now: () => Date = () => new Date(),
    readonly config: ProgressionConfig = PROGRESSION,
    readonly cosmetics: CosmeticsConfig = COSMETICS,
    readonly store: StoreConfig = STORE,
  ) {
    let saved: unknown;
    try {
      const text = storage?.getItem(STORAGE_KEY);
      saved = text ? JSON.parse(text) : null;
    } catch {
      // Corrupt or blocked: a new player, rather than no game.
    }
    this.current = parseProfile(saved);
  }

  get profile(): Readonly<Profile> {
    return this.current;
  }

  get level(): LevelProgress {
    return levelOf(this.current.xp, this.config.levels);
  }

  private get today(): string {
    return dayKey(this.now());
  }

  /** What unlocking reads: the level, Supporter, and what has been bought. */
  get holder(): Holder {
    return {
      level: this.level.level,
      supporter: this.current.supporter,
      owned: this.current.owned,
    };
  }

  // ---------------------------------------------------------------- XP

  /** Count a finished match, save it, and say what it earned. */
  award(result: MatchResult): AwardResult {
    const before = this.level;
    const { award, profile } = awardXp(this.config, this.current, result, this.today);
    this.save(profile);
    return { award, before, after: this.level };
  }

  boost(): BoostStatus {
    return boostStatus(this.config, this.current, this.today);
  }

  /** The ad was watched, or a Supporter claimed a boost. False if none was due. */
  startBoost(): boolean {
    if (!this.boost().available) return false;
    this.save(startBoost(this.config, this.current, this.today));
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

  // ------------------------------------------------------------ the store

  /**
   * Record a purchase. PLACEHOLDER: nothing can be bought yet, and only the
   * `?progress=test` build calls this - so the store, the bundles and the
   * cosmetics they carry can be tried before a payment provider exists.
   */
  grant(itemId: string): void {
    const owned = new Set(this.current.owned);
    let supporter = this.current.supporter;
    if (itemId === 'supporter') supporter = true;
    owned.add(itemId);
    const bundle = this.store.bundles.find((b) => b.id === itemId);
    for (const id of bundle?.cosmetics ?? []) owned.add(id);
    this.save({ ...this.current, owned: [...owned], supporter });
  }

  /** Undo every placeholder purchase (`?progress=test`). */
  clearPurchases(): void {
    this.save({ ...this.current, owned: [], supporter: false });
  }

  /** The store has been opened: its button can stop saying NEW. */
  markStoreSeen(): void {
    if (!this.current.seenStore) this.save({ ...this.current, seenStore: true });
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

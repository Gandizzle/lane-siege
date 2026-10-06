/**
 * A scripted player. DESIGN.md §17.
 *
 * It drives the practice match's three opponents, the empty seats of an online
 * room, and the headless tools. How it plays is its STYLE (style.ts): a roll of
 * one of seven archetypes, so a table is three different opponents rather than
 * one opponent three times.
 *
 * Every style plays the same game underneath, the one docs/BALANCE.md found
 * reaches the late waves:
 *
 *   - THE ARMY is measured against the coming wave's nominal army gold
 *     (waves.json `armyGold`, what the wave was tuned to be beaten by): bought
 *     to the style's floor first, then the economy, then topped up to the
 *     nominal plus the style's margin. What it buys is whatever adds the most
 *     strength per gold against THAT wave - a new body, an upgrade in place, or
 *     a level of tech - with strength read through the damage matrix in both
 *     directions: how hard the body hits the wave's armor, and how well its
 *     own armor takes the wave's damage. That is the information the
 *     build-phase preview hands a human (§9.3), and nothing more.
 *   - THE ECONOMY is the gem building's two ladders, bought to a pace the style
 *     sets once the army is at its floor.
 *   - THE GEMS are split as they arrive: a share into income sends, the rest
 *     into attack sends (one at a time, or saved into a volley), the fortress's
 *     walls, or its aura.
 *
 * It does all of this as commands, the way a tap does, so it can never do
 * anything a player could not. It reads `MatchState` because it runs where the
 * authority is, but only what §12 makes public about the other lanes: fortress
 * health, who is alive, and who sent what at it.
 *
 * Cheap on purpose: the whole build phase is planned once, on its first tick,
 * and every other tick only spends gems. Three of these run inside a browser
 * tab at 20 Hz.
 *
 * Planned at once, but not BOUGHT at once: each tech track, fortress ladder and
 * the supply cap waits a few seconds between levels (economy.json
 * `upgradeCooldowns`), so a plan that wants two levels of one ladder holds the
 * second back until the ladder is ready (`pace`), and anything that needs a
 * cap raise still waiting waits with it. A human taps through a build phase
 * the same way.
 */

import type { ArmorType, AuraType, DamageType, GameData, UnitDef } from '../data/schema.ts';
import { isMelee } from '../data/roster.ts';
import {
  Rng,
  damageMultiplier,
  generateWave,
  ladderOf,
  resolveMonsterStats,
  sendOpen,
  sendPrice,
  type Command,
  type DefensiveUnit,
  type Lane,
  type MatchState,
  type TeamId,
} from '../sim/index.ts';
import { DEFAULT_STYLE, hashString, type BotStyle, type Formation } from './style.ts';

/** How much reach is worth, per tile, in a body's strength (the price ladder's own figure). */
const RANGE_VALUE_PER_TILE = 0.08;

/** Purchases in one build phase, at most. A guard, not a rule. */
const MAX_BUYS = 80;

/** The body count a line wants: this many, plus this many a wave (`bodiesWanted`). */
const BODIES_AT_START = 4;
const BODIES_PER_WAVE = 0.7;
/** Waves in which every style holds the whole nominal before buying economy. */
const OPENING_WAVES = 4;

/** How much more a new body counts for while the line is thinner than that. */
const THIN_LINE_BONUS = 2.5;

/** A volley's bank is spread over at least this many sends. */
const VOLLEY_PARTS = 3;

/** A specialist's favourite lines are ones it can field from the first waves. */
const SPECIALIST_PRICE = 180;

/** Seconds a wave is taken to last, for turning a gem rate into gems per wave (budget.ts). */
const SECONDS_PER_WAVE = 60;

/**
 * The rows each role stands in, best first, for each formation. Row 0 is where
 * a wave arrives and row 9 is against the fortress (buildZone depth 10), so a
 * forward line meets the wave early and a wall line fights inside the aura.
 */
const ROWS: Record<Formation, { front: number[]; back: number[] }> = {
  forward: { front: [2, 3, 1, 4, 0], back: [4, 5, 6, 3, 7] },
  deep: { front: [4, 5, 3, 6], back: [6, 7, 5, 8] },
  wall: { front: [7, 6, 8, 5], back: [9, 8, 7, 6] },
};

/** A wave every damage type and armor is neutral against, for `fit`. */
const NEUTRAL = {
  wave: 0,
  armorHp: new Map(),
  totalHp: 0,
  damage: new Map(),
  totalDamage: 0,
} as const;

/** What the coming wave is made of, as a build decision needs it. */
interface WaveRead {
  wave: number;
  /** Health of the wave by armor: what damage has to get through. */
  armorHp: Map<ArmorType, number>;
  totalHp: number;
  /** Damage per second of the wave by type: what armor has to take. */
  damage: Map<DamageType, number>;
  totalDamage: number;
}

/** What the planner has left to spend, as it spends it. */
interface Wallet {
  gold: number;
  gems: number;
  /** Supply free under the cap. */
  supply: number;
  /** The supply cap's level, as it will be once this tick's purchases land. */
  capLevel: number;
  /** Cap and tech gold bought this tick, which the lane does not show until next tick. */
  extrasSpent: number;
}

/** A body on the board, or about to be: the definition it will stand as. */
interface Body {
  unit: DefensiveUnit | null;
  def: UnitDef;
}

/** One thing the army could buy, and what it would add. */
interface Option {
  gain: number;
  gold: number;
  /** How well what it buys suits this wave: its effective gold per gold (`fit`). */
  fit: number;
  /**
   * Whether the lane will show it only once this tick's commands land. Bodies
   * and upgrades are tracked in the phase's own body list; tech is not, and is
   * carried in the wallet until the lane catches up.
   */
  offBoard: boolean;
  /** Supply the cap has to grow by first, in whole cap levels. */
  capLevels: number;
  apply: () => Command[];
}

export interface AutoBuilderOptions {
  /** How it plays. The default is a middle-of-the-road Tactician. */
  style?: BotStyle;
  /** Seeds its own choices: which favourite line, which random target. */
  seed?: number;
  /**
   * False for a bot that never sends: the tutorial's, where a monster nobody
   * sent on purpose is one the coach would have to explain. Its gems go to the
   * fortress if its style spends them there, and are banked otherwise.
   */
  sends?: boolean;
}

/** What the last build phase planned, for reading a run back (headless tools, tests). */
export interface PlanReport {
  wave: number;
  nominal: number;
  floor: number;
  need: number;
  /** The army's effective worth once the phase's purchases land. */
  worth: number;
  /** Gold left unspent. */
  banked: number;
}

export class AutoBuilder {
  readonly style: BotStyle;
  private readonly sends: boolean;
  /** The last build phase's plan. */
  report: PlanReport | null = null;
  private readonly rng: Rng;
  private readonly defs: Map<string, UnitDef>;
  /** This builder's six lines, as their Mark I units. */
  private readonly roster: UnitDef[];
  /** Gold to have a body standing at each definition: its whole chain. */
  private readonly chainGold = new Map<string, number>();
  /** For a loyal composition: the lines it sticks to. */
  private readonly favourites: Set<string>;
  /** The build phase already planned, so each is planned once. */
  private plannedFor = -1;
  /** Gems earmarked for income sends, and for everything else. */
  private incomeGems = 0;
  private otherGems = 0;
  /** Gems the lane had after the last plan's spending, to tell what was earned since. */
  private lastGems = 0;
  /** A volley in progress, at whom, and the most any one send in it may cost. */
  private volleyAt: TeamId | null = null;
  private volleyCap = Infinity;
  /** Who has sent how much at this lane, for a style that answers in kind. */
  private readonly grudges = new Map<TeamId, number>();
  private grudgesRead = 0;
  /**
   * Purchases planned but not yet made, in the order planned: a level of a
   * ladder that is still cooling, and the bodies that wait on a cap raise
   * still to come (`pace`).
   */
  private held: Command[] = [];

  constructor(
    private readonly data: GameData,
    private readonly teamId: TeamId,
    builderId: string,
    options: AutoBuilderOptions = {},
  ) {
    this.style = options.style ?? DEFAULT_STYLE;
    this.sends = options.sends !== false;
    this.rng = new Rng((options.seed ?? 1) ^ hashString(teamId));
    this.defs = new Map(data.units.units.map((u) => [u.id, u]));
    this.roster = data.units.units.filter((u) => u.builderId === builderId && u.mark === 1);

    for (const first of this.roster) {
      let gold = 0;
      for (let def: UnitDef | undefined = first; def;) {
        gold += def.goldCost ?? 0;
        this.chainGold.set(def.id, gold);
        def = def.upgradesTo ? this.defs.get(def.upgradesTo) : undefined;
      }
    }

    // A specialist's lines: one to hold the front and one to shoot over it,
    // chosen once and kept. Chosen among lines it can afford from the start -
    // a specialist in the top rung fielded nothing for four waves and died.
    const pick = (role: UnitDef[]): UnitDef | undefined => {
      const cheap = role.filter((u) => (u.goldCost ?? 0) <= SPECIALIST_PRICE);
      const pool = cheap.length > 0 ? cheap : role.slice(0, 1);
      return pool[this.rng.int(pool.length)];
    };
    const byPrice = [...this.roster].sort((a, b) => (a.goldCost ?? 0) - (b.goldCost ?? 0));
    // And a signature piece from the top of the roster, fielded once it can
    // be paid for: the one a specialist is building towards.
    const dear = byPrice.filter((u) => (u.goldCost ?? 0) > SPECIALIST_PRICE);
    this.favourites = new Set(
      [
        pick(byPrice.filter(isMelee)),
        pick(byPrice.filter((u) => !isMelee(u))),
        dear[this.rng.int(dear.length)],
      ]
        .filter((u): u is UnitDef => u !== undefined)
        .map((u) => u.id),
    );
  }

  /**
   * Commands for this tick. The build phase is planned on its first tick; gems
   * are spent on every tick the shop is open, because they arrive all match.
   */
  plan(state: MatchState): Command[] {
    if (state.phase === 'showdown' || state.finished) return [];
    const lane = state.lanes[this.teamId];
    const self = state.teams.find((t) => t.id === this.teamId);
    if (!lane || !self || self.eliminated) return [];

    const wallet: Wallet = {
      gold: lane.economy.gold,
      gems: lane.economy.gems,
      supply: lane.economy.supplyCap - lane.economy.supplyUsed,
      capLevel: lane.fortress.upgrades.supply ?? 0,
      extrasSpent: 0,
    };
    this.splitGems(wallet.gems);

    const commands: Command[] = [];
    if (state.phase === 'build' && this.plannedFor !== state.wave) {
      this.plannedFor = state.wave;
      // A new plan is made from what the lane HAS, so whatever the last one
      // never got to is the new one's to decide again, not to do twice.
      this.held = [];
      this.buildPhase(state, lane, wallet, commands);
    }
    this.readGrudges(lane);
    this.spendGems(state, lane, wallet, commands);
    this.lastGems = wallet.gems;
    return this.pace(state, lane, [...this.held, ...commands]);
  }

  /**
   * What can be bought on this tick, in planned order; the rest is held.
   *
   * One level of a ladder a tick, and none of a ladder still cooling. Any
   * purchase planned after a cap raise that is being held may need that cap
   * (a body, an upgrade in place, a gem level that takes supply), so it is
   * held too. Anything planned for the board is dropped once the board has
   * closed - a held body is not worth anything in combat.
   */
  private pace(state: MatchState, lane: Lane, queue: readonly Command[]): Command[] {
    const now: Command[] = [];
    const later: Command[] = [];
    const bought = new Set<string>();
    let capHeld = false;
    for (const command of queue) {
      const board = command.kind === 'placeUnit' || command.kind === 'upgradeUnit';
      if (board && state.phase !== 'build') continue;
      const ladder = ladderOf(command);
      const needsRoom = board || (ladder !== null && command.kind !== 'buySupply');
      const wait =
        (needsRoom && capHeld) ||
        (ladder !== null && ((lane.upgradeCooldowns[ladder] ?? 0) > 0 || bought.has(ladder)));
      if (wait) {
        later.push(command);
        if (command.kind === 'buySupply') capHeld = true;
        continue;
      }
      if (ladder !== null) bought.add(ladder);
      now.push(command);
    }
    this.held = later;
    return now;
  }

  /** Whether a ladder is cooling, or has a level held or planned on this tick. */
  private busy(lane: Lane, ladder: string, out: readonly Command[]): boolean {
    if ((lane.upgradeCooldowns[ladder] ?? 0) > 0) return true;
    const mine = (c: Command) => ladderOf(c) === ladder;
    return this.held.some(mine) || out.some(mine);
  }

  // ------------------------------------------------------------ build phase

  private buildPhase(state: MatchState, lane: Lane, wallet: Wallet, out: Command[]): void {
    const wave = state.wave + 1;
    const read = this.readWave(state, lane, wave);
    const style = this.style;
    const fumble = () => this.rng.next() < style.sloppiness;

    if (style.aimWeapon && !fumble()) {
      const best = this.bestDamageType(read);
      if (best && best !== lane.fortress.weaponDamageType) {
        out.push({ kind: 'setWeaponType', teamId: this.teamId, damageType: best });
      }
    }
    const aura = this.chooseAura(read, lane);
    if (aura && aura !== lane.fortress.activeAura) {
      out.push({ kind: 'setAura', teamId: this.teamId, aura });
    }

    // What the army should be worth when the wave lands: at least the floor
    // before the economy sees a coin, the full margin after. A sloppy player
    // misjudges both, usually short.
    const nominal =
      this.data.waves.composition.find((w) => w.wave === wave)?.armyGold ?? 200 * wave;
    const misjudged = fumble() ? 0.6 + 0.3 * this.rng.next() : 1;
    // The first waves are cheap to hold and fatal to lose, and a gem level
    // bought in them compounds for very little: every style holds the whole
    // nominal there before the economy sees a coin.
    const floor =
      nominal * (wave <= OPENING_WAVES ? Math.max(1, style.floor) : style.floor) * misjudged;
    const need = nominal * (1 + style.margin) * misjudged;
    const boss = this.data.waves.bossEveryNWaves;
    const bossNext = boss > 0 && wave % boss === 0;

    const bodies: Body[] = lane.units.map((u) => ({ unit: u, def: this.defs.get(u.defId)! }));
    const taken = new Set(lane.units.map((u) => `${u.homeTileX},${u.homeTileY}`));
    const tech = { ...lane.economy.tech };
    const army = (target: number, keep = 0) =>
      this.buyArmy(lane, read, wallet, out, { bodies, taken, tech }, target, keep);

    const short = army(floor);
    // Nobody sensible buys a gem upgrade in the build phase of a wave they can
    // see they are about to lose - and a boss is the wave most likely to be it.
    if (short <= 0 && !bossNext) this.buyEconomy(lane, wave, wallet, out);
    army(need);
    // What is left: some of it into more army, the rest banked for a boss or
    // a bad wave.
    const surplus = wallet.gold * style.surplusToArmy;
    if (surplus > 0) army(Infinity, wallet.gold - surplus);
    this.report = {
      wave,
      nominal,
      floor,
      need,
      worth: this.armyWorth(lane, bodies, read) + wallet.extrasSpent,
      banked: wallet.gold,
    };
  }

  /** The coming wave, and what has been sent at this lane to join it. */
  private readWave(state: MatchState, lane: Lane, wave: number): WaveRead {
    const monsters = new Map(
      [...this.data.monsters.monsters, ...this.data.monsters.bosses].map((m) => [m.id, m]),
    );
    const read: WaveRead = {
      wave,
      armorHp: new Map(),
      totalHp: 0,
      damage: new Map(),
      totalDamage: 0,
    };
    const ids = [
      ...generateWave(this.data, state.seed, wave, state.lateWaves).map((s) => s.defId),
      ...lane.incomingSends.map((s) => s.defId),
    ];
    for (const id of ids) {
      const def = monsters.get(id);
      if (!def) continue;
      const stats = resolveMonsterStats(this.data, def, wave);
      read.armorHp.set(def.armor, (read.armorHp.get(def.armor) ?? 0) + stats.hp);
      read.totalHp += stats.hp;
      const dps = stats.damage * stats.attackSpeed;
      read.damage.set(def.damageType, (read.damage.get(def.damageType) ?? 0) + dps);
      read.totalDamage += dps;
    }
    return read;
  }

  /** The damage type that does most to this wave's health. */
  private bestDamageType(read: WaveRead): DamageType | null {
    let best: DamageType | null = null;
    let bestScore = -Infinity;
    for (const type of this.data.matrix.damageTypes) {
      const score = this.hitting(type, read);
      if (score > bestScore) {
        bestScore = score;
        best = type;
      }
    }
    return best;
  }

  /** How hard damage of `type` lands on this wave, averaged over its health. */
  private hitting(type: DamageType, read: WaveRead): number {
    if (read.totalHp <= 0) return 1;
    let sum = 0;
    for (const [armor, hp] of read.armorHp) {
      sum += hp * damageMultiplier(this.data.matrix.multipliers, type, armor);
    }
    return sum / read.totalHp;
  }

  /** How hard this wave's damage lands on `armor`, averaged over its damage. */
  private taking(armor: ArmorType, read: WaveRead): number {
    if (read.totalDamage <= 0) return 1;
    let sum = 0;
    for (const [type, dps] of read.damage) {
      sum += dps * damageMultiplier(this.data.matrix.multipliers, type, armor);
    }
    return sum / read.totalDamage;
  }

  /**
   * A body's strength against this wave: `sqrt(offence x defence)`, the price
   * ladder's own measure (balance/pricing.ts), with the matrix applied both
   * ways.
   */
  private strength(def: UnitDef, read: WaveRead): number {
    const offence =
      (def.damage ?? 0) *
      (def.attackSpeed ?? 0) *
      (1 + (def.range ?? 0) * RANGE_VALUE_PER_TILE) *
      this.hitting(def.damageType, read);
    const defence = (def.hp ?? 0) / Math.max(0.3, this.taking(def.armor, read));
    return Math.sqrt(Math.max(0, offence * defence));
  }

  private chooseAura(read: WaveRead, lane: Lane): AuraType | null {
    const aura = this.style.aura;
    if (aura === null) return null;
    if (aura !== 'adaptive') return aura;
    // Armor when the wave's damage lands hard on what this army wears,
    // damage otherwise.
    const army = lane.units.map((u) => this.defs.get(u.defId)).filter((d) => d !== undefined);
    if (army.length === 0) return 'damage';
    const taken = army.reduce((sum, d) => sum + this.taking(d.armor, read), 0) / army.length;
    return taken > 1.05 ? 'armor' : 'damage';
  }

  // -------------------------------------------------------------------- army

  /**
   * How well a body suits this wave: its strength against it over its
   * strength against a wave its damage and armor are neutral to. Below 1 it
   * is the wrong tool - impact into a swarm - and its gold is worth that much
   * less.
   */
  private fit(def: UnitDef, read: WaveRead): number {
    const neutral = this.strength(def, NEUTRAL);
    return neutral > 0 ? this.strength(def, read) / neutral : 1;
  }

  /**
   * What the army is worth against this wave, in gold: each body at its whole
   * chain scaled by how well it suits the wave, plus the cap and the tech.
   *
   * Gold alone was the first measure, and it lost Ironvow at wave 7: an army
   * of impact bodies worth the wave's nominal walked into forty Mites, which
   * impact barely scratches, and the planner - satisfied - had put the rest
   * of the gold into the economy.
   */
  private armyWorth(lane: Lane, bodies: readonly Body[], read: WaveRead): number {
    let gold = 0;
    for (const body of bodies)
      gold += (this.chainGold.get(body.def.id) ?? 0) * this.fit(body.def, read);
    const capLevel = lane.fortress.upgrades.supply ?? 0;
    for (const level of this.data.economy.supply.capUpgrades) {
      if (level.level <= capLevel) gold += level.goldCost ?? 0;
    }
    for (const track of this.data.economy.tech.tracks) {
      const have = lane.economy.tech[track.id] ?? 0;
      for (const level of track.levels) if (level.level <= have) gold += level.goldCost ?? 0;
    }
    return gold;
  }

  /**
   * Buy the best strength per gold, one thing at a time, until the army is
   * worth `need` or the gold runs down to `keep`. Returns how far short of
   * `need` it stopped (zero or less when it got there).
   */
  private buyArmy(
    lane: Lane,
    read: WaveRead,
    wallet: Wallet,
    out: Command[],
    army: { bodies: Body[]; taken: Set<string>; tech: Record<string, number> },
    need: number,
    keep = 0,
  ): number {
    // Bodies bought this phase are already in `bodies`; what the cap and tech
    // cost this phase is not yet on the lane, and is added as bought.
    let have = this.armyWorth(lane, army.bodies, read) + wallet.extrasSpent;
    const caps = this.data.economy.supply.capUpgrades;

    for (let buys = 0; buys < MAX_BUYS && have < need; buys++) {
      const options = [
        ...this.bodyOptions(army.bodies, army.taken, read, wallet),
        ...this.upgradeOptions(army.bodies, read, wallet),
        ...this.techOptions(army.bodies, army.tech, read),
      ];
      let best: Option | null = null;
      let bestGold = 0;
      let bestScore = 0;
      for (const option of options) {
        const gold = option.gold + this.capGold(wallet.capLevel, option.capLevels);
        if (!Number.isFinite(gold) || gold > wallet.gold - keep) continue;
        // A random composition is a player buying what catches its eye.
        const score =
          this.style.composition === 'random' ? this.rng.next() : option.gain / Math.max(1, gold);
        if (score > bestScore) {
          bestScore = score;
          best = option;
          bestGold = gold;
        }
      }
      if (!best) break;

      // Raise the cap first if the purchase needs it.
      for (let i = 0; i < best.capLevels; i++) {
        const next = caps.find((l) => l.level === wallet.capLevel + 1);
        if (!next) break;
        out.push({ kind: 'buySupply', teamId: this.teamId });
        wallet.supply += (next.value ?? 0) - this.capAt(wallet.capLevel);
        wallet.capLevel += 1;
      }
      const capGold = bestGold - best.gold;
      out.push(...best.apply());
      wallet.gold -= bestGold;
      wallet.extrasSpent += capGold + (best.offBoard ? best.gold : 0);
      have += capGold + best.gold * best.fit;
    }
    return need - have;
  }

  /** The supply cap at a level of its ladder (level 0 is the base). */
  private capAt(level: number): number {
    if (level <= 0) return this.data.economy.supply.capBase ?? 0;
    return this.data.economy.supply.capUpgrades.find((l) => l.level === level)?.value ?? 0;
  }

  /** Gold to raise the cap `levels` more times from `from`; Infinity past the top. */
  private capGold(from: number, levels: number): number {
    let gold = 0;
    for (let i = 1; i <= levels; i++) {
      const next = this.data.economy.supply.capUpgrades.find((l) => l.level === from + i);
      if (!next) return Infinity;
      gold += next.goldCost ?? 0;
    }
    return gold;
  }

  /** Cap levels needed before `supply` more fits in what is free. */
  private capLevelsFor(supply: number, wallet: Wallet): number {
    let free = wallet.supply;
    let level = wallet.capLevel;
    let levels = 0;
    while (free < supply) {
      const next = this.capAt(level + 1);
      if (next <= 0) return Infinity;
      free += next - this.capAt(level);
      level += 1;
      levels += 1;
    }
    return levels;
  }

  private bodyOptions(
    bodies: Body[],
    taken: Set<string>,
    read: WaveRead,
    wallet: Wallet,
  ): Option[] {
    // The line is kept to the style's share of front-liners. A preference was
    // tried in place of the quota - both roles competing, the short one
    // favoured - and armies came out without a front, and fell at waves 5 to 8.
    const front = bodies.filter((b) => isMelee(b.def)).length;
    const wantFront = bodies.length === 0 || front / bodies.length < this.style.frontShare;
    const candidates = this.roster.filter((def) => {
      if (this.style.composition === 'loyal' && !this.favourites.has(def.id)) return false;
      return true;
    });
    const melee = candidates.filter(isMelee);
    const ranged = candidates.filter((d) => !isMelee(d));
    const role = (wantFront && melee.length > 0) || ranged.length === 0 ? 'front' : 'back';
    const pool = role === 'front' ? melee : ranged;
    const tile = this.freeTile(role, taken);
    if (!tile) return [];
    // Width before height while the line is thinner than the wave needs: a
    // few Mark III bodies are strong per gold and still let a wave of forty
    // walk round them (Thornweald died at wave 9 on four).
    const thin = bodies.length < this.bodiesWanted(read.wave) ? THIN_LINE_BONUS : 1;

    return pool.map((def) => ({
      gain: this.strength(def, read) * thin,
      gold: def.goldCost ?? 0,
      fit: this.fit(def, read),
      offBoard: false,
      capLevels: this.capLevelsFor(def.supplyCost ?? 0, wallet),
      apply: () => {
        taken.add(`${tile.tileX},${tile.tileY}`);
        bodies.push({ unit: null, def });
        wallet.supply -= def.supplyCost ?? 0;
        return [
          {
            kind: 'placeUnit',
            teamId: this.teamId,
            unitDefId: def.id,
            tileX: tile.tileX,
            tileY: tile.tileY,
          },
        ];
      },
    }));
  }

  private upgradeOptions(bodies: Body[], read: WaveRead, wallet: Wallet): Option[] {
    const options: Option[] = [];
    // One option per kind of upgrade: every Pledge is the same Pledge.
    const seen = new Set<string>();
    for (const body of bodies) {
      if (!body.unit || seen.has(body.def.id)) continue;
      const next = body.def.upgradesTo ? this.defs.get(body.def.upgradesTo) : undefined;
      if (!next) continue;
      seen.add(body.def.id);
      const unit = body.unit;
      options.push({
        gain: (this.strength(next, read) - this.strength(body.def, read)) * this.style.tall,
        gold: next.goldCost ?? 0,
        fit: this.fit(next, read),
        offBoard: false,
        capLevels: this.capLevelsFor(next.supplyCost ?? 0, wallet),
        apply: () => {
          body.def = next;
          wallet.supply -= next.supplyCost ?? 0;
          return [{ kind: 'upgradeUnit', teamId: this.teamId, unitId: unit.id }];
        },
      });
    }
    return options;
  }

  private techOptions(bodies: Body[], tech: Record<string, number>, read: WaveRead): Option[] {
    if (this.style.tech === 'none' || bodies.length === 0) return [];
    let total = 0;
    const byType = new Map<DamageType, number>();
    const byArmor = new Map<ArmorType, number>();
    for (const body of bodies) {
      const s = this.strength(body.def, read);
      total += s;
      byType.set(body.def.damageType, (byType.get(body.def.damageType) ?? 0) + s);
      byArmor.set(body.def.armor, (byArmor.get(body.def.armor) ?? 0) + s);
    }
    const options: Option[] = [];
    for (const track of this.data.economy.tech.tracks) {
      const level = tech[track.id] ?? 0;
      const next = track.levels.find((l) => l.level === level + 1);
      if (!next) continue;
      const now = track.levels.find((l) => l.level === level)?.value ?? 0;
      const step = (next.value ?? 0) - now;
      // Strength is the square root of offence times defence, so a tenth more
      // of either is about a twentieth more strength on what it lifts. A
      // damage track lifts the bodies dealing its type; an armor track the
      // bodies wearing its armor (§7.4, redesigned).
      const lifted = track.damageType
        ? (byType.get(track.damageType) ?? 0)
        : track.armorType
          ? (byArmor.get(track.armorType) ?? 0)
          : total;
      if (this.style.tech === 'focused' && lifted < total * 0.25) continue;
      options.push({
        gain: (lifted * step) / 2,
        gold: next.goldCost ?? 0,
        // Tech is counted at its price, like the cap (see `armyWorth`).
        fit: 1,
        offBoard: true,
        capLevels: 0,
        apply: () => {
          tech[track.id] = level + 1;
          return [{ kind: 'buyTech', teamId: this.teamId, trackId: track.id }];
        },
      });
    }
    return options;
  }

  /**
   * How many bodies a line wants for this wave: more as the waves grow, fewer
   * for a player who goes tall, more for one who goes wide.
   */
  private bodiesWanted(wave: number): number {
    return Math.round((BODIES_AT_START + BODIES_PER_WAVE * wave) / this.style.tall);
  }

  /** The next free tile for a role, in this style's formation. */
  private freeTile(
    role: 'front' | 'back',
    taken: Set<string>,
  ): { tileX: number; tileY: number } | null {
    const { width, depth } = this.data.lane.buildZone;
    const rows = ROWS[this.style.formation][role];
    const mid = Math.floor(width / 2);
    for (const tileY of rows) {
      if (tileY < 0 || tileY >= depth) continue;
      for (let offset = 0; offset < width; offset++) {
        const tileX = offset % 2 === 0 ? mid + (offset >> 1) : mid - 1 - (offset >> 1);
        if (tileX < 0 || tileX >= width) continue;
        if (!taken.has(`${tileX},${tileY}`)) return { tileX, tileY };
      }
    }
    return null;
  }

  // ----------------------------------------------------------------- economy

  /** The gem building's ladders, up to the style's pace for this wave. */
  private buyEconomy(lane: Lane, wave: number, wallet: Wallet, out: Command[]): void {
    const f = this.data.fortress.resourceBuilding;
    const outputTarget = Math.min(
      f.output.upgrades.length,
      Math.floor(this.style.economy * (wave - 1)),
    );
    const rateTarget = Number.isFinite(this.style.rateEvery)
      ? Math.min(f.rate.upgrades.length, Math.floor((wave - 1) / this.style.rateEvery))
      : 0;
    let output = lane.fortress.upgrades.gemOutput ?? 0;
    let rate = lane.fortress.upgrades.gemRate ?? 0;

    for (let guard = 0; guard < 30; guard++) {
      // Rate when it has fallen behind, output otherwise.
      const wantRate = rate < rateTarget;
      const wantOutput = output < outputTarget;
      if (!wantRate && !wantOutput) return;
      const id = wantRate && (!wantOutput || rate * 5 < output) ? 'gemRate' : 'gemOutput';
      const ladder = id === 'gemRate' ? f.rate.upgrades : f.output.upgrades;
      const level = id === 'gemRate' ? rate : output;
      const next = ladder.find((l) => l.level === level + 1);
      if (!next) return;
      const supply = next.supplyCost ?? 0;
      const capLevels = this.capLevelsFor(supply, wallet);
      const gold = (next.goldCost ?? 0) + this.capGold(wallet.capLevel, capLevels);
      if (!Number.isFinite(gold) || gold > wallet.gold) return;
      for (let i = 0; i < capLevels; i++) {
        out.push({ kind: 'buySupply', teamId: this.teamId });
        wallet.supply += this.capAt(wallet.capLevel + 1) - this.capAt(wallet.capLevel);
        wallet.capLevel += 1;
      }
      out.push({ kind: 'buyFortressUpgrade', teamId: this.teamId, upgradeId: id });
      wallet.gold -= gold;
      wallet.supply -= supply;
      if (id === 'gemRate') rate += 1;
      else output += 1;
    }
  }

  // -------------------------------------------------------------------- gems

  /** Share what has come in since the last tick between income and everything else. */
  private splitGems(gems: number): void {
    const earned = gems - this.lastGems;
    if (earned > 0) {
      this.incomeGems += earned * this.style.incomeShare;
      this.otherGems += earned * (1 - this.style.incomeShare);
    }
    // Whatever the lane really holds is the ceiling on both.
    const held = this.incomeGems + this.otherGems;
    if (held > gems && held > 0) {
      this.incomeGems *= gems / held;
      this.otherGems *= gems / held;
    }
    this.lastGems = gems;
  }

  private spendGems(state: MatchState, lane: Lane, wallet: Wallet, out: Command[]): void {
    const cooling = lane.sendCooldowns;
    const wave = state.wave + 1;
    const price = (id: string) => sendPrice(this.data, id).gems;
    const ready = (id: string) => (cooling[id] ?? 0) <= 0;
    const sent = new Set<string>();
    const fire = (id: string, target: TeamId, account: 'income' | 'other'): void => {
      const cost = price(id);
      out.push({ kind: 'send', teamId: this.teamId, targetTeamId: target, sendId: id });
      wallet.gems -= cost;
      if (account === 'income') this.incomeGems -= cost;
      else this.otherGems -= cost;
      sent.add(id);
    };

    const sends = this.data.sends.sends.filter((s) => sendOpen(s, wave));
    const rate = (id: string) =>
      (this.data.sends.sends.find((s) => s.id === id)?.incomeGranted ?? 0) / Math.max(1, price(id));

    // Income: the best rate first, the moment there is enough and it is ready.
    const economy = sends.filter((s) => s.economic).sort((a, b) => rate(b.id) - rate(a.id));
    const incomeTarget = this.sends ? this.chooseTarget(state, 'income') : null;
    if (incomeTarget) {
      for (const send of economy) {
        if (this.incomeGems >= price(send.id) && ready(send.id) && !sent.has(send.id)) {
          fire(send.id, incomeTarget, 'income');
        }
      }
      // What the economy sends' cooldowns cannot take goes on the next best
      // rate, above a reserve (as the balance harness's player does).
      const reserve = 3 * economy.reduce((sum, s) => sum + price(s.id), 0);
      const others = sends.filter((s) => !s.economic).sort((a, b) => rate(b.id) - rate(a.id));
      for (const send of others) {
        if (this.incomeGems - price(send.id) < reserve) continue;
        if (!ready(send.id) || sent.has(send.id)) continue;
        fire(send.id, incomeTarget, 'income');
      }
    }

    switch (this.style.gemUse) {
      case 'attack':
        if (this.sends) this.attack(state, lane, sends, ready, sent, price, fire);
        return;
      case 'walls':
        this.fortify(lane, wallet, out, ['regen', 'hp', 'weapon']);
        return;
      case 'aura':
        this.fortify(lane, wallet, out, ['auraRadius', 'auraStrength', 'regen', 'hp', 'weapon']);
        return;
    }
  }

  /** Attack sends: one at a time as the gems come, or banked into a volley. */
  private attack(
    state: MatchState,
    lane: Lane,
    sends: readonly { id: string; economic?: boolean }[],
    ready: (id: string) => boolean,
    sent: Set<string>,
    price: (id: string) => number,
    fire: (id: string, target: TeamId, account: 'income' | 'other') => void,
  ): void {
    // Dearest first: a send is bought for its body, and the dear ones are the
    // ones that hurt.
    const attacks = sends.filter((s) => !s.economic).sort((a, b) => price(b.id) - price(a.id));
    const cheapest = attacks.at(-1);
    if (!cheapest) return;

    if (this.style.sendHabit === 'volley' && this.volleyAt === null) {
      const perWave =
        (lane.fortress.gemsPerPayout * SECONDS_PER_WAVE) /
        Math.max(0.5, this.data.fortress.resourceBuilding.payoutSeconds ?? 2);
      const bank = Math.max(
        price(cheapest.id) * 3,
        this.style.volleyWaves * perWave * (1 - this.style.incomeShare),
      );
      if (this.otherGems < bank) return;
      this.volleyAt = this.chooseTarget(state, 'attack');
      if (this.volleyAt === null) return;
      // A volley is a crowd, not one big body: nothing in it costs more than
      // a third of what was saved, so the bank goes on several sends at once.
      this.volleyCap = Math.max(price(cheapest.id), this.otherGems / VOLLEY_PARTS);
    }

    let target = this.volleyAt ?? this.chooseTarget(state, 'attack');
    if (target && state.teams.find((t) => t.id === target)?.eliminated) {
      this.volleyAt = this.chooseTarget(state, 'attack');
      target = this.volleyAt;
    }
    if (!target) return;
    for (const send of attacks) {
      if (this.otherGems < price(send.id) || !ready(send.id) || sent.has(send.id)) continue;
      if (this.volleyAt !== null && price(send.id) > this.volleyCap) continue;
      fire(send.id, target, 'other');
      // A trickle is one send a tick; a volley empties the bank as fast as
      // the cooldowns allow.
      if (this.style.sendHabit === 'trickle') return;
    }
    if (this.volleyAt !== null && this.otherGems < price(cheapest.id)) this.volleyAt = null;
  }

  /** Gems into the fortress, cheapest next level of the given ladders first. */
  private fortify(lane: Lane, wallet: Wallet, out: Command[], ids: readonly string[]): void {
    for (let guard = 0; guard < 4; guard++) {
      let best: { id: string; gems: number } | null = null;
      for (const id of ids) {
        // One level a ladder at a time: the next waits out its cooldown, and
        // the gems wait with it rather than being counted as spent.
        if (this.busy(lane, id, out)) continue;
        const ladder = fortressLadder(this.data, id);
        const level = lane.fortress.upgrades[id] ?? 0;
        const next = ladder.find((l) => l.level === level + 1);
        if (!next || (next.goldCost ?? 0) > 0) continue;
        const gems = next.gemCost ?? 0;
        if (!best || gems < best.gems) best = { id, gems };
      }
      if (!best || best.gems > this.otherGems) return;
      out.push({ kind: 'buyFortressUpgrade', teamId: this.teamId, upgradeId: best.id });
      this.otherGems -= best.gems;
      wallet.gems -= best.gems;
    }
  }

  /** Who to send at, by the style's rule, out of the lanes still standing. */
  private chooseTarget(state: MatchState, purpose: 'income' | 'attack'): TeamId | null {
    const rivals = state.teams.filter((t) => !t.eliminated && t.id !== this.teamId);
    if (rivals.length === 0) return null;
    const health = (id: TeamId) => {
      const f = state.lanes[id]?.fortress;
      return f ? f.hp / Math.max(1, f.maxHp) : 0;
    };
    // Ties are common - every fortress is whole for the first few waves - and
    // go to any of the tied at random. Taking the first would aim every bot at
    // the first lane, which in a practice match is always the human's.
    const pickOf = (score: (id: TeamId) => number): TeamId => {
      const best = Math.max(...rivals.map((r) => score(r.id)));
      const tied = rivals.filter((r) => score(r.id) >= best - 0.01);
      return tied[this.rng.int(tied.length)]!.id;
    };
    const leader = () => pickOf(health);
    // Income sends are small bodies whoever they go to; they go at the leader
    // unless the style is choosier.
    const rule =
      purpose === 'income' && this.style.target === 'weakest' ? 'leader' : this.style.target;
    switch (rule) {
      case 'leader':
        return leader();
      case 'weakest':
        return pickOf((id) => -health(id));
      case 'random':
        return rivals[this.rng.int(rivals.length)]!.id;
      case 'revenge': {
        let worst: TeamId | null = null;
        let most = 0;
        for (const r of rivals) {
          const n = this.grudges.get(r.id) ?? 0;
          if (n > most) {
            most = n;
            worst = r.id;
          }
        }
        return worst ?? leader();
      }
    }
  }

  /** Tally who has sent at this lane: public, it is the incoming-send notice. */
  private readGrudges(lane: Lane): void {
    if (lane.sendLog.length < this.grudgesRead) this.grudgesRead = 0;
    for (let i = this.grudgesRead; i < lane.sendLog.length; i++) {
      const from = lane.sendLog[i]!.fromTeamId;
      this.grudges.set(from, (this.grudges.get(from) ?? 0) + 1);
    }
    this.grudgesRead = lane.sendLog.length;
  }
}

function fortressLadder(data: GameData, id: string) {
  const f = data.fortress;
  switch (id) {
    case 'weapon':
      return f.weapon.upgrades;
    case 'hp':
      return f.hp.upgrades;
    case 'regen':
      return f.regen.upgrades;
    case 'gemOutput':
      return f.resourceBuilding.output.upgrades;
    case 'gemRate':
      return f.resourceBuilding.rate.upgrades;
    case 'auraStrength':
      return f.auras.strength.upgrades;
    case 'auraRadius':
      return f.auras.radius.upgrades;
    default:
      return [];
  }
}

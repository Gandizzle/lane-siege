/**
 * A whole run, played: waves 1 to N in the real simulation, by a scripted
 * player that splits its gold between the economy and the army on a plan.
 * docs/BALANCE.md.
 *
 * The sandbox (`sandbox.ts`) answers "can this much gold of army beat this
 * wave". It cannot answer the question that decides whether the economy is
 * balanced, which is what happens when a player takes gold OUT of the army to
 * put it into gem output - because what that costs is only visible over a run.
 * The gold compounds: output makes gems, gems buy sends, sends buy income, and
 * income arrives every wave for the rest of the game. A player who invests
 * early is poorer for a few waves and richer after, and whether "a few waves"
 * is survivable is the balance question.
 *
 * So this plays it. Every economic rule is the game's own - payouts on the
 * resource building's clock, sends at 10 gems for +1 income, income paid at
 * each build phase, the supply cap bought five at a time - because they are
 * applied as commands, exactly as a player's taps are.
 *
 * THE PLAYER. Its economy follows a fixed plan (`ECONOMY_PLANS`). Its gems go
 * straight into the send with the best income per gem, the moment it can
 * afford one: auto-send, which is what a player building income does. Its army
 * is bought by LOOKAHEAD - for each thing it could buy, it plays the coming
 * wave in the sandbox with and without it, and buys whatever gains the most
 * margin per gold. That is a stronger player than most humans, on purpose: the
 * question being asked is whether an economy plan is SURVIVABLE, and a weak
 * army policy would make a greedy plan die of bad play and call the waves
 * well tuned. It banks gold rather than spend it on nothing, so a plan that
 * leaves the army comfortable shows up as gold in hand.
 *
 * Tech is bought the same way, as one more thing on the shelf: the next level
 * of a damage track its army deals, or of health or attack speed, judged by
 * the same lookahead and bought when it gains more per gold than a body does.
 *
 * WHAT IT DOES NOT DO: fortress upgrades (its gems all go to income), selling,
 * or anything to do with opponents. There is one rival lane, which
 * exists only to be sent at; it cannot lose and it never sends back. That makes
 * these runs the floor of a real game's difficulty, not the ceiling - a real
 * table sends at whoever is richest.
 */

import type { DamageType, GameData, UnitDef } from '../data/schema.ts';
import { isMelee } from '../data/roster.ts';
import {
  applyCommand,
  createContext,
  createMatch,
  generateWave,
  resolveMonsterStats,
  step,
  TICKS_PER_SECOND,
  type Command,
  type DefensiveUnit,
  type Lane,
  type MatchState,
  type SimContext,
} from '../sim/index.ts';
import { lines } from './builds.ts';
import { layOut, runWave, type Buy, type Shopping, type WaveOutcome } from './sandbox.ts';

/** How far up the two resource-building ladders to be, before each wave. */
export interface EconomyPlan {
  id: string;
  name: string;
  /** Gem output level to own by the build phase that ends with `wave`. */
  output: (wave: number) => number;
  /** Gem rate level to own by then. */
  rate: (wave: number) => number;
  /**
   * Buy the army FIRST, only until the coming wave is won by this margin, then
   * the economy - up to `output` and `rate`, which may be unbounded - and then
   * whatever is left goes back into the army if it helps. Absent means the
   * economy comes first, whatever it costs the army.
   *
   * Unbounded, this is the plan that answers the design's question directly -
   * "how much economy can a player build by wave 10 and still be alive" -
   * because it is the player who takes every coin the army can spare and not
   * one more.
   */
  armyFirst?: number;
}

export const ECONOMY_PLANS: readonly EconomyPlan[] = [
  { id: 'army', name: 'No economy', output: () => 0, rate: () => 0 },
  {
    // The line `budget.ts` models the whole game on: one output level a wave
    // and a rate level every five. If THIS cannot survive, the waves are too
    // hard for the game the rest of the balance assumes.
    id: 'steady',
    name: 'Steady (the budget model, played sensibly)',
    output: (wave) => Math.max(0, wave - 1),
    rate: (wave) => Math.floor(Math.max(0, wave - 1) / 5),
    // Sensibly: nobody buys a gem upgrade in the build phase of a wave they can
    // see they are about to lose. Without this the reference player died at
    // wave 6 with Thornweald, having bought its economy first and been left
    // 36 gold for an army the sandbox already knew was losing.
    armyFirst: 0.25,
  },
  {
    // The line the design says should NOT be survivable: output to twenty and
    // two rate levels by wave 10, both front-loaded because that is how the
    // compounding pays best, and bought before the army every time. Past wave
    // 10 it keeps the same pace - twice the steady line's output.
    id: 'greedy',
    name: 'Greedy (output 20, rate 2 by wave 10)',
    output: (wave) => Math.round((20 * Math.max(0, wave - 1)) / 9),
    rate: (wave) => (wave >= 12 ? 3 : wave >= 7 ? 2 : wave >= 4 ? 1 : 0),
  },
  {
    // The same greed played well: survive first, then every spare coin into
    // the economy. Where this ends up at wave 10 is the real answer to "how far
    // can the economy be pushed", and the design's line is output 20 with two
    // rate levels - anything past that and the waves are too soft.
    id: 'smart',
    name: 'Smart greed (army to a safe margin, then all economy)',
    output: () => Number.POSITIVE_INFINITY,
    rate: () => Number.POSITIVE_INFINITY,
    armyFirst: 0.25,
  },
];

/** One wave of a run, as it stood when the wave was over. */
export interface WaveLog {
  wave: number;
  /** The fortress stood at the end of it. */
  survived: boolean;
  fortressHp: number;
  fortressMaxHp: number;
  /** Lowest the fortress got during the wave, as a fraction of its maximum. */
  lowest: number;
  /** Gold the player had banked at the end of the wave, before being paid. */
  gold: number;
  income: number;
  output: number;
  rate: number;
  gemsPerSecond: number;
  /** What the army standing on the board cost, chains and supply cap included. */
  armyGold: number;
  /** What the resource building has cost so far. */
  economyGold: number;
  /** What tech has cost so far. */
  techGold: number;
  bodies: number;
  /** What the army is, `r4m2x2 r1m1` style, for reading a run back. */
  army: string;
  supplyUsed: number;
  supplyCap: number;
  seconds: number;
}

export interface RunResult {
  builderId: string;
  planId: string;
  waves: WaveLog[];
  /** The last wave the fortress was still standing at the end of. */
  reached: number;
  survived: boolean;
}

export interface RunOptions {
  seed?: number;
  /** Most purchases the army buys in one build phase. A guard, not a rule. */
  maxBuysPerPhase?: number;
  /** Called after every tick, for reading a run back when it disagrees with the sandbox. */
  trace?: (state: MatchState, lane: Lane) => void;
}

const YOU = 'you';
const RIVAL = 'rival';

/** How much worse a point of the wave getting past is than a point of army lost. */
const LEAK_WEIGHT = 4;

function num(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}

/**
 * How a player reads a sandbox fight: army left, less four times what got past.
 * See `Player.margin` for why a leak is weighted so heavily.
 */
export function judge(outcome: Pick<WaveOutcome, 'armyHpLeft' | 'waveHpLeft'>): number {
  return outcome.armyHpLeft - LEAK_WEIGHT * outcome.waveHpLeft;
}

/** Play waves 1 to `waves` under one economy plan. */
export function playRun(
  data: GameData,
  builderId: string,
  plan: EconomyPlan,
  waves: number,
  options: RunOptions = {},
): RunResult {
  const seed = options.seed ?? 1;
  const rivalBuilder = data.units.builders.find((b) => b.id !== builderId)?.id ?? builderId;
  const state = createMatch(data, {
    seed,
    teams: [
      { id: YOU, playerIds: ['p'], builderId },
      { id: RIVAL, playerIds: ['r'], builderId: rivalBuilder },
    ],
  });
  const ctx = createContext(data);
  const you = state.lanes[YOU]!;
  const rival = state.lanes[RIVAL]!;
  // It exists to be sent at. It cannot lose, and what is sent at it dies on
  // arrival, so its lane is never the reason a wave has not ended.
  rival.fortress.maxHp = Number.MAX_SAFE_INTEGER;
  rival.fortress.hp = rival.fortress.maxHp;

  const player = new Player(data, ctx, state, you, builderId, plan, seed, options);
  const log: WaveLog[] = [];
  let actedFor = -1;
  let lowest = 1;
  let combatStarted = 0;
  let lastPhase = state.phase;

  for (let guard = 0; guard < TICKS_PER_SECOND * 60 * 60; guard++) {
    if (state.finished) break;

    if (state.phase === 'build' && actedFor !== state.wave) {
      if (state.wave >= 1) {
        log.push(player.record(state.wave, true, lowest, state.tick - combatStarted));
      }
      if (state.wave >= waves) break;
      actedFor = state.wave;
      player.buildPhase(state.wave + 1);
      lowest = 1;
    }

    player.autoSend();
    step(ctx, state);
    if (state.phase === 'combat' && lastPhase === 'build') combatStarted = state.tick;
    lastPhase = state.phase;
    for (const monster of rival.monsters) if (monster.alive) monster.hp = 0;
    lowest = Math.min(lowest, you.fortress.hp / Math.max(1, you.fortress.maxHp));
    options.trace?.(state, you);
  }

  const eliminated = state.teams.find((t) => t.id === YOU)?.eliminated ?? false;
  if (eliminated) log.push(player.record(state.wave, false, 0, state.tick - combatStarted));

  const reached = log.filter((w) => w.survived).reduce((m, w) => Math.max(m, w.wave), 0);
  return {
    builderId,
    planId: plan.id,
    waves: log,
    reached,
    survived: !eliminated && reached >= waves,
  };
}

/**
 * The scripted player. Everything it does is a command, applied the way the
 * local transport applies a tap, so the economy it lives in is the game's.
 */
class Player {
  private readonly chains: Map<number, UnitDef[]>;
  private readonly defs: Map<string, UnitDef>;
  private readonly sendId: string;
  private economyGold = 0;
  private techGold = 0;

  constructor(
    private readonly data: GameData,
    private readonly ctx: SimContext,
    private readonly state: MatchState,
    private readonly lane: Lane,
    private readonly builderId: string,
    private readonly plan: EconomyPlan,
    private readonly seed: number,
    private readonly options: RunOptions,
  ) {
    this.chains = lines(data, builderId);
    this.defs = new Map(data.units.units.map((u) => [u.id, u]));
    // The best income per gem: that is what building an economy means.
    this.sendId = [...data.sends.sends].sort(
      (a, b) =>
        num(a.gemCost) / Math.max(1, num(a.incomeGranted)) -
        num(b.gemCost) / Math.max(1, num(b.incomeGranted)),
    )[0]!.id;
  }

  private apply(command: Command): boolean {
    return applyCommand(this.ctx, this.state, command).ok;
  }

  /** Spend every gem on income, the moment there is enough for a send. */
  autoSend(): void {
    const send = this.data.sends.sends.find((s) => s.id === this.sendId)!;
    while (this.lane.economy.gems >= num(send.gemCost)) {
      const ok = this.apply({ kind: 'send', teamId: YOU, targetTeamId: RIVAL, sendId: send.id });
      if (!ok) break;
    }
  }

  buildPhase(wave: number): void {
    this.aimTheWall(wave);
    const enough = this.plan.armyFirst;
    if (enough === undefined) {
      this.buyEconomy(wave);
      this.buyArmy(wave);
      return;
    }
    this.buyArmy(wave, enough);
    // Save for the boss. A player who puts every spare coin into the economy
    // on the easy waves arrives at the boss with one wave's income to answer
    // it, and the first version of this player did exactly that and died at
    // wave 5 - which made its verdict depend on whether the boss happened to
    // come up easy, rather than on how far the economy can be pushed. The
    // build phase before a boss wave banks what the army does not need.
    const every = this.data.waves.bossEveryNWaves;
    if (every > 0 && (wave + 1) % every === 0) return;
    if (Number.isFinite(this.plan.output(wave)) || Number.isFinite(this.plan.rate(wave))) {
      this.buyEconomy(wave);
    } else {
      this.buyEconomyGreedily();
    }
    // And anything the economy did not want, back into the army.
    this.buyArmy(wave);
  }

  // ------------------------------------------------------------ the fortress

  /** Point the weapon at whatever the coming wave is most made of. Free. */
  private aimTheWall(wave: number): void {
    const byId = new Map(
      [...this.data.monsters.monsters, ...this.data.monsters.bosses].map((m) => [m.id, m]),
    );
    const worth = new Map<DamageType, number>();
    for (const spec of generateWave(this.data, this.seed, wave)) {
      const def = byId.get(spec.defId);
      if (!def) continue;
      const hp = resolveMonsterStats(this.data, def, wave).hp;
      for (const type of this.data.matrix.damageTypes) {
        worth.set(
          type,
          (worth.get(type) ?? 0) + hp * this.data.matrix.multipliers[type][def.armour],
        );
      }
    }
    const best = [...worth].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) this.apply({ kind: 'setWeaponType', teamId: YOU, damageType: best });
  }

  // ------------------------------------------------------------- the economy

  private buyEconomy(wave: number): void {
    const f = this.data.fortress.resourceBuilding;
    const want: [string, number, typeof f.output.upgrades][] = [
      ['gemOutput', this.plan.output(wave), f.output.upgrades],
      ['gemRate', this.plan.rate(wave), f.rate.upgrades],
    ];
    for (const [id, target, ladder] of want) {
      while ((this.lane.fortress.upgrades[id] ?? 0) < target) {
        const next = ladder.find((l) => l.level === (this.lane.fortress.upgrades[id] ?? 0) + 1);
        if (!next) break;
        if (!this.makeRoom(num(next.supplyCost))) break;
        const before = this.lane.economy.gold;
        if (!this.apply({ kind: 'buyFortressUpgrade', teamId: YOU, upgradeId: id })) break;
        this.economyGold += before - this.lane.economy.gold;
      }
    }
  }

  /**
   * Everything left into the resource building, one level at a time, whichever
   * ladder adds more gems a second per gold. Output adds a gem to every payout;
   * rate shortens the interval, so it is worth more the more output there is.
   */
  private buyEconomyGreedily(): void {
    const f = this.data.fortress.resourceBuilding;
    const base = num(f.payoutSeconds, 2);
    for (let guard = 0; guard < 100; guard++) {
      const outLevel = this.lane.fortress.upgrades.gemOutput ?? 0;
      const rateLevel = this.lane.fortress.upgrades.gemRate ?? 0;
      const perPayout = this.lane.fortress.gemsPerPayout;
      const multiplier = rateLevel > 0 ? num(f.rate.upgrades[rateLevel - 1]?.value, 1) : 1;
      const nextOut = f.output.upgrades.find((l) => l.level === outLevel + 1);
      const nextRate = f.rate.upgrades.find((l) => l.level === rateLevel + 1);

      const options: { id: string; perGold: number; supply: number }[] = [];
      if (nextOut) {
        const gain = (num(nextOut.value) - perPayout) * (multiplier / base);
        options.push({
          id: 'gemOutput',
          perGold: gain / (num(nextOut.goldCost) + this.roomCost(num(nextOut.supplyCost))),
          supply: num(nextOut.supplyCost),
        });
      }
      if (nextRate) {
        const gain = perPayout * ((num(nextRate.value) - multiplier) / base);
        options.push({ id: 'gemRate', perGold: gain / num(nextRate.goldCost), supply: 0 });
      }
      const pick = options
        .filter((o) => Number.isFinite(o.perGold))
        .sort((a, b) => b.perGold - a.perGold);
      let bought = false;
      for (const option of pick) {
        const before = this.lane.economy.gold;
        if (!this.makeRoom(option.supply)) continue;
        if (!this.apply({ kind: 'buyFortressUpgrade', teamId: YOU, upgradeId: option.id }))
          continue;
        this.economyGold += before - this.lane.economy.gold;
        bought = true;
        break;
      }
      if (!bought) return;
    }
  }

  /** Raise the supply cap until `supply` more fits, if the gold allows. */
  private makeRoom(supply: number): boolean {
    const e = this.lane.economy;
    while (e.supplyCap - e.supplyUsed < supply) {
      if (!this.apply({ kind: 'buySupply', teamId: YOU })) return false;
    }
    return true;
  }

  /** What raising the cap far enough would cost, or Infinity if it cannot be. */
  private roomCost(supply: number): number {
    const e = this.lane.economy;
    let cap = e.supplyCap;
    let gold = 0;
    const ladder = this.data.economy.supply.capUpgrades;
    let level = this.lane.fortress.upgrades.supply ?? 0;
    while (cap - e.supplyUsed < supply) {
      const next = ladder.find((l) => l.level === level + 1);
      if (!next) return Number.POSITIVE_INFINITY;
      cap = num(next.value, cap);
      gold += num(next.goldCost);
      level += 1;
    }
    return gold;
  }

  // ---------------------------------------------------------------- the army

  private army(): DefensiveUnit[] {
    return this.lane.units.filter((u) => {
      const def = this.defs.get(u.defId);
      return def !== undefined && def.builderId === this.builderId;
    });
  }

  private shopping(units: DefensiveUnit[]): Shopping {
    const buys: Buy[] = [];
    for (const u of units) {
      const def = this.defs.get(u.defId)!;
      buys.push({ rung: def.rung, mark: def.mark });
    }
    return { buys, gold: 0, supply: 0 };
  }

  /**
   * How well this army does against the coming wave, as the player judges it.
   *
   * NOT the sandbox's margin. Margin is army health left minus wave health
   * left, and a wave that walks PAST an army is wave health left - so a tanky
   * army that survives at 38% while a quarter of the wave strolls by scores
   * +0.15, a win. In the real game that quarter reaches the wall. The first
   * version of this player optimised margin, bought exactly that army against
   * the all-ranged wave 6, and lost its fortress with two Hollowbarks still
   * standing. What leaks is weighted four times what survives, because what
   * leaks is fortress damage and what survives is only comfort.
   */
  private margin(
    buys: Buy[],
    wave: number,
    tech: Readonly<Record<string, number>> = this.lane.economy.tech,
  ): number {
    if (buys.length === 0) return -4;
    const out = runWave(this.data, this.builderId, { buys, gold: 0, supply: 0 }, wave, this.seed, {
      maxTicks: TICKS_PER_SECOND * 120,
      tech,
    });
    return judge(out);
  }

  /**
   * Buy whatever gains the most margin per gold against the wave that is
   * coming, one purchase at a time, until nothing is worth its price.
   */
  private buyArmy(wave: number, enough = Number.POSITIVE_INFINITY): void {
    const tiles = 4 * this.data.lane.buildZone.width;
    const limit = this.options.maxBuysPerPhase ?? 40;
    let current = this.margin(this.shopping(this.army()).buys, wave);

    for (let n = 0; n < limit; n++) {
      if (current >= enough) break;
      const units = this.army();
      const buys = this.shopping(units).buys;
      const gold = this.lane.economy.gold;

      type Option = { gain: number; margin: number; act: () => boolean };
      let best: Option | null = null;
      const consider = (
        next: Buy[],
        price: number,
        supply: number,
        act: () => boolean,
        tech?: Record<string, number>,
      ): void => {
        const cost = price + this.roomCost(supply);
        if (!Number.isFinite(cost) || cost > gold || cost <= 0) return;
        const margin = this.margin(next, wave, tech);
        const gain = (margin - current) / cost;
        if (!best || gain > best.gain) best = { gain, margin, act };
      };

      // A new Mark I body of each line.
      if (units.length < tiles) {
        for (const [, chain] of this.chains) {
          const def = chain[0]!;
          consider(
            [...buys, { rung: def.rung, mark: 1 }],
            num(def.goldCost),
            num(def.supplyCost),
            () => this.place(def),
          );
        }
      }
      // One more mark on a body already standing, one candidate per kind.
      const seen = new Set<string>();
      units.forEach((unit, i) => {
        const def = this.defs.get(unit.defId)!;
        if (!def.upgradesTo || seen.has(def.id)) return;
        seen.add(def.id);
        const next = this.defs.get(def.upgradesTo)!;
        const after = buys.map((b, j) => (j === i ? { rung: b.rung, mark: b.mark + 1 } : b));
        consider(after, num(next.goldCost), num(next.supplyCost), () =>
          this.upgrade(unit, num(next.supplyCost)),
        );
      });
      // The next level of a tech track: health and attack speed for everyone,
      // damage for the types this army actually deals.
      if (units.length > 0) {
        const dealt = new Set(units.map((u) => `dmg_${this.defs.get(u.defId)!.damageType}`));
        for (const track of this.data.economy.tech.tracks) {
          if (track.id.startsWith('dmg_') && !dealt.has(track.id)) continue;
          const owned = this.lane.economy.tech[track.id] ?? 0;
          const level = track.levels.find((l) => l.level === owned + 1);
          if (!level) continue;
          const tech = { ...this.lane.economy.tech, [track.id]: owned + 1 };
          consider(buys, num(level.goldCost), 0, () => this.buyTech(track.id), tech);
        }
      }

      const chosen = best as Option | null;
      // Nothing is worth buying: bank it. A comfortable army with gold in hand
      // is a plan with slack, and the report shows it as exactly that.
      if (!chosen || chosen.gain <= 0) break;
      if (!chosen.act()) break;
      current = chosen.margin;
    }

    this.rehome();
  }

  private place(def: UnitDef): boolean {
    if (!this.makeRoom(num(def.supplyCost))) return false;
    // Anywhere free for now: `rehome` puts the whole line where the sandbox
    // that chose it would have put it.
    const { width, depth } = this.data.lane.buildZone;
    for (let y = depth - 1; y >= 0; y--) {
      for (let x = 0; x < width; x++) {
        const taken = this.lane.units.some(
          (u) => u.alive && Math.floor(u.pos.x) === x && Math.floor(u.pos.y) === y,
        );
        if (taken) continue;
        return this.apply({
          kind: 'placeUnit',
          teamId: YOU,
          unitDefId: def.id,
          tileX: x,
          tileY: y,
        });
      }
    }
    return false;
  }

  private buyTech(trackId: string): boolean {
    const before = this.lane.economy.gold;
    if (!this.apply({ kind: 'buyTech', teamId: YOU, trackId })) return false;
    this.techGold += before - this.lane.economy.gold;
    return true;
  }

  private upgrade(unit: DefensiveUnit, supply: number): boolean {
    if (!this.makeRoom(supply)) return false;
    return this.apply({ kind: 'upgradeUnit', teamId: YOU, unitId: unit.id });
  }

  /**
   * Stand the army exactly where the sandbox stood it when it chose what to
   * buy: melee across the front, reach behind, from the row the wave arrives
   * at. A player would have placed each body there in the first place; moving
   * them here rather than paying to sell and rebuild is a liberty the harness
   * takes so that what it measured and what it plays are the same army.
   */
  private rehome(): void {
    const units = this.army();
    const placed = layOut(this.data, this.builderId, this.shopping(units));
    const free = new Map<string, { tileX: number; tileY: number }[]>();
    for (const p of placed) {
      const list = free.get(p.def.id) ?? [];
      list.push({ tileX: p.tileX, tileY: p.tileY });
      free.set(p.def.id, list);
    }
    // Melee first so the front fills before the back, matching `layOut`.
    const ordered = [...units].sort(
      (a, b) => Number(isMelee(this.defs.get(b.defId)!)) - Number(isMelee(this.defs.get(a.defId)!)),
    );
    for (const unit of ordered) {
      const tile = free.get(unit.defId)?.shift();
      if (!tile) continue;
      unit.homeTileX = tile.tileX;
      unit.homeTileY = tile.tileY;
      unit.pos = { x: tile.tileX + 0.5, y: tile.tileY + 0.5 };
    }
  }

  // --------------------------------------------------------------- reporting

  private label(): string {
    const counts = new Map<string, number>();
    for (const unit of this.army()) {
      const def = this.defs.get(unit.defId)!;
      const key = `r${def.rung}m${def.mark}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const tech = Object.entries(this.lane.economy.tech)
      .filter(([, level]) => level > 0)
      .map(([id, level]) => `${id.replace(/^(dmg|def)_/, '')}${level}`);
    return [
      ...[...counts].sort().map(([k, n]) => (n > 1 ? `${k}x${n}` : k)),
      ...(tech.length > 0 ? [`| ${tech.join(' ')}`] : []),
    ].join(' ');
  }

  record(wave: number, survived: boolean, lowest: number, ticks: number): WaveLog {
    const f = this.lane.fortress;
    const e = this.lane.economy;
    let armyGold = 0;
    for (const unit of this.army()) {
      // The whole chain up to where it stands.
      const def = this.defs.get(unit.defId)!;
      for (const link of this.chains.get(def.rung) ?? []) {
        armyGold += num(link.goldCost);
        if (link.id === def.id) break;
      }
    }
    const capLevel = f.upgrades.supply ?? 0;
    armyGold += capLevel * num(this.data.economy.supply.capUpgrades[0]?.goldCost);
    return {
      wave,
      survived,
      fortressHp: Math.max(0, f.hp),
      fortressMaxHp: f.maxHp,
      lowest,
      gold: e.gold,
      income: e.passiveIncome,
      output: f.upgrades.gemOutput ?? 0,
      rate: f.upgrades.gemRate ?? 0,
      gemsPerSecond:
        f.gemPayoutTicks > 0 ? (f.gemsPerPayout * TICKS_PER_SECOND) / f.gemPayoutTicks : 0,
      armyGold,
      economyGold: this.economyGold,
      techGold: this.techGold,
      bodies: this.army().length,
      army: this.label(),
      supplyUsed: e.supplyUsed,
      supplyCap: e.supplyCap,
      seconds: ticks / TICKS_PER_SECOND,
    };
  }
}

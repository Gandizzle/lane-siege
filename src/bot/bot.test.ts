/**
 * The scripted players' personalities (style.ts) and what each one does with
 * them (autoBuilder.ts). How LONG each kind lasts is `npm run bots`, which
 * takes minutes; these check the behaviour that makes them different.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { applyCommand, createContext, createMatch, step, type Command } from '../sim/index.ts';
import { AutoBuilder } from './autoBuilder.ts';
import {
  ARCHETYPES,
  ARCHETYPE_IDS,
  Rng,
  archetype,
  rollSeats,
  rollStyle,
  type ArchetypeId,
  type BotStyle,
} from './style.ts';
import { playTable } from './table.ts';

const { data } = loadDataFromDisk();

/**
 * Lane `a` for the bot under test, and three lanes that cannot fall and hold
 * nothing up - something to send at, and a match that does not end in wave 1
 * because nobody built in them.
 */
function table(seed = 3) {
  const builders = data.units.builders.map((b) => b.id);
  const state = createMatch(data, {
    seed,
    teams: ['a', 'b', 'c', 'd'].map((id, i) => ({
      id,
      playerIds: [id],
      builderId: builders[i % builders.length]!,
    })),
  });
  const ctx = createContext(data);
  const tick = (commands: Command[]): void => {
    step(ctx, state, commands);
    for (const id of ['b', 'c', 'd']) {
      const lane = state.lanes[id]!;
      for (const monster of lane.monsters) if (monster.alive) monster.hp = 0;
      lane.fortress.hp = lane.fortress.maxHp;
    }
  };
  return { state, tick };
}

/**
 * Several of these play real waves of a real match, which takes a couple of
 * seconds here and more than the default five on a slower CI runner - the
 * deploy refused two builds for it.
 */
const SLOW = { timeout: 60_000 };

describe('bot personalities', SLOW, () => {
  it('rolls the same table from the same seed, and different ways to play at it', () => {
    const one = rollSeats(42, ['lane2', 'lane3', 'lane4']);
    const two = rollSeats(42, ['lane2', 'lane3', 'lane4']);
    expect(one).toEqual(two);
    expect(new Set(one.map((s) => s.style.archetype)).size).toBe(3);
    for (const seat of one) expect(seat.name).toBe(archetype(seat.style.archetype).name);
    // Over many seeds, every archetype turns up.
    const seen = new Set<ArchetypeId>();
    for (let seed = 0; seed < 200; seed++) {
      for (const s of rollSeats(seed, ['x', 'y', 'z'])) seen.add(s.style.archetype);
    }
    expect([...seen].sort()).toEqual([...ARCHETYPE_IDS].sort());
  });

  it('keeps every rolled number inside its archetype', () => {
    for (const a of ARCHETYPES) {
      for (let seed = 1; seed <= 20; seed++) {
        const style = rollStyle(new Rng(seed), a.id);
        const inside = (value: number, [low, high]: readonly [number, number]) =>
          value >= low - 1e-9 && value <= high + 1e-9;
        expect(inside(style.economy, a.economy)).toBe(true);
        expect(inside(style.floor, a.floor)).toBe(true);
        expect(inside(style.margin, a.margin)).toBe(true);
        expect(inside(style.incomeShare, a.incomeShare)).toBe(true);
        expect(a.formation).toContain(style.formation);
        expect(a.gemUse).toContain(style.gemUse);
      }
    }
  });

  for (const a of ARCHETYPE_IDS) {
    it(`plays the first waves as a ${a}, inside its roster`, () => {
      const seats = playTable(data, 11, { archetypes: [a, a, a], waves: 3 });
      expect(seats).toHaveLength(3);
      for (const seat of seats) expect(seat.style.archetype).toBe(a);
    });
  }
});

describe('what a bot does with its style', SLOW, () => {
  function run(style: Partial<BotStyle>, ticks: number, seed = 3) {
    const { state, tick } = table(seed);
    const base = rollStyle(new Rng(seed), 'tactician');
    const bot = new AutoBuilder(data, 'a', state.lanes.a!.builderId, {
      style: { ...base, ...style },
      seed,
    });
    const issued: Command[] = [];
    for (let i = 0; i < ticks; i++) {
      const commands = bot.plan(state);
      issued.push(...commands);
      tick(commands);
    }
    return { state, bot, issued };
  }

  it('builds an army, and only from its own roster', () => {
    const { state, issued } = run({}, 20);
    const placed = issued.filter((c) => c.kind === 'placeUnit');
    expect(placed.length).toBeGreaterThan(0);
    const own = new Set(
      data.units.units.filter((u) => u.builderId === state.lanes.a!.builderId).map((u) => u.id),
    );
    for (const c of placed) expect(own.has(c.unitDefId)).toBe(true);
  });

  it('invests in the economy when that is its way', () => {
    const { state } = run({ economy: 1.5, floor: 0.5 }, 20 * 60 * 6);
    expect(state.lanes.a!.fortress.upgrades.gemOutput ?? 0).toBeGreaterThan(0);
  });

  it('waits out a ladder between levels rather than buying into its cooldown', () => {
    // economy.json `upgradeCooldowns`: a plan that wants two levels of one
    // ladder holds the second, and the bodies behind a cap raise wait with it.
    const { state, tick } = table();
    const ctx = createContext(data);
    const base = rollStyle(new Rng(3), 'tactician');
    const bot = new AutoBuilder(data, 'a', state.lanes.a!.builderId, {
      style: { ...base, economy: 1.5, floor: 0.5 },
      seed: 3,
    });
    // A cap too small for the first army, so the bot raises it several levels
    // in one build phase.
    state.lanes.a!.economy.supplyCap = 6;
    const refused: string[] = [];
    for (let i = 0; i < 20 * 60 * 6; i++) {
      for (const command of bot.plan(state)) {
        const result = applyCommand(ctx, state, command);
        if (result.rejection === 'on-cooldown') refused.push(command.kind);
        if (result.rejection === 'insufficient-supply') refused.push(command.kind);
      }
      tick([]);
    }
    expect(refused).toEqual([]);
    const lane = state.lanes.a!;
    // And what it held back, it bought.
    expect(lane.fortress.upgrades.gemOutput ?? 0).toBeGreaterThan(1);
    expect(lane.fortress.upgrades.supply ?? 0).toBeGreaterThan(1);
    expect(lane.units.length).toBeGreaterThan(0);
  });

  it('saves its gems and throws a volley of several sends at one lane', () => {
    const { state, tick } = table();
    const style = { ...rollStyle(new Rng(1), 'raider'), incomeShare: 0, volleyWaves: 1 };
    const bot = new AutoBuilder(data, 'a', state.lanes.a!.builderId, { style, seed: 1 });
    // Far enough in that the dear sends are open, with a bank to throw.
    state.wave = 10;
    state.lanes.a!.economy.gems = 0;
    bot.plan(state);
    state.lanes.a!.economy.gems = 1500;
    const sends: Command[] = [];
    for (let i = 0; i < 20 * 15; i++) {
      const commands = bot.plan(state);
      sends.push(...commands.filter((c) => c.kind === 'send'));
      tick(commands);
    }
    expect(sends.length).toBeGreaterThanOrEqual(3);
    const targets = new Set(sends.map((c) => (c.kind === 'send' ? c.targetTeamId : '')));
    expect(targets.size).toBe(1);
  });

  it('shares its sends among lanes that are tied for the lead', () => {
    const targets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { issued } = run({ incomeShare: 1, target: 'leader' }, 20 * 60, seed);
      for (const c of issued) if (c.kind === 'send') targets.add(c.targetTeamId);
    }
    // Every fortress is whole early on; the first lane is not everybody's leader.
    expect(targets.size).toBeGreaterThan(1);
  });

  it('never sends when it is told to keep quiet', () => {
    const { state, tick } = table();
    const bot = new AutoBuilder(data, 'a', state.lanes.a!.builderId, { sends: false, seed: 2 });
    state.lanes.a!.economy.gems = 5000;
    for (let i = 0; i < 20 * 40; i++) {
      const commands = bot.plan(state);
      expect(commands.some((c) => c.kind === 'send')).toBe(false);
      tick(commands);
    }
  });

  it('points the fortress at the coming wave when it aims, and leaves it when it does not', () => {
    const aimed = run({ aimWeapon: true, sloppiness: 0 }, 2).issued;
    expect(aimed.some((c) => c.kind === 'setWeaponType')).toBe(true);
    const lazy = run({ aimWeapon: false }, 2).issued;
    expect(lazy.some((c) => c.kind === 'setWeaponType')).toBe(false);
  });

  it('stands its line where its formation says', () => {
    const rowsOf = (formation: BotStyle['formation']) =>
      run({ formation }, 2)
        .issued.filter((c) => c.kind === 'placeUnit')
        .map((c) => (c.kind === 'placeUnit' ? c.tileY : 0));
    const mean = (rows: number[]) => rows.reduce((a, b) => a + b, 0) / rows.length;
    expect(mean(rowsOf('wall'))).toBeGreaterThan(mean(rowsOf('forward')));
  });
});

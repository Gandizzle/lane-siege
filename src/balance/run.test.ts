import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { ECONOMY_PLANS, judge, playRun } from './run.ts';
import { supplyGold } from './sandbox.ts';

const { data } = loadDataFromDisk();
const plan = (id: string) => ECONOMY_PLANS.find((p) => p.id === id)!;

describe('how the scripted player reads a fight', () => {
  it('counts a leaky win as worse than a narrow clean one', () => {
    // The margin the sandbox reports calls 38% of the army standing while a
    // quarter of the wave walks past it a win, +0.14. That quarter reaches the
    // wall in a real game, and a player who optimised margin bought exactly
    // that army against the all-ranged wave and lost its fortress.
    const leaky = judge({ armyHpLeft: 0.38, waveHpLeft: 0.24 });
    const narrow = judge({ armyHpLeft: 0.1, waveHpLeft: 0 });
    expect(leaky).toBeLessThan(0);
    expect(narrow).toBeGreaterThan(leaky);
  });
});

describe('the supply cap a basket pays for', () => {
  it('is free up to the base cap and five-at-a-time after it', () => {
    const base = data.economy.supply.capBase ?? 25;
    const step = data.economy.supply.capUpgrades[0]!.goldCost ?? 0;
    expect(supplyGold(data, base)).toBe(0);
    expect(supplyGold(data, base + 1)).toBe(step);
    expect(supplyGold(data, base + 5)).toBe(step);
    expect(supplyGold(data, base + 6)).toBe(2 * step);
    expect(supplyGold(data, 100_000)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('a run, played', { timeout: 120_000 }, () => {
  it("keeps the budget model's own player alive through the first boss", () => {
    // Steady is the line `budget.ts` models the whole game on. If it cannot
    // get through the first five waves the waves are too hard for the game the
    // rest of the balance assumes.
    const run = playRun(data, 'ironvow', plan('steady'), 5);
    expect(run.survived).toBe(true);
    expect(run.reached).toBe(5);
    const last = run.waves[run.waves.length - 1]!;
    expect(last.output).toBeGreaterThan(0);
    expect(last.income).toBeGreaterThan(0);
  });

  it('writes down the last wave, which a showdown follows rather than a build phase', () => {
    // A player who beat wave 25 used to be reported as having died at 24,
    // because the last wave is followed by the Final Showdown and every other
    // wave is written down when the next build phase opens. A two-wave game
    // has the same shape and plays in a second.
    const short = structuredClone(data);
    short.waves.showdown.afterWave = 2;
    const run = playRun(short, 'ironvow', plan('army'), 2);
    expect(run.waves.map((w) => w.wave)).toEqual([1, 2]);
    // With the army it fought it with, not the empty lane the showdown left.
    expect(run.waves[1]!.bodies).toBeGreaterThan(0);
    expect(run.survived).toBe(true);
    expect(run.reached).toBe(2);
  });

  it('punishes buying the economy first, whatever it costs the army', () => {
    // The whole point of a wave's difficulty: a player who starves the army to
    // build income has to be caught by it, and here that is the first boss.
    const run = playRun(data, 'ironvow', plan('greedy'), 6);
    expect(run.survived).toBe(false);
    expect(run.reached).toBeLessThan(6);
  });
});

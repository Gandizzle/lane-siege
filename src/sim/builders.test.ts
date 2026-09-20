/**
 * Four rosters. DESIGN.md §7.1, §6.1, §7.3.
 *
 * The rules a roster has to satisfy are testable, so they are tested against
 * the real `data/` rather than against a fixture - these are assertions about
 * the shipped game, not about a mock of it. What is deliberately NOT asserted
 * is whether the numbers are any good: balance is tuning, and tuning is a JSON
 * edit away at all times.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { AutoBuilder } from '../bot/autoBuilder.ts';
import { applyCommand, createContext, createMatch, setLaneBuilder, step } from './index.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();
const builders = data.units.builders;

function unitsOf(builderId: string) {
  return data.units.units.filter((u) => u.builderId === builderId);
}

function tierOne(builderId: string) {
  return unitsOf(builderId).filter((u) => u.mark === 1);
}

describe('every builder is a complete package (§6.1, §7.1)', () => {
  it('ships four of them', () => {
    // §7.1: "4+ builders at launch. Each has 6 units."
    expect(builders.length).toBeGreaterThanOrEqual(4);
  });

  for (const builder of builders) {
    describe(builder.name, () => {
      it('has exactly six units', () => {
        expect(tierOne(builder.id)).toHaveLength(6);
      });

      it('covers all four damage types', () => {
        // §6.1: a builder missing Pierce simply loses on the Plate wave.
        const covered = new Set(tierOne(builder.id).map((u) => u.damageType));
        expect([...covered].sort()).toEqual([...data.matrix.damageTypes].sort());
      });

      it('gives every unit at least a mark 2 (§7.3)', () => {
        for (const unit of tierOne(builder.id)) {
          expect(unit.upgradesTo).toBeDefined();
        }
      });

      it('has upgrade chains that lead somewhere real', () => {
        const byId = new Map(data.units.units.map((u) => [u.id, u]));
        for (const unit of unitsOf(builder.id)) {
          if (!unit.upgradesTo) continue;
          const next = byId.get(unit.upgradesTo);
          expect(next, `${unit.id} upgrades to a missing ${unit.upgradesTo}`).toBeDefined();
          expect(next!.builderId).toBe(builder.id);
          expect(next!.mark).toBe(unit.mark + 1);
        }
      });

      it('prices an upgrade below a second unit, per §7.3', () => {
        // "~1.6x base cost for ~2.2x value, so upgrading is more gold-efficient
        // than building new - but requires existing board presence."
        const byId = new Map(data.units.units.map((u) => [u.id, u]));
        for (const unit of tierOne(builder.id)) {
          const next = byId.get(unit.upgradesTo!);
          if (!next) continue;

          const costRatio = (next.goldCost ?? 0) / (unit.goldCost ?? 1);
          const valueRatio = (next.damage ?? 0) / (unit.damage ?? 1);
          expect(costRatio).toBeLessThan(valueRatio);
        }
      });

      it('is narrower than a build tile, so the line has room to move', () => {
        // Bodies smaller than the tile they are built on leave the gaps that
        // routing needs. A body the width of its tile would make a full row a
        // sealed wall.
        for (const unit of unitsOf(builder.id)) {
          expect((unit.bodyRadius ?? 0) * 2).toBeLessThan(0.7);
        }
      });
    });
  }

  it('differentiates them by distribution, not by coverage (§6.1)', () => {
    // "one builder has two excellent Blast units and a mediocre Arcane one,
    // another is the reverse." So each roster's best two damage types should be
    // a different pair from every other roster's.
    const signatures = builders.map((builder) => {
      const best = new Map<string, number>();
      for (const unit of tierOne(builder.id)) {
        const dps = (unit.damage ?? 0) * (unit.attackSpeed ?? 0);
        best.set(unit.damageType, Math.max(best.get(unit.damageType) ?? 0, dps));
      }
      return [...best.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([type]) => type)
        .sort()
        .join('+');
    });

    expect(new Set(signatures).size).toBe(builders.length);
  });
});

describe('the scripted player stays inside its roster', () => {
  // It drives the practice opponents (§17, M4) and every headless measurement,
  // so a bot that wandered into another builder's units would quietly
  // invalidate both - and the simulation would refuse the commands anyway.
  for (const builder of builders) {
    it(`builds only ${builder.name} units`, () => {
      const state = createMatch(data, {
        seed: 4,
        teams: [{ id: 'a', playerIds: ['p'], builderId: builder.id }],
      });
      const ctx = createContext(data);
      const bot = new AutoBuilder(data, 'a', builder.id);
      state.lanes.a!.economy.gold = 99_999;

      const placed = new Set<string>();
      for (let i = 0; i < 400; i++) {
        const commands = bot.plan(state);
        for (const command of commands) {
          if (command.kind === 'placeUnit') placed.add(command.unitDefId);
        }
        step(ctx, state, commands);
      }

      expect(placed.size).toBeGreaterThan(0);
      const own = new Set(unitsOf(builder.id).map((u) => u.id));
      for (const id of placed) expect(own.has(id), `${id} is not a ${builder.id} unit`).toBe(true);
    });
  }
});

describe('a lane plays one roster (§7.1)', () => {
  function match(builderId?: string): { state: MatchState; ctx: SimContext } {
    const state = createMatch(data, {
      seed: 2,
      teams: [{ id: 'a', playerIds: ['p'], ...(builderId !== undefined && { builderId }) }],
    });
    return { state, ctx: createContext(data) };
  }

  it('defaults to the first builder when the caller has no opinion', () => {
    expect(match().state.lanes.a!.builderId).toBe(builders[0]!.id);
  });

  it('refuses a builder that does not exist', () => {
    expect(() => match('nonesuch')).toThrow(/No such builder/);
  });

  it('refuses to build another roster’s unit', () => {
    const mine = builders[0]!;
    const theirs = builders[1]!;
    const { state, ctx } = match(mine.id);
    state.lanes.a!.economy.gold = 99_999;

    const foreign = tierOne(theirs.id)[0]!;
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'a',
        unitDefId: foreign.id,
        tileX: 3,
        tileY: 5,
      }).rejection,
    ).toBe('wrong-builder');

    const own = tierOne(mine.id)[0]!;
    expect(
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'a',
        unitDefId: own.id,
        tileX: 3,
        tileY: 5,
      }).ok,
    ).toBe(true);
  });

  it('can be seated before the match but not after', () => {
    const { state, ctx } = match(builders[0]!.id);
    expect(setLaneBuilder(data, state, 'a', builders[2]!.id)).toBe(true);
    expect(state.lanes.a!.builderId).toBe(builders[2]!.id);

    // Once anything is on the board, the roster is a commitment (§7.3, §11.4).
    state.lanes.a!.economy.gold = 99_999;
    applyCommand(ctx, state, {
      kind: 'placeUnit',
      teamId: 'a',
      unitDefId: tierOne(builders[2]!.id)[0]!.id,
      tileX: 2,
      tileY: 5,
    });
    expect(setLaneBuilder(data, state, 'a', builders[1]!.id)).toBe(false);
    expect(state.lanes.a!.builderId).toBe(builders[2]!.id);
  });

  it('holds its roster through a wave', () => {
    const { state, ctx } = match(builders[3]!.id);
    while (state.phase !== 'combat') step(ctx, state);
    for (let i = 0; i < 40; i++) step(ctx, state);
    expect(state.lanes.a!.builderId).toBe(builders[3]!.id);
  });
});

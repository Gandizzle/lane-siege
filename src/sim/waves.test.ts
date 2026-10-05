import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  chooseLateWaves,
  combinationWaves,
  comboKey,
  generateWave,
  isBossWave,
  previewWave,
  resolveMonsterStats,
  sendBounty,
  sendPrice,
} from './waves.ts';
import { applyCommand, createContext, createMatch, createMonster, step, viewFor } from './index.ts';

const { data } = loadDataFromDisk();

const ALL_SIXTEEN = data.matrix.armorTypes.flatMap((a) =>
  data.matrix.damageTypes.map((t) => comboKey(a, t)),
);

/** The one combination a generated wave is made of, or null if it is mixed. */
function onlyCombination(seed: number, wave: number): string | null {
  const byId = new Map(data.monsters.monsters.map((m) => [m.id, m]));
  const keys = new Set(
    generateWave(data, seed, wave).map((s) => {
      const def = byId.get(s.defId)!;
      return comboKey(def.armor, def.damageType);
    }),
  );
  return keys.size === 1 ? [...keys][0]! : null;
}

describe('wave generation (DESIGN.md §9.2)', () => {
  it('is a pure function of (matchSeed, waveNumber)', () => {
    // Not of anything else: wave 7 is identical whatever happened in 1-6.
    const a = generateWave(data, 555, 7);
    const b = generateWave(data, 555, 7);
    expect(a).toEqual(b);
  });

  it('stamps each monster with its own wave number (§8)', () => {
    expect(generateWave(data, 1, 3).every((s) => s.waveNumber === 3)).toBe(true);
  });

  it('makes waves 1-4, 6-9, 11-14 and 16-19 one combination each, every combination once', () => {
    // The playtest: a wave of three kinds asked nothing of an army. One kind a
    // wave, and all sixteen pairs of the chart over the match.
    expect(combinationWaves(data)).toEqual([
      1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19,
    ]);
    for (const seed of [1, 2, 99, 1107]) {
      const seen = combinationWaves(data).map((wave) => onlyCombination(seed, wave));
      expect(
        seen.every((key) => key !== null),
        `seed ${seed}`,
      ).toBe(true);
      expect([...seen].sort(), `seed ${seed}`).toEqual([...ALL_SIXTEEN].sort());
    }
    // In an order the seed decides, so two matches do not run the same way.
    const order = (seed: number) => combinationWaves(data).map((w) => onlyCombination(seed, w));
    expect(order(1)).not.toEqual(order(2));
  });

  it('brings as many monsters as the table says, at its scale', () => {
    for (const wave of combinationWaves(data)) {
      const row = data.waves.composition.find((w) => w.wave === wave)!;
      expect(generateWave(data, 3, wave), `wave ${wave}`).toHaveLength(row.count!);
    }
  });

  it('every combination is a real monster wearing that armor and dealing that damage', () => {
    const byId = new Map(data.monsters.monsters.map((m) => [m.id, m]));
    expect(data.waves.combinations.map((c) => comboKey(c.armor, c.damageType)).sort()).toEqual(
      [...ALL_SIXTEEN].sort(),
    );
    for (const combo of data.waves.combinations) {
      const def = byId.get(combo.monsterId)!;
      expect(def.armor, combo.monsterId).toBe(combo.armor);
      expect(def.damageType, combo.monsterId).toBe(combo.damageType);
    }
  });

  it('puts one boss, alone, on every fifth wave - each boss once before the council (§3.4)', () => {
    expect(isBossWave(data, 5)).toBe(true);
    expect(isBossWave(data, 10)).toBe(true);
    expect(isBossWave(data, 4)).toBe(false);
    const bank = new Set(data.waves.bossBank);
    for (const seed of [1, 2, 3]) {
      const bosses = [5, 10, 15, 20].map((wave) => {
        const specs = generateWave(data, seed, wave);
        expect(specs, `seed ${seed} wave ${wave}`).toHaveLength(1);
        expect(bank.has(specs[0]!.defId)).toBe(true);
        return specs[0]!.defId;
      });
      expect(new Set(bosses).size, `seed ${seed}`).toBe(data.waves.bossBank.length);
    }
  });

  it('keeps wave 25 the council of bosses, as authored', () => {
    const last = data.waves.composition.find((w) => w.wave === 25)!;
    const council = generateWave(data, 1, 25);
    expect(council).toHaveLength(last.entries!.reduce((n, e) => n + (e.count ?? 0), 0));
    expect(council.filter((s) => data.waves.bossBank.includes(s.defId)).length).toBeGreaterThan(4);
  });

  it('makes waves 21-24 two combinations each, half and half, from the late choice', () => {
    const late = [
      ['plate/pierce', 'ward/impact'],
      ['flesh/arcane', 'swarm/blast'],
      ['plate/impact', 'ward/arcane'],
      ['flesh/blast', 'swarm/pierce'],
    ];
    const byId = new Map(data.monsters.monsters.map((m) => [m.id, m]));
    late.forEach((pair, i) => {
      const wave = 21 + i;
      const specs = generateWave(data, 1, wave, late);
      const count = (key: string) =>
        specs.filter((s) => {
          const def = byId.get(s.defId)!;
          return comboKey(def.armor, def.damageType) === key;
        }).length;
      expect(count(pair[0]!) + count(pair[1]!), `wave ${wave}`).toBe(specs.length);
      expect(Math.abs(count(pair[0]!) - count(pair[1]!)), `wave ${wave}`).toBeLessThanOrEqual(1);
    });
    // With no record (a debugging start, the balance harness), the seed draws
    // them - still two kinds a wave.
    const drawn = new Set(generateWave(data, 1, 22).map((s) => s.defId));
    expect(drawn.size).toBe(2);
  });

  it('chooses the eight that hurt most, and pairs them', () => {
    const harm = Object.fromEntries(ALL_SIXTEEN.map((key, i) => [key, i]));
    const late = chooseLateWaves(data, 7, harm);
    expect(late).toHaveLength(4);
    for (const pair of late) expect(pair).toHaveLength(2);
    expect(late.flat().sort()).toEqual(ALL_SIXTEEN.slice(8).sort());
    // The same record and seed choose the same waves on every client.
    expect(chooseLateWaves(data, 7, harm)).toEqual(late);
  });

  it('previews the incoming wave for the build phase (§9.3)', () => {
    const preview = previewWave(data, 1, 3);
    expect(preview).toHaveLength(1);
    expect(preview[0]!.count).toBe(generateWave(data, 1, 3).length);
    expect(preview[0]!.name).toBeTruthy();
    expect(preview[0]!.armor).toBeTruthy();
  });
});

/** §9.1, replaced: a table, one row a wave, rather than a curve. */
describe('monsters grow with the wave table', () => {
  const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;
  const boss = data.monsters.bosses[0]!;
  const row = (wave: number) => data.waves.composition.find((w) => w.wave === wave)!;

  it("scales health and damage by the row's scale", () => {
    for (const wave of [1, 2, 9, 19, 24]) {
      const stats = resolveMonsterStats(data, grub, wave);
      expect(stats.hp, `wave ${wave}`).toBeCloseTo(grub.hp! * row(wave).scale!, 9);
      expect(stats.damage, `wave ${wave}`).toBeCloseTo(grub.damage! * row(wave).scale!, 9);
    }
  });

  it('scales a boss by its own column, and never by both', () => {
    for (const wave of [5, 10, 15, 20, 25]) {
      const stats = resolveMonsterStats(data, boss, wave);
      expect(stats.hp, `wave ${wave}`).toBeCloseTo(boss.hp! * row(wave).bossScale!, 9);
    }
  });

  it('grows every wave, and keeps growing past the table', () => {
    let last = 0;
    for (const wave of combinationWaves(data)) {
      const hp = resolveMonsterStats(data, grub, wave).hp;
      expect(hp, `wave ${wave}`).toBeGreaterThan(last);
      last = hp;
    }
    expect(resolveMonsterStats(data, grub, 30).hp).toBeGreaterThan(
      resolveMonsterStats(data, grub, 25).hp,
    );
    expect(resolveMonsterStats(data, boss, 35).hp).toBeGreaterThan(
      resolveMonsterStats(data, boss, 25).hp,
    );
  });

  it("leaves speed and reach alone, which is enrage's job (§8)", () => {
    const one = resolveMonsterStats(data, grub, 1);
    const twenty = resolveMonsterStats(data, grub, 20);
    expect(twenty.moveSpeed).toBe(one.moveSpeed);
    expect(twenty.attackSpeed).toBe(one.attackSpeed);
    expect(twenty.range).toBe(one.range);
  });

  it('puts every living monster in a lane in the wave on screen', () => {
    // The stat panel resolves a monster against the CURRENT wave rather than
    // being told which wave each body came from (buildBar.ts,
    // `showMonsterStats`). That is only right because combat ends when the
    // lane is clear, so a wave can never land on an unfinished one.
    const state = createMatch(data, { seed: 5, teams: [{ id: 'l1', playerIds: ['p'] }] });
    const ctx = createContext(data);
    const lane = state.lanes.l1!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    lane.fortress.hp = lane.fortress.maxHp;

    let seen = 0;
    for (let t = 0; t < 4000; t++) {
      step(ctx, state);
      for (const monster of lane.monsters) {
        if (!monster.alive) continue;
        expect(monster.waveNumber, `tick ${t}`).toBe(state.wave);
        seen += 1;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('what hurt, and what comes back (waves 21-24)', () => {
  it("records each combination's harm as a share of the army it hit", () => {
    const state = createMatch(data, { seed: 3, teams: [{ id: 'l1', playerIds: ['p'] }] });
    const ctx = createContext(data);
    const lane = state.lanes.l1!;
    lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
    lane.fortress.hp = lane.fortress.maxHp;
    lane.economy.gold = 1000;
    for (let x = 0; x < 6; x++) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: 'l1',
        unitDefId: 'pledge',
        tileX: x,
        tileY: 6,
      });
    }
    const key = onlyCombination(3, 1)!;
    for (let t = 0; t < 20 * 120 && !(state.phase === 'build' && state.wave === 1); t++)
      step(ctx, state);
    expect(state.wave).toBe(1);
    expect(lane.comboHarm[key]).toBeGreaterThan(0);
    // Nothing else was fought, so nothing else is on the record.
    expect(Object.keys(lane.comboHarm)).toEqual([key]);
  });

  it('decides waves 21-24 as wave 20 ends, from the lanes still standing', () => {
    const state = createMatch(data, {
      seed: 4,
      teams: [
        { id: 'a', playerIds: ['a'] },
        { id: 'b', playerIds: ['b'] },
      ],
    });
    const ctx = createContext(data);
    ALL_SIXTEEN.forEach((key, i) => {
      state.lanes.a!.comboHarm[key] = i;
      // The fallen lane's record is the opposite, and must not count.
      state.lanes.b!.comboHarm[key] = 100 - i;
    });
    state.teams.find((t) => t.id === 'b')!.eliminated = true;
    state.phase = 'combat';
    state.wave = 20;
    expect(state.lateWaves).toBeNull();
    step(ctx, state);
    expect(state.phase).toBe('build');
    expect(state.lateWaves!.flat().sort()).toEqual(ALL_SIXTEEN.slice(8).sort());
    // And the view carries it, so the preview of wave 21 is right.
    expect(viewFor(ctx, state, 'a').lateWaves).toEqual(state.lateWaves);
  });
});

/**
 * §11.1, replaced: a wave pays a fixed pool rather than whatever its monsters
 * happened to be worth. The whole gold curve in docs/BALANCE.md rests on this,
 * so it is worth saying out loud in more than one way.
 */
describe('the wave bounty pool (§11.1, replaced)', () => {
  const pool = data.economy.waveBounty ?? 0;

  const purse = data.economy.bossBounty ?? 0;

  it('pays the same total every wave, whatever walks in', () => {
    for (let wave = 1; wave <= 30; wave++) {
      const paid = generateWave(data, 99, wave).reduce((sum, s) => sum + (s.bounty ?? 0), 0);
      // A boss wave pays the pool AND the boss's purse (§3.4, added); every
      // other wave pays the pool and nothing else, however many walk in.
      const due = pool + (isBossWave(data, wave) ? purse : 0);
      expect(paid, `wave ${wave}`).toBeCloseTo(due, 6);
    }
  });

  it('pays one purse a boss wave, however many bosses are in it', () => {
    const bank = new Set(data.waves.bossBank);
    const council = generateWave(data, 99, data.waves.showdown.afterWave);
    const bosses = council.filter((s) => bank.has(s.defId));
    expect(bosses.length, 'the last wave is a council').toBeGreaterThan(1);
    const paid = council.reduce((sum, s) => sum + (s.bounty ?? 0), 0);
    expect(paid).toBeCloseTo(pool + purse, 6);
  });

  it('pays a boss its purse on top, and only a boss', () => {
    expect(purse).toBeGreaterThan(0);
    const bossIds = new Set(data.waves.bossBank);
    // A boss wave is the boss alone now: it takes the whole pool and the purse.
    const wave = generateWave(data, 99, 5);
    const boss = wave.find((s) => bossIds.has(s.defId))!;
    expect(wave).toHaveLength(1);
    expect(boss.bounty!).toBeCloseTo(pool + purse, 6);
    for (const s of generateWave(data, 99, 4)) expect(s.bounty!).toBeLessThan(purse);
  });

  it('splits it by the weight on each definition, not evenly', () => {
    // A monster worth twice another takes twice the share: the relative worth
    // survives, the total does not float. A mixed wave, written down - every
    // wave the game generates is one kind, or two of equal weight.
    const mixed = structuredClone(data);
    mixed.monsters.monsters.find((m) => m.id === 'grub')!.bounty = 2;
    mixed.monsters.monsters.find((m) => m.id === 'husk')!.bounty = 6;
    mixed.waves.composition.find((w) => w.wave === 2)!.entries = [
      { monsterId: 'grub', count: 10 },
      { monsterId: 'husk', count: 5 },
    ];
    const wave = generateWave(mixed, 1, 2);
    const light = wave.find((s) => s.defId === 'grub')!;
    const heavy = wave.find((s) => s.defId === 'husk')!;
    expect(heavy.bounty! / light.bounty!).toBeCloseTo(3, 6);
    expect(wave.reduce((sum, s) => sum + (s.bounty ?? 0), 0)).toBeCloseTo(pool, 6);
  });

  it('does not pay more for a wave with more monsters in it', () => {
    // The old per-monster bounties made the biggest wave worth nineteen times
    // the smallest. Both are non-boss waves: a boss carries a purse on top.
    const sizes = combinationWaves(data)
      .map((wave) => ({ wave, n: generateWave(data, 7, wave).length }))
      .sort((a, b) => a.n - b.n);
    const smallest = sizes[0]!;
    const biggest = sizes[sizes.length - 1]!;
    expect(biggest.n).toBeGreaterThan(smallest.n);

    const paid = (wave: number): number =>
      generateWave(data, 7, wave).reduce((sum, s) => sum + (s.bounty ?? 0), 0);
    expect(paid(biggest.wave)).toBeCloseTo(paid(smallest.wave), 6);
  });

  it('prices a sent monster against the gems its sender spent, not the pool', () => {
    const per10 = data.economy.sendBountyPerTenGems ?? 0;
    for (const send of data.sends.sends) {
      const paid = sendPrice(data, send.id).gems;
      expect(sendBounty(data, send.id), send.id).toBeCloseTo((paid * per10) / 10, 6);
    }
    // A dearer send hands its target more gold: that is the trade.
    const cheapest = data.sends.sends.reduce((a, b) =>
      (a.gemCost ?? 0) <= (b.gemCost ?? 0) ? a : b,
    );
    const dearest = data.sends.sends.reduce((a, b) =>
      (a.gemCost ?? 0) >= (b.gemCost ?? 0) ? a : b,
    );
    expect(sendBounty(data, dearest.id)).toBeGreaterThan(sendBounty(data, cheapest.id));
    expect(sendBounty(data, 'no-such-send')).toBe(0);
  });

  it('prices a send as written, in tens, whatever the wave', () => {
    for (const send of data.sends.sends) {
      const price = sendPrice(data, send.id);
      expect(price.gems, send.id).toBe(send.gemCost);
      expect(price.gems % 10, send.id).toBe(0);
      expect(price.income, send.id).toBe(send.incomeGranted);
    }
    expect(sendPrice(data, 'no-such-send')).toEqual({ gems: 0, income: 0 });
  });

  it('delivers a body the same size at every wave, as its send says', () => {
    // The price does not grow, so neither does what it buys (sends.json
    // `_bodies`). A monster walking in with the wave still grows.
    const ctx = createContext(data);
    for (const wave of [1, 12, 22]) {
      const state = createMatch(data, { seed: 1, teams: [{ id: 'a', playerIds: ['a'] }] });
      for (const send of data.sends.sends) {
        const monster = createMonster(
          state,
          data,
          ctx.defs,
          { defId: send.monsters[0]!, waveNumber: wave, sendId: send.id },
          { x: 1, y: -1 },
        )!;
        expect(monster.maxHp, `${send.id} at ${wave}`).toBe(send.hp);
        expect(monster.damage, `${send.id} at ${wave}`).toBe(send.damage);
      }
      const walkedIn = createMonster(
        state,
        data,
        ctx.defs,
        { defId: 'grub', waveNumber: wave },
        {
          x: 1,
          y: -1,
        },
      )!;
      const grub = data.monsters.monsters.find((m) => m.id === 'grub')!;
      expect(walkedIn.maxHp).toBe(resolveMonsterStats(data, grub, wave).hp);
    }
  });
});

/**
 * §11.5: the cheapest send is the floor of the whole economy - the best gems
 * per +1 gold a wave that exists - and docs/BALANCE.md prices every unit in the
 * game against it. A dearer send that was also more efficient would make the
 * budget a fiction.
 */
describe('the send ladder', () => {
  const rate = (s: (typeof data.sends.sends)[number]) =>
    (s.incomeGranted ?? 0) / Math.max(1, s.gemCost ?? 0);

  it('runs fifteen sends from 10 gems to 500, every price a multiple of ten', () => {
    const costs = data.sends.sends.map((s) => s.gemCost ?? 0);
    expect(costs).toHaveLength(15);
    expect(Math.min(...costs)).toBe(10);
    expect(Math.max(...costs)).toBe(500);
    expect(data.sends.sends.find((s) => s.gemCost === 10)!.id).toBe('swarmling');
    for (const cost of costs) expect(cost % 10).toBe(0);
  });

  it('pays the best rate on three economy sends and less on every other', () => {
    const economic = data.sends.sends.filter((s) => s.economic === true);
    expect(economic.map((s) => s.id).sort()).toEqual(['grub', 'husk', 'swarmling']);
    const best = rate(economic[0]!);
    for (const send of economic) expect(rate(send), send.id).toBeCloseTo(best, 9);
    for (const send of data.sends.sends.filter((s) => s.economic !== true)) {
      // What you pay extra for is the body and the ability, never the rate.
      expect(rate(send), send.id).toBeLessThan(best);
    }
  });

  it('buys more body a gem the dearer the attack', () => {
    const attacks = data.sends.sends
      .filter((s) => s.economic !== true)
      .sort((a, b) => (a.gemCost ?? 0) - (b.gemCost ?? 0));
    const perGem = (s: (typeof attacks)[number]) => (s.hp ?? 0) / (s.gemCost ?? 1);
    const cheapest = attacks[0]!;
    const dearest = attacks[attacks.length - 1]!;
    expect(perGem(dearest)).toBeGreaterThan(perGem(cheapest));
    // And an attack buys more body a gem than an economy send does.
    for (const eco of data.sends.sends.filter((s) => s.economic === true)) {
      expect(perGem(cheapest), `${cheapest.id} vs ${eco.id}`).toBeGreaterThan(perGem(eco));
    }
  });

  it('opens the economy from the start and the dearest send last', () => {
    const from = (s: (typeof data.sends.sends)[number]) => s.fromWave ?? 1;
    for (const eco of data.sends.sends.filter((s) => s.economic === true)) {
      expect(from(eco), eco.id).toBe(1);
    }
    const dearest = data.sends.sends.reduce((a, b) =>
      (a.gemCost ?? 0) >= (b.gemCost ?? 0) ? a : b,
    );
    for (const send of data.sends.sends) {
      expect(from(send), send.id).toBeLessThanOrEqual(from(dearest));
    }
    expect(from(dearest)).toBeGreaterThan(1);
  });

  it('holds every send to a cooldown of one to ten seconds', () => {
    for (const send of data.sends.sends) {
      expect(send.cooldownSeconds, send.id).toBeGreaterThanOrEqual(1);
      expect(send.cooldownSeconds, send.id).toBeLessThanOrEqual(10);
    }
  });
});

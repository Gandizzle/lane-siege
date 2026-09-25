/**
 * Abilities: the data model, and the machine that runs it. DESIGN.md §7, §18.
 *
 * Three kinds of test, and the middle one is the point:
 *
 *   THE VOCABULARY holds together - every stat an ability may modify is one
 *   the aggregation actually honours, and every effect kind the live set claims
 *   is one the runtime has a case for. These are what stop the catalogue from
 *   drifting away from the code that reads it.
 *
 *   THE RULES do what they say: a stack rule caps, a percent slow compounds
 *   rather than adding, diminishing returns bite, a ward eats exactly one
 *   attack, spell immunity is total, and dampening reaches a heal.
 *
 *   THE INTEGRATION happens: a real unit from a real roster, fighting a real
 *   wave, applies its real ability.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import {
  ABILITY_ROLES,
  EFFECT_KINDS,
  IMPLEMENTED_EFFECTS,
  STAT_KEYS,
  rankNumbers,
  refId,
  refRank,
  resolveAbility,
  type AbilityDef,
} from '../data/schema.ts';
import { applyCommand } from './apply.ts';
import { TICKS_PER_SECOND } from './constants.ts';
import { dampeningRemaining } from './dampening.ts';
import { createContext, createMatch, step } from './index.ts';
import { beginShowdown } from './showdown.ts';
import { createMonster } from './spawn.ts';
import {
  ADDITIVE_STATS,
  FLAT_CAPABLE,
  applyStatus,
  consumeShield,
  controlScale,
  freshAbilityState,
  modifiersOf,
  noteControl,
  tickStatuses,
  type Afflicted,
  type ResolvedStackRule,
  type Status,
} from './status.ts';
import type { MatchState, SimContext } from './index.ts';

const { data } = loadDataFromDisk();
const all = [...data.abilities.abilities, ...data.abilities.planned];

/** A bare body, for testing the status rules without a match around them. */
function body(overrides: Partial<Afflicted> = {}): Afflicted {
  return {
    id: 1,
    defId: 'test',
    hp: 100,
    maxHp: 100,
    baseMaxHp: 100,
    ...freshAbilityState(100),
    ...overrides,
  };
}

function status(overrides: Partial<Status> = {}): Status {
  return {
    abilityId: 'test',
    slot: 0,
    kind: 'modify',
    stat: 'moveSpeed',
    mode: 'percent',
    amount: -0.2,
    perSecond: 0,
    ofMaxHealth: 0,
    damageType: null,
    blocks: 0,
    control: null,
    immuneTo: null,
    tag: null,
    ticksLeft: 20,
    sourceId: 2,
    sourceDefId: 'thornling',
    ...overrides,
  };
}

/** A stack rule, resolved, as the runtime receives it. */
function rule(from: ResolvedStackRule['from'], max: number): ResolvedStackRule {
  return { max, from, refresh: true };
}

// --------------------------------------------------------------- the vocabulary

describe('the vocabulary holds together', () => {
  it('honours every stat an ability is allowed to modify', () => {
    // A stat in the list that the aggregation ignores is an ability that
    // silently does nothing - the exact failure the `traits` rule exists for,
    // one level down. Every key is set to a known amount and has to move
    // something.
    for (const stat of STAT_KEYS) {
      const subject = body();
      const before = JSON.stringify(modifiersOf(subject));
      applyStatus(subject, status({ stat, amount: 0.5 }), rule('any', 1));
      expect(JSON.stringify(modifiersOf(subject)), stat).not.toBe(before);
    }
  });

  it('has a runtime case for every effect kind it calls live', () => {
    // The live set and the switch in abilityRuntime.ts have to agree. Proved
    // through the data rather than by reading the code: every live kind is
    // exercised by at least one authored ability, and `validate.ts` refuses a
    // referenced ability built from anything else - so a kind added to the
    // live list without a handler has nothing standing behind it.
    const used = new Set(data.abilities.abilities.flatMap((a) => a.effects.map((e) => e.kind)));
    for (const kind of IMPLEMENTED_EFFECTS) expect(used, kind).toContain(kind);
  });

  it('keeps the planned list to kinds that are not live, and vice versa', () => {
    const live = new Set<string>(IMPLEMENTED_EFFECTS);
    for (const ability of data.abilities.planned) {
      const kinds = ability.effects.map((e) => e.kind);
      expect(
        kinds.some((k) => !live.has(k)),
        ability.id,
      ).toBe(true);
    }
    for (const ability of data.abilities.abilities) {
      for (const effect of ability.effects) expect(live, ability.id).toContain(effect.kind);
    }
  });

  it('never gives a flat amount to a stat that is a fraction', () => {
    for (const stat of ADDITIVE_STATS) expect(FLAT_CAPABLE).not.toContain(stat);
  });

  it('names and describes every ability, in a role', () => {
    for (const ability of all) {
      expect(ability.name.length, ability.id).toBeGreaterThan(2);
      expect(ability.text.length, ability.id).toBeGreaterThan(10);
      expect(ABILITY_ROLES, ability.id).toContain(ability.role);
      expect(EFFECT_KINDS.length).toBeGreaterThan(0);
    }
    // Names are what the player learns, so no two may be the same.
    const names = all.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ------------------------------------------------------------ ranks and numbers

describe('ranks', () => {
  const kindle = data.abilities.abilities.find((a) => a.id === 'kindle')!;

  it('lays a rank over the base numbers rather than replacing them', () => {
    const one = rankNumbers(kindle, 1);
    const three = rankNumbers(kindle, 3);
    // Rank 3 raises the burn and the duration; every other key survives.
    expect(three.burn).toBeGreaterThan(one.burn!);
    for (const key of Object.keys(one)) expect(three, key).toHaveProperty(key);
  });

  it('resolves every "@name" to a number', () => {
    for (const ability of all) {
      const ranks = ability.ranks?.length ?? 1;
      for (let rank = 1; rank <= ranks; rank++) {
        const resolved = resolveAbility(ability, rank);
        const numbers = JSON.stringify(resolved);
        expect(numbers, `${ability.id} rank ${rank}`).not.toContain('"@');
      }
    }
  });

  it('gives a rank past the end the last row it has rather than nothing', () => {
    // Belt and braces: `validate.ts` refuses a reference past the end, and a
    // resolve that returned zeroes would be a unit with a silent ability.
    const beyond = resolveAbility(kindle, 9);
    expect(beyond.effects[0]!.perSecond).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------- the rules

describe('stacking is a rule, not a number', () => {
  it('caps at the maximum however many times it is applied', () => {
    const subject = body();
    for (let i = 0; i < 10; i++) {
      applyStatus(subject, status({ sourceId: i }), rule('any', 3));
    }
    expect(subject.statuses.length).toBe(3);
  });

  it('gives one source one stack, however fast it attacks', () => {
    const subject = body();
    for (let i = 0; i < 5; i++) {
      applyStatus(subject, status({ sourceId: 7 }), rule('perSource', 3));
    }
    expect(subject.statuses.length).toBe(1);
  });

  it('stacks per unit TYPE, so a mixed line stacks and six of one does not', () => {
    const subject = body();
    for (const id of [1, 2, 3]) {
      applyStatus(
        subject,
        status({ sourceId: id, sourceDefId: 'thornling' }),
        rule('perSourceType', 3),
      );
    }
    expect(subject.statuses.length).toBe(1);

    applyStatus(
      subject,
      status({ sourceId: 4, sourceDefId: 'sporecrown' }),
      rule('perSourceType', 3),
    );
    expect(subject.statuses.length).toBe(2);
  });

  it('refreshes the stack closest to expiring rather than exceeding the cap', () => {
    const subject = body();
    applyStatus(subject, status({ sourceId: 1, ticksLeft: 3 }), rule('any', 2));
    applyStatus(subject, status({ sourceId: 2, ticksLeft: 40 }), rule('any', 2));
    applyStatus(subject, status({ sourceId: 3, ticksLeft: 60 }), rule('any', 2));

    expect(subject.statuses.length).toBe(2);
    // The three-tick one was topped up, not left to die while a third waited.
    expect(Math.min(...subject.statuses.map((s) => s.ticksLeft))).toBe(40);
  });

  it('compounds percentages instead of adding them, so no slow reaches zero', () => {
    const subject = body();
    for (let i = 0; i < 6; i++) {
      applyStatus(subject, status({ sourceId: i, amount: -0.2 }), rule('any', 6));
    }
    // 0.8^6, not 1 - 6*0.2, which would be negative.
    expect(modifiersOf(subject).moveSpeedMul).toBeCloseTo(0.8 ** 6, 6);
    expect(modifiersOf(subject).moveSpeedMul).toBeGreaterThan(0);
  });
});

describe('crowd control cannot be held forever (§18)', () => {
  const scale = data.abilities.control.scale;

  it('halves each successive hold inside the window', () => {
    const subject = body();
    const seen: number[] = [];
    for (let i = 0; i < scale.length; i++) {
      seen.push(controlScale(subject, scale));
      noteControl(subject, scale, 160, 100);
    }
    expect(seen).toEqual([...scale]);
  });

  it('makes the body immune once the ladder is spent', () => {
    const subject = body();
    for (let i = 0; i < scale.length; i++) noteControl(subject, scale, 160, 100);
    expect(subject.controlImmuneLeft).toBe(100);
  });

  it('resets the ladder when the window closes quietly', () => {
    const subject = body();
    noteControl(subject, scale, 3, 100);
    expect(controlScale(subject, scale)).toBe(scale[1]);
    for (let t = 0; t < 3; t++) tickStatuses(subject);
    expect(controlScale(subject, scale)).toBe(scale[0]);
  });
});

describe('wards', () => {
  it('eats exactly one attack and then is gone', () => {
    const subject = body();
    applyStatus(
      subject,
      status({ kind: 'shield', stat: null, blocks: 1, ticksLeft: 100 }),
      rule('any', 1),
    );
    expect(consumeShield(subject)).toBe(true);
    expect(consumeShield(subject)).toBe(false);
    expect(subject.statuses.length).toBe(0);
  });
});

describe('clocks', () => {
  it('drops a status on the tick its duration runs out', () => {
    const subject = body();
    applyStatus(subject, status({ ticksLeft: 3 }), rule('any', 1));
    for (let t = 0; t < 2; t++) tickStatuses(subject);
    expect(subject.statuses.length).toBe(1);
    tickStatuses(subject);
    expect(subject.statuses.length).toBe(0);
  });

  it('keeps a zero-duration status, which is how a passive is modelled', () => {
    const subject = body();
    applyStatus(subject, status({ ticksLeft: 0 }), rule('any', 1));
    for (let t = 0; t < 50; t++) tickStatuses(subject);
    expect(subject.statuses.length).toBe(1);
  });
});

// ------------------------------------------------------------- the integration

function match(builderId: string): { state: MatchState; ctx: SimContext } {
  const state = createMatch(data, {
    seed: 11,
    teams: [{ id: 'lane1', playerIds: ['p1'], builderId }],
  });
  const ctx = createContext(data);
  const lane = state.lanes.lane1!;
  lane.economy.gold = 1_000_000;
  lane.economy.supplyCap = 999;
  lane.fortress.maxHp = Number.MAX_SAFE_INTEGER;
  lane.fortress.hp = lane.fortress.maxHp;
  return { state, ctx };
}

function place(ctx: SimContext, state: MatchState, unitDefId: string, tileX: number, tileY = 0) {
  applyCommand(ctx, state, { kind: 'placeUnit', teamId: 'lane1', unitDefId, tileX, tileY });
}

function toCombat(ctx: SimContext, state: MatchState): void {
  let guard = 0;
  while (state.phase !== 'combat' && guard++ < 5000) step(ctx, state);
}

describe('a real roster applies its real abilities', () => {
  it('sets a wave alight (Pyre: Kindle)', () => {
    const { state, ctx } = match('pyre');
    // A row of Embers across the front, so something is in reach quickly.
    for (let x = 0; x < 8; x++) place(ctx, state, 'ember', x, 0);
    toCombat(ctx, state);

    const lane = state.lanes.lane1!;
    let burning = 0;
    for (let t = 0; t < 400; t++) {
      step(ctx, state);
      burning = Math.max(
        burning,
        lane.monsters.filter((m) => m.statuses.some((s) => s.tag === 'burning')).length,
      );
    }
    expect(burning).toBeGreaterThan(0);
  });

  it('slows a wave down (Thornweald: Rootbite)', () => {
    const { state, ctx } = match('thornweald');
    for (let x = 0; x < 8; x++) place(ctx, state, 'thornling', x, 0);
    toCombat(ctx, state);

    const lane = state.lanes.lane1!;
    let slowed = false;
    for (let t = 0; t < 400 && !slowed; t++) {
      step(ctx, state);
      slowed = lane.monsters.some((m) => modifiersOf(m).moveSpeedMul < 1);
    }
    expect(slowed).toBe(true);
  });

  it('drags a wave onto the tank (Ironvow: Hold the Line)', () => {
    const { state, ctx } = match('ironvow');
    // One Oathwall, and a Judgement behind it that a monster would rather eat.
    place(ctx, state, 'oathwall', 4, 1);
    place(ctx, state, 'judgement', 4, 0);
    toCombat(ctx, state);

    const lane = state.lanes.lane1!;
    const wall = lane.units.find((u) => u.defId === 'oathwall')!;
    let taunted = false;
    for (let t = 0; t < 600 && !taunted; t++) {
      step(ctx, state);
      taunted = lane.monsters.some((m) => m.statuses.some((s) => s.control === 'taunt'));
    }
    expect(taunted).toBe(true);
    expect(lane.monsters.some((m) => m.targetId === wall.id)).toBe(true);
  });

  it('spends energy on the abilities that cost it, and fills it back up', () => {
    const { state, ctx } = match('ironvow');
    // Sanction III's Interdict is energy-gated; the unit starts full.
    place(ctx, state, 'sanction_3', 4, 2);
    toCombat(ctx, state);

    const unit = state.lanes.lane1!.units[0]!;
    const full = unit.energy;
    let spent = full;
    for (let t = 0; t < 600; t++) {
      step(ctx, state);
      spent = Math.min(spent, unit.energy);
    }
    expect(full).toBe(data.abilities.energy.max);
    expect(spent).toBeLessThan(full);
    // And it recovers: an energy ability is a rhythm, not one use per match.
    expect(unit.energy).toBeGreaterThan(0);
  });

  it('spends none of it during a build phase', () => {
    // Everything a unit could spend energy on while building is spent on
    // nothing - Absolution cleansing allies nobody has stunned, Closing Ranks
    // buffing a line with thirty seconds to stand in - and the unit then meets
    // the wave with a part-empty pool.
    const { state, ctx } = match('ironvow');
    // Two whose energy abilities target ALLIES, so they have something to aim
    // at during a build phase and would otherwise fire at it.
    place(ctx, state, 'vigil_3', 3, 2);
    place(ctx, state, 'pledge_3', 4, 2);

    const units = state.lanes.lane1!.units;
    const full = data.abilities.energy.max;
    for (let t = 0; t < 400 && state.phase === 'build'; t++) {
      step(ctx, state);
      for (const unit of units) expect(unit.energy, unit.defId).toBe(full);
    }
    // And the build phase really did run long enough to have fired them.
    expect(state.tick).toBeGreaterThan(100);
  });

  it('opens every wave with a full pool, however the last one went', () => {
    const { state, ctx } = match('ironvow');
    place(ctx, state, 'sanction_3', 4, 2);
    toCombat(ctx, state);

    const unit = state.lanes.lane1!.units[0]!;
    let guard = 0;
    while (unit.energy === data.abilities.energy.max && guard++ < 2000) step(ctx, state);
    expect(unit.energy, 'it spent some during the fight').toBeLessThan(data.abilities.energy.max!);

    // A pool that carried over would make the wave after a long fight quietly
    // weaker than the one after a short fight, for a reason nobody can see.
    while (state.phase !== 'build' && guard++ < 20000) step(ctx, state);
    expect(state.phase).toBe('build');
    expect(unit.energy).toBe(data.abilities.energy.max);
  });

  it('opens the Final Showdown with a full pool too', () => {
    // Same reason as the full HP the transplant already restores: the showdown
    // is the fight the whole match was for, and opening it with one army's
    // mark-3 abilities half-charged decides it on how wave 25 happened to end.
    const { state, ctx } = match('ironvow');
    place(ctx, state, 'sanction_3', 4, 2);
    const unit = state.lanes.lane1!.units[0]!;
    unit.energy = 3;

    beginShowdown(ctx, state);
    expect(state.showdown!.armies[0]!.units[0]!.energy).toBe(data.abilities.energy.max);
  });

  it('makes a monster with spell immunity untouchable by abilities', () => {
    const { state, ctx } = match('thornweald');
    for (let x = 0; x < 8; x++) place(ctx, state, 'thornling', x, 0);
    toCombat(ctx, state);

    const lane = state.lanes.lane1!;
    // Revenants are Unhallowed: nothing an ability does may reach them.
    lane.incomingSends.push({ defId: 'revenant', fromTeamId: 'lane1', sendId: 'revenant' });
    for (let t = 0; t < 900; t++) {
      step(ctx, state);
      for (const monster of lane.monsters) {
        if (monster.defId !== 'revenant') continue;
        // Its own passive immunity is the only status it may carry.
        const fromOthers = monster.statuses.filter((s) => s.sourceId !== monster.id);
        expect(fromOthers).toEqual([]);
      }
    }
  });

  it('closes the worst wound in reach, and grows with its patient (Mender: Mend)', () => {
    const { state, ctx } = match('ironvow');
    toCombat(ctx, state);
    const lane = state.lanes.lane1!;
    lane.monsters.length = 0;
    lane.reserve.length = 0;

    // Two grubs and a Mender standing together at the spawn, far from anything
    // that could hurt them. The wounded one is the one it must pick.
    const at = (x: number) => ({ x, y: -1.5 });
    const spawn = (defId: string, x: number) => {
      const m = createMonster(state, data, ctx.defs, { defId, waveNumber: 5 }, at(x))!;
      m.moveSpeed = 0;
      lane.monsters.push(m);
      return m;
    };
    const mender = spawn('mender', 3);
    const wounded = spawn('grub', 4);
    const whole = spawn('grub', 5);
    wounded.hp = wounded.maxHp * 0.2;
    whole.hp = whole.maxHp * 0.9;

    const mend = data.abilities.abilities.find((a) => a.id === 'mend')!;
    const share = Number(mend.numbers!.share);
    const before = wounded.hp;
    for (let t = 0; t < 10 * TICKS_PER_SECOND && wounded.hp === before; t++) {
      step(ctx, state);
      for (const m of lane.monsters) m.pos = m === mender ? at(3) : m === wounded ? at(4) : at(5);
    }
    // One heal, of a share of the PATIENT's maximum - which at wave 5 is not
    // the grub in monsters.json, so a flat number would have shown up here.
    expect(wounded.hp - before).toBeCloseTo(wounded.maxHp * share, 5);
    expect(wounded.maxHp).toBeGreaterThan(data.monsters.monsters.find((m) => m.id === 'grub')!.hp!);
    expect(whole.hp).toBeCloseTo(whole.maxHp * 0.9, 5);
  });

  it('gives a send its own abilities, on top of the monster it delivers', () => {
    // A line strong enough to clear its waves, because a send joins the NEXT
    // wave (§11.5) and a lane that never clears never gets one.
    const { state, ctx } = match('ironvow');
    for (let x = 0; x < 8; x++) {
      place(ctx, state, 'pledge', x, 0);
      place(ctx, state, 'pledge', x, 1);
    }
    toCombat(ctx, state);

    const lane = state.lanes.lane1!;
    lane.incomingSends.push({ defId: 'husk', fromTeamId: 'lane1', sendId: 'husk' });

    let arrived = false;
    let braced = false;
    for (let t = 0; t < 4000 && !braced; t++) {
      step(ctx, state);
      for (const monster of lane.monsters) {
        if (monster.sendId !== 'husk') continue;
        arrived = true;
        // A husk that walked in with a wave has nothing. This one was paid
        // for, so it arrives braced - and the ability is the SEND's, not a
        // second husk definition's.
        if (monster.statuses.some((s) => s.abilityId === 'siegework')) braced = true;
      }
    }
    expect(arrived, 'the paid husk reached the lane').toBe(true);
    expect(braced, 'and arrived braced').toBe(true);
  });
});

describe('determinism survives the rolls abilities make (§15.1)', () => {
  it('runs the same match twice to the same state', () => {
    const play = () => {
      const { state, ctx } = match('pyre');
      for (let x = 0; x < 8; x++) place(ctx, state, 'scoria', x, 5);
      toCombat(ctx, state);
      for (let t = 0; t < 600; t++) step(ctx, state);
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });

  it("threads every roll through the match's own generator", () => {
    // A roll taken from anywhere else would leave `rngState` untouched, and
    // two clients would then disagree about who critted.
    const { state, ctx } = match('pyre');
    for (let x = 0; x < 8; x++) place(ctx, state, 'scoria', x, 5);
    toCombat(ctx, state);
    const before = state.rngState;
    for (let t = 0; t < 200; t++) step(ctx, state);
    expect(state.rngState).not.toBe(before);
  });
});

describe('dampening reaches what the showdown needs it to (§3.3, replaced)', () => {
  const config = data.waves.showdown.dampening;

  it('leaves healing alone during the grace period and then fades it', () => {
    expect(dampeningRemaining(config, 0)).toBe(1);
    expect(dampeningRemaining(config, config.graceSeconds * TICKS_PER_SECOND)).toBe(1);
    const later = dampeningRemaining(config, (config.graceSeconds + 30) * TICKS_PER_SECOND);
    expect(later).toBeLessThan(1);
    expect(later).toBeGreaterThan(0);
  });

  it('reaches zero rather than approaching it', () => {
    const forever = dampeningRemaining(config, (config.graceSeconds + 500) * TICKS_PER_SECOND);
    expect(forever).toBe(0);
  });
});

describe('the roster design rules, in the data', () => {
  it('gives every unit an ability', () => {
    for (const unit of data.units.units) {
      expect(unit.abilities?.length ?? 0, unit.id).toBeGreaterThan(0);
    }
  });

  it('raises the signature ability with the mark rather than restating it', () => {
    for (const unit of data.units.units) {
      if (unit.mark === 1) continue;
      const base = data.units.units.find((u) => u.upgradesTo === unit.id);
      if (!base) continue;
      const signature = refId((base.abilities ?? [])[0]!);
      const carried = (unit.abilities ?? []).find((ref) => refId(ref) === signature);
      expect(carried, `${unit.id} keeps ${signature}`).toBeDefined();
      expect(refRank(carried!), `${unit.id} rank`).toBe(unit.mark);
    }
  });

  it('unlocks a second ability at the top of every ladder', () => {
    const tops = data.units.units.filter((u) => !u.upgradesTo);
    for (const top of tops) {
      expect((top.abilities ?? []).length, `${top.id} at the top of its ladder`).toBe(2);
    }
  });

  /**
   * Energy gates the abilities that nothing else gates.
   *
   * An ability on an INTERVAL fires on its own clock and would otherwise fire
   * for ever, so it spends a pool that has to refill. A reactive one - a
   * deathrattle, a riposte, a passive, a thing that happens when the body drops
   * below half - is already limited by the event that sets it off, and charging
   * it energy would mean a deathrattle that fizzles when the corpse is poor.
   *
   * A SIGNATURE is exempt whichever way it fires: it is what the unit is, it is
   * there from Mark I, and a taunt the Oathwall can only afford sometimes is
   * not an Oathwall. The gate is on the SECOND ability, the one the top of the
   * ladder unlocks.
   *
   * The rule used to be stated as "a three-mark unit's second ability", which
   * was true only because the ten lines that reached Mark III happened to be
   * the ten whose second ability is on a clock. Completing the ladder made all
   * twenty-four reach it and showed that the shape of the trigger was the
   * actual rule - and that `deepcall` had been summoning on a timer for free.
   */
  it('makes a second ability that fires on its own clock spend energy', () => {
    const byId = new Map<string, AbilityDef>(data.abilities.abilities.map((a) => [a.id, a]));
    const tops = data.units.units.filter((u) => !u.upgradesTo);
    expect(tops).toHaveLength(24);

    for (const top of tops) {
      const second = (top.abilities ?? [])[1]!;
      const ability = byId.get(refId(second))!;
      const onAClock = ability.trigger?.when === 'interval';
      const cost = ability.energyCost ?? 0;
      if (onAClock) {
        expect(
          cost,
          `${top.id} → ${ability.id} fires on a clock, so it costs energy`,
        ).toBeGreaterThan(0);
      } else {
        expect(cost, `${top.id} → ${ability.id} is reactive, so it costs none`).toBe(0);
      }
    }
  });

  it('leaves some monsters ordinary', () => {
    const plain = data.monsters.monsters.filter((m) => !m.abilities?.length);
    expect(plain.length).toBeGreaterThan(0);
    // And gives every boss something, because a boss with nothing is a big grub.
    for (const boss of data.monsters.bosses) {
      expect(boss.abilities?.length ?? 0, boss.id).toBeGreaterThan(0);
    }
  });

  it('has each builder apply and then exploit its own tag', () => {
    for (const [builderId, tag] of [
      ['pyre', 'burning'],
      ['thornweald', 'blighted'],
      ['gloomtide', 'soaked'],
    ] as const) {
      const ids = new Set(
        data.units.units
          .filter((u) => u.builderId === builderId)
          .flatMap((u) => (u.abilities ?? []).map(refId)),
      );
      const abilities = data.abilities.abilities.filter((a) => ids.has(a.id));
      const applies = abilities.filter((a) => a.effects.some((e) => e.appliesTag === tag));
      const exploits = abilities.filter(
        (a) => a.target.requiresTag === tag || a.effects.some((e) => e.bonusIfTag?.tag === tag),
      );
      expect(applies.length, `${builderId} applies ${tag}`).toBeGreaterThan(0);
      expect(exploits.length, `${builderId} exploits ${tag}`).toBeGreaterThan(0);
    }
  });
});

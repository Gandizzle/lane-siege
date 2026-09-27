/**
 * Which statuses a player can see, and as what (statusMarks.ts). The rule
 * worth pinning is the exclusion: a body's own passive is a trait, not an
 * event, and marking it would badge every Carapace on the board forever.
 */

import { describe, expect, it } from 'vitest';
import { hasMark, markBit, markOf, statusMarks, STATUS_MARKS } from './statusMarks.ts';
import type { Afflicted, Status } from './status.ts';

function status(overrides: Partial<Status>): Status {
  return {
    abilityId: 'test',
    slot: 0,
    kind: 'modify',
    stat: null,
    mode: 'percent',
    amount: 0,
    perSecond: 0,
    ofMaxHealth: 0,
    damageType: null,
    blocks: 0,
    control: null,
    immuneTo: null,
    tag: null,
    ticksLeft: 60,
    sourceId: 99,
    sourceDefId: 'someone',
    ...overrides,
  };
}

function body(statuses: Status[], id = 1): Afflicted {
  return {
    id,
    defId: 'body',
    hp: 100,
    maxHp: 100,
    baseMaxHp: 100,
    spawnFired: true,
    statuses,
    energy: 0,
    clocks: {},
    latched: [],
    controlUses: 0,
    controlWindowLeft: 0,
    controlImmuneLeft: 0,
  };
}

describe('what each status shows as', () => {
  it('tells a burn from any other damage over time', () => {
    expect(markOf(status({ kind: 'damageOverTime', damageType: 'blast' }))).toBe('burning');
    expect(markOf(status({ kind: 'damageOverTime', damageType: 'arcane', tag: 'burning' }))).toBe(
      'burning',
    );
    expect(markOf(status({ kind: 'damageOverTime', damageType: 'arcane' }))).toBe('blighted');
  });

  it('reads a stat change by which way it moves the number', () => {
    const modify = (stat: Status['stat'], amount: number) =>
      markOf(status({ kind: 'modify', stat, amount }));
    expect(modify('moveSpeed', -0.3)).toBe('slowed');
    expect(modify('attackSpeed', -0.2)).toBe('slowed');
    expect(modify('attackSpeed', 0.2)).toBe('empowered');
    expect(modify('damageDealt', 0.25)).toBe('empowered');
    expect(modify('damageDealt', -0.25)).toBe('weakened');
    expect(modify('damageTaken', 0.2)).toBe('weakened');
    expect(modify('damageTaken', -0.2)).toBe('fortified');
    expect(modify('healingTaken', -0.5)).toBe('weakened');
    expect(modify('evasion', 0.1)).toBe('fortified');
    expect(modify('moveSpeed', 0)).toBeNull();
  });

  it('names each kind of control, and shows a spent ward as nothing', () => {
    expect(markOf(status({ kind: 'control', control: 'root' }))).toBe('rooted');
    expect(markOf(status({ kind: 'control', control: 'stun' }))).toBe('stunned');
    expect(markOf(status({ kind: 'control', control: 'taunt' }))).toBe('taunted');
    expect(markOf(status({ kind: 'shield', blocks: 2 }))).toBe('shielded');
    expect(markOf(status({ kind: 'shield', blocks: 0 }))).toBeNull();
    expect(markOf(status({ kind: 'regen' }))).toBe('regenerating');
    expect(markOf(status({ kind: 'immunity', immuneTo: 'control' }))).toBe('fortified');
  });

  it('gives every kind its own bit', () => {
    const bits = STATUS_MARKS.map(markBit);
    expect(new Set(bits).size).toBe(STATUS_MARKS.length);
    for (const bit of bits) expect(bit & (bit - 1)).toBe(0);
  });
});

describe('what a body shows', () => {
  const passives = new Set(['plated_shell', 'shoulder_to_shoulder']);
  const isPassive = (id: string) => passives.has(id);

  it('leaves out a passive the body puts on itself', () => {
    const shell = status({
      abilityId: 'plated_shell',
      stat: 'damageTaken',
      amount: -0.3,
      sourceId: 1,
      ticksLeft: 2,
    });
    expect(statusMarks(body([shell]), isPassive)).toBe(0);
  });

  it('keeps the same passive when it reaches the body from a neighbour', () => {
    const aura = status({
      abilityId: 'shoulder_to_shoulder',
      stat: 'damageDealt',
      amount: 0.2,
      sourceId: 7,
      ticksLeft: 2,
    });
    expect(hasMark(statusMarks(body([aura]), isPassive), 'empowered')).toBe(true);
  });

  it('keeps a triggered effect the body gave itself, because that is an event', () => {
    const stoke = status({ abilityId: 'stoke', stat: 'attackSpeed', amount: 0.3, sourceId: 1 });
    expect(hasMark(statusMarks(body([stoke]), isPassive), 'empowered')).toBe(true);
  });

  it('adds several kinds together, one bit each however many stack', () => {
    const marks = statusMarks(
      body([
        status({ kind: 'damageOverTime', damageType: 'blast' }),
        status({ kind: 'damageOverTime', damageType: 'blast', slot: 1 }),
        status({ stat: 'moveSpeed', amount: -0.3 }),
      ]),
      isPassive,
    );
    expect(marks).toBe(markBit('burning') | markBit('slowed'));
  });
});

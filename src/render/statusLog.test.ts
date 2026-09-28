/**
 * The legend lists what has been on screen lately, on whom, newest first
 * (statusLog.ts).
 */

import { describe, expect, it } from 'vitest';
import { markBit, type EntityView, type LaneView } from '../sim/index.ts';
import { RECENT_SECONDS, StatusLog } from './statusLog.ts';

function body(id: number, statusMarks: number): EntityView {
  return {
    id,
    defId: 'x',
    x: 0,
    y: 0,
    radius: 0.2,
    armour: 'flesh',
    damageType: 'impact',
    hpFraction: 1,
    statusMarks,
  };
}

function board(units: number[], monsters: number[]): LaneView {
  return {
    teamId: 'lane1',
    builderId: 'pyre',
    units: units.map((m, i) => body(i + 1, m)),
    monsters: monsters.map((m, i) => body(i + 100, m)),
    fortress: {
      hp: 1,
      maxHp: 1,
      destroyed: false,
      weaponDamageType: 'impact',
      activeAura: null,
      auraRadius: 0,
      auraStrength: 0,
    },
    economy: null,
    reserveCount: 0,
    sendLog: [],
    attacks: [],
    unitSpend: [],
    unitDamage: [],
  };
}

describe('the log of markers seen', () => {
  it('lists what is on screen now first, then the rest newest first', () => {
    const log = new StatusLog();
    log.observe(board([], [markBit('slowed')]), 1);
    log.observe(board([], [markBit('burning')]), 5);
    log.observe(board([markBit('empowered')], []), 9);
    const recent = log.recent(9);
    expect(recent.map((s) => s.mark)).toEqual(['empowered', 'burning', 'slowed']);
    expect(recent[0]).toMatchObject({ now: true, ago: 0, onUnits: true, onMonsters: false });
    expect(recent[1]).toMatchObject({ now: false, ago: 4, onUnits: false, onMonsters: true });
  });

  it('says whether it was on units, monsters, or both', () => {
    const log = new StatusLog();
    log.observe(board([markBit('slowed')], [markBit('slowed')]), 2);
    expect(log.recent(2)[0]).toMatchObject({ onUnits: true, onMonsters: true });
  });

  it('forgets a marker once it has been gone for the window', () => {
    const log = new StatusLog();
    log.observe(board([], [markBit('rooted')]), 0);
    log.observe(board([], []), 1);
    expect(log.recent(RECENT_SECONDS).map((s) => s.mark)).toEqual(['rooted']);
    expect(log.recent(RECENT_SECONDS + 1.5)).toEqual([]);
  });

  it('raises the new-marker dot for a kind not yet read, and only once', () => {
    const log = new StatusLog();
    expect(log.hasUnread).toBe(false);
    log.observe(board([], [markBit('stunned')]), 1);
    expect(log.hasUnread).toBe(true);
    log.markRead();
    log.observe(board([], [markBit('stunned')]), 2);
    expect(log.hasUnread).toBe(false);
    log.observe(board([markBit('shielded')], []), 3);
    expect(log.hasUnread).toBe(true);
    expect(log.latest(3)).toBe('shielded');
  });

  it('starts empty for a new match', () => {
    const log = new StatusLog();
    log.observe(board([], [markBit('burning')]), 1);
    log.reset();
    expect(log.recent(1)).toEqual([]);
    expect(log.latest(1)).toBeNull();
    expect(log.hasUnread).toBe(false);
  });
});

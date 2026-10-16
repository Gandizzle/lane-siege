/**
 * The XP popup's timeline (xpReport.ts): lines arrive in turn and count up,
 * the total after them, and the bar climbs from the old XP to the new, never
 * backwards, through every level in between.
 */

import { describe, expect, it } from 'vitest';
import { levelOf } from '../../progression/levels.ts';
import type { AwardResult } from '../../progression/store.ts';
import { planReport, reportFrame } from './xpReport.ts';

const curve = { first: 300, step: 100 };

function result(fromXp: number, lines: number[], boosts: number[] = []): AwardResult {
  const total = [...lines, ...boosts].reduce((a, b) => a + b, 0);
  return {
    award: {
      lines: lines.map((xp, i) => ({ id: 'played', label: `line ${i}`, xp })),
      boosts: boosts.map((xp) => ({ id: 'adBoost', label: 'Boost', xp })),
      base: lines.reduce((a, b) => a + b, 0),
      total,
      note: null,
    },
    before: levelOf(fromXp, curve),
    after: levelOf(fromXp + total, curve),
  };
}

describe('the XP popup', () => {
  it('starts empty and ends with everything counted', () => {
    const plan = planReport(result(250, [100, 200, 150], [450]));
    const start = reportFrame(plan, 0);
    expect(start.lines.every((l) => !l.shown)).toBe(true);
    expect(start.total.shown).toBe(false);
    expect(start.barXp).toBe(250);
    expect(start.done).toBe(false);

    const end = reportFrame(plan, plan.endAt);
    expect(end.lines.map((l) => l.value)).toEqual([100, 200, 150, 450]);
    expect(end.total).toEqual({ shown: true, value: 900 });
    expect(end.barXp).toBe(1150);
    expect(end.done).toBe(true);
  });

  it('brings the lines in one at a time, the total after them', () => {
    const plan = planReport(result(0, [100, 200, 150]));
    let shown = 0;
    for (let ms = 0; ms <= plan.endAt; ms += 10) {
      const frame = reportFrame(plan, ms);
      const now = frame.lines.filter((l) => l.shown).length;
      expect(now).toBeGreaterThanOrEqual(shown);
      shown = now;
      if (frame.total.shown) expect(now).toBe(3);
    }
  });

  it('climbs the bar forwards only, and takes longer for more levels', () => {
    const one = planReport(result(0, [100]));
    const many = planReport(result(0, [2000]));
    expect(many.barMs).toBeGreaterThan(one.barMs);
    let last = -1;
    for (let ms = 0; ms <= many.endAt; ms += 16) {
      const xp = reportFrame(many, ms).barXp;
      expect(xp).toBeGreaterThanOrEqual(last);
      last = xp;
    }
    expect(last).toBe(2000);
  });

  it('has nothing to climb when nothing was earned', () => {
    const plan = planReport(result(500, []));
    expect(plan.barMs).toBe(0);
    expect(reportFrame(plan, plan.endAt).barXp).toBe(500);
  });
});

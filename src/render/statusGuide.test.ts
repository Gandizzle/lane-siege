/**
 * The effects guide: every kind of marker has what it needs to be shown, and
 * what causes each is read from the data, so neither can fall behind the game
 * (statusGuide.ts, statusMarks.ts).
 */

import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { refId, resolveAbility } from '../data/schema.ts';
import { STATUS_MARKS, markBit, markOfEffect } from '../sim/index.ts';
import { causesByMark, marksOf } from './statusGuide.ts';
import { MARK_INFO } from './statusMarks.ts';

const { data } = loadDataFromDisk();

describe('every kind of marker can be shown', () => {
  it('has a name, a summary, a description and a color', () => {
    const names = new Set<string>();
    for (const mark of STATUS_MARKS) {
      const info = MARK_INFO[mark];
      expect(info.name.length, mark).toBeGreaterThan(0);
      expect(info.summary.length, mark).toBeGreaterThan(0);
      expect(info.description.length, mark).toBeGreaterThan(info.summary.length);
      names.add(info.name);
    }
    expect(names.size, 'no two kinds share a name').toBe(STATUS_MARKS.length);
  });

  it('draws something, on its own, for every kind', () => {
    for (const mark of STATUS_MARKS) {
      const g = new Graphics();
      MARK_INFO[mark].draw(g, { cx: 50, cy: 50, radius: 12, marks: markBit(mark), seed: 1 }, 0.4);
      expect(g.context.instructions.length, mark).toBeGreaterThan(0);
    }
  });
});

describe('what causes each marker', () => {
  const causes = causesByMark(data);

  it('names an ability under its marker, with who carries it', () => {
    expect(causes.burning).toContainEqual({ ability: 'Kindle', owners: ['Ember (Pyre)'] });
    // Only the top of the line has it, so the line is named at that mark.
    expect(causes.burning).toContainEqual({
      ability: 'Conflagration',
      owners: ['Ultra Ember (Pyre)'],
    });
    expect(causes.stunned.some((c) => c.owners.some((o) => o.endsWith('(boss)')))).toBe(true);
  });

  it('leaves out a passive that only ever lands on its own carrier', () => {
    const listed = STATUS_MARKS.flatMap((m) => causes[m].map((c) => c.ability));
    expect(listed).not.toContain('Plated Shell');
    expect(listed).not.toContain('Parry');
    // The same kind of passive reaching OTHER bodies is listed.
    expect(causes.empowered.map((c) => c.ability)).toContain('Shoulder to Shoulder');
  });

  it('lists every carried ability that leaves a marker, under the marker it leaves', () => {
    const carried = new Set([
      ...data.units.units.flatMap((u) => (u.abilities ?? []).map(refId)),
      ...data.monsters.monsters.flatMap((m) => (m.abilities ?? []).map(refId)),
      ...data.monsters.bosses.flatMap((m) => (m.abilities ?? []).map(refId)),
      ...data.sends.sends.flatMap((s) => (s.abilities ?? []).map(refId)),
    ]);
    for (const def of data.abilities.abilities) {
      if (!carried.has(def.id)) continue;
      for (const mark of marksOf(def)) {
        expect(
          causes[mark].map((c) => c.ability),
          `${def.id} under ${mark}`,
        ).toContain(def.name);
      }
      // And the guide agrees with the board: the same rule sorts both.
      const ability = resolveAbility(def, 1);
      if (!(ability.trigger.when === 'passive' && ability.target.what === 'self')) {
        for (const effect of ability.effects) {
          const mark = markOfEffect(effect);
          if (mark) expect(marksOf(def), def.id).toContain(mark);
        }
      }
    }
  });
});

/**
 * The wave-cleared card (waveCleared.ts): when it opens, and what it says -
 * the gold and kills the wave paid, what the fortress's kills cost, and who is
 * still fighting.
 */

import { describe, expect, it } from 'vitest';
import type { LaneView, MatchView, OpponentView } from '../../sim/index.ts';
import { clearedLines, justCleared, laneIsClear } from './waveCleared.ts';

function opponent(teamId: string, name: string, fighting: boolean, eliminated = false) {
  return { teamId, name, fighting, eliminated } as OpponentView;
}

function view(over: Partial<MatchView> = {}, laneOver: Partial<LaneView> = {}): MatchView {
  return {
    phase: 'combat',
    wave: 4,
    eliminated: false,
    solo: null,
    opponents: [
      opponent('lane2', 'Rookie', true),
      opponent('lane3', '', true),
      opponent('lane4', 'Warden', false),
    ],
    lane: {
      monsters: [],
      reserveCount: 0,
      fortress: { destroyed: false },
      economy: { waveTally: { kills: 24, fortressKills: 2, bounty: 38.4, missed: 6.2 } },
      ...laneOver,
    } as LaneView,
    ...over,
  } as MatchView;
}

describe('the wave-cleared card', () => {
  it('says what the wave paid and who is still fighting', () => {
    const lines = clearedLines(view(), 4);
    expect(lines.title).toBe('Wave 4 cleared!');
    expect(lines.earned).toBe('+{gold}38 from 24 kills');
    expect(lines.wall).toBe('2 finished by your fortress: 6 gold lost');
    // A lane nobody named is called what its tab calls it.
    expect(lines.waiting).toBe('Still fighting: Rookie, Lane 3');
  });

  it('says nothing about the fortress when it made no kills', () => {
    const quiet = view({}, {
      economy: { waveTally: { kills: 1, fortressKills: 0, bounty: 8, missed: 0 } },
    } as Partial<LaneView>);
    const lines = clearedLines(quiet, 4);
    expect(lines.wall).toBe('');
    expect(lines.earned).toBe('+{gold}8 from 1 kill');
  });

  it('says everyone is through when nobody is left fighting, and nothing in solo', () => {
    const done = view({ opponents: [opponent('lane2', 'Rookie', false)] });
    expect(clearedLines(done, 4).waiting).toBe('Every lane is clear');
    expect(clearedLines(view({ opponents: [] }), 4).waiting).toBe('');
  });

  it('turns into the build clock once every lane is through', () => {
    // 20 ticks a second: 470 ticks is 23.5 seconds, said as 24.
    const building = view({ phase: 'build', phaseTicksLeft: 470 });
    expect(clearedLines(building, 4).waiting).toBe('24 seconds remaining to build. Build now!');
    const last = view({ phase: 'build', phaseTicksLeft: 15 });
    expect(clearedLines(last, 4).waiting).toBe('1 second remaining to build. Build now!');
    // Solo too: there is nobody to wait on, but there is still a clock.
    const solo = view({ phase: 'build', phaseTicksLeft: 200, opponents: [] });
    expect(clearedLines(solo, 4).waiting).toBe('10 seconds remaining to build. Build now!');
  });

  it('opens when the lane goes clear in combat, not before and not again', () => {
    const fighting = view({}, { monsters: [{}] } as Partial<LaneView>);
    expect(laneIsClear(fighting)).toBe(false);
    expect(justCleared(false, view())).toBe(true);
    expect(justCleared(true, view())).toBe(false);
  });

  it('never opens for a lane emptied by losing, between waves, or in the endless wave', () => {
    expect(laneIsClear(view({ eliminated: true }))).toBe(false);
    expect(laneIsClear(view({ phase: 'build' }))).toBe(false);
    expect(laneIsClear(view({}, { fortress: { destroyed: true } } as Partial<LaneView>))).toBe(
      false,
    );
    expect(laneIsClear(view({ solo: { kills: 0, endless: {} } } as Partial<MatchView>))).toBe(
      false,
    );
  });
});

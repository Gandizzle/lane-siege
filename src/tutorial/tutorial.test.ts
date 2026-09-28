/**
 * Every chapter, played to the end by a player who does what the coach says.
 *
 * The player here has no screen: it reads the step's target and does what a
 * tap on that target would do - selects the card, places on the row, submits
 * the purchase - against a real practice match. So a chapter that asks for
 * something the match will not allow (a unit it cannot afford, a tab that has
 * no such button, a wave that never ends) fails here rather than on a new
 * player's phone.
 */

import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import type { LocalTransport } from '../net/localTransport.ts';
import { hasMark, type MatchView } from '../sim/index.ts';
import { MS_PER_TICK } from '../util/loop.ts';
import { CHAPTERS, bestAgainstWave } from './chapters.ts';
import { sceneOf, tutorialMatch } from './match.ts';
import { TutorialRunner } from './runner.ts';
import type { Target, UiProbe } from './types.ts';

const { data } = loadDataFromDisk();

/** How long a `run` step may take before the chapter counts as stuck. */
const MAX_RUN_TICKS = 20 * 60 * 3;

class Player {
  readonly ui: UiProbe = {
    view: 'build',
    selection: null,
    abilityOpen: false,
    effectsOpen: false,
    watching: null,
  };

  constructor(private readonly transport: LocalTransport) {}

  get view(): MatchView {
    return this.transport.view()!;
  }

  /** Do what a tap on `target` does. */
  tap(target: Target): void {
    const teamId = this.transport.teamId;
    const lane = this.view.lane!;
    const selected =
      this.ui.selection?.kind === 'placedUnit' ? this.ui.selection.unitId : undefined;
    switch (target.kind) {
      case 'unitCard':
        this.ui.selection = { kind: 'unitDef', unitDefId: target.defId };
        this.ui.view = 'build';
        return;
      case 'gridRow': {
        if (this.ui.selection?.kind !== 'unitDef') throw new Error('placing with no card');
        // A line stands on its own tiles in the build phase.
        const taken = new Set(lane.units.map((u) => `${Math.floor(u.x)},${Math.floor(u.y)}`));
        for (let x = 0; x < data.lane.buildZone.width; x++) {
          if (taken.has(`${x},${target.row}`)) continue;
          this.transport.submit({
            kind: 'placeUnit',
            teamId,
            unitDefId: this.ui.selection.unitDefId,
            tileX: x,
            tileY: target.row,
          });
          return;
        }
        throw new Error(`row ${target.row} is full`);
      }
      case 'unit': {
        const unit = lane.units[target.index];
        if (!unit) throw new Error(`no unit ${target.index}`);
        this.ui.selection = { kind: 'placedUnit', unitId: unit.id };
        this.ui.view = 'unit';
        return;
      }
      case 'abilityChips':
        this.ui.abilityOpen = true;
        return;
      case 'upgrade':
        this.transport.submit({ kind: 'upgradeUnit', teamId, unitId: selected! });
        return;
      case 'sell':
        this.transport.submit({ kind: 'sellUnit', teamId, unitId: selected! });
        this.ui.selection = null;
        this.ui.view = 'build';
        return;
      case 'tab':
        this.ui.selection = null;
        this.ui.view = target.tab;
        return;
      case 'weapon':
        this.transport.submit({ kind: 'setWeaponType', teamId, damageType: target.damageType });
        return;
      case 'tech':
        this.transport.submit({ kind: 'buyTech', teamId, trackId: target.trackId });
        return;
      case 'send':
        this.transport.submit({
          kind: 'send',
          teamId,
          targetTeamId: this.view.opponents[0]!.teamId,
          sendId: target.sendId,
        });
        return;
      case 'legendButton':
        this.ui.effectsOpen = true;
        return;
      case 'opponentTab': {
        // Only a lane you have sight of opens (§12): the tab is a refusal otherwise.
        const opponent = this.view.opponents[target.index]!;
        expect(opponent.watching).toBe(true);
        this.ui.watching = opponent.teamId;
        return;
      }
      case 'watchBack':
        this.ui.watching = null;
        return;
      default:
        throw new Error(`nothing to tap at ${target.kind}`);
    }
  }

  /** A `free` step's way out: close whatever was opened. */
  dismiss(): void {
    this.ui.abilityOpen = false;
    this.ui.effectsOpen = false;
  }
}

/** Play `chapter` to the end; returns the match as it finished. */
function play(chapterIndex: number): { runner: TutorialRunner; view: MatchView } {
  const chapter = CHAPTERS[chapterIndex]!;
  const transport = tutorialMatch(data, chapter, 'Tester');
  const runner = new TutorialRunner(chapter, sceneOf(data, transport));
  const player = new Player(transport);
  runner.begin();

  let guard = 0;
  while (!runner.complete) {
    if (guard++ > 200) throw new Error(`${chapter.id} is stuck at step ${runner.stepIndex}`);
    const step = runner.step!;
    const at = runner.stepIndex;
    const target = runner.target(player.view, player.ui);
    // Every step says something, and a pointed-at target is one the player
    // can see on this board.
    expect(runner.text().length).toBeGreaterThan(10);
    if (target?.kind === 'unit') expect(player.view.lane!.units[target.index]).toBeDefined();
    if (target?.kind === 'monsterWith') {
      const marked = player.view.lane!.monsters.filter((m) =>
        hasMark(m.statusMarks ?? 0, target.mark),
      );
      expect(marked.length).toBeGreaterThan(0);
    }

    if (step.mode === 'next') {
      runner.next();
    } else if (step.run) {
      for (let tick = 0; tick < MAX_RUN_TICKS && runner.stepIndex === at; tick++) {
        transport.update(MS_PER_TICK);
        runner.update(player.view, player.ui, MS_PER_TICK / 1000);
      }
      if (runner.stepIndex === at) throw new Error(`${chapter.id} step ${at} never finished`);
      continue;
    } else if (step.mode === 'tap') {
      if (!target) throw new Error(`${chapter.id} step ${at} asks for a tap on nothing`);
      player.tap(target);
    } else {
      player.dismiss();
    }
    // A match that is held does not move while the player reads.
    if (runner.holds) {
      const before = player.view.tick;
      transport.update(0);
      expect(player.view.tick).toBe(before);
    }
    runner.update(player.view, player.ui, 0);
  }
  return { runner, view: player.view };
}

describe('the tutorial', () => {
  it('has chapters with distinct ids and something in each', () => {
    const ids = new Set(CHAPTERS.map((c) => c.id));
    expect(ids.size).toBe(CHAPTERS.length);
    for (const chapter of CHAPTERS) {
      expect(chapter.steps.length).toBeGreaterThan(3);
      expect(data.units.builders.some((b) => b.id === chapter.builderId)).toBe(true);
      // A step that waits on the player has to say what it is waiting for.
      for (const step of chapter.steps) {
        if (step.mode !== 'next') expect(step.done).toBeDefined();
      }
    }
  });

  for (const [index, chapter] of CHAPTERS.entries()) {
    it(`can be played through: ${chapter.title}`, () => {
      const { runner, view } = play(index);
      expect(runner.complete).toBe(true);
      expect(runner.holds).toBe(true);
      // Nobody lost a fortress being taught.
      expect(view.lane!.fortress.hp).toBeGreaterThan(0);
    });
  }

  it('fights its first wave and gets paid for it', () => {
    const { view } = play(CHAPTERS.findIndex((c) => c.id === 'build'));
    expect(view.wave).toBe(1);
    expect(view.phase).toBe('build');
    expect(view.lane!.units.length).toBe(4);
  });

  it('points the weapon at something that is not already the best choice', () => {
    const chapter = CHAPTERS.find((c) => c.id === 'counters')!;
    const transport = tutorialMatch(data, chapter, 'Tester');
    new TutorialRunner(chapter, sceneOf(data, transport)).begin();
    const view = transport.view()!;
    expect(view.lane!.fortress.weaponDamageType).not.toBe(bestAgainstWave(data, view));
  });

  it('shows an incoming send in the sends chapter', () => {
    const { view } = play(CHAPTERS.findIndex((c) => c.id === 'sends'));
    expect(view.lane!.economy!.passiveIncome).toBeGreaterThan(0);
    expect(view.lane!.sendLog.length).toBeGreaterThan(0);
  });
});

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
import { buildableUnits } from '../data/roster.ts';
import type { LocalTransport } from '../net/localTransport.ts';
import { hasMark, secondsToTicks, upgradeCooldownSeconds, type MatchView } from '../sim/index.ts';
import { MS_PER_TICK } from '../util/loop.ts';
import type { Features } from '../render/features.ts';
import { CHAPTERS, bestAgainstWave, stillFighting } from './chapters.ts';
import {
  LESSONS,
  SUPPLY_PRACTICE,
  SEND_START_GEMS,
  TIGHT_SUPPLY,
  lessonId,
  practiceIntro,
} from './lessons.ts';
import { practiceMatch, sceneOf, tutorialMatch } from './match.ts';
import { everyTypeExample } from '../render/laneView.ts';
import { TutorialRunner } from './runner.ts';
import type { Practice, Target, UiProbe } from './types.ts';

const { data } = loadDataFromDisk();

/** How long a `run` step may take before the chapter counts as stuck. */
const MAX_RUN_TICKS = 20 * 60 * 3;

/**
 * Whether `target` is on screen with only `features` open (render/features.ts):
 * a lesson that points at a tab it has not opened yet points at nothing.
 */
function reachable(target: Target, features: Features): boolean {
  switch (target.kind) {
    case 'tab':
      return features.tabs.includes(target.tab);
    case 'unitCard':
      return features.tabs.includes('build');
    case 'upgrade':
    case 'sell':
      return features.upgrades;
    case 'supplyCap':
      return features.tabs.includes('fort');
    case 'weapon':
      return features.tabs.includes('aura');
    case 'tech':
      return features.tabs.includes('tech');
    case 'send':
    case 'sendTargets':
      return features.tabs.includes('send');
    case 'hudIncome':
      return features.gems;
    default:
      return true;
  }
}

/** Everything `a` opens, `b` opens too. */
function within(a: Features, b: Features): boolean {
  return (
    a.tabs.every((tab) => b.tabs.includes(tab)) &&
    (!a.upgrades || b.upgrades) &&
    (a.fort === 'supply' || b.fort === 'all') &&
    (!a.gems || b.gems)
  );
}

const practices = LESSONS.flatMap((l) => (l.kind === 'practice' ? [l.practice] : []));

function practice(id: string): Practice {
  return practices.find((p) => p.id === id)!;
}

class Player {
  readonly ui: UiProbe = {
    view: 'build',
    selection: null,
    abilityOpen: false,
    effectsOpen: false,
    chartOpen: false,
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
        // Counted the way the tabs show them (opponentTabs.ts). Only a lane you
        // have sight of opens (§12): the tab is a refusal otherwise.
        const ordered = [...this.view.opponents].sort((a, b) => a.teamId.localeCompare(b.teamId));
        const opponent = ordered[target.index]!;
        expect(opponent.watching).toBe(true);
        this.ui.watching = opponent.teamId;
        return;
      }
      case 'watchBack':
        this.ui.watching = null;
        return;
      case 'supplyCap':
        this.transport.submit({ kind: 'buySupply', teamId });
        return;
      default:
        throw new Error(`nothing to tap at ${target.kind}`);
    }
  }

  /** A `free` step's way out: close whatever was opened. */
  dismiss(): void {
    this.ui.abilityOpen = false;
    this.ui.effectsOpen = false;
    this.ui.chartOpen = false;
  }
}

/**
 * Play `chapter` to the end. Returns the match as it finished, and what the
 * coach said at each step it showed.
 */
function play(chapterIndex: number): {
  runner: TutorialRunner;
  view: MatchView;
  said: Map<number, string>;
} {
  const chapter = CHAPTERS[chapterIndex]!;
  const transport = tutorialMatch(data, chapter, 'Tester');
  const player = new Player(transport);
  // What the game does as a step begins (game.ts, `startLesson`).
  const runner = new TutorialRunner(chapter, sceneOf(data, transport), (step) => {
    if (step.opens === 'damageChart') player.ui.chartOpen = true;
  });
  runner.begin();
  const said = new Map<number, string>();

  let guard = 0;
  while (!runner.complete) {
    if (guard++ > 200) throw new Error(`${chapter.id} is stuck at step ${runner.stepIndex}`);
    const step = runner.step!;
    const at = runner.stepIndex;
    const target = runner.target(player.view, player.ui);
    // Every step says something, and a pointed-at target is one the player
    // can see on this board.
    const text = runner.text(player.view);
    expect(text.length).toBeGreaterThan(10);
    said.set(at, text);
    if (target?.kind === 'unit') expect(player.view.lane!.units[target.index]).toBeDefined();
    if (target) {
      expect(reachable(target, chapter.features), `${chapter.id} ${at}: ${target.kind}`).toBe(true);
    }
    if (target?.kind === 'monsterWith') {
      const marked = player.view.lane!.monsters.filter((m) =>
        hasMark(m.statusMarks ?? 0, target.mark),
      );
      expect(marked.length).toBeGreaterThan(0);
    }

    if (step.mode === 'next') {
      runner.next();
    } else if (step.mode === 'watch') {
      // The match runs until the moment comes; then it holds, and only Next
      // moves on - however long the player takes to read.
      for (let tick = 0; tick < MAX_RUN_TICKS && runner.mode !== 'next'; tick++) {
        expect(runner.holds).toBe(false);
        transport.update(MS_PER_TICK);
        runner.update(player.view, player.ui, MS_PER_TICK / 1000);
        expect(runner.stepIndex).toBe(at);
      }
      if (runner.mode !== 'next') throw new Error(`${chapter.id} step ${at} never came`);
      expect(runner.holds).toBe(true);
      said.set(at, runner.text(player.view));
      runner.next();
      continue;
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
  return { runner, view: player.view, said };
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
    const { view, said } = play(CHAPTERS.findIndex((c) => c.id === 'build'));
    expect(view.wave).toBe(1);
    expect(view.phase).toBe('build');
    expect(view.lane!.units.length).toBe(4);
    // Your lane clears before the wave is over, and the coach says why the
    // tutorial is waiting rather than looking stuck.
    expect([...said.values()].some((text) => text.includes('EVERY lane'))).toBe(true);
  });

  it('does not keep a new player waiting long on the other lanes', () => {
    const chapter = CHAPTERS.find((c) => c.id === 'build')!;
    const transport = tutorialMatch(data, chapter, 'Tester');
    for (const x of [2, 3, 4, 5]) {
      transport.submit({
        kind: 'placeUnit',
        teamId: transport.teamId,
        unitDefId: 'sentinel',
        tileX: x,
        tileY: 6,
      });
    }
    transport.stage((state) => {
      state.phaseTicksLeft = 1;
    });
    let ownClear = -1;
    let ticks = 0;
    for (; ticks < MAX_RUN_TICKS; ticks++) {
      transport.update(MS_PER_TICK);
      const view = transport.view()!;
      const lane = view.lane!;
      if (ownClear < 0 && view.phase === 'combat' && lane.monsters.length + lane.reserveCount === 0)
        ownClear = ticks;
      if (view.phase === 'build' && view.wave >= 1) break;
    }
    // The bots' head start (match.ts) is what keeps this short.
    expect(ticks * MS_PER_TICK).toBeLessThan(30_000);
    expect(ownClear).toBeGreaterThan(0);
  });

  it('points at a lane that is still fighting, counted as the tabs are', () => {
    const chapter = CHAPTERS.find((c) => c.id === 'build')!;
    const transport = tutorialMatch(data, chapter, 'Tester');
    transport.stage((state) => {
      state.phaseTicksLeft = 1;
    });
    for (let i = 0; i < 40; i++) transport.update(MS_PER_TICK);
    const view = transport.view()!;
    const index = stillFighting(view);
    expect(index).toBeGreaterThanOrEqual(0);
    const ordered = [...view.opponents].sort((a, b) => a.teamId.localeCompare(b.teamId));
    const lane = view.watching[ordered[index]!.teamId]!;
    expect(lane.monsters.length + lane.reserveCount).toBeGreaterThan(0);
  });

  it('shows the damage chart, and names the best weapon with its multiplier', () => {
    const { said } = play(CHAPTERS.findIndex((c) => c.id === 'counters'));
    const chapter = CHAPTERS.find((c) => c.id === 'counters')!;
    const chart = chapter.steps.findIndex((step) => step.opens === 'damageChart');
    expect(chart).toBeGreaterThan(0);
    // Shown, not skipped: the step waits for the chart to be closed.
    expect(said.has(chart)).toBe(true);
    const weapon = [...said.values()].find((text) => text.includes('switch the fortress weapon'));
    expect(weapon).toMatch(/hits \w+ for ×\d/);
  });

  it('never moves past a watched moment by itself', () => {
    // The playtest complaint: two cards in the first wave skipped themselves
    // before the player had finished reading. A watched step waits for Next.
    const chapter = CHAPTERS.find((c) => c.id === 'build')!;
    const transport = tutorialMatch(data, chapter, 'Tester');
    const runner = new TutorialRunner(chapter, sceneOf(data, transport));
    runner.begin();
    const watched = chapter.steps.findIndex((step) => step.mode === 'watch');
    expect(watched).toBeGreaterThan(0);
    // Up to it the way a player would: tap what is pointed at, Next the rest.
    const player = new Player(transport);
    const ui = player.ui;
    while (runner.stepIndex < watched) {
      if (runner.step!.mode === 'next') runner.next();
      else player.tap(runner.target(player.view, ui)!);
      runner.update(player.view, ui, 0);
    }
    // The game only runs the match while the coach is not holding it.
    for (let tick = 0; tick < MAX_RUN_TICKS; tick++) {
      if (!runner.holds) transport.update(MS_PER_TICK);
      runner.update(transport.view()!, ui, runner.holds ? 0 : MS_PER_TICK / 1000);
    }
    // Long after the lane cleared, it is still on the same card, held still.
    expect(runner.stepIndex).toBe(watched);
    expect(runner.mode).toBe('next');
    expect(runner.holds).toBe(true);
    runner.next();
    expect(runner.stepIndex).toBe(watched + 1);
  });

  it('looks back over steps without doing them again, and comes forward to the same place', () => {
    const chapter = CHAPTERS.find((c) => c.id === 'upgrade')!;
    const transport = tutorialMatch(data, chapter, 'Tester');
    let entered = 0;
    const runner = new TutorialRunner(chapter, sceneOf(data, transport), () => entered++);
    runner.begin();
    runner.next();
    const live = runner.stepIndex;
    expect(runner.canGoBack).toBe(true);
    const before = { entered, gold: transport.view()!.lane!.economy!.gold };

    runner.back();
    expect(runner.stepIndex).toBe(live - 1);
    expect(runner.reviewing).toBe(true);
    expect(runner.mode).toBe('next');
    expect(runner.holds).toBe(true);
    expect(runner.canGoBack).toBe(false);
    // Looking back changed nothing: no step began again, nothing was staged.
    runner.next();
    expect(runner.stepIndex).toBe(live);
    expect(runner.reviewing).toBe(false);
    expect(entered).toBe(before.entered);
    expect(transport.view()!.lane!.economy!.gold).toBe(before.gold);
    // And the live step is live again: a tap step waits for its tap.
    expect(runner.mode).toBe(chapter.steps[live]!.mode);
  });

  it('teaches supply by doing: the cap goes up, and a second upgrade asks for more', () => {
    const { view, said } = play(CHAPTERS.findIndex((c) => c.id === 'supply'));
    expect(view.lane!.economy!.supplyCap).toBeGreaterThan(data.economy.supply.capBase ?? 0);
    expect([...said.values()].some((text) => /holds \d+ Pledges, but only \d+/.test(text))).toBe(
      true,
    );
    expect([...said.values()].some((text) => text.includes('more supply'))).toBe(true);
  });

  it('says what the first wave paid, and what the fortress kills cost', () => {
    const { said } = play(CHAPTERS.findIndex((c) => c.id === 'build'));
    const paid = [...said.values()].find((text) => text.startsWith('Wave cleared!'))!;
    expect(paid).toMatch(/killed \d+ monsters?, and that earned you \d+ gold/);
    expect(paid).toMatch(/pays you nothing|cost you \d+ gold/);
  });

  it('says which Fort upgrades cost gems and which cost gold', () => {
    const { said } = play(CHAPTERS.findIndex((c) => c.id === 'sends'));
    const fort = [...said.values()].find((text) => text.startsWith('The Fort tab'))!;
    expect(fort).toContain('cost gems');
    expect(fort).toContain('cost gold');
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

describe('the lessons between chapters', () => {
  it('opens the interface a piece at a time, and never closes a piece again', () => {
    const features = LESSONS.map((l) => (l.kind === 'chapter' ? l.chapter : l.practice).features);
    // The first lessons have the Build tab and nothing else.
    expect(features[0]!.tabs).toEqual(['build']);
    expect(features[0]!.upgrades).toBe(false);
    expect(features[0]!.gems).toBe(false);
    for (let i = 1; i < features.length; i++) {
      expect(within(features[i - 1]!, features[i]!), `lesson ${i}`).toBe(true);
    }
    // And by the end, everything.
    const last = features.at(-1)!;
    expect(last.tabs.length).toBe(6);
    expect(last.fort).toBe('all');
    expect(last.gems).toBe(true);
  });

  it('follows each chapter with a practice match on what it opened, until the last', () => {
    const ids = LESSONS.map(lessonId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LESSONS.filter((l) => l.kind === 'chapter').map((l) => l.chapter.id)).toEqual(
      CHAPTERS.map((c) => c.id),
    );
    expect(LESSONS[0]!.kind).toBe('chapter');
    expect(LESSONS.at(-1)!.kind).toBe('chapter');
    LESSONS.forEach((lesson, i) => {
      if (lesson.kind !== 'practice') return;
      const before = LESSONS[i - 1]!;
      expect(before.kind).toBe('chapter');
      if (before.kind === 'chapter')
        expect(lesson.practice.features).toEqual(before.chapter.features);
      // Never two practices in a row.
      expect(LESSONS[i + 1]?.kind).toBe('chapter');
    });
    expect(practices.length).toBeGreaterThanOrEqual(5);
  });

  it('introduces each practice, pointing at something it has open', () => {
    for (const p of practices) {
      expect(practiceIntro(data, p).length).toBeGreaterThan(40);
      if (p.target) expect(reachable(p.target, p.features), p.id).toBe(true);
      expect(data.units.builders.some((b) => b.id === p.builderId)).toBe(true);
    }
  });

  it('sets each practice up so the newest piece is the one that matters', () => {
    const start = (id: string) => practiceMatch(data, practice(id), 'Tester', 7).view()!;
    const startingGold = data.economy.startingGold ?? 0;
    expect(start('practice-build').lane!.economy!.gold).toBe(startingGold);

    // Too little supply to build out of trouble: upgrading is how to grow.
    expect(start('practice-upgrade').lane!.economy!.supplyCap).toBe(TIGHT_SUPPLY);
    expect(TIGHT_SUPPLY).toBeLessThan(data.economy.supply.capBase ?? 0);

    // Far more gold than the cap can hold, and far more every wave.
    const rich = start('practice-supply');
    expect(rich.lane!.economy!.gold).toBe(SUPPLY_PRACTICE.gold);
    expect(rich.lane!.economy!.supplyCap).toBe(SUPPLY_PRACTICE.supply);
    expect(rich.lane!.economy!.passiveIncome + (data.economy.waveBounty ?? 0)).toBe(
      SUPPLY_PRACTICE.perWave,
    );
    // However it is spent: even the cheapest gold-per-supply unit fills the cap
    // several times over.
    const cheapest = Math.min(
      ...buildableUnits(data, practice('practice-supply').builderId).map(
        (u) => (u.goldCost ?? 0) / Math.max(1, u.supplyCost ?? 0),
      ),
    );
    expect(rich.lane!.economy!.gold / cheapest).toBeGreaterThan(SUPPLY_PRACTICE.supply * 3);

    // A weapon to fix.
    const counters = start('practice-counters');
    expect(counters.lane!.fortress.weaponDamageType).not.toBe(bestAgainstWave(data, counters));

    // Gems to send with from the start.
    expect(start('practice-sends').lane!.economy!.gems).toBeGreaterThanOrEqual(SEND_START_GEMS);
  });

  it(
    'is a whole match: one played with nothing built ends with the fortress falling',
    { timeout: 60_000 },
    () => {
      const transport = practiceMatch(data, practice('practice-build'), 'Tester', 3);
      let ticks = 0;
      while (!transport.view()!.eliminated && ticks < 20 * 60 * 15) {
        transport.update(MS_PER_TICK);
        ticks++;
      }
      const view = transport.view()!;
      expect(view.eliminated).toBe(true);
      // The bots in a practice before sends were taught never sent at you.
      expect(view.lane!.sendLog.length).toBe(0);
      // And the other lanes are named, not blank.
      expect(view.opponents.every((o) => o.name.length > 0)).toBe(true);
    },
  );

  it('raises a cap by its step from wherever it starts: 5 to 10, and 25 to 30 as ever', () => {
    const step =
      (data.economy.supply.capUpgrades[0]?.value ?? 0) - (data.economy.supply.capBase ?? 0);
    const practiceMatchOf = practiceMatch(data, practice('practice-supply'), 'Tester', 7);
    practiceMatchOf.submit({ kind: 'buySupply', teamId: practiceMatchOf.teamId });
    expect(practiceMatchOf.view()!.lane!.economy!.supplyCap).toBe(SUPPLY_PRACTICE.supply + step);

    const usual = practiceMatch(data, practice('practice-build'), 'Tester', 7);
    usual.submit({ kind: 'buySupply', teamId: usual.teamId });
    // The cap waits between levels (economy.json `upgradeCooldowns`).
    const wait = secondsToTicks(upgradeCooldownSeconds(data, 'supply'));
    for (let i = 0; i < wait; i++) usual.update(MS_PER_TICK);
    usual.submit({ kind: 'buySupply', teamId: usual.teamId });
    const ladder = data.economy.supply.capUpgrades;
    expect(usual.view()!.lane!.economy!.supplyCap).toBe(ladder[1]?.value);
  });
});

describe('the counters chapter', () => {
  it('keys the preview with one monster of every armor, each a different color', () => {
    const counters = CHAPTERS.find((c) => c.id === 'counters')!;
    const keyed = counters.steps.filter((step) => step.preview === 'everyType');
    // The shape step and the color step, both pointing at the preview.
    expect(keyed).toHaveLength(2);
    for (const step of keyed) expect(step.target).toEqual({ kind: 'wavePreview' });
    const example = everyTypeExample(data);
    expect(new Set(example.map((e) => e.armor)).size).toBe(data.matrix.armorTypes.length);
    expect(new Set(example.map((e) => e.damageType)).size).toBe(data.matrix.damageTypes.length);
  });

  it('says what the sword and the shield on a card mean, each on the build bar', () => {
    const counters = CHAPTERS.find((c) => c.id === 'counters')!;
    const saying = (words: string) =>
      counters.steps.findIndex(
        (step) => typeof step.text === 'string' && step.text.includes(words),
      );
    const sword = saying('GREEN SWORD');
    const shield = saying('GREEN SHIELD');
    expect(counters.steps[sword]!.target).toEqual({ kind: 'buildBar' });
    expect(counters.steps[shield]!.target).toEqual({ kind: 'buildBar' });
    expect(counters.steps[sword]!.text).toContain('RED SWORD');
    expect(counters.steps[shield]!.text).toContain('RED SHIELD');
    // The shield comes once the chapter has said monsters hit back.
    const hitBack = counters.steps.findIndex(
      (step) => typeof step.target === 'object' && step.target.kind === 'hudIncoming',
    );
    expect(sword).toBeLessThan(hitBack);
    expect(shield).toBe(hitBack + 1);
    // And where the player will and will not see them.
    expect(counters.steps[shield + 1]!.text).toContain('online match');
    const chart = counters.steps.find((s) => s.nextLabel === 'Show the chart')!;
    expect(chart.text).toContain('One chart summarizes this information.');
  });

  it('shows the counter hints from the chapter that explains them, and not before', () => {
    const at = (id: string) => CHAPTERS.findIndex((c) => c.id === id);
    for (const chapter of CHAPTERS) {
      expect(chapter.features.counterHints, chapter.id).toBe(at(chapter.id) >= at('counters'));
    }
  });
});

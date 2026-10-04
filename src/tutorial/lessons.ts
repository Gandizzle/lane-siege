/**
 * The whole tutorial, in order: the chapters that explain, and between them
 * the practice matches that let a player use what was just explained.
 *
 * WHY PRACTICE MATCHES
 *
 * Seven chapters back to back is a lot to read and very little to do, and by
 * the end of them a new player has been told about supply, counters, tech,
 * gems and sends without having made one decision about any of them. So the
 * interface opens a piece at a time (chapters.ts, `STAGES`), and after each
 * piece comes a whole match - played until the fortress falls - with only what
 * has been taught so far on screen. The first is building and nothing else.
 *
 * Each match is set up so the newest piece is the one that matters in it: a
 * match after "Upgrade and sell" is played on so little supply that upgrading
 * is the only way to grow, and a match after "Supply" starts with more gold
 * than the starting cap can hold.
 */

import type { GameData } from '../data/schema.ts';
import { CHAPTERS, STAGES, rankAgainstWave, unitName } from './chapters.ts';
import type { Chapter, Lesson, Practice } from './types.ts';

/** The supply a "fewer, stronger" match is played on: about half the usual. */
export const TIGHT_SUPPLY = 12;

/** Gold on top of the starting purse when the lesson is spending it. */
export const RICH_START = 900;
export const TECH_START = 250;

/** Gems at the start of the first match with sends in it, so one can go out at once. */
export const SEND_START_GEMS = 40;

const HOLD_THE_LINE: Practice = {
  id: 'practice-build',
  title: 'Hold the line',
  summary: 'A whole match with only the Build tab',
  builderId: 'ironvow',
  features: STAGES.building,
  botsSend: false,
  target: { kind: 'buildBar' },
  intro:
    'Now a whole match, with just the Build tab. Build in every build phase; every wave you ' +
    'beat pays for more. Play until your fortress falls, and see how far you get.',
};

const FEWER_STRONGER: Practice = {
  id: 'practice-upgrade',
  title: 'Fewer, stronger',
  summary: 'Little supply: upgrade to grow',
  builderId: 'ironvow',
  features: STAGES.upgrading,
  botsSend: false,
  target: { kind: 'hudSupply' },
  intro: (data) =>
    `This match gives you only ${TIGHT_SUPPLY} supply, so your army cannot get big. Make it ` +
    'strong instead: tap a unit and upgrade it. And sell to make room for something better ' +
    `(a ${unitName(data, 'pledge')} sold after the build phase it was bought in returns half).`,
  setup: (scene) =>
    scene.stage((state) => {
      const economy = state.lanes[scene.teamId]?.economy;
      if (economy) economy.supplyCap = TIGHT_SUPPLY;
    }),
};

const ROOM_TO_GROW: Practice = {
  id: 'practice-supply',
  title: 'Room to grow',
  summary: 'A rich start: raise the cap to spend it',
  builderId: 'ironvow',
  features: STAGES.supply,
  botsSend: false,
  target: { kind: 'tab', tab: 'fort' },
  intro: (data) =>
    `You start rich this time: ${RICH_START} extra gold, more than ` +
    `${data.economy.supply.capBase ?? 0} supply can hold. When your army fills up, raise the ` +
    'cap in the Fort tab, and keep building.',
  setup: (scene) =>
    scene.stage((state) => {
      const economy = state.lanes[scene.teamId]?.economy;
      if (economy) economy.gold += RICH_START;
    }),
};

const WRONG_WEAPON: Practice = {
  id: 'practice-counters',
  title: 'Read the wave',
  summary: 'A match where the right damage matters',
  builderId: 'ironvow',
  features: STAGES.counters,
  botsSend: false,
  target: { kind: 'tab', tab: 'aura' },
  intro:
    'Your fortress weapon starts on the WORST damage type for the first wave: switch it in the ' +
    'Aura tab. Then, every build phase, read the wave preview and build what counters it. You ' +
    `start with ${TECH_START} extra gold for tech: put it into the damage your army leans on.`,
  setup: (scene) =>
    scene.stage((state) => {
      const lane = state.lanes[scene.teamId];
      if (!lane) return;
      lane.economy.gold += TECH_START;
      lane.fortress.weaponDamageType = rankAgainstWave(scene.data, state, lane.builderId).at(-1)!;
    }),
};

const FULL_MATCH: Practice = {
  id: 'practice-sends',
  title: 'The full game',
  summary: 'Everything open, and the bots send too',
  builderId: 'ironvow',
  features: STAGES.everything,
  botsSend: true,
  target: { kind: 'tab', tab: 'send' },
  intro:
    'Everything is open now: gems, sends and the fortress upgrades. And this time the other ' +
    `lanes send at you too. You start with ${SEND_START_GEMS} gems, so you can send from the ` +
    'first build phase.',
  setup: (scene) =>
    scene.stage((state) => {
      const economy = state.lanes[scene.teamId]?.economy;
      if (economy) economy.gems += SEND_START_GEMS;
    }),
};

/** The chapter with this id. Throws: a lesson list naming a chapter that is not there is a bug. */
function chapter(id: string): Chapter {
  const found = CHAPTERS.find((c) => c.id === id);
  if (!found) throw new Error(`No chapter "${id}"`);
  return found;
}

const read = (id: string): Lesson => ({ kind: 'chapter', chapter: chapter(id) });
const play = (practice: Practice): Lesson => ({ kind: 'practice', practice });

/**
 * Every lesson, in the order a new player meets them. Each practice follows
 * the chapter whose features it opens with, and the last chapter has none
 * after it: what follows that is a real match.
 */
export const LESSONS: readonly Lesson[] = [
  read('lane'),
  read('build'),
  play(HOLD_THE_LINE),
  read('upgrade'),
  play(FEWER_STRONGER),
  read('supply'),
  play(ROOM_TO_GROW),
  read('counters'),
  play(WRONG_WEAPON),
  read('sends'),
  play(FULL_MATCH),
  read('battle'),
];

/** A lesson's id: its chapter's, or its practice's. What the done list records. */
export function lessonId(lesson: Lesson): string {
  return lesson.kind === 'chapter' ? lesson.chapter.id : lesson.practice.id;
}

/** What the list and the cards call a lesson. */
export function lessonTitle(lesson: Lesson): string {
  return lesson.kind === 'chapter' ? lesson.chapter.title : lesson.practice.title;
}

/** A practice's opening words. */
export function practiceIntro(data: GameData, practice: Practice): string {
  return typeof practice.intro === 'string' ? practice.intro : practice.intro(data);
}

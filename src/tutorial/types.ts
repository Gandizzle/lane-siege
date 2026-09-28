/**
 * The shape of a tutorial: chapters of steps, each a thing the coach says, a
 * thing it points at, and what ends it (chapters.ts has the content, runner.ts
 * steps through it, ui/tutorialCoach.ts draws it).
 *
 * A step points at a TARGET by name - "the Send tab", "the Pledge card", "row
 * six of the grid" - never by pixels. Where each one is on this screen, this
 * way up, is the renderer's business (game.ts, `locate`), so a chapter reads
 * the same on a phone held either way and survives a layout change.
 */

import type { DamageType, GameData } from '../data/schema.ts';
import type { MatchState, MatchView, SimContext, StatusMark } from '../sim/index.ts';
import type { Selection, Tab, View } from '../render/ui/buildBar.ts';

/** Something on screen the coach can point at. */
export type Target =
  // The board.
  | { kind: 'spawnZone' }
  | { kind: 'wavePreview' }
  | { kind: 'buildGrid' }
  | { kind: 'gridRow'; row: number }
  | { kind: 'fortress' }
  | { kind: 'lane' }
  /** One of your own units, by its place in the lane's list. */
  | { kind: 'unit'; index: number }
  /** The first monster on the board wearing this status marker (statusMarks.ts). */
  | { kind: 'monsterWith'; mark: StatusMark }
  // The top band.
  | { kind: 'hudPhase' }
  | { kind: 'hudWallet' }
  | { kind: 'hudIncome' }
  | { kind: 'hudIncoming' }
  | { kind: 'hudNotice' }
  | { kind: 'opponentTabs' }
  | { kind: 'opponentTab'; index: number }
  | { kind: 'watchBack' }
  | { kind: 'menuButton' }
  | { kind: 'legendButton' }
  // The build bar.
  | { kind: 'buildBar' }
  | { kind: 'barPanel' }
  | { kind: 'tab'; tab: Tab }
  | { kind: 'unitCard'; defId: string }
  | { kind: 'abilityChips' }
  | { kind: 'upgrade' }
  | { kind: 'sell' }
  | { kind: 'weapon'; damageType: DamageType }
  | { kind: 'tech'; trackId: string }
  | { kind: 'send'; sendId: string }
  | { kind: 'sendTargets' };

/** What a step can see of the interface, beside the match itself. */
export interface UiProbe {
  /** Which panel the build bar is showing. */
  view: View;
  selection: Selection;
  /** An ability's card is open (abilityCard.ts). */
  abilityOpen: boolean;
  /** The effects legend or guide is open (effectsPanel.ts). */
  effectsOpen: boolean;
  /** Whose lane is on screen, or null for your own. */
  watching: string | null;
}

export interface StepContext {
  view: MatchView;
  ui: UiProbe;
  data: GameData;
  /** Seconds of match time since the step began: stops while the match is paused. */
  seconds: number;
}

/** What a step or a chapter can do to the match it is teaching with. */
export interface Scene {
  data: GameData;
  /** Your lane's team id. */
  teamId: string;
  /** Arrange the match between ticks (LocalTransport, `stage`). */
  stage(arrange: (state: MatchState, ctx: SimContext) => void): void;
}

/**
 * How a step ends.
 *
 *   `next`  Read, then tap Next. Everything but the card is out of reach.
 *   `tap`   Do something at the target; only the target takes a tap. `done`
 *           says when it has been done.
 *   `free`  Anything goes; `done` says when the step is over. For watching a
 *           fight, or closing a card the player opened.
 */
export type StepMode = 'next' | 'tap' | 'free';

export interface Step {
  /** What the coach says. A function when it quotes a number from the data. */
  text: string | ((data: GameData) => string);
  mode: StepMode;
  /** What to point at. A function when it depends on the match. */
  target?: Target | ((ctx: StepContext) => Target | null);
  done?: (ctx: StepContext) => boolean;
  /** Whether the match runs during this step. By default the tutorial waits. */
  run?: boolean;
  /** Set the scene as the step begins. */
  enter?: (scene: Scene) => void;
  /** Said on the Next button, for a step where Next does something. */
  nextLabel?: string;
  /**
   * The coach says nothing during this step: what is on screen already says
   * what to do, and the card would only cover it (the ability card's own "tap
   * anywhere to close").
   */
  silent?: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  /** One line, for the chapter list. */
  summary: string;
  /** The roster the chapter plays (units.json). */
  builderId: string;
  /** Arrange the match before the first step. */
  setup?: (scene: Scene) => void;
  steps: Step[];
}

/** Anything a match can be taught with: a transport that can be staged. */
export interface Stageable {
  stage(arrange: (state: MatchState, ctx: SimContext) => void): void;
}

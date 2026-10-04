/**
 * Steps through one chapter (chapters.ts): which step is up, what it says,
 * what it points at, and when it is over.
 *
 * No Pixi and no transport in here - the runner is told what the match and the
 * interface look like each frame and says what the coach should show - so a
 * whole chapter can be played without a screen (runner.test.ts).
 */

import type { GameData } from '../data/schema.ts';
import type { MatchView } from '../sim/index.ts';
import type { Chapter, Scene, Step, StepContext, StepMode, Target, UiProbe } from './types.ts';

export class TutorialRunner {
  private index = -1;
  /**
   * The furthest step reached. Below it the player is looking back over steps
   * already done (`back`): they are shown, never run again.
   */
  private furthest = -1;
  /** Match seconds since the step began. */
  private seconds = 0;
  /** A `watch` step's thing has happened: the match holds and Next is up. */
  private met = false;

  /**
   * `onEnter` hears each step as it begins, before anything can end it: how
   * the interface opens what a step `opens` (game.ts), in time for the step's
   * `done` to see it open.
   */
  constructor(
    readonly chapter: Chapter,
    private readonly scene: Scene,
    private readonly onEnter: (step: Step) => void = () => {},
  ) {}

  /** Set the scene and open the first step. */
  begin(): void {
    this.chapter.setup?.(this.scene);
    this.enter(0);
  }

  /** The step on screen, or null before `begin` and after the last one. */
  get step(): Step | null {
    return this.chapter.steps[this.index] ?? null;
  }

  /** Zero-based; equal to `stepCount` once the chapter is complete. */
  get stepIndex(): number {
    return this.index;
  }

  get stepCount(): number {
    return this.chapter.steps.length;
  }

  get complete(): boolean {
    return this.index >= this.chapter.steps.length;
  }

  /**
   * Whether the match should stand still. It does for every step that does not
   * say otherwise, so a player reading the coach never loses a wave to it, and
   * once the chapter is over - and while looking back, and once a `watch`
   * step's moment has come, so it is still there to be read about.
   */
  get holds(): boolean {
    if (this.reviewing) return true;
    if (this.step?.mode === 'watch') return this.met;
    return this.step?.run !== true;
  }

  /** Looking back at a step already done (`back`), rather than at the live one. */
  get reviewing(): boolean {
    return this.index < this.furthest;
  }

  /** Whether there is a step behind this one to look back at. */
  get canGoBack(): boolean {
    return this.previous(this.index) >= 0;
  }

  /**
   * How the coach should hold the screen for this step (types.ts): a step
   * being looked back on is read and Nexted past, whatever it was; a `watch`
   * step is free until its moment comes, and a reading step after.
   */
  get mode(): StepMode {
    const step = this.step;
    if (!step) return 'next';
    if (this.reviewing) return 'next';
    if (step.mode === 'watch') return this.met ? 'next' : 'free';
    return step.mode;
  }

  /** A `watch` step still waiting for its moment: the card has no Next yet. */
  get waiting(): boolean {
    return !this.reviewing && this.step?.mode === 'watch' && !this.met;
  }

  /** What the Next button says: the step's own words only when Next does what they say. */
  get nextLabel(): string {
    return this.reviewing ? 'Next' : (this.step?.nextLabel ?? 'Next');
  }

  get data(): GameData {
    return this.scene.data;
  }

  /** What the coach says now, about the match as `view` shows it. */
  text(view: MatchView): string {
    const text = this.step?.text ?? '';
    return typeof text === 'function' ? text(this.scene.data, view) : text;
  }

  /** What to point at, if anything, given the match as it is now. */
  target(view: MatchView, ui: UiProbe): Target | null {
    const target = this.step?.target;
    if (!target) return null;
    return typeof target === 'function' ? target(this.context(view, ui)) : target;
  }

  /**
   * The Next button: a `next` step, a `watch` step whose moment has come, or a
   * step being looked back on. Forward through steps already done shows them
   * again without running them, back to where the player left off.
   */
  next(): void {
    if (this.reviewing) {
      this.index = this.following(this.index);
      return;
    }
    if (this.mode === 'next') this.enter(this.index + 1);
  }

  /** The back arrow: the step before, shown again but not run again. */
  back(): void {
    const to = this.previous(this.index);
    if (to >= 0) this.index = to;
  }

  /**
   * The step before `from` worth showing again. A silent step said nothing -
   * it was there for a card the player had open - so it is passed over.
   */
  private previous(from: number): number {
    for (let i = Math.min(from, this.chapter.steps.length) - 1; i >= 0; i--) {
      if (this.chapter.steps[i]?.silent !== true) return i;
    }
    return -1;
  }

  /** The step after `from` while looking back, stopping at the live one. */
  private following(from: number): number {
    for (let i = from + 1; i < this.furthest; i++) {
      if (this.chapter.steps[i]?.silent !== true) return i;
    }
    return this.furthest;
  }

  /**
   * Once a frame, after the match has moved `matchSeconds` (zero while it is
   * held). Moves on when the step's condition is met, one step a frame: a step
   * that has just set the scene is judged against a view that shows it.
   */
  update(view: MatchView, ui: UiProbe, matchSeconds: number): void {
    const step = this.step;
    if (!step || this.reviewing) return;
    this.seconds += matchSeconds;
    if (step.mode === 'watch') {
      if (!this.met && step.done?.(this.context(view, ui))) this.met = true;
      return;
    }
    if (step.done?.(this.context(view, ui))) this.enter(this.index + 1);
  }

  private context(view: MatchView, ui: UiProbe): StepContext {
    return { view, ui, data: this.scene.data, seconds: this.seconds };
  }

  private enter(index: number): void {
    this.index = Math.min(index, this.chapter.steps.length);
    this.furthest = this.index;
    this.seconds = 0;
    this.met = false;
    const step = this.step;
    if (!step) return;
    step.enter?.(this.scene);
    this.onEnter(step);
  }
}

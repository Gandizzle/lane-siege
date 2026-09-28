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
import type { Chapter, Scene, Step, StepContext, Target, UiProbe } from './types.ts';

export class TutorialRunner {
  private index = -1;
  /** Match seconds since the step began. */
  private seconds = 0;

  constructor(
    readonly chapter: Chapter,
    private readonly scene: Scene,
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
   * once the chapter is over.
   */
  get holds(): boolean {
    return this.step?.run !== true;
  }

  get data(): GameData {
    return this.scene.data;
  }

  text(): string {
    const text = this.step?.text ?? '';
    return typeof text === 'function' ? text(this.scene.data) : text;
  }

  /** What to point at, if anything, given the match as it is now. */
  target(view: MatchView, ui: UiProbe): Target | null {
    const target = this.step?.target;
    if (!target) return null;
    return typeof target === 'function' ? target(this.context(view, ui)) : target;
  }

  /** The Next button: only a `next` step has one. */
  next(): void {
    if (this.step?.mode === 'next') this.enter(this.index + 1);
  }

  /**
   * Once a frame, after the match has moved `matchSeconds` (zero while it is
   * held). Moves on when the step's condition is met, one step a frame: a step
   * that has just set the scene is judged against a view that shows it.
   */
  update(view: MatchView, ui: UiProbe, matchSeconds: number): void {
    const step = this.step;
    if (!step) return;
    this.seconds += matchSeconds;
    if (step.done?.(this.context(view, ui))) this.enter(this.index + 1);
  }

  private context(view: MatchView, ui: UiProbe): StepContext {
    return { view, ui, data: this.scene.data, seconds: this.seconds };
  }

  private enter(index: number): void {
    this.index = Math.min(index, this.chapter.steps.length);
    this.seconds = 0;
    this.step?.enter?.(this.scene);
  }
}

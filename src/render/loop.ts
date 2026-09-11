/**
 * Fixed-timestep driver. DESIGN.md §15.1.
 *
 * The simulation runs at exactly 20 ticks per second and knows nothing about
 * frames. The browser delivers frames at whatever rate it feels like. This is
 * the accumulator that bridges the two without letting variable frame timing
 * leak into the simulation - if it did, two clients on different phones would
 * compute different states and the determinism guarantee would be gone.
 *
 * It also hands back `alpha`, the fraction of a tick elapsed since the last one,
 * so the renderer can interpolate positions and draw smoothly at 60fps from a
 * 20Hz simulation. Interpolation is strictly a rendering concern: the simulation
 * never sees it.
 *
 * This file is deliberately free of Pixi and of the DOM so it can be tested
 * directly.
 */

import { TICKS_PER_SECOND } from '../sim/index.ts';

export const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

/**
 * Ceiling on catch-up work in a single frame. Without it, a long stall - a
 * backgrounded tab, a garbage collection pause - produces a delta so large that
 * the catch-up loop takes longer than a frame, which grows the next delta, and
 * the page locks up. Dropping simulated time is the right trade: better a match
 * that skips than one that freezes.
 */
export const MAX_CATCHUP_TICKS = 5;

export class FixedTimestep {
  private accumulator = 0;

  /** Fraction of a tick elapsed, 0..1. For render interpolation only. */
  alpha = 0;

  /** Ticks dropped to the catch-up ceiling. Worth surfacing if it is not 0. */
  droppedTicks = 0;

  /**
   * Feed one frame's elapsed milliseconds; `onTick` runs once per whole tick.
   * Returns how many ticks ran.
   */
  advance(deltaMs: number, onTick: () => void): number {
    // Guard against a negative or absurd delta from a clock adjustment.
    if (!Number.isFinite(deltaMs) || deltaMs < 0) deltaMs = 0;

    this.accumulator += deltaMs;

    let ticks = 0;
    while (this.accumulator >= MS_PER_TICK && ticks < MAX_CATCHUP_TICKS) {
      onTick();
      this.accumulator -= MS_PER_TICK;
      ticks++;
    }

    if (this.accumulator >= MS_PER_TICK) {
      // Still behind after the ceiling: discard the backlog rather than carry it
      // into the next frame, where it would only grow.
      const behind = Math.floor(this.accumulator / MS_PER_TICK);
      this.droppedTicks += behind;
      this.accumulator -= behind * MS_PER_TICK;
    }

    this.alpha = this.accumulator / MS_PER_TICK;
    return ticks;
  }

  reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
  }
}

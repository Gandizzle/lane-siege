import { describe, expect, it } from 'vitest';
import { FixedTimestep, MAX_CATCHUP_TICKS, MS_PER_TICK } from './loop.ts';

describe('fixed timestep (DESIGN.md §15.1)', () => {
  it('runs exactly one tick per tick-worth of time', () => {
    const loop = new FixedTimestep();
    let ticks = 0;
    expect(loop.advance(MS_PER_TICK, () => ticks++)).toBe(1);
    expect(ticks).toBe(1);
  });

  it('runs nothing for a frame shorter than a tick', () => {
    const loop = new FixedTimestep();
    let ticks = 0;
    loop.advance(MS_PER_TICK / 3, () => ticks++);
    expect(ticks).toBe(0);
  });

  it('accumulates fractional frames into whole ticks', () => {
    // 60fps against a 20Hz simulation: one tick every third frame.
    const loop = new FixedTimestep();
    let ticks = 0;
    for (let frame = 0; frame < 60; frame++) loop.advance(1000 / 60, () => ticks++);
    expect(ticks).toBe(20);
  });

  it('keeps the simulation rate independent of frame rate', () => {
    // A second of wall time is 20 ticks of simulated time at any frame rate.
    //
    // Asserted as ticks + alpha rather than ticks alone: summing 144 frames of
    // 1000/144 ms lands a hair under a second in floating point, leaving 19
    // whole ticks and 0.99 of the next. That is correct behaviour - no
    // simulated time is lost, it is just not yet spent - and it is the
    // invariant that actually matters.
    for (const fps of [30, 60, 144, 90]) {
      const loop = new FixedTimestep();
      let ticks = 0;
      for (let frame = 0; frame < fps; frame++) loop.advance(1000 / fps, () => ticks++);
      expect(ticks + loop.alpha).toBeCloseTo(20, 3);
    }
  });

  it('reports alpha between ticks, for interpolation', () => {
    const loop = new FixedTimestep();
    loop.advance(MS_PER_TICK * 1.5, () => {});
    expect(loop.alpha).toBeCloseTo(0.5, 6);
  });

  it('caps catch-up work and drops the backlog rather than spiralling', () => {
    const loop = new FixedTimestep();
    let ticks = 0;
    // A ten-second stall: a backgrounded tab.
    loop.advance(10_000, () => ticks++);

    expect(ticks).toBe(MAX_CATCHUP_TICKS);
    expect(loop.droppedTicks).toBeGreaterThan(0);
    // The backlog is gone, so the next frame behaves normally.
    expect(loop.alpha).toBeLessThan(1);
  });

  it('ignores a negative or non-finite delta', () => {
    const loop = new FixedTimestep();
    let ticks = 0;
    loop.advance(-500, () => ticks++);
    loop.advance(Number.NaN, () => ticks++);
    expect(ticks).toBe(0);
  });
});

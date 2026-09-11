import { describe, expect, it } from 'vitest';
import { Rng, waveRng } from './rng.ts';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const left = Array.from({ length: 32 }, () => a.nextUint32());
    const right = Array.from({ length: 32 }, () => b.nextUint32());
    expect(left).toEqual(right);
  });

  it('diverges for different seeds', () => {
    const a = Array.from(
      { length: 8 },
      (
        (r) => () =>
          r.nextUint32()
      )(new Rng(1)),
    );
    const b = Array.from(
      { length: 8 },
      (
        (r) => () =>
          r.nextUint32()
      )(new Rng(2)),
    );
    expect(a).not.toEqual(b);
  });

  it('round-trips through its serialised state', () => {
    const rng = new Rng(999);
    for (let i = 0; i < 10; i++) rng.nextUint32();

    const saved = rng.state;
    const expected = Array.from({ length: 5 }, () => rng.nextUint32());

    const restored = new Rng(0);
    restored.state = saved;
    expect(Array.from({ length: 5 }, () => restored.nextUint32())).toEqual(expected);
  });

  it('keeps next() inside [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int() inside [0, max)', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });
});

describe('waveRng (DESIGN.md §9.2)', () => {
  it('makes a wave a pure function of (matchSeed, waveNumber)', () => {
    // Wave 7 must generate identically no matter what happened in waves 1-6.
    const first = Array.from(
      { length: 10 },
      (
        (r) => () =>
          r.nextUint32()
      )(waveRng(555, 7)),
    );
    const second = Array.from(
      { length: 10 },
      (
        (r) => () =>
          r.nextUint32()
      )(waveRng(555, 7)),
    );
    expect(first).toEqual(second);
  });

  it('gives adjacent waves uncorrelated streams', () => {
    const w7 = waveRng(555, 7).nextUint32();
    const w8 = waveRng(555, 8).nextUint32();
    expect(w7).not.toEqual(w8);
  });

  it('gives different matches different waves', () => {
    expect(waveRng(1, 3).nextUint32()).not.toEqual(waveRng(2, 3).nextUint32());
  });
});

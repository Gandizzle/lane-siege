/**
 * Seeded RNG. DESIGN.md §9.2 and §15.1.
 *
 * Wave composition is a pure function of (matchSeed, waveNumber), every client
 * and the server share one seed, and that buys deterministic replays, cheap
 * desync detection and headless balance runs. All of which requires that the
 * generator produce identical output everywhere - so this is integer-only
 * (Math.imul and bit operations, exactly specified in JS) and never touches
 * Math.random.
 *
 * The whole generator state is one uint32, so a snapshot is a single number.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    // Force to uint32. A zero state is fine for mulberry32.
    this.s = seed >>> 0;
  }

  /** Serialise. Put this in a state snapshot to make replays exact. */
  get state(): number {
    return this.s;
  }

  set state(value: number) {
    this.s = value >>> 0;
  }

  clone(): Rng {
    return new Rng(this.s);
  }

  /** Next uint32. */
  nextUint32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0;
    return this.nextUint32() % maxExclusive;
  }

  /** Integer in [min, max], inclusive both ends. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.int(items.length)];
  }
}

/**
 * A generator derived from a match seed and a wave number. Because it is
 * derived rather than advanced, wave N generates identically no matter what
 * happened in waves 1..N-1 - which is what makes wave composition a pure
 * function of (matchSeed, waveNumber).
 */
export function waveRng(matchSeed: number, waveNumber: number): Rng {
  // Mix so that adjacent waves do not produce correlated streams.
  const mixed = Math.imul(matchSeed ^ Math.imul(waveNumber + 1, 0x9e3779b9), 0x85ebca6b);
  return new Rng(mixed >>> 0);
}

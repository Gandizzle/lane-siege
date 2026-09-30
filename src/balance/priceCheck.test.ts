import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { goldToClearHalf, lineWorth, marginPerLogGold } from './priceCheck.ts';
import type { WaveOutcome } from './sandbox.ts';

const { data } = loadDataFromDisk();

/** Only what the price check reads. */
function outcome(
  builderId: string,
  goldBudget: number,
  lines: Record<string, number>,
  margin: number,
  wave = 1,
): WaveOutcome {
  return {
    wave,
    builderId,
    goldBudget,
    margin,
    cleared: margin > 0,
    lines: Object.entries(lines).map(([defId, gold]) => ({ defId, gold })),
  } as unknown as WaveOutcome;
}

describe('lineWorth', () => {
  it('finds the line whose gold buys more than its rung-mates', () => {
    // Ironvow's Pledge is made to be worth four times Pyre's Ember, gold for
    // gold, and the rung 2 lines alike. Several waves, so there are groups.
    const outcomes: WaveOutcome[] = [];
    for (let wave = 1; wave <= 6; wave++) {
      for (let i = 0; i <= 8; i++) {
        const low = (i / 8) * 100;
        const high = 100 - low;
        const jitter = ((i * 7919 + wave * 104729) % 11) / 200 - 0.025;
        outcomes.push(
          outcome(
            'ironvow',
            100,
            { pledge: low, sentinel: high },
            (0.4 * low + 0.1 * high) / 100 + jitter,
            wave,
          ),
          outcome(
            'pyre',
            100,
            { ember: low, wickling: high },
            (0.1 * low + 0.1 * high) / 100 + jitter,
            wave,
          ),
        );
      }
    }
    const worth = new Map(lineWorth(data, outcomes, { ridge: 0.01 }).map((w) => [w.defId, w]));
    // Each Ironvow army's gold is split between two lines that share the
    // credit, and the margin is read as gold at the sweep's default rate, so
    // the size is modest; the direction is the point.
    expect(worth.get('pledge')!.worth).toBeGreaterThan(1.03);
    expect(worth.get('ember')!.worth).toBeLessThan(0.97);
    expect(worth.get('sentinel')!.worth).toBeLessThan(1);
    expect(worth.get('pledge')!.relative).toBeCloseTo(-worth.get('ember')!.relative, 6);
  });
});

describe('goldToClearHalf', () => {
  it('reads the gold where half the armies clear, between the bands', () => {
    const at = (gold: number, cleared: number, of = 4): WaveOutcome[] =>
      Array.from({ length: of }, (_, i) => outcome('pyre', gold, {}, i < cleared ? 1 : -1));
    // Nothing clears at 75, half at 100, everything at 125: exactly nominal.
    const even = goldToClearHalf([...at(75, 0), ...at(100, 2), ...at(125, 4)]);
    expect(even.get('pyre|1')).toBeCloseTo(1, 6);
    // A quarter at 100 and three quarters at 125: somewhere between.
    const late = goldToClearHalf([...at(75, 0), ...at(100, 1), ...at(125, 3)]);
    expect(late.get('pyre|1')).toBeGreaterThan(1);
    expect(late.get('pyre|1')).toBeLessThan(1.25);
  });

  it('says how much margin a doubling of gold buys', () => {
    const outcomes = [outcome('pyre', 100, {}, 0), outcome('pyre', 200, {}, Math.log(2))];
    expect(marginPerLogGold(outcomes)).toBeCloseTo(1, 6);
  });
});

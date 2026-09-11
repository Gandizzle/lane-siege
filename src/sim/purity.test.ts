/**
 * Guards DESIGN.md §15.1: "The simulation is a pure module with no rendering,
 * no DOM, and no engine dependency."
 *
 * That single rule is what buys cheat-resistant multiplayer, deterministic
 * replays, desync detection and headless balance runs. It is also the rule
 * most easily broken by a one-line convenience import at 1am, so it is checked
 * mechanically rather than by discipline.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIM_DIR = dirname(fileURLToPath(import.meta.url));

/** Strips comments so that prose about a banned API is not mistaken for a use. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bfrom\s+['"]pixi\.js/, why: 'the simulation must not depend on the renderer' },
  { pattern: /\bfrom\s+['"].*\/render\//, why: 'the simulation must not import renderer code' },
  { pattern: /\bMath\s*\.\s*random\b/, why: 'use the seeded RNG (rng.ts); determinism' },
  { pattern: /\bDate\s*\.\s*now\b/, why: 'the simulation is driven by tick count, not wall time' },
  { pattern: /\bperformance\s*\.\s*now\b/, why: 'the simulation is driven by tick count' },
  { pattern: /\bdocument\s*\./, why: 'the simulation must not touch the DOM' },
  { pattern: /\bwindow\s*\./, why: 'the simulation must not touch the DOM' },
  { pattern: /\bprocess\s*\./, why: 'the simulation must run unchanged in a browser' },
  {
    pattern: /\bMath\s*\.\s*(sin|cos|tan|pow)\b/,
    why: 'not bit-identical across engines; would break determinism',
  },
];

function simSources(): string[] {
  return readdirSync(SIM_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
}

describe('simulation purity (DESIGN.md §15.1)', () => {
  it('has source files to check', () => {
    expect(simSources().length).toBeGreaterThan(0);
  });

  for (const file of simSources()) {
    it(`${file} stays pure`, () => {
      const code = stripComments(readFileSync(join(SIM_DIR, file), 'utf8'));
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(code), `${file} matches ${pattern} - ${why}`).toBe(false);
      }
    });
  }
});

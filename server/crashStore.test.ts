/**
 * Crash reports (crashStore.ts): a report cut down to size, grouped with the
 * same problem, kept across a restart, and a file that starts again rather
 * than filling the disk.
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileCrashStore, parseCrash, thrownFrom } from './crashStore.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const report = {
  kind: 'rejection',
  message: 'Cannot read properties of undefined',
  stack:
    'TypeError: Cannot read properties of undefined\n    at draw (https://g.example/assets/index-1.js:3:99)',
  edition: 'android',
  version: '1.0.0',
  scene: 'match',
};

describe('a crash report', () => {
  it('is cut down to size, and says where it was thrown', () => {
    const crash = parseCrash({
      ...report,
      message: 'x'.repeat(1000),
      trail: Array(40).fill('tap'),
    });
    expect(crash?.message).toHaveLength(300);
    expect(crash?.trail).toHaveLength(12);
    expect(thrownFrom(parseCrash(report)!)).toBe(
      'at draw (https://g.example/assets/index-1.js:3:99)',
    );
    expect(parseCrash({ ...report, kind: 'something' })).toBeNull();
    expect(parseCrash({ ...report, message: '' })).toBeNull();
  });

  it('is kept across a restart, grouped, and cleared when read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-siege-crashes-'));
    dirs.push(dir);
    const path = join(dir, 'crashes.jsonl');
    const store = new FileCrashStore(path);
    const at = (s: number) => new Date(Date.UTC(2026, 9, 29, 12, 0, s));
    store.add(parseCrash(report)!, at(1));
    store.add(parseCrash(report)!, at(2));
    store.add(parseCrash({ ...report, message: 'another' })!, at(3));
    const again = new FileCrashStore(path);
    expect(again.groups().map((g) => [g.message, g.count])).toEqual([
      ['another', 1],
      ['Cannot read properties of undefined', 2],
    ]);
    again.clear();
    expect(existsSync(path)).toBe(false);
    expect(again.groups()).toEqual([]);
  });

  it('starts the file again rather than filling the disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-siege-crashes-'));
    dirs.push(dir);
    const path = join(dir, 'crashes.jsonl');
    const store = new FileCrashStore(path);
    const big = parseCrash({ ...report, stack: 'y'.repeat(4000) })!;
    for (let i = 0; i < 700; i++) store.add(big);
    expect(existsSync(`${path}.old`)).toBe(true);
    expect(statSync(path).size).toBeLessThan(2_100_000);
  });
});

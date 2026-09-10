import { describe, expect, it } from 'vitest';
import { loadDataFromDisk } from './loadNode.ts';

describe('data/', () => {
  const { data, report } = loadDataFromDisk();

  it('parses every file', () => {
    expect(Object.keys(data).sort()).toEqual([
      'economy',
      'fortress',
      'lane',
      'matrix',
      'monsters',
      'sends',
      'units',
      'waves',
    ]);
  });

  it('has no structural errors', () => {
    // Missing values are expected while the game is unbalanced; broken
    // invariants are not.
    expect(report.errors).toEqual([]);
  });

  it('holds a complete damage matrix', () => {
    expect(report.missing.filter((p) => p.startsWith('matrix'))).toEqual([]);
  });
});

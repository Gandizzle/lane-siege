/**
 * The Founders (founderStore.ts): the first to the level - with the online
 * matches as well - numbered in order, once each, and no more than there are
 * to be; kept across a restart, and a number kept taken when its player asks
 * to be forgotten.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STORE } from '../src/progression/config.ts';
import { FileFounderStore, MemoryFounderStore } from './founderStore.ts';

const RULES = { count: 3, level: 20, onlineMatches: 2 };

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane-siege-founders-'));
  dirs.push(dir);
  return join(dir, 'founders.json');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the Founders', () => {
  it('numbers the first to the level in the order they got there', () => {
    const store = new MemoryFounderStore(RULES);
    expect(store.claim('ann', 20, 2)).toEqual({ result: 'founder', number: 1 });
    expect(store.claim('bo', 23, 9)).toEqual({ result: 'founder', number: 2 });
    expect(store.numberOf('bo')).toBe(2);
    expect(store.numberOf('cai')).toBeNull();
    expect(store.status()).toEqual({ count: 3, level: 20, onlineMatches: 2, left: 1 });
    expect(store.claims().map((c) => c.playerId)).toEqual(['ann', 'bo']);
  });

  it('gives the same number to the same player, however often they ask', () => {
    const store = new MemoryFounderStore(RULES);
    store.claim('ann', 20, 2);
    expect(store.claim('ann', 20, 2)).toEqual({ result: 'founder', number: 1 });
    expect(store.claim('ann', 31, 40)).toEqual({ result: 'founder', number: 1 });
    expect(store.status().left).toBe(2);
  });

  it('says it is too soon below the level or the online matches, and takes nothing for it', () => {
    const store = new MemoryFounderStore(RULES);
    const notYet = { result: 'notYet', level: 20, onlineMatches: 2 };
    expect(store.claim('ann', 19, 30)).toEqual(notYet);
    expect(store.claim('ann', 25, 1)).toEqual(notYet);
    expect(store.claim('ann', Number.NaN, 2)).toEqual(notYet);
    expect(store.status().left).toBe(3);
  });

  it('stops at the last number, and says so to everyone after', () => {
    const store = new MemoryFounderStore(RULES);
    for (const id of ['ann', 'bo', 'cai']) store.claim(id, 20, 2);
    expect(store.claim('dee', 25, 2)).toEqual({ result: 'full' });
    expect(store.status().left).toBe(0);
    // A Founder asking again is still told their number.
    expect(store.claim('cai', 20, 2)).toEqual({ result: 'founder', number: 3 });
  });

  it('keeps a forgotten Founder’s number taken, but no longer says whose it was', () => {
    const store = new MemoryFounderStore(RULES);
    store.claim('ann', 20, 2);
    store.claim('bo', 20, 2);
    store.forget('ann');
    expect(store.numberOf('ann')).toBeNull();
    expect(store.claims().map((c) => c.number)).toEqual([1, 2]);
    expect(store.claim('cai', 20, 2)).toEqual({ result: 'founder', number: 3 });
  });

  it('remembers them across a restart', () => {
    const path = tempFile();
    const store = new FileFounderStore(RULES, path);
    store.claim('ann', 20, 2);
    store.claim('bo', 21, 2);
    const again = new FileFounderStore(RULES, path);
    expect(again.numberOf('bo')).toBe(2);
    expect(again.claim('cai', 20, 2)).toEqual({ result: 'founder', number: 3 });
    expect(new FileFounderStore(RULES, tempFile()).status().left).toBe(3);
  });

  it('is fifty, at level twenty with ten online matches, in the shipped data', () => {
    expect(STORE.founders.count).toBe(50);
    expect(STORE.founders.level).toBe(20);
    expect(STORE.founders.onlineMatches).toBe(10);
  });
});

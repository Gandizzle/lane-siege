/**
 * The Founders (founderStore.ts): the first to the level, numbered in order,
 * once each, and no more than there are to be - kept across a restart, and
 * asked about over HTTP (founderRoutes.ts) alongside the saved builds.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STORE } from '../src/progression/config.ts';
import { FileFounderStore, MemoryFounderStore, type FounderStore } from './founderStore.ts';
import { founderRoutes } from './founderRoutes.ts';
import { ghostRoutes } from './ghostRoutes.ts';
import { MemoryGhostStore } from './ghostStore.ts';

const RULES = { count: 3, level: 20 };

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
    expect(store.claim('ann', 20)).toEqual({ result: 'founder', number: 1 });
    expect(store.claim('bo', 23)).toEqual({ result: 'founder', number: 2 });
    expect(store.numberOf('bo')).toBe(2);
    expect(store.numberOf('cai')).toBeNull();
    expect(store.status()).toEqual({ count: 3, level: 20, left: 1 });
  });

  it('gives the same number to the same player, however often they ask', () => {
    const store = new MemoryFounderStore(RULES);
    store.claim('ann', 20);
    expect(store.claim('ann', 20)).toEqual({ result: 'founder', number: 1 });
    expect(store.claim('ann', 31)).toEqual({ result: 'founder', number: 1 });
    expect(store.status().left).toBe(2);
  });

  it('says it is too soon below the level, and takes nothing for it', () => {
    const store = new MemoryFounderStore(RULES);
    expect(store.claim('ann', 19)).toEqual({ result: 'notYet', level: 20 });
    expect(store.claim('ann', Number.NaN)).toEqual({ result: 'notYet', level: 20 });
    expect(store.status().left).toBe(3);
  });

  it('stops at the last number, and says so to everyone after', () => {
    const store = new MemoryFounderStore(RULES);
    for (const id of ['ann', 'bo', 'cai']) store.claim(id, 20);
    expect(store.claim('dee', 25)).toEqual({ result: 'full' });
    expect(store.status().left).toBe(0);
    // A Founder asking again is still told their number.
    expect(store.claim('cai', 20)).toEqual({ result: 'founder', number: 3 });
  });

  it('remembers them across a restart', () => {
    const path = tempFile();
    const store = new FileFounderStore(RULES, path);
    store.claim('ann', 20);
    store.claim('bo', 21);
    const again = new FileFounderStore(RULES, path);
    expect(again.numberOf('bo')).toBe(2);
    expect(again.claim('cai', 20)).toEqual({ result: 'founder', number: 3 });
    expect(new FileFounderStore(RULES, tempFile()).status().left).toBe(3);
  });

  it('is fifty, at level twenty, in the shipped data', () => {
    expect(STORE.founders.count).toBe(50);
    expect(STORE.founders.level).toBe(20);
  });
});

describe('asking about the Founders over HTTP', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  async function serve(store: FounderStore): Promise<string> {
    server = createServer(ghostRoutes(new MemoryGhostStore(), founderRoutes(store)));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const claim = (base: string, body: unknown) =>
    fetch(`${base}/founders/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('claims a number, and says how many are left', async () => {
    const base = await serve(new MemoryFounderStore(RULES));
    const answer = await claim(base, { playerId: 'ann', level: 20 });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    expect(await answer.json()).toEqual({ result: 'founder', number: 1 });
    expect(await (await claim(base, { playerId: 'bo', level: 4 })).json()).toEqual({
      result: 'notYet',
      level: 20,
    });
    expect(await (await fetch(`${base}/founders/status`)).json()).toEqual({
      count: 3,
      level: 20,
      left: 2,
    });
  });

  it('answers a browser asking first, refuses what it cannot use, and hands the rest on', async () => {
    const base = await serve(new MemoryFounderStore(RULES));
    expect((await fetch(`${base}/founders/claim`, { method: 'OPTIONS' })).status).toBe(204);
    expect((await claim(base, { playerId: 'ann' })).status).toBe(400);
    expect((await claim(base, { level: 20 })).status).toBe(400);
    expect(
      (await fetch(`${base}/founders/claim`, { method: 'POST', body: 'x'.repeat(5000) })).status,
    ).toBe(413);
    // The saved builds are still there, and anything else is still nothing.
    expect((await fetch(`${base}/ghosts/report?playerId=ann`)).status).toBe(200);
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
  });
});

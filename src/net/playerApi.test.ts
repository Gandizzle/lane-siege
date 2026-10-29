/**
 * The client's half of what the server keeps (playerApi.ts), against the
 * server's own routes (server/routes.ts): a record that is this player's and
 * nobody else's, practice matches that wait on the device when the server
 * cannot be reached, the credits, reports, and how many Founder stars are left.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryParts, serverRoutes, type ServerParts } from '../../server/routes.ts';
import type { KeyValueStore } from './identity.ts';
import { PlayerApi, type CasualReport } from './playerApi.ts';

const ANN = { playerId: 'ann', name: 'Ann', key: '0123456789abcdef0123456789abcdef' };
const BO = { playerId: 'bo', name: 'Bo', key: '11111111111111111111111111111111' };

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function serve(testPurchases = false): Promise<{ url: string; parts: ServerParts }> {
  const parts = memoryParts({ founders: { count: 2, level: 3, onlineMatches: 1 } });
  server = createServer(
    serverRoutes(parts, { trustProxy: false, testPurchases, supporterCheck: null }),
  );
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, parts };
}

const match: CasualReport = {
  mode: 'practice',
  placement: 2,
  wavesSurvived: 4,
  wavesPlayed: 5,
  reachedShowdown: false,
  day: new Date().toISOString().slice(0, 10),
};

describe('what the server keeps, from the client', () => {
  it('is this player’s record, and a copied id gets nothing', async () => {
    const { url, parts } = await serve();
    const ann = new PlayerApi(url, ANN, memory());
    expect(await ann.me()).toMatchObject({ level: 1, xp: 0, founderNumber: null, badges: [] });
    expect(parts.players.get('ann')?.name).toBe('Ann');
    const copy = new PlayerApi(url, { ...ANN, key: BO.key }, memory());
    expect(await copy.me()).toBeNull();
  });

  it('counts a practice match, and keeps one the server could not hear for next time', async () => {
    const storage = memory();
    const offline = new PlayerApi('ws://127.0.0.1:9', ANN, storage);
    expect(await offline.reportCasual(match)).toBeNull();

    const { url } = await serve();
    const back = new PlayerApi(url, ANN, storage);
    // The match from the train, sent with the next question.
    const summary = await back.me();
    expect(summary?.xp).toBeGreaterThan(0);
    const after = await back.reportCasual(match);
    expect(after?.xp).toBeGreaterThan(summary!.xp);
    // Nothing is sent twice.
    expect((await back.me())?.xp).toBe(after?.xp);
  });

  it('takes a credits name from a Supporter on a test server, and lists it', async () => {
    const { url } = await serve(true);
    const ann = new PlayerApi(url, ANN, memory());
    expect(await ann.setCreditName('Ann B')).toEqual({ result: 'notSupporter' });
    expect((await ann.testSupporter(true))?.supporter).toBe(true);
    expect(await ann.setCreditName('Ann B')).toEqual({ result: 'ok', creditName: 'Ann B' });
    expect(await ann.credits()).toEqual({ founders: [], supporters: [{ name: 'Ann B' }] });
    expect((await ann.testSupporter(false))?.supporter).toBe(false);
  });

  it('reports a name', async () => {
    const { url, parts } = await serve();
    const bo = new PlayerApi(url, BO, memory());
    expect(await bo.report({ playerId: 'ghost:ann', name: 'Ann', where: 'match' })).toBe(true);
    expect(parts.reports.list()[0]).toMatchObject({
      playerId: 'ann',
      name: 'Ann',
      reporters: ['bo'],
    });
  });

  it('says how many Founder stars are left, and stops asking once they are gone', async () => {
    const { url, parts } = await serve();
    const storage = memory();
    const ann = new PlayerApi(url, ANN, storage);
    expect(await ann.founderStatus()).toEqual({ count: 2, level: 3, onlineMatches: 1, left: 2 });
    parts.founders.claim('x', 3, 1);
    parts.founders.claim('y', 3, 1);
    expect(ann.foundersGone).toBe(false);
    expect((await ann.founderStatus())?.left).toBe(0);
    expect(ann.foundersGone).toBe(true);
  });

  it('is no answer, rather than an error, when there is no server to ask', async () => {
    const nobody = new PlayerApi('ws://127.0.0.1:9', ANN, null);
    expect(await nobody.me()).toBeNull();
    expect(await nobody.credits()).toBeNull();
    expect(await nobody.founderStatus()).toBeNull();
    expect(await nobody.report({ playerId: 'bo', name: 'Bo', where: 'lobby' })).toBe(false);
  });
});

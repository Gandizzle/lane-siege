/**
 * Everything the server answers over HTTP (routes.ts), asked the way a
 * browser asks: a player's own record only with their key, test purchases
 * only on a test server, the credits only for Supporters, reports counted by
 * who made them, crash reports kept, an admin page that needs its token, and
 * a limit on how often anyone may ask.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { matchResultOf } from '../src/progression/award.ts';
import type { FounderRules } from './founderStore.ts';
import type { Limit } from './rateLimit.ts';
import { memoryParts, serverRoutes, type ServerParts, type ServerSettings } from './routes.ts';

const KEY = '0123456789abcdef0123456789abcdef';
const KEY2 = '11111111111111111111111111111111';
const KEY3 = '22222222222222222222222222222222';
const KEY4 = '33333333333333333333333333333333';

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function serve(
  settings: Partial<ServerSettings> = {},
  options: { founders?: FounderRules; limits?: Record<string, Limit> } = {},
): Promise<{ base: string; parts: ServerParts }> {
  const parts = memoryParts({
    founders: options.founders ?? { count: 2, level: 3, onlineMatches: 1 },
    ...(options.limits && { limits: options.limits }),
  });
  server = createServer(
    serverRoutes(parts, {
      trustProxy: false,
      testPurchases: false,
      supporterCheck: null,
      ...settings,
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, parts };
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('a player’s own record', () => {
  it('is theirs with their key, and nobody else’s', async () => {
    const { base } = await serve();
    const me = await post(base, '/progress/me', { playerId: 'ann', key: KEY, name: 'Ann' });
    expect(me.status).toBe(200);
    expect(me.headers.get('access-control-allow-origin')).toBe('*');
    expect(await me.json()).toMatchObject({
      xp: 0,
      level: 1,
      onlineMatches: 0,
      founderNumber: null,
    });
    expect((await post(base, '/progress/me', { playerId: 'ann', key: KEY2 })).status).toBe(403);
    expect((await post(base, '/progress/me', { playerId: 'ann' })).status).toBe(400);
    expect((await post(base, '/progress/me', { key: KEY })).status).toBe(400);
  });

  it('counts a practice match, and refuses one nobody played', async () => {
    const { base } = await serve();
    const match = {
      mode: 'practice',
      placement: 1,
      wavesSurvived: 5,
      wavesPlayed: 5,
      reachedShowdown: false,
      day: new Date().toISOString().slice(0, 10),
    };
    const counted = await post(base, '/progress/casual', { playerId: 'ann', key: KEY, match });
    expect(counted.status).toBe(200);
    expect((await counted.json()).xp).toBeGreaterThan(0);
    const bad = await post(base, '/progress/casual', {
      playerId: 'ann',
      key: KEY,
      match: { ...match, wavesSurvived: 50 },
    });
    expect(bad.status).toBe(400);
  });

  it('shows the others only the badges the record bears out', async () => {
    const { base } = await serve();
    const worn = await post(base, '/progress/wear', {
      playerId: 'ann',
      key: KEY,
      badges: ['badge_founder', 'badge_supporter', 'not_a_badge'],
    });
    expect((await worn.json()).badges).toEqual([]);
  });
});

describe('Supporter and the credits', () => {
  it('honours a test purchase only on a test server', async () => {
    const { base } = await serve();
    expect((await post(base, '/supporter/test', { playerId: 'ann', key: KEY })).status).toBe(403);
    expect((await post(base, '/supporter/verify', { playerId: 'ann', key: KEY })).status).toBe(501);
  });

  it('takes a Supporter’s name for the credits, checked, and lists it', async () => {
    const { base } = await serve({ testPurchases: true });
    const name = (creditName: string) =>
      post(base, '/credits/name', { playerId: 'ann', key: KEY, creditName });
    const before = await name('Ann B');
    expect(before.status).toBe(403);
    expect(await before.json()).toEqual({ result: 'notSupporter' });

    const bought = await post(base, '/supporter/test', { playerId: 'ann', key: KEY });
    expect((await bought.json()).supporter).toBe(true);
    expect(await (await name('fuck off')).json()).toEqual({ result: 'refused' });
    expect(await (await name('  Ann   Bee  ')).json()).toEqual({
      result: 'ok',
      creditName: 'Ann Bee',
    });
    expect(await (await fetch(`${base}/credits`)).json()).toEqual({
      founders: [],
      supporters: [{ name: 'Ann Bee' }],
    });
    // And out again.
    await name('');
    expect((await (await fetch(`${base}/credits`)).json()).supporters).toEqual([]);
  });

  it('asks whoever took the money, and takes it back after a refund', async () => {
    let bought = true;
    const { base } = await serve({ supporterCheck: { check: async () => bought } });
    const verify = () => post(base, '/supporter/verify', { playerId: 'ann', key: KEY });
    expect((await (await verify()).json()).supporter).toBe(true);
    bought = false;
    expect((await (await verify()).json()).supporter).toBe(false);
  });
});

describe('name reports', () => {
  const report = (base: string, reporter: string, key: string, name = 'Rude') =>
    post(base, '/reports', {
      playerId: reporter,
      key,
      target: { playerId: 'ghost:zed', name, where: 'match' },
    });

  it('counts each reporter once, and hides a name enough of them reported', async () => {
    const { base, parts } = await serve();
    expect(await (await report(base, 'ann', KEY)).json()).toEqual({ outcome: 'counted' });
    expect(await (await report(base, 'ann', KEY)).json()).toEqual({ outcome: 'repeat' });
    expect(parts.moderation.isHidden('zed', 'Rude')).toBe(false);
    await report(base, 'bo', KEY2);
    expect(await (await report(base, 'cai', KEY3)).json()).toEqual({ outcome: 'hidden' });
    // A saved build's seat is reported as the player who saved it.
    expect(parts.moderation.shownName('zed', 'Rude')).toBe('');
    // A new name shows again.
    expect(parts.moderation.shownName('zed', 'Polite')).toBe('Polite');
  });

  it('refuses a report that says nothing, or about yourself', async () => {
    const { base } = await serve();
    const bad = await post(base, '/reports', { playerId: 'ann', key: KEY, target: { name: 'x' } });
    expect(bad.status).toBe(400);
    const self = await post(base, '/reports', {
      playerId: 'ann',
      key: KEY,
      target: { playerId: 'ann', name: 'Ann', where: 'lobby' },
    });
    expect(self.status).toBe(400);
  });
});

describe('the Founders, over HTTP', () => {
  it('works a claim out from the server’s count, never from the device', async () => {
    const { base, parts } = await serve();
    const claim = (body: object) => post(base, '/founders/claim', body);
    // A level the device says means nothing.
    expect(await (await claim({ playerId: 'ann', key: KEY, level: 99 })).json()).toEqual({
      result: 'notYet',
      level: 3,
      onlineMatches: 1,
    });
    await post(base, '/progress/me', { playerId: 'ann', key: KEY });
    const record = parts.players.get('ann')!;
    const win = matchResultOf('online', {
      wave: 20,
      eliminated: false,
      placement: 1,
      reachedShowdown: false,
    });
    parts.players.recordOnline(record, win);
    parts.players.recordOnline(record, win);
    expect(await (await claim({ playerId: 'ann', key: KEY })).json()).toEqual({
      result: 'founder',
      number: 1,
    });
    expect((await claim({ playerId: 'ann', key: KEY2 })).status).toBe(403);
    expect(await (await fetch(`${base}/founders/status`)).json()).toEqual({
      count: 2,
      level: 3,
      onlineMatches: 1,
      left: 1,
    });
  });
});

describe('crash reports', () => {
  const crash = {
    kind: 'error',
    message: 'boom',
    stack: 'Error: boom\n    at frame (https://game.example/assets/index-abc.js:1:2345)',
    version: '0.0.1',
    edition: 'web',
    scene: 'home',
    trail: ['screen: home'],
  };

  it('keeps a report sent as plain text, grouped with the same problem', async () => {
    const { base, parts } = await serve();
    const sent = await fetch(`${base}/crashes`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(crash),
    });
    expect(sent.status).toBe(200);
    await fetch(`${base}/crashes`, { method: 'POST', body: JSON.stringify(crash) });
    const groups = parts.crashes.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'error', message: 'boom', count: 2 });
    expect(groups[0]!.where).toContain('index-abc.js');
  });

  it('refuses what is not one, one claiming to be the server, and one too long', async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/crashes`, { method: 'POST', body: '{}' })).status).toBe(400);
    const server = await fetch(`${base}/crashes`, {
      method: 'POST',
      body: JSON.stringify({ ...crash, kind: 'server' }),
    });
    expect(server.status).toBe(400);
    const long = await fetch(`${base}/crashes`, { method: 'POST', body: 'x'.repeat(20_000) });
    expect(long.status).toBe(413);
  });
});

describe('the admin page', () => {
  const ADMIN = 'a-long-admin-token-for-the-tests';
  const ask = (base: string, path: string, token = ADMIN) =>
    fetch(`${base}/admin/api/${path}`, { headers: { Authorization: `Bearer ${token}` } });

  it('is served, and off without a token on the server', async () => {
    const { base } = await serve();
    const page = await fetch(`${base}/admin`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Game admin');
    expect((await ask(base, 'overview')).status).toBe(503);
  });

  it('needs the token, and stops answering a guesser', async () => {
    const { base } = await serve(
      { adminToken: ADMIN },
      { limits: { adminFail: { max: 2, windowMs: 60_000 } } },
    );
    expect((await ask(base, 'overview', 'wrong')).status).toBe(401);
    expect((await ask(base, 'overview', 'wrong')).status).toBe(401);
    expect((await ask(base, 'overview', 'wrong')).status).toBe(429);
    expect((await ask(base, 'overview')).status).toBe(200);
  });

  it('hides a name, finds a player, deletes them, and backs everything up', async () => {
    const { base, parts } = await serve({ adminToken: ADMIN });
    await post(base, '/progress/me', { playerId: 'zed', key: KEY4, name: 'Zed' });
    const auth = { Authorization: `Bearer ${ADMIN}` };

    expect(
      (await post(base, '/admin/api/names', { playerId: 'zed', name: 'Zed', action: 'hide' }, auth))
        .status,
    ).toBe(200);
    expect(parts.moderation.isHidden('zed', 'Zed')).toBe(true);
    expect((await (await ask(base, 'players?q=ze')).json()).players[0].playerId).toBe('zed');

    const backup = await (await ask(base, 'backup')).json();
    expect(backup.players.map((p: { playerId: string }) => p.playerId)).toEqual(['zed']);
    expect(JSON.stringify(backup)).not.toContain(KEY4);

    await post(base, '/admin/api/players/delete', { playerId: 'zed' }, auth);
    expect(parts.players.has('zed')).toBe(false);
    expect(parts.moderation.isHidden('zed', 'Zed')).toBe(false);
  });
});

describe('the rest', () => {
  it('says it is up, and limits how often anyone may make new players', async () => {
    const { base } = await serve({}, { limits: { register: { max: 1, windowMs: 60_000 } } });
    const health = await fetch(`${base}/health`);
    expect(await health.text()).toBe('ok');
    expect((await post(base, '/progress/me', { playerId: 'ann', key: KEY })).status).toBe(200);
    expect((await post(base, '/progress/me', { playerId: 'bo', key: KEY2 })).status).toBe(429);
    // A player already known is not a new one.
    expect((await post(base, '/progress/me', { playerId: 'ann', key: KEY })).status).toBe(200);
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
    expect((await fetch(`${base}/ghosts/report?playerId=ann`)).status).toBe(200);
  });

  it('keeps a saved build only with the player’s key', async () => {
    const { base, parts } = await serve();
    await post(base, '/progress/me', { playerId: 'ann', key: KEY });
    parts.ghosts.setLast({
      playerId: 'ann',
      name: 'Ann',
      level: 1,
      looks: { fortress: null, trail: null, floor: null, victory: null },
      builderId: 'ironvow',
      wave: 3,
      placement: 4,
      playedAt: new Date().toISOString(),
      actions: [],
    });
    expect((await post(base, '/ghosts/keep', { playerId: 'ann', key: KEY2 })).status).toBe(403);
    expect((await post(base, '/ghosts/keep', { playerId: 'ann', key: KEY })).status).toBe(200);
  });
});

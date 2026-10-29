/**
 * Where saved builds are kept (ghostStore.ts), and the two questions a player
 * asks about theirs (ghostRoutes.ts).
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileGhostStore,
  MemoryGhostStore,
  type GhostBuild,
  type GhostStore,
} from './ghostStore.ts';
import { ghostRoutes } from './ghostRoutes.ts';
import { NO_LOOKS } from '../src/sim/index.ts';

function build(playerId: string, level = 5, wave = 12): GhostBuild {
  return {
    playerId,
    name: `Player ${playerId}`,
    level,
    looks: { ...NO_LOOKS, fortress: 'fortress_granite' },
    builderId: 'ironvow',
    wave,
    placement: 2,
    playedAt: '2026-10-28T10:00:00.000Z',
    actions: [
      { wave: 0, combat: false, do: { kind: 'placeUnit', unitDefId: 'x', tileX: 1, tileY: 2 } },
    ],
  };
}

/** A draw that always takes the first: picks come out nearest-first. */
const first = () => 0;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ghosts-'));
  dirs.push(dir);
  return dir;
}

for (const [kind, make] of [
  ['in memory', () => new MemoryGhostStore()],
  ['on disk', () => new FileGhostStore(tempDir())],
] as const) {
  describe(`saved builds, ${kind}`, () => {
    it('keeps the last build until it is kept, and keeps one saved build a player', () => {
      const store: GhostStore = make();
      expect(store.keep('ann')).toBeNull();
      store.setLast(build('ann', 5, 9));
      expect(store.report('ann').last?.wave).toBe(9);
      expect(store.report('ann').saved).toBeNull();

      const kept = store.keep('ann', new Date('2026-10-28T11:00:00Z'))!;
      expect(kept.results).toEqual([0, 0, 0, 0]);
      expect(store.report('ann').saved?.wave).toBe(9);

      // The next match is the next last build; keeping it replaces the saved one.
      store.setLast(build('ann', 6, 21));
      expect(store.report('ann').saved?.wave).toBe(9);
      store.keep('ann', new Date('2026-10-29T11:00:00Z'));
      expect(store.report('ann').saved).toMatchObject({
        wave: 21,
        savedAt: '2026-10-29T11:00:00.000Z',
      });
      expect(store.pick(4, { exclude: new Set(), level: 6, random: first })).toHaveLength(1);
    });

    it('counts where a saved build placed, for the build it was, not the one after', () => {
      const store: GhostStore = make();
      store.setLast(build('bo'));
      const kept = store.keep('bo', new Date('2026-10-28T11:00:00Z'))!;
      store.recordResult('bo', kept.savedAt, 1);
      store.recordResult('bo', kept.savedAt, 3);
      store.recordResult('bo', kept.savedAt, 3);
      store.recordResult('bo', kept.savedAt, 9);
      store.recordResult('bo', 'an older build', 2);
      expect(store.report('bo').saved?.results).toEqual([1, 0, 2, 0]);
    });

    it("picks near the room's level, never a room's own player, never twice", () => {
      const store: GhostStore = make();
      for (const [id, level] of [
        ['a', 1],
        ['b', 30],
        ['c', 3],
        ['d', 2],
      ] as const) {
        store.setLast(build(id, level));
        store.keep(id);
      }
      const picked = store.pick(2, { exclude: new Set(['a']), level: 2, random: first });
      expect(picked.map((g) => g.playerId)).toEqual(['d', 'c']);
      const all = store.pick(9, { exclude: new Set(), level: 2, random: Math.random });
      expect(new Set(all.map((g) => g.playerId)).size).toBe(4);
    });
  });
}

describe('saved builds on disk', () => {
  it('are there after a restart, and are named so that no id can name a path', () => {
    const dir = tempDir();
    const store = new FileGhostStore(dir);
    store.setLast(build('../../etc/passwd'));
    const kept = store.keep('../../etc/passwd')!;
    store.recordResult('../../etc/passwd', kept.savedAt, 2);

    const again = new FileGhostStore(dir);
    expect(again.report('../../etc/passwd').saved?.results).toEqual([0, 1, 0, 0]);
    // Its player's looks go with it, to be seen in other people's matches.
    expect(again.pick(1, { exclude: new Set(), level: 0, random: first })[0]?.looks).toEqual({
      ...NO_LOOKS,
      fortress: 'fortress_granite',
    });
    expect(again.pick(1, { exclude: new Set(), level: 0, random: first })[0]?.actions).toHaveLength(
      1,
    );
    for (const kind of ['saved', 'last']) {
      expect(readdirSync(join(dir, kind))).toEqual([expect.stringMatching(/^[0-9a-f]{32}\.json$/)]);
    }
  });
});

describe('asking about a saved build over HTTP', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  async function serve(store: GhostStore): Promise<string> {
    server = createServer(ghostRoutes(store));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('reports, and keeps the last build when asked', async () => {
    const store = new MemoryGhostStore();
    const base = await serve(store);
    const report = async () => (await fetch(`${base}/ghosts/report?playerId=cai`)).json();

    expect(await report()).toEqual({ saved: null, last: null });
    const nothing = await fetch(`${base}/ghosts/keep`, {
      method: 'POST',
      body: JSON.stringify({ playerId: 'cai' }),
    });
    expect(nothing.status).toBe(404);

    store.setLast(build('cai', 4, 17));
    const kept = await fetch(`${base}/ghosts/keep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: 'cai' }),
    });
    expect(kept.status).toBe(200);
    expect(kept.headers.get('access-control-allow-origin')).toBe('*');
    expect(((await kept.json()) as { saved: { wave: number } }).saved.wave).toBe(17);
    expect(((await report()) as { saved: { results: number[] } }).saved.results).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('answers a browser asking first, and refuses what it cannot use', async () => {
    const base = await serve(new MemoryGhostStore());
    expect((await fetch(`${base}/ghosts/keep`, { method: 'OPTIONS' })).status).toBe(204);
    expect((await fetch(`${base}/ghosts/report`)).status).toBe(400);
    expect((await fetch(`${base}/ghosts/keep`, { method: 'POST', body: 'not json' })).status).toBe(
      400,
    );
    expect(
      (await fetch(`${base}/ghosts/keep`, { method: 'POST', body: 'x'.repeat(5000) })).status,
    ).toBe(413);
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
  });
});

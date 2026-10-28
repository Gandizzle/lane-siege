/**
 * The client's half of saved builds (ghostApi.ts): where it asks, and what
 * counts as news.
 */

import { describe, expect, it } from 'vitest';
import { SavedBuilds, httpBase, type GhostReport } from './ghostApi.ts';
import type { KeyValueStore } from './identity.ts';

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function report(savedAt: string, results: number[]): GhostReport {
  return {
    saved: { savedAt, builderId: 'ironvow', wave: 12, placement: 2, results },
    last: null,
  };
}

describe('saved builds, from the client', () => {
  it('asks the game server over HTTP at the websocket’s own address', () => {
    expect(httpBase('ws://localhost:2567')).toBe('http://localhost:2567');
    expect(httpBase('wss://play.example.com/')).toBe('https://play.example.com');
  });

  it('calls news only what is new since this device last showed it', () => {
    const builds = new SavedBuilds('ws://x', 'ann', memory());
    expect(builds.news({ saved: null, last: null })).toBeNull();

    const first = report('2026-10-27', [2, 1, 0, 1]);
    expect(builds.news(first)).toEqual({ results: [2, 1, 0, 1], total: [2, 1, 0, 1] });
    builds.markSeen(first);
    expect(builds.news(first)).toBeNull();

    expect(builds.news(report('2026-10-27', [3, 1, 2, 1]))).toEqual({
      results: [1, 0, 2, 0],
      total: [3, 1, 2, 1],
    });
    // A build kept since is counted from nothing, whatever the old one did.
    expect(builds.news(report('2026-10-28', [0, 1, 0, 0]))).toEqual({
      results: [0, 1, 0, 0],
      total: [0, 1, 0, 0],
    });
  });

  it('is no news, rather than an error, when there is no server to ask', async () => {
    const builds = new SavedBuilds('ws://127.0.0.1:9', 'ann', null);
    expect(await builds.report()).toBeNull();
    expect(await builds.keep()).toBeNull();
  });
});

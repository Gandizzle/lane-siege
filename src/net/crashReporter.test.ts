/**
 * Crash reports from the player's side (crashReporter.ts): what nothing else
 * caught, reported once a problem and only so many a session, with what the
 * game was doing; waiting on the device when there is nowhere to send it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from './identity.ts';
import { CrashReporter, type CrashPayload, type CrashTarget } from './crashReporter.ts';

const INFO = { version: '1.2.3', build: 'abc123', edition: 'web' };

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** A stand-in for `window`: something to fire events at. */
function target(): CrashTarget & { fire(type: string, event: unknown): void } {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    fire(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function queued(storage: KeyValueStore): CrashPayload[] {
  return JSON.parse(storage.getItem('lane-siege.crashQueue') ?? '[]') as CrashPayload[];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('crash reports, from the player’s side', () => {
  it('reports an error nothing caught, with what the game was doing, once', () => {
    const storage = memory();
    const reporter = new CrashReporter(INFO, storage, null, () => new Date('2026-10-29T12:00:00Z'));
    const window = target();
    reporter.install(window);
    reporter.at('home');
    reporter.note('tapped Quick match');
    const error = new Error('boom');
    window.fire('error', { error, message: 'boom', filename: 'index.js', lineno: 1, colno: 2 });
    window.fire('error', { error, message: 'boom' });
    const [report, ...rest] = queued(storage);
    expect(rest).toEqual([]);
    expect(report).toMatchObject({
      kind: 'error',
      message: 'boom',
      version: '1.2.3',
      build: 'abc123',
      edition: 'web',
      scene: 'home',
      at: '2026-10-29T12:00:00.000Z',
    });
    expect(report!.trail).toEqual(['screen: home', 'tapped Quick match']);
    expect(report!.stack).toContain('boom');
    // Never who it happened to.
    expect(JSON.stringify(report)).not.toMatch(/playerId|"name"/);
  });

  it('reports a promise nobody handled, and the canvas being lost', () => {
    const storage = memory();
    const reporter = new CrashReporter(INFO, storage, null);
    const window = target();
    const canvas = target();
    reporter.install(window);
    reporter.watchCanvas(canvas);
    window.fire('unhandledrejection', { reason: 'no answer' });
    canvas.fire('webglcontextlost', {});
    expect(queued(storage).map((r) => [r.kind, r.message])).toEqual([
      ['rejection', 'no answer'],
      ['webgl', 'The WebGL context was lost'],
    ]);
  });

  it('stops after so many different problems in one session', () => {
    const storage = memory();
    const reporter = new CrashReporter(INFO, storage, null);
    for (let i = 0; i < 30; i++) reporter.capture('error', `problem ${i}`, '', '');
    expect(queued(storage)).toHaveLength(10);
  });

  it('sends what is waiting to the server as plain text, and keeps what does not get there', async () => {
    const storage = memory();
    const sent: { url: string; type: string | null; body: CrashPayload }[] = [];
    let up = false;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (!up) throw new Error('offline');
      sent.push({
        url,
        type: new Headers(init.headers).get('Content-Type'),
        body: JSON.parse(String(init.body)) as CrashPayload,
      });
      return new Response('{"ok":true}');
    });
    const reporter = new CrashReporter(INFO, storage, 'wss://play.example.com');
    reporter.capture('error', 'first', '', '');
    await reporter.flush();
    expect(queued(storage)).toHaveLength(1);
    up = true;
    await reporter.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: 'https://play.example.com/crashes',
      type: 'text/plain',
      body: { message: 'first' },
    });
    expect(queued(storage)).toEqual([]);
  });
});

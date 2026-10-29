/**
 * The client's half of the Founders (founderApi.ts), against the server's own
 * routes: a number when it is earned, the same number when asked again, and a
 * device that stops asking once they are gone.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryFounderStore } from '../../server/founderStore.ts';
import { founderRoutes } from '../../server/founderRoutes.ts';
import { Founders } from './founderApi.ts';
import type { KeyValueStore } from './identity.ts';

function memory(): KeyValueStore {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function serve(count = 2): Promise<string> {
  server = createServer(founderRoutes(new MemoryFounderStore({ count, level: 20 })));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('the Founders, from the client', () => {
  it('claims a number at the level, and the same one when asked again', async () => {
    const url = await serve();
    const ann = new Founders(url, 'ann', memory());
    expect(await ann.claim(12)).toEqual({ result: 'notYet', level: 20 });
    expect(await ann.claim(20)).toEqual({ result: 'founder', number: 1 });
    expect(await ann.claim(20)).toEqual({ result: 'founder', number: 1 });
    expect(await ann.status()).toEqual({ count: 2, level: 20, left: 1 });
  });

  it('stops asking once every number is gone', async () => {
    const url = await serve(1);
    await new Founders(url, 'ann', memory()).claim(20);
    const storage = memory();
    const bo = new Founders(url, 'bo', storage);
    expect(bo.gone).toBe(false);
    expect(await bo.claim(25)).toEqual({ result: 'full' });
    expect(bo.gone).toBe(true);
    expect(new Founders(url, 'bo', storage).gone).toBe(true);
  });

  it('is no answer, rather than an error, when there is no server to ask', async () => {
    const nobody = new Founders('ws://127.0.0.1:9', 'ann', null);
    expect(await nobody.claim(20)).toBeNull();
    expect(await nobody.status()).toBeNull();
    expect(nobody.gone).toBe(false);
  });
});

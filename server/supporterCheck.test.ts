/**
 * Asking RevenueCat whether a player bought Supporter (supporterCheck.ts),
 * against a stand-in for its REST API: an unexpired `supporter` entitlement
 * is a Supporter, a one-time purchase never expires, and no answer is no
 * answer rather than a no.
 */

import { describe, expect, it } from 'vitest';
import { RevenueCatCheck, entitled } from './supporterCheck.ts';

const NOW = new Date('2026-10-29T12:00:00Z');

function customer(entitlements: Record<string, unknown>) {
  return { request_date: NOW.toISOString(), subscriber: { entitlements, non_subscriptions: {} } };
}

describe('whether a customer record holds Supporter', () => {
  it('is a one-time purchase with no expiry, or one not yet expired', () => {
    const lifetime = { expires_date: null, product_identifier: 'supporter' };
    expect(entitled(customer({ supporter: lifetime }), 'supporter', NOW)).toBe(true);
    expect(
      entitled(customer({ supporter: { expires_date: '2027-01-01T00:00:00Z' } }), 'supporter', NOW),
    ).toBe(true);
    expect(
      entitled(customer({ supporter: { expires_date: '2026-01-01T00:00:00Z' } }), 'supporter', NOW),
    ).toBe(false);
    expect(entitled(customer({ other: lifetime }), 'supporter', NOW)).toBe(false);
    expect(entitled(customer({}), 'supporter', NOW)).toBe(false);
    expect(entitled(null, 'supporter', NOW)).toBe(false);
  });
});

describe('asking RevenueCat', () => {
  it('asks for the player by id with the secret key, and reads the answer', async () => {
    const asked: { url: string; auth: string | null }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(url), auth: new Headers(init?.headers).get('Authorization') });
      return new Response(JSON.stringify(customer({ supporter: { expires_date: null } })));
    }) as typeof fetch;
    const check = new RevenueCatCheck('sk_test', 'supporter', fake, () => NOW);
    expect(await check.check('ann/1')).toBe(true);
    expect(asked).toEqual([
      { url: 'https://api.revenuecat.com/v1/subscribers/ann%2F1', auth: 'Bearer sk_test' },
    ]);
  });

  it('is no answer, not a no, when RevenueCat cannot be asked', async () => {
    const failing = (async () => new Response('', { status: 500 })) as typeof fetch;
    expect(await new RevenueCatCheck('sk', 'supporter', failing).check('ann')).toBeNull();
    const down = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await new RevenueCatCheck('sk', 'supporter', down).check('ann')).toBeNull();
  });
});

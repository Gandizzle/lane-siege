/**
 * Whether a player has bought Supporter, asked of whoever took the money.
 * (docs/ARCHITECTURE.md, "What the server keeps"; docs/GO-LIVE.md §9.)
 *
 * The game never takes the device's word for a purchase: a Supporter badge
 * the others see, and a name in the credits, need the server to have asked.
 * RevenueCat keeps the one record of who bought Supporter - in the Android
 * app through Google Play, on the web through Stripe - under the player's id,
 * and answers the server when it asks with its secret key.
 *
 * Written against RevenueCat's REST API (v1, `GET /subscribers/{id}`): an
 * entitlement named `supporter` that has not expired, where a one-time
 * purchase is one with no expiry at all. Checked here with a stand-in for
 * RevenueCat; it has not yet met the real one, which needs the account from
 * GO-LIVE.md §9. Until the server has the key (`REVENUECAT_SECRET_KEY`) there
 * is no check, and nobody is a Supporter but on a test server.
 */

/** Asks whoever took the money. Null when they could not be asked. */
export interface SupporterCheck {
  check(playerId: string): Promise<boolean | null>;
}

/** The entitlement Supporter grants in RevenueCat (GO-LIVE.md §9). */
export const SUPPORTER_ENTITLEMENT = 'supporter';

/** Whether a RevenueCat customer record holds `entitlement`, unexpired. */
export function entitled(body: unknown, entitlement: string, now: Date): boolean {
  const subscriber = (body as { subscriber?: unknown } | null)?.subscriber;
  const entitlements = (subscriber as { entitlements?: unknown } | undefined)?.entitlements;
  if (typeof entitlements !== 'object' || entitlements === null) return false;
  const one = (entitlements as Record<string, unknown>)[entitlement];
  if (typeof one !== 'object' || one === null) return false;
  const expires = (one as { expires_date?: unknown }).expires_date;
  // A one-time purchase never expires.
  if (expires === null || expires === undefined) return true;
  const at = typeof expires === 'string' ? Date.parse(expires) : NaN;
  return Number.isFinite(at) && at > now.getTime();
}

export class RevenueCatCheck implements SupporterCheck {
  constructor(
    private readonly secretKey: string,
    private readonly entitlement = SUPPORTER_ENTITLEMENT,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(playerId: string): Promise<boolean | null> {
    try {
      const response = await this.fetchImpl(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(playerId)}`,
        { headers: { Authorization: `Bearer ${this.secretKey}`, Accept: 'application/json' } },
      );
      if (!response.ok) return null;
      return entitled(await response.json(), this.entitlement, this.now());
    } catch {
      return null;
    }
  }
}

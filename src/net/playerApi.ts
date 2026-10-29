/**
 * What the game server keeps about this player, from the client's side: the
 * XP it can vouch for, a Founder's number, the badges the others see, a
 * Supporter's name in the credits, name reports, and how many Founder stars
 * are left. (docs/ARCHITECTURE.md, "What the server keeps"; the server's half
 * is server/playerRoutes.ts and server/founderRoutes.ts.)
 *
 * Every question about the player's own record carries their key
 * (identity.ts), which is what makes the answer theirs. Plain HTTP to the
 * game server's own port, like the saved builds (ghostApi.ts), and allowed to
 * fail the same way: no server, an old server, a phone between towers - each
 * is a null, and the game carries on.
 *
 * A practice or solo match reported while the server cannot be reached is
 * kept on the device and sent with the next question, so XP earned on a train
 * still counts towards the server's level. Online matches need no report: the
 * server hosted them, and counted them as they ended.
 */

import type { WornBadge } from '../sim/index.ts';
import { httpBase } from './ghostApi.ts';
import type { Identity, KeyValueStore } from './identity.ts';
import { cleanWornBadges } from './lobby.ts';

/** What the server says about a player's own record. */
export interface PlayerSummary {
  /** XP the server counts: online matches it hosted, practice and solo as reported, under the daily cap. */
  xp: number;
  /** The level that XP makes. What the Founders are counted by. */
  level: number;
  /** Online matches played to the end on this server. */
  onlineMatches: number;
  /** A Founder's number, as the server counted them; null for anyone else. */
  founderNumber: number | null;
  /** A Supporter the server has checked: a real purchase, or a test one on a test server. */
  supporter: boolean;
  /** Their name in the credits; empty for none. */
  creditName: string;
  /** The admin took their credits name away, and it cannot be set again. */
  creditBlocked: boolean;
  /** The badges the others see beside their name, checked against what they have earned. */
  badges: WornBadge[];
  /** Their current name was hidden after reports, and the others see a default. */
  nameHidden: boolean;
}

/** A practice or solo match, as reported for the server's count. */
export interface CasualReport {
  mode: 'practice' | 'solo';
  /** 1 to 4 in practice; null when none was locked in, and always in solo. */
  placement: number | null;
  wavesSurvived: number;
  wavesPlayed: number;
  reachedShowdown: boolean;
  /** The device's calendar day it ended on (progression/profile.ts, `dayKey`). */
  day: string;
}

/** Who is in the credits, as the server lists them. */
export interface Credits {
  /** Every Founder, by number, with the name they chose for the credits ('' for none yet). */
  founders: { number: number; name: string }[];
  /** Supporters who chose a name, in the order they supported. */
  supporters: { name: string }[];
}

/** How many Founders there are to be, what makes one, and how many are left. */
export interface FounderStatus {
  count: number;
  level: number;
  /** Online matches a Founder needs as well as the level. */
  onlineMatches: number;
  left: number;
}

/** Where a name was seen when it was reported: what the admin page groups by. */
export type ReportPlace = 'lobby' | 'match';

/** What setting a credits name came to. */
export type CreditAnswer =
  | { result: 'ok'; creditName: string }
  | { result: 'refused' }
  | { result: 'notSupporter' }
  | { result: 'blocked' };

const QUEUE_KEY = 'lane-siege.casualQueue';
const GONE_KEY = 'lane-siege.foundersGone';
/** How many unsent practice matches a device holds on to: a long train ride's worth. */
const QUEUE_LIMIT = 30;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** A summary as the server sent it, made safe to use; null for anything else. */
export function asSummary(value: unknown): PlayerSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.level !== 'number' || typeof v.xp !== 'number') return null;
  return {
    xp: count(v.xp),
    level: Math.max(1, count(v.level)),
    onlineMatches: count(v.onlineMatches),
    founderNumber:
      typeof v.founderNumber === 'number' && v.founderNumber >= 1
        ? Math.floor(v.founderNumber)
        : null,
    supporter: v.supporter === true,
    creditName: typeof v.creditName === 'string' ? v.creditName : '',
    creditBlocked: v.creditBlocked === true,
    badges: cleanWornBadges(v.badges),
    nameHidden: v.nameHidden === true,
  };
}

function asStatus(value: unknown): FounderStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const ok = [v.count, v.level, v.left].every((n) => typeof n === 'number' && n >= 0);
  if (!ok) return null;
  return {
    count: v.count as number,
    level: v.level as number,
    onlineMatches: count(v.onlineMatches),
    left: v.left as number,
  };
}

function asCredits(value: unknown): Credits | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.founders) || !Array.isArray(v.supporters)) return null;
  const text = (s: unknown) => (typeof s === 'string' ? s : '');
  return {
    founders: v.founders
      .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
      .filter((f) => typeof f.number === 'number' && f.number >= 1)
      .map((f) => ({ number: Math.floor(f.number as number), name: text(f.name) })),
    supporters: v.supporters
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({ name: text(s.name) }))
      .filter((s) => s.name !== ''),
  };
}

export class PlayerApi {
  private readonly base: string;

  constructor(
    server: string,
    private readonly identity: Identity,
    private readonly storage: KeyValueStore | null,
  ) {
    this.base = httpBase(server);
  }

  /** The server's record of this player, after sending any matches still waiting. */
  async me(): Promise<PlayerSummary | null> {
    await this.sendQueued();
    return asSummary(await this.post('/progress/me', { name: this.identity.name }));
  }

  /**
   * A practice or solo match ended: counted by the server as well, or kept to
   * send with the next question if it cannot be reached.
   */
  async reportCasual(match: CasualReport): Promise<PlayerSummary | null> {
    this.enqueue(match);
    await this.sendQueued();
    return this.me();
  }

  /** The ad's boost was earned: the server counts its waves too. */
  async boost(): Promise<boolean> {
    return (await this.post('/progress/boost', {})) !== null;
  }

  /** The badges this player wears now, by id: the server shows the others the ones it can vouch for. */
  async wear(badges: readonly string[]): Promise<PlayerSummary | null> {
    return asSummary(await this.post('/progress/wear', { badges }));
  }

  /** A test purchase on a test server (`?progress=test`): Supporter on, or off again. */
  async testSupporter(on: boolean): Promise<PlayerSummary | null> {
    return asSummary(await this.post('/supporter/test', { on }));
  }

  /** The name to show in the credits; empty to leave them. */
  async setCreditName(name: string): Promise<CreditAnswer | null> {
    const body = await this.post('/credits/name', { creditName: name }, true);
    if (typeof body !== 'object' || body === null) return null;
    const b = body as Record<string, unknown>;
    if (b.result === 'ok' && typeof b.creditName === 'string') {
      return { result: 'ok', creditName: b.creditName };
    }
    if (b.result === 'refused' || b.result === 'notSupporter' || b.result === 'blocked') {
      return { result: b.result };
    }
    return null;
  }

  /** Who is in the credits. Anyone may ask. */
  async credits(): Promise<Credits | null> {
    return asCredits(await this.get('/credits'));
  }

  /** Report the name a player is showing. True once the server has it. */
  async report(target: { playerId: string; name: string; where: ReportPlace }): Promise<boolean> {
    return (await this.post('/reports', { target })) !== null;
  }

  /** Whether the server has said every Founder number is gone: no point asking again. */
  get foundersGone(): boolean {
    try {
      return this.storage?.getItem(GONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** How many Founder stars are left, for the Supporter page. Null if the server cannot say. */
  async founderStatus(): Promise<FounderStatus | null> {
    const status = asStatus(await this.get('/founders/status'));
    if (status?.left === 0) {
      try {
        this.storage?.setItem(GONE_KEY, '1');
      } catch {
        // No storage: the same question again next time, which costs nothing.
      }
    }
    return status;
  }

  // ---------------------------------------------------------------- the queue

  private queued(): CasualReport[] {
    try {
      const raw = this.storage?.getItem(QUEUE_KEY);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? (list as CasualReport[]) : [];
    } catch {
      return [];
    }
  }

  private keep(list: CasualReport[]): void {
    try {
      this.storage?.setItem(QUEUE_KEY, JSON.stringify(list.slice(-QUEUE_LIMIT)));
    } catch {
      // Storage full or blocked: the match counted on the device, if not here.
    }
  }

  private enqueue(match: CasualReport): void {
    this.keep([...this.queued(), match]);
  }

  /** Send what is waiting, oldest first, stopping at the first that does not get through. */
  private async sendQueued(): Promise<void> {
    const list = this.queued();
    while (list.length > 0) {
      const status = await this.postStatus('/progress/casual', { match: list[0] });
      // No answer, or asked to slow down: it waits for next time. Anything
      // else - counted, or refused as malformed - is done with.
      if (status === null || status === 429) break;
      list.shift();
    }
    this.keep(list);
  }

  // ---------------------------------------------------------------- HTTP

  private async get(path: string): Promise<unknown> {
    try {
      const response = await fetch(`${this.base}${path}`);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  /** POST with this player's id and key; the body, or null for no answer or a refusal. */
  private async post(path: string, body: object, refusalsToo = false): Promise<unknown> {
    try {
      const response = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: this.identity.playerId,
          key: this.identity.key,
          ...body,
        }),
      });
      if (response.ok || (refusalsToo && response.status < 500)) return await response.json();
      return null;
    } catch {
      return null;
    }
  }

  /** POST, and say only how it went: the HTTP status, or null for no answer at all. */
  private async postStatus(path: string, body: object): Promise<number | null> {
    try {
      const response = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: this.identity.playerId,
          key: this.identity.key,
          ...body,
        }),
      });
      return response.status >= 500 ? null : response.status;
    } catch {
      return null;
    }
  }
}

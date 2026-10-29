/**
 * The Founders, from the client's side: claiming a number once this player's
 * level gets there, and asking how many are left. (docs/ARCHITECTURE.md,
 * "Founders"; the server's half is server/founderRoutes.ts.)
 *
 * Plain HTTP to the game server, like the saved builds (ghostApi.ts), and
 * allowed to fail the same way: no server, an old server, a phone between
 * towers - each is a null, and the claim is simply made again next time. A
 * claim is safe to repeat: the server gives a player the same number however
 * often they ask.
 *
 * Once the server has said every number is gone, this device stops asking.
 */

import { httpBase } from './ghostApi.ts';
import type { KeyValueStore } from './identity.ts';

/** What a claim comes to: a number, too soon, or every number gone. */
export type FounderAnswer =
  { result: 'founder'; number: number } | { result: 'full' } | { result: 'notYet'; level: number };

/** How many Founders there are to be, the level that makes one, and how many are left. */
export interface FounderStatus {
  count: number;
  level: number;
  left: number;
}

const GONE_KEY = 'lane-siege.foundersGone';

function asAnswer(value: unknown): FounderAnswer | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.result === 'founder' && typeof v.number === 'number' && v.number >= 1) {
    return { result: 'founder', number: Math.floor(v.number) };
  }
  if (v.result === 'full') return { result: 'full' };
  if (v.result === 'notYet' && typeof v.level === 'number') {
    return { result: 'notYet', level: v.level };
  }
  return null;
}

function asStatus(value: unknown): FounderStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const ok = [v.count, v.level, v.left].every((n) => typeof n === 'number' && n >= 0);
  return ok ? { count: v.count as number, level: v.level as number, left: v.left as number } : null;
}

export class Founders {
  private readonly base: string;

  constructor(
    server: string,
    private readonly playerId: string,
    private readonly storage: KeyValueStore | null,
  ) {
    this.base = httpBase(server);
  }

  /** Whether the server has said every number is gone: no point asking again. */
  get gone(): boolean {
    try {
      return this.storage?.getItem(GONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** This player has reached `level`: their number, if they are among the first. */
  async claim(level: number): Promise<FounderAnswer | null> {
    try {
      const response = await fetch(`${this.base}/founders/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.playerId, level }),
      });
      const answer = asAnswer(response.ok ? await response.json() : null);
      if (answer?.result === 'full') this.markGone();
      return answer;
    } catch {
      return null;
    }
  }

  /** How many are left, for the Supporter page. Null if the server cannot say. */
  async status(): Promise<FounderStatus | null> {
    try {
      const response = await fetch(`${this.base}/founders/status`);
      const status = asStatus(response.ok ? await response.json() : null);
      if (status?.left === 0) this.markGone();
      return status;
    } catch {
      return null;
    }
  }

  private markGone(): void {
    try {
      this.storage?.setItem(GONE_KEY, '1');
    } catch {
      // No storage: the same question again next time, which costs nothing.
    }
  }
}

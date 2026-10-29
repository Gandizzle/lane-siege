/**
 * The Founders, over plain HTTP on the game's own port (server/index.ts),
 * beside the saved-build questions. (docs/ARCHITECTURE.md, "Founders")
 *
 *   GET  /founders/status               how many there are to be, what makes
 *                                       one, and how many are left
 *   POST /founders/claim {playerId, key}
 *                                       this player's number, or that it is
 *                                       too soon, or that every number is gone
 *
 * A claim is worked out from the server's own count of the player
 * (playerStore.ts), never from anything the device says about its level, and
 * needs the player's key. A number is handed out by itself the moment the
 * count gets there, so the claim is a question rather than a request: the
 * game asks it through `/progress/me` (playerRoutes.ts), and this stays for
 * a client that asks this way.
 */

import type { FounderStore } from './founderStore.ts';
import {
  allow,
  clientAddress,
  notFound,
  parsed,
  playerIdFrom,
  readBody,
  reply,
  type Handler,
} from './http.ts';
import type { PlayerStore } from './playerStore.ts';
import type { RateLimiter } from './rateLimit.ts';

export interface FounderRouteOptions {
  founders: FounderStore;
  players: PlayerStore;
  limiter: RateLimiter;
  trustProxy: boolean;
}

/** The Founders' questions; anything else goes to `next`. */
export function founderRoutes(options: FounderRouteOptions, next: Handler = notFound): Handler {
  const { founders, players, limiter } = options;
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://server');
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/founders/')) return allow(res);
    const who = clientAddress(req, options.trustProxy);

    if (req.method === 'GET' && url.pathname === '/founders/status') {
      if (!limiter.allow('read', who)) return reply(res, 429, { error: 'too many questions' });
      return reply(res, 200, founders.status());
    }

    if (req.method === 'POST' && url.pathname === '/founders/claim') {
      readBody(req).then(
        (body) => {
          const request = parsed(body);
          const playerId = playerIdFrom(request?.playerId);
          if (!request || !playerId) {
            return reply(res, 400, { error: 'a playerId and a key are needed' });
          }
          if (!limiter.allow('read', who)) return reply(res, 429, { error: 'too many questions' });
          // Only a player the server already counts can be one.
          if (!players.has(playerId)) {
            const { level, onlineMatches } = founders.status();
            return reply(res, 200, { result: 'notYet', level, onlineMatches });
          }
          const proof = players.prove(playerId, request.key);
          if (!proof.ok)
            return reply(res, 403, { error: 'that player id belongs to another device' });
          const record = proof.record;
          return reply(
            res,
            200,
            founders.claim(playerId, players.level(record), record.onlineMatches),
          );
        },
        () => {
          if (!res.headersSent) reply(res, 413, { error: 'too long' });
        },
      );
      return;
    }

    next(req, res);
  };
}

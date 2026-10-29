/**
 * The Founders, over plain HTTP on the game's own port (server/index.ts),
 * beside the saved-build questions. (docs/ARCHITECTURE.md, "Founders")
 *
 *   GET  /founders/status               how many there are to be, the level
 *                                       that makes one, and how many are left
 *   POST /founders/claim {playerId, level}
 *                                       this player has reached `level`: their
 *                                       number, or that it is too soon, or that
 *                                       every number is gone
 *
 * Not room messages, because a level is reached at the end of a match, when
 * the room may already have closed, and the Supporter page asks how many are
 * left with no room at all.
 */

import type { FounderStore } from './founderStore.ts';
import { allow, notFound, parsed, playerIdFrom, readBody, reply, type Handler } from './http.ts';

/** The Founders' questions; anything else goes to `next`. */
export function founderRoutes(store: FounderStore, next: Handler = notFound): Handler {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://server');
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/founders/')) return allow(res);

    if (req.method === 'GET' && url.pathname === '/founders/status') {
      return reply(res, 200, store.status());
    }

    if (req.method === 'POST' && url.pathname === '/founders/claim') {
      readBody(req)
        .then((body) => {
          const request = parsed(body);
          const playerId = playerIdFrom(request?.playerId);
          const level = request?.level;
          if (!playerId || typeof level !== 'number' || !Number.isFinite(level)) {
            return reply(res, 400, { error: 'a playerId and a level are needed' });
          }
          return reply(res, 200, store.claim(playerId, level));
        })
        .catch(() => {
          if (!res.headersSent) reply(res, 413, { error: 'too long' });
        });
      return;
    }

    next(req, res);
  };
}

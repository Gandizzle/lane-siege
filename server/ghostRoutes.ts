/**
 * What a player asks about their saved build, over plain HTTP on the game's
 * own port (server/index.ts). (docs/ARCHITECTURE.md, "Saved builds")
 *
 *   GET  /ghosts/report?playerId=…   their saved build and how it has done,
 *                                    and the last one they could still keep
 *   POST /ghosts/keep  {playerId, key}
 *                                    keep the last one: it replaces the saved
 *
 * Not room messages, because both are wanted when there is no room: the home
 * screen asks how the build has done before any match, and Keep is pressed on
 * the card after one, when the room may already have closed. Colyseus answers
 * its own matchmaking requests on this port and hands every other request to
 * this.
 *
 * Open to any page, like every question here (http.ts). Keeping a build
 * replaces the one other people's matches play, so it takes the player's key
 * (net/identity.ts) whenever the server keeps players (playerStore.ts):
 * player ids are public, and a copied one must not be able to swap somebody's
 * saved build for a worse one.
 */

import type { GhostStore } from './ghostStore.ts';
import { allow, notFound, parsed, playerIdFrom, readBody, reply, type Handler } from './http.ts';
import type { PlayerStore } from './playerStore.ts';

/** The saved-build questions; anything else goes to `next`. */
export function ghostRoutes(
  store: GhostStore,
  next: Handler = notFound,
  players: PlayerStore | null = null,
): Handler {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://server');
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/ghosts/')) return allow(res);

    if (req.method === 'GET' && url.pathname === '/ghosts/report') {
      const playerId = playerIdFrom(url.searchParams.get('playerId'));
      if (!playerId) return reply(res, 400, { error: 'a playerId is needed' });
      return reply(res, 200, store.report(playerId));
    }

    if (req.method === 'POST' && url.pathname === '/ghosts/keep') {
      readBody(req)
        .then((body) => {
          const request = parsed(body);
          const playerId = playerIdFrom(request?.playerId);
          if (!playerId) return reply(res, 400, { error: 'a playerId is needed' });
          if (players && !players.prove(playerId, request?.key).ok) {
            return reply(res, 403, { error: 'that player id belongs to another device' });
          }
          const saved = store.keep(playerId);
          if (!saved) return reply(res, 404, { error: 'no build to keep' });
          return reply(res, 200, store.report(playerId));
        })
        .catch(() => {
          if (!res.headersSent) reply(res, 413, { error: 'too long' });
        });
      return;
    }

    next(req, res);
  };
}

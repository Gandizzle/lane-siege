/**
 * What a player asks about their saved build, over plain HTTP on the game's
 * own port (server/index.ts). (docs/ARCHITECTURE.md, "Saved builds")
 *
 *   GET  /ghosts/report?playerId=…   their saved build and how it has done,
 *                                    and the last one they could still keep
 *   POST /ghosts/keep  {playerId}    keep the last one: it replaces the saved
 *
 * Not room messages, because both are wanted when there is no room: the home
 * screen asks how the build has done before any match, and Keep is pressed on
 * the card after one, when the room may already have closed. Colyseus answers
 * its own matchmaking requests on this port and hands every other request to
 * this.
 *
 * Open to any page (CORS `*`): the game is served from wherever it is hosted,
 * the server from somewhere else, and nothing here is worth more than the
 * player id it is asked with.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GhostStore } from './ghostStore.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** A body bigger than a player id has no business here. */
const MAX_BODY = 1024;

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** A player id as identity.ts makes one, or a session id: short, and nothing else. */
function playerIdFrom(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}

/** The body, as text; refused past `MAX_BODY`, with the rest read and dropped. */
/** A JSON object, or null for a body that is not one. */
function parsed(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLong = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      if (tooLong) return;
      body += chunk;
      if (body.length > MAX_BODY) {
        tooLong = true;
        body = '';
      }
    });
    req.on('end', () => (tooLong ? reject(new Error('too long')) : resolve(body)));
    req.on('error', reject);
  });
}

export function ghostRoutes(
  store: GhostStore,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://server');
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/ghosts/')) {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/ghosts/report') {
      const playerId = playerIdFrom(url.searchParams.get('playerId'));
      if (!playerId) return reply(res, 400, { error: 'a playerId is needed' });
      return reply(res, 200, store.report(playerId));
    }

    if (req.method === 'POST' && url.pathname === '/ghosts/keep') {
      readBody(req)
        .then((body) => {
          const playerId = playerIdFrom(parsed(body)?.playerId);
          if (!playerId) return reply(res, 400, { error: 'a playerId is needed' });
          const saved = store.keep(playerId);
          if (!saved) return reply(res, 404, { error: 'no build to keep' });
          return reply(res, 200, store.report(playerId));
        })
        .catch(() => {
          if (!res.headersSent) reply(res, 413, { error: 'too long' });
        });
      return;
    }

    reply(res, 404, { error: 'not found' });
  };
}

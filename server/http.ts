/**
 * What the server's plain-HTTP questions share (ghostRoutes.ts,
 * founderRoutes.ts, playerRoutes.ts and the rest): who may ask, how an answer
 * is written, how a small JSON body is read without letting a large one in,
 * and who is asking.
 *
 * Open to any page (CORS `*`): the game is served from wherever it is hosted,
 * the server from somewhere else. Nothing here trusts the page that asks: a
 * question about a player's own record carries their key (net/identity.ts),
 * and the admin's carry the admin token (adminRoutes.ts).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Answers a request: each route module is one, handing on what it does not ask about. */
export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** A body bigger than a player id, a key and a few numbers has no business here. */
const MAX_BODY = 2048;

export function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** The preflight a browser sends before a POST from another origin. */
export function allow(res: ServerResponse): void {
  res.writeHead(204, CORS);
  res.end();
}

/** A page or a file: the admin page (adminPage.ts), the health check. */
export function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/**
 * Who is asking, as far as rate limits go (rateLimit.ts): the socket's
 * address, or - behind a host's proxy, which is where every host in
 * docs/GO-LIVE.md puts this server - the address the proxy saw. That is the
 * LAST entry of X-Forwarded-For: anything before it is whatever the asker
 * wrote, and an asker can write anything. Only trusted with `TRUST_PROXY`,
 * since without a proxy the whole header is the asker's own.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const list = Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '');
    const last = list
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .pop();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** A player id as identity.ts makes one, or a session id: short, and nothing else. */
export function playerIdFrom(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
}

/** A JSON object, or null for a body that is not one. */
export function parsed(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The body, as text; refused past `max` characters, with the rest read and dropped. */
export function readBody(req: IncomingMessage, max = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLong = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      if (tooLong) return;
      body += chunk;
      if (body.length > max) {
        tooLong = true;
        body = '';
      }
    });
    req.on('end', () => (tooLong ? reject(new Error('too long')) : resolve(body)));
    req.on('error', reject);
  });
}

/** The last word for a request nobody answered. */
export const notFound: Handler = (_req, res) => reply(res, 404, { error: 'not found' });

/**
 * What the server's plain-HTTP questions share (ghostRoutes.ts,
 * founderRoutes.ts): who may ask, how an answer is written, and how a small
 * JSON body is read without letting a large one in.
 *
 * Open to any page (CORS `*`): the game is served from wherever it is hosted,
 * the server from somewhere else, and nothing asked here is worth more than
 * the player id it is asked with.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/** Answers a request: each route module is one, handing on what it does not ask about. */
export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** A body bigger than a player id and a number has no business here. */
const MAX_BODY = 1024;

export function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** The preflight a browser sends before a POST from another origin. */
export function allow(res: ServerResponse): void {
  res.writeHead(204, CORS);
  res.end();
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

/** The body, as text; refused past `MAX_BODY`, with the rest read and dropped. */
export function readBody(req: IncomingMessage): Promise<string> {
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

/** The last word for a request nobody answered. */
export const notFound: Handler = (_req, res) => reply(res, 404, { error: 'not found' });

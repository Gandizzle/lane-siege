/**
 * Where the game sends crash reports (src/net/crashReporter.ts), over plain
 * HTTP on the game's own port. (docs/ARCHITECTURE.md, "Crash reports")
 *
 *   POST /crashes   one report, as JSON in a plain-text body
 *
 * Plain text, because a browser sends that to another origin without asking
 * first, and a report made as a page closes has no time to ask. No key and no
 * player id: a crash report is about the build, not the player. Counted
 * against the asker's address, so a broken build cannot fill the disk.
 */

import type { CrashStore } from './crashStore.ts';
import { parseCrash } from './crashStore.ts';
import { allow, clientAddress, notFound, parsed, readBody, reply, type Handler } from './http.ts';
import type { RateLimiter } from './rateLimit.ts';

/** A report with a long stack and a trail is a few kilobytes; more than this is not one. */
const MAX_REPORT = 16_000;

export interface CrashRouteOptions {
  crashes: CrashStore;
  limiter: RateLimiter;
  trustProxy: boolean;
}

export function crashRoutes(options: CrashRouteOptions, next: Handler = notFound): Handler {
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://server');
    if (url.pathname !== '/crashes') return next(req, res);
    if (req.method === 'OPTIONS') return allow(res);
    if (req.method !== 'POST') return next(req, res);
    if (!options.limiter.allow('crash', clientAddress(req, options.trustProxy))) {
      return reply(res, 429, { error: 'too many reports' });
    }
    readBody(req, MAX_REPORT).then(
      (body) => {
        const crash = parseCrash(parsed(body));
        if (!crash) return reply(res, 400, { error: 'not a crash report' });
        // A server report only ever comes from the server itself (index.ts).
        if (crash.kind === 'server') return reply(res, 400, { error: 'not a crash report' });
        options.crashes.add(crash);
        return reply(res, 200, { ok: true });
      },
      () => {
        if (!res.headersSent) reply(res, 413, { error: 'too long' });
      },
    );
  };
}

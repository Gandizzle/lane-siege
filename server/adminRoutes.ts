/**
 * The admin page and what it asks, on the game's own port. (docs/GO-LIVE.md
 * §17; docs/ARCHITECTURE.md, "The admin page")
 *
 *   GET  /admin                          the page (adminPage.ts)
 *   GET  /admin/api/overview             counts, at a glance
 *   GET  /admin/api/reports              name reports, grouped
 *   POST /admin/api/names {playerId, name, action}
 *                                        hide, allow, lock or unlock a name
 *   GET  /admin/api/crashes              crash reports, grouped
 *   POST /admin/api/crashes/clear        start the crash reports again
 *   GET  /admin/api/founders             the Founders, by number
 *   GET  /admin/api/credits              who is in the credits
 *   POST /admin/api/credits/remove {playerId}
 *                                        take a credits name away, for good
 *   GET  /admin/api/players?q=           find a player by id or name
 *   POST /admin/api/players/delete {playerId}
 *                                        forget a player: they asked
 *   GET  /admin/api/backup               everything the server keeps, as JSON
 *
 * Every question under /admin/api needs `Authorization: Bearer <ADMIN_TOKEN>`.
 * With no token set the admin page is off, and a wrong token is counted
 * against the asker's address (rateLimit.ts), so it cannot be guessed. The
 * page itself holds nothing: it asks for the token and keeps it in the
 * browser that typed it.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { ADMIN_PAGE } from './adminPage.ts';
import type { CrashStore } from './crashStore.ts';
import type { FounderStore } from './founderStore.ts';
import type { GhostStore } from './ghostStore.ts';
import {
  clientAddress,
  notFound,
  parsed,
  playerIdFrom,
  readBody,
  reply,
  send,
  type Handler,
} from './http.ts';
import type { Moderation } from './moderation.ts';
import type { PlayerRecord, PlayerStore } from './playerStore.ts';
import type { RateLimiter } from './rateLimit.ts';
import type { ReportStore } from './reportStore.ts';

export interface AdminOptions {
  /** The admin token; empty or absent turns the admin page off. */
  token: string | undefined;
  players: PlayerStore;
  founders: FounderStore;
  ghosts: GhostStore;
  moderation: Moderation;
  reports: ReportStore;
  crashes: CrashStore;
  limiter: RateLimiter;
  trustProxy: boolean;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Whether the request carries the admin token, compared in constant time. */
export function hasToken(header: string | undefined, token: string): boolean {
  const given = /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '';
  return given !== '' && timingSafeEqual(digest(given), digest(token));
}

/** One player, as the admin page lists them. */
function row(options: AdminOptions, record: PlayerRecord) {
  return {
    playerId: record.playerId,
    name: record.name,
    level: options.players.level(record),
    xp: record.xp,
    onlineMatches: record.onlineMatches,
    founderNumber: options.founders.numberOf(record.playerId),
    supporter: record.supporter?.via ?? null,
    creditName: record.creditName,
    creditBlocked: record.creditBlocked,
    nameLocked: options.moderation.isLocked(record.playerId),
    since: record.since,
    seen: record.seen,
  };
}

export function adminRoutes(options: AdminOptions, next: Handler = notFound): Handler {
  const { players, founders, moderation, reports, crashes } = options;
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://server');
    const path = url.pathname;
    if (path !== '/admin' && !path.startsWith('/admin/')) return next(req, res);

    if (req.method === 'GET' && (path === '/admin' || path === '/admin/')) {
      return send(res, 200, ADMIN_PAGE, 'text/html; charset=utf-8');
    }
    if (!path.startsWith('/admin/api/')) return reply(res, 404, { error: 'not found' });

    const token = options.token ?? '';
    if (!token)
      return reply(res, 503, { error: 'The admin page is off: set ADMIN_TOKEN on the server.' });
    const who = clientAddress(req, options.trustProxy);
    if (!hasToken(req.headers.authorization, token)) {
      if (!options.limiter.allow('adminFail', who))
        return reply(res, 429, { error: 'too many tries' });
      return reply(res, 401, { error: 'That is not the admin token.' });
    }

    if (req.method === 'GET') {
      switch (path) {
        case '/admin/api/overview': {
          const all = players.all();
          return reply(res, 200, {
            players: all.length,
            seenToday: all.filter((r) => Date.now() - Date.parse(r.seen) < 86_400_000).length,
            founders: founders.status(),
            supporters: all.filter((r) => r.supporter !== null).length,
            credits: all.filter((r) => r.creditName !== '').length,
            reports: reports.list().length,
            hiddenNames: moderation.hiddenList().length,
            crashesToday: crashes.countSince(new Date(Date.now() - 86_400_000)),
          });
        }
        case '/admin/api/reports':
          return reply(res, 200, {
            groups: reports.list().map((group) => ({
              ...group,
              reporters: group.reporters.length,
              hidden: moderation.isHidden(group.playerId, group.name),
              allowed: moderation.isAllowed(group.playerId, group.name),
              locked: moderation.isLocked(group.playerId),
              nameNow: players.get(group.playerId)?.name ?? '',
            })),
            hidden: moderation.hiddenList(),
            locked: moderation.lockedList(),
          });
        case '/admin/api/crashes':
          return reply(res, 200, { groups: crashes.groups() });
        case '/admin/api/founders':
          return reply(res, 200, {
            status: founders.status(),
            founders: founders.claims().map((claim) => {
              const record = players.get(claim.playerId);
              return { ...claim, name: record?.name ?? '', creditName: record?.creditName ?? '' };
            }),
          });
        case '/admin/api/credits':
          return reply(res, 200, {
            players: players
              .all()
              .filter((r) => r.creditName !== '' || r.creditBlocked)
              .map((r) => row(options, r)),
          });
        case '/admin/api/players':
          return reply(res, 200, {
            players: players.find(url.searchParams.get('q') ?? '').map((r) => row(options, r)),
          });
        case '/admin/api/backup':
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="game-backup-${new Date().toISOString().slice(0, 10)}.json"`,
          );
          return reply(res, 200, {
            at: new Date().toISOString(),
            players: players.all(),
            founders: founders.claims(),
            moderation: moderation.snapshot(),
            reports: reports.list(),
            savedBuilds: options.ghosts.savedBuilds(),
          });
        default:
          return reply(res, 404, { error: 'not found' });
      }
    }

    if (req.method !== 'POST') return reply(res, 404, { error: 'not found' });

    readBody(req).then(
      (body) => {
        const request = parsed(body) ?? {};
        const playerId = playerIdFrom(request.playerId);
        switch (path) {
          case '/admin/api/names': {
            const name = typeof request.name === 'string' ? request.name : '';
            if (!playerId) return reply(res, 400, { error: 'whose name?' });
            switch (request.action) {
              case 'hide':
                if (!name) return reply(res, 400, { error: 'which name?' });
                moderation.hide(playerId, name, 'admin');
                reports.clear(playerId, name);
                break;
              case 'allow':
                if (!name) return reply(res, 400, { error: 'which name?' });
                moderation.allow(playerId, name);
                reports.clear(playerId, name);
                break;
              case 'lock':
                moderation.setLocked(playerId, true);
                for (const group of reports.list()) {
                  if (group.playerId === playerId) reports.clear(playerId, group.name);
                }
                break;
              case 'unlock':
                moderation.setLocked(playerId, false);
                break;
              default:
                return reply(res, 400, { error: 'hide, allow, lock or unlock?' });
            }
            return reply(res, 200, { ok: true });
          }
          case '/admin/api/crashes/clear':
            crashes.clear();
            return reply(res, 200, { ok: true });
          case '/admin/api/credits/remove': {
            const record = playerId ? players.get(playerId) : null;
            if (!record) return reply(res, 404, { error: 'no such player' });
            players.blockCredit(record);
            return reply(res, 200, { ok: true });
          }
          case '/admin/api/players/delete': {
            if (!playerId) return reply(res, 400, { error: 'which player?' });
            const known = players.delete(playerId);
            founders.forget(playerId);
            options.ghosts.forget(playerId);
            moderation.forget(playerId);
            reports.forget(playerId);
            return reply(res, 200, { ok: true, known });
          }
          default:
            return reply(res, 404, { error: 'not found' });
        }
      },
      () => {
        if (!res.headersSent) reply(res, 413, { error: 'too long' });
      },
    );
  };
}

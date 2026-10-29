/**
 * What a player asks about their own record, the credits, and name reports,
 * over plain HTTP on the game's own port (server/index.ts).
 * (docs/ARCHITECTURE.md, "What the server keeps"; the client's half is
 * src/net/playerApi.ts.)
 *
 *   POST /progress/me      {playerId, key, name?}   their record, as the server counts it
 *   POST /progress/casual  {playerId, key, match}   a practice or solo match, for the count
 *   POST /progress/boost   {playerId, key}          the ad's boost was earned
 *   POST /progress/wear    {playerId, key, badges}  the badges they wear now
 *   POST /supporter/test   {playerId, key, on}      a test purchase (a test server only)
 *   POST /supporter/verify {playerId, key}          ask RevenueCat whether they bought it
 *   POST /credits/name     {playerId, key, creditName}  their name in the credits
 *   GET  /credits                                   who is in the credits
 *   POST /reports          {playerId, key, target}  report the name a player is showing
 *
 * Every POST carries the player's key (net/identity.ts): an id the server has
 * not seen is taken by the first key it comes with, and after that the id
 * means nothing with any other. Every question is counted against the
 * asker's address (rateLimit.ts), and a new id against a tighter count still.
 */

import { acceptableCreditName, acceptableName } from '../src/net/identity.ts';
import { cleanBadgeIds } from '../src/net/lobby.ts';
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
import type { Moderation } from './moderation.ts';
import { parseCasualReport, type PlayerRecord, type PlayerStore } from './playerStore.ts';
import type { RateLimiter } from './rateLimit.ts';
import { reportedId, type ReportStore } from './reportStore.ts';
import type { SupporterCheck } from './supporterCheck.ts';

export interface PlayerRouteOptions {
  players: PlayerStore;
  moderation: Moderation;
  reports: ReportStore;
  limiter: RateLimiter;
  /** Read the asker's address from the host's proxy (http.ts, `clientAddress`). */
  trustProxy: boolean;
  /** Honour test purchases: a test server only, never one players use. */
  testPurchases: boolean;
  /** Who to ask about real purchases; null until RevenueCat is set up. */
  supporterCheck: SupporterCheck | null;
}

/** Where a reported name was seen. */
const PLACES = new Set(['lobby', 'match']);

/** Paths these routes answer. */
function isMine(path: string): boolean {
  return (
    path.startsWith('/progress/') ||
    path.startsWith('/supporter/') ||
    path === '/credits' ||
    path === '/credits/name' ||
    path === '/reports'
  );
}

/** The player's record, with whether the name they are showing is hidden. */
function summaryOf(options: PlayerRouteOptions, record: PlayerRecord) {
  return options.players.summary(
    record,
    record.name !== '' && options.moderation.isHidden(record.playerId, record.name),
  );
}

export function playerRoutes(options: PlayerRouteOptions, next: Handler = notFound): Handler {
  const { players, limiter } = options;
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://server');
    const path = url.pathname;
    if (!isMine(path)) return next(req, res);
    if (req.method === 'OPTIONS') return allow(res);
    const who = clientAddress(req, options.trustProxy);

    if (req.method === 'GET' && path === '/credits') {
      if (!limiter.allow('read', who)) return reply(res, 429, { error: 'too many questions' });
      return reply(res, 200, players.credits());
    }
    if (req.method !== 'POST') return next(req, res);

    const answer = async (body: string) => {
      const request = parsed(body);
      const playerId = playerIdFrom(request?.playerId);
      if (!request || !playerId)
        return reply(res, 400, { error: 'a playerId and a key are needed' });
      const kind = path === '/reports' ? 'report' : path === '/progress/me' ? 'read' : 'write';
      if (!limiter.allow(kind, who)) return reply(res, 429, { error: 'too many questions' });
      // A new player id costs more than a question: it is what a script makes.
      if (!players.has(playerId) && !limiter.allow('register', who)) {
        return reply(res, 429, { error: 'too many new players' });
      }
      const proof = players.prove(playerId, request.key);
      if (!proof.ok) {
        return proof.reason === 'badKey'
          ? reply(res, 400, { error: 'a key is needed' })
          : reply(res, 403, { error: 'that player id belongs to another device' });
      }
      const record = proof.record;

      switch (path) {
        case '/progress/me': {
          const name = acceptableName(String(request.name ?? ''));
          if (name) players.noteName(record, name);
          return reply(res, 200, summaryOf(options, record));
        }

        case '/progress/casual': {
          const match = parseCasualReport(request.match);
          if (!match) return reply(res, 400, { error: 'not a match anybody played' });
          players.recordCasual(record, match);
          return reply(res, 200, summaryOf(options, record));
        }

        case '/progress/boost':
          return reply(res, 200, { boosted: players.boost(record) });

        case '/progress/wear':
          players.wear(record, cleanBadgeIds(request.badges));
          return reply(res, 200, summaryOf(options, record));

        case '/supporter/test':
          if (!options.testPurchases) {
            return reply(res, 403, { error: 'test purchases are off on this server' });
          }
          players.setSupporter(record, request.on === false ? null : 'test');
          return reply(res, 200, summaryOf(options, record));

        case '/supporter/verify': {
          const check = options.supporterCheck;
          if (!check) return reply(res, 501, { error: 'purchases are not connected yet' });
          const bought = await check.check(playerId);
          if (bought === null)
            return reply(res, 502, { error: 'the purchase could not be checked' });
          if (bought) players.setSupporter(record, 'revenuecat');
          // Refunded: the badge and the credits go with it.
          else if (record.supporter?.via === 'revenuecat') players.setSupporter(record, null);
          return reply(res, 200, summaryOf(options, record));
        }

        case '/credits/name': {
          const typed = String(request.creditName ?? '');
          const name = typed.trim() === '' ? '' : acceptableCreditName(typed);
          if (typed.trim() !== '' && !name) return reply(res, 200, { result: 'refused' });
          const result = players.setCreditName(record, name);
          if (result !== 'ok') return reply(res, 403, { result });
          return reply(res, 200, { result, creditName: record.creditName });
        }

        case '/reports': {
          const target = (
            typeof request.target === 'object' && request.target !== null ? request.target : {}
          ) as Record<string, unknown>;
          const seen = typeof target.playerId === 'string' ? target.playerId.slice(0, 80) : '';
          const name = typeof target.name === 'string' ? target.name.slice(0, 40) : '';
          const place = typeof target.where === 'string' ? target.where : '';
          if (!seen || !name || !PLACES.has(place)) {
            return reply(res, 400, { error: 'say whose name, which name and where' });
          }
          const reported = reportedId(seen);
          // Nobody reports themselves into a hidden name.
          if (reported === playerId) return reply(res, 400, { error: 'that is your own name' });
          return reply(res, 200, { outcome: options.reports.add(playerId, reported, name, place) });
        }

        default:
          return reply(res, 404, { error: 'not found' });
      }
    };

    readBody(req).then(
      (body) =>
        answer(body).catch((error: unknown) => {
          console.error('[lane-siege] a player question failed:', error);
          if (!res.headersSent) reply(res, 500, { error: 'something went wrong' });
        }),
      () => {
        if (!res.headersSent) reply(res, 413, { error: 'too long' });
      },
    );
  };
}

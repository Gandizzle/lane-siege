/**
 * Everything the server answers over plain HTTP, in one handler, and the
 * stores behind it. (docs/ARCHITECTURE.md, "What the server keeps")
 *
 * server/index.ts builds these from files under `DATA_DIR`; the tests and the
 * headless checks build the same thing in memory (`memoryParts`), so what they
 * check is the server as it runs, not a copy of it.
 */

import { COSMETICS, PROGRESSION, ROSTER, STORE } from '../src/progression/config.ts';
import { topLevel } from '../src/progression/levels.ts';
import { keysForEverything } from '../src/progression/store.ts';
import { adminRoutes } from './adminRoutes.ts';
import { CrashStore } from './crashStore.ts';
import { crashRoutes } from './crashRoutes.ts';
import { MemoryFounderStore, type FounderRules, type FounderStore } from './founderStore.ts';
import { founderRoutes } from './founderRoutes.ts';
import { MemoryGhostStore, type GhostStore } from './ghostStore.ts';
import { ghostRoutes } from './ghostRoutes.ts';
import { notFound, send, type Handler } from './http.ts';
import { Moderation } from './moderation.ts';
import { PlayerStore, type PlayerRules } from './playerStore.ts';
import { playerRoutes } from './playerRoutes.ts';
import { LIMITS, RateLimiter, type Limit } from './rateLimit.ts';
import { ReportStore } from './reportStore.ts';
import type { SupporterCheck } from './supporterCheck.ts';

/** The stores the server answers from. */
export interface ServerParts {
  ghosts: GhostStore;
  founders: FounderStore;
  players: PlayerStore;
  moderation: Moderation;
  reports: ReportStore;
  crashes: CrashStore;
  limiter: RateLimiter;
}

/** How this server is set up (server/index.ts reads these from its environment). */
export interface ServerSettings {
  /** The admin page's token; absent turns the page off. */
  adminToken?: string | undefined;
  /** Behind a host's proxy (http.ts, `clientAddress`). */
  trustProxy: boolean;
  /** A test server: the test build's free Supporter counts. */
  testPurchases: boolean;
  /** Who to ask about real purchases; null until RevenueCat is set up. */
  supporterCheck: SupporterCheck | null;
}

/** The rules a player record is counted by: the game's own data. */
export function playerRules(): PlayerRules {
  return {
    progression: PROGRESSION,
    cosmetics: COSMETICS,
    topLevel: topLevel(
      keysForEverything(PROGRESSION, COSMETICS, ROSTER),
      PROGRESSION.keys.perLevel,
    ),
  };
}

/** Every store in memory: for the tests and the headless checks. */
export function memoryParts(
  options: { founders?: FounderRules; limits?: Record<string, Limit>; autoHide?: number } = {},
): ServerParts {
  const founders = new MemoryFounderStore(options.founders ?? STORE.founders);
  const moderation = new Moderation();
  return {
    ghosts: new MemoryGhostStore(),
    founders,
    players: new PlayerStore(playerRules(), founders),
    moderation,
    reports: new ReportStore(moderation, options.autoHide),
    crashes: new CrashStore(),
    limiter: new RateLimiter(options.limits ?? LIMITS),
  };
}

/** `/health`: what a host asks to see the server is up. */
function health(next: Handler): Handler {
  return (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, 'ok', 'text/plain');
    next(req, res);
  };
}

/** Every plain-HTTP question the server answers; anything else is not found. */
export function serverRoutes(parts: ServerParts, settings: ServerSettings): Handler {
  const { trustProxy } = settings;
  const { players, founders, ghosts, moderation, reports, crashes, limiter } = parts;
  const ghostsAndRest = ghostRoutes(ghosts, notFound, players);
  const crashAndRest = crashRoutes({ crashes, limiter, trustProxy }, ghostsAndRest);
  const founderAndRest = founderRoutes({ founders, players, limiter, trustProxy }, crashAndRest);
  const playerAndRest = playerRoutes(
    {
      players,
      moderation,
      reports,
      limiter,
      trustProxy,
      testPurchases: settings.testPurchases,
      supporterCheck: settings.supporterCheck,
    },
    founderAndRest,
  );
  return health(
    adminRoutes(
      {
        token: settings.adminToken,
        players,
        founders,
        ghosts,
        moderation,
        reports,
        crashes,
        limiter,
        trustProxy,
      },
      playerAndRest,
    ),
  );
}

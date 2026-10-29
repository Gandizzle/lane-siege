/**
 * The server. `npm run server`. DESIGN.md §15.2, §17 (M4, M6).
 *
 * Loads the same `data/` the client loads, stands up a Colyseus room, and
 * waits. Everything interesting is in `room.ts`; this file is the socket, the
 * port, and the one line that makes matchmaking work.
 *
 * MATCHMAKING IS ONE FILTER
 *
 * `filterBy(['code'])` is the whole of it. A client calls `joinOrCreate` with a
 * code, and Colyseus will only ever put them in a room that was opened with the
 * same one:
 *
 *   - Quick match sends the empty code, so everyone asking for a quick match
 *     lands in the same open room until it fills, and the next one opens a
 *     fresh room. That is matchmaking.
 *   - A private room sends a four-character code (`src/net/lobby.ts`). Whoever
 *     arrives first creates the room; their friends type the code and join it.
 *     A code nobody else is using opens an empty room of that name, which is
 *     visible on screen and fixed by retyping - better than an error, because
 *     "nobody is here yet" and "you typed it wrong" want the same next action.
 *
 * There is no separate lobby server and no room list, because neither adds
 * anything a four-player game with a shareable code needs.
 *
 * SAVED BUILDS
 *
 * Kept between matches: each player's saved build, which fills empty
 * quick-match seats in other people's games (src/bot/ghost.ts), and their
 * last one, for them to keep or not. They are files under `GHOST_DIR`
 * (default `DATA_DIR/ghosts`), read in at start-up (ghostStore.ts), and the two
 * questions a player asks about theirs - how has it done, keep my last one -
 * are plain HTTP on this same port (ghostRoutes.ts), since Colyseus answers its
 * own matchmaking requests here and hands every other request on.
 *
 * WHAT ELSE IT KEEPS
 *
 * Everything the server keeps between restarts lives under `DATA_DIR`
 * (default `./server-data`), which is the one directory a host's disk has to
 * hold (docs/GO-LIVE.md §5):
 *
 *   players/        each player's record: proof the id is theirs, the XP the
 *                   server counts, the badges they wear, a credits name
 *                   (playerStore.ts, playerRoutes.ts)
 *   founders.json   the Founders, numbered in the order they got there
 *                   (founderStore.ts, founderRoutes.ts)
 *   ghosts/         saved builds (ghostStore.ts, ghostRoutes.ts)
 *   moderation.json names hidden after reports, reports.json the reports
 *                   (moderation.ts, reportStore.ts)
 *   crashes.jsonl   crash reports (crashStore.ts, crashRoutes.ts)
 *
 * All of it is plain HTTP on this same port, beside the admin page
 * (adminRoutes.ts, at /admin, with `ADMIN_TOKEN`) and `/health`, which a host
 * asks to see the server is up.
 *
 * The other settings, all optional:
 *
 *   ADMIN_TOKEN            the admin page's password; without it the page is off
 *   TRUST_PROXY=1          behind a host's proxy: read the visitor's address from it
 *   REVENUECAT_SECRET_KEY  check Supporter purchases with RevenueCat (supporterCheck.ts)
 *   ALLOW_TEST_PURCHASES=1 honour the test build's free Supporter: a test server only
 *
 * Note what is NOT deployed: the GitHub Pages build (§15.2) is static, so it
 * cannot run this. Multiplayer therefore means running this process somewhere
 * and pointing the client at it with `?server=`. Hosting it is the last piece
 * of M6 that money rather than code buys.
 */

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { loadDataFromDisk } from '../src/data/loadNode.ts';
import { formatReport } from '../src/data/validate.ts';
import { ROOM_NAME } from '../src/net/protocol.ts';
import { STORE } from '../src/progression/config.ts';
import { FileCrashStore } from './crashStore.ts';
import { FileFounderStore } from './founderStore.ts';
import { FileGhostStore } from './ghostStore.ts';
import { FileModeration } from './moderation.ts';
import { FilePlayerStore } from './playerStore.ts';
import { RateLimiter } from './rateLimit.ts';
import { FileReportStore } from './reportStore.ts';
import { LaneSiegeRoom, MAX_PLAYERS } from './room.ts';
import { playerRules, serverRoutes } from './routes.ts';
import { RevenueCatCheck } from './supporterCheck.ts';

const port = Number(process.env.PORT ?? 2567);
/** Start with whoever has turned up after this long, rather than never. */
const autoStartSeconds = Number(process.env.AUTO_START_SECONDS ?? 60);
/** Hold a room open this long before starting it short-handed. */
const minWaitSeconds = Number(process.env.MIN_WAIT_SECONDS ?? 10);
/** How long a dropped player's seat is kept for them. */
const reconnectSeconds = Number(process.env.RECONNECT_SECONDS ?? 90);
/** Where everything the server keeps lives: the one directory a host's disk must hold. */
const dataDir = resolve(process.env.DATA_DIR ?? join(process.cwd(), 'server-data'));
mkdirSync(dataDir, { recursive: true });
/** Where saved builds are kept. */
const ghostDir = process.env.GHOST_DIR ?? join(dataDir, 'ghosts');
/** Where the Founders are kept. */
const foundersFile = process.env.FOUNDERS_FILE ?? join(dataDir, 'founders.json');
/** Behind a host's proxy: the visitor's address is the one it saw (http.ts, `clientAddress`). */
const trustProxy = process.env.TRUST_PROXY === '1';
/** A test server: the test build's free Supporter counts. Never on one players use. */
const testPurchases = process.env.ALLOW_TEST_PURCHASES === '1';
const adminToken = process.env.ADMIN_TOKEN?.trim() || undefined;
const revenueCatKey = process.env.REVENUECAT_SECRET_KEY?.trim() || undefined;

const { data, report } = loadDataFromDisk();
if (report.errors.length > 0 || report.missing.length > 0) {
  console.info('[lane-siege] balance data status\n%s', formatReport(report));
}

const ghosts = new FileGhostStore(ghostDir);
const founders = new FileFounderStore(STORE.founders, foundersFile);
const players = new FilePlayerStore(playerRules(), founders, join(dataDir, 'players'));
const moderation = new FileModeration(join(dataDir, 'moderation.json'));
const reports = new FileReportStore(moderation, join(dataDir, 'reports.json'));
const crashes = new FileCrashStore(join(dataDir, 'crashes.jsonl'));
const limiter = new RateLimiter();

// The server's own failures go where the game's do, for the admin page.
const serverCrash = (kind: string, error: unknown) => {
  const e = error instanceof Error ? error : new Error(String(error));
  crashes.add({
    kind: 'server',
    message: `${kind}: ${e.message}`.slice(0, 300),
    stack: (e.stack ?? '').slice(0, 4000),
    source: '',
    version: process.env.npm_package_version ?? '',
    build: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? '',
    edition: 'server',
    agent: `node ${process.version}`,
    screen: '',
    scene: '',
    trail: [],
    session: String(process.pid),
    at: new Date().toISOString(),
  });
};
process.on('unhandledRejection', (error) => {
  console.error('[lane-siege] unhandled rejection:', error);
  serverCrash('unhandled rejection', error);
});
process.on('uncaughtException', (error) => {
  console.error('[lane-siege] uncaught exception:', error);
  serverCrash('uncaught exception', error);
  // Whatever threw left the process in a state nobody planned for: the host
  // starts a fresh one.
  process.exit(1);
});

const routes = serverRoutes(
  { ghosts, founders, players, moderation, reports, crashes, limiter },
  {
    adminToken,
    trustProxy,
    testPurchases,
    supporterCheck: revenueCatKey ? new RevenueCatCheck(revenueCatKey) : null,
  },
);

const server = new Server({
  transport: new WebSocketTransport({ server: createServer(routes) }),
});

server
  .define(ROOM_NAME, LaneSiegeRoom, {
    data,
    autoStartSeconds,
    minWaitSeconds,
    reconnectSeconds,
    ghosts,
    players,
    moderation,
  })
  // The one line of matchmaking: a room only ever meets clients that asked for
  // its code. See the note above.
  .filterBy(['code']);

server
  .listen(port)
  .then(() => {
    console.log(`[lane-siege] room "${ROOM_NAME}" listening on ws://localhost:${port}`);
    console.log(
      `[lane-siege] up to ${MAX_PLAYERS} players; a room starts ${minWaitSeconds}s after everyone in it is ready, or after ${autoStartSeconds}s regardless`,
    );
    console.log(`[lane-siege] a dropped player has ${reconnectSeconds}s to come back`);
    console.log(`[lane-siege] everything the server keeps is in ${dataDir}`);
    const { left, count, level, onlineMatches } = founders.status();
    console.log(
      `[lane-siege] Founders: ${left} of ${count} left, at level ${level} with ${onlineMatches} online matches`,
    );
    const known = players.all().length;
    console.log(`[lane-siege] ${known} player${known === 1 ? '' : 's'} known`);
    console.log(
      adminToken
        ? '[lane-siege] the admin page is at /admin'
        : '[lane-siege] the admin page is off: set ADMIN_TOKEN to turn it on',
    );
    if (testPurchases) console.log('[lane-siege] TEST SERVER: test purchases count here');
    if (revenueCatKey) console.log('[lane-siege] Supporter purchases are checked with RevenueCat');
    console.log(
      `[lane-siege] point a client at it: http://localhost:5173/lane-siege/?server=ws://localhost:${port}`,
    );
  })
  .catch((error: unknown) => {
    console.error('[lane-siege] could not listen:', error);
    process.exit(1);
  });

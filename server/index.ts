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
 * There is no separate lobby server, no room list and no database, because none
 * of those add anything a four-player game with a shareable code needs.
 *
 * Note what is NOT deployed: the GitHub Pages build (§15.2) is static, so it
 * cannot run this. Multiplayer therefore means running this process somewhere
 * and pointing the client at it with `?server=`. Hosting it is the last piece
 * of M6 that money rather than code buys.
 */

import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { loadDataFromDisk } from '../src/data/loadNode.ts';
import { formatReport } from '../src/data/validate.ts';
import { ROOM_NAME } from '../src/net/protocol.ts';
import { LaneSiegeRoom, MAX_PLAYERS } from './room.ts';

const port = Number(process.env.PORT ?? 2567);
/** Start with whoever has turned up after this long, rather than never. */
const autoStartSeconds = Number(process.env.AUTO_START_SECONDS ?? 60);
/** Hold a room open this long before starting it short-handed. */
const minWaitSeconds = Number(process.env.MIN_WAIT_SECONDS ?? 10);
/** How long a dropped player's seat is kept for them. */
const reconnectSeconds = Number(process.env.RECONNECT_SECONDS ?? 90);

const { data, report } = loadDataFromDisk();
if (report.errors.length > 0 || report.missing.length > 0) {
  console.info('[lane-siege] balance data status\n%s', formatReport(report));
}

const server = new Server({
  transport: new WebSocketTransport(),
});

server
  .define(ROOM_NAME, LaneSiegeRoom, {
    data,
    autoStartSeconds,
    minWaitSeconds,
    reconnectSeconds,
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
    console.log(
      `[lane-siege] point a client at it: http://localhost:5173/lane-siege/?server=ws://localhost:${port}`,
    );
  })
  .catch((error: unknown) => {
    console.error('[lane-siege] could not listen:', error);
    process.exit(1);
  });

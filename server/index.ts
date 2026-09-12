/**
 * The server. `npm run server`. DESIGN.md §15.2, §17 (M4).
 *
 * Loads the same `data/` the client loads, stands up a Colyseus room, and
 * waits. Everything interesting is in `room.ts`; this file is the socket and
 * the port.
 *
 * Note what is NOT deployed: the GitHub Pages build (§15.2, hosting-dev) is
 * static, so it cannot run this. Multiplayer therefore means running this
 * process somewhere and pointing the client at it with `?server=`. A real host
 * is M6 work, along with the lobby and matchmaking it needs.
 */

import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { loadDataFromDisk } from '../src/data/loadNode.ts';
import { formatReport } from '../src/data/validate.ts';
import { ROOM_NAME } from '../src/net/protocol.ts';
import { LaneSiegeRoom, MAX_PLAYERS } from './room.ts';

const port = Number(process.env.PORT ?? 2567);
/** Start with whoever has turned up after this long, rather than never. */
const autoStartSeconds = Number(process.env.AUTO_START_SECONDS ?? 20);

const { data, report } = loadDataFromDisk();
if (report.errors.length > 0 || report.missing.length > 0) {
  console.info('[lane-siege] balance data status\n%s', formatReport(report));
}

const server = new Server({
  transport: new WebSocketTransport(),
});

server.define(ROOM_NAME, LaneSiegeRoom, { data, autoStartSeconds });

server
  .listen(port)
  .then(() => {
    console.log(`[lane-siege] room "${ROOM_NAME}" listening on ws://localhost:${port}`);
    console.log(
      `[lane-siege] up to ${MAX_PLAYERS} players; starts in ${autoStartSeconds}s if not full`,
    );
    console.log(
      `[lane-siege] point a client at it: http://localhost:5173/lane-siege/?server=ws://localhost:${port}`,
    );
  })
  .catch((error: unknown) => {
    console.error('[lane-siege] could not listen:', error);
    process.exit(1);
  });

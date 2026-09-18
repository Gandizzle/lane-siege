/**
 * End-to-end check of the networked path. `npm run netcheck`.
 *
 * Starts a real server, joins it with two real clients, and asserts the things
 * that only break once a socket is involved: that each client is seated in its
 * own lane, that frames arrive, that a command sent by one player changes that
 * player's lane and not anyone else's, that a refusal comes back to whoever
 * asked, and - the one that matters most - that what arrives really is filtered
 * (§12).
 *
 * This exists because unit tests cannot catch a fog-of-war leak that happens in
 * the encoding, in the broadcast, or in the room's choice of who to send what
 * to. Those are exactly the places a leak would hide.
 */

import { Server } from 'colyseus';
import { Client } from 'colyseus.js';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { LaneSiegeRoom } from '../../server/room.ts';
import { ROOM_NAME } from '../net/protocol.ts';
import { buildTables, decodeFrame, type WireFrame, type WireHello } from '../net/protocol.ts';
import type { MatchView } from '../sim/index.ts';

const PORT = 2599;
const loaded = loadDataFromDisk();

/**
 * The real balance data, with gems in hand.
 *
 * Gems are earned per wave (§11.2) and start at zero, so a check that runs for
 * four seconds cannot afford a send with the shipped numbers - the refusal
 * would be correct and the check would be testing nothing. Everything else is
 * the real data, and the room is given this copy the same way it would be given
 * any other.
 */
const data = structuredClone(loaded.data);
data.economy.startingGems = 300;

interface Seen {
  teamId: string;
  frames: number;
  view: MatchView | null;
  rejections: string[];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const failures: string[] = [];
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
    failures.push(label);
  }
}

async function main(): Promise<void> {
  const server = new Server();
  // Start immediately rather than waiting for four players.
  server.define(ROOM_NAME, LaneSiegeRoom, { data, autoStartSeconds: 1 });
  await server.listen(PORT);
  console.log(`server up on ${PORT}`);

  const endpoint = `ws://localhost:${PORT}`;
  const seen: Seen[] = [];

  for (let i = 0; i < 2; i++) {
    const client = new Client(endpoint);
    const room = await client.joinOrCreate(ROOM_NAME);
    const mine: Seen = { teamId: '', frames: 0, view: null, rejections: [] };
    seen.push(mine);

    let tables: ReturnType<typeof buildTables> | null = null;
    // Registered so Colyseus does not warn about it. This harness is about
    // frames and fog of war; the lobby has its own harness (npm run lobby).
    room.onMessage('lobby', () => {});

    room.onMessage('hello', (hello: WireHello) => {
      mine.teamId = hello.teamId;
      tables = buildTables(data, hello.teamIds, hello.seed);
    });
    room.onMessage('frame', (frame: WireFrame) => {
      if (!tables) return;
      mine.frames++;
      mine.view = decodeFrame(frame, tables);
    });
    room.onMessage('rejected', (rejection: string) => {
      mine.rejections.push(rejection);
    });

    // Hold onto the rooms so they are not garbage collected mid-run.
    rooms.push(room);
  }

  await wait(600);
  const [a, b] = seen;
  if (!a || !b) throw new Error('clients did not join');

  check('both clients are seated', a.teamId !== '' && b.teamId !== '', `${a.teamId} / ${b.teamId}`);
  check('each has its own lane', a.teamId !== b.teamId, `${a.teamId} vs ${b.teamId}`);

  // Let the match start and frames flow.
  await wait(1800);
  check('frames are arriving', a.frames > 10 && b.frames > 10, `${a.frames} / ${b.frames}`);
  check('a view has its own lane', a.view?.lane?.teamId === a.teamId);
  check('a view has three opponents', (a.view?.opponents.length ?? 0) === 3);

  // §12: the public record and nothing more.
  const opponent = a.view?.opponents[0];
  check('opponent fortress HP is public', (opponent?.fortressMaxHp ?? 0) > 0);
  check('opponent lanes are not readable', Object.keys(a.view?.watching ?? {}).length === 0);
  check('own wallet is present', (a.view?.lane?.economy?.gold ?? -1) >= 0);

  // A purchase by A must land in A's lane and nobody else's.
  const goldBefore = a.view?.lane?.economy?.gold ?? 0;
  rooms[0]!.send('command', {
    kind: 'placeUnit',
    teamId: a.teamId,
    unitDefId: 'pledge',
    tileX: 3,
    tileY: 6,
  });
  await wait(500);
  check(
    'the buyer got the unit',
    (a.view?.lane?.units.length ?? 0) > 0,
    `${a.view?.lane?.units.length}`,
  );
  check('gold was spent', (a.view?.lane?.economy?.gold ?? 0) < goldBefore);

  // A command aimed at someone else's lane is rewritten to the sender's own, so
  // this places in A's lane again rather than in B's.
  const bUnitsBefore = b.view?.lane?.units.length ?? 0;
  rooms[0]!.send('command', {
    kind: 'placeUnit',
    teamId: b.teamId,
    unitDefId: 'pledge',
    tileX: 5,
    tileY: 6,
  });
  await wait(500);
  check(
    'a client cannot act for another lane',
    (b.view?.lane?.units.length ?? 0) === bUnitsBefore,
    `b had ${bUnitsBefore}, now ${b.view?.lane?.units.length}`,
  );

  // A refusal comes back to whoever asked for it.
  rooms[0]!.send('command', {
    kind: 'placeUnit',
    teamId: a.teamId,
    unitDefId: 'not_a_real_unit',
    tileX: 1,
    tileY: 1,
  });
  await wait(500);
  check('refusals reach the sender', a.rejections.length > 0, a.rejections.join(','));
  check('and nobody else', b.rejections.length === 0);

  // An unaffordable send is refused rather than silently dropped.
  const rejectionsBefore = a.rejections.length;
  rooms[0]!.send('command', {
    kind: 'send',
    teamId: a.teamId,
    targetTeamId: a.teamId,
    sendId: 'swarmling',
  });
  await wait(400);
  check(
    'a send at your own lane is refused',
    a.rejections.length > rejectionsBefore && a.rejections.includes('invalid-target'),
    a.rejections.join(','),
  );

  // A send from A at B has to show up in B's lane, and buy A a look at it.
  rooms[0]!.send('command', {
    kind: 'send',
    teamId: a.teamId,
    targetTeamId: b.teamId,
    sendId: 'swarmling',
  });
  await wait(500);
  const bought = a.view?.opponents.find((o) => o.teamId === b.teamId);
  check('the sent monsters queued in the target lane', (b.view?.lane?.sendLog.length ?? 0) > 0);
  check('a send grants sight of the target', bought?.watching === true);
  check('and the lane arrives with it', a.view?.watching[b.teamId] !== undefined);
  check(
    'but still without their wallet',
    a.view?.watching[b.teamId]?.economy === null,
    JSON.stringify(a.view?.watching[b.teamId]?.economy),
  );

  for (const room of rooms) await room.leave();
  await server.gracefullyShutdown(false);

  console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} FAILED`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const rooms: Awaited<ReturnType<Client['joinOrCreate']>>[] = [];

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

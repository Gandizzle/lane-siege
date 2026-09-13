/**
 * End-to-end check of the lobby, matchmaking and reconnection. `npm run lobby`.
 *
 * Starts a real server and joins it with real clients, because every claim here
 * is about something that only exists once a socket does: which room a client
 * lands in, whether a code keeps two groups apart, whether a seat is given back
 * to the player who left it, and whether a stranger can walk into a match that
 * has already started.
 *
 * The rules themselves are unit-tested without a network in src/net/lobby.test.ts.
 * This is the wiring: that those rules are the ones the room actually applies,
 * and that Colyseus is filtering, holding and reseating the way the design
 * assumes it does.
 */

import { Server } from 'colyseus';
import { Client, type Room } from 'colyseus.js';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { LaneSiegeRoom } from '../../server/room.ts';
import { ROOM_NAME } from '../net/protocol.ts';
import type { LobbyView } from '../net/lobby.ts';
import type { WireHello } from '../net/protocol.ts';

const PORT = 2598;
const { data } = loadDataFromDisk();

/** Short enough to run in seconds, long enough that the waits are real. */
const MIN_WAIT_SECONDS = 2;
const AUTO_START_SECONDS = 12;
const RECONNECT_SECONDS = 10;

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

/** One connected player, with whatever the server has told them so far. */
interface Player {
  name: string;
  playerId: string;
  client: Client;
  room: Room;
  teamId: string;
  lobby: LobbyView | null;
  frames: number;
  /** Set when the room closes the connection, with the code it used. */
  leftWith: number | null;
}

function listen(player: Player): void {
  player.room.onMessage('hello', (hello: WireHello) => {
    player.teamId = hello.teamId;
  });
  player.room.onMessage('lobby', (lobby: LobbyView) => {
    player.lobby = lobby;
  });
  player.room.onMessage('frame', () => {
    player.frames += 1;
  });
  player.room.onMessage('rejected', () => {});
  player.room.onLeave((code) => {
    player.leftWith = code;
  });
}

async function join(name: string, options: { code?: string; builderId?: string } = {}) {
  const playerId = `player-${name.toLowerCase()}`;
  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate(ROOM_NAME, {
    code: options.code ?? '',
    playerId,
    name,
    builderId: options.builderId ?? 'bastion',
  });
  const player: Player = {
    name,
    playerId,
    client,
    room,
    teamId: '',
    lobby: null,
    frames: 0,
    leftWith: null,
  };
  listen(player);
  return player;
}

async function main(): Promise<void> {
  const server = new Server();
  server
    .define(ROOM_NAME, LaneSiegeRoom, {
      data,
      minWaitSeconds: MIN_WAIT_SECONDS,
      autoStartSeconds: AUTO_START_SECONDS,
      reconnectSeconds: RECONNECT_SECONDS,
    })
    .filterBy(['code']);
  await server.listen(PORT);
  console.log(`server up on ${PORT}`);

  // ---------------------------------------------------------- quick match
  console.log('\n-- quick match puts strangers in one room --');
  const ann = await join('Ann');
  const bo = await join('Bo');
  await wait(700);

  check(
    'both players are seated',
    ann.teamId !== '' && bo.teamId !== '',
    `${ann.teamId} / ${bo.teamId}`,
  );
  check('in different lanes', ann.teamId !== bo.teamId);
  check('and in the same room', ann.room.roomId === bo.room.roomId);
  check('the lobby lists four seats', (ann.lobby?.seats.length ?? 0) === 4);
  check(
    'each sees their own seat marked',
    ann.lobby?.yourSeat === 0 && bo.lobby?.yourSeat === 1,
    `${ann.lobby?.yourSeat} / ${bo.lobby?.yourSeat}`,
  );
  check(
    'and sees the other player by name',
    ann.lobby?.seats[1]?.name === 'Bo' && bo.lobby?.seats[0]?.name === 'Ann',
  );
  check('empty seats are marked open', ann.lobby?.seats[3]?.playerId === null);
  check('nobody has started yet', ann.lobby?.started === false);
  check('and no frames are being sent before kickoff', ann.frames === 0, `${ann.frames}`);

  // ------------------------------------------------------- a private code
  console.log('\n-- a code keeps a private room to itself --');
  const cai = await join('Cai', { code: 'QRST' });
  await wait(400);
  check('a coded room is not the quick-match room', cai.room.roomId !== ann.room.roomId);
  check('and reports its code', cai.lobby?.code === 'QRST', cai.lobby?.code);
  check('while the quick-match room has none', ann.lobby?.code === '', ann.lobby?.code);

  const dee = await join('Dee', { code: 'QRST' });
  await wait(400);
  check('a second player with the code joins it', dee.room.roomId === cai.room.roomId);

  // A mistyped code is not an error: it opens an empty room of that name, which
  // says "nobody is here" on screen and is fixed by retyping.
  const eve = await join('Eve', { code: 'ZZZZ' });
  await wait(400);
  check(
    'a mistyped code opens an empty room rather than failing',
    eve.room.roomId !== cai.room.roomId && eve.lobby?.seats[0]?.name === 'Eve',
  );
  await eve.room.leave(true);

  // ------------------------------------------------------- roster and ready
  console.log('\n-- rosters and ready ticks --');
  ann.room.send('builder', 'tidemark');
  await wait(300);
  check('a roster change reaches the other players', bo.lobby?.seats[0]?.builderId === 'tidemark');
  ann.room.send('builder', 'not-a-builder');
  await wait(300);
  check(
    'an unknown roster is ignored rather than seated',
    bo.lobby?.seats[0]?.builderId === 'tidemark',
  );

  ann.room.send('name', '  Ann\nLee  ');
  await wait(300);
  check(
    'a name is cleaned by the server, not just by the client',
    bo.lobby?.seats[0]?.name === 'Ann Lee',
    bo.lobby?.seats[0]?.name,
  );

  check('the match has not started while nobody is ready', ann.lobby?.started === false);
  ann.room.send('ready', true);
  await wait(300);
  check('a ready tick reaches the other players', bo.lobby?.seats[0]?.ready === true);
  check('one player being ready does not start it', ann.lobby?.started === false);

  bo.room.send('ready', true);
  // Everyone present is ready, so the short wait applies from room creation.
  await wait(MIN_WAIT_SECONDS * 1000 + 800);
  check('the match starts once everyone present is ready', ann.lobby?.started === true);
  check(
    'and frames start arriving',
    ann.frames > 5 && bo.frames > 5,
    `${ann.frames} / ${bo.frames}`,
  );
  check(
    'the roster chosen in the lobby is the one seated',
    ann.lobby?.seats[0]?.builderId === 'tidemark',
  );

  // ------------------------------------------------------------- reconnect
  console.log('\n-- a dropped player gets their own lane back --');
  const annTeam = ann.teamId;
  const token = ann.room.reconnectionToken;
  const framesBefore = ann.frames;
  // Not consented: this is a dropped connection, not somebody quitting.
  await ann.room.leave(false);
  await wait(600);
  check('their seat is held rather than freed', bo.lobby?.seats[0]?.playerId !== null);
  check('and shown as disconnected', bo.lobby?.seats[0]?.connected === false);

  const returned = await ann.client.reconnect(token);
  ann.room = returned;
  ann.frames = 0;
  listen(ann);
  await wait(700);
  check('they are seated in their own lane again', ann.teamId === annTeam, `${ann.teamId}`);
  check('frames resume', ann.frames > 3, `${ann.frames}`);
  check('the others see them back', bo.lobby?.seats[0]?.connected === true);
  check('the match did not restart for them', framesBefore > 0 && ann.frames < framesBefore);

  // --------------------------------------------------- no walk-ins mid-match
  console.log('\n-- a started match is closed --');
  const late = new Client(`ws://localhost:${PORT}`);
  let lateJoinedSameRoom = false;
  try {
    const room = await late.joinById(ann.room.roomId, { playerId: 'player-late', name: 'Late' });
    lateJoinedSameRoom = true;
    await room.leave(true);
  } catch {
    // Expected: the room locks at kickoff.
  }
  check('a stranger cannot join a match in progress', !lateJoinedSameRoom);

  // A quick match started now gets a fresh room rather than that one.
  const fresh = await join('Fin');
  await wait(400);
  check('a new quick match opens a new room', fresh.room.roomId !== ann.room.roomId);
  check('with its own empty lobby', fresh.lobby?.seats.filter((s) => s.playerId).length === 1);

  for (const player of [ann, bo, cai, dee, fresh]) {
    await player.room.leave(true).catch(() => {});
  }
  await wait(200);
  await server.gracefullyShutdown(false);

  console.log('');
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('all checks passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

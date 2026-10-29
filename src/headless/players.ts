/**
 * End-to-end check of what the server keeps about players. `npm run players`.
 *
 * A real server and real clients, because the claims here are about what
 * happens across a socket: that a copied player id cannot take a seat, that
 * the others are shown only the badges a player's record bears out, that a
 * name hidden after reports reaches nobody, and that a player's online match
 * is counted by the server the moment it ends - into their XP, their online
 * matches, and a Founder's number. The rules themselves are unit-tested in
 * server/playerStore.test.ts and server/routes.test.ts.
 */

import { createServer } from 'node:http';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from 'colyseus.js';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { LaneSiegeRoom } from '../../server/room.ts';
import { memoryParts, serverRoutes } from '../../server/routes.ts';
import type { LobbyView } from '../net/lobby.ts';
import type { PlayerSummary } from '../net/playerApi.ts';
import { ROOM_NAME, type WireHello } from '../net/protocol.ts';
import { PROGRESSION } from '../progression/config.ts';
import { xpToReach } from '../progression/levels.ts';
import { NO_LOOKS, type MatchState } from '../sim/index.ts';

const PORT = 2598;
const HTTP = `http://localhost:${PORT}`;
const { data } = loadDataFromDisk();

const ANN = { playerId: 'player-ann', key: '0123456789abcdef0123456789abcdef' };
const BO = { playerId: 'player-bo', key: '11111111111111111111111111111111' };
const ZED = { playerId: 'player-zed', key: '22222222222222222222222222222222' };
const THIEF_KEY = '33333333333333333333333333333333';

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

async function post(path: string, body: object): Promise<Response> {
  return fetch(`${HTTP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function me(who: { playerId: string; key: string }): Promise<PlayerSummary> {
  return (await (await post('/progress/me', who)).json()) as PlayerSummary;
}

/** Join a room and listen to everything it says. */
async function join(options: object): Promise<{
  room: Room;
  hello: () => WireHello | null;
  lobby: () => LobbyView | null;
  left: () => number | null;
}> {
  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate(ROOM_NAME, { builderId: 'ironvow', ...options });
  let hello: WireHello | null = null;
  let lobby: LobbyView | null = null;
  let left: number | null = null;
  room.onMessage('hello', (h: WireHello) => (hello = h));
  room.onMessage('lobby', (l: LobbyView) => (lobby = l));
  room.onMessage('frame', () => {});
  room.onMessage('rejected', () => {});
  room.onMessage('finished', () => {});
  room.onLeave((code) => (left = code));
  return { room, hello: () => hello, lobby: () => lobby, left: () => left };
}

async function main(): Promise<void> {
  const parts = memoryParts({ founders: { count: 2, level: 3, onlineMatches: 1 } });
  const server = new Server({
    transport: new WebSocketTransport({
      server: createServer(
        serverRoutes(parts, { trustProxy: false, testPurchases: true, supporterCheck: null }),
      ),
    }),
  });
  server
    .define(ROOM_NAME, LaneSiegeRoom, {
      data,
      minWaitSeconds: 1,
      autoStartSeconds: 10,
      reconnectSeconds: 5,
      ghosts: parts.ghosts,
      players: parts.players,
      moderation: parts.moderation,
    })
    .filterBy(['code']);
  await server.listen(PORT);
  console.log(`server up on ${PORT}`);

  // Ann: known to the server, a Supporter (a test purchase on a test server),
  // and a few XP short of the Founders' level.
  await me(ANN);
  await post('/supporter/test', { ...ANN, on: true });
  parts.players.get(ANN.playerId)!.xp = xpToReach(3, PROGRESSION.levels) - 10;

  // ------------------------------------------------------------ badges
  console.log('\n-- the others see only the badges her record bears out --');
  const ann = await join({
    code: 'BDGE',
    ...ANN,
    name: 'Ann',
    level: 30,
    looks: NO_LOOKS,
    badges: ['badge_founder', 'badge_veteran', 'badge_supporter', 'not_a_badge'],
  });
  const bo = await join({ code: 'BDGE', ...BO, name: 'Bo', level: 2 });
  await wait(700);
  const seen = bo.lobby()?.seats.find((s) => s.playerId === ANN.playerId);
  check(
    'her Supporter heart, and not the Founder star or Veteran shield she has not earned',
    JSON.stringify(seen?.badges) === JSON.stringify([{ id: 'badge_supporter', number: null }]),
    JSON.stringify(seen?.badges),
  );

  // ---------------------------------------------------------- copied ids
  console.log('\n-- a copied player id takes nobody’s seat --');
  /** The code a join was refused with, or null if it got in. */
  const refusal = async (options: object): Promise<number | null> => {
    try {
      const got = await join(options);
      await wait(500);
      await got.room.leave(true).catch(() => {});
      return got.left();
    } catch (error) {
      return (error as { code?: number }).code ?? -1;
    }
  };
  const stolen = await refusal({
    code: 'BDGE',
    playerId: ANN.playerId,
    key: THIEF_KEY,
    name: 'Ann',
  });
  check('the join is refused', stolen === 4003, String(stolen));
  const keyless = await refusal({ code: 'BDGE', playerId: ANN.playerId, name: 'Ann' });
  check('and so is one with no key at all', keyless === 4003, String(keyless));
  check(
    'and her seat is still hers',
    bo.lobby()?.seats.filter((s) => s.playerId === ANN.playerId).length === 1,
  );

  // ------------------------------------------------------- hidden names
  console.log('\n-- a name hidden after reports reaches nobody --');
  parts.moderation.hide(ZED.playerId, 'Zed', 'reports');
  const zed = await join({ code: 'BDGE', ...ZED, name: 'Zed' });
  await wait(700);
  const zedSeat = bo.lobby()?.seats.find((s) => s.playerId === ZED.playerId);
  check('his seat shows the default name', zedSeat?.name === '', JSON.stringify(zedSeat?.name));
  zed.room.send('name', 'Zedd');
  await wait(700);
  check(
    'and a new name shows again',
    bo.lobby()?.seats.find((s) => s.playerId === ZED.playerId)?.name === 'Zedd',
  );

  // ---------------------------------------------- an online match counted
  console.log('\n-- an online match is counted by the server as it ends --');
  for (const r of [ann.room, bo.room, zed.room]) r.send('ready', true);
  await wait(2200);
  const started = ann.hello();
  check(
    'everyone is told her badges at kickoff',
    JSON.stringify(started?.teamBadges?.[started.teamIds.indexOf(started.teamId)]) ===
      JSON.stringify([{ id: 'badge_supporter', number: null }]),
    JSON.stringify(started?.teamBadges),
  );
  const live = matchMaker.getLocalRoomById(ann.room.roomId) as unknown as { match: MatchState };
  const match = live.match;
  const lane = (who: { hello: () => WireHello | null }) => who.hello()?.teamId ?? '';
  // Bo leaves before his match ends: leaving early earns nothing.
  await bo.room.leave(true);
  await wait(200);
  for (const who of [ann, bo]) {
    const fortress = match.lanes[lane(who)]!.fortress;
    fortress.hp = 0;
    fortress.destroyed = true;
  }
  await wait(500);
  const annNow = await me(ANN);
  check('her match counts as an online match', annNow.onlineMatches === 1, JSON.stringify(annNow));
  check(
    'and its XP takes her to the Founders’ level: Founder #1',
    annNow.level >= 3 && annNow.founderNumber === 1,
    `level ${annNow.level}, founder ${annNow.founderNumber}`,
  );
  check(
    'her star is in her badges now',
    annNow.badges.some((b) => b.id === 'badge_founder' && b.number === 1),
  );
  const boNow = await me(BO);
  check(
    'Bo left early, and earned nothing',
    boNow.onlineMatches === 0 && boNow.xp === 0,
    JSON.stringify(boNow),
  );

  for (const r of [ann.room, zed.room]) {
    await Promise.race([r.leave(true).catch(() => {}), wait(300)]);
  }
  await wait(200);
  await Promise.race([server.gracefullyShutdown(false), wait(2000)]);

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

/**
 * End-to-end check of saved builds. `npm run ghosts`.
 *
 * A real server with a store already holding builds, and a real client: the
 * claims here are all about what happens across a socket and a match - that a
 * quick match's empty seats go to other players' saved builds and not to the
 * player's own, that those builds play, that a player's match ending leaves
 * them a build they can keep over HTTP, and that a build's place is counted
 * for whoever saved it. The rules themselves are unit-tested in
 * src/bot/ghost.test.ts and server/ghostStore.test.ts.
 */

import { createServer } from 'node:http';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from 'colyseus.js';
import { loadDataFromDisk } from '../data/loadNode.ts';
import { LaneSiegeRoom } from '../../server/room.ts';
import { MemoryGhostStore, type GhostReport } from '../../server/ghostStore.ts';
import { ghostRoutes } from '../../server/ghostRoutes.ts';
import { AutoBuilder } from '../bot/autoBuilder.ts';
import { GhostRecorder, portable, type GhostAction } from '../bot/ghost.ts';
import { ROOM_NAME, type WireHello } from '../net/protocol.ts';
import {
  NO_LOOKS,
  applyCommand,
  createContext,
  createMatch,
  step,
  type Looks,
  type MatchState,
} from '../sim/index.ts';

const PORT = 2599;
const HTTP = `http://localhost:${PORT}`;
const { data } = loadDataFromDisk();

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

/** A scripted builder's opening waves, recorded the way the room records a player. */
function recordedOpening(): GhostAction[] {
  const seats = ['a', 'b', 'c', 'd'];
  const state = createMatch(data, {
    seed: 7,
    teams: seats.map((id) => ({ id, playerIds: [id], builderId: 'ironvow' })),
  });
  const ctx = createContext(data);
  const bot = new AutoBuilder(data, 'a', 'ironvow', { seed: 7, sends: false });
  const recorder = new GhostRecorder();
  for (let i = 0; i < 20_000 && !(state.wave === 2 && state.phase === 'build'); i++) {
    for (const command of bot.plan(state)) {
      const kept = portable(command, state, seats);
      if (applyCommand(ctx, state, command).ok && kept) recorder.add('a', state, kept);
    }
    step(ctx, state, []);
    // The other three hold nothing up: their waves die where they stand.
    for (const id of ['b', 'c', 'd']) {
      const lane = state.lanes[id]!;
      for (const monster of lane.monsters) if (monster.alive) monster.hp = 0;
      lane.fortress.hp = lane.fortress.maxHp;
    }
  }
  return recorder.actionsOf('a');
}

async function report(playerId: string): Promise<GhostReport> {
  return (await fetch(`${HTTP}/ghosts/report?playerId=${playerId}`)).json() as Promise<GhostReport>;
}

async function main(): Promise<void> {
  const store = new MemoryGhostStore();
  const actions = recordedOpening();
  // What each was seen in when they played: Hal's fortress is a trail, which
  // no fortress can be, and must arrive as nothing.
  const looksOf: Record<string, Looks> = {
    'player-gil': { ...NO_LOOKS, fortress: 'fortress_granite', trail: 'trail_ember' },
    'player-hal': { ...NO_LOOKS, fortress: 'trail_frost', victory: 'victory_confetti' },
  };
  for (const [playerId, name, level] of [
    ['player-gil', 'Gil', 3],
    ['player-hal', 'Hal', 5],
    ['player-ivy', 'Ivy', 6],
    // Ann's own, which must never be seated against her.
    ['player-ann', 'Ann', 4],
  ] as const) {
    store.setLast({
      playerId,
      name,
      level,
      looks: looksOf[playerId] ?? NO_LOOKS,
      builderId: 'ironvow',
      wave: 2,
      placement: 2,
      playedAt: new Date().toISOString(),
      actions,
    });
    store.keep(playerId);
  }

  const server = new Server({
    transport: new WebSocketTransport({ server: createServer(ghostRoutes(store)) }),
  });
  server
    .define(ROOM_NAME, LaneSiegeRoom, {
      data,
      minWaitSeconds: 1,
      autoStartSeconds: 10,
      reconnectSeconds: 5,
      ghosts: store,
    })
    .filterBy(['code']);
  await server.listen(PORT);
  console.log(`server up on ${PORT}, ${actions.length} actions in each saved build`);

  // ------------------------------------------------------------ seating
  console.log('\n-- an empty quick match is filled with saved builds --');
  const client = new Client(`ws://localhost:${PORT}`);
  const room: Room = await client.joinOrCreate(ROOM_NAME, {
    code: '',
    playerId: 'player-ann',
    name: 'Ann',
    level: 4,
    looks: { ...NO_LOOKS, fortress: 'fortress_obsidian', floor: 'floor_starfield' },
    builderId: 'ironvow',
  });
  let hello: WireHello | null = null;
  room.onMessage('hello', (h: WireHello) => (hello = h));
  room.onMessage('lobby', () => {});
  room.onMessage('frame', () => {});
  room.onMessage('rejected', () => {});
  room.onMessage('finished', () => {});
  room.send('ready', true);
  await wait(1800);

  const seated = hello as WireHello | null;
  const names = seated?.teamNames ?? [];
  check('the other three seats have names', names.filter(Boolean).length === 4, names.join(', '));
  check(
    'and they are other players’ saved builds, never her own',
    ['Gil', 'Hal', 'Ivy'].every((n) => names.includes(n)) &&
      names.filter((n) => n === 'Ann').length === 1,
    names.join(', '),
  );
  check(
    'marked as saved builds, her own seat not',
    JSON.stringify(seated?.teamRecorded) === JSON.stringify([false, true, true, true]),
    JSON.stringify(seated?.teamRecorded),
  );
  const looksAt = (who: string): Looks | undefined => seated?.teamLooks?.[names.indexOf(who)];
  check(
    'everyone is told what each seat is seen in: hers, and the builds’ players’',
    looksAt('Ann')?.fortress === 'fortress_obsidian' &&
      looksAt('Ann')?.floor === 'floor_starfield' &&
      looksAt('Gil')?.fortress === 'fortress_granite' &&
      looksAt('Gil')?.trail === 'trail_ember' &&
      looksAt('Ivy')?.fortress === null,
    JSON.stringify(seated?.teamLooks),
  );
  check(
    'and a look claimed for the wrong slot arrives as nothing',
    looksAt('Hal')?.fortress === null && looksAt('Hal')?.victory === 'victory_confetti',
    JSON.stringify(looksAt('Hal')),
  );

  // --------------------------------------------------------- they play
  console.log('\n-- the saved builds play --');
  const live = matchMaker.getLocalRoomById(room.roomId) as unknown as { match: MatchState };
  const match = live.match;
  const annTeam = seated?.teamId ?? 'lane1';
  const ghostTeams = (seated?.teamIds ?? []).filter((id) => id !== annTeam);
  check(
    'each has built in its first build phase',
    ghostTeams.every((id) => (match.lanes[id]?.units.length ?? 0) > 0),
    ghostTeams.map((id) => match.lanes[id]?.units.length).join(', '),
  );
  check(
    'with what the build placed first',
    ghostTeams.every((id) => {
      const first = actions.find((a) => a.do.kind === 'placeUnit')?.do;
      return match.lanes[id]!.units.some(
        (u) =>
          first?.kind === 'placeUnit' && u.homeTileX === first.tileX && u.homeTileY === first.tileY,
      );
    }),
  );

  // ------------------------------------------- her match ends: a last build
  console.log('\n-- a player whose match ends has a build to keep --');
  const def = data.units.units.find((u) => u.builderId === 'ironvow' && u.mark === 1)!;
  room.send('command', { kind: 'placeUnit', unitDefId: def.id, tileX: 0, tileY: 0 });
  await wait(300);
  match.lanes[annTeam]!.fortress.hp = 0;
  match.lanes[annTeam]!.fortress.destroyed = true;
  await wait(300);
  const hers = await report('player-ann');
  check('her last build is there to keep', hers.last !== null, JSON.stringify(hers.last));
  const keep = await fetch(`${HTTP}/ghosts/keep`, {
    method: 'POST',
    body: JSON.stringify({ playerId: 'player-ann' }),
  });
  const kept = (await keep.json()) as GhostReport;
  check(
    'and keeping it makes it her saved build',
    keep.status === 200 &&
      kept.saved?.wave === hers.last?.wave &&
      kept.saved?.savedAt !== undefined,
    `${keep.status} ${JSON.stringify(kept.saved)}`,
  );

  // ------------------------------------------ the builds' places, counted
  console.log('\n-- where a saved build placed is counted for its player --');
  const [winner, ...rest] = ghostTeams;
  for (const id of rest) {
    match.lanes[id]!.fortress.hp = 0;
    match.lanes[id]!.fortress.destroyed = true;
  }
  await wait(400);
  const byTeam = new Map<string, string>(
    (seated?.teamIds ?? []).map((id, i) => [id, names[i] ?? ''] as [string, string]),
  );
  const ownerOf = (team: string | undefined) =>
    `player-${(byTeam.get(team ?? '') ?? '').toLowerCase()}`;
  const won = await report(ownerOf(winner));
  check(
    'the last one standing is counted first',
    JSON.stringify(won.saved?.results) === '[1,0,0,0]',
    JSON.stringify(won.saved?.results),
  );
  const others = await Promise.all(rest.map((team) => report(ownerOf(team))));
  check(
    'and the others where they fell',
    others.every(
      (r) => (r.saved?.results ?? []).reduce((a, b) => a + b, 0) === 1 && r.saved?.results[0] === 0,
    ),
    others.map((r) => JSON.stringify(r.saved?.results)).join(' '),
  );

  // --------------------------------------------- a private room keeps none
  console.log('\n-- a private room is played by the people in it --');
  const friend = new Client(`ws://localhost:${PORT}`);
  const privateRoom = await friend.joinOrCreate(ROOM_NAME, {
    code: 'QRST',
    playerId: 'player-jo',
    name: 'Jo',
    builderId: 'ironvow',
  });
  let privateHello: WireHello | null = null;
  privateRoom.onMessage('hello', (h: WireHello) => (privateHello = h));
  privateRoom.onMessage('lobby', () => {});
  privateRoom.onMessage('frame', () => {});
  privateRoom.send('ready', true);
  await wait(1800);
  const p = privateHello as WireHello | null;
  check(
    'no saved build is seated in it',
    (p?.teamRecorded ?? []).every((r) => !r) &&
      !(p?.teamNames ?? []).some((n) => ['Gil', 'Hal', 'Ivy'].includes(n)),
    JSON.stringify(p?.teamNames),
  );

  // The quick match has finished and closed itself; a leave from a closed
  // room may never answer, so neither is waited on for long.
  for (const r of [privateRoom, room])
    await Promise.race([r.leave(true).catch(() => {}), wait(500)]);
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

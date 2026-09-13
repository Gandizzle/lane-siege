/**
 * Pixi bootstrap, and the choice of where the simulation runs. §15.2, §17 (M4,
 * M6).
 *
 * Pixi is confined to src/render/. Nothing under src/sim/ may import it - see
 * src/sim/purity.test.ts, which fails the build if that ever changes.
 *
 * Three ways to play, behind one interface (src/net/transport.ts):
 *
 *   - **Practice**: simulated in this tab, with scripted builders in the other
 *     three lanes. Always available, and it is what the GitHub Pages build
 *     serves, because Pages is static and cannot host a room.
 *   - **Quick match**: the next open room on the configured server.
 *   - **Private room**: a room with a four-character code (src/net/lobby.ts).
 *
 * The last two need `?server=ws://host:2567`, which is what `npm run server`
 * prints. The renderer cannot tell which of the three it has, and neither can
 * the fog-of-war filter (§12) - it is the same function either way.
 *
 * This file also owns the two things the renderer deliberately does not: the
 * player's identity, which is storage, and text entry, which is DOM. Both are
 * passed into the game as functions.
 */

import { Application } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import { LocalTransport } from '../net/localTransport.ts';
import { RemoteTransport } from '../net/remoteTransport.ts';
import type { Transport } from '../net/transport.ts';
import {
  MAX_NAME_LENGTH,
  browserStorage,
  cleanName,
  loadIdentity,
  saveIdentity,
} from '../net/identity.ts';
import { CODE_LENGTH, PUBLIC_CODE, normaliseCode } from '../net/lobby.ts';
import { Game } from './game.ts';
import type { MatchMode } from './ui/homeScreen.ts';
import { textPrompt } from './ui/textPrompt.ts';
import { UI } from './palette.ts';

/** §2: four lanes. Fixed ids so a lane's name is stable across matches. */
const LANE_IDS = ['lane1', 'lane2', 'lane3', 'lane4'];
const OWN_LANE = LANE_IDS[0]!;

export interface GameApp {
  app: Application;
  game: Game;
  destroy(): void;
}

export interface AppOptions {
  /** Fixes the match seed, which makes a bug reproducible (§9.2). */
  seed?: number;
  /** A Colyseus endpoint. Absent means a local practice match. */
  server?: string;
}

/**
 * A match for the roster the player picked (§7.1), found the way they asked.
 *
 * A practice match's three scripted lanes take the OTHER rosters, in order, so
 * it shows all four on the board rather than four copies of one - which is also
 * the only way to see whether the three new ones behave at all.
 */
function newTransport(
  data: GameData,
  options: AppOptions,
  mode: MatchMode,
  builderId: string,
  identity: { playerId: string; name: string },
): Transport {
  if (mode.kind !== 'practice' && options.server) {
    return new RemoteTransport(data, options.server, {
      identity,
      builderId,
      code: mode.kind === 'private' ? mode.code : PUBLIC_CODE,
    });
  }

  const others = data.units.builders.map((b) => b.id).filter((id) => id !== builderId);
  const teams = LANE_IDS.map((id, index) => ({
    id,
    playerIds: id === OWN_LANE ? ['you'] : ['bot'],
    builderId:
      id === OWN_LANE ? builderId : (others[(index - 1) % Math.max(1, others.length)] ?? builderId),
  }));

  return new LocalTransport(
    data,
    options.seed ?? Math.floor(Math.random() * 0x7fffffff),
    teams,
    OWN_LANE,
    LANE_IDS.filter((id) => id !== OWN_LANE),
  );
}

export async function startApp(
  mount: HTMLElement,
  data: GameData,
  options: AppOptions = {},
): Promise<GameApp> {
  const app = new Application();

  await app.init({
    background: UI.background,
    resizeTo: mount,
    antialias: true,
    // Cap the device pixel ratio: shapes are vector, so the extra resolution
    // buys little and costs fill rate on a phone (§15.3).
    resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  mount.appendChild(app.canvas);

  // Who this player is, across matches (§17's "accounts", as far as a game with
  // nowhere to host an account server can take it - see net/identity.ts).
  const storage = browserStorage();
  const identity = loadIdentity(storage, Math.random);

  // The game starts on the home screen and asks for a transport once the player
  // has chosen a mode and a roster. A local one starts a fresh simulation; a
  // remote one joins a room, which opens as a lobby.
  const game = new Game(
    data,
    {
      createTransport: (mode, builderId) => newTransport(data, options, mode, builderId, identity),
      name: () => identity.name,
      online: Boolean(options.server),
      async editName() {
        const typed = await textPrompt(mount, {
          title: 'Your name',
          value: identity.name,
          maxLength: MAX_NAME_LENGTH,
          confirmLabel: 'Save',
        });
        if (typed === null) return null;
        const cleaned = cleanName(typed);
        if (!cleaned) return null;
        identity.name = cleaned;
        saveIdentity(storage, identity);
        return cleaned;
      },
      async askRoomCode() {
        const typed = await textPrompt(mount, {
          title: 'Room code',
          placeholder: 'ABCD',
          maxLength: CODE_LENGTH,
          uppercase: true,
          confirmLabel: 'Join',
        });
        if (typed === null) return null;
        const code = normaliseCode(typed);
        return code.length === CODE_LENGTH ? code : null;
      },
    },
    app.screen.width,
    app.screen.height,
  );
  app.stage.addChild(game);

  // Drive the simulation from real elapsed time, NOT from `ticker.deltaMS`.
  //
  // Pixi's ticker clamps its delta to `maxElapsedMS` (100ms by default, i.e.
  // minFPS 10). Below ten frames a second that clamp silently feeds the
  // accumulator less time than actually passed, and the whole match runs in
  // slow motion - measured at ~55% speed on a 5fps software renderer. That is
  // precisely the mid-range phone §15.3 cares about.
  //
  // So the accumulator sees the truth, and `MAX_CATCHUP_TICKS` in loop.ts stays
  // the single place that decides what to do about a slow frame.
  let last = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    const elapsed = now - last;
    last = now;
    game.frame(elapsed);
  });

  // Fixed camera (§14.1): resize only recomputes the layout.
  const onResize = () => game.resize(app.screen.width, app.screen.height);
  globalThis.addEventListener('resize', onResize);

  return {
    app,
    game,
    destroy() {
      globalThis.removeEventListener('resize', onResize);
      app.destroy(true, { children: true });
    },
  };
}

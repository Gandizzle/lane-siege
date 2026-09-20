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
import type { SeatSetup } from './ui/showdownSetup.ts';
import { computeBudget } from '../balance/budget.ts';
import { realise } from '../balance/builds.ts';
import { seatsForArmies } from '../balance/arena.ts';
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
  /** Practice only: start at the build phase before this wave (`?wave=`). */
  startWave?: number;
  /** Practice only: start in the Final Showdown's arena (`?showdown=1`). */
  startInShowdown?: boolean;
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
    // The four tabs are labelled by name (opponentTabs.ts), so a practice
    // match says who is who too: your own name, and plainly-marked bots for
    // the three lanes nobody is playing.
    name: id === OWN_LANE ? identity.name : `Bot ${index + 1}`,
    builderId:
      id === OWN_LANE ? builderId : (others[(index - 1) % Math.max(1, others.length)] ?? builderId),
  }));

  return new LocalTransport(
    data,
    options.seed ?? Math.floor(Math.random() * 0x7fffffff),
    teams,
    OWN_LANE,
    LANE_IDS.filter((id) => id !== OWN_LANE),
    {
      ...(options.startWave !== undefined && { wave: options.startWave }),
      ...(options.startInShowdown && { showdown: true }),
    },
  );
}

/**
 * §3.3, replaced: a local match that opens in the arena with armies set up by
 * hand (ui/showdownSetup.ts).
 *
 * The budget and the placement come from src/balance, which is what `npm run
 * showdown` runs too - so what is on screen is the same experiment as a row in
 * the report, and not a second implementation of it that could drift.
 */
function newShowdown(
  data: GameData,
  options: AppOptions,
  seats: readonly SeatSetup[],
  identity: { playerId: string; name: string },
): Transport {
  const budget = computeBudget(data);
  const armies = seats.map((seat) =>
    realise(
      data,
      seat.builderId,
      { id: seat.specId, name: seat.specId, shares: seat.shares },
      budget.armyGold,
      budget.armySupply,
    ),
  );

  // Four lanes whatever the count, so a duel can sit on opposite spokes; the
  // two nobody is using are eliminated before the countdown (localTransport).
  const spokes = seatsForArmies(armies.length);
  const teams = LANE_IDS.map((id, seat) => {
    const army = armies[spokes.indexOf(seat)];
    return {
      id,
      playerIds: seat === 0 ? ['you'] : [`seat${seat}`],
      name: seat === 0 ? identity.name : `Seat ${seat + 1}`,
      ...(army ? { builderId: army.builderId } : {}),
    };
  });

  return new LocalTransport(
    data,
    options.seed ?? Math.floor(Math.random() * 0x7fffffff),
    teams,
    // Seat 0 is the one the camera is on. Nothing here is scripted: there is
    // nothing to build and nothing to spend, so no lane needs a bot.
    LANE_IDS[0]!,
    [],
    { armies },
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
      createShowdown: (seats) => newShowdown(data, options, seats, identity),
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

  /**
   * The layout follows the RENDERER's size, checked at the top of every frame.
   *
   * It used to be driven from a `window` 'resize' listener, and that listener
   * was always a frame behind. Pixi's own resize plugin listens to the same
   * event and only QUEUES the new size - it applies it inside a
   * `requestAnimationFrame` - so anything reading `app.screen` from a listener
   * added after it gets the size the canvas had a moment ago. Rotating a phone
   * therefore laid the game out for the orientation it was just in, and
   * rotating back laid landscape out inside a portrait canvas: the board across
   * the left half of the screen and the build bar off the bottom of it.
   *
   * Comparing the numbers instead of trusting an event fixes the ordering and
   * covers everything else that can change them with one rule - browser chrome
   * appearing and disappearing, a soft keyboard, a desktop window drag, a
   * resize observer firing late - with no guessing about when the viewport has
   * settled. `computeLayout` runs only when the numbers actually differ.
   */
  let laidOut = { width: app.screen.width, height: app.screen.height };

  app.ticker.add(() => {
    if (app.screen.width !== laidOut.width || app.screen.height !== laidOut.height) {
      laidOut = { width: app.screen.width, height: app.screen.height };
      // Fixed camera (§14.1): a resize only recomputes the layout.
      game.resize(laidOut.width, laidOut.height);
    }

    const now = performance.now();
    const elapsed = now - last;
    last = now;
    game.frame(elapsed);
  });

  return {
    app,
    game,
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}

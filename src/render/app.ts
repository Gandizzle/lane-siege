/**
 * Pixi bootstrap, and the choice of where the simulation runs. §15.2, §17 (M4).
 *
 * Pixi is confined to src/render/. Nothing under src/sim/ may import it - see
 * src/sim/purity.test.ts, which fails the build if that ever changes.
 *
 * Two ways to play, behind one interface (src/net/transport.ts):
 *
 *   - No `server` parameter: a practice match, simulated in this tab, with
 *     scripted builders in the other three lanes. This is what the GitHub Pages
 *     build serves, because Pages is static and cannot host a room.
 *   - `?server=ws://host:2567`: a real four-player match against `npm run
 *     server`, which runs the identical simulation and decides everything.
 *
 * The renderer cannot tell which it has, and neither can the fog-of-war filter
 * (§12) - it is the same function either way.
 */

import { Application } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import { LocalTransport } from '../net/localTransport.ts';
import { RemoteTransport } from '../net/remoteTransport.ts';
import type { Transport } from '../net/transport.ts';
import { Game } from './game.ts';
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

function newTransport(data: GameData, options: AppOptions): Transport {
  if (options.server) return new RemoteTransport(data, options.server);

  return new LocalTransport(
    data,
    options.seed ?? Math.floor(Math.random() * 0x7fffffff),
    LANE_IDS.map((id) => ({ id, playerIds: id === OWN_LANE ? ['you'] : ['bot'] })),
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

  const game = new Game(data, newTransport(data, options), app.screen.width, app.screen.height, {
    // A new match means a new transport: a local one starts a fresh simulation,
    // and a remote one has to join a room again.
    onRestart: () => game.setTransport(newTransport(data, options)),
  });
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

/**
 * Pixi bootstrap. DESIGN.md §15.2.
 *
 * Pixi is confined to src/render/. Nothing under src/sim/ may import it - see
 * src/sim/purity.test.ts, which fails the build if that ever changes.
 */

import { Application } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import { Game } from './game.ts';
import { UI } from './palette.ts';

export interface GameApp {
  app: Application;
  game: Game;
  destroy(): void;
}

export async function startApp(
  mount: HTMLElement,
  data: GameData,
  seed = Math.floor(Math.random() * 0x7fffffff),
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

  const game = new Game(data, app.screen.width, app.screen.height, seed);
  app.stage.addChild(game);

  // The simulation is driven from the frame callback, but at its own fixed rate
  // (§15.1): `deltaMS` is wall time and goes no further than the accumulator.
  app.ticker.add((ticker) => game.frame(ticker.deltaMS));

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

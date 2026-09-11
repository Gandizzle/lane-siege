/**
 * Pixi bootstrap. DESIGN.md §15.2.
 *
 * Pixi is confined to src/render/. Nothing under src/sim/ may import it - see
 * src/sim/purity.test.ts.
 */

import { Application } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import { computeLayout } from './layout.ts';
import { LaneView } from './laneView.ts';
import { UI } from './palette.ts';

export interface GameApp {
  app: Application;
  lane: LaneView;
  destroy(): void;
}

export async function startApp(mount: HTMLElement, data: GameData): Promise<GameApp> {
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

  const layout = () => computeLayout(app.screen.width, app.screen.height, data.lane);
  const lane = new LaneView(layout(), data);
  app.stage.addChild(lane);

  // Fixed camera (§14.1): the only thing resize does is recompute the layout.
  const onResize = () => lane.redraw(layout());
  globalThis.addEventListener('resize', onResize);

  return {
    app,
    lane,
    destroy() {
      globalThis.removeEventListener('resize', onResize);
      app.destroy(true, { children: true });
    },
  };
}

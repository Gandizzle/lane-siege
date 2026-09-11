/**
 * Wires the simulation to the renderer. DESIGN.md §17, milestone M2.
 *
 * "Renderer: Pixi, portrait layout, coloured shapes, touch build UI. Single
 * player, still one builder."
 *
 * The split this file maintains is the one §15.1 rests on: the simulation is a
 * pure module that this class drives at a fixed 20Hz, and the renderer reads
 * state and draws it. Nothing here reaches into simulation internals, and the
 * simulation has no idea a renderer exists.
 *
 * On commands: taps are applied through `applyCommand` immediately, so the UI
 * can show why one was refused. That is the same validated path `step` uses, so
 * a tap costs the same whichever route it takes. At M4 this becomes "send to the
 * server and predict locally" - the prediction is already this call.
 */

import { Container } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import {
  applyCommand,
  createContext,
  createMatch,
  step,
  summariseWave,
  type Command,
  type MatchState,
  type SimContext,
  type WaveSummary,
} from '../sim/index.ts';
import { EntityLayer } from './entities.ts';
import { computeLayout, type LaneLayout } from './layout.ts';
import { LaneView } from './laneView.ts';
import { FixedTimestep } from './loop.ts';
import { BuildBar, type Selection } from './ui/buildBar.ts';
import { GameOver } from './ui/gameOver.ts';
import { Hud } from './ui/hud.ts';
import { Toast } from './ui/toast.ts';

/** M2 is single player (§17), so there is exactly one lane and it is ours. */
const TEAM_ID = 'lane1';

export class Game extends Container {
  private state: MatchState;
  private readonly ctx: SimContext;
  private readonly clock = new FixedTimestep();

  private layout: LaneLayout;
  private selection: Selection = null;
  private summary: WaveSummary | null = null;
  private summarisedWave = -1;

  private readonly laneView: LaneView;
  private readonly entities: EntityLayer;
  private readonly hud: Hud;
  private readonly buildBar: BuildBar;
  private readonly toast = new Toast();
  private readonly gameOver: GameOver;

  constructor(
    private readonly data: GameData,
    width: number,
    height: number,
    private readonly seed: number,
  ) {
    super();

    this.ctx = createContext(data);
    this.state = this.newMatch();
    this.layout = computeLayout(width, height, data.lane);

    this.laneView = new LaneView(this.layout, data, {
      onTapTile: (x, y) => this.tapTile(x, y),
      onTapElsewhere: () => this.clearSelection(),
    });
    this.entities = new EntityLayer(this.layout, this.ctx.defs);
    this.hud = new Hud(this.layout, data);
    this.buildBar = new BuildBar(this.layout, data, {
      onSelectUnitDef: (id) => this.selectUnitDef(id),
      onUpgrade: (id) => this.upgrade(id),
      onReady: () => this.issue({ kind: 'ready', teamId: TEAM_ID }),
      onClearSelection: () => this.clearSelection(),
    });
    this.gameOver = new GameOver(this.layout, () => this.restart());

    this.addChild(this.laneView, this.entities, this.hud, this.buildBar, this.toast, this.gameOver);
  }

  private newMatch(): MatchState {
    return createMatch(this.data, {
      seed: this.seed,
      teams: [{ id: TEAM_ID, playerIds: ['you'] }],
    });
  }

  private get lane() {
    return this.state.lanes[TEAM_ID]!;
  }

  restart(): void {
    this.state = this.newMatch();
    this.selection = null;
    this.summarisedWave = -1;
    this.clock.reset();
  }

  resize(width: number, height: number): void {
    this.layout = computeLayout(width, height, this.data.lane);
    this.laneView.setLayout(this.layout);
    this.entities.setLayout(this.layout);
    this.hud.setLayout(this.layout);
    this.buildBar.setLayout(this.layout);
    this.gameOver.setLayout(this.layout);
  }

  /** One animation frame. `deltaMs` is wall time; the simulation never sees it. */
  frame(deltaMs: number): void {
    this.clock.advance(deltaMs, () => {
      // Capture positions before the tick so the next frames can interpolate.
      this.entities.captureTick(this.lane);
      this.state = step(this.ctx, this.state);
    });

    this.refreshSummary();

    const selectedUnitId = this.selection?.kind === 'placedUnit' ? this.selection.unitId : null;
    this.laneView.render(this.state, this.lane, selectedUnitId, this.summary);
    this.entities.render(this.lane, this.clock.alpha);
    this.hud.render(this.state, TEAM_ID, this.summary);
    this.buildBar.render(
      this.lane,
      this.selection,
      this.summary,
      this.state.phase === 'build' && this.state.wave <= this.data.waves.lastBuildWave,
    );
    this.toast.update(deltaMs, this.layout);
    this.gameOver.render(this.state, TEAM_ID);
  }

  /**
   * §9.3's counter hints are computed once per wave, not per frame - they depend
   * only on (seed, waveNumber), so recomputing them 60 times a second would be
   * pure waste (§15.3).
   */
  private refreshSummary(): void {
    const wave = this.state.phase === 'build' ? this.state.wave + 1 : this.state.wave;
    if (wave === this.summarisedWave) return;
    this.summarisedWave = wave;
    this.summary = summariseWave(this.data, this.state.seed, wave, 'bastion');
  }

  // ------------------------------------------------------------------- input

  private issue(command: Command): boolean {
    const result = applyCommand(this.ctx, this.state, command);
    if (!result.ok && result.rejection) this.toast.show(result.rejection);
    return result.ok;
  }

  private selectUnitDef(unitDefId: string): void {
    this.selection =
      this.selection?.kind === 'unitDef' && this.selection.unitDefId === unitDefId
        ? null
        : { kind: 'unitDef', unitDefId };
  }

  private clearSelection(): void {
    this.selection = null;
  }

  private upgrade(unitId: number): void {
    // §7.3: in place - the unit keeps its tile and its identity.
    this.issue({ kind: 'upgradeUnit', teamId: TEAM_ID, unitId });
  }

  private tapTile(tileX: number, tileY: number): void {
    const existing = this.lane.units.find((u) => u.alive && u.tileX === tileX && u.tileY === tileY);

    // With a unit type in hand, a tap on a taken tile means "I meant to build
    // there" - so say so and keep the selection, rather than silently throwing
    // away what they picked.
    if (existing && this.selection?.kind === 'unitDef') {
      this.toast.show('tile-occupied');
      return;
    }

    // Otherwise tapping one of your own units selects it, and the build bar
    // becomes its upgrade panel. Upgrading is never a side effect of tapping
    // the board.
    if (existing) {
      this.selection = { kind: 'placedUnit', unitId: existing.id };
      return;
    }

    if (this.selection?.kind === 'unitDef') {
      this.issue({
        kind: 'placeUnit',
        teamId: TEAM_ID,
        unitDefId: this.selection.unitDefId,
        tileX,
        tileY,
      });
      return;
    }

    this.clearSelection();
  }
}

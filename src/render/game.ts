/**
 * Wires a match to the renderer. DESIGN.md §15.1, §17 (M2 through M4).
 *
 * The split this file maintains is the one §15.1 rests on: a simulation runs at
 * a fixed 20Hz somewhere, and the renderer reads what it is allowed to read and
 * draws it. "Somewhere" is the point - this class talks to a `Transport`
 * (src/net) and cannot tell whether the simulation is in this tab or on a
 * server. It never sees a `MatchState`, only a `MatchView` (§12), so fog of war
 * is not something the renderer has to be trusted with.
 *
 * Commands go out through the transport and are never applied here. Locally
 * that is immediate; remotely it is a round trip. Either way the answer comes
 * back as a rejection code to show, because "you cannot afford that" is a
 * normal outcome of tapping a button, not an error.
 *
 * WATCHING SOMEBODY ELSE'S LANE
 *
 * One lane is on screen at a time (§14.1: fixed camera, no scrolling). Which
 * one is a property of this class, not of the match: tap an opponent tab you
 * can see inside and the lane view, entity layer and interpolation all switch
 * to it. Everything you can do stays pointed at your OWN lane while you watch -
 * building in somebody else's is not a thing, and the simulation would refuse
 * it anyway (§15.1).
 */

import { Container } from 'pixi.js';
import type { GameData } from '../data/schema.ts';
import {
  buildDefIndex,
  summariseWave,
  type Command,
  type LaneView,
  type MatchView,
  type WaveSummary,
} from '../sim/index.ts';
import type { Transport } from '../net/transport.ts';
import { EntityLayer } from './entities.ts';
import { computeLayout, type LaneLayout } from './layout.ts';
import { LaneView as LaneViewLayer } from './laneView.ts';
import { BuildBar, type Selection } from './ui/buildBar.ts';
import { GameOver } from './ui/gameOver.ts';
import { Hud } from './ui/hud.ts';
import { OpponentTabs } from './ui/opponentTabs.ts';
import { Toast } from './ui/toast.ts';
import { WatchBanner } from './ui/watchBanner.ts';

export interface GameHandlers {
  /** Start a fresh match. The app owns transports, so it owns restarting. */
  onRestart(): void;
}

export class Game extends Container {
  private layout: LaneLayout;
  private selection: Selection = null;
  /**
   * The unit type that was in hand when the player opened an upgrade panel, so
   * Back returns them to laying their line instead of to nothing.
   */
  private pendingUnitDefId: string | null = null;
  private summary: WaveSummary | null = null;
  private summarisedWave = -1;

  /** The last view, held so the outgoing one can seed interpolation. */
  private view: MatchView | null = null;
  /** Whose lane is on screen. Null means your own. */
  private watchingTeamId: string | null = null;

  private readonly laneLayer: LaneViewLayer;
  private readonly entities: EntityLayer;
  private readonly hud: Hud;
  private readonly tabs: OpponentTabs;
  private readonly banner: WatchBanner;
  private readonly buildBar: BuildBar;
  private readonly toast = new Toast();
  private readonly gameOver: GameOver;

  constructor(
    private readonly data: GameData,
    private transport: Transport,
    width: number,
    height: number,
    private readonly handlers: GameHandlers,
  ) {
    super();

    this.layout = computeLayout(width, height, data.lane);
    this.view = transport.view();

    this.laneLayer = new LaneViewLayer(this.layout, data, {
      onTapTile: (x, y) => this.tapTile(x, y),
      onTapElsewhere: () => this.cancelSelection(),
    });
    // §14.2 reads tier off the definition, and the definitions are the same
    // everywhere (§9.2) - so the renderer indexes them itself rather than being
    // sent them with every frame.
    this.entities = new EntityLayer(this.layout, buildDefIndex(data));
    this.hud = new Hud(this.layout, data);
    this.tabs = new OpponentTabs(this.layout, {
      onWatch: (teamId) => this.watch(teamId),
      onWatchOwn: () => this.watch(null),
      onBlocked: () => this.toast.showText('No sight of that lane'),
    });
    this.banner = new WatchBanner(this.layout, () => this.watch(null));
    this.buildBar = new BuildBar(this.layout, data, {
      onSelectUnitDef: (id) => this.selectUnitDef(id),
      onUpgrade: (id) => this.issue({ kind: 'upgradeUnit', teamId: this.teamId, unitId: id }),
      onSelectWeapon: (damageType) => {
        this.issue({ kind: 'setWeaponType', teamId: this.teamId, damageType });
      },
      onSelectAura: (aura) => this.issue({ kind: 'setAura', teamId: this.teamId, aura }),
      onBuyTech: (trackId) => this.issue({ kind: 'buyTech', teamId: this.teamId, trackId }),
      onBuyFortress: (upgradeId) => {
        this.issue({ kind: 'buyFortressUpgrade', teamId: this.teamId, upgradeId });
      },
      onBuySupply: () => this.issue({ kind: 'buySupply', teamId: this.teamId }),
      onSend: (sendId, targetTeamId) => {
        this.issue({ kind: 'send', teamId: this.teamId, targetTeamId, sendId });
      },
      onClearSelection: () => this.clearSelection(),
    });
    this.gameOver = new GameOver(this.layout, {
      onRestart: () => this.handlers.onRestart(),
      onSpectate: () => this.spectateFirstAvailable(),
    });

    this.addChild(
      this.laneLayer,
      this.entities,
      this.hud,
      this.tabs,
      this.banner,
      this.buildBar,
      this.toast,
      this.gameOver,
    );
  }

  private get teamId(): string {
    return this.transport.teamId ?? '';
  }

  /** Swap in a new transport - a restart, or connecting to a server. */
  setTransport(transport: Transport): void {
    this.transport.dispose();
    this.transport = transport;
    this.view = transport.view();
    this.watchingTeamId = null;
    this.selection = null;
    this.pendingUnitDefId = null;
    this.summarisedWave = -1;
    this.entities.reset();
    this.gameOver.reset();
  }

  resize(width: number, height: number): void {
    this.layout = computeLayout(width, height, this.data.lane);
    this.laneLayer.setLayout(this.layout);
    this.entities.setLayout(this.layout);
    this.hud.setLayout(this.layout);
    this.tabs.setLayout(this.layout);
    this.banner.setLayout(this.layout);
    this.buildBar.setLayout(this.layout);
    this.gameOver.setLayout(this.layout);
  }

  /** One animation frame. `deltaMs` is wall time; the simulation never sees it. */
  frame(deltaMs: number): void {
    this.transport.update(deltaMs);

    if (this.transport.consumeTick()) {
      // Seed interpolation from the view being replaced, then take the new one.
      this.entities.captureTick(this.shownLane());
      this.view = this.transport.view();
    }

    for (const rejection of this.transport.takeRejections()) this.toast.show(rejection);

    const view = this.view;
    if (!view) {
      // Still connecting. Say so rather than showing an empty lane.
      this.banner.renderStatus(this.transport.status, this.transport.detail);
      this.toast.update(deltaMs, this.layout);
      return;
    }

    // A connection that drops mid-match leaves a lane on screen that has
    // stopped moving, which looks exactly like the game having crashed. The
    // notice takes the banner over from the watch indicator while that is true.
    const connected = this.transport.status === 'ready';

    this.refreshSummary(view);
    this.dropStaleWatch(view);

    const lane = this.shownLane();
    const watching = this.watchingTeamId !== null;
    const selectedUnitId =
      !watching && this.selection?.kind === 'placedUnit' ? this.selection.unitId : null;

    if (lane) {
      this.laneLayer.render(view, lane, selectedUnitId, this.summary);
      this.entities.render(lane, this.transport.alpha);
    }
    this.hud.render(view, this.summary);
    this.tabs.render(view, this.watchingTeamId);
    if (connected) this.banner.render(view, this.watchingTeamId);
    else this.banner.renderStatus(this.transport.status, this.transport.detail);
    if (view.lane) this.buildBar.render(view, view.lane, this.selection, this.summary);
    this.toast.update(deltaMs, this.layout);
    this.gameOver.render(view);
  }

  /** The lane currently on screen: somebody else's if watching, else your own. */
  private shownLane(): LaneView | null {
    const view = this.view;
    if (!view) return null;
    if (this.watchingTeamId === null) return view.lane;
    return view.watching[this.watchingTeamId] ?? view.lane;
  }

  private watch(teamId: string | null): void {
    if (this.watchingTeamId === teamId) return;
    this.watchingTeamId = teamId;
    // Two lanes have unrelated entity ids, so interpolating across the switch
    // would slide bodies between lanes for one tick.
    this.entities.reset();
    // Nothing selected in a lane you are only looking at.
    this.selection = null;
    this.pendingUnitDefId = null;
  }

  /** Bought sight runs out (§11.5), so the camera has to come home by itself. */
  private dropStaleWatch(view: MatchView): void {
    if (this.watchingTeamId === null) return;
    if (view.watching[this.watchingTeamId]) return;
    this.watch(null);
    this.toast.showText('Sight of that lane has run out');
  }

  /** §13: an eliminated player may stay and watch. Start them somewhere. */
  private spectateFirstAvailable(): void {
    const view = this.view;
    if (!view) return;
    const alive = view.opponents.find((o) => !o.eliminated && o.watching);
    const any = alive ?? view.opponents.find((o) => o.watching);
    if (any) this.watch(any.teamId);
  }

  /**
   * §9.3's counter hints are computed once per wave, not per frame - they depend
   * only on (seed, waveNumber), so recomputing them 60 times a second would be
   * pure waste (§15.3).
   */
  private refreshSummary(view: MatchView): void {
    const wave = view.phase === 'build' ? view.wave + 1 : view.wave;
    if (wave === this.summarisedWave) return;
    this.summarisedWave = wave;
    this.summary = summariseWave(this.data, view.seed, wave, 'bastion');
  }

  // ------------------------------------------------------------------- input

  private issue(command: Command): void {
    this.transport.submit(command);
    // Locally this is already the post-command view, so a purchase shows up on
    // this frame rather than on the next tick. Remotely it is unchanged until
    // the server answers.
    this.view = this.transport.view() ?? this.view;
  }

  private selectUnitDef(unitDefId: string): void {
    this.pendingUnitDefId = null;
    this.selection =
      this.selection?.kind === 'unitDef' && this.selection.unitDefId === unitDefId
        ? null
        : { kind: 'unitDef', unitDefId };
  }

  /** Back out of an upgrade panel, restoring whatever was in hand before it. */
  private clearSelection(): void {
    this.selection = this.pendingUnitDefId
      ? { kind: 'unitDef', unitDefId: this.pendingUnitDefId }
      : null;
    this.pendingUnitDefId = null;
  }

  /** A tap on empty space means "cancel", so it drops the memory too. */
  private cancelSelection(): void {
    this.selection = null;
    this.pendingUnitDefId = null;
  }

  private tapTile(tileX: number, tileY: number): void {
    // Taps on a lane you are watching do nothing. You are a spectator there.
    if (this.watchingTeamId !== null) return;

    const lane = this.view?.lane;
    if (!lane) return;

    const existing = lane.units.find(
      (u) => Math.floor(u.x) === tileX && Math.floor(u.y) === tileY,
    );

    // Tapping one of your own units always opens its upgrade panel - that is
    // the only route to upgrading, so it must not be blocked by having a build
    // type in hand. The type is remembered and Back restores it, which keeps
    // laying a line uninterrupted. Upgrading is never a side effect: the panel
    // has its own button.
    if (existing) {
      this.pendingUnitDefId = this.selection?.kind === 'unitDef' ? this.selection.unitDefId : null;
      this.selection = { kind: 'placedUnit', unitId: existing.id };
      return;
    }

    if (this.selection?.kind === 'unitDef') {
      this.issue({
        kind: 'placeUnit',
        teamId: this.teamId,
        unitDefId: this.selection.unitDefId,
        tileX,
        tileY,
      });
      return;
    }

    this.cancelSelection();
  }
}

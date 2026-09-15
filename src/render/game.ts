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
 * BEFORE THE MATCH
 *
 * Three screens, in order, and only the first two for a practice match:
 *
 *   1. **Home** - your name, and which kind of match (§17, M6).
 *   2. **The builder picker** - a match cannot start until its lane has a
 *      roster (§7.1).
 *   3. **The lobby** - only when the match is on a server, because only then is
 *      there anybody to wait for. It is the same room the match will run in, so
 *      the transport exists from here on and the lobby is a phase of it rather
 *      than a separate connection.
 *
 * "Play again" comes back to the first of them rather than replaying the last
 * choice, since trying a different roster - or a different opponent - is the
 * main reason to play again.
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
import { AuraLayer } from './aura.ts';
import { EntityLayer } from './entities.ts';
import { EffectsLayer } from './effects.ts';
import { computeLayout, type LaneLayout } from './layout.ts';
import { LaneView as LaneViewLayer } from './laneView.ts';
import { BuildBar, type Selection } from './ui/buildBar.ts';
import { BuilderSelect } from './ui/builderSelect.ts';
import { GameOver } from './ui/gameOver.ts';
import { HomeScreen, type MatchMode } from './ui/homeScreen.ts';
import { LobbyScreen } from './ui/lobbyScreen.ts';
import { Hud } from './ui/hud.ts';
import { OpponentTabs } from './ui/opponentTabs.ts';
import { Toast } from './ui/toast.ts';
import { WatchBanner } from './ui/watchBanner.ts';

/**
 * What the game needs from the app around it. Everything that touches the DOM
 * or the network lives behind this, so this class stays a renderer.
 */
export interface GameServices {
  /** Makes a transport for a chosen roster: a local simulation, or a room. */
  createTransport(mode: MatchMode, builderId: string): Transport;
  /** The player's display name right now (identity.ts). */
  name(): string;
  /** Ask for a new name and persist it. Null if the player backed out. */
  editName(): Promise<string | null>;
  /** Ask for a room code. Null if the player backed out. */
  askRoomCode(): Promise<string | null>;
  /** Whether a server is configured at all. Practice needs none. */
  online: boolean;
}

/** Which screen is in front. The match is what is behind all of them. */
type Screen = 'home' | 'builder' | 'lobby' | 'match';

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
  private summarisedBuilder = '';

  /** Null until a roster is picked and a match exists. */
  private transport: Transport | null = null;
  private screen: Screen = 'home';
  /** How the current match was found. Kept so Change roster can reuse it. */
  private mode: MatchMode = { kind: 'practice' };
  /** The last view, held so the outgoing one can seed interpolation. */
  private view: MatchView | null = null;
  /** Whose lane is on screen. Null means your own. */
  private watchingTeamId: string | null = null;

  private readonly laneLayer: LaneViewLayer;
  private readonly auraLayer: AuraLayer;
  private readonly entities: EntityLayer;
  /** Named `effectsLayer`: Pixi's Container already owns `effects`. */
  private readonly effectsLayer: EffectsLayer;
  private readonly hud: Hud;
  private readonly tabs: OpponentTabs;
  private readonly banner: WatchBanner;
  private readonly buildBar: BuildBar;
  private readonly toast = new Toast();
  private readonly gameOver: GameOver;
  private readonly builderSelect: BuilderSelect;
  private readonly home: HomeScreen;
  private readonly lobbyScreen: LobbyScreen;

  constructor(
    private readonly data: GameData,
    private readonly services: GameServices,
    width: number,
    height: number,
  ) {
    super();

    this.layout = computeLayout(width, height, data.lane);

    this.laneLayer = new LaneViewLayer(this.layout, data, {
      onTapTile: (x, y) => this.tapTile(x, y),
      onTapElsewhere: () => this.cancelSelection(),
    });
    // §14.2 reads tier off the definition, and the definitions are the same
    // everywhere (§9.2) - so the renderer indexes them itself rather than being
    // sent them with every frame.
    const defs = buildDefIndex(data);
    this.auraLayer = new AuraLayer(this.layout, data.lane);
    this.entities = new EntityLayer(this.layout, defs);
    // Above the bodies, so a swing reads as landing ON what it hits (§14.2).
    this.effectsLayer = new EffectsLayer(this.layout, data, defs);
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
      onSell: (id) => {
        this.issue({ kind: 'sellUnit', teamId: this.teamId, unitId: id });
        // The unit ceases to exist, so the panel describing it has to go with
        // it. Clearing rather than cancelling puts back whatever was in hand,
        // which is what makes an accidental build a true undo.
        this.clearSelection();
      },
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
      onSelectPlacedUnit: (unitId) => this.selectPlacedUnit(unitId),
    });
    this.gameOver = new GameOver(this.layout, {
      onRestart: () => this.chooseAgain(),
      onSpectate: () => this.spectateFirstAvailable(),
    });
    this.builderSelect = new BuilderSelect(this.layout, data, (builderId) => {
      this.chooseBuilder(builderId);
    });
    this.home = new HomeScreen(this.layout, {
      onChoose: (mode) => this.chooseMode(mode),
      onEditName: () => void this.editName(),
      onPrivateRoom: () => void this.askRoomCode(),
    });
    this.lobbyScreen = new LobbyScreen(this.layout, data, {
      onReady: (ready) => this.transport?.setReady(ready),
      onChangeBuilder: () => this.showScreen('builder'),
      onLeave: () => this.goHome(),
    });

    this.addChild(
      this.laneLayer,
      // Between the ground and the bodies: the aura is held ground, and it
      // must never obscure the fight standing on it (§10.1).
      this.auraLayer,
      this.entities,
      this.effectsLayer,
      this.hud,
      this.tabs,
      this.banner,
      this.buildBar,
      this.toast,
      this.gameOver,
      this.builderSelect,
      this.lobbyScreen,
      this.home,
    );

    this.showScreen('home');
  }

  // ------------------------------------------------------- getting to a match

  /** Exactly one of the front screens is up at a time; the match is behind. */
  private showScreen(screen: Screen): void {
    this.screen = screen;
    this.home.visible = screen === 'home';
    this.builderSelect.visible = screen === 'builder';
    if (screen === 'home') this.home.setState(this.services.name(), this.services.online);
    if (screen !== 'lobby') this.lobbyScreen.reset();
  }

  private async editName(): Promise<void> {
    await this.services.editName();
    if (this.screen === 'home') this.home.setState(this.services.name(), this.services.online);
    // A name changed while sitting in a lobby should reach the other three
    // people looking at it.
    this.transport?.setName(this.services.name());
  }

  private async askRoomCode(): Promise<void> {
    const code = await this.services.askRoomCode();
    if (code === null) return;
    this.chooseMode({ kind: 'private', code });
  }

  private chooseMode(mode: MatchMode): void {
    this.mode = mode;
    this.showScreen('builder');
  }

  /**
   * A roster is picked. For a match that does not exist yet this creates it;
   * for one already sitting in a lobby it just changes the roster, because
   * rejoining the room would give up the seat.
   */
  private chooseBuilder(builderId: string): void {
    if (
      this.transport &&
      this.screen === 'builder' &&
      this.transport.hasLobby &&
      !this.transport.matchStarted
    ) {
      this.transport.setBuilder(builderId);
      this.showScreen('lobby');
      return;
    }
    this.start(builderId);
  }

  /** Leave whatever is going on and come back to the front. */
  private goHome(): void {
    this.transport?.dispose();
    this.transport = null;
    this.view = null;
    this.gameOver.reset();
    this.entities.reset();
    this.effectsLayer.reset();
    this.showScreen('home');
  }

  /** Pick a roster, then play it (§7.1). */
  private start(builderId: string): void {
    this.transport?.dispose();
    this.transport = this.services.createTransport(this.mode, builderId);
    this.view = this.transport.view();
    this.watchingTeamId = null;
    this.selection = null;
    this.pendingUnitDefId = null;
    this.summarisedWave = -1;
    this.summarisedBuilder = '';
    this.entities.reset();
    this.effectsLayer.reset();
    this.gameOver.reset();
    // A remote match opens in its lobby, even before the room has answered; a
    // practice match has no lobby and is already running.
    this.showScreen(this.transport.hasLobby && !this.transport.matchStarted ? 'lobby' : 'match');
  }

  /** Back to the front: a different roster, or a different room. */
  private chooseAgain(): void {
    this.goHome();
  }

  private get teamId(): string {
    return this.transport?.teamId ?? '';
  }

  resize(width: number, height: number): void {
    this.layout = computeLayout(width, height, this.data.lane);
    this.laneLayer.setLayout(this.layout);
    this.auraLayer.setLayout(this.layout);
    this.entities.setLayout(this.layout);
    this.effectsLayer.setLayout(this.layout);
    this.hud.setLayout(this.layout);
    this.tabs.setLayout(this.layout);
    this.banner.setLayout(this.layout);
    this.buildBar.setLayout(this.layout);
    this.gameOver.setLayout(this.layout);
    this.builderSelect.setLayout(this.layout);
    this.home.setLayout(this.layout);
    this.lobbyScreen.setLayout(this.layout);
  }

  /** One animation frame. `deltaMs` is wall time; the simulation never sees it. */
  frame(deltaMs: number): void {
    const transport = this.transport;
    if (!transport) {
      // On the home screen or the picker, with no match yet. Nothing to
      // simulate and nothing to draw behind them.
      this.toast.update(deltaMs, this.layout);
      return;
    }

    transport.update(deltaMs);

    // A room exists before the match in it does, so kickoff is a transition
    // the renderer watches for rather than a message it has to handle. It is
    // checked for the picker too, because a player can still be changing
    // roster when the room starts without them.
    const waitingToStart = transport.hasLobby && !transport.matchStarted;
    if (!waitingToStart && (this.screen === 'lobby' || this.screen === 'builder')) {
      this.showScreen('match');
    }
    if (waitingToStart && this.screen === 'lobby') {
      this.lobbyScreen.render(transport.lobby(), transport.status, transport.detail);
      this.toast.update(deltaMs, this.layout);
      return;
    }
    if (waitingToStart && this.screen === 'builder') {
      // Changing roster from inside a lobby. The picker is in front and there
      // is no board behind it yet.
      this.toast.update(deltaMs, this.layout);
      return;
    }

    if (transport.consumeTick()) {
      // Seed interpolation from the view being replaced, then take the new one.
      const outgoing = this.shownLane();
      this.entities.captureTick(outgoing);
      this.view = transport.view();
      // Blows landed on this tick become effects, for the lane on screen only:
      // a fight you cannot see does not need animating.
      const incoming = this.shownLane();
      if (incoming) this.effectsLayer.spawn(incoming, outgoing);
    }

    // Effects run on wall time, not on ticks: a 170ms swing at 60fps is ten
    // frames, and at 20Hz it would be three.
    this.effectsLayer.update(deltaMs);
    this.auraLayer.update(deltaMs);

    for (const rejection of transport.takeRejections()) this.toast.show(rejection);

    const view = this.view;
    if (!view) {
      // Still connecting. Say so rather than showing an empty lane.
      this.banner.renderStatus(transport.status, transport.detail);
      this.toast.update(deltaMs, this.layout);
      return;
    }

    // A connection that drops mid-match leaves a lane on screen that has
    // stopped moving, which looks exactly like the game having crashed. The
    // notice takes the banner over from the watch indicator while that is true.
    const connected = transport.status === 'ready';

    this.refreshSummary(view);
    this.dropStaleWatch(view);

    const lane = this.shownLane();
    const watching = this.watchingTeamId !== null;
    const selectedUnitId =
      !watching && this.selection?.kind === 'placedUnit' ? this.selection.unitId : null;

    this.auraLayer.read(lane);
    if (lane) {
      this.laneLayer.render(view, lane, selectedUnitId, this.summary);
      this.auraLayer.render();
      this.entities.render(lane, transport.alpha);
      this.effectsLayer.render();
    }
    this.hud.render(view, this.summary);
    this.tabs.render(view, this.watchingTeamId);
    if (connected) this.banner.render(view, this.watchingTeamId);
    else this.banner.renderStatus(transport.status, transport.detail);
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
    // would slide bodies between lanes for one tick - and a shot still in the
    // air belongs to the lane it was fired in.
    this.entities.reset();
    this.effectsLayer.reset();
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
    const builderId = view.lane?.builderId ?? '';
    if (wave === this.summarisedWave && builderId === this.summarisedBuilder) return;
    this.summarisedWave = wave;
    this.summarisedBuilder = builderId;
    // §9.3's hints are "which of YOUR units counter this", so they are a
    // function of the roster as well as the wave.
    this.summary = summariseWave(this.data, view.seed, wave, builderId);
  }

  // ------------------------------------------------------------------- input

  private issue(command: Command): void {
    const transport = this.transport;
    if (!transport) return;
    transport.submit(command);
    // Locally this is already the post-command view, so a purchase shows up on
    // this frame rather than on the next tick. Remotely it is unchanged until
    // the server answers.
    this.view = transport.view() ?? this.view;
  }

  private selectUnitDef(unitDefId: string): void {
    this.pendingUnitDefId = null;
    this.selection =
      this.selection?.kind === 'unitDef' && this.selection.unitDefId === unitDefId
        ? null
        : { kind: 'unitDef', unitDefId };
  }

  /**
   * Point the selection at a unit without going through the board.
   *
   * The damage panel ranks units by what they landed and answers "which one is
   * that" by pointing at it: a tapped row selects the unit, and the lane draws
   * the selection ring §14.2 already draws for a unit tapped on the board. The
   * build bar stays where it is, because the panel that asked the question is
   * the one the player is reading.
   */
  private selectPlacedUnit(unitId: number): void {
    this.selection =
      this.selection?.kind === 'placedUnit' && this.selection.unitId === unitId
        ? null
        : { kind: 'placedUnit', unitId };
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

    const existing = lane.units.find((u) => Math.floor(u.x) === tileX && Math.floor(u.y) === tileY);

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

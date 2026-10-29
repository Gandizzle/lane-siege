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
 * The tutorial is a fourth way in from Home: its own chapter list
 * (ui/tutorialScreen.ts), then a practice match per chapter with the coach over
 * it (ui/tutorialCoach.ts, src/tutorial). The match is an ordinary local one;
 * what makes it a lesson is that it holds still while the coach is talking,
 * and that the coach decides what can be tapped.
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
import { resolveAbility } from '../data/schema.ts';
import {
  arenaShape,
  boardOpenIn,
  buildDefIndex,
  hasMark,
  inBounds,
  summariseWave,
  type ArenaLayout,
  type Command,
  type DefIndex,
  type LaneView,
  type MatchView,
  type WaveSummary,
} from '../sim/index.ts';
import type { Transport } from '../net/transport.ts';
import { MatchCues, combatCues } from '../audio/cues.ts';
import type { SoundSystem } from '../audio/engine.ts';
import type { DeathRule } from './deaths.ts';
import type { PreferenceStore } from './preferences.ts';
import { ArenaStage, arenaAsLane } from './arena.ts';
import { battlefieldOf, type BattlefieldId } from './battlefield.ts';
import { VictoryShow, looksOf, victoryOf, winnerOf } from './looks.ts';
import { AuraLayer } from './aura.ts';
import { EntityLayer } from './entities.ts';
import { EffectsLayer } from './effects.ts';
import {
  TOUCH_SLACK_PX,
  bodyNear,
  computeLayout,
  tileToScreen,
  type LaneLayout,
} from './layout.ts';
import { comesNext, LaneView as LaneViewLayer } from './laneView.ts';
import { AbilityCard } from './ui/abilityCard.ts';
import { BuildBar, type Selection } from './ui/buildBar.ts';
import { BuilderSelect } from './ui/builderSelect.ts';
import { ShowdownCountdown } from './ui/countdown.ts';
import { GameOver, type KeepOffer } from './ui/gameOver.ts';
import { HomeScreen, type HomeProfile, type MatchMode } from './ui/homeScreen.ts';
import { XpReport } from './ui/xpReport.ts';
import { BoostOffer } from './ui/boostOffer.ts';
import { SupportScreen, supporterBonus } from './ui/supportScreen.ts';
import { CollectionScreen } from './ui/collectionScreen.ts';
import { SavedBuildNews } from './ui/savedBuildNews.ts';
import { FounderNews } from './ui/founderNews.ts';
import type { RewardedAds } from './ui/adPlaceholder.ts';
import { waveCount, type XpAward, type XpMode } from '../progression/award.ts';
import { forSale } from '../progression/cosmetics.ts';
import type { ProgressStore } from '../progression/store.ts';
import type { SavedBuilds } from '../net/ghostApi.ts';
import type { Founders } from '../net/founderApi.ts';
import { ShowdownSetup, type SeatSetup } from './ui/showdownSetup.ts';
import { LobbyScreen } from './ui/lobbyScreen.ts';
import { Menu, MenuButton } from './ui/menu.ts';
import { EffectsButton, EffectsPanel } from './ui/effectsPanel.ts';
import { DamageChart } from './ui/damageChart.ts';
import { WaveCleared } from './ui/waveCleared.ts';
import { UpgradeBursts } from './upgradeBursts.ts';
import { StatusLog } from './statusLog.ts';
import { LEGEND_BUTTON_SIZE, type Rect } from './layout.ts';
import { Hud } from './ui/hud.ts';
import { TutorialCoach, type CoachCard } from './ui/tutorialCoach.ts';
import { TutorialScreen, type LessonEntry } from './ui/tutorialScreen.ts';
import { ChapterComplete } from './ui/chapterComplete.ts';
import { CHAPTERS } from '../tutorial/chapters.ts';
import { LESSONS, lessonId, lessonTitle, practiceIntro } from '../tutorial/lessons.ts';
import { TutorialRunner } from '../tutorial/runner.ts';
import type { Chapter, Lesson, Practice, Scene, Target, UiProbe } from '../tutorial/types.ts';
import { EVERYTHING, featuresFor, type Features } from './features.ts';
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
  /** §3.3, replaced: a local match that opens in the arena (showdownSetup.ts). */
  createShowdown(seats: SeatSetup[]): Transport;
  /** A tutorial chapter's match, and the way the chapter sets its scene (src/tutorial). */
  createTutorial(chapter: Chapter): { transport: Transport; scene: Scene };
  /** A practice match between chapters, already set up (tutorial/lessons.ts). */
  createPractice(practice: Practice): Transport;
  /** The player's display name right now (identity.ts). */
  name(): string;
  /** Ask for a new name and persist it. Null if the player backed out. */
  editName(): Promise<string | null>;
  /** Ask for a room code. Null if the player backed out. */
  askRoomCode(): Promise<string | null>;
  /** Whether a server is configured at all. Practice needs none. */
  online: boolean;
  /** Where sound goes, and its settings, which the menu edits (src/audio). */
  sound: SoundSystem;
  /** Status markers and game speed, which the menu edits too (preferences.ts). */
  preferences: PreferenceStore;
  /** XP, levels, boosts, keys, what is unlocked and worn (src/progression). */
  progress: ProgressStore;
  /** The opt-in ad behind the XP boost. A placeholder for now (ui/adPlaceholder.ts). */
  ads: RewardedAds;
  /**
   * `?progress=test`: practice and solo count as normal matches for XP, the
   * Supporter button and the Founders' claim grant what they would, and the
   * Collection has a button that climbs a level - so the whole loop can be
   * tried without a server or a payment provider.
   */
  progressTest: boolean;
  /**
   * The player's saved build on the server (net/ghostApi.ts): how it has done,
   * and keeping the last one. Null with no server to keep one on.
   */
  savedBuilds: SavedBuilds | null;
  /**
   * The Founders on the server (net/founderApi.ts): claiming this player's
   * number at the Founders' level, and how many are left. Null with no server.
   */
  founders: Founders | null;
}

/** Which screen is in front. The match is what is behind all of them. */
type Screen = 'home' | 'builder' | 'lobby' | 'showdownSetup' | 'tutorial' | 'match';

export class Game extends Container {
  private layout: LaneLayout;
  private selection: Selection = null;
  /** The ability whose card is open, or null (abilityCard.ts). */
  private openAbility: { id: string; rank: number } | null = null;
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
  private readonly abilityCard: AbilityCard;
  private readonly gameOver: GameOver;
  private readonly builderSelect: BuilderSelect;
  private readonly home: HomeScreen;
  private readonly lobbyScreen: LobbyScreen;
  private readonly showdownSetup: ShowdownSetup;
  /** §3.3, replaced: the cross the last fight happens on, and the card that opens it. */
  private readonly arena: ArenaStage;
  private readonly countdown: ShowdownCountdown;
  /** The burst when your lane is clear (ui/waveCleared.ts). */
  private readonly waveCleared: WaveCleared;
  /** "Chapter 2 Complete!", over the coach's last card (ui/chapterComplete.ts). */
  private readonly chapterComplete: ChapterComplete;
  /** The burst on a unit just upgraded (upgradeBursts.ts). */
  private readonly upgradeBursts: UpgradeBursts;
  /** Over everything, on every screen: settings, and the way out of a match. */
  private readonly menu: Menu;
  private readonly menuButton: MenuButton;
  /** What the status markers mean: the legend button, and the panel it opens. */
  private readonly effectsButton: EffectsButton;
  private readonly effectsPanel: EffectsPanel;
  /** Every damage type against every armor: from the menu, and the tutorial. */
  private readonly damageChart: DamageChart;
  /** Which kinds of marker have been on screen, for the legend. */
  private readonly statusLog = new StatusLog();
  /** The chapter list, and the coach over a chapter's match. */
  private readonly tutorialScreen: TutorialScreen;
  private readonly coach: TutorialCoach;
  /** The chapter being played, while one is (src/tutorial). `index` is into LESSONS. */
  private lesson: { index: number; runner: TutorialRunner; recorded: boolean } | null = null;
  /**
   * The practice match being played, while one is (tutorial/lessons.ts).
   * `intro` while its opening card is up, which holds the match.
   */
  private practice: {
    index: number;
    def: Practice;
    intro: boolean;
    recorded: boolean;
  } | null = null;
  /**
   * How a solo match came out against the best on this device, worked out
   * once as the fortress falls (§3.3, solo) - null until then, and in every
   * other kind of match.
   */
  private soloResult: { best: number; newBest: boolean } | null = null;
  /** This match's XP has been counted: once, as your match ends (src/progression). */
  private awarded = false;
  /**
   * A quick match's Save this build, as far as it has got; null until it is
   * pressed. Reset with each match.
   */
  private keepState: KeepOffer | null = null;
  /** The player has a saved build already: keeping this one replaces it. */
  private hasSavedBuild = false;
  /** This match's saved-build seats have been mentioned, or there were none. */
  private savedBuildsNoted = false;
  /** What the player's saved build did while they were away (ui/savedBuildNews.ts). */
  private readonly savedBuildNews: SavedBuildNews;
  /** "Founder #7", the moment it is won (ui/founderNews.ts). */
  private readonly founderNews: FounderNews;
  /** A Founder's number won and not yet shown: it waits for the home screen. */
  private founderToShow: number | null = null;
  /** A claim is on its way to the server: one at a time. */
  private claimingFounder = false;
  /** What the match earned, line by line, and the climb it bought. */
  private readonly xpReport: XpReport;
  /** The winner's flourish (looks.ts), over the end of a match. Paint only. */
  private readonly victoryShow = new VictoryShow();
  /** The match's winner has been celebrated, or there was nobody to celebrate. */
  private celebrated = false;
  /** The XP boost, asked about before a game (ui/boostOffer.ts). */
  private readonly boostOffer: BoostOffer;
  /** The game the boost offer is holding, started once it is answered. */
  private afterOffer: (() => void) | null = null;
  /** The ad is up: a second Yes must not start a second one. */
  private watchingAd = false;
  private readonly supportScreen: SupportScreen;
  private readonly collectionScreen: CollectionScreen;
  /** Where the legend button was last put, so it is only moved when that changes. */
  private effectsButtonAt = '';
  /**
   * Seconds of match time, for the status markers' animation. Stops with the
   * match when the menu pauses it, so a flame does not flicker on while
   * everything else holds still.
   */
  private statusClock = 0;
  /**
   * The ground's clock, in seconds of wall time (battlefield.ts). It is
   * scenery rather than the match, so it keeps going while the match is
   * paused and does not speed up with it.
   */
  private groundClock = 0;
  /** True once the arena has taken the screen, so the swap happens once. */
  private inShowdown = false;
  private readonly defs: DefIndex;
  /** The match's own sounds: phases, your lane, the ending (src/audio/cues.ts). */
  private readonly matchCues = new MatchCues();
  /** Board widths in tiles, for panning a sound to where it happened. */
  private readonly laneWidth: number;
  private readonly arenaWidths: Record<ArenaLayout, number>;

  constructor(
    private readonly data: GameData,
    private readonly services: GameServices,
    width: number,
    height: number,
  ) {
    super();

    this.layout = computeLayout(width, height, data.lane);

    this.laneLayer = new LaneViewLayer(this.layout, data, {
      onTap: (x, y) => this.tapLane(x, y),
    });
    // §14.2 reads mark off the definition, and the definitions are the same
    // everywhere (§9.2) - so the renderer indexes them itself rather than being
    // sent them with every frame.
    const defs = buildDefIndex(data);
    this.defs = defs;
    this.laneWidth = data.lane.buildZone.width;
    this.arenaWidths = { cross: arenaShape(data, 'cross').width, y: arenaShape(data, 'y').width };
    this.auraLayer = new AuraLayer(this.layout, data.lane);
    this.entities = new EntityLayer(this.layout, defs);
    // Above the bodies, so a swing reads as landing ON what it hits (§14.2).
    this.effectsLayer = new EffectsLayer(this.layout, data, defs);
    this.upgradeBursts = new UpgradeBursts(this.layout, defs);
    this.hud = new Hud(this.layout, data);
    this.tabs = new OpponentTabs(this.layout, {
      onWatch: (teamId) => this.watch(teamId),
      onWatchOwn: () => this.watch(null),
      onBlocked: () => this.toast.showText('No sight of that lane'),
    });
    this.banner = new WatchBanner(this.layout, () => this.watch(null));
    this.abilityCard = new AbilityCard(this.layout, () => this.closeAbility(), {
      energy: data.abilities.energy,
      control: data.abilities.control,
      dampening: data.waves.showdown.dampening,
    });
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
      onSend: (sendId, targetTeamId, auto) => {
        // A tap is heard going out; auto-send's own shots are not, or a late
        // game of armed sends is one launch sound on repeat (audio/cues.ts).
        if (!auto) this.matchCues.sentByHand(sendId);
        this.issue({ kind: 'send', teamId: this.teamId, targetTeamId, sendId });
      },
      onClearSelection: () => this.clearSelection(),
      onSelectPlacedUnit: (unitId) => this.selectPlacedUnit(unitId),
      onShowAbility: (abilityId, rank) => this.showAbility(abilityId, rank),
    });
    this.gameOver = new GameOver(this.layout, {
      onRestart: () => this.chooseAgain(),
      onSpectate: () => this.spectateFirstAvailable(),
      onNextLesson: () => this.continueLesson(),
      onKeepBuild: () => void this.keepBuild(),
      onRetryLesson: () => {
        if (this.practice) this.startLesson(this.practice.index);
      },
    });
    const progress = services.progress;
    this.builderSelect = new BuilderSelect(
      this.layout,
      data,
      {
        owns: (id) => progress.ownsBuilder(id),
        cost: (id) => progress.builderCost(id),
        keysLeft: () => progress.keys.left,
        unlock: (id) => {
          const done = progress.unlockBuilder(id);
          if (done) this.unlocked(data.units.builders.find((b) => b.id === id)?.name ?? id);
          return done;
        },
      },
      (builderId) => this.chooseBuilder(builderId),
      () => this.leaveBuilders(),
    );
    this.home = new HomeScreen(this.layout, {
      onChoose: (mode) => this.chooseMode(mode),
      onEditName: () => void this.editName(),
      onPrivateRoom: () => void this.askRoomCode(),
      onCollection: () => this.openCollection(),
      onSupporter: () => this.openSupport(),
    });
    this.savedBuildNews = new SavedBuildNews(this.layout, () => this.savedBuildNews.close());
    this.founderNews = new FounderNews(this.layout, () => this.founderNews.close());
    this.xpReport = new XpReport(this.layout, {
      onClose: () => this.xpReport.close(),
      onLevelUp: () => this.services.sound.play('wave.cleared'),
    });
    this.boostOffer = new BoostOffer(this.layout, {
      onWatch: () => void this.watchBoostAd(),
      onSkip: () => this.leaveOffer(true),
      onPlay: () => this.leaveOffer(true),
    });
    this.supportScreen = new SupportScreen(this.layout, progress, services.progressTest, {
      onClose: () => this.supportScreen.close(),
      onBuy: () => this.buySupporter(),
      onClaimFounder: () => this.claimFounder(),
      onResetTest: () => {
        this.services.progress.clearPurchases();
        this.toast.showText('Test purchases taken back');
        this.progressChanged();
      },
    });
    this.collectionScreen = new CollectionScreen(
      this.layout,
      data,
      progress,
      services.progressTest,
      {
        onClose: () => this.collectionScreen.close(),
        onChanged: () => this.progressChanged(),
        onUnlocked: (name) => this.unlocked(name),
      },
    );
    this.lobbyScreen = new LobbyScreen(this.layout, data, {
      onReady: (ready) => this.transport?.setReady(ready),
      onChangeBuilder: () => this.showScreen('builder'),
      onLeave: () => this.goHome(),
    });
    this.showdownSetup = new ShowdownSetup(this.layout, data, {
      onPlay: (seats) => this.startShowdown(seats),
      onBack: () => this.goHome(),
    });
    this.arena = new ArenaStage(this.layout.screen, this.layout.tileSize, data, defs);
    this.arena.visible = false;
    this.countdown = new ShowdownCountdown(this.layout);
    this.waveCleared = new WaveCleared(this.layout);
    this.chapterComplete = new ChapterComplete(this.layout);
    this.menuButton = new MenuButton(this.layout, () => this.setMenu(true));
    this.menu = new Menu(this.layout, services.sound, services.preferences, {
      onClose: () => this.setMenu(false),
      onLeaveMatch: () => {
        this.setMenu(false);
        // Out of a lesson is back to the list of them, where the next one is.
        if (this.lesson || this.practice) this.leaveLesson();
        else this.goHome();
      },
      onEditName: () => void this.editName(),
      onEffectsGuide: () => {
        this.setMenu(false);
        this.openEffects('catalogue');
      },
      onDamageChart: () => {
        this.setMenu(false);
        this.damageChart.open();
      },
      onCollection: () => this.openCollection(),
      onSupporter: () => this.openSupport(),
    });
    this.tutorialScreen = new TutorialScreen(this.layout, LESSONS.map(lessonEntry), {
      onStart: (index) => this.startLesson(index),
      onBack: () => this.showScreen('home'),
    });
    this.coach = new TutorialCoach(this.layout, {
      onStart: () => this.playPractice(),
      onNext: () => this.lesson?.runner.next(),
      onBack: () => this.lesson?.runner.back(),
      onExit: () => this.leaveLesson(),
      onContinue: () => this.continueLesson(),
      onChapters: () => this.leaveLesson(),
    });
    this.effectsButton = new EffectsButton(() => this.openEffects('recent'));
    this.effectsButton.visible = false;
    this.effectsPanel = new EffectsPanel(this.layout, data, () => this.effectsPanel.close());
    this.damageChart = new DamageChart(this.layout, data, () => this.damageChart.close());

    this.addChild(
      // The arena replaces the lane stack rather than sitting over it: in the
      // showdown there is no lane, no fortress and nothing to build (§3.3, replaced).
      this.arena,
      this.laneLayer,
      // Between the ground and the bodies: the aura is held ground, and it
      // must never obscure the fight standing on it (§10.1).
      this.auraLayer,
      this.entities,
      this.effectsLayer,
      this.upgradeBursts,
      this.hud,
      this.tabs,
      this.banner,
      this.buildBar,
      // Over the bar it is opened from, because it is a modal answer to a tap
      // on it and a tap anywhere has to close it rather than reach the board.
      this.abilityCard,
      this.toast,
      // Over the board and the bar, under the coach and every panel: it is
      // a moment, and anything the player opens or is being told outranks it.
      this.waveCleared,
      this.gameOver,
      // Over the end-of-match card it pops up on: what the match earned.
      this.xpReport,
      // Over both: a winner's flourish goes off over the whole end of a match.
      this.victoryShow,
      // Over the board and under the front screens: it is a cut to a card, but
      // it must not cover the home screen if a match is abandoned under it.
      this.countdown,
      this.builderSelect,
      this.lobbyScreen,
      this.showdownSetup,
      this.tutorialScreen,
      this.home,
      // Over the board and under the menu and the legend, so neither is ever
      // out of reach while the coach is holding the rest of the screen.
      this.coach,
      // Over the coach, so its dimming does not dim the news. Paint only.
      this.chapterComplete,
      // Last, so they are over the front screens as well as the board.
      this.menuButton,
      this.effectsButton,
      this.menu,
      // Over the menu, which is one of the two ways into it.
      this.effectsPanel,
      this.damageChart,
      // From the home screen or the menu, so over both.
      this.collectionScreen,
      this.supportScreen,
      // Over everything: it stands between a tap on a builder and the game.
      this.boostOffer,
      // Over the home screen, the moment the game opens.
      this.savedBuildNews,
      // Over everything, the saved build's news included: it is the bigger news.
      this.founderNews,
    );

    this.showScreen('home');
    void this.checkSavedBuild();
    void this.checkFounder();
  }

  /**
   * The Esc key: close whatever is open over the menu - the battlefield
   * previews, the effects panel, the damage chart - and otherwise open or
   * close the menu.
   */
  toggleMenu(): void {
    // The boost offer first: asking, Esc backs out of starting the game at
    // all; with the congratulations up, it goes on to the game they were for.
    if (this.boostOffer.isOpen) {
      if (!this.watchingAd) this.leaveOffer(!this.boostOffer.asking);
      return;
    }
    if (this.founderNews.isOpen) {
      this.founderNews.close();
      return;
    }
    if (this.savedBuildNews.isOpen) {
      this.savedBuildNews.close();
      return;
    }
    for (const sheet of [this.supportScreen, this.collectionScreen]) {
      if (sheet.isOpen) {
        sheet.close();
        return;
      }
    }
    if (this.effectsPanel.isOpen) {
      this.effectsPanel.close();
      return;
    }
    if (this.damageChart.isOpen) {
      this.damageChart.close();
      return;
    }
    this.setMenu(!this.menu.isOpen);
  }

  /** The legend (what has been on the board) or the guide (everything). */
  private openEffects(view: 'recent' | 'catalogue'): void {
    // Opening the legend is reading it: the button's new-marker dot goes.
    if (view === 'recent') this.statusLog.markRead();
    this.effectsPanel.open(view);
  }

  /** Where the legend button goes: beside the tabs, or the arena's top corner. */
  private placeEffectsButton(): void {
    const rect: Rect = this.inShowdown
      ? {
          x: this.layout.screen.width - 6 - LEGEND_BUTTON_SIZE,
          y: 6,
          width: LEGEND_BUTTON_SIZE,
          height: LEGEND_BUTTON_SIZE,
        }
      : this.layout.legendButton;
    const key = `${rect.x},${rect.y},${rect.width}`;
    if (key === this.effectsButtonAt) return;
    this.effectsButtonAt = key;
    this.effectsButton.place(rect);
  }

  /** The legend button, over whatever board is on screen, unless something is over it. */
  private showEffectsButton(): void {
    this.effectsButton.visible =
      !this.menu.isOpen &&
      !this.effectsPanel.isOpen &&
      !this.damageChart.isOpen &&
      this.openAbility === null;
    if (!this.effectsButton.visible) return;
    this.placeEffectsButton();
    this.effectsButton.render(
      this.statusLog.latest(this.statusClock),
      this.statusLog.hasUnread,
      this.statusClock,
    );
  }

  private setMenu(open: boolean): void {
    this.menu.setOpen(open);
    // The button is behind the scrim anyway; hiding it says the menu is the
    // thing that is open.
    this.menuButton.visible = !open;
  }

  /**
   * Any tap anywhere on the screen (app.ts): what puts the wave-cleared card
   * away. Heard before the tap reaches whatever it was aimed at, which it
   * still does.
   */
  screenTapped(): void {
    this.waveCleared.dismiss();
  }

  /** A short line of text over the board: what app.ts says when M mutes. */
  notify(text: string): void {
    this.toast.showText(text);
  }

  // ------------------------------------------------------- getting to a match

  /** Exactly one of the front screens is up at a time; the match is behind. */
  private showScreen(screen: Screen): void {
    this.screen = screen;
    this.home.visible = screen === 'home';
    this.builderSelect.visible = screen === 'builder';
    // The Collection may have unlocked a builder since the picker was last up.
    if (screen === 'builder') this.builderSelect.refresh();
    this.showdownSetup.visible = screen === 'showdownSetup';
    this.tutorialScreen.visible = screen === 'tutorial';
    if (screen === 'home') {
      this.refreshHome();
      this.showFounderNews();
    }
    if (screen === 'tutorial') {
      this.tutorialScreen.setDone(this.services.preferences.settings.tutorialDone);
    }
    if (screen !== 'lobby') this.lobbyScreen.reset();
  }

  /** What the home screen says about the player's progress. */
  private homeProfile(): HomeProfile {
    const progress = this.services.progress;
    const badges = progress.worn('badge').flatMap((c) => (c.glyph ? [c.glyph] : []));
    const title = progress.worn('title')[0];
    return {
      name: this.services.name(),
      level: progress.level,
      title: title ? progress.nameOf(title) : null,
      badges,
      founderNumber: progress.profile.founderNumber,
      boostWaves: progress.boost().wavesLeft,
      boostAlways: progress.boost().alwaysOn,
      supporter: progress.supporter,
      founder: progress.profile.founder,
      supporterBonus: supporterBonus(progress),
      collection: this.collectionCount(),
    };
  }

  /**
   * The Collection's count for its button: builders and cosmetics unlocked, of
   * how many, the keys there are, and whether they would unlock anything now.
   */
  private collectionCount(): HomeProfile['collection'] {
    const progress = this.services.progress;
    const builders = this.data.units.builders;
    const cosmetics = progress.cosmetics.cosmetics;
    const keys = progress.keys.left;
    const builderWaiting = builders.some(
      (b) => !progress.ownsBuilder(b.id) && progress.builderCost(b.id) <= keys,
    );
    const cosmeticWaiting = cosmetics.some(
      (c) =>
        !progress.isUnlocked(c) &&
        forSale(progress.cosmetics, c) &&
        (c.unlock.keys ?? Infinity) <= keys,
    );
    return {
      unlocked:
        builders.filter((b) => progress.ownsBuilder(b.id)).length +
        cosmetics.filter((c) => progress.isUnlocked(c)).length,
      total: builders.length + cosmetics.length,
      keys,
      canSpend: keys > 0 && (builderWaiting || cosmeticWaiting),
    };
  }

  private refreshHome(): void {
    const done = this.services.preferences.settings.tutorialDone;
    this.home.setState(
      this.homeProfile(),
      this.services.online,
      {
        done: CHAPTERS.filter((c) => done.includes(c.id)).length,
        total: CHAPTERS.length,
      },
      this.services.preferences.settings.soloBest,
    );
  }

  private async editName(): Promise<void> {
    await this.services.editName();
    if (this.screen === 'home') this.refreshHome();
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
    // The Final Showdown skips the roster picker: every seat picks its own
    // builder on the setup screen, including the one being watched.
    if (mode.kind === 'showdown') {
      this.showdownSetup.reset();
      this.showScreen('showdownSetup');
      return;
    }
    // Each chapter plays a roster of its own choosing, so there is no picker.
    if (mode.kind === 'tutorial') {
      this.showScreen('tutorial');
      return;
    }
    this.showScreen('builder');
  }

  /**
   * §3.3, replaced: straight into the arena with armies set up by hand.
   *
   * Seat 0 is the one whose lane the camera is on and whose units the panel
   * reports, so the first card on the setup screen is "yours" in the only sense
   * that means anything here - there is nothing to build and nothing to spend.
   */
  private startShowdown(seats: SeatSetup[]): void {
    this.mode = { kind: 'showdown' };
    this.beginMatch(this.services.createShowdown(seats));
    this.showScreen('match');
  }

  /** Take `transport` as the match, with nothing left over from the last one. */
  private beginMatch(transport: Transport): void {
    this.transport?.dispose();
    this.transport = transport;
    this.view = transport.view();
    this.watchingTeamId = null;
    this.selection = null;
    this.pendingUnitDefId = null;
    this.closeAbility();
    this.summarisedWave = -1;
    this.summarisedBuilder = '';
    this.entities.reset();
    this.effectsLayer.reset();
    this.upgradeBursts.reset();
    this.matchCues.reset();
    this.waveCleared.reset();
    this.statusLog.reset();
    this.gameOver.reset();
    this.victoryShow.stop();
    this.celebrated = false;
    this.keepState = null;
    this.savedBuildsNoted = false;
    this.buildBar.reset();
    this.leaveShowdown();
    this.lesson = null;
    this.practice = null;
    this.awarded = false;
    this.xpReport.close();
    // Everything, less the counter hints in a match against other people.
    this.applyFeatures(featuresFor(this.mode));
    this.soloResult = null;
    this.coach.hide();
    this.chapterComplete.hide();
  }

  /** Show only these parts of the interface (features.ts). */
  private applyFeatures(features: Features): void {
    this.buildBar.setFeatures(features);
    this.hud.setGems(features.gems);
  }

  // ------------------------------------------------------------ the tutorial

  /**
   * Play lesson `index` (tutorial/lessons.ts) in a match of its own. Every
   * lesson starts fresh - its own roster, its own board - which is what lets
   * any one of them be played on its own as a refresher.
   */
  private startLesson(index: number): void {
    const lesson = LESSONS[index];
    if (!lesson) return;
    if (lesson.kind === 'practice') {
      this.startPractice(index, lesson.practice);
      return;
    }
    const chapter = lesson.chapter;
    this.mode = { kind: 'tutorial' };
    const { transport, scene } = this.services.createTutorial(chapter);
    this.beginMatch(transport);
    this.applyFeatures(chapter.features);
    // A step that shows a reference card opens it as it begins; closing it is
    // the player's, and is what moves the step on.
    const runner = new TutorialRunner(chapter, scene, (step) => {
      if (step.opens === 'damageChart') this.damageChart.open();
    });
    this.lesson = { index, runner, recorded: false };
    runner.begin();
    // The setup has built a line and filled the wallet; show that, not the
    // empty board the match was made with.
    this.view = transport.view() ?? this.view;
    this.showScreen('match');
  }

  /**
   * A practice match, held behind its opening card until the player taps
   * Play: the card says what is new, and the first build phase should not
   * tick away while they read it.
   */
  private startPractice(index: number, practice: Practice): void {
    this.mode = { kind: 'tutorial' };
    this.beginMatch(this.services.createPractice(practice));
    this.applyFeatures(practice.features);
    this.practice = { index, def: practice, intro: true, recorded: false };
    // The setup has filled the purse or tightened the cap; show that.
    this.view = this.transport?.view() ?? this.view;
    this.showScreen('match');
  }

  /** The practice's opening card is read: the match is the player's. */
  private playPractice(): void {
    if (!this.practice) return;
    this.practice.intro = false;
    this.coach.hide();
  }

  /** On to the lesson after this one, or after the last, a real match. */
  private continueLesson(): void {
    const at = this.lesson?.index ?? this.practice?.index ?? -1;
    const next = at + 1;
    if (next < LESSONS.length) {
      this.startLesson(next);
      return;
    }
    this.goHome();
    this.chooseMode({ kind: 'practice' });
  }

  /**
   * Mark a lesson done, once. A chapter is done when its last step is; a
   * practice when its match ends, however it ends - it is reps, not a test.
   */
  private recordLesson(id: string): void {
    const done = this.services.preferences.settings.tutorialDone;
    if (!done.includes(id)) this.services.preferences.configure({ tutorialDone: [...done, id] });
  }

  /** Out of the chapter, back to the list. */
  private leaveLesson(): void {
    this.goHome();
    this.showScreen('tutorial');
  }

  /** What a step can see of the interface (tutorial/types.ts). */
  private probe(): UiProbe {
    return {
      view: this.buildBar.showing,
      selection: this.selection,
      abilityOpen: this.openAbility !== null,
      effectsOpen: this.effectsPanel.isOpen,
      chartOpen: this.damageChart.isOpen,
      watching: this.watchingTeamId,
    };
  }

  /** Where a tutorial target is on screen now, or null if it is not showing. */
  private locate(target: Target): Rect | null {
    const l = this.layout;
    switch (target.kind) {
      case 'spawnZone':
        return l.spawn;
      case 'wavePreview':
        return {
          x: l.lane.x,
          y: l.spawn.y,
          width: l.lane.width,
          height: Math.min(l.spawn.height, 58),
        };
      case 'buildGrid':
        return l.build;
      case 'gridRow': {
        const at = tileToScreen(l, 0, target.row);
        return { x: at.x, y: at.y, width: l.grid.width * l.tileSize, height: l.tileSize };
      }
      case 'fortress':
        return l.fortress;
      case 'lane':
        return l.lane;
      case 'unit': {
        const unit = this.watchingTeamId === null ? this.view?.lane?.units[target.index] : null;
        if (!unit) return null;
        const at = tileToScreen(l, unit.x, unit.y);
        const r = Math.max(14, unit.radius * l.tileSize + 4);
        return { x: at.x - r, y: at.y - r, width: r * 2, height: r * 2 };
      }
      case 'monsterWith': {
        const monster = this.shownLane()?.monsters.find((m) =>
          hasMark(m.statusMarks ?? 0, target.mark),
        );
        if (!monster) return null;
        const at = tileToScreen(l, monster.x, monster.y);
        const r = Math.max(16, monster.radius * l.tileSize + 8);
        return { x: at.x - r, y: at.y - r, width: r * 2, height: r * 2 };
      }
      case 'hudPhase':
        return this.hud.locate('phase');
      case 'hudWallet':
        return this.hud.locate('wallet');
      case 'hudSupply':
        return this.hud.locate('supply');
      case 'hudIncome':
        return this.hud.locate('income');
      case 'hudIncoming':
        return this.hud.locate('incoming');
      case 'hudNotice':
        return this.hud.locate('notice');
      case 'opponentTabs':
        return this.tabs.locate();
      case 'opponentTab':
        return this.tabs.locate(target.index);
      case 'watchBack':
        return this.banner.backRect();
      case 'menuButton':
        return l.menuButton;
      case 'legendButton':
        return l.legendButton;
      default:
        return this.buildBar.locate(target);
    }
  }

  /**
   * Once a frame while a chapter is running: move the lesson on, then draw
   * the coach over whatever the frame drew. `matchDelta` is the match time
   * that passed, which is none while the coach holds it.
   */
  private runLesson(view: MatchView, matchDelta: number): MatchView {
    const lesson = this.lesson;
    if (!lesson) return view;
    lesson.runner.update(view, this.probe(), matchDelta / 1000);
    // A step that has just begun may have set the scene - started the wave,
    // sent something at you - and the frame should draw what it set.
    this.view = this.transport?.view() ?? this.view;
    if (lesson.runner.complete && !lesson.recorded) {
      lesson.recorded = true;
      this.recordLesson(lesson.runner.chapter.id);
      // The wave card, if it is still up, is yesterday's news next to this.
      this.waveCleared.reset();
      const chapter = lesson.runner.chapter;
      this.chapterComplete.show(CHAPTERS.indexOf(chapter) + 1, chapter.title);
      this.services.sound.play('match.victory');
    }
    return this.view ?? view;
  }

  /** Once a frame during a practice match: note when it is over. */
  private runPractice(view: MatchView): void {
    const practice = this.practice;
    if (!practice || practice.recorded || !(view.eliminated || view.finished)) return;
    practice.recorded = true;
    this.recordLesson(practice.def.id);
  }

  /** What the game-over card offers after a practice: the lesson after it. */
  private practiceEnding(): { next: string | null } | null {
    if (!this.practice) return null;
    const next = LESSONS[this.practice.index + 1];
    return { next: next ? lessonTitle(next) : null };
  }

  private drawCoach(view: MatchView, deltaMs: number): void {
    const practice = this.practice;
    if (practice?.intro) {
      const target = practice.def.target ? this.locate(practice.def.target) : null;
      this.coach.render(
        {
          card: {
            kind: 'intro',
            heading: `Practice match · ${practice.def.title}`,
            text: practiceIntro(this.data, practice.def),
            startLabel: 'Play ▶',
          },
          target,
          hidden: this.menu.isOpen || this.effectsPanel.isOpen || this.damageChart.isOpen,
        },
        deltaMs,
      );
      return;
    }
    const lesson = this.lesson;
    if (!lesson) return;
    const runner = lesson.runner;
    const heading = `Chapter ${CHAPTERS.indexOf(runner.chapter) + 1} · ${runner.chapter.title}`;
    const next = LESSONS[lesson.index + 1];
    const card: CoachCard = runner.complete
      ? {
          kind: 'complete',
          heading,
          text: next
            ? `Chapter done! ${upNext(next)}`
            : "That's the whole tutorial. You are ready for a real match.",
          continueLabel: !next
            ? 'Play practice'
            : next.kind === 'practice'
              ? 'Practice match'
              : 'Next chapter',
        }
      : {
          kind: 'step',
          heading,
          step: runner.stepIndex + 1,
          steps: runner.stepCount,
          text: runner.text(view),
          mode: runner.mode,
          nextLabel: runner.nextLabel,
          canGoBack: runner.canGoBack,
          // What the card says where Next would be, when there is no Next.
          hint: runner.waiting
            ? "Next appears when it's done"
            : runner.mode === 'tap'
              ? 'Tap the highlighted spot'
              : '',
        };
    const target = runner.complete ? null : runner.target(view, this.probe());
    this.coach.render(
      {
        card,
        target: target ? this.locate(target) : null,
        hidden:
          this.menu.isOpen ||
          this.effectsPanel.isOpen ||
          this.damageChart.isOpen ||
          runner.step?.silent === true,
      },
      deltaMs,
    );
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
    this.beforeGame(() => this.start(builderId));
  }

  /**
   * Before a game that can earn XP, the boost is offered whenever fewer than
   * `adBoost.offerBelow` boosted waves are left (award.ts) - as often as that
   * is, with no daily limit, so boosts stack. Opt in every time: No goes
   * straight to the game; Yes plays the ad, and once it has been watched says
   * what it earned before going on. Asked here, before `start`, because a
   * practice match is running from the moment it is made and a room is joined:
   * the ad must not eat into either.
   */
  private beforeGame(play: () => void): void {
    if (this.boostOffer.isOpen) return;
    const status = this.services.progress.boost();
    if (this.xpMode() === null || !status.offer || !this.services.ads.ready()) {
      play();
      return;
    }
    this.afterOffer = play;
    this.boostOffer.ask(status, this.services.progress.config.adBoost);
  }

  /** Yes: the ad, and if it was watched to the end, the boost and the news. */
  private async watchBoostAd(): Promise<void> {
    if (this.watchingAd) return;
    this.watchingAd = true;
    this.boostOffer.setBusy(true);
    const progress = this.services.progress;
    const before = progress.boost().wavesLeft;
    const watched = await this.services.ads.show();
    this.watchingAd = false;
    if (!watched || !progress.startBoost()) {
      this.toast.showText('No boost this time: the ad was not finished');
      this.leaveOffer(true);
      return;
    }
    this.services.sound.play('wave.cleared');
    this.progressChanged();
    const after = progress.boost();
    this.boostOffer.congratulate(after, progress.config.adBoost, after.wavesLeft - before);
  }

  /** Close the boost offer, and start the game it was holding - or not. */
  private leaveOffer(play: boolean): void {
    const next = this.afterOffer;
    this.afterOffer = null;
    this.boostOffer.close();
    if (play) next?.();
  }

  /**
   * Back from the builders: to the lobby they were opened from, to change a
   * roster without giving up the seat; otherwise to the front.
   */
  private leaveBuilders(): void {
    if (this.transport?.hasLobby && !this.transport.matchStarted) {
      this.showScreen('lobby');
      return;
    }
    this.goHome();
  }

  /** Leave whatever is going on and come back to the front. */
  private goHome(): void {
    this.leaveOffer(false);
    this.transport?.dispose();
    this.transport = null;
    this.view = null;
    this.lesson = null;
    this.practice = null;
    this.applyFeatures(EVERYTHING);
    this.coach.hide();
    this.chapterComplete.hide();
    this.closeAbility();
    this.damageChart.close();
    this.gameOver.reset();
    this.xpReport.close();
    this.victoryShow.stop();
    this.celebrated = false;
    this.awarded = false;
    this.entities.reset();
    this.effectsLayer.reset();
    this.upgradeBursts.reset();
    this.matchCues.reset();
    this.waveCleared.reset();
    this.statusLog.reset();
    this.buildBar.reset();
    this.leaveShowdown();
    this.showScreen('home');
  }

  /** Pick a roster, then play it (§7.1). */
  private start(builderId: string): void {
    const transport = this.services.createTransport(this.mode, builderId);
    this.beginMatch(transport);
    // A remote match opens in its lobby, even before the room has answered; a
    // practice match has no lobby and is already running.
    this.showScreen(transport.hasLobby && !transport.matchStarted ? 'lobby' : 'match');
  }

  /**
   * Solo's score against the best on this device, once, as the match ends
   * (§3.3, solo). The tally is the whole of what a solo match leaves behind,
   * so it is kept even if the player leaves without looking at it.
   */
  private recordSolo(view: MatchView): void {
    if (!view.solo || this.soloResult || !(view.eliminated || view.finished)) return;
    const kills = view.solo.kills;
    const best = this.services.preferences.settings.soloBest;
    const newBest = kills > best;
    if (newBest) this.services.preferences.configure({ soloBest: kills });
    this.soloResult = { best: Math.max(best, kills), newBest };
  }

  /** Back to the front: a different roster, or a different room. */
  private chooseAgain(): void {
    this.goHome();
  }

  // ------------------------------------------------------------- progress

  /**
   * What this kind of match earns (award.ts): a normal one online, the same
   * from practice and solo up to a daily cap, and nothing from a tutorial or a
   * showdown set up by hand, which are lessons and experiments rather than
   * matches. `?progress=test` counts practice and solo as normal matches, cap
   * and all, so XP can be tried at length without a server.
   */
  private xpMode(): XpMode | null {
    if (this.lesson || this.practice) return null;
    const test = this.services.progressTest;
    switch (this.mode.kind) {
      case 'quick':
      case 'private':
        return 'online';
      case 'practice':
        return test ? 'online' : 'practice';
      case 'solo':
        return test ? 'online' : 'solo';
      default:
        return null;
    }
  }

  /**
   * Count the match's XP the moment YOUR match ends - out, or the last one
   * standing - once, and show what it came to. Saved before anything is
   * shown, so leaving straight away keeps it. At the top level a match earns
   * nothing (award.ts), and there is no card to say so after every one: the
   * name card says "Top level", and the match that reached it said why.
   */
  private awardXp(view: MatchView): void {
    if (this.awarded || !(view.eliminated || view.finished)) return;
    const mode = this.xpMode();
    if (!mode) return;
    this.awarded = true;

    const reachedShowdown = view.showdown?.armies.some((a) => a.teamId === view.teamId) ?? false;
    // Waves got through: all of them for an army that reached the showdown;
    // for a lane that fell, every wave before the one that broke it.
    const wavesSurvived = reachedShowdown
      ? view.wave
      : view.eliminated
        ? Math.max(0, view.wave - 1)
        : view.wave;
    const progress = this.services.progress;
    const result = progress.award({
      mode,
      placement: view.placement,
      wavesSurvived,
      // The wave it ended in counts as played: what a running boost covers.
      wavesPlayed: Math.max(1, view.wave),
      reachedShowdown,
    });
    // The match may have been the one that reached the Founders' level.
    void this.checkFounder();
    if (result.before.atTop) return;
    this.xpReport.open(
      result,
      progress.config.levels,
      this.boostWords(result.award),
      progress.config.keys.perLevel,
    );
  }

  /** The boost in a line, under the XP bar: how much of it is left. */
  private boostWords(award: XpAward): string {
    const progress = this.services.progress;
    const status = progress.boost();
    if (progress.level.atTop) {
      // Nothing for it to boost until the top goes up; waves wait till then.
      return status.wavesLeft > 0 && !status.alwaysOn
        ? `XP boost: ${waveCount(status.wavesLeft)} kept for later`
        : '';
    }
    if (status.alwaysOn) return 'Supporter: your XP boost is always on';
    if (status.wavesLeft > 0) return `XP boost: ${waveCount(status.wavesLeft)} left`;
    // Used up by this match, or never on: the offer before the next game says the rest.
    return award.boosts.some((line) => line.id === 'adBoost') ? 'XP boost used up' : '';
  }

  /**
   * Become a Supporter. PLACEHOLDER: there is no payment provider yet, so this
   * says so - except in the `?progress=test` build, which grants it on the
   * device.
   */
  private buySupporter(): void {
    if (!this.services.progressTest) {
      this.toast.showText('Purchases open soon. Nothing can be bought yet.');
      return;
    }
    this.services.progress.grantSupporter();
    this.toast.showText('Test purchase: Supporter');
    this.services.sound.play('buy');
    this.progressChanged();
  }

  /**
   * Claim a Founder's place. PLACEHOLDER: counting the first claims needs a
   * server, so only the `?progress=test` build offers it, and grants it here.
   */
  private claimFounder(): void {
    if (!this.services.progressTest) return;
    // Any number at all: the server is what counts a real one.
    const number = 1 + Math.floor(Math.random() * this.services.progress.store.founders.count);
    this.services.progress.grantFounder(number);
    this.toast.showText(`Test claim: Founder #${number}`);
    this.progressChanged();
    this.founderToShow = number;
    this.showFounderNews(true);
  }

  /**
   * A Founder's number, claimed by itself the moment this player's level gets
   * to the Founders' level (store.json, founders): as the game opens, after a
   * match, or at a test level-up. Only with a server to count it, only until
   * the server has said every number is gone, and one claim at a time; no
   * answer is no harm, and it is asked again next time. A number won is shown
   * over the home screen - now, or when the player is next there.
   */
  private async checkFounder(): Promise<void> {
    const founders = this.services.founders;
    const progress = this.services.progress;
    if (!founders || founders.gone || this.claimingFounder || !progress.founderDue) return;
    this.claimingFounder = true;
    const answer = await founders.claim(progress.level.level);
    this.claimingFounder = false;
    if (answer?.result !== 'founder' || progress.profile.founder) return;
    progress.grantFounder(answer.number);
    this.founderToShow = answer.number;
    this.progressChanged();
    this.showFounderNews();
  }

  /** The Founder's card: on the home screen, or anywhere when `now`. */
  private showFounderNews(now = false): void {
    const number = this.founderToShow;
    if (number === null || (!now && this.screen !== 'home') || this.founderNews.isOpen) return;
    this.founderToShow = null;
    const rule = this.services.progress.store.founders;
    this.founderNews.open(number, rule.count, rule.level, supporterBonus(this.services.progress));
    this.services.sound.play('wave.cleared');
  }

  // ------------------------------------------------------------ saved builds

  /**
   * What the player's saved build has done since this device last showed it,
   * shown over the home screen when there is news. Asked once, as the game
   * opens; no server, or no answer, is no news.
   */
  private async checkSavedBuild(): Promise<void> {
    const builds = this.services.savedBuilds;
    if (!builds) return;
    const report = await builds.report();
    if (!report) return;
    this.hasSavedBuild = report.saved !== null;
    const news = builds.news(report);
    // Only over the home screen: news that would land on a match waits for
    // the next time the game opens.
    if (!news || this.screen !== 'home') return;
    this.savedBuildNews.open(news);
    builds.markSeen(report);
  }

  /** The end-of-match card's Save this build: only after a quick match, with a server to keep it. */
  private keepOffer(): KeepOffer | null {
    if (this.mode.kind !== 'quick' || !this.services.savedBuilds) return null;
    return this.keepState ?? (this.hasSavedBuild ? 'replace' : 'offer');
  }

  /** Keep this match's build: it becomes the one other people's quick matches play. */
  private async keepBuild(): Promise<void> {
    const builds = this.services.savedBuilds;
    if (!builds || this.keepState === 'saving') return;
    this.keepState = 'saving';
    const report = await builds.keep();
    this.keepState = report ? 'saved' : 'failed';
    if (!report) return;
    this.hasSavedBuild = true;
    // Its record starts here: nothing it does from now on is old news.
    builds.markSeen(report);
    this.toast.showText("Saved. It will play in other people's quick matches.");
  }

  /** Once a match: say so when saved builds fill some of its seats. */
  private noteSavedBuilds(view: MatchView): void {
    if (this.savedBuildsNoted || view.opponents.length === 0) return;
    this.savedBuildsNoted = true;
    const saved = view.opponents.filter((o) => o.recorded).length;
    if (saved > 0) {
      this.toast.showText(
        `${saved} saved ${saved === 1 ? 'build' : 'builds'} from other players ${saved === 1 ? 'fills' : 'fill'} the empty seats`,
      );
    }
  }

  /** Keys were spent on `name`: heard, and said. */
  private unlocked(name: string): void {
    this.services.sound.play('buy');
    this.toast.showText(`Unlocked ${name}`);
    this.progressChanged();
  }

  /** Something about progress changed: every screen that shows it, redrawn. */
  private progressChanged(): void {
    // A level-up anywhere - a test one included - may be the Founders' level.
    void this.checkFounder();
    if (this.screen === 'home') this.refreshHome();
    if (this.screen === 'builder') this.builderSelect.refresh();
    this.supportScreen.refresh();
    this.collectionScreen.refresh();
  }

  private openSupport(): void {
    this.setMenu(false);
    this.collectionScreen.close();
    this.supportScreen.open();
    // How many Founder stars are left, when there is a server to say.
    void this.services.founders?.status().then((status) => {
      this.supportScreen.setFounderStatus(status);
    });
  }

  private openCollection(): void {
    this.setMenu(false);
    this.supportScreen.close();
    this.collectionScreen.open();
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
    this.upgradeBursts.setLayout(this.layout);
    this.hud.setLayout(this.layout);
    this.tabs.setLayout(this.layout);
    this.banner.setLayout(this.layout);
    this.buildBar.setLayout(this.layout);
    this.abilityCard.setLayout(this.layout);
    this.gameOver.setLayout(this.layout);
    this.xpReport.setLayout(this.layout);
    this.victoryShow.resize(this.layout.screen.width, this.layout.screen.height);
    this.boostOffer.setLayout(this.layout);
    this.savedBuildNews.setLayout(this.layout);
    this.founderNews.setLayout(this.layout);
    this.supportScreen.setLayout(this.layout);
    this.collectionScreen.setLayout(this.layout);
    this.arena.setLayout(this.layout.screen, this.layout.tileSize);
    this.countdown.setLayout(this.layout);
    this.waveCleared.setLayout(this.layout);
    this.chapterComplete.setLayout(this.layout);
    this.builderSelect.setLayout(this.layout);
    this.home.setLayout(this.layout);
    this.lobbyScreen.setLayout(this.layout);
    this.showdownSetup.setLayout(this.layout);
    this.tutorialScreen.setLayout(this.layout);
    this.coach.setLayout(this.layout);
    this.menuButton.setLayout(this.layout);
    this.menu.setLayout(this.layout);
    this.effectsPanel.setLayout(this.layout);
    this.damageChart.setLayout(this.layout);
    this.effectsButtonAt = '';
  }

  /** One animation frame. `deltaMs` is wall time; the simulation never sees it. */
  frame(deltaMs: number): void {
    const transport = this.transport;
    this.groundClock += deltaMs / 1000;

    // A match in this tab stops while the menu is open: nobody else is waiting
    // on it. A room does not, because three other people are.
    const local = transport?.kind === 'local';
    // The effects panel pauses it too: it is for reading, and a marker that
    // wears off while the player is reading about it is no help.
    const reading = this.menu.isOpen || this.effectsPanel.isOpen || this.damageChart.isOpen;
    // And so does the tutorial's coach, whenever it is talking rather than
    // showing a fight: a wave that walks in while the player reads about the
    // build grid is a wave they did not see coming.
    const coached = this.lesson?.runner.holds === true || this.practice?.intro === true;
    const paused = (reading || coached) && local;
    // Shown again below, by whichever board is drawn this frame.
    this.effectsButton.visible = false;
    if (this.menu.isOpen) {
      this.menu.render(
        { inMatch: transport !== null, paused, name: this.services.name() },
        deltaMs,
      );
    }
    // The same match, run faster or slower. Only in this tab: a room runs at
    // the one speed everybody in it shares.
    const speed = local ? this.services.preferences.settings.practiceSpeed : 1;
    // Everything that animates on the match's behalf holds still with it, and
    // runs at its speed: a 2x match should look like one.
    const matchDelta = paused ? 0 : deltaMs * speed;
    // The markers keep flickering while only the coach holds the match: it is
    // stopped so the player can look, and a flame is easier to point out lit.
    this.statusClock += (paused && !reading ? deltaMs : matchDelta) / 1000;
    this.effectsPanel.render(this.statusLog, this.statusClock, deltaMs);
    this.home.update(deltaMs);
    this.founderNews.update(deltaMs);
    this.supportScreen.update(deltaMs);
    this.collectionScreen.update(deltaMs);
    this.xpReport.update(deltaMs);
    this.victoryShow.update(deltaMs);
    this.boostOffer.update(deltaMs);

    if (!transport) {
      // On the home screen or the picker, with no match yet. Nothing to
      // simulate and nothing to draw behind them.
      this.toast.update(deltaMs, this.layout);
      return;
    }

    if (!paused) transport.update(matchDelta);

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
      const outgoingArena = this.arenaLane();
      this.entities.captureTick(outgoing);
      this.arena.captureTick(outgoingArena);
      this.view = transport.view();
      // Blows landed on this tick become effects, for the board on screen
      // only: a fight you cannot see does not need animating.
      const incoming = this.shownLane();
      // A body leaving the board is a death in combat; in the build phase a
      // unit leaving was sold, and in the showdown the armies have walked
      // out to the arena, which draws its own (deaths.ts `DeathRule`).
      const phase = this.view?.phase;
      const deaths: DeathRule =
        phase === 'combat' ? 'all' : phase === 'build' ? 'monsters' : 'none';
      if (incoming) {
        // A lane's shots are all its owner's: its units' and its wall's.
        const trail = looksOf(this.view, incoming.teamId).trail;
        this.effectsLayer.spawn(incoming, outgoing, deaths, () => trail);
      }
      const incomingArena = this.arenaLane();
      if (incomingArena) {
        this.arena.spawnEffects(incomingArena, outgoingArena, this.arenaTrails());
      }
      // What the markers on that board are, for the legend.
      this.statusLog.observe(incomingArena ?? incoming, this.statusClock);
      // The same fight, heard: whichever board is on screen, and only that one.
      if (incomingArena)
        this.hear(
          combatCues(
            incomingArena,
            outgoingArena,
            'all',
            this.defs,
            this.arenaWidths[this.view?.showdown?.layout ?? 'cross'],
          ),
        );
      else if (incoming)
        this.hear(combatCues(incoming, outgoing, deaths, this.defs, this.laneWidth));
    }

    // Effects run on wall time, not on ticks: a 170ms swing at 60fps is ten
    // frames, and at 20Hz it would be three.
    this.effectsLayer.update(matchDelta);
    this.arena.update(matchDelta);
    this.auraLayer.update(matchDelta);

    const rejections = transport.takeRejections();
    for (const rejection of rejections) this.toast.show(rejection);
    if (rejections.length > 0) this.services.sound.play('ui.denied');

    let view = this.view;
    if (!view) {
      // Still connecting. Say so rather than showing an empty lane.
      this.banner.renderStatus(transport.status, transport.detail);
      this.toast.update(deltaMs, this.layout);
      return;
    }

    // Once a frame, whatever changed it: a tick, a tap, or auto-send. A send
    // armed on this frame is heard on the next, which is a frame nobody can
    // tell apart.
    for (const cue of this.matchCues.observe(view)) this.services.sound.play(cue);

    // A connection that drops mid-match leaves a lane on screen that has
    // stopped moving, which looks exactly like the game having crashed. The
    // notice takes the banner over from the watch indicator while that is true.
    const connected = transport.status === 'ready';

    // §3.3, replaced: the showdown takes the whole screen. Everything the lane stack
    // draws - the lane itself, the tabs, the build bar, the HUD - is about a
    // lane, and there is no longer a lane.
    this.setShowdown(view.showdown !== null);
    if (this.inShowdown) {
      this.renderShowdown(view, transport.alpha, deltaMs);
      return;
    }

    // Armed sends fire HERE, before anything draws the wallet. They used to
    // fire from `buildBar.render`, which runs after `hud.render` - so with
    // auto-send on, every gem payout was drawn at its pre-send value for one
    // frame and its post-send value on the next, and the counter flickered.
    // `submit` refreshes the view on the spot in a practice match, so re-read
    // it and let the rest of the frame see the wallet the sends left behind.
    // Not at all while paused: a practice match applies a send the moment it
    // is submitted, so an armed send would still go out with time stopped.
    if (!paused) this.buildBar.tickSends(view, matchDelta);
    view = transport.view() ?? view;

    this.refreshSummary(view);
    this.dropStaleWatch(view);
    this.dropStaleSelection(view);
    view = this.runLesson(view, matchDelta);
    this.runPractice(view);

    const lane = this.shownLane();
    const watching = this.watchingTeamId !== null;
    // A selected monster wears the ring in whatever lane it is standing in; a
    // selected unit only in your own, since that is the only lane it is in.
    const selectedUnitId =
      this.selection?.kind === 'monster'
        ? this.selection.monsterId
        : !watching && this.selection?.kind === 'placedUnit'
          ? this.selection.unitId
          : null;

    this.auraLayer.read(lane);
    if (lane) {
      this.laneLayer.setBattlefield(this.battlefield());
      // The wall on screen in its owner's skin: yours, or the lane you are watching.
      this.laneLayer.setFortressSkin(looksOf(view, lane.teamId).fortress);
      // A chapter step can put a key in the preview strip (tutorial/types.ts).
      const runner = this.lesson?.runner;
      this.laneLayer.setShowcase(
        runner !== undefined && !runner.complete && runner.step?.preview === 'everyType',
      );
      this.laneLayer.animateGround(this.groundClock);
      this.laneLayer.render(view);
      this.auraLayer.render();
      this.entities.render(lane, transport.alpha, {
        selectedId: selectedUnitId,
        statusTime: this.statusTime(),
      });
      this.effectsLayer.render();
    }
    this.upgradeBursts.observe(lane);
    this.upgradeBursts.render(deltaMs);
    this.hud.render(view, this.summary, speed);
    this.tabs.render(view, this.watchingTeamId);
    if (connected) this.banner.render(view, this.watchingTeamId);
    else this.banner.renderStatus(transport.status, transport.detail);
    if (view.lane) {
      this.buildBar.render(
        view,
        view.lane,
        lane ?? view.lane,
        this.selection,
        this.summary,
        matchDelta,
      );
    }
    this.abilityCard.render(this.resolveOpenAbility());
    this.toast.update(deltaMs, this.layout);
    this.waveCleared.observe(view);
    this.waveCleared.render(view, deltaMs);
    this.showEffectsButton();
    this.recordSolo(view);
    this.awardXp(view);
    this.noteSavedBuilds(view);
    this.gameOver.render(view, this.soloResult, this.practiceEnding(), this.keepOffer());
    this.celebrate(view);
    // Last, so it points at where everything was drawn this frame.
    this.drawCoach(view, deltaMs);
    this.chapterComplete.render(deltaMs);
  }

  // ---------------------------------------------------- the Final Showdown

  /**
   * Swap the lane stack for the arena, once, in each direction.
   *
   * The UI is not hidden to make room so much as because none of it means
   * anything any more: there is nothing to build, nothing to send, no fortress
   * to upgrade and no other lane to watch. What the screen gets back is the
   * room the arena needs (§3.3, replaced).
   */
  private setShowdown(on: boolean): void {
    if (this.inShowdown === on) return;
    this.inShowdown = on;

    this.arena.visible = on;
    for (const layer of [
      this.laneLayer,
      this.auraLayer,
      this.entities,
      this.effectsLayer,
      this.upgradeBursts,
      this.hud,
      this.tabs,
      this.banner,
      this.buildBar,
    ]) {
      layer.visible = !on;
    }

    if (on) {
      // Bodies from a lane and bodies in the arena have unrelated positions,
      // so interpolating across the cut would slide every unit across the
      // screen for one tick.
      this.arena.reset();
      this.entities.reset();
      this.effectsLayer.reset();
      this.upgradeBursts.reset();
      this.selection = null;
      this.pendingUnitDefId = null;
      this.watchingTeamId = null;
    }
  }

  /** Put the lane stack back, for a new match after a showdown. */
  private leaveShowdown(): void {
    this.setShowdown(false);
    this.arena.reset();
  }

  private hear(cues: ReturnType<typeof combatCues>): void {
    for (const { cue, pan } of cues)
      this.services.sound.play(cue, pan === undefined ? {} : { pan });
  }

  /** The status markers' clock, or null when the player has turned them off. */
  private statusTime(): number | null {
    return this.services.preferences.settings.statusEffects ? this.statusClock : null;
  }

  /**
   * The ground to paint the board on: the battlefield switched on in the
   * Collection, and the plain ground when none is.
   */
  private battlefield(): BattlefieldId {
    return battlefieldOf(this.services.progress.worn('battlefield')[0]?.id ?? null);
  }

  private arenaLane(): LaneView | null {
    return this.view ? arenaAsLane(this.view) : null;
  }

  /** In the arena, whose shot is whose: each unit's army's player's trail. */
  private arenaTrails(): (attackerId: number) => string | null {
    const view = this.view;
    const byUnit = new Map<number, string | null>();
    for (const army of view?.showdown?.armies ?? []) {
      const trail = looksOf(view, army.teamId).trail;
      for (const unit of army.units) byUnit.set(unit.id, trail);
    }
    return (attackerId) => byUnit.get(attackerId) ?? null;
  }

  private renderShowdown(view: MatchView, alpha: number, deltaMs: number): void {
    const lane = this.arenaLane();
    this.arena.setBattlefield(this.battlefield());
    this.arena.animateGround(this.groundClock);
    if (lane) this.arena.render(view, lane, alpha, this.statusTime());
    // The card is a cut, so it goes over the arena rather than beside it, and
    // the arena is already standing behind it when it lifts (showdown.ts).
    this.countdown.render(view.showdown?.countdown ?? 0);
    this.abilityCard.render(this.resolveOpenAbility());
    this.toast.update(deltaMs, this.layout);
    this.showEffectsButton();
    this.recordSolo(view);
    this.runPractice(view);
    this.awardXp(view);
    this.gameOver.render(view, this.soloResult, this.practiceEnding());
    this.celebrate(view);
  }

  /**
   * The winner's flourish, once, the moment the match is won (looks.ts): on
   * the winner's own screen, and on anyone's still watching - it is theirs to
   * show. A match nobody wins (solo, whose wall always falls) has none.
   */
  private celebrate(view: MatchView): void {
    if (this.celebrated || !view.finished) return;
    this.celebrated = true;
    const winner = winnerOf(view);
    if (winner === null) return;
    const kind = victoryOf(looksOf(view, winner).victory);
    if (kind) this.victoryShow.play(kind, this.layout.screen.width, this.layout.screen.height);
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
    this.upgradeBursts.reset();
    // Nothing selected in a lane you are only looking at.
    this.selection = null;
    this.pendingUnitDefId = null;
  }

  /**
   * A unit type in hand belongs to the build phase, and goes back when it ends.
   *
   * The Build tab greys out when a wave starts (§3.1), and something still in
   * hand behind a greyed tab is a tap on the lane that fires a placement
   * nobody asked for and gets a refusal for it. A SELECTED unit stays: its
   * panel is worth reading mid-fight, and the ring on it is pointing at
   * something real.
   */
  private dropStaleSelection(view: MatchView): void {
    // A monster's panel lasts as long as the monster does. Holding it open on
    // a corpse would leave the tabs unavailable until the player noticed, and
    // there is nothing left to read anyway.
    if (this.selection?.kind === 'monster') {
      const id = this.selection.monsterId;
      const shown = this.shownLane();
      if (!shown?.monsters.some((m) => m.id === id)) this.selection = null;
    }
    if (boardOpenIn(view)) return;
    if (this.selection?.kind === 'unitDef') this.selection = null;
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
    // §3.3, replaced: in the arena there are no lanes to switch between, and an
    // eliminated player is already watching the whole of it.
    if (view.showdown) return;
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
    // §3.3, solo: the endless wave is drawn from every monster there is, so
    // there is no counter to hint at (laneView.ts, `comesNext`).
    if (comesNext(this.data, view) === 'endless') {
      this.summary = null;
      this.summarisedWave = -1;
      return;
    }
    const wave = view.phase === 'build' ? view.wave + 1 : view.wave;
    const builderId = view.lane?.builderId ?? '';
    if (wave === this.summarisedWave && builderId === this.summarisedBuilder) return;
    this.summarisedWave = wave;
    this.summarisedBuilder = builderId;
    // §9.3's hints are "which of YOUR units counter this", so they are a
    // function of the roster as well as the wave.
    this.summary = summariseWave(this.data, view.seed, wave, builderId, view.lateWaves);
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

  /**
   * Open the card for an ability (abilityCard.ts).
   *
   * Stored as an id and a rank rather than a resolved ability, because
   * resolving is the definition index's job and the renderer holding its own
   * copy is how two of them come to disagree (§15.3). Tapping the same chip
   * again closes it, which is what a player expects of a thing they opened.
   */
  private showAbility(abilityId: string, rank: number): void {
    const open = this.openAbility;
    this.openAbility =
      open && open.id === abilityId && open.rank === rank ? null : { id: abilityId, rank };
    if (this.openAbility === null) this.abilityCard.close();
  }

  /** The open card's ability, resolved, or null. */
  private resolveOpenAbility() {
    if (!this.openAbility) return null;
    const def = this.data.abilities.abilities.find((a) => a.id === this.openAbility?.id);
    if (!def) return null;
    return resolveAbility(def, this.openAbility.rank);
  }

  /** A tap on empty space means "cancel", so it drops the memory too. */
  private cancelSelection(): void {
    this.selection = null;
    this.pendingUnitDefId = null;
    this.closeAbility();
  }

  /** Put the card away. Called wherever the body it described goes away. */
  private closeAbility(): void {
    this.openAbility = null;
    this.abilityCard.close();
  }

  /**
   * A tap in the lane, in tile space. Three things it can mean, in order.
   *
   * A BODY first: the nearest unit whose circle, plus a finger's worth of
   * slack (`TOUCH_SLACK_PX`), covers the point - wherever it happens to be
   * standing. That is ahead of the tile reading on purpose: tapping a unit is
   * the only route to upgrading it, so it must not be blocked by having a
   * build type in hand. The type is remembered and Back restores it, which
   * keeps laying a line uninterrupted.
   *
   * Then a TILE: with a unit type in hand, a tap on the build grid places it.
   * The simulation refuses an occupied tile (§15.1), which is the right answer
   * for a tap that landed in an occupied tile but on none of its body.
   *
   * Otherwise EMPTY GROUND, which means cancel.
   */
  private tapLane(tileX: number, tileY: number): void {
    const watching = this.watchingTeamId !== null;
    const shown = this.shownLane();
    if (!shown) return;

    const slack = TOUCH_SLACK_PX / this.layout.tileSize;

    // A MONSTER first, and in any lane including one you are only watching:
    // reading what is walking at somebody costs nobody anything, and it is the
    // only way to find out what a Revenant or a Bloater actually does. Ahead
    // of the unit reading because a monster standing on your line is the body
    // you can no longer see, and the one you are more likely to be asking
    // about.
    const monster = bodyNear(shown.monsters, tileX, tileY, slack);
    if (monster) {
      this.pendingUnitDefId = this.selection?.kind === 'unitDef' ? this.selection.unitDefId : null;
      this.selection = { kind: 'monster', monsterId: monster.id };
      return;
    }

    // Everything else is about YOUR lane. A tap on a lane you are watching is
    // a spectator's tap and does nothing more.
    if (watching) return;

    const lane = this.view?.lane;
    if (!lane) return;

    const body = bodyNear(lane.units, tileX, tileY, slack);
    if (body) {
      this.pendingUnitDefId = this.selection?.kind === 'unitDef' ? this.selection.unitDefId : null;
      this.selection = { kind: 'placedUnit', unitId: body.id };
      return;
    }

    const tile = { x: Math.floor(tileX), y: Math.floor(tileY) };
    if (this.selection?.kind === 'unitDef' && inBounds(this.data.lane.buildZone, tile.x, tile.y)) {
      this.issue({
        kind: 'placeUnit',
        teamId: this.teamId,
        unitDefId: this.selection.unitDefId,
        tileX: tile.x,
        tileY: tile.y,
      });
      return;
    }

    this.cancelSelection();
  }
}

/** A lesson as the tutorial list shows it. */
function lessonEntry(lesson: Lesson): LessonEntry {
  const { summary } = lesson.kind === 'chapter' ? lesson.chapter : lesson.practice;
  return { kind: lesson.kind, id: lessonId(lesson), title: lessonTitle(lesson), summary };
}

/** What the chapter-complete card says comes next. */
function upNext(next: Lesson): string {
  if (next.kind === 'practice') {
    return `Next up, a practice match with what you have learned so far: ${next.practice.title}.`;
  }
  return `Next up: ${next.chapter.title} - ${next.chapter.summary.toLowerCase()}.`;
}

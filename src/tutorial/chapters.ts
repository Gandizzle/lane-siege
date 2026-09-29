/**
 * The tutorial's chapters (types.ts for the shape of one).
 *
 * Each chapter is a lesson that stands on its own - it sets up its own match,
 * so a player can come back to "Gems and sends" without replaying the first
 * wave - and they run in order for a new player, each picking up where the
 * last left off in spirit if not in board state.
 *
 * Every number the coach quotes is read from the data at the moment it is
 * said (`text` as a function), so a price change cannot make the tutorial
 * wrong. What the coach points at is a named target (types.ts), and what ends
 * a step is a condition on the match or the interface, so a step finishes the
 * moment the player has actually done the thing - not when they tap Next
 * after it.
 */

import type { ArmourType, DamageType, GameData } from '../data/schema.ts';
import { buildableUnits } from '../data/roster.ts';
import {
  applyCommand,
  damageMultiplier,
  hasMark,
  summariseWave,
  type MatchView,
} from '../sim/index.ts';
import type { Chapter, Scene, StepContext, Target } from './types.ts';

// ------------------------------------------------------------------ helpers

function unitCost(data: GameData, id: string): number {
  return data.units.units.find((u) => u.id === id)?.goldCost ?? 0;
}

function unitSupply(data: GameData, id: string): number {
  return data.units.units.find((u) => u.id === id)?.supplyCost ?? 0;
}

function unitName(data: GameData, id: string): string {
  return data.units.units.find((u) => u.id === id)?.name ?? id;
}

function ownUnits(view: MatchView) {
  return view.lane?.units ?? [];
}

/**
 * What the first chapter that builds has the player build. Not the cheapest
 * unit but the cheapest that is not marked weak against wave 1 - which is
 * authored, the same in every match - so the card the player is told to tap
 * does not say, right under their thumb, that it is the wrong choice.
 */
const FIRST_UNIT = 'sentinel';

/** The row the chapters build on: two thirds of the way to the fortress. */
const LINE_ROW = 6;

/** Put units on the board as though bought, then set the wallet. */
function buildLine(scene: Scene, defId: string, columns: number[], row = LINE_ROW): void {
  scene.stage((state, ctx) => {
    const lane = state.lanes[scene.teamId];
    if (!lane) return;
    const gold = lane.economy.gold;
    lane.economy.gold = 1_000_000;
    for (const x of columns) {
      applyCommand(ctx, state, {
        kind: 'placeUnit',
        teamId: scene.teamId,
        unitDefId: defId,
        tileX: x,
        tileY: row,
      });
    }
    lane.economy.gold = gold;
  });
}

function setWallet(scene: Scene, wallet: { gold?: number; gems?: number }): void {
  scene.stage((state) => {
    const economy = state.lanes[scene.teamId]?.economy;
    if (!economy) return;
    if (wallet.gold !== undefined) economy.gold = wallet.gold;
    if (wallet.gems !== undefined) economy.gems = wallet.gems;
  });
}

/** End the build phase now: the next tick starts the wave. */
function startWave(scene: Scene): void {
  scene.stage((state) => {
    if (state.phase === 'build') state.phaseTicksLeft = 1;
  });
}

/**
 * Every damage type, best first, by what it would do to the armour of the wave
 * the preview is showing - the wave after this build phase, or the one being
 * fought (game.ts, `refreshSummary`, picks it the same way).
 */
export function rankAgainstWave(
  data: GameData,
  at: { seed: number; wave: number; phase: MatchView['phase'] },
  builderId: string,
): DamageType[] {
  const wave = at.phase === 'build' ? at.wave + 1 : at.wave;
  const { armourMix } = summariseWave(data, at.seed, wave, builderId);
  const score = (type: DamageType) =>
    armourMix.reduce(
      (sum, { armour, count }) =>
        sum + count * damageMultiplier(data.matrix.multipliers, type, armour),
      0,
    );
  return [...data.matrix.damageTypes].sort((a, b) => score(b) - score(a));
}

/** The damage type that does most against the wave on the preview. */
export function bestAgainstWave(data: GameData, view: MatchView): DamageType {
  return rankAgainstWave(data, view, view.lane?.builderId ?? '')[0]!;
}

/** Your own lane has nothing left in it: no monster standing, none still to come. */
function laneClear(view: MatchView): boolean {
  const lane = view.lane;
  return view.phase === 'combat' && !!lane && lane.monsters.length + lane.reserveCount === 0;
}

/** The first wave is over: every lane has beaten it, and the next build phase is on. */
function waveOver(view: MatchView): boolean {
  return view.phase === 'build' && view.wave >= 1;
}

/**
 * The first opponent still fighting, counted the way the tabs show them (by
 * team id, opponentTabs.ts); -1 if none is, or none can be seen.
 */
export function stillFighting(view: MatchView): number {
  const ordered = [...view.opponents].sort((a, b) => a.teamId.localeCompare(b.teamId));
  return ordered.findIndex((o) => {
    const lane = view.watching[o.teamId];
    return !o.eliminated && !!lane && lane.monsters.length + lane.reserveCount > 0;
  });
}

/** The armour most of the wave on the preview wears. */
function mainArmour(data: GameData, view: MatchView): ArmourType | null {
  const wave = view.phase === 'build' ? view.wave + 1 : view.wave;
  const { armourMix } = summariseWave(data, view.seed, wave, view.lane?.builderId ?? '');
  return [...armourMix].sort((a, b) => b.count - a.count)[0]?.armour ?? null;
}

/** Which Fort tab ladders cost gems and which cost gold, by what their first level asks. */
function fortPrices(data: GameData): { gems: string[]; gold: string[] } {
  const f = data.fortress;
  const ladders: [string, { gemCost?: number | null } | undefined][] = [
    ['its weapon', f.weapon.upgrades[0]],
    ['its health', f.hp.upgrades[0]],
    ['regeneration', f.regen.upgrades[0]],
    ['aura power', f.auras.strength.upgrades[0]],
    ['aura radius', f.auras.radius.upgrades[0]],
    ['gem output', f.resourceBuilding.output.upgrades[0]],
    ['gem rate', f.resourceBuilding.rate.upgrades[0]],
    ['supply', data.economy.supply.capUpgrades[0]],
  ];
  const costsGems = (level: { gemCost?: number | null } | undefined) => (level?.gemCost ?? 0) > 0;
  return {
    gems: ladders.filter(([, level]) => costsGems(level)).map(([name]) => name),
    gold: ladders.filter(([, level]) => !costsGems(level)).map(([name]) => name),
  };
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "A, B and C". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * A button on the selected unit's panel - or, if the player has let go of the
 * unit since, the unit itself, so the way back is what the coach points at.
 */
function selectedOr(button: Target): (c: StepContext) => Target {
  return (c) => (c.ui.selection?.kind === 'placedUnit' ? button : { kind: 'unit', index: 1 });
}

// ------------------------------------------------------------------ chapters

const THE_LANE: Chapter = {
  id: 'lane',
  title: 'The lane',
  summary: 'What you defend, and how a round works',
  builderId: 'ironvow',
  steps: [
    {
      mode: 'next',
      text:
        'Welcome to Lane Siege. Monsters attack in waves, trying to break your fortress, and you ' +
        'build defenders to stop them. This chapter is a quick tour of the screen.',
    },
    {
      mode: 'next',
      target: { kind: 'spawnZone' },
      text:
        'Monsters appear up here at the start of each wave. The strip along the top says what the ' +
        'next wave holds: how many of each monster, and what each one looks like.',
    },
    {
      mode: 'next',
      target: { kind: 'buildGrid' },
      text:
        'This grid is where you build. Your units stand on it and fight whatever walks past them ' +
        'on the way down.',
    },
    {
      mode: 'next',
      target: { kind: 'fortress' },
      text:
        'At the bottom is your fortress. Every monster that reaches it hits it, and if its health ' +
        'runs out you are out of the match. It shoots back, but it cannot hold a wave on its own.',
    },
    {
      mode: 'next',
      target: { kind: 'hudPhase' },
      text: (data) =>
        `Each round has two parts. First the build phase: ${data.waves.buildPhaseSeconds} seconds ` +
        'to place and upgrade units. Then combat: the wave walks in, and the round is over once ' +
        'every lane has beaten it.',
    },
    {
      mode: 'next',
      target: { kind: 'hudWallet' },
      text:
        'Your resources. Gold (g) buys units and upgrades. Gems come slowly from your fortress ' +
        'and pay for sends and fortress upgrades. Supply is how big your army can be.',
    },
    {
      mode: 'next',
      target: { kind: 'opponentTabs' },
      text:
        'Three other players defend their own lanes against the same waves. Their tabs show how ' +
        "their fortresses are doing. Whoever's fortress stands longest wins.",
    },
    {
      mode: 'next',
      target: { kind: 'buildBar' },
      text:
        'Everything you spend is down here, in tabs. Build is the one you will use most, and the ' +
        'next chapter is about it.',
    },
  ],
};

const FIRST_LINE: Chapter = {
  id: 'build',
  title: 'Build your first line',
  summary: 'Place units, fight a wave, get paid',
  builderId: 'ironvow',
  steps: [
    {
      mode: 'next',
      text: (data) =>
        `Time to build. You start with ${data.economy.startingGold} gold, and the first wave is ` +
        "coming. Let's spend it.",
    },
    {
      mode: 'tap',
      target: { kind: 'unitCard', defId: FIRST_UNIT },
      text: (data) =>
        `Tap the ${unitName(data, FIRST_UNIT)}: cheap, and it shoots from a few squares back. ` +
        'Each card ' +
        'shows the price in gold and supply, and whether the unit is strong or weak against the ' +
        'coming wave.',
      done: (c) => c.ui.selection?.kind === 'unitDef' && c.ui.selection.unitDefId === FIRST_UNIT,
    },
    {
      mode: 'tap',
      target: { kind: 'gridRow', row: LINE_ROW },
      text:
        'Now tap a square in the highlighted row to put one down. Units fight monsters that come ' +
        'within reach, so build across the path the monsters walk.',
      done: (c) => ownUnits(c.view).length >= 1,
    },
    {
      mode: 'tap',
      target: { kind: 'gridRow', row: LINE_ROW },
      text:
        'Good. Place three more along the same row. The card stays selected, so just keep tapping ' +
        'squares.',
      done: (c) => ownUnits(c.view).length >= 4,
    },
    {
      mode: 'next',
      target: { kind: 'hudWallet' },
      text: (data) =>
        `Each ${unitName(data, FIRST_UNIT)} cost ${unitCost(data, FIRST_UNIT)} gold and ` +
        `${unitSupply(data, FIRST_UNIT)} supply. Gold you do not spend carries over, so there is no ` +
        'need to use it all at once.',
    },
    {
      mode: 'next',
      nextLabel: 'Start the wave',
      text: (data) =>
        `Normally the build phase counts down from ${data.waves.buildPhaseSeconds} seconds. Here ` +
        'the wave waits for you: start it when you are ready.',
    },
    {
      mode: 'free',
      run: true,
      enter: startWave,
      target: { kind: 'lane' },
      text:
        'Here they come. Monsters are drawn as outlines, your units are solid. The bar over each ' +
        'body is its health. (Too slow? The menu, top left, can speed the game up.)',
      done: (c) => laneClear(c.view) || waveOver(c.view),
    },
    {
      // Your lane can be empty long before the wave is over, and without a
      // word here the tutorial just looks stuck.
      mode: 'free',
      run: true,
      target: (c) => {
        const index = stillFighting(c.view);
        return index >= 0 ? { kind: 'opponentTab', index } : { kind: 'opponentTabs' };
      },
      text:
        'Your lane is clear! A wave only ends once EVERY lane has beaten it, so now you wait for ' +
        "the others. Tap a player's tab to watch how their fight is going.",
      done: (c) => waveOver(c.view),
    },
    {
      mode: 'next',
      target: { kind: 'hudWallet' },
      text: (data) =>
        `Wave cleared! Every kill paid gold: a wave is worth ${data.economy.waveBounty} in all, ` +
        'split between its monsters. The ones your fortress has to finish pay you nothing, so a ' +
        'line that holds is a line that earns. Units that fell are back, fully healed.',
    },
    {
      mode: 'next',
      text: (data) =>
        'That is the loop: build, fight, get paid, build again. Waves grow as you go, and every ' +
        `${data.waves.bossEveryNWaves}th wave brings a boss.`,
    },
  ],
};

const UPGRADES: Chapter = {
  id: 'upgrade',
  title: 'Upgrade and sell',
  summary: 'Make units stronger, and undo mistakes',
  builderId: 'ironvow',
  setup: (scene) => {
    buildLine(scene, 'pledge', [2, 3, 4, 5]);
    setWallet(scene, { gold: 400 });
  },
  steps: [
    {
      mode: 'next',
      target: { kind: 'buildGrid' },
      text:
        'Here is a line of four, and some gold to spend. Units can be made stronger where they ' +
        'stand, which is often better than building more.',
    },
    {
      mode: 'tap',
      target: { kind: 'unit', index: 1 },
      text: 'Tap one of your units to select it.',
      done: (c) => c.ui.selection?.kind === 'placedUnit',
    },
    {
      mode: 'next',
      target: { kind: 'barPanel' },
      text:
        'This panel describes the unit: its health, damage and attack speed. An arrow shows what ' +
        'an upgrade would change.',
    },
    {
      mode: 'tap',
      target: { kind: 'abilityChips' },
      text:
        'Every unit has an ability, and it is what makes one unit play differently from the ' +
        'next - these Pledges hit harder side by side. Tap its name to read what it does.',
      done: (c) => c.ui.abilityOpen,
    },
    {
      mode: 'free',
      silent: true,
      text: 'Tap anywhere to close the card.',
      done: (c) => !c.ui.abilityOpen,
    },
    {
      mode: 'tap',
      target: selectedOr({ kind: 'upgrade' }),
      text: (data) =>
        `Now tap Upgrade. It costs ${unitCost(data, 'pledge_2')} gold, and the unit gets much ` +
        'stronger for it: an upgrade usually beats building another one.',
      done: (c) => ownUnits(c.view).some((u) => u.defId === 'pledge_2'),
    },
    {
      mode: 'next',
      target: { kind: 'barPanel' },
      text:
        'It is a Mark II now: see the extra pip under it. Units go up to Mark III, and the top ' +
        'mark unlocks a second ability.',
    },
    {
      mode: 'tap',
      target: selectedOr({ kind: 'sell' }),
      text:
        'Built something in the wrong place? Tap Sell. Selling in the same build phase you bought ' +
        'it gives every coin back, upgrades too. After that, it returns half.',
      done: (c) => ownUnits(c.view).length < 4,
    },
    {
      mode: 'next',
      target: { kind: 'hudWallet' },
      text: (data) =>
        `All of it came back. One more thing: every unit uses supply, and you start with ` +
        `${data.economy.supply.capBase}. When you need more, buy it in the Fort tab.`,
    },
  ],
};

const COUNTERS_BUILDER = 'ironvow';

const COUNTERS: Chapter = {
  id: 'counters',
  title: 'Counters',
  summary: 'Damage types, armour and the right tool',
  builderId: COUNTERS_BUILDER,
  setup: (scene) => {
    setWallet(scene, { gold: 400 });
    // Aimed at the worst choice, so the lesson has something to fix.
    scene.stage((state) => {
      const lane = state.lanes[scene.teamId];
      if (!lane) return;
      lane.fortress.weaponDamageType = rankAgainstWave(scene.data, state, lane.builderId).at(-1)!;
    });
  },
  steps: [
    {
      mode: 'next',
      text:
        'Not every unit is good against every monster. This chapter is about bringing the right ' +
        'tool for the wave.',
    },
    {
      mode: 'next',
      target: { kind: 'wavePreview' },
      text:
        "A monster's SHAPE is its armour. Round shapes are flesh, angular ones are plate, pointed " +
        'ones are warded, and clusters of little ones are a swarm. The preview names each.',
    },
    {
      mode: 'next',
      target: { kind: 'buildBar' },
      text:
        'COLOUR is damage type, on units and monsters alike: amber is impact, blue is pierce, ' +
        'orange is blast, and pink is arcane. Each card says if its damage is strong ▲ or weak ▼ ' +
        'against the wave.',
    },
    {
      mode: 'next',
      nextLabel: 'Show the chart',
      text:
        'So which damage beats which armour? Each type lands harder on some armour and softer on ' +
        'others, and one chart has all of it.',
    },
    {
      mode: 'free',
      silent: true,
      opens: 'damageChart',
      text: 'Close the chart when you are done.',
      done: (c) => !c.ui.chartOpen,
    },
    {
      mode: 'next',
      target: { kind: 'menuButton' },
      text:
        'That chart is always in the menu, under "Damage vs armour", whenever you need a ' +
        'reminder mid-match.',
    },
    {
      mode: 'next',
      target: { kind: 'hudIncoming' },
      text:
        'Monsters hit back with a damage type of their own, shown here, and the chart works both ' +
        'ways: your units have armour too, and it decides how hard those hits land.',
    },
    {
      mode: 'tap',
      target: { kind: 'tab', tab: 'aura' },
      text:
        'Your fortress weapon has a damage type as well, and changing it is free. Open the Aura ' +
        'tab.',
      done: (c) => c.ui.view === 'aura',
    },
    {
      mode: 'tap',
      target: (c) => ({ kind: 'weapon', damageType: bestAgainstWave(c.data, c.view) }),
      text: (data, view) => {
        const best = bestAgainstWave(data, view);
        const main = mainArmour(data, view);
        const hits = main
          ? `This wave is mostly ${main}, and ${best} hits ${main} for ` +
            `×${Number(damageMultiplier(data.matrix.multipliers, best, main).toFixed(2))}. `
          : '';
        return (
          `${hits}Tap ${best} to switch the fortress weapon over. (The row under it holds the ` +
          "fortress's auras, a boost for units standing near it.)"
        );
      },
      done: (c) => c.view.lane?.fortress.weaponDamageType === bestAgainstWave(c.data, c.view),
    },
    {
      mode: 'tap',
      target: { kind: 'tab', tab: 'tech' },
      text:
        'Tech is for the long run: it makes every unit of one damage type hit harder, whatever ' +
        'the wave, for the rest of the match. Open the Tech tab.',
      done: (c) => c.ui.view === 'tech',
    },
    {
      mode: 'tap',
      target: { kind: 'tech', trackId: 'dmg_impact' },
      text: (data) => {
        const track = data.economy.tech.tracks.find((t) => t.id === 'dmg_impact');
        const first = track?.levels[0];
        const impact = buildableUnits(data, COUNTERS_BUILDER)
          .filter((u) => u.damageType === 'impact')
          .map((u) => u.name);
        return (
          `${listed(impact)} all deal impact damage. Buy Impact: ${first?.goldCost ?? 0} gold ` +
          `for +${Math.round((first?.value ?? 0) * 100)}% damage on every one you own, now and ` +
          'later.'
        );
      },
      done: (c) => (c.view.lane?.economy?.tech['dmg_impact'] ?? 0) >= 1,
    },
    {
      mode: 'next',
      text:
        'So: read the wave, build what counters it, aim the fortress at it, and put tech into the ' +
        'damage your army leans on.',
    },
  ],
};

const SENDS: Chapter = {
  id: 'sends',
  title: 'Gems and sends',
  summary: 'Attack the other lanes, and earn from it',
  builderId: 'ironvow',
  setup: (scene) => {
    buildLine(scene, 'pledge', [2, 3, 4, 5]);
    setWallet(scene, { gold: 200, gems: 60 });
  },
  steps: [
    {
      mode: 'next',
      target: { kind: 'hudWallet' },
      text: (data) =>
        'Gems are the second currency. Your fortress makes ' +
        `${data.fortress.resourceBuilding.gemsPerPayout} every ` +
        `${data.fortress.resourceBuilding.payoutSeconds} seconds, all match long. You have a few ` +
        'saved up.',
    },
    {
      mode: 'tap',
      target: { kind: 'tab', tab: 'fort' },
      text: 'Open the Fort tab.',
      done: (c) => c.ui.view === 'fort',
    },
    {
      mode: 'next',
      target: { kind: 'barPanel' },
      text: (data) => {
        const { gems, gold } = fortPrices(data);
        return (
          `The Fort tab improves the fortress itself. ${capitalised(listed(gems))} cost gems; ` +
          `${listed(gold)} cost gold.`
        );
      },
    },
    {
      mode: 'tap',
      target: { kind: 'tab', tab: 'send' },
      text: "Gems also buy SENDS: monsters you add to an opponent's next wave. Open the Send tab.",
      done: (c) => c.ui.view === 'send',
    },
    {
      mode: 'next',
      target: { kind: 'sendTargets' },
      text:
        'First, who to send at. It starts on whoever is doing best; tap another name to change ' +
        'it.',
    },
    {
      mode: 'tap',
      target: { kind: 'send', sendId: 'swarmling' },
      text: (data) => {
        const send = data.sends.sends.find((s) => s.id === 'swarmling');
        return (
          `Tap Swarmling to send one, for ${send?.gemCost ?? 0} gems. It joins that player's ` +
          `next wave, and it pays YOU: +${send?.incomeGranted ?? 0} gold at the end of every ` +
          'wave, for the rest of the match.'
        );
      },
      done: (c) => (c.view.lane?.economy?.passiveIncome ?? 0) > 0,
    },
    {
      mode: 'next',
      target: { kind: 'hudIncome' },
      text: (data) => {
        const economic = data.sends.sends.filter((send) => send.economic);
        const rate = Math.min(
          ...economic.map((send) => (send.gemCost ?? 0) / Math.max(1, send.incomeGranted ?? 0)),
        );
        return (
          `There is your income. ${listed(economic.map((send) => `${send.name}s`))} pay the ` +
          `best rate: +1 gold a wave for every ${rate} gems. The others pay less, but they are ` +
          'far harder to stop.'
        );
      },
    },
    {
      mode: 'next',
      target: { kind: 'send', sendId: 'swarmling' },
      text:
        'The shade sweeping across the card is its cooldown. Press and hold a card for a second to ' +
        'auto-send it whenever it is ready; hold again to stop.',
    },
    {
      mode: 'next',
      target: { kind: 'hudNotice' },
      enter: (scene) =>
        scene.stage((state, ctx) => {
          // An opponent sends at you, so the warning has something to say.
          const from = Object.keys(state.lanes).find((id) => id !== scene.teamId);
          const lane = from ? state.lanes[from] : undefined;
          if (!from || !lane) return;
          lane.economy.gems += 100;
          applyCommand(ctx, state, {
            kind: 'send',
            teamId: from,
            targetTeamId: scene.teamId,
            sendId: 'grub',
          });
        }),
      text:
        'The other players send at you too. When they do, a warning shows up here, and what they ' +
        'sent joins your next wave.',
    },
  ],
};

const THE_BATTLE: Chapter = {
  id: 'battle',
  title: 'Reading the battle',
  summary: 'Effects, other lanes, and winning',
  builderId: 'pyre',
  setup: (scene) => {
    buildLine(scene, 'ember', [1, 2, 3, 4, 5, 6]);
    setWallet(scene, { gold: 100 });
  },
  steps: [
    {
      mode: 'next',
      nextLabel: 'Start the wave',
      text:
        "Last chapter: reading a fight, and how a match ends. This line is Pyre's Embers, which " +
        'set whatever they hit on fire.',
    },
    {
      mode: 'free',
      run: true,
      enter: startWave,
      target: { kind: 'lane' },
      text: 'Watch the monsters as they reach the Embers.',
      done: (c) =>
        (c.view.lane?.monsters ?? []).some((m) => hasMark(m.statusMarks ?? 0, 'burning')),
    },
    {
      mode: 'next',
      target: { kind: 'monsterWith', mark: 'burning' },
      text:
        'See the little flames? That monster is BURNING. Every buff and debuff in the game has a ' +
        'marker like this, on your units and on monsters alike.',
    },
    {
      mode: 'tap',
      target: { kind: 'legendButton' },
      text: 'This button lists every marker on the board and what it means. Tap it.',
      done: (c) => c.ui.effectsOpen,
    },
    {
      mode: 'free',
      text:
        'Tap any effect to read what it does and what causes it. Close the panel when you are ' +
        'done. The full guide is in the menu too.',
      done: (c) => !c.ui.effectsOpen,
    },
    {
      mode: 'tap',
      target: { kind: 'opponentTab', index: 0 },
      text:
        "During a fight you can watch the other lanes. Tap an opponent's tab to see how they are " +
        'doing.',
      done: (c) => c.ui.watching !== null,
    },
    {
      mode: 'tap',
      target: { kind: 'watchBack' },
      text:
        'This is their lane, live. You cannot build here, but you can see what they have. Tap ' +
        '"Back to my lane" to return.',
      done: (c) => c.ui.watching === null,
    },
    {
      mode: 'next',
      target: { kind: 'menuButton' },
      text:
        'The menu has sound, the game speed for practice matches, the effects guide, and the way ' +
        'out of a match.',
    },
    {
      mode: 'next',
      text: (data) =>
        'If your fortress falls you are out, though you can stay and watch. Survive all ' +
        `${data.waves.showdown.afterWave} waves and every army left marches into one arena for ` +
        'the Final Showdown: the last army standing wins.',
    },
    {
      mode: 'next',
      text:
        'That is everything you need. A practice match puts you against three computer players, ' +
        'at your own pace. Good luck.',
    },
  ],
};

export const CHAPTERS: readonly Chapter[] = [
  THE_LANE,
  FIRST_LINE,
  UPGRADES,
  COUNTERS,
  SENDS,
  THE_BATTLE,
];

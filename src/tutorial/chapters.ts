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

import type { ArmorType, DamageType, GameData } from '../data/schema.ts';
import { buildableUnits } from '../data/roster.ts';
import {
  applyCommand,
  damageMultiplier,
  hasMark,
  summariseWave,
  type MatchView,
} from '../sim/index.ts';
import { EVERYTHING, type Features } from '../render/features.ts';
import type { Chapter, Scene, StepContext, Target } from './types.ts';

// ------------------------------------------------------------- what is open

/**
 * What the interface shows, a stage at a time (render/features.ts). Each
 * chapter plays with what it teaches open, and the practice match after it
 * plays with the same (lessons.ts), so nothing is on screen before it has
 * been explained and nothing explained is missing from the match after.
 */
export const STAGES = {
  /** Building, and nothing else: the Build tab, no upgrades, no gems. */
  building: { tabs: ['build'], upgrades: false, fort: 'supply', gems: false },
  /** And upgrading and selling a unit. */
  upgrading: { tabs: ['build'], upgrades: true, fort: 'supply', gems: false },
  /** And the supply cap, in a Fort tab that has nothing else in it yet. */
  supply: { tabs: ['build', 'fort'], upgrades: true, fort: 'supply', gems: false },
  /** And counters: the weapon and auras, tech, and what each unit landed. */
  counters: {
    tabs: ['build', 'tech', 'fort', 'aura', 'damage'],
    upgrades: true,
    fort: 'supply',
    gems: false,
  },
  /** Everything: gems, the fortress ladders and sends. */
  everything: EVERYTHING,
} as const satisfies Record<string, Features>;

// ------------------------------------------------------------------ helpers

function unitCost(data: GameData, id: string): number {
  return data.units.units.find((u) => u.id === id)?.goldCost ?? 0;
}

function unitSupply(data: GameData, id: string): number {
  return data.units.units.find((u) => u.id === id)?.supplyCost ?? 0;
}

export function unitName(data: GameData, id: string): string {
  return data.units.units.find((u) => u.id === id)?.name ?? id;
}

/** The name of a unit's first ability, as its card says it. */
function abilityName(data: GameData, unitId: string): string {
  const ref = data.units.units.find((u) => u.id === unitId)?.abilities?.[0];
  const id = typeof ref === 'string' ? ref : ref?.id;
  return data.abilities.abilities.find((a) => a.id === id)?.name ?? 'its ability';
}

/** 0.5 as "50%". */
function percent(fraction: number | null | undefined): string {
  return `${Math.round((fraction ?? 0) * 100)}%`;
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
 * Every damage type, best first, by what it would do to the armor of the wave
 * the preview is showing - the wave after this build phase, or the one being
 * fought (game.ts, `refreshSummary`, picks it the same way).
 */
export function rankAgainstWave(
  data: GameData,
  at: { seed: number; wave: number; phase: MatchView['phase'] },
  builderId: string,
): DamageType[] {
  const wave = at.phase === 'build' ? at.wave + 1 : at.wave;
  const { armorMix } = summariseWave(data, at.seed, wave, builderId);
  const score = (type: DamageType) =>
    armorMix.reduce(
      (sum, { armor, count }) =>
        sum + count * damageMultiplier(data.matrix.multipliers, type, armor),
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
 * team id, opponentTabs.ts); -1 if none is (`OpponentView.fighting`).
 */
export function stillFighting(view: MatchView): number {
  const ordered = [...view.opponents].sort((a, b) => a.teamId.localeCompare(b.teamId));
  return ordered.findIndex((o) => o.fighting);
}

/** A monster in your lane is on fire. */
function burning(view: MatchView): boolean {
  return (view.lane?.monsters ?? []).some((m) => hasMark(m.statusMarks ?? 0, 'burning'));
}

/**
 * What the wave just fought paid, and where it came from: the kills your line
 * made and the gold they paid, and the ones your fortress had to finish, which
 * paid nothing (sim/types.ts, \`WaveTally\`).
 */
export function waveEarnings(data: GameData, view: MatchView): string {
  const tally = view.lane?.economy?.waveTally;
  const kills = tally?.kills ?? 0;
  const walled = tally?.fortressKills ?? 0;
  const gold = Math.round(tally?.bounty ?? 0);
  const missed = Math.round(tally?.missed ?? 0);
  const monsters = (n: number) => `${n} ${n === 1 ? 'monster' : 'monsters'}`;
  const earned =
    `Wave cleared! Your units killed ${monsters(kills)}, and that earned you ${gold} gold. ` +
    `A wave is worth ${data.economy.waveBounty} gold in all, split between its monsters, and ` +
    'each one your units kill pays you its share.';
  const wall =
    walled > 0
      ? ` ${capitalised(monsters(walled))} got through, and your fortress finished ` +
        `${walled === 1 ? 'it' : 'them'} off: ${walled === 1 ? 'that pays' : 'those pay'} ` +
        `nothing, so they cost you ${missed} gold.`
      : ' Any your fortress has to finish off pays you nothing.';
  return `${earned}${wall} Any of your units that died come back alive for the next wave, fully healed.`;
}

/** The armor most of the wave on the preview wears. */
function mainArmor(data: GameData, view: MatchView): ArmorType | null {
  const wave = view.phase === 'build' ? view.wave + 1 : view.wave;
  const { armorMix } = summariseWave(data, view.seed, wave, view.lane?.builderId ?? '');
  return [...armorMix].sort((a, b) => b.count - a.count)[0]?.armor ?? null;
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
  features: STAGES.building,
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
      target: { kind: 'opponentTabs' },
      text:
        'Three other players defend their own lanes against the same waves. Their tabs show how ' +
        "their fortresses are doing. Whoever's fortress stands longest wins.",
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
        'Your resources. Gold, the coin, buys units. Supply, the figure, is how big your army ' +
        'can be. Prices use the same pictures. (There is a second currency, gems, for later.)',
    },
    {
      mode: 'next',
      target: { kind: 'buildBar' },
      text:
        'Everything you spend is down here. For now there is just the Build tab: the rest open ' +
        'one at a time as you learn them, each with a practice match to try it in. The next ' +
        'chapter is about building.',
    },
  ],
};

const FIRST_LINE: Chapter = {
  id: 'build',
  title: 'Build your first line',
  summary: 'Place units, fight a wave, get paid',
  builderId: 'ironvow',
  features: STAGES.building,
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
        `Tap the ${unitName(data, FIRST_UNIT)}. It's cheap and shoots from a few squares back. ` +
        'Each card shows the price in gold and supply, whether the unit fights up close (melee) ' +
        'or from a distance (ranged), and whether it is strong or weak against the coming wave.',
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
      // Watched, not skipped: the match runs while the player reads, and
      // when the lane is clear it holds for them to finish and tap Next.
      mode: 'watch',
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
      mode: 'watch',
      target: (c) => {
        const index = stillFighting(c.view);
        return index >= 0 ? { kind: 'opponentTab', index } : { kind: 'opponentTabs' };
      },
      text: (_data, view) =>
        waveOver(view)
          ? "Your lane is clear, and so is everyone else's. A wave only ends once EVERY lane " +
            'has beaten it, and this one is over.'
          : 'Your lane is clear! A wave only ends once EVERY lane has beaten it, so now you wait ' +
            "for the others. Tap a player's tab to watch how their fight is going.",
      done: (c) => waveOver(c.view),
    },
    {
      mode: 'next',
      target: { kind: 'hudWallet' },
      text: (data, view) => waveEarnings(data, view),
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
  features: STAGES.upgrading,
  setup: (scene) => {
    buildLine(scene, 'pledge', [2, 3, 4, 5]);
    setWallet(scene, { gold: 400 });
  },
  steps: [
    {
      mode: 'next',
      target: { kind: 'buildGrid' },
      text: (data) =>
        `Here is a line of four ${unitName(data, 'pledge')}s, and some gold to spend. Units can ` +
        'be made stronger where they stand, which is often better than building more.',
    },
    {
      mode: 'tap',
      target: { kind: 'unit', index: 1 },
      text: 'Tap one of your units to select it.',
      done: (c) => c.ui.selection?.kind === 'placedUnit',
    },
    {
      mode: 'next',
      target: { kind: 'stat', key: 'hp' },
      text:
        'This panel describes the unit: its health, damage and attack speed. The number after ' +
        'the arrows shows how the stat will change after the unit is upgraded.',
    },
    {
      mode: 'tap',
      target: { kind: 'abilityChips' },
      text: (data) =>
        `Every unit has an ability. These ${unitName(data, 'pledge')}s have an ability called ` +
        `"${abilityName(data, 'pledge')}". Tap the ability to see what it does.`,
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
      text: 'Upgrading usually beats building another of the same unit.',
      done: (c) => ownUnits(c.view).some((u) => u.defId === 'pledge_2'),
    },
    {
      mode: 'next',
      target: { kind: 'unit', index: 1 },
      text: (data) =>
        `It is a ${unitName(data, 'pledge_2')} now: see the dot under it. One more upgrade ` +
        `makes it an ${unitName(data, 'pledge_3')}, with two dots and a second ability.`,
    },
    {
      mode: 'tap',
      target: selectedOr({ kind: 'sell' }),
      text: (data) =>
        'Built something in the wrong place? Tap Sell. Selling in the same build phase you bought ' +
        `it gives a ${percent(data.economy.sell.sameBuildPhase)} refund, upgrades too. ` +
        `Otherwise, it refunds only ${percent(data.economy.sell.later)}.`,
      done: (c) => ownUnits(c.view).length < 4,
    },
    {
      mode: 'next',
      target: { kind: 'hudWallet' },
      text: 'All of it came back, the upgrade too.',
    },
  ],
};

/** The first rung's unit, the second's... of the roster a chapter plays, by supply. */
function bySupply(data: GameData, builderId: string): { name: string; supply: number }[] {
  const seen = new Set<number>();
  return buildableUnits(data, builderId)
    .map((u) => ({ name: u.name, supply: u.supplyCost ?? 0 }))
    .sort((a, b) => a.supply - b.supply)
    .filter((u) => (seen.has(u.supply) ? false : (seen.add(u.supply), true)));
}

/**
 * Supply, shown rather than told: the figure, what it allows, buying more of
 * it, and then that a bigger unit - and a second upgrade - take more of it.
 */
const SUPPLY: Chapter = {
  id: 'supply',
  title: 'Supply',
  summary: 'How big your army can be, and how to grow it',
  builderId: 'ironvow',
  features: STAGES.supply,
  setup: (scene) => {
    buildLine(scene, 'pledge', [2, 3, 4, 5]);
    setWallet(scene, { gold: 300 });
  },
  steps: [
    {
      mode: 'next',
      target: { kind: 'hudSupply' },
      text: (data, view) => {
        const cap = view.lane?.economy?.supplyCap ?? data.economy.supply.capBase ?? 0;
        const pledge = unitName(data, 'pledge');
        return (
          `This figure is your supply: how big your army can be. You have ${cap} supply, and a ` +
          `${pledge} takes 1, so you could field up to ${cap} ${pledge}s.`
        );
      },
    },
    {
      mode: 'tap',
      target: { kind: 'tab', tab: 'fort' },
      text: 'To field more, raise the cap. Open the Fort tab.',
      done: (c) => c.ui.view === 'fort',
    },
    {
      mode: 'tap',
      target: { kind: 'supplyCap' },
      text: (data) => {
        const first = data.economy.supply.capUpgrades[0];
        const more = (first?.value ?? 0) - (data.economy.supply.capBase ?? 0);
        return `Tap Supply Cap: ${first?.goldCost ?? 0} gold for ${more} more supply.`;
      },
      done: (c) => (c.view.lane?.economy?.supplyCap ?? 0) > (c.data.economy.supply.capBase ?? 0),
    },
    {
      mode: 'next',
      target: { kind: 'hudSupply' },
      text: (data, view) => {
        const cap = view.lane?.economy?.supplyCap ?? 0;
        const more = cap - (data.economy.supply.capBase ?? 0);
        return (
          `${cap} now: room for ${more} more ${unitName(data, 'pledge')}s. You can keep raising ` +
          'it whenever your army fills up.'
        );
      },
    },
    {
      mode: 'tap',
      target: { kind: 'tab', tab: 'build' },
      text: 'Not every unit takes 1 supply. Open the Build tab.',
      done: (c) => c.ui.view === 'build',
    },
    {
      mode: 'next',
      target: (c) => {
        const top = bySupply(c.data, 'ironvow').at(-1);
        const def = buildableUnits(c.data, 'ironvow').find((u) => u.name === top?.name);
        return def ? { kind: 'unitCard', defId: def.id } : { kind: 'barPanel' };
      },
      text: (data, view) => {
        const cap = view.lane?.economy?.supplyCap ?? data.economy.supply.capBase ?? 0;
        const tiers = bySupply(data, 'ironvow');
        const top = tiers.at(-1)!;
        const each = listed(
          tiers.map((u, i) => `a ${u.name} takes ${u.supply}${i === 0 ? ' supply' : ''}`),
        );
        return (
          `The number beside the figure on each card is the supply it takes. ${capitalised(each)}. So ` +
          `${cap} supply holds ${cap} ${tiers[0]!.name}s, but only ${Math.floor(cap / top.supply)} ` +
          `${top.name}s.`
        );
      },
    },
    {
      mode: 'tap',
      // One of the line, upgraded once already, so the second upgrade - the
      // one that takes supply - is the next one on its button.
      enter: (scene) =>
        scene.stage((state, ctx) => {
          const lane = state.lanes[scene.teamId];
          const unit = lane?.units[0];
          if (!lane || !unit) return;
          const gold = lane.economy.gold;
          lane.economy.gold = 1_000_000;
          applyCommand(ctx, state, { kind: 'upgradeUnit', teamId: scene.teamId, unitId: unit.id });
          lane.economy.gold = gold;
        }),
      target: { kind: 'unit', index: 0 },
      text: (data) =>
        `Upgrades can take supply too. This one is a ${unitName(data, 'pledge_2')} already: ` +
        'tap it.',
      done: (c) => c.ui.selection?.kind === 'placedUnit',
    },
    {
      mode: 'next',
      target: selectedOr({ kind: 'upgrade' }),
      text: (data) =>
        `Its next upgrade, to ${unitName(data, 'pledge_3')}, takes ` +
        `${unitSupply(data, 'pledge_3')} more supply: it says so beside the price. A unit's ` +
        'first upgrade never takes supply; its second takes as much again as the unit itself.',
    },
    {
      mode: 'next',
      text:
        'Keep an eye on your supply as you build. When it is full, raise the cap in the Fort ' +
        'tab, or upgrade the units you already have.',
    },
  ],
};

const COUNTERS_BUILDER = 'ironvow';

const COUNTERS: Chapter = {
  id: 'counters',
  title: 'Counters',
  summary: 'Damage types, armor and the right unit',
  builderId: COUNTERS_BUILDER,
  features: STAGES.counters,
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
        'unit for the wave.',
    },
    {
      mode: 'next',
      target: { kind: 'wavePreview' },
      // One monster of every armor, each dealing a different damage type, in
      // place of the real wave - which is one kind only (waves.ts).
      preview: 'everyType',
      text:
        "A monster's SHAPE is its armor. Round shapes are flesh, angular ones are plate, pointed " +
        'ones are warded, and clusters of little ones are a swarm. Up here is one of each.',
    },
    {
      mode: 'next',
      target: { kind: 'wavePreview' },
      preview: 'everyType',
      text:
        'COLOR is damage type, on units and monsters alike: amber is impact, blue is pierce, ' +
        'orange is blast, and pink is arcane. These four deal one each.',
    },
    {
      mode: 'next',
      target: { kind: 'buildBar' },
      text: 'Each unit card says whether its damage is strong ▲ or weak ▼ against the coming wave.',
    },
    {
      mode: 'next',
      nextLabel: 'Show the chart',
      text:
        'So which damage beats which armor? Each type lands harder on some armor and softer on ' +
        'others. One chart summarizes this information.',
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
        'That chart is always in the menu, under "Damage vs armor", whenever you need a ' +
        'reminder mid-match.',
    },
    {
      mode: 'next',
      target: { kind: 'hudIncoming' },
      text:
        'Monsters hit back with a damage type of their own, shown here, and the chart works both ' +
        'ways: your units have armor too, and it decides how hard those hits land.',
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
        const main = mainArmor(data, view);
        const hits = main
          ? `This wave is all ${main}, and ${best} hits ${main} for ` +
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
        'Upgrading a unit makes that one unit stronger. Tech makes a whole KIND of unit stronger ' +
        'at once, and it lasts all match. Open the Tech tab.',
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
          'There is a button for each damage type, and one for each armor type. Buying a damage ' +
          'type makes EVERY unit of that type deal more damage. ' +
          `${listed(impact)} deal impact damage, so buy Impact: ` +
          `${first?.goldCost ?? 0} gold for +${Math.round((first?.value ?? 0) * 100)}% damage on ` +
          'all of them.'
        );
      },
      done: (c) => (c.view.lane?.economy?.tech['dmg_impact'] ?? 0) >= 1,
    },
    {
      mode: 'next',
      target: { kind: 'tech', trackId: 'dmg_impact' },
      text: (data) => {
        const tracks = data.economy.tech.tracks;
        const impact = tracks.find((t) => t.id === 'dmg_impact');
        const pct = (value: number | null | undefined) => Math.round((value ?? 0) * 100);
        const armor = tracks.find((t) => t.armorType !== undefined);
        return (
          `Done. Every impact unit now deals +${pct(impact?.levels[0]?.value)}% damage: the ones ` +
          'on the board, the ones you build later, and the ones that fall and come back. Each ' +
          `level adds ${pct(impact?.levels[0]?.value)}% more, up to ` +
          `+${pct(impact?.levels.at(-1)?.value)}%. The armor buttons do the same for defense: ` +
          `each level makes every unit wearing that armor take ${pct(armor?.levels[0]?.value)}% ` +
          `less damage, up to ${pct(armor?.levels.at(-1)?.value)}% less.`
        );
      },
    },
    {
      mode: 'next',
      target: { kind: 'tab', tab: 'damage' },
      text:
        'One more tab: Damage. After a fight it ranks your units by the damage each one dealt, so ' +
        'you can see which of them were the right choice for that wave.',
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
  features: STAGES.everything,
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
        'Each send has a cooldown. Press and hold a card for a second to auto-send it; hold again ' +
        'to stop.',
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
        'The other players can send monsters at you too. When they do, a warning shows up here. ' +
        'Those monsters are added to the next wave you fight, on top of its usual monsters.',
    },
  ],
};

const THE_BATTLE: Chapter = {
  id: 'battle',
  title: 'Reading the battle',
  summary: 'Effects, other lanes, and winning',
  builderId: 'pyre',
  features: STAGES.everything,
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
        'set their targets on fire.',
    },
    {
      // Watched, not skipped: when the first monster catches, the match holds
      // so the burning one is still there to be pointed at.
      mode: 'watch',
      enter: startWave,
      target: { kind: 'lane' },
      text: (_data, view) =>
        burning(view)
          ? 'There: one of them has caught fire.'
          : 'Watch the monsters as they reach the Embers.',
      done: (c) => burning(c.view),
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
        'If your fortress falls, you are out (though you can stay and watch). Survive all ' +
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
  SUPPLY,
  COUNTERS,
  SENDS,
  THE_BATTLE,
];

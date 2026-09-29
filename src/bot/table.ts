/**
 * A practice table, played headless: three scripted players and a stand-in
 * for the human, to measure how long each kind of bot lasts (npm run bots).
 *
 * The stand-in is a lane that cannot lose and never sends. Whatever is sent at
 * it dies on arrival, so it never holds a wave up; it is there so the bots'
 * sends have the fourth target they would have in a real practice match, and
 * so a table whose three bots have all fallen is simply over rather than won
 * by whoever fell last. Its fortress is shown worn down a little more each
 * wave, the way a middling player's is, so that it is not the healthiest lane
 * - every bot's "leader" - from start to finish.
 *
 * No Node here, so a test can play one; the command line and the processes are
 * src/headless/bots.ts.
 */

import type { GameData } from '../data/schema.ts';
import { createContext, createMatch, step, TICKS_PER_SECOND, type Command } from '../sim/index.ts';
import { AutoBuilder } from './autoBuilder.ts';
import { Rng, hashString, rollSeats, rollStyle, type ArchetypeId, type BotStyle } from './style.ts';

export interface SeatResult {
  teamId: string;
  builderId: string;
  archetype: ArchetypeId;
  style: BotStyle;
  /** The wave it fell in, or null if it was standing when the table ended. */
  fell: number | null;
  /** The last wave it was standing at the end of: 25 is the whole ladder. */
  reached: number;
}

export interface TableOptions {
  /** Seat these archetypes, in order; otherwise they are rolled as a practice match rolls them. */
  archetypes?: readonly ArchetypeId[];
  /** One bot and the stand-in, nothing else: what a style can do left alone. */
  solo?: boolean;
  /** Stop after this wave. */
  waves?: number;
  /** Laid over every rolled style: for asking "what if Wardens stood deep". */
  overrides?: Partial<BotStyle>;
}

const HUMAN = 'human';

/** Play one table from `seed`. */
export function playTable(data: GameData, seed: number, options: TableOptions = {}): SeatResult[] {
  const count = options.solo ? 1 : 3;
  const teamIds = Array.from({ length: count }, (_, i) => `bot${i + 1}`);
  // Rolled exactly as a practice match rolls them, unless told otherwise.
  const rolled = rollSeats(seed, teamIds);
  const styles = teamIds.map((teamId, i) => {
    const wanted = options.archetypes?.[i];
    const style = wanted ? rollStyle(new Rng(seed ^ hashString(teamId)), wanted) : rolled[i]!.style;
    return { ...style, ...options.overrides };
  });
  const builders = data.units.builders.map((b) => b.id);
  // The stand-in takes one builder and the bots the rest, turned by seed so
  // every archetype meets every roster.
  const seats = teamIds.map((teamId, i) => ({
    teamId,
    builderId: builders[(seed + i + 1) % builders.length]!,
    archetype: styles[i]!.archetype,
  }));

  const state = createMatch(data, {
    seed,
    teams: [
      { id: HUMAN, playerIds: ['h'], builderId: builders[seed % builders.length]! },
      ...seats.map((s) => ({ id: s.teamId, playerIds: [s.teamId], builderId: s.builderId })),
    ],
  });
  const ctx = createContext(data);
  const human = state.lanes[HUMAN]!;

  const bots = seats.map((seat, i) => {
    const style = styles[i]!;
    return {
      seat,
      style,
      bot: new AutoBuilder(data, seat.teamId, seat.builderId, { style, seed }),
    };
  });

  const fell = new Map<string, number>();
  const last = options.waves ?? data.waves.showdown.afterWave;
  const guard = TICKS_PER_SECOND * 60 * 60 * 3;
  for (let tick = 0; tick < guard; tick++) {
    if (state.finished || state.phase === 'showdown') break;
    if (state.phase === 'build' && state.wave >= last) break;
    const commands: Command[] = [];
    for (const { bot } of bots) commands.push(...bot.plan(state));
    step(ctx, state, commands);
    for (const monster of human.monsters) if (monster.alive) monster.hp = 0;
    // Worn down like a middling player's, so it is not the healthiest lane -
    // everybody's leader - for the whole match.
    human.fortress.hp = human.fortress.maxHp * Math.max(0.3, 0.98 - 0.02 * state.wave);
    for (const team of state.teams) {
      if (team.eliminated && !fell.has(team.id)) fell.set(team.id, state.wave);
    }
    if (bots.every(({ seat }) => fell.has(seat.teamId))) break;
  }

  // A table that reached the Final Showdown has beaten every wave.
  const cleared =
    state.phase === 'showdown' ? last : state.phase === 'build' ? state.wave : state.wave - 1;
  return bots.map(({ seat, style }) => {
    const wave = fell.get(seat.teamId) ?? null;
    return {
      ...seat,
      style,
      fell: wave,
      reached: wave === null ? cleared : wave - 1,
    };
  });
}

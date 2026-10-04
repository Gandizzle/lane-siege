/**
 * The match a chapter is taught with: a practice match on a fixed seed, so
 * every player sees the same waves and a chapter that says "this wave is
 * mostly plate" is always right.
 *
 * The other three lanes are the practice bots, told not to send (LocalTransport,
 * `quietBots`): a monster arriving in your lane that nobody sent on purpose is
 * one the coach would have to explain.
 */

import type { GameData } from '../data/schema.ts';
import { LocalTransport } from '../net/localTransport.ts';
import type { Chapter, Practice, Scene } from './types.ts';

/** Every tutorial match is this seed. */
export const TUTORIAL_SEED = 1107;

/**
 * Gold each scripted lane gets on top of the usual starting purse.
 *
 * A wave is over only when every lane has beaten it, and the bots spend their
 * whole purse in the one planning pass the tutorial gives them before the
 * first wave. On a wave-one purse the thinnest of them buys a single tank and
 * takes most of a minute to clear it - a minute a new player spends waiting on
 * a lane they have never looked at. With this every bot builds a line, and
 * wave 1 is over about twenty seconds after it starts. Tutorial matches only.
 */
export const BOT_HEAD_START = 150;

const LANE_IDS = ['lane1', 'lane2', 'lane3', 'lane4'] as const;
const OWN_LANE = LANE_IDS[0];

export function tutorialMatch(data: GameData, chapter: Chapter, name: string): LocalTransport {
  const others = data.units.builders.map((b) => b.id).filter((id) => id !== chapter.builderId);
  const teams = LANE_IDS.map((id, index) => ({
    id,
    playerIds: [id === OWN_LANE ? 'you' : 'bot'],
    name: id === OWN_LANE ? name : `Bot ${index + 1}`,
    builderId:
      id === OWN_LANE
        ? chapter.builderId
        : (others[(index - 1) % Math.max(1, others.length)] ?? chapter.builderId),
  }));
  const transport = new LocalTransport(
    data,
    TUTORIAL_SEED,
    teams,
    OWN_LANE,
    LANE_IDS.filter((id) => id !== OWN_LANE),
    { quietBots: true },
  );
  transport.stage((state) => {
    for (const lane of Object.values(state.lanes)) {
      if (lane.teamId !== OWN_LANE) lane.economy.gold += BOT_HEAD_START;
    }
  });
  return transport;
}

/**
 * A practice match between chapters (lessons.ts): a match like the one on the
 * home screen - its own seed, bots that play their rolled styles - with the
 * practice's own setup on top.
 *
 * Until sends have been taught the bots are told not to send, for the same
 * reason as in a chapter: a monster nobody explained, arriving from a tab the
 * player cannot see yet. And no head start, because nobody is waiting on
 * them: this is a match, not a lesson about wave 1.
 */
export function practiceMatch(
  data: GameData,
  practice: Practice,
  name: string,
  seed: number,
): LocalTransport {
  const others = data.units.builders.map((b) => b.id).filter((id) => id !== practice.builderId);
  const teams = LANE_IDS.map((id, index) => ({
    id,
    playerIds: [id === OWN_LANE ? 'you' : 'bot'],
    // Bots that send are named by the style the transport rolls for them, as on
    // the home screen; quiet ones all play one style, so they are numbered.
    name: id === OWN_LANE ? name : practice.botsSend ? '' : `Bot ${index + 1}`,
    builderId:
      id === OWN_LANE
        ? practice.builderId
        : (others[(index - 1) % Math.max(1, others.length)] ?? practice.builderId),
  }));
  const transport = new LocalTransport(
    data,
    seed,
    teams,
    OWN_LANE,
    LANE_IDS.filter((id) => id !== OWN_LANE),
    { quietBots: !practice.botsSend },
  );
  practice.setup?.(sceneOf(data, transport));
  return transport;
}

/** What a chapter can do to its match. */
export function sceneOf(data: GameData, transport: LocalTransport): Scene {
  return {
    data,
    teamId: transport.teamId,
    stage: (arrange) => transport.stage(arrange),
  };
}

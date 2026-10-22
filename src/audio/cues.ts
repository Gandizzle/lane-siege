/**
 * What there is to hear, worked out from what there is to see.
 *
 * The simulation does not know sound exists, and does not need to: every cue
 * is a difference between two views the renderer already has. That keeps the
 * rule the effects layer follows (§15.1) - a client with sound deleted plays
 * the identical game - and it means a sound plays for a remote match, a
 * practice match, auto-send and a button press alike, because all of them
 * arrive as a changed view.
 *
 * Two sources, because they change at different rates:
 *
 *   - `combatCues`: one tick of the fight on the board on screen - every blow
 *     and every death. Called on the tick, beside the effects layer, with the
 *     same pair of views, so a pop and its sound are the same event.
 *   - `MatchCues`: the match and your own lane - phases, the fortress, your
 *     builds, sales, purchases and sends, sends at you, the ending. Diffed
 *     against a small snapshot rather than per tick, because a purchase can
 *     land between ticks (a practice match applies it on the spot) and a
 *     snapshot compared twice finds nothing new the second time.
 *
 * SENDS, IN A LATE GAME
 *
 * A late game is dozens of sends a wave each way, and a sound for each one was
 * one sound on repeat. So each way is thinned to what is worth knowing:
 *
 *   - Out: only a send TAPPED is heard. Auto-send fires the same command, but
 *     the player armed it once and does not need telling every time it goes
 *     (`sentByHand`).
 *   - In: the warning sounds as this wave's count of sends at you passes a
 *     landmark - the first, then 10, 25, 50 and every 50 after
 *     (`sendLandmarkPassed`) - so a trickle is heard once and a flood is
 *     heard growing, without a sound per send.
 */

import { FORTRESS_ID, TICKS_PER_SECOND } from '../sim/index.ts';
import type { DefIndex, EntityView, LaneView, MatchView } from '../sim/index.ts';
import { findDeaths, type DeathRule } from '../render/deaths.ts';
import { attackCue, type CueId } from './catalog.ts';

export interface Cue {
  cue: CueId;
  /** Where across the board, -1 left to 1 right. Absent is dead centre. */
  pan?: number;
}

/**
 * The counts of sends at you in one wave that are worth a warning: the first,
 * these, and every `INCOMING_EVERY` past the last of them.
 */
const INCOMING_LANDMARKS = [1, 10, 25, 50] as const;
const INCOMING_EVERY = 50;

/** Whether going from `was` to `now` sends at you this wave passes a landmark. */
export function sendLandmarkPassed(was: number, now: number): boolean {
  for (let count = was + 1; count <= now; count++) {
    if ((INCOMING_LANDMARKS as readonly number[]).includes(count)) return true;
    if (count > INCOMING_LANDMARKS.at(-1)! && count % INCOMING_EVERY === 0) return true;
  }
  return false;
}

/**
 * How long a tapped send waits to be heard going out, in ticks: a room's round
 * trip, with room to spare. One that has not gone by then was refused.
 */
const BY_HAND_TICKS = 3 * TICKS_PER_SECOND;

/** How far a sound at the edge of the board is panned: wide, but never one ear. */
const PAN_WIDTH = 0.6;

function panAt(x: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(-1, Math.min(1, (x / width) * 2 - 1)) * PAN_WIDTH;
}

/**
 * The blows and deaths in one tick of the board on screen.
 *
 * `width` is the board's width in tiles, for panning. Blows are returned
 * unthinned: at the height of a wave there are dozens a tick, and which of them
 * are heard is the limiter's decision (limiter.ts), not this function's.
 */
export function combatCues(
  incoming: LaneView,
  outgoing: LaneView | null,
  deaths: DeathRule,
  defs: DefIndex,
  width: number,
): Cue[] {
  const cues: Cue[] = [];

  const bodies = new Map<number, EntityView>();
  // A body that died on this tick may still have swung on it.
  for (const body of outgoing?.units ?? []) bodies.set(body.id, body);
  for (const body of outgoing?.monsters ?? []) bodies.set(body.id, body);
  for (const body of incoming.units) bodies.set(body.id, body);
  for (const body of incoming.monsters) bodies.set(body.id, body);

  for (const attack of incoming.attacks) {
    if (attack.attackerId === FORTRESS_ID) {
      cues.push({ cue: attackCue(incoming.fortress.weaponDamageType) });
      continue;
    }
    const attacker = bodies.get(attack.attackerId);
    if (attacker) cues.push({ cue: attackCue(attacker.damageType), pan: panAt(attacker.x, width) });
  }

  const died = findDeaths(incoming, outgoing, deaths);
  for (const monster of died.monsters) {
    const boss = defs.monsters.get(monster.defId)?.isBoss === true;
    cues.push({ cue: boss ? 'death.boss' : 'death.monster', pan: panAt(monster.x, width) });
  }
  for (const unit of died.units) cues.push({ cue: 'death.unit', pan: panAt(unit.x, width) });

  return cues;
}

/** The little of a view that `MatchCues` compares. */
interface Snapshot {
  phase: MatchView['phase'];
  over: boolean;
  countdown: number | null;
  fortressHp: number;
  units: Map<number, string>;
  bought: number;
  weapon: string;
  aura: string | null;
  cooldowns: Record<string, number>;
  /** Sends at you queued for the coming wave: the log empties as the wave lands. */
  sendsAtMe: number;
  /** Your lane has beaten the wave in front of it (ui/waveCleared.ts, `laneIsClear`). */
  clear: boolean;
}

function snapshot(view: MatchView): Snapshot {
  const lane = view.lane;
  const economy = lane?.economy;
  let bought = economy?.supplyCap ?? 0;
  for (const level of Object.values(economy?.tech ?? {})) bought += level;
  for (const level of Object.values(economy?.upgrades ?? {})) bought += level;
  return {
    phase: view.phase,
    over: view.eliminated || view.finished,
    countdown:
      view.showdown === null
        ? null
        : Math.max(0, Math.ceil(view.showdown.countdown / TICKS_PER_SECOND)),
    fortressHp: lane?.fortress.hp ?? 0,
    units: new Map((lane?.units ?? []).map((u) => [u.id, u.defId])),
    bought,
    weapon: lane?.fortress.weaponDamageType ?? '',
    aura: lane?.fortress.activeAura ?? null,
    cooldowns: { ...(economy?.sendCooldowns ?? {}) },
    sendsAtMe: lane?.sendLog.length ?? 0,
    clear:
      view.phase === 'combat' &&
      !view.eliminated &&
      !view.solo?.endless &&
      !!lane &&
      !lane.fortress.destroyed &&
      lane.monsters.length + lane.reserveCount === 0,
  };
}

/** Won, or out: the one sting the game ends on. */
function ending(view: MatchView): CueId {
  if (view.eliminated) return 'match.defeat';
  const won = view.placement === 1 || view.opponents.every((o) => o.eliminated);
  return won ? 'match.victory' : 'match.defeat';
}

/**
 * The match and your own lane, since the last look.
 *
 * The first look after `reset` only takes a snapshot: a match joined halfway
 * through, or the home screen giving way to one, is not a burst of everything
 * that has ever happened in it.
 */
export class MatchCues {
  private last: Snapshot | null = null;
  /** The wave whose clearing has already been heard, so its end is not heard twice. */
  private chimed = -1;
  /** Sends tapped by hand and not yet seen going out, with the tick they were tapped on. */
  private readonly byHand = new Map<string, number>();
  /** The match's tick at the last look, to date a tap with. */
  private tick = 0;

  reset(): void {
    this.last = null;
    this.chimed = -1;
    this.byHand.clear();
  }

  /**
   * A send was tapped: when its cooldown restarts, the launch is heard. One
   * fired by auto-send is never told here, and goes out in silence.
   */
  sentByHand(sendId: string): void {
    this.byHand.set(sendId, this.tick);
  }

  observe(view: MatchView): CueId[] {
    const now = snapshot(view);
    const was = this.last;
    this.last = now;
    this.tick = view.tick;
    // A tap that never went out - refused, or the match moved on - is dropped.
    for (const [sendId, tapped] of this.byHand) {
      if (view.tick - tapped > BY_HAND_TICKS) this.byHand.delete(sendId);
    }
    if (!was) return [];

    const cues = new Set<CueId>();

    if (!was.over && now.over) cues.add(ending(view));

    if (was.phase === 'build' && now.phase === 'combat') cues.add('wave.start');
    // The chime is for YOUR lane going clear, which is the moment the card
    // celebrates (ui/waveCleared.ts) - usually well before the last lane
    // finishes and the wave ends. The wave ending only chimes if that moment
    // was missed: a match joined with the lane already clear.
    if (!was.clear && now.clear) {
      cues.add('wave.cleared');
      this.chimed = view.wave;
    }
    if (was.phase === 'combat' && now.phase === 'build' && !view.eliminated) {
      // A build phase carries the number of the wave it follows.
      if (this.chimed !== view.wave) cues.add('wave.cleared');
    }

    if (now.countdown !== null && was.countdown !== null && now.countdown < was.countdown) {
      cues.add(now.countdown === 0 ? 'showdown.start' : 'showdown.tick');
    }

    // Everything below is about your own lane, which the showdown has emptied.
    if (now.phase === 'showdown' || !view.lane) return [...cues];

    if (now.fortressHp < was.fortressHp) cues.add('fortress.hit');
    if (sendLandmarkPassed(was.sendsAtMe, now.sendsAtMe)) cues.add('send.incoming');

    // A unit that appears as the build phase opens is one that died in the
    // wave respawning (§5.4), under its old id - not one being placed.
    const respawning = was.phase !== now.phase;
    for (const [id, defId] of now.units) {
      const before = was.units.get(id);
      if (before === undefined) {
        if (!respawning) cues.add('build.place');
      } else if (before !== defId) cues.add('build.upgrade');
    }
    // In combat a unit that leaves has died, and combatCues heard it.
    if (now.phase === 'build') {
      for (const id of was.units.keys()) if (!now.units.has(id)) cues.add('build.sell');
    }

    if (now.bought > was.bought) cues.add('buy');
    if (now.weapon !== was.weapon || now.aura !== was.aura) cues.add('ui.switch');

    // A cooldown only ever runs down, so one that went UP was restarted by a
    // send going out. Heard only for a send that was tapped (`sentByHand`).
    for (const [sendId, ticks] of Object.entries(now.cooldowns)) {
      if (ticks > (was.cooldowns[sendId] ?? 0) && this.byHand.delete(sendId)) {
        cues.add('send.launch');
      }
    }

    return [...cues];
  }
}

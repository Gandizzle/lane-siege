/**
 * The seam between the game and where the simulation is running.
 *
 * DESIGN.md §15.1 says the simulation takes state and inputs and returns new
 * state, and that the server runs the identical module. This is the interface
 * that makes "where is it running" a detail the renderer does not know:
 *
 *   - `LocalTransport` runs the simulation in this tab. Single player.
 *   - `RemoteTransport` talks to a Colyseus room that runs it instead (§15.2).
 *
 * Both hand back a `MatchView` (§12), never a `MatchState`. That is deliberate
 * and it is the whole reason this interface is shaped this way: if the renderer
 * could reach the state, fog of war would be a request rather than a rule, and
 * single player would exercise a different code path from multiplayer - which
 * is exactly where a leak would hide.
 *
 * Commands go the other way and are never applied by the caller. Locally they
 * go through `applyCommand`; remotely they are sent to the server, which runs
 * that same function. A refusal comes back the same shape either way, because
 * "you cannot afford that" is a normal answer to tapping a button, not an error.
 */

import type { Command, CommandRejection, MatchView } from '../sim/index.ts';

export type TransportStatus = 'connecting' | 'ready' | 'closed' | 'error';

export interface Transport {
  /** Where the simulation is. Shown to the player; also useful in logs. */
  readonly kind: 'local' | 'remote';

  readonly status: TransportStatus;
  /** Why, when the status is `error` or `closed`. Null otherwise. */
  readonly detail: string | null;

  /**
   * Which team this client is playing, once known. Null while connecting: the
   * server assigns lanes, so a remote client does not know its own until it has
   * joined.
   */
  readonly teamId: string | null;

  /** Advance time by one frame's worth of milliseconds. */
  update(deltaMs: number): void;

  /**
   * The latest view, or null before the first one exists.
   *
   * The same object may be returned repeatedly between ticks. Callers must
   * treat it as read-only.
   */
  view(): MatchView | null;

  /**
   * Fraction of a tick elapsed since the last one, for render interpolation.
   */
  readonly alpha: number;

  /** True on the frame a tick just happened, so the renderer can snapshot. */
  consumeTick(): boolean;

  /** Ask for a command to be applied. */
  submit(command: Command): void;

  /**
   * Refusals that have arrived since the last call, oldest first.
   *
   * Drained rather than pushed, because a remote refusal arrives on the
   * network's schedule and the UI only wants it on the next frame.
   */
  takeRejections(): CommandRejection[];

  dispose(): void;
}

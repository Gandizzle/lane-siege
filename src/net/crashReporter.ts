/**
 * Crash reports, from the player's side: whatever nothing else caught, sent
 * to the game server for the admin page. (docs/ARCHITECTURE.md, "Crash
 * reports"; the server's half is server/crashStore.ts.)
 *
 * What is caught: an error nothing caught (`error`), a promise nobody
 * handled (`unhandledrejection`), and the graphics card taking the canvas
 * away (`webglcontextlost`), which on a phone is the usual way a game goes
 * black. Each report says what went wrong and where, which build it was, on
 * what screen size and browser, what the game was showing, and the last few
 * things that happened before it (`note`). Never a player id or a name: what
 * broke is the question, not who it broke for.
 *
 * The same problem is reported once a session, and no more than
 * `PER_SESSION` problems in all, so a broken frame loop sends one report, not
 * sixty a second. A report that cannot be sent - no server, no signal - waits
 * on the device and goes the next time the game starts.
 *
 * Sent as plain text, which a browser sends to another origin without asking
 * first, and with `keepalive`, so a report made as the page is closing still
 * goes.
 */

import { httpBase } from './ghostApi.ts';
import type { KeyValueStore } from './identity.ts';

/** One report, as the device sends it. */
export interface CrashPayload {
  kind: 'error' | 'rejection' | 'webgl' | 'server';
  message: string;
  stack: string;
  /** Where the browser said it was thrown, when it said. */
  source: string;
  /** The game's version (package.json) and the commit it was built from. */
  version: string;
  build: string;
  /** Which build: `web`, `android`, `test` (the GitHub Pages build) or `dev`. */
  edition: string;
  /** The browser's description of itself. */
  agent: string;
  /** The page's size and pixel density, as `390x844@2`. */
  screen: string;
  /** What the game was showing (`at`). */
  scene: string;
  /** The last few things that happened before it (`note`). */
  trail: string[];
  /** A random id for this start of the game, so one player's run of problems reads as one. */
  session: string;
  /** The device's clock when it happened. */
  at: string;
}

/** Which build this is, for every report it makes. */
export interface BuildInfo {
  version: string;
  build: string;
  edition: string;
}

const QUEUE_KEY = 'lane-siege.crashQueue';
/** Different problems reported in one session, at most. */
const PER_SESSION = 10;
/** Reports kept waiting on the device, at most. */
const QUEUE_LIMIT = 10;
/** Things that happened, kept for the next report. */
const TRAIL_LENGTH = 12;

/** The smallest piece of `window` this needs, so a test can hand it something else. */
export interface CrashTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

export class CrashReporter {
  private readonly seen = new Set<string>();
  private readonly trail: string[] = [];
  private scene = 'starting';
  private readonly session: string;
  private readonly endpoint: string | null;
  private busy = false;

  constructor(
    private readonly info: BuildInfo,
    private readonly storage: KeyValueStore | null,
    /** The game server, or null where there is none: reports then wait on the device. */
    server: string | null,
    private readonly now: () => Date = () => new Date(),
    random: () => number = Math.random,
  ) {
    this.endpoint = server ? `${httpBase(server)}/crashes` : null;
    this.session = Math.floor(random() * 0xffffffff).toString(36);
  }

  /** Listen for whatever nothing else catches. */
  install(target: CrashTarget): void {
    target.addEventListener('error', (event) => {
      const e = event as {
        error?: unknown;
        message?: string;
        filename?: string;
        lineno?: number;
        colno?: number;
      };
      const error = e.error instanceof Error ? e.error : null;
      this.capture(
        'error',
        error?.message || e.message || 'Unknown error',
        error?.stack ?? '',
        e.filename ? `${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0}` : '',
      );
    });
    target.addEventListener('unhandledrejection', (event) => {
      const reason = (event as { reason?: unknown }).reason;
      const error = reason instanceof Error ? reason : null;
      this.capture('rejection', error?.message || String(reason), error?.stack ?? '', '');
    });
  }

  /** The graphics card took the canvas away: on a phone, a black screen. */
  watchCanvas(canvas: CrashTarget): void {
    canvas.addEventListener('webglcontextlost', () => {
      this.capture('webgl', 'The WebGL context was lost', '', '');
    });
  }

  /** What the game is showing now: said in every report, and kept in the trail. */
  at(scene: string): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.note(`screen: ${scene}`);
  }

  /** Something happened worth knowing if the next report comes soon after. */
  note(event: string): void {
    this.trail.push(event.slice(0, 80));
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
  }

  /** Report a problem: once a session for each, and only so many in all. */
  capture(kind: CrashPayload['kind'], message: string, stack: string, source: string): void {
    try {
      const firstLine = stack.split('\n').find((l) => /\.(?:js|ts|mjs)/.test(l)) ?? source;
      const signature = `${kind}|${message}|${firstLine.trim()}`;
      if (this.seen.has(signature) || this.seen.size >= PER_SESSION) return;
      this.seen.add(signature);
      const page = globalThis as {
        innerWidth?: number;
        innerHeight?: number;
        devicePixelRatio?: number;
      };
      const agent =
        (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';
      const report: CrashPayload = {
        kind,
        message: message.slice(0, 300),
        stack: stack.slice(0, 4000),
        source: source.slice(0, 300),
        version: this.info.version,
        build: this.info.build,
        edition: this.info.edition,
        agent: agent.slice(0, 300),
        screen: `${page.innerWidth ?? 0}x${page.innerHeight ?? 0}@${page.devicePixelRatio ?? 1}`,
        scene: this.scene,
        trail: [...this.trail],
        session: this.session,
        at: this.now().toISOString(),
      };
      this.keep([...this.queued(), report]);
      void this.flush();
    } catch {
      // A reporter that throws while reporting would report itself for ever.
    }
  }

  /** Send whatever is waiting, oldest first. Done once at start, and after every new report. */
  async flush(): Promise<void> {
    if (!this.endpoint || this.busy) return;
    this.busy = true;
    try {
      // Read afresh each time round: a report made while one is on its way
      // joins the end of the queue, and goes next.
      for (let next = this.queued()[0]; next; next = this.queued()[0]) {
        const body = JSON.stringify(next);
        let ok = false;
        try {
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body,
            keepalive: true,
          });
          // Taken, or refused as not a report: either way it is not sent again.
          ok = response.status < 500 && response.status !== 429;
        } catch {
          ok = false;
        }
        if (!ok) break;
        this.keep(this.queued().filter((report) => JSON.stringify(report) !== body));
      }
    } finally {
      this.busy = false;
    }
  }

  private queued(): CrashPayload[] {
    try {
      const raw = this.storage?.getItem(QUEUE_KEY);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? (list as CrashPayload[]) : [];
    } catch {
      return [];
    }
  }

  private keep(list: CrashPayload[]): void {
    try {
      this.storage?.setItem(QUEUE_KEY, JSON.stringify(list.slice(-QUEUE_LIMIT)));
    } catch {
      // Storage full or blocked: this report is lost, and the game goes on.
    }
  }
}

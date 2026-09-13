/**
 * Who you are, across matches. §17 (M6: "accounts"), §18.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * §17 lists "accounts" under M6 and §18 leaves the account system OPEN. What
 * the game actually needs from an account today is one thing: an identity that
 * survives closing the app, so that a seat can be given back to the player who
 * left it (lobby.ts) and so that a name in a lobby means the same person each
 * time. That is this module: a player id generated once on this device and
 * kept, plus a display name.
 *
 * There is no password, no server-side record and no stats history, and that is
 * a decision rather than an omission - recorded in docs/OPEN-QUESTIONS.md.
 * Credentials would need a server to hold them, and there is nowhere to run one
 * (§15.2: the shipped build is static hosting). An identity that cannot be
 * proven is exactly as strong as this game needs while a match is four people
 * who already know each other's room code, and no weaker than the seat-by-
 * session-id it replaces. Anything that must not be forgeable - a ladder,
 * purchases - needs the real thing first, and is not in v1.
 *
 * A player id is therefore a claim, not a proof. The server treats it as one:
 * it seats by id and never grants anything on the strength of it beyond the
 * seat, so the worst a forged id achieves is taking a seat in a room whose code
 * you already had.
 *
 * NAMES ARE CLEANED ON BOTH SIDES
 *
 * A name is typed by one player and drawn on three other people's screens, so
 * the client cleans it for the player's benefit and the server cleans it again
 * because the client is not trusted (§15.1's rule, applied to text).
 */

/** The smallest thing this module needs from `localStorage`. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Identity {
  /** Stable across restarts. Identifies the seat to reclaim, nothing more. */
  playerId: string;
  /** Shown to other players. */
  name: string;
}

const STORAGE_KEY = 'lane-siege.identity';

/** Long enough that two players never collide; short enough to log. */
const ID_LENGTH = 16;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Names are drawn in a fixed-width card, and a long one is somebody else's problem. */
export const MAX_NAME_LENGTH = 14;

export function makePlayerId(random: () => number): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[Math.min(ID_ALPHABET.length - 1, Math.floor(random() * ID_ALPHABET.length))];
  }
  return id;
}

/**
 * A name safe to draw on somebody else's screen: no control characters, no
 * runs of whitespace, no leading or trailing space, and short.
 *
 * Deliberately not a profanity filter. One would need a word list per language
 * and would still be wrong; reporting and muting are the answer, and both need
 * the server-side account this version does not have.
 */
export function cleanName(typed: string): string {
  let kept = '';
  for (const character of typed) {
    const code = character.codePointAt(0) ?? 0;
    // Control characters. The whitespace ones (tab, newline, carriage return)
    // are kept for now and collapsed into a single space below, because they
    // separate words and dropping them would weld two together. The rest are
    // invisible and go.
    const isWhitespaceControl = code >= 0x09 && code <= 0x0d;
    if (!isWhitespaceControl && (code < 0x20 || (code >= 0x7f && code <= 0x9f))) continue;
    // Zero-width characters and the bidirectional overrides. Invisible, and the
    // standard way to make one name render as another.
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) continue;
    if (code >= 0x202a && code <= 0x202e) continue;
    if (code >= 0x2066 && code <= 0x2069) continue;
    kept += character;
  }

  const collapsed = kept.replace(/\s+/g, ' ').trim();
  // Sliced by code point rather than by UTF-16 unit, so a long name is never
  // cut in half through an emoji.
  return [...collapsed].slice(0, MAX_NAME_LENGTH).join('');
}

/**
 * The name a player gets before they choose one. Derived from their id, so two
 * unnamed players in one lobby are still told apart.
 */
export function defaultName(playerId: string): string {
  return `Player ${playerId.slice(0, 4).toUpperCase()}`;
}

/** The name to show for a seat, falling back through every empty case. */
export function displayName(name: string, playerId: string | null): string {
  const cleaned = cleanName(name);
  if (cleaned) return cleaned;
  return playerId ? defaultName(playerId) : 'Open';
}

/**
 * Read the stored identity, making one on first run.
 *
 * Every storage call is guarded: `localStorage` throws rather than returning
 * null in a private window on some browsers, and a game that will not start
 * because it could not remember a name is a worse outcome than a name it
 * forgets. A player with no storage gets a fresh identity per session and
 * everything works except reclaiming a seat after a reload.
 */
export function loadIdentity(storage: KeyValueStore | null, random: () => number): Identity {
  const fresh = (): Identity => {
    const playerId = makePlayerId(random);
    return { playerId, name: defaultName(playerId) };
  };

  if (!storage) return fresh();

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return fresh();
  }
  if (!raw) {
    const identity = fresh();
    saveIdentity(storage, identity);
    return identity;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as { playerId?: unknown; name?: unknown };
      const playerId = typeof record.playerId === 'string' ? record.playerId : '';
      if (playerId) {
        const name = typeof record.name === 'string' ? cleanName(record.name) : '';
        return { playerId, name: name || defaultName(playerId) };
      }
    }
  } catch {
    // Corrupt or from an older shape: replaced below rather than thrown at the
    // player, who cannot do anything about it.
  }

  const identity = fresh();
  saveIdentity(storage, identity);
  return identity;
}

export function saveIdentity(storage: KeyValueStore | null, identity: Identity): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Out of quota, or storage disabled. The identity still works for this
    // session; it just will not be there next time.
  }
}

/**
 * `localStorage`, or null where it is unavailable or blocked.
 *
 * Reading it is what throws, not using it, so this probes rather than checking
 * for existence.
 */
export function browserStorage(): KeyValueStore | null {
  try {
    const storage = globalThis.localStorage;
    storage.getItem(STORAGE_KEY);
    return storage;
  } catch {
    return null;
  }
}

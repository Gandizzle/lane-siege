/**
 * Portrait only, and what to do when the phone disagrees. §1, §4.1, §14.1.
 *
 * "Portrait. Fixed camera. Whole lane visible at all times" is not a
 * preference here, it is load-bearing: there is exactly one transform from
 * tile space to screen space, and the bands it divides the screen into - tabs,
 * lane, build bar - are stacked vertically because a thumb reaches the bottom
 * of a phone and not the middle of it. A landscape lane is a valid layout
 * (`computeLayout` will produce one) but a bad one: fitted to a 400-pixel
 * height, a tile comes out at fourteen pixels and a body at four.
 *
 * THREE PLATFORMS, THREE ANSWERS
 *
 *   - **The Android shell** is locked in its manifest, applied by
 *     `scripts/prepare-android.mjs`. Rotating the phone does nothing at all,
 *     which is the right answer and the only complete one.
 *   - **A browser on Android** may allow `screen.orientation.lock`, but only
 *     while the page is fullscreen, and a page cannot put itself fullscreen
 *     without a gesture. So the lock is attempted and its refusal is expected.
 *   - **Safari on iOS** has no orientation lock at all, at any time.
 *
 * Which leaves a notice, for the case the lock cannot cover: a line of text
 * saying the game is played upright. It does NOT block play - it is a hint,
 * not a modal, and it lets every tap through to the game underneath - because
 * a player who wants to squint at a sideways board is entitled to.
 */

/** Undoes everything `keepPortrait` installed. */
export interface OrientationGuard {
  dispose(): void;
}

/**
 * The short edge below which a landscape screen is a phone held sideways
 * rather than a desktop window or a tablet.
 *
 * A 1024 x 768 tablet and any desktop window lay out perfectly well in
 * landscape and must not be nagged; a 915 x 412 phone does not. The short edge
 * is what separates them, and 500 is comfortably above every phone's width and
 * below every tablet's.
 */
const PHONE_SHORT_EDGE = 500;

/** Should the "turn it upright" notice be showing at this viewport size? */
export function wantsRotation(width: number, height: number): boolean {
  return width > height && Math.min(width, height) <= PHONE_SHORT_EDGE;
}

/** The colours here match palette.ts. Duplicated because that module is Pixi's. */
const STYLE = {
  panel: '#181c26',
  edge: '#2a3040',
  text: '#dfe4ee',
  muted: '#8b93a5',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function keepPortrait(mount: HTMLElement): OrientationGuard {
  // Best effort, and expected to fail outside fullscreen on Android and always
  // on iOS. `lock` both throws synchronously on some engines and rejects on
  // others, so both are swallowed - there is nothing to do about a refusal
  // except show the notice below.
  try {
    const lock = (
      screen.orientation as { lock?: (to: string) => Promise<void> } | undefined
    )?.lock?.bind(screen.orientation);
    void lock?.('portrait').catch(() => {});
  } catch {
    // No orientation API, or locking is not allowed here. The notice covers it.
  }

  const notice = document.createElement('div');
  notice.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:50%',
    'transform:translate(-50%,-50%)',
    'z-index:40',
    // Never eats a tap: the game underneath stays playable.
    'pointer-events:none',
    `background:${STYLE.panel}`,
    `border:1px solid ${STYLE.edge}`,
    'border-radius:12px',
    'padding:18px 22px',
    'text-align:center',
    `font-family:${FONT}`,
    'display:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Turn your phone upright';
  title.style.cssText = `color:${STYLE.text};font-size:16px;font-weight:700`;

  const detail = document.createElement('div');
  detail.textContent = 'Lane Siege is played in portrait.';
  detail.style.cssText = `color:${STYLE.muted};font-size:12px;margin-top:6px`;

  notice.append(title, detail);
  mount.appendChild(notice);

  const refresh = () => {
    notice.style.display = wantsRotation(globalThis.innerWidth, globalThis.innerHeight)
      ? 'block'
      : 'none';
  };
  refresh();

  // Both events, because they do not agree across engines on which fires or in
  // what order - and `refresh` only reads the current size, so firing twice is
  // free. The BOARD's layout deliberately does not use either of these; see
  // the note on the frame loop in app.ts for why.
  globalThis.addEventListener('resize', refresh);
  globalThis.addEventListener('orientationchange', refresh);

  return {
    dispose() {
      globalThis.removeEventListener('resize', refresh);
      globalThis.removeEventListener('orientationchange', refresh);
      notice.remove();
    },
  };
}

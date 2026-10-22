/**
 * Keeps the game inside what the player can actually see.
 *
 * A phone's browser keeps bars of its own over the page - the address bar
 * most of all, which on a phone held sideways is a good share of a short
 * screen - and some browsers size a box pinned to the page's edges as though
 * those bars were not there, so its bottom runs on beneath them. And the page
 * asks to reach the very edges of the glass (`viewport-fit=cover` in
 * index.html), under a notch and a home indicator the device keeps for itself.
 * A game sized to the page then draws its bottom row, or its side, where
 * nobody can see it or tap it.
 *
 * So the mount is fitted to the VISUAL viewport - the part of the page on the
 * screen right now - less the device's safe areas. Where neither applies, a
 * desktop or a browser with nothing over the page, that is the whole window
 * and nothing changes. Checked every frame rather than on events, for the same
 * reason the layout is (app.ts): the events about it arrive before the sizes
 * have settled.
 */

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Returns a function that fits `mount` to the visible area, cheap enough to
 * call every frame: it only touches the page when something has moved.
 */
export function visibleAreaFitter(mount: HTMLElement): () => void {
  // The safe areas are only known to CSS (`env()`), so a hidden box carries
  // them as its padding for script to read.
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top, 0px)',
    'padding-right:env(safe-area-inset-right, 0px)',
    'padding-bottom:env(safe-area-inset-bottom, 0px)',
    'padding-left:env(safe-area-inset-left, 0px)',
  ].join(';');
  document.body.append(probe);

  let insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let insetsFor = '';
  let fitted = '';

  return () => {
    const view = globalThis.visualViewport;
    const width = view?.width ?? globalThis.innerWidth;
    const height = view?.height ?? globalThis.innerHeight;
    // The safe areas change with the way the phone is held, and only then:
    // read again when the screen's shape does, not every frame.
    const shape = `${Math.round(width)}x${Math.round(height)}`;
    if (shape !== insetsFor) {
      insetsFor = shape;
      const style = getComputedStyle(probe);
      insets = {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
      };
    }

    const left = (view?.offsetLeft ?? 0) + insets.left;
    const top = (view?.offsetTop ?? 0) + insets.top;
    const w = Math.max(0, width - insets.left - insets.right);
    const h = Math.max(0, height - insets.top - insets.bottom);
    const box = `${left},${top},${w},${h}`;
    if (box === fitted) return;
    fitted = box;
    const style = mount.style;
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.width = `${w}px`;
    style.height = `${h}px`;
    style.right = 'auto';
    style.bottom = 'auto';
  };
}

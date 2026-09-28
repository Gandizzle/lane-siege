/**
 * Where a thing is on screen, for the tutorial's pointer (tutorialCoach.ts).
 *
 * Read off the objects themselves rather than recomputed from the layout, so
 * a button that moves - a new layout, a turned phone, a page of sends - is
 * pointed at where it actually is. Null for anything not on screen, so the
 * coach never rings an empty patch of ground.
 */

import { Rectangle, type Container } from 'pixi.js';
import type { Rect } from '../layout.ts';

/** Whether `obj` and everything it is inside are showing. */
export function isShown(obj: Container): boolean {
  for (let at: Container | null = obj; at; at = at.parent) {
    if (!at.visible || at.alpha === 0) return false;
  }
  return true;
}

/**
 * The screen rectangle of `obj`: its hit area when it has one, since that is
 * what a tap has to land in, and otherwise what it draws. Null if hidden.
 */
export function screenRect(obj: Container): Rect | null {
  if (!isShown(obj)) return null;
  const hit = obj.hitArea;
  if (hit instanceof Rectangle) {
    const corner = obj.toGlobal({ x: hit.x, y: hit.y });
    return { x: corner.x, y: corner.y, width: hit.width, height: hit.height };
  }
  const bounds = obj.getBounds();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/** The smallest rectangle around all of `rects`; null if there are none. */
export function unionOf(rects: readonly (Rect | null)[]): Rect | null {
  const present = rects.filter((r): r is Rect => r !== null);
  if (present.length === 0) return null;
  const x = Math.min(...present.map((r) => r.x));
  const y = Math.min(...present.map((r) => r.y));
  const right = Math.max(...present.map((r) => r.x + r.width));
  const bottom = Math.max(...present.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

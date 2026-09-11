/** Shared text styling for the UI layer. */

import { Text } from 'pixi.js';
import { UI } from '../palette.ts';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function label(
  text: string,
  size: number,
  colour: number = UI.textMuted,
  weight: '400' | '500' | '600' | '700' = '500',
): Text {
  return new Text({
    text,
    style: { fill: colour, fontSize: size, fontFamily: FONT, fontWeight: weight },
  });
}

/** Centres a text object horizontally on `cx`. */
export function centreOn(text: Text, cx: number, y: number): Text {
  text.x = cx - text.width / 2;
  text.y = y;
  return text;
}

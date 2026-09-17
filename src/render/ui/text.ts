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

/**
 * A label that stays readable over whatever is behind it: light text with a
 * thin dark outline round every glyph.
 *
 * For numbers drawn ON something whose colour changes underneath them. The
 * fortress gauge is the case that needed it (hud.ts): the reading was drawn in
 * the background colour, which is exactly right against a full green bar and
 * invisible the moment the bar drains past the text and leaves the background
 * behind it.
 */
export function overlaid(
  text: string,
  size: number,
  colour: number = UI.text,
  weight: '600' | '700' = '700',
): Text {
  return new Text({
    text,
    style: {
      fill: colour,
      fontSize: size,
      fontFamily: FONT,
      fontWeight: weight,
      stroke: { color: UI.background, width: Math.max(2, size * 0.22), join: 'round' },
    },
  });
}

/**
 * A label that wraps rather than running off the edge, for prose rather than
 * numbers. The caller sets `style.wordWrapWidth` on resize, because how wide
 * the column is is a layout decision, not a text one.
 */
export function wrapped(text: string, size: number, colour: number = UI.textMuted): Text {
  return new Text({
    text,
    style: {
      fill: colour,
      fontSize: size,
      fontFamily: FONT,
      fontWeight: '500',
      wordWrap: true,
      wordWrapWidth: 200,
      lineHeight: size + 4,
    },
  });
}

/** Centres a text object horizontally on `cx`. */
export function centreOn(text: Text, cx: number, y: number): Text {
  text.x = cx - text.width / 2;
  text.y = y;
  return text;
}

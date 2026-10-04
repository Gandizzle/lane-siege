/**
 * Gold, gems and supply as pictures: a coin, a jewel and a figure, drawn
 * wherever a price or a wallet is (the HUD, the build bar, the builder
 * picker), in place of "g", "gem" and "supply".
 *
 * Drawn rather than emoji. An emoji coin is a recent character that older
 * phones show as an empty box, it looks different on every system, and it
 * cannot be coloured to sit in this palette; three Graphics shapes look the
 * same everywhere and stay sharp at nine pixels.
 *
 * A string says where an icon goes with a token - `{gold}`, `{gem}`,
 * `{supply}` - and a `RichLabel` lays out the text and the icons in one line.
 * Prose keeps its words ("not enough gems"): these are for numbers.
 */

import { Container, Graphics, type Text } from 'pixi.js';
import { UI } from '../palette.ts';
import { label } from './text.ts';

export type Currency = 'gold' | 'gem' | 'supply';

/** The tokens, for building strings: `${GOLD}45` reads as a coin and 45. */
export const GOLD = '{gold}';
export const GEM = '{gem}';
export const SUPPLY = '{supply}';

/** What each looks like. Gold is warm, gems cool, supply the colour of the text. */
export const CURRENCY_COLOURS: Record<Currency, number> = {
  gold: 0xf2c14e,
  gem: 0x5ee0e6,
  supply: 0xc9d1e0,
};

/**
 * Draw one icon into `g`, filling the square at (`x`, `y`) of side `size`.
 *
 *   gold    a coin: a disc with a darker rim and a ring struck into it
 *   gem     a cut jewel: a flat table on top, a point below, the crown lighter
 *   supply  a figure, head and shoulders: how many can stand in your army
 */
export function drawCurrency(
  g: Graphics,
  currency: Currency,
  x: number,
  y: number,
  size: number,
): void {
  const colour = CURRENCY_COLOURS[currency];
  const edge = Math.max(0.8, size * 0.1);
  switch (currency) {
    case 'gold': {
      const r = size / 2;
      const cx = x + r;
      const cy = y + r;
      g.circle(cx, cy, r - edge / 2)
        .fill({ color: colour })
        .stroke({ width: edge, color: 0xa87a12 });
      g.circle(cx, cy, r * 0.5).stroke({ width: Math.max(0.6, size * 0.08), color: 0xfbe29a });
      return;
    }
    case 'gem': {
      const w = size;
      const h = size;
      const top = y + h * 0.12;
      const girdle = y + h * 0.4;
      const tip = y + h;
      g.poly([x + w * 0.22, top, x + w * 0.78, top, x + w, girdle, x + w / 2, tip, x, girdle])
        .fill({ color: colour })
        .stroke({ width: edge * 0.8, color: 0x1f8f99, join: 'round' });
      // The crown catches the light.
      g.poly([x + w * 0.22, top, x + w * 0.78, top, x + w, girdle, x, girdle]).fill({
        color: 0xc8f7fa,
        alpha: 0.75,
      });
      return;
    }
    case 'supply': {
      const cx = x + size / 2;
      g.circle(cx, y + size * 0.27, size * 0.22).fill({ color: colour });
      // Shoulders: a rounded block under the head.
      g.roundRect(x + size * 0.12, y + size * 0.55, size * 0.76, size * 0.45, size * 0.2).fill({
        color: colour,
      });
      return;
    }
  }
}

const TOKEN = /\{(gold|gem|supply)\}/g;

type Run = { text: string } | { icon: Currency };

/** Split a string into runs of text and icons. */
export function parseRich(text: string): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index) });
    runs.push({ icon: match[1] as Currency });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}

/**
 * One line of text with currency icons in it.
 *
 * Built once and updated with `set`, like every other label that changes
 * while the game runs: the text pieces are pooled and the icons share one
 * Graphics, so a price that has not changed costs nothing and one that has
 * costs a relayout, not a rebuild.
 */
export class RichLabel extends Container {
  private readonly pieces: Text[] = [];
  private readonly icons = new Graphics();
  private current = '';
  private limit = Infinity;
  private colour: number;

  constructor(
    private fontSize: number,
    colour: number = UI.textMuted,
    private readonly weight: '400' | '500' | '600' | '700' = '500',
  ) {
    super();
    this.colour = colour;
    this.addChild(this.icons);
  }

  /** The size of the words; the icons follow it. For text that scales with the screen. */
  setFontSize(size: number): void {
    if (size === this.fontSize) return;
    this.fontSize = size;
    for (const piece of this.pieces) piece.style.fontSize = size;
    this.layOut();
  }

  get text(): string {
    return this.current;
  }

  /** How wide the line is at its own size, before any shrinking to fit. */
  get naturalWidth(): number {
    return this.natural;
  }
  private natural = 0;

  /**
   * Show `text`, shrunk to fit in `maxWidth` if it would run past it - a
   * price is not something to cut short with an ellipsis.
   */
  set(text: string, maxWidth = Infinity): void {
    if (text === this.current && maxWidth === this.limit) return;
    this.current = text;
    this.limit = maxWidth;
    this.layOut();
  }

  /** The colour of the words; the icons keep their own. */
  setColour(colour: number): void {
    if (colour === this.colour) return;
    this.colour = colour;
    for (const piece of this.pieces) piece.style.fill = colour;
  }

  private layOut(): void {
    const runs = parseRich(this.current);
    const size = Math.round(this.fontSize * 1.1);
    // A line of this font is about 1.25 of its size tall; icons sit centred on it.
    const lineHeight = this.fontSize * 1.25;
    const gap = Math.max(1, this.fontSize * 0.15);
    this.icons.clear();
    let x = 0;
    let used = 0;
    for (const run of runs) {
      if ('text' in run) {
        const piece = this.pieces[used] ?? this.makePiece();
        used += 1;
        piece.visible = true;
        if (piece.text !== run.text) piece.text = run.text;
        piece.position.set(x, 0);
        x += piece.width;
      } else {
        drawCurrency(this.icons, run.icon, x + gap / 2, (lineHeight - size) / 2 + 1, size);
        x += size + gap;
      }
    }
    for (let i = used; i < this.pieces.length; i++) this.pieces[i]!.visible = false;
    this.natural = x;
    const scale = x > this.limit && x > 0 ? Math.max(0.7, this.limit / x) : 1;
    this.scale.set(scale);
  }

  private makePiece(): Text {
    const piece = label('', this.fontSize, this.colour, this.weight);
    this.pieces.push(piece);
    this.addChild(piece);
    return piece;
  }
}

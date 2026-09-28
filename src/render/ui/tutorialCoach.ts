/**
 * The tutorial's coach: a card that says what is going on, and a light on the
 * thing to tap (src/tutorial for what it says and when).
 *
 * THREE WAYS TO HOLD THE SCREEN, one per kind of step (tutorial/types.ts):
 *
 *   `next`  The board dims, the target (if any) stays lit, and nothing but the
 *           card takes a tap. Reading is the whole job.
 *   `tap`   The board dims around a hole over the target, and ONLY the hole
 *           takes a tap - it falls through to whatever is under it, the real
 *           button or the real lane, so the player learns the real gesture on
 *           the real thing. A tap anywhere else is swallowed, and makes the ring
 *           flash so it is clear where to go instead.
 *   `free`  Nothing dims and nothing is blocked: watching a wave, closing a
 *           card the player opened. The ring still marks the target.
 *
 * The blockers are four rectangles round the hole rather than one sheet with a
 * hole cut in it, because Pixi hit-tests a shape's area, not its paint: a
 * sheet would swallow the hole's taps too.
 *
 * The menu button and the effects legend are drawn over the coach (game.ts),
 * so neither is ever out of reach; while either of their panels is open the
 * coach stands aside entirely.
 *
 * Every child is made once and only moved. A rebuilt interactive object never
 * receives a tap (the note at the top of buildBar.ts).
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { StepMode } from '../../tutorial/types.ts';
import type { LaneLayout, Rect } from '../layout.ts';
import { UI } from '../palette.ts';
import { PanelButton } from './menu.ts';
import { label, wrapped } from './text.ts';

/** What the card says. */
export type CoachCard =
  | {
      kind: 'step';
      /** "Chapter 2 · Build your first line" */
      heading: string;
      /** One-based. */
      step: number;
      steps: number;
      text: string;
      mode: StepMode;
      /** The Next button's words, for a step whose Next does something. */
      nextLabel: string;
    }
  | {
      kind: 'complete';
      heading: string;
      text: string;
      /** The primary button: the next chapter, or somewhere to go after the last. */
      continueLabel: string;
    };

export interface CoachFrame {
  card: CoachCard;
  /** What to point at, on screen; null for nothing in particular. */
  target: Rect | null;
  /** Something is open over the board - the menu, the effects panel. */
  hidden: boolean;
}

export interface CoachHandlers {
  onNext(): void;
  /** Leave the chapter, for the chapter list. */
  onExit(): void;
  /** On the chapter-complete card: go on. */
  onContinue(): void;
  /** On the chapter-complete card: back to the list. */
  onChapters(): void;
}

/** How far the hole and its ring stand off the target, in pixels. */
const HOLE_PAD = 6;
const CARD_PAD = 14;
const BUTTON_H = 34;
const EDGE = 12;

/**
 * Where the card goes: the spot that covers least of the target, trying the
 * bottom of the screen first (it is where a phone's text is expected), then
 * the top, then the sides. `avoid` is the target, grown by the hole's pad.
 *
 * `keepClear` is what is drawn OVER the coach - the menu button and the
 * effects legend button - which the card moves out from under rather than
 * having them sit on top of its words.
 */
export function placeCard(
  screen: Rect,
  size: { width: number; height: number },
  avoid: Rect | null,
  keepClear: readonly Rect[] = [],
): { x: number; y: number } {
  const width = Math.min(size.width, screen.width - EDGE * 2);
  const across = (x: number, r: Rect) => r.x < x + width && r.x + r.width > x;
  // Pushed below whatever is kept clear in the top half, and above whatever
  // is in the bottom half, over the card's own width.
  const topAt = (x: number) =>
    keepClear
      .filter((r) => across(x, r) && r.y < screen.height / 2)
      .reduce((y, r) => Math.max(y, r.y + r.height + 6), EDGE);
  const bottomAt = (x: number) =>
    keepClear
      .filter((r) => across(x, r) && r.y >= screen.height / 2)
      .reduce((y, r) => Math.min(y, r.y - size.height - 6), screen.height - size.height - EDGE);

  const centre = (screen.width - width) / 2;
  const left = EDGE;
  const right = screen.width - width - EDGE;
  const candidates = [
    { x: centre, y: bottomAt(centre) },
    { x: centre, y: topAt(centre) },
    { x: left, y: bottomAt(left) },
    { x: right, y: bottomAt(right) },
    { x: left, y: topAt(left) },
    { x: right, y: topAt(right) },
    { x: centre, y: (screen.height - size.height) / 2 },
  ];

  let best = candidates[0]!;
  let bestCost = Infinity;
  for (const at of candidates) {
    const card = { x: at.x, y: at.y, width, height: size.height };
    // Covering a button that is drawn over the card is worse than covering
    // any amount of the target: the button would sit on the words.
    const cost =
      (avoid ? overlapArea(card, avoid) : 0) +
      keepClear.reduce((sum, r) => sum + (overlapArea(card, r) > 0 ? 1e9 : 0), 0);
    if (cost < bestCost - 0.5) {
      best = at;
      bestCost = cost;
    }
  }
  return best;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function grow(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

export class TutorialCoach extends Container {
  /** The dim, drawn round the hole. Paint only: it takes no taps. */
  private readonly shade = new Graphics();
  /** Four blockers round the hole, or one over everything for a `next` step. */
  private readonly blockers: Container[] = [];
  private readonly ring = new Graphics();
  private readonly arrow = new Graphics();

  private readonly card = new Container();
  private readonly cardBg = new Graphics();
  private readonly heading: Text;
  private readonly counter: Text;
  private readonly body: Text;
  private readonly hint: Text;
  private readonly nextButton: PanelButton;
  private readonly exitButton: PanelButton;

  /** Seconds, for the ring's pulse and the arrow's bob. */
  private clock = 0;
  /** Counts down after a swallowed tap: the ring flashes to say "here". */
  private nudge = 0;
  private complete = false;

  constructor(
    private layout: LaneLayout,
    private readonly handlers: CoachHandlers,
  ) {
    super();
    this.shade.eventMode = 'none';
    this.ring.eventMode = 'none';
    this.arrow.eventMode = 'none';

    for (let i = 0; i < 4; i++) {
      const blocker = new Container();
      blocker.eventMode = 'static';
      blocker.on('pointertap', () => (this.nudge = 1));
      this.blockers.push(blocker);
    }

    this.heading = label('', 11, UI.textMuted, '700');
    this.counter = label('', 11, UI.textMuted, '600');
    this.body = wrapped('', 14, UI.text);
    this.hint = label('', 12, UI.accent, '700');
    this.nextButton = new PanelButton('Next', () => {
      if (this.complete) this.handlers.onContinue();
      else this.handlers.onNext();
    });
    this.exitButton = new PanelButton(
      'Exit',
      () => {
        if (this.complete) this.handlers.onChapters();
        else this.handlers.onExit();
      },
      12,
    );

    // The card swallows its own taps: a tap on the words is not a tap on the
    // board behind them.
    this.card.eventMode = 'static';
    this.card.addChild(
      this.cardBg,
      this.heading,
      this.counter,
      this.body,
      this.hint,
      this.nextButton,
      this.exitButton,
    );

    this.addChild(this.shade, ...this.blockers, this.ring, this.arrow, this.card);
    this.visible = false;
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
  }

  /** Put the coach away: no chapter is running. */
  hide(): void {
    this.visible = false;
  }

  render(frame: CoachFrame, deltaMs: number): void {
    this.visible = !frame.hidden;
    if (frame.hidden) return;
    this.clock += deltaMs / 1000;
    this.nudge = Math.max(0, this.nudge - deltaMs / 600);

    const card = frame.card;
    this.complete = card.kind === 'complete';
    const mode: StepMode = card.kind === 'complete' ? 'next' : card.mode;
    const screen = this.layout.screen;
    const hole = frame.target ? grow(frame.target, HOLE_PAD) : null;

    this.drawShade(mode, hole, screen);
    this.placeBlockers(mode, hole, screen);
    this.drawPointer(mode, hole, screen);
    this.drawCard(card, hole, screen);
  }

  /** Dim the board round the hole; lighter with nothing to single out. */
  private drawShade(mode: StepMode, hole: Rect | null, screen: Rect): void {
    this.shade.clear();
    if (mode === 'free') return;
    const alpha = hole ? 0.6 : 0.35;
    if (!hole) {
      this.shade.rect(0, 0, screen.width, screen.height).fill({ color: 0x000000, alpha });
      return;
    }
    for (const r of around(hole, screen)) {
      if (r.width > 0 && r.height > 0) {
        this.shade.rect(r.x, r.y, r.width, r.height).fill({ color: 0x000000, alpha });
      }
    }
  }

  /** What takes a tap: nothing (`free`), everything (`next`), or all but the hole. */
  private placeBlockers(mode: StepMode, hole: Rect | null, screen: Rect): void {
    const rects: Rect[] =
      mode === 'free'
        ? []
        : mode === 'tap' && hole
          ? around(hole, screen)
          : [{ x: 0, y: 0, width: screen.width, height: screen.height }];
    this.blockers.forEach((blocker, i) => {
      const r = rects[i];
      blocker.visible = r !== undefined && r.width > 0 && r.height > 0;
      if (r) blocker.hitArea = new Rectangle(r.x, r.y, Math.max(0, r.width), Math.max(0, r.height));
    });
  }

  /** The ring round the target, a ripple and an arrow when it wants a tap. */
  private drawPointer(mode: StepMode, hole: Rect | null, screen: Rect): void {
    this.ring.clear();
    this.arrow.clear();
    if (!hole) return;

    const pulse = 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 * 0.9);
    const flash = this.nudge;
    this.ring.roundRect(hole.x, hole.y, hole.width, hole.height, 8).stroke({
      width: 2.5 + flash * 2,
      color: flash > 0 ? UI.selected : UI.accent,
      alpha: mode === 'free' ? 0.45 + 0.3 * pulse : 0.7 + 0.3 * pulse,
    });
    if (mode !== 'tap') return;

    // A ripple spreading off the hole, over and over: "press here".
    const phase = (this.clock % 1.2) / 1.2;
    const spread = 2 + phase * 12;
    this.ring
      .roundRect(
        hole.x - spread,
        hole.y - spread,
        hole.width + spread * 2,
        hole.height + spread * 2,
        8 + spread,
      )
      .stroke({ width: 2, color: UI.accent, alpha: (1 - phase) * 0.6 });

    // An arrow on whichever side of the target has the most room, pointing at
    // it and bobbing towards it.
    const room = {
      above: hole.y,
      below: screen.height - (hole.y + hole.height),
      left: hole.x,
      right: screen.width - (hole.x + hole.width),
    };
    const side = (Object.keys(room) as (keyof typeof room)[]).reduce((a, b) =>
      room[b] > room[a] ? b : a,
    );
    if (room[side] < 34) return;
    const bob = 4 + 5 * (0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 * 1.4));
    const cx = hole.x + hole.width / 2;
    const cy = hole.y + hole.height / 2;
    const size = 11;
    const tip =
      side === 'above'
        ? { x: cx, y: hole.y - bob }
        : side === 'below'
          ? { x: cx, y: hole.y + hole.height + bob }
          : side === 'left'
            ? { x: hole.x - bob, y: cy }
            : { x: hole.x + hole.width + bob, y: cy };
    // Pointing back at the target from the side it sits on.
    const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const dy = side === 'above' ? -1 : side === 'below' ? 1 : 0;
    const base = { x: tip.x + dx * size * 1.6, y: tip.y + dy * size * 1.6 };
    const px = -dy * size;
    const py = dx * size;
    this.arrow
      .poly([tip.x, tip.y, base.x + px, base.y + py, base.x - px, base.y - py])
      .fill({ color: UI.accent })
      .stroke({ width: 2, color: UI.background, alpha: 0.8 });
  }

  private drawCard(card: CoachCard, hole: Rect | null, screen: Rect): void {
    const width = Math.min(380, screen.width - EDGE * 2);
    const inner = width - CARD_PAD * 2;

    this.heading.text = card.heading;
    this.counter.text = card.kind === 'step' ? `${card.step} / ${card.steps}` : '';
    this.body.style.wordWrapWidth = inner;
    this.body.text = card.text;

    // What the bottom row holds: Next for a reading step, a reminder of what
    // to do for the others, and Exit always.
    const wantsNext = card.kind === 'complete' || card.mode === 'next';
    this.hint.text = card.kind === 'step' && card.mode === 'tap' ? 'Tap the highlighted spot' : '';
    this.nextButton.visible = wantsNext;
    this.hint.visible = !wantsNext && this.hint.text !== '';

    const bodyTop = CARD_PAD + 20;
    const buttonsTop = bodyTop + this.body.height + 12;
    const height = buttonsTop + BUTTON_H + CARD_PAD;
    const at = placeCard(screen, { width, height }, hole, [
      this.layout.menuButton,
      this.layout.legendButton,
    ]);

    this.card.position.set(at.x, at.y);
    this.card.hitArea = new Rectangle(0, 0, width, height);
    this.cardBg.clear();
    this.cardBg
      .roundRect(0, 0, width, height, 12)
      .fill({ color: UI.panel, alpha: 0.97 })
      .stroke({ width: 1.5, color: UI.accent, alpha: 0.8 });

    this.heading.position.set(CARD_PAD, CARD_PAD);
    this.counter.position.set(width - CARD_PAD - this.counter.width, CARD_PAD);
    this.body.position.set(CARD_PAD, bodyTop);

    const exitWidth = card.kind === 'complete' ? 110 : 64;
    this.exitButton.place(CARD_PAD, buttonsTop, exitWidth, BUTTON_H);
    this.exitButton.set(card.kind === 'complete' ? 'Chapters' : 'Exit', 'plain');

    const nextWidth = Math.min(inner - exitWidth - 10, card.kind === 'complete' ? 200 : 150);
    this.nextButton.place(width - CARD_PAD - nextWidth, buttonsTop, nextWidth, BUTTON_H);
    this.nextButton.set(card.kind === 'complete' ? card.continueLabel : card.nextLabel, 'primary');
    this.hint.position.set(width - CARD_PAD - this.hint.width, buttonsTop + 9);
  }
}

/** The four rectangles of `screen` round `hole`: above, below, left, right. */
function around(hole: Rect, screen: Rect): Rect[] {
  const top = Math.max(0, hole.y);
  const bottom = Math.min(screen.height, hole.y + hole.height);
  return [
    { x: 0, y: 0, width: screen.width, height: top },
    { x: 0, y: bottom, width: screen.width, height: screen.height - bottom },
    { x: 0, y: top, width: Math.max(0, hole.x), height: bottom - top },
    {
      x: hole.x + hole.width,
      y: top,
      width: Math.max(0, screen.width - hole.x - hole.width),
      height: bottom - top,
    },
  ];
}

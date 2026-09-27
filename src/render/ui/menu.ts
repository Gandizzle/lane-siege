/**
 * The menu: a button in the corner of every screen, and the panel it opens.
 *
 * WHAT IS IN IT
 *
 * Sound, which is what exists to be set: three levels, mute, which music plays
 * (one piece, or shuffle the list), skip to the next piece, and which sound
 * pack plays the effects (src/audio). Then the game: your name, leaving the
 * match you are in, and closing the menu. A practice match is paused behind
 * the menu, because nobody else is waiting on it; an online match is not, and
 * the panel says so rather than letting a player think they have stopped time.
 *
 * Each row is a small class with a fixed shape - slider, toggle, picker,
 * button - so a new option is a row made in the constructor, placed in
 * `arrange()` and refreshed in `render()`, not a new piece of layout.
 *
 * BUILT ONCE
 *
 * Every interactive object is made in the constructor and only moved or
 * redrawn afterwards. The note at the top of buildBar.ts is why: an object
 * rebuilt between a press and its release never receives the tap.
 *
 * The panel reads the settings back from the sound system every frame it is
 * open, rather than keeping its own copy, so M pressed with the menu open
 * moves the mute switch too.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent, Text } from 'pixi.js';
import { MUSIC_TRACKS, SOUND_PACKS } from '../../audio/catalog.ts';
import type { SoundSystem } from '../../audio/engine.ts';
import type { AudioSettings, MusicChoice } from '../../audio/settings.ts';
import type { LaneLayout, Rect } from '../layout.ts';
import { UI } from '../palette.ts';
import { fit, label, wrapped } from './text.ts';

export interface MenuHandlers {
  onClose(): void;
  onLeaveMatch(): void;
  onEditName(): void;
}

/** What the menu needs to know about the game behind it, each frame it is open. */
export interface MenuState {
  /** There is a match (or a room) to leave. */
  inMatch: boolean;
  /** The match behind the menu is paused: it runs in this tab. */
  paused: boolean;
  name: string;
}

/** How long "Leave match" stays armed for its second tap. */
const LEAVE_ARM_MS = 3000;
/** A slider moves in twentieths: fine enough to set, coarse enough to land on. */
const SLIDER_STEP = 0.05;
/** Extra reach round the corner button, because it is drawn smaller than a thumb. */
const BUTTON_SLACK = 6;

/**
 * The option `by` steps from `current`, wrapping round both ends. An unknown
 * `current` counts as the first, so a removed option steps from the top.
 */
export function cycle<T>(options: readonly T[], current: T, by: -1 | 1): T {
  const at = Math.max(0, options.indexOf(current));
  return options[(at + by + options.length) % options.length] ?? current;
}

// ------------------------------------------------------------------ pieces

/** A rounded button with a centred label. */
class PanelButton extends Container {
  private readonly bg = new Graphics();
  readonly text: Text;
  private w = 0;
  private h = 0;
  private tone: 'plain' | 'primary' | 'danger' = 'plain';
  private enabled = true;

  constructor(
    caption: string,
    onTap: () => void,
    private readonly fontSize = 13,
  ) {
    super();
    this.text = label(caption, fontSize, UI.text, '700');
    this.addChild(this.bg, this.text);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => {
      if (this.enabled) onTap();
    });
  }

  place(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.redraw();
  }

  set(caption: string, tone: 'plain' | 'primary' | 'danger' = 'plain', enabled = true): void {
    if (this.text.text === caption && this.tone === tone && this.enabled === enabled) return;
    this.text.text = caption;
    this.tone = tone;
    this.enabled = enabled;
    this.redraw();
  }

  private redraw(): void {
    const fill =
      this.tone === 'primary' ? UI.accent : this.tone === 'danger' ? UI.danger : UI.panelEdge;
    this.bg.clear();
    this.bg.roundRect(0, 0, this.w, this.h, 8).fill({ color: fill });
    this.text.style.fill = this.tone === 'plain' ? UI.text : UI.background;
    this.text.text = fit(this.text.text, this.w - 12, this.fontSize);
    this.text.position.set((this.w - this.text.width) / 2, (this.h - this.text.height) / 2);
    this.alpha = this.enabled ? 1 : 0.4;
  }
}

/** A level from 0 to 1: tap anywhere on the track, or drag along it. */
class Slider extends Container {
  private readonly caption: Text;
  private readonly readout: Text;
  private readonly track = new Graphics();
  private trackX = 0;
  private trackW = 0;
  private rowH = 0;
  private value = -1;
  private dragging = false;

  constructor(
    caption: string,
    private readonly onChange: (value: number) => void,
    private readonly onRelease: () => void = () => {},
  ) {
    super();
    this.caption = label(caption, 13, UI.text, '600');
    this.readout = label('', 12, UI.textMuted, '600');
    this.addChild(this.caption, this.track, this.readout);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', (event: FederatedPointerEvent) => {
      this.dragging = true;
      this.follow(event);
    });
    // Heard wherever the pointer goes, so a drag that strays off the row
    // still moves the knob.
    this.on('globalpointermove', (event: FederatedPointerEvent) => {
      if (this.dragging) this.follow(event);
    });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.onRelease();
    };
    this.on('pointerup', end);
    this.on('pointerupoutside', end);
  }

  place(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.rowH = height;
    const labelW = Math.min(90, width * 0.3);
    const readoutW = 42;
    this.trackX = labelW;
    this.trackW = Math.max(40, width - labelW - readoutW - 8);
    this.caption.position.set(0, (height - this.caption.height) / 2);
    this.readout.position.set(width - readoutW + 8, (height - this.readout.height) / 2);
    this.hitArea = new Rectangle(this.trackX - 8, 0, this.trackW + 16, height);
    this.draw(this.value < 0 ? 0 : this.value);
  }

  show(value: number): void {
    if (Math.abs(value - this.value) < 1e-6) return;
    this.draw(value);
  }

  private follow(event: FederatedPointerEvent): void {
    const local = this.toLocal(event.global);
    const raw = Math.max(0, Math.min(1, (local.x - this.trackX) / this.trackW));
    // Divided rather than multiplied back, so 0.7 is stored as 0.7 and not as
    // 0.7000000000000001.
    const stepped = Math.round(raw / SLIDER_STEP) / Math.round(1 / SLIDER_STEP);
    if (Math.abs(stepped - this.value) < 1e-6) return;
    this.draw(stepped);
    this.onChange(stepped);
  }

  private draw(value: number): void {
    this.value = value;
    const cy = this.rowH / 2;
    const knobX = this.trackX + this.trackW * value;
    this.track.clear();
    this.track
      .roundRect(this.trackX, cy - 3, this.trackW, 6, 3)
      .fill({ color: UI.panelEdge })
      .roundRect(this.trackX, cy - 3, Math.max(6, knobX - this.trackX), 6, 3)
      .fill({ color: UI.accent })
      .circle(knobX, cy, 9)
      .fill({ color: UI.text });
    this.readout.text = `${Math.round(value * 100)}%`;
  }
}

/** On or off. */
class Toggle extends Container {
  private readonly caption: Text;
  private readonly pill = new Graphics();
  private w = 0;
  private h = 0;
  private on_: boolean | null = null;

  constructor(caption: string, onTap: () => void) {
    super();
    this.caption = label(caption, 13, UI.text, '600');
    this.addChild(this.caption, this.pill);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }

  place(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.w = width;
    this.h = height;
    this.caption.position.set(0, (height - this.caption.height) / 2);
    // The whole row, not just the pill: it is one choice and one target.
    this.hitArea = new Rectangle(0, 0, width, height);
    const was = this.on_;
    this.on_ = null;
    this.show(was ?? false);
  }

  show(on: boolean): void {
    if (this.on_ === on) return;
    this.on_ = on;
    const pw = 44;
    const ph = 24;
    const px = this.w - pw;
    const py = (this.h - ph) / 2;
    this.pill.clear();
    this.pill
      .roundRect(px, py, pw, ph, ph / 2)
      .fill({ color: on ? UI.accent : UI.panelEdge })
      .circle(on ? px + pw - ph / 2 : px + ph / 2, py + ph / 2, ph / 2 - 3)
      .fill({ color: UI.text });
  }
}

/** One of a list, stepped through with arrows either side. Wraps round. */
class Picker extends Container {
  private readonly caption: Text;
  private readonly value: Text;
  private readonly back: PanelButton;
  private readonly next: PanelButton;
  private valueX = 0;
  private valueW = 0;
  private h = 0;

  constructor(caption: string, onStep: (by: -1 | 1) => void) {
    super();
    this.caption = label(caption, 13, UI.text, '600');
    this.value = label('', 13, UI.text, '700');
    this.back = new PanelButton('‹', () => onStep(-1), 22);
    this.next = new PanelButton('›', () => onStep(1), 22);
    this.addChild(this.caption, this.value, this.back, this.next);
  }

  place(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    this.h = height;
    const labelW = Math.min(90, width * 0.3);
    const arrow = Math.min(34, height - 4);
    const arrowY = (height - arrow) / 2;
    this.caption.position.set(0, (height - this.caption.height) / 2);
    this.back.place(labelW, arrowY, arrow, arrow);
    this.next.place(width - arrow, arrowY, arrow, arrow);
    this.valueX = labelW + arrow;
    this.valueW = width - labelW - arrow * 2;
    this.layoutValue();
  }

  show(text: string, choices: number): void {
    const shown = fit(text, this.valueW - 8, 13);
    if (this.value.text !== shown) {
      this.value.text = shown;
      this.layoutValue();
    }
    // One choice is still shown - it says what is playing the effects - but
    // there is nowhere to step to.
    const enabled = choices > 1;
    this.back.set('‹', 'plain', enabled);
    this.next.set('›', 'plain', enabled);
  }

  private layoutValue(): void {
    this.value.position.set(
      this.valueX + (this.valueW - this.value.width) / 2,
      (this.h - this.value.height) / 2,
    );
  }
}

/** A line of text with a button at its right-hand end. */
class LineWithButton extends Container {
  private readonly caption: Text;
  private readonly value: Text;
  readonly button: PanelButton;
  private valueW = 0;

  constructor(caption: string, buttonCaption: string, onTap: () => void) {
    super();
    this.caption = label(caption, 13, UI.text, '600');
    this.value = label('', 12, UI.textMuted, '600');
    this.button = new PanelButton(buttonCaption, onTap);
    this.addChild(this.caption, this.value, this.button);
  }

  place(x: number, y: number, width: number, height: number): void {
    this.position.set(x, y);
    // Past the caption however long it runs, not at a fixed column.
    const labelW = Math.max(Math.min(90, width * 0.3), this.caption.width + 10);
    const buttonW = 76;
    this.caption.position.set(0, (height - this.caption.height) / 2);
    this.value.position.set(labelW, (height - this.value.height) / 2);
    this.valueW = width - labelW - buttonW - 8;
    this.button.place(width - buttonW, (height - 30) / 2, buttonW, 30);
  }

  show(text: string): void {
    const shown = fit(text, this.valueW, 12);
    if (this.value.text !== shown) this.value.text = shown;
  }
}

// ------------------------------------------------------------------ the button

/** Three bars in a rounded square, in the layout's corner on every screen. */
export class MenuButton extends Container {
  private readonly bg = new Graphics();

  constructor(
    private layout: LaneLayout,
    onTap: () => void,
  ) {
    super();
    this.addChild(this.bg);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
    this.setLayout(layout);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    const r = this.layout.menuButton;
    this.hitArea = new Rectangle(
      r.x - BUTTON_SLACK,
      r.y - BUTTON_SLACK,
      r.width + BUTTON_SLACK * 2,
      r.height + BUTTON_SLACK * 2,
    );
    this.bg.clear();
    this.bg
      .roundRect(r.x, r.y, r.width, r.height, 8)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.panelEdge });
    const inset = r.width * 0.27;
    for (let i = -1; i <= 1; i++) {
      const y = r.y + r.height / 2 + i * r.height * 0.2;
      this.bg
        .roundRect(r.x + inset, y - 1.25, r.width - inset * 2, 2.5, 1.25)
        .fill({ color: UI.text });
    }
  }
}

// ------------------------------------------------------------------ the panel

export class Menu extends Container {
  private readonly scrim = new Graphics();
  private readonly panel = new Graphics();
  private readonly title: Text;
  private readonly closeX: PanelButton;
  private readonly soundHeading: Text;
  private readonly gameHeading: Text;

  private readonly master: Slider;
  private readonly music: Slider;
  private readonly effectsLevel: Slider;
  private readonly mute: Toggle;
  private readonly musicChoice: Picker;
  private readonly nowPlaying: LineWithButton;
  private readonly soundPack: Picker;

  private readonly nameRow: LineWithButton;
  private readonly note: Text;
  private readonly leave: PanelButton;
  private readonly resume: PanelButton;
  private readonly keys: Text;

  private layout: LaneLayout;
  private state: MenuState = { inMatch: false, paused: false, name: '' };
  private leaveArmedMs = 0;

  constructor(
    layout: LaneLayout,
    private readonly sound: SoundSystem,
    private readonly handlers: MenuHandlers,
  ) {
    super();
    this.layout = layout;
    this.visible = false;

    this.title = label('Menu', 18, UI.text, '700');
    this.closeX = new PanelButton('✕', () => this.handlers.onClose());
    this.soundHeading = label('SOUND', 11, UI.textMuted, '700');
    this.gameHeading = label('GAME', 11, UI.textMuted, '700');

    const set = (change: Partial<AudioSettings>) => this.sound.configure(change);
    // A level is heard as it is set: the music is already playing, and the
    // effects play a chime when the knob is let go.
    const preview = () => this.sound.play('buy');
    this.master = new Slider('Volume', (v) => set({ master: v }), preview);
    this.music = new Slider('Music', (v) => set({ music: v }));
    this.effectsLevel = new Slider('Effects', (v) => set({ effects: v }), preview);
    this.mute = new Toggle('Mute everything', () => set({ muted: !this.sound.settings.muted }));
    this.musicChoice = new Picker('Track', (by) => set({ musicChoice: this.stepMusic(by) }));
    this.nowPlaying = new LineWithButton('Now playing', 'Next', () => this.sound.skipTrack());
    this.soundPack = new Picker('Effects set', (by) => set({ soundPack: this.stepPack(by) }));

    this.nameRow = new LineWithButton('Name', 'Change', () => this.handlers.onEditName());
    this.note = wrapped('', 11);
    this.leave = new PanelButton('Leave match', () => this.tapLeave());
    this.resume = new PanelButton('Close', () => this.handlers.onClose());
    this.keys = label('Esc opens and closes this menu · M mutes', 10, UI.textMuted);

    // A tap outside the panel closes it; a tap on the panel's empty space
    // does nothing, rather than falling through to the board behind.
    this.scrim.eventMode = 'static';
    this.scrim.on('pointertap', () => this.handlers.onClose());
    this.panel.eventMode = 'static';

    this.addChild(
      this.scrim,
      this.panel,
      this.title,
      this.closeX,
      this.soundHeading,
      this.master,
      this.music,
      this.effectsLevel,
      this.mute,
      this.musicChoice,
      this.nowPlaying,
      this.soundPack,
      this.gameHeading,
      this.nameRow,
      this.note,
      this.leave,
      this.resume,
      this.keys,
    );
    this.setLayout(layout);
  }

  setLayout(layout: LaneLayout): void {
    this.layout = layout;
    this.arrange();
  }

  /** Open or close. Opening disarms "Leave match", so it never opens armed. */
  setOpen(open: boolean): void {
    if (open && !this.visible) this.leaveArmedMs = 0;
    this.visible = open;
  }

  get isOpen(): boolean {
    return this.visible;
  }

  /** Bring every row up to date. Cheap when nothing has changed. */
  render(state: MenuState, deltaMs: number): void {
    if (!this.visible) return;
    const layoutChanged =
      state.inMatch !== this.state.inMatch || state.paused !== this.state.paused;
    this.state = state;
    if (layoutChanged) this.arrange();

    const s = this.sound.settings;
    this.master.show(s.master);
    this.music.show(s.music);
    this.effectsLevel.show(s.effects);
    this.mute.show(s.muted);
    this.musicChoice.show(this.musicLabel(s.musicChoice), MUSIC_TRACKS.length + 1);
    this.nowPlaying.show(this.sound.nowPlaying?.title ?? (s.muted ? 'Muted' : 'Between pieces'));
    this.soundPack.show(
      SOUND_PACKS.find((p) => p.id === s.soundPack)?.name ?? s.soundPack,
      SOUND_PACKS.length,
    );
    this.nameRow.show(state.name);

    this.leaveArmedMs = Math.max(0, this.leaveArmedMs - deltaMs);
    this.leave.set(this.leaveArmedMs > 0 ? 'Tap again to leave' : 'Leave match', 'danger');
    this.resume.set(state.inMatch ? 'Back to the game' : 'Close', 'primary');
  }

  // ---------------------------------------------------------------- choices

  private musicLabel(choice: MusicChoice): string {
    if (choice === 'shuffle') return 'Shuffle all';
    return MUSIC_TRACKS.find((t) => t.id === choice)?.title ?? 'Shuffle all';
  }

  /** Shuffle, then each piece in the list's order, round again. */
  private stepMusic(by: -1 | 1): MusicChoice {
    const options: MusicChoice[] = ['shuffle', ...MUSIC_TRACKS.map((t) => t.id)];
    return cycle(options, this.sound.settings.musicChoice, by);
  }

  private stepPack(by: -1 | 1): string {
    return cycle(
      SOUND_PACKS.map((p) => p.id),
      this.sound.settings.soundPack,
      by,
    );
  }

  /** Leaving throws the match away, so it takes two taps. */
  private tapLeave(): void {
    if (this.leaveArmedMs > 0) {
      this.leaveArmedMs = 0;
      this.handlers.onLeaveMatch();
      return;
    }
    this.leaveArmedMs = LEAVE_ARM_MS;
  }

  // ---------------------------------------------------------------- layout

  /**
   * One column upright; two side by side on a short screen, where one column
   * of every row would run off the bottom.
   */
  private arrange(): void {
    const screen = this.layout.screen;
    const twoColumns = this.layout.compact || this.layout.orientation === 'landscape';
    const rowH = this.layout.compact ? 34 : 40;
    const pad = 16;
    const gap = 20;
    const colW = twoColumns
      ? Math.min(330, (screen.width - 24 - pad * 2 - gap) / 2)
      : Math.min(360, screen.width - 24 - pad * 2);
    const panelW = twoColumns ? colW * 2 + gap + pad * 2 : colW + pad * 2;

    const soundRows = 7;
    const inMatch = this.state.inMatch;
    const noteText = !inMatch
      ? ''
      : this.state.paused
        ? 'Paused while the menu is open.'
        : 'Online matches keep running while the menu is open.';
    this.note.text = noteText;
    this.note.style.wordWrapWidth = colW;
    const noteH = noteText ? this.note.height + 8 : 0;

    const heading = 22;
    const soundH = heading + soundRows * rowH;
    const gameH = heading + rowH + noteH + (inMatch ? 42 : 0) + 42 + 22;
    const top = 50;
    const bodyH = twoColumns ? Math.max(soundH, gameH) : soundH + 12 + gameH;
    const panelH = top + bodyH + pad;

    const px = Math.round((screen.width - panelW) / 2);
    const py = Math.round(Math.max(8, (screen.height - panelH) / 2));

    this.scrim.clear();
    this.scrim.rect(0, 0, screen.width, screen.height).fill({ color: UI.background, alpha: 0.78 });
    this.scrim.hitArea = new Rectangle(0, 0, screen.width, screen.height);
    this.panel.clear();
    this.panel
      .roundRect(px, py, panelW, panelH, 12)
      .fill({ color: UI.buildBar })
      .stroke({ width: 1, color: UI.panelEdge });
    this.panel.hitArea = new Rectangle(px, py, panelW, panelH);

    this.title.position.set(px + pad, py + 16);
    this.closeX.place(px + panelW - pad - 34, py + 12, 34, 34);

    const place = (row: { place(x: number, y: number, w: number, h: number): void }, c: Rect) =>
      row.place(c.x, c.y, c.width, c.height);

    // Sound.
    const sx = px + pad;
    let y = py + top;
    this.soundHeading.position.set(sx, y);
    y += heading;
    for (const row of [
      this.master,
      this.music,
      this.effectsLevel,
      this.mute,
      this.musicChoice,
      this.nowPlaying,
      this.soundPack,
    ]) {
      place(row, { x: sx, y, width: colW, height: rowH });
      y += rowH;
    }

    // Game: beside the sound column, or under it.
    const gx = twoColumns ? sx + colW + gap : sx;
    y = twoColumns ? py + top : y + 12;
    this.gameHeading.position.set(gx, y);
    y += heading;
    place(this.nameRow, { x: gx, y, width: colW, height: rowH });
    y += rowH;
    this.note.visible = noteText !== '';
    this.note.position.set(gx, y + 2);
    y += noteH;
    this.leave.visible = inMatch;
    if (inMatch) {
      this.leave.place(gx, y, colW, 36);
      y += 42;
    }
    this.resume.place(gx, y, colW, 36);
    y += 42;
    this.keys.position.set(gx, y + 2);
  }
}

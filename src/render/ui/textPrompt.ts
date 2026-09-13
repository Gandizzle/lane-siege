/**
 * Typing something, on a phone. §17 (M6).
 *
 * WHY THIS IS THE ONE PIECE OF DOM IN THE UI
 *
 * Everything else the player touches is drawn in Pixi, and deliberately so
 * (§14.2: shapes, no assets). Text entry is the exception, and it is not close:
 * a canvas cannot raise the on-screen keyboard, cannot offer autocorrect,
 * cannot show the caret the operating system draws, and cannot be dictated
 * into. Reimplementing those over a canvas gets a keyboard that is wrong in a
 * different way on every device.
 *
 * So a real `<input>` appears over the canvas for as long as it takes to type a
 * name or a room code, and goes away again. It is the whole DOM surface of the
 * game, it is created per use and removed on close, and nothing else depends on
 * it existing.
 *
 * It is deliberately not `prompt()`, which is blocking, unstyleable, suppressed
 * in some mobile browsers entirely, and inside a Capacitor shell (§17, M6)
 * looks like a browser error rather than part of the game.
 */

/** Accepts what was typed, or null if the player backed out. */
export type TextPromptResult = (value: string | null) => void;

export interface TextPromptOptions {
  title: string;
  /** What is in the field when it opens. */
  value?: string;
  placeholder?: string;
  maxLength: number;
  /** Room codes are upper case; names are not. */
  uppercase?: boolean;
  confirmLabel?: string;
}

/** The colours here match palette.ts. Duplicated because that module is Pixi's. */
const STYLE = {
  background: '#11131a',
  panel: '#181c26',
  edge: '#2a3040',
  text: '#dfe4ee',
  muted: '#8b93a5',
  accent: '#56b4e9',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Show the field and resolve with what was typed, or null if it was dismissed.
 *
 * Resolves exactly once however it is closed, which is what lets the caller
 * `await` it without guarding against a second answer.
 */
export function textPrompt(mount: HTMLElement, options: TextPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:fixed',
      'inset:0',
      `background:${STYLE.background}d8`,
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'z-index:10',
      // Above the canvas, which sets `touch-action:none` on its container.
      'touch-action:auto',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      `background:${STYLE.panel}`,
      `border:1px solid ${STYLE.edge}`,
      'border-radius:12px',
      'padding:18px',
      'width:min(320px, calc(100vw - 48px))',
      `font-family:${FONT}`,
      'box-sizing:border-box',
    ].join(';');

    const title = document.createElement('label');
    title.textContent = options.title;
    title.style.cssText = [
      'display:block',
      `color:${STYLE.text}`,
      'font-size:15px',
      'font-weight:700',
      'margin-bottom:12px',
    ].join(';');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = options.value ?? '';
    input.maxLength = options.maxLength;
    if (options.placeholder) input.placeholder = options.placeholder;
    // Off for a room code, which is not a word and must not be corrected into
    // one; left alone for a name, where the player's own keyboard knows best.
    input.autocapitalize = options.uppercase ? 'characters' : 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText = [
      'width:100%',
      'box-sizing:border-box',
      'padding:12px',
      `background:${STYLE.background}`,
      `border:1px solid ${STYLE.edge}`,
      'border-radius:8px',
      `color:${STYLE.text}`,
      'font-size:16px', // Below 16px, iOS zooms the page on focus.
      `font-family:${FONT}`,
      options.uppercase ? 'text-transform:uppercase' : '',
      options.uppercase ? 'letter-spacing:0.2em' : '',
      options.uppercase ? 'text-align:center' : '',
    ]
      .filter(Boolean)
      .join(';');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;margin-top:14px';

    const cancel = button('Cancel', STYLE.panel, STYLE.muted);
    const confirm = button(options.confirmLabel ?? 'OK', STYLE.accent, STYLE.background);
    row.append(cancel, confirm);

    panel.append(title, input, row);
    backdrop.append(panel);
    mount.append(backdrop);

    let settled = false;
    const close = (value: string | null) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      resolve(value);
    };

    confirm.addEventListener('click', () => close(input.value));
    cancel.addEventListener('click', () => close(null));
    // Tapping the darkened area outside the panel backs out, which is what
    // every other dialog on the device does.
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) close(null);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') close(input.value);
      if (event.key === 'Escape') close(null);
    });

    // Focus after the element is in the document, or the keyboard does not
    // come up on Android.
    input.focus();
    input.select();
  });
}

function button(text: string, background: string, colour: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.style.cssText = [
    'flex:1',
    'padding:12px',
    `background:${background}`,
    `border:1px solid ${STYLE.edge}`,
    'border-radius:8px',
    `color:${colour}`,
    'font-size:14px',
    'font-weight:700',
    `font-family:${FONT}`,
    'cursor:pointer',
  ].join(';');
  return element;
}

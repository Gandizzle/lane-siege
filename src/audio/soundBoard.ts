/**
 * `?sounds=1`: a panel over the game for auditioning every sound and piece of
 * music, and trying the settings a real menu will offer.
 *
 * A tool, not a menu. It is plain DOM because it is not part of the game's
 * look, and it drives the engine through exactly the calls a menu would -
 * `configure`, `skipTrack`, `play` - so anything that works here works there.
 */

import { CUES, MUSIC_TRACKS, SOUND_PACKS } from './catalog.ts';
import type { AudioEngine } from './engine.ts';
import type { AudioSettings } from './settings.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Headings for the effect buttons, by the cue's first word. */
const GROUPS: Record<string, string> = {
  attack: 'Blows, by damage type',
  death: 'Deaths',
  fortress: 'Your fortress',
  wave: 'Waves',
  send: 'Sends',
  build: 'Building',
  buy: 'Buying',
  ui: 'Buttons',
  match: 'The end',
  showdown: 'Final Showdown',
};

const BUTTON =
  'margin:2px;padding:6px 8px;border-radius:6px;border:1px solid #3a4150;background:#222938;color:#e8ecf2;font:12px system-ui;cursor:pointer';

export function mountSoundBoard(engine: AudioEngine): void {
  const panel = el(
    'div',
    'position:fixed;top:8px;right:8px;bottom:8px;width:min(340px,calc(100vw - 16px));overflow:auto;z-index:10;' +
      'background:rgba(16,20,28,0.94);border:1px solid #3a4150;border-radius:10px;padding:12px;color:#e8ecf2;font:13px system-ui',
  );
  const header = el(
    'div',
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px',
  );
  header.append(el('strong', 'font-size:15px', 'Sound board'));
  const close = el('button', BUTTON, 'Close');
  close.onclick = () => panel.remove();
  header.append(close);
  panel.append(header);
  panel.append(
    el(
      'div',
      'color:#9aa3b2;margin-bottom:10px',
      'Browsers start silent: the first tap anywhere turns sound on.',
    ),
  );

  const slider = (label: string, key: 'master' | 'music' | 'effects') => {
    const row = el('label', 'display:flex;align-items:center;gap:8px;margin:4px 0');
    row.append(el('span', 'width:60px', label));
    const input = el('input', 'flex:1');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.value = String(engine.settings[key]);
    input.oninput = () =>
      engine.configure({ [key]: Number(input.value) } as Partial<AudioSettings>);
    row.append(input);
    panel.append(row);
  };
  slider('Master', 'master');
  slider('Music', 'music');
  slider('Effects', 'effects');

  const mute = el('label', 'display:flex;align-items:center;gap:8px;margin:6px 0');
  const box = el('input', '');
  box.type = 'checkbox';
  box.checked = engine.settings.muted;
  box.onchange = () => engine.configure({ muted: box.checked });
  mute.append(box, el('span', '', 'Mute (M in the game)'));
  panel.append(mute);

  panel.append(el('div', 'margin:12px 0 4px;font-weight:600', 'Music'));
  const choice = el(
    'select',
    'width:100%;padding:4px;background:#222938;color:#e8ecf2;border:1px solid #3a4150',
  );
  for (const [value, label] of [
    ['shuffle', 'Shuffle the list'],
    ...MUSIC_TRACKS.map((t) => [t.id, t.title] as const),
  ] as const) {
    const option = el('option', '', label);
    option.value = value;
    choice.append(option);
  }
  choice.value = engine.settings.musicChoice;
  choice.onchange = () => engine.configure({ musicChoice: choice.value });
  panel.append(choice);
  const nowPlaying = el('div', 'color:#9aa3b2;margin:6px 0');
  const skip = el('button', BUTTON, 'Next piece');
  skip.onclick = () => engine.skipTrack();
  panel.append(nowPlaying, skip);
  setInterval(() => {
    nowPlaying.textContent = `Now playing: ${engine.nowPlaying?.title ?? '(nothing)'}`;
  }, 500);

  if (SOUND_PACKS.length > 1) {
    panel.append(el('div', 'margin:12px 0 4px;font-weight:600', 'Sound pack'));
    const pack = el(
      'select',
      'width:100%;padding:4px;background:#222938;color:#e8ecf2;border:1px solid #3a4150',
    );
    for (const p of SOUND_PACKS) {
      const option = el('option', '', p.name);
      option.value = p.id;
      pack.append(option);
    }
    pack.value = engine.settings.soundPack;
    pack.onchange = () => engine.configure({ soundPack: pack.value });
    panel.append(pack);
  }

  panel.append(el('div', 'margin:12px 0 4px;font-weight:600', 'Effects'));
  let group = '';
  for (const cue of CUES) {
    const prefix = cue.split('.')[0] ?? '';
    if (prefix !== group) {
      group = prefix;
      panel.append(el('div', 'color:#9aa3b2;margin:6px 0 2px', GROUPS[prefix] ?? prefix));
    }
    const button = el('button', BUTTON, cue);
    button.onclick = () => engine.play(cue);
    panel.append(button);
  }

  document.body.append(panel);
}

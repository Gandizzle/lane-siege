/**
 * A rewarded ad, until there is a real one. PLACEHOLDER.
 *
 * The real thing (the business plan: AdMob through a Capacitor plugin) is a
 * video that some other code shows over the whole app and that says, at the
 * end, whether it was watched. This stands in for it behind the same shape -
 * `show()`, resolving true for a reward - so swapping it for the real one
 * changes this file and nothing that calls it.
 *
 * DOM rather than Pixi for the same reason the real one will be: an ad is not
 * part of the game's picture, it covers it. A countdown, a way to give up
 * that earns nothing, and once the countdown is done, the reward.
 */

/** Anything that can show a rewarded ad. */
export interface RewardedAds {
  /** Show one. True if it was watched to the end and the reward is due. */
  show(): Promise<boolean>;
}

/** The colors here match palette.ts. Duplicated because that module is Pixi's. */
const STYLE = {
  background: '#11131a',
  panel: '#181c26',
  edge: '#2a3040',
  text: '#dfe4ee',
  muted: '#8b93a5',
  xp: '#a98bf5',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export class PlaceholderAds implements RewardedAds {
  constructor(
    private readonly mount: HTMLElement,
    /** How long the stand-in "plays". */
    private readonly seconds = 5,
  ) {}

  show(): Promise<boolean> {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.style.cssText = [
        'position:fixed',
        'inset:0',
        'background:#000000ee',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'z-index:20',
        'touch-action:auto',
        `font-family:${FONT}`,
      ].join(';');

      const panel = document.createElement('div');
      panel.style.cssText = [
        `background:${STYLE.panel}`,
        `border:1px solid ${STYLE.edge}`,
        'border-radius:14px',
        'padding:22px',
        'width:min(320px, calc(100vw - 48px))',
        'box-sizing:border-box',
        'text-align:center',
      ].join(';');

      const tag = document.createElement('div');
      tag.textContent = 'AD · PLACEHOLDER';
      tag.style.cssText = `color:${STYLE.muted};font-size:11px;font-weight:700;letter-spacing:0.12em`;

      const count = document.createElement('div');
      count.style.cssText = `color:${STYLE.xp};font-size:56px;font-weight:700;margin:14px 0 6px`;

      const words = document.createElement('div');
      words.textContent = 'A short video ad will play here.';
      words.style.cssText = `color:${STYLE.text};font-size:14px;margin-bottom:18px`;

      const claim = document.createElement('button');
      claim.type = 'button';
      claim.textContent = 'Claim your XP boost';
      claim.disabled = true;
      claim.style.cssText = [
        'width:100%',
        'padding:12px',
        `background:${STYLE.xp}`,
        `border:1px solid ${STYLE.edge}`,
        'border-radius:8px',
        `color:${STYLE.background}`,
        'font-size:15px',
        'font-weight:700',
        `font-family:${FONT}`,
        'cursor:pointer',
        'opacity:0.4',
      ].join(';');

      const skip = document.createElement('button');
      skip.type = 'button';
      skip.textContent = 'Close without the boost';
      skip.style.cssText = [
        'margin-top:12px',
        'background:none',
        'border:none',
        `color:${STYLE.muted}`,
        'font-size:12px',
        `font-family:${FONT}`,
        'cursor:pointer',
      ].join(';');

      panel.append(tag, count, words, claim, skip);
      backdrop.append(panel);
      this.mount.append(backdrop);

      let left = this.seconds;
      let settled = false;
      const tick = () => {
        count.textContent = left > 0 ? String(left) : '✓';
        if (left <= 0) {
          claim.disabled = false;
          claim.style.opacity = '1';
          words.textContent = 'Thanks for watching.';
        }
      };
      tick();
      const timer = setInterval(() => {
        left -= 1;
        tick();
        if (left <= 0) clearInterval(timer);
      }, 1000);

      const close = (rewarded: boolean) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        backdrop.remove();
        resolve(rewarded);
      };
      claim.addEventListener('click', () => {
        if (!claim.disabled) close(true);
      });
      skip.addEventListener('click', () => close(false));
    });
  }
}

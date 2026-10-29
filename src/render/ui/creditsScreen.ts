/**
 * The credits: who made the game, and everyone who keeps it going - every
 * Founder by number, and every Supporter, each under the name they chose for
 * the credits rather than whatever their phone is called. (data/credits.json;
 * the Founders and Supporters come from the game server, net/playerApi.ts.)
 *
 * From the menu and the Supporter page. A Supporter or a Founder sees their
 * own line at the bottom, and the button to change it (the game's
 * `askCreditName`).
 *
 * The names are other people's typing, checked by the name filter on the way
 * in (server/playerRoutes.ts) and drawn as plain text, never as anything else.
 */

import type { Text } from 'pixi.js';
import creditsJson from '../../../data/credits.json' with { type: 'json' };
import type { Credits } from '../../net/playerApi.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import type { PanelButton } from './menu.ts';
import { Sheet } from './sheet.ts';
import { centreOn, label, wrapped } from './text.ts';

/** What the page shows that nobody chose: data/credits.json. */
export interface CreditsData {
  madeBy: string[];
  thanks: string[];
  sound: string;
  builtWith: string[];
}

export const CREDITS: CreditsData = {
  madeBy: creditsJson.madeBy,
  thanks: creditsJson.thanks,
  sound: creditsJson.sound,
  builtWith: creditsJson.builtWith,
};

/** Where the names from the server stand. */
export type CreditsState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'unreachable' }
  | { kind: 'ready'; credits: Credits };

export interface CreditsHandlers {
  onClose(): void;
  /** A Supporter or a Founder changing their own line. */
  onChangeName(): void;
}

/** "A, B and C". */
export function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export class CreditsScreen extends Sheet {
  private state: CreditsState = { kind: 'loading' };
  /** This player's own line, when they have one to change: their credits name, or '' for none yet. */
  private own: string | null = null;
  private readonly headings: Text[];
  private readonly madeBy: Text;
  private readonly status: Text;
  private readonly founders: Text;
  private readonly supporters: Text;
  private readonly sound: Text;
  private readonly builtWith: Text;
  private readonly thanks: Text;
  private readonly ownLine: Text;
  private readonly change: PanelButton;

  constructor(
    layout: LaneLayout,
    private readonly data: CreditsData,
    private readonly founderRule: { count: number; level: number },
    private readonly handlers: CreditsHandlers,
  ) {
    super(layout, 'Credits', 'Who made the game, and everyone keeping it going', () =>
      handlers.onClose(),
    );
    this.headings = [
      'MADE BY',
      'FOUNDERS',
      'SUPPORTERS',
      'MUSIC AND SOUND',
      'BUILT WITH',
      'THANKS',
    ].map((h) => label(h, 11, UI.textMuted, '700'));
    this.madeBy = wrapped('', 17, UI.text);
    this.madeBy.style.fontWeight = '700';
    this.status = wrapped('', 12, UI.textMuted);
    this.founders = wrapped('', 13, UI.text);
    this.founders.style.lineHeight = 21;
    this.supporters = wrapped('', 13, UI.text);
    this.supporters.style.lineHeight = 21;
    this.sound = wrapped('', 12, UI.textMuted);
    this.builtWith = wrapped('', 12, UI.textMuted);
    this.thanks = wrapped('', 12, UI.text);
    this.ownLine = wrapped('', 12, UI.level);
    this.ownLine.style.fontWeight = '700';
    this.change = this.button('Change the name', () => this.handlers.onChangeName(), 12);
    this.body.addChild(
      ...this.headings,
      this.madeBy,
      this.status,
      this.founders,
      this.supporters,
      this.sound,
      this.builtWith,
      this.thanks,
      this.ownLine,
      this.change,
    );
  }

  /** What the server said, or why it did not. */
  setState(state: CreditsState): void {
    this.state = state;
    if (this.visible) this.arrange();
  }

  /** This player's own line: their credits name ('' for none yet), or null when they have no line to have. */
  setOwn(name: string | null): void {
    this.own = name;
    if (this.visible) this.arrange();
  }

  protected layoutBody(width: number): number {
    const cx = width / 2;
    let y = 4;
    const section = (index: number) => {
      const heading = this.headings[index]!;
      heading.visible = true;
      centreOn(heading, cx, y);
      y += 20;
    };
    const block = (text: Text, gapAfter = 22) => {
      text.style.wordWrapWidth = width - 16;
      text.style.align = 'center';
      centreOn(text, cx, y);
      y += text.height + gapAfter;
    };

    section(0);
    this.madeBy.text = listed(this.data.madeBy);
    block(this.madeBy);

    // The two lists from the server, or why they are not here.
    const ready = this.state.kind === 'ready' ? this.state.credits : null;
    this.status.visible = ready === null;
    this.status.text =
      this.state.kind === 'loading'
        ? 'Asking the server for the Founders and Supporters…'
        : this.state.kind === 'none'
          ? 'This build has no game server, so the Founders and Supporters are not shown.'
          : this.state.kind === 'unreachable'
            ? 'The game server could not be reached, so the Founders and Supporters are not shown.'
            : '';

    section(1);
    if (ready) {
      this.founders.visible = true;
      this.founders.text =
        ready.founders.length === 0
          ? `None yet: the first ${this.founderRule.count} players to reach level ${this.founderRule.level}.`
          : ready.founders.map((f) => `#${f.number}   ${f.name || '(a name to come)'}`).join('\n');
      this.founders.style.fill = ready.founders.length === 0 ? UI.textMuted : UI.text;
      block(this.founders);
    } else {
      this.founders.visible = false;
      block(this.status);
    }

    section(2);
    if (ready) {
      this.supporters.visible = true;
      this.supporters.text =
        ready.supporters.length === 0
          ? 'Nobody yet. Supporter puts your name here.'
          : ready.supporters.map((s) => s.name).join('   ·   ');
      this.supporters.style.fill = ready.supporters.length === 0 ? UI.textMuted : UI.text;
      block(this.supporters);
    } else {
      this.supporters.visible = false;
      y += 4;
    }

    section(3);
    this.sound.text = this.data.sound;
    block(this.sound);

    section(4);
    this.builtWith.text = `${listed(this.data.builtWith)}, with thanks to the people who make them.`;
    block(this.builtWith);

    const thanking = this.data.thanks.length > 0;
    this.headings[5]!.visible = thanking;
    this.thanks.visible = thanking;
    if (thanking) {
      section(5);
      this.thanks.text = this.data.thanks.join('\n');
      block(this.thanks);
    }

    // A Supporter's or a Founder's own line, and the way to change it.
    const own = this.own;
    this.ownLine.visible = own !== null;
    this.change.visible = own !== null;
    if (own !== null) {
      this.ownLine.text = own
        ? `You are in the credits as "${own}".`
        : 'You can be in the credits: choose the name to show.';
      block(this.ownLine, 10);
      this.change.place(width / 4, y, width / 2, 34);
      this.change.set(own ? 'Change the name' : 'Choose a name', own ? 'plain' : 'primary');
      y += 46;
    }
    return y;
  }
}

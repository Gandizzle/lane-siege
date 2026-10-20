/**
 * The Store. PLACEHOLDER: nothing can be bought yet.
 *
 * There is no payment provider and no server to record a purchase, so every
 * button that would take money says so (the game's `onBuy`) - except in the
 * `?progress=test` build, where it grants the item on the device so the rest
 * of the loop, bundles unlocking cosmetics and cosmetics being worn, can be
 * tried. What is real is the shape of it, and the promise it makes in its
 * first line: nothing here changes who wins, and everything can also be
 * earned by playing (the business plan, §3.1).
 *
 * THREE TABS
 *
 *   Featured   the Founder's Pack banner, the other bundles, and a way to
 *              Support. The XP boost's ad is not sold here: it is offered
 *              before a game (ui/boostOffer.ts).
 *   Builders   every builder, shown by its own six units, with the price it
 *              will have and what it costs now: nothing, during early access.
 *   Cosmetics  every cosmetic by slot, with what it costs or how it is earned,
 *              and "coming soon" on the slots the game does not draw yet.
 *
 * Dressed to be looked at: the banner's gold edge carries a glint across it,
 * prices are struck through beside the bundle price, and a discount tag says
 * how much the bundle saves.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { GameData } from '../../data/schema.ts';
import { percent } from '../../progression/award.ts';
import type { Bundle, Cosmetic, CosmeticSlot } from '../../progression/config.ts';
import { howToUnlock } from '../../progression/cosmetics.ts';
import type { ProgressStore } from '../../progression/store.ts';
import type { LaneLayout } from '../layout.ts';
import { UI } from '../palette.ts';
import { PanelButton } from './menu.ts';
import { Sheet } from './sheet.ts';
import { drawChampion, drawCosmeticIcon, drawRoster } from './storeArt.ts';
import { drawBadgeGlyph } from './levelBadge.ts';
import { centreOn, fit, label, wrapped } from './text.ts';

export interface StoreHandlers {
  onClose(): void;
  /** Buy something: a bundle, a builder, a cosmetic. Placeholder (see above). */
  onBuy(itemId: string, name: string): void;
  onSupport(): void;
  onCollection(): void;
}

type Tab = 'featured' | 'builders' | 'cosmetics';
const TABS: { id: Tab; name: string }[] = [
  { id: 'featured', name: 'Featured' },
  { id: 'builders', name: 'Builders' },
  { id: 'cosmetics', name: 'Cosmetics' },
];

/** Struck-through price beside the real one, and what the difference is worth. */
function saving(bundle: Bundle): string | null {
  if (!bundle.was) return null;
  const now = Number(bundle.price.replace(/[^0-9.]/g, ''));
  const was = Number(bundle.was.replace(/[^0-9.]/g, ''));
  if (!(was > now) || !(now > 0)) return null;
  return `-${Math.round((1 - now / was) * 100)}%`;
}

/** A card with a title, a line of words, a price and a button: a bundle, a builder. */
class Card extends Container {
  readonly bg = new Graphics();
  readonly art = new Graphics();
  readonly shine = new Graphics();
  /** The card's own outline, which the glint is clipped to. */
  readonly shineMask = new Graphics();
  readonly title: Text;
  readonly blurb: Text;
  readonly price: Text;
  readonly was: Text;
  readonly strike = new Graphics();
  readonly tag: Text;
  readonly tagBg = new Graphics();
  readonly button: PanelButton;

  constructor(button: PanelButton, titleSize = 15) {
    super();
    this.title = label('', titleSize, UI.text, '700');
    this.blurb = wrapped('', 11, UI.textMuted);
    this.price = label('', 15, UI.level, '700');
    this.was = label('', 11, UI.textMuted, '600');
    this.tag = label('', 10, UI.background, '700');
    this.button = button;
    this.shine.mask = this.shineMask;
    this.addChild(
      this.bg,
      this.art,
      this.shineMask,
      this.shine,
      this.title,
      this.blurb,
      this.price,
      this.was,
      this.strike,
      this.tagBg,
      this.tag,
      this.button,
    );
  }
}

/** A cosmetic in the grid: its picture, its name, and how to get it. */
class CosmeticTile extends Container {
  readonly bg = new Graphics();
  readonly art = new Graphics();
  readonly name_: Text;
  readonly how: Text;
  readonly words: Text;

  constructor(
    readonly cosmetic: Cosmetic,
    onTap: () => void,
  ) {
    super();
    this.name_ = label(cosmetic.name, 11, UI.text, '700');
    this.how = label('', 9, UI.textMuted, '600');
    this.words = label(cosmetic.slot === 'title' ? cosmetic.name : '', 10, UI.level, '700');
    this.addChild(this.bg, this.art, this.words, this.name_, this.how);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onTap);
  }
}

export class StoreScreen extends Sheet {
  private tab: Tab = 'featured';
  private readonly tabButtons: PanelButton[];
  private readonly featured: Card;
  private readonly bundles: Card[];
  private readonly supportCard: Card;
  private readonly builders: { id: string; card: Card }[];
  private readonly slotHeads: { slot: CosmeticSlot; name: Text; soon: Text }[];
  private readonly tiles: CosmeticTile[];
  private readonly collectionLink: PanelButton;
  private clock = 0;
  private bannerBox = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    layout: LaneLayout,
    private readonly data: GameData,
    private readonly progress: ProgressStore,
    private readonly handlers: StoreHandlers,
  ) {
    super(
      layout,
      'Store',
      'Nothing here changes who wins a match, and everything here can also be earned by playing.',
      () => handlers.onClose(),
    );

    this.tabButtons = TABS.map(
      (tab) =>
        new PanelButton(tab.name, () => {
          this.tab = tab.id;
          this.arrange();
        }),
    );
    for (const button of this.tabButtons) this.addChild(button);

    const store = progress.store;
    const [first, ...rest] = [...store.bundles].sort(
      (a, b) => Number(b.featured) - Number(a.featured),
    );
    const buy = (id: string, name: string) => () => this.handlers.onBuy(id, name);

    this.featured = new Card(this.button('', first ? buy(first.id, first.name) : () => {}), 20);
    this.bundles = rest.map((b) => new Card(this.button('', buy(b.id, b.name))));
    this.supportCard = new Card(this.button('Support the game', () => this.handlers.onSupport()));
    this.builders = this.data.units.builders
      .filter((b) => b.complete)
      .map((b) => ({ id: b.id, card: new Card(this.button('', buy(`builder:${b.id}`, b.name))) }));

    this.slotHeads = progress.cosmetics.slots.map((slot) => ({
      slot,
      name: label(slot.name, 12, UI.text, '700'),
      soon: label('Coming soon', 10, UI.xp, '700'),
    }));
    this.tiles = progress.cosmetics.cosmetics.map(
      (c) =>
        new CosmeticTile(c, () => {
          if (!this.tapOk()) return;
          if (c.price !== null && !this.progress.isUnlocked(c)) this.handlers.onBuy(c.id, c.name);
          else this.handlers.onCollection();
        }),
    );
    this.collectionLink = this.button('Your collection', () => this.handlers.onCollection());

    this.body.addChild(
      this.featured,
      ...this.bundles,
      this.supportCard,
      ...this.builders.map((b) => b.card),
      ...this.slotHeads.flatMap((h) => [h.name, h.soon]),
      ...this.tiles,
      this.collectionLink,
    );
  }

  /** Something bought: redraw what it changed. */
  refresh(): void {
    if (this.visible) this.arrange();
  }

  /** The glint across the banner. */
  update(deltaMs: number): void {
    if (!this.visible) return;
    this.clock += deltaMs / 1000;
    const { x, y, w, h } = this.bannerBox;
    const g = this.featured.shine;
    g.clear();
    if (this.tab !== 'featured' || w <= 0) return;
    const sweep = (this.clock % 3.5) / 1.1;
    if (sweep >= 1) return;
    const gx = x - 60 + sweep * (w + 120);
    g.moveTo(gx, y + h)
      .lineTo(gx + 26, y + h)
      .lineTo(gx + 66, y)
      .lineTo(gx + 40, y)
      .closePath()
      .fill({ color: 0xffffff, alpha: 0.08 });
  }

  protected override headerExtra(): number {
    return 34;
  }

  protected override layoutHeaderExtra(x: number, y: number, width: number): void {
    const gap = 6;
    const each = (width - gap * (TABS.length - 1)) / TABS.length;
    TABS.forEach((tab, i) => {
      const button = this.tabButtons[i]!;
      button.place(x + i * (each + gap), y, each, 32);
      button.set(tab.name, tab.id === this.tab ? 'primary' : 'plain');
    });
  }

  protected layoutBody(width: number): number {
    for (const card of [this.featured, ...this.bundles, this.supportCard]) {
      card.visible = this.tab === 'featured';
    }
    for (const { card } of this.builders) card.visible = this.tab === 'builders';
    for (const head of this.slotHeads) {
      head.name.visible = this.tab === 'cosmetics';
      head.soon.visible = this.tab === 'cosmetics';
    }
    for (const tile of this.tiles) tile.visible = this.tab === 'cosmetics';
    this.collectionLink.visible = this.tab === 'cosmetics';

    if (this.tab === 'featured') return this.layoutFeatured(width);
    if (this.tab === 'builders') return this.layoutBuilders(width);
    return this.layoutCosmetics(width);
  }

  // ------------------------------------------------------------- featured

  private layoutFeatured(width: number): number {
    const store = this.progress.store;
    const owned = this.progress.profile.owned;
    const [first, ...rest] = [...store.bundles].sort(
      (a, b) => Number(b.featured) - Number(a.featured),
    );
    let y = 0;
    if (first) {
      y = this.layoutBundle(this.featured, first, 0, y, width, true, owned.includes(first.id));
    }
    rest.forEach((bundle, i) => {
      const card = this.bundles[i];
      if (!card) return;
      y = this.layoutBundle(card, bundle, 0, y + 10, width, false, owned.includes(bundle.id));
    });
    y = this.layoutSupportCard(0, y + 10, width);
    return y;
  }

  private layoutBundle(
    card: Card,
    bundle: Bundle,
    x: number,
    y: number,
    width: number,
    hero: boolean,
    owned: boolean,
  ): number {
    const pad = 14;
    card.title.text = fit(bundle.name, width - pad * 2 - 70, hero ? 20 : 15);
    card.title.position.set(x + pad, y + pad - 2);
    card.blurb.text = bundle.blurb;
    card.blurb.style.wordWrapWidth = width - pad * 2;
    card.blurb.position.set(x + pad, y + pad + (hero ? 26 : 20));

    // As tall as its words need - the data file's blurb can be any length -
    // with the banner's row of art, then the price, under them.
    const wordsEnd = card.blurb.y + card.blurb.height;
    const artY = wordsEnd + 28;
    const priceY = hero ? artY + 32 : wordsEnd + 18;
    const h = priceY + 32 + pad - y;
    card.bg.clear();
    card.bg
      .roundRect(x, y, width, h, 12)
      .fill({ color: hero ? 0x1c1a14 : UI.panel })
      .stroke({ width: hero ? 2 : 1, color: hero ? UI.level : UI.panelEdge });
    card.shineMask.clear();
    if (hero) {
      this.bannerBox = { x, y, w: width, h };
      card.shineMask.roundRect(x, y, width, h, 12).fill({ color: 0xffffff });
    }

    // What is in it: a builder's units for each builder it carries, badges
    // and titles by their own shape.
    card.art.clear();
    if (hero) {
      // Every builder, by the unit it grows into.
      const builders = this.data.units.builders.filter((b) => b.complete);
      const each = (width * 0.62 - pad) / Math.max(1, builders.length);
      builders.forEach((b, i) => {
        drawChampion(card.art, this.data, b.id, x + pad + each * (i + 0.5), artY, 11);
      });
      // And the cosmetics it carries, after them on the same row.
      let cx = x + width * 0.62 + 6;
      for (const id of bundle.cosmetics) {
        const cosmetic = this.progress.cosmetics.cosmetics.find((c) => c.id === id);
        if (!cosmetic || cosmetic.slot === 'title') continue;
        drawCosmeticIcon(card.art, cosmetic, cx + 12, artY, 22);
        cx += 32;
      }
    }

    card.price.text = owned ? 'Owned' : bundle.price;
    card.price.style.fill = owned ? UI.healthGood : UI.level;
    card.price.position.set(x + pad, priceY + 6);
    const off = owned ? null : saving(bundle);
    card.was.text = owned || !bundle.was ? '' : bundle.was;
    card.was.position.set(x + pad + card.price.width + 8, priceY + 10);
    card.strike.clear();
    if (card.was.text) {
      card.strike
        .moveTo(card.was.x - 1, card.was.y + card.was.height / 2)
        .lineTo(card.was.x + card.was.width + 1, card.was.y + card.was.height / 2)
        .stroke({ width: 1.5, color: UI.unaffordable });
    }
    card.tag.text = off ?? '';
    card.tagBg.clear();
    if (off) {
      const tw = card.tag.width + 12;
      card.tagBg.roundRect(x + width - tw - 8, y + 8, tw, 18, 9).fill({ color: UI.support });
      card.tag.position.set(x + width - tw - 2, y + 10);
    }
    const buttonW = Math.min(150, width * 0.45);
    card.button.place(x + width - pad - buttonW, priceY, buttonW, 32);
    card.button.set(
      owned ? 'Owned' : `Get it · ${bundle.price}`,
      owned ? 'plain' : 'primary',
      !owned,
    );
    return y + h;
  }

  private layoutSupportCard(x: number, y: number, width: number): number {
    const card = this.supportCard;
    const pad = 14;
    const supporter = this.progress.profile.supporter;
    card.art.clear();
    drawBadgeGlyph(card.art, 'heart', x + pad + 12, y + pad + 12, 22, UI.support);
    card.title.text = supporter ? 'You are a Supporter' : 'Become a Supporter';
    card.title.style.fill = UI.text;
    card.title.position.set(x + pad + 32, y + pad);
    card.blurb.text = supporter
      ? 'Thank you. Your bonus XP and badge are yours for good.'
      : `The XP boost always on with no ads, +${percent(this.progress.config.supporter.bonus)} XP for good, and a badge by your name.`;
    card.blurb.style.wordWrapWidth = width - pad * 2 - 32;
    card.blurb.position.set(x + pad + 32, y + pad + 22);
    const buttonY = card.blurb.y + card.blurb.height + 8;
    const h = buttonY + 28 + pad - y;
    card.bg.clear();
    card.bg
      .roundRect(x, y, width, h, 12)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: UI.support });
    card.price.text = '';
    card.was.text = '';
    card.strike.clear();
    card.tag.text = '';
    card.tagBg.clear();
    const buttonW = Math.min(170, width * 0.5);
    card.button.place(x + width - pad - buttonW, buttonY, buttonW, 28);
    card.button.set(supporter ? 'See Support' : 'Support the game', 'plain');
    return y + h;
  }

  // ------------------------------------------------------------- builders

  private layoutBuilders(width: number): number {
    const store = this.progress.store;
    let y = 0;
    for (const { id, card } of this.builders) {
      const builder = this.data.units.builders.find((b) => b.id === id)!;
      const pad = 14;
      const h = 104;
      card.bg.clear();
      card.bg
        .roundRect(0, y, width, h, 12)
        .fill({ color: UI.panel })
        .stroke({ width: 1, color: UI.panelEdge });
      card.title.text = builder.name;
      card.title.position.set(pad, y + pad - 2);
      card.blurb.text = '';
      card.art.clear();
      drawRoster(card.art, this.data, id, pad, y + 54, width - pad * 2);
      // The price it will have, struck through, and what it costs today.
      card.was.text = store.builderPrice;
      card.was.position.set(pad, y + h - pad - 14);
      card.strike.clear();
      card.strike
        .moveTo(card.was.x - 1, card.was.y + card.was.height / 2)
        .lineTo(card.was.x + card.was.width + 1, card.was.y + card.was.height / 2)
        .stroke({ width: 1.5, color: UI.unaffordable });
      card.price.text = store.builderNote;
      card.price.style.fill = UI.healthGood;
      card.price.style.fontSize = 12;
      card.price.position.set(pad + card.was.width + 8, y + h - pad - 15);
      card.tag.text = '';
      card.tagBg.clear();
      card.button.place(width - pad - 90, y + pad - 4, 90, 28);
      card.button.set('✓ Owned', 'plain', false);
      y += h + 10;
    }
    return y - 10;
  }

  // ------------------------------------------------------------ cosmetics

  private layoutCosmetics(width: number): number {
    const columns = width >= 380 ? 4 : 3;
    const gap = 8;
    const tileW = (width - gap * (columns - 1)) / columns;
    const tileH = 84;
    let y = 0;
    for (const head of this.slotHeads) {
      head.name.position.set(0, y);
      head.soon.visible = !head.slot.live;
      head.soon.position.set(head.name.width + 8, y + 2);
      y += 22;
      const tiles = this.tiles.filter((t) => t.cosmetic.slot === head.slot.id);
      tiles.forEach((tile, i) => {
        const tx = (i % columns) * (tileW + gap);
        const ty = y + Math.floor(i / columns) * (tileH + gap);
        this.placeTile(tile, tx, ty, tileW, tileH);
      });
      y += Math.ceil(tiles.length / columns) * (tileH + gap) + 8;
    }
    this.collectionLink.place(0, y, width, 36);
    this.collectionLink.set('Switch cosmetics on and off in your Collection', 'plain');
    return y + 36;
  }

  private placeTile(tile: CosmeticTile, x: number, y: number, w: number, h: number): void {
    const c = tile.cosmetic;
    const unlocked = this.progress.isUnlocked(c);
    tile.hitArea = new Rectangle(x, y, w, h);
    tile.bg.clear();
    tile.bg
      .roundRect(x, y, w, h, 10)
      .fill({ color: UI.panel })
      .stroke({ width: 1, color: unlocked ? UI.healthGood : UI.panelEdge });
    tile.art.clear();
    if (c.slot === 'title') {
      tile.words.text = fit(c.name, w - 10, 10);
      centreOn(tile.words, x + w / 2, y + 16);
    } else {
      drawCosmeticIcon(tile.art, c, x + w / 2, y + 24, 26);
    }
    tile.name_.text = fit(c.name, w - 8, 11);
    centreOn(tile.name_, x + w / 2, y + 44);
    tile.how.text = fit(unlocked ? 'Unlocked' : (c.price ?? shortHow(c)), w - 8, 9);
    tile.how.style.fill = unlocked ? UI.healthGood : c.price ? UI.level : UI.textMuted;
    centreOn(tile.how, x + w / 2, y + 62);
  }
}

/** The way to earn a cosmetic with no price, in a few words. */
function shortHow(c: Cosmetic): string {
  if (c.unlock.level !== null) return `Level ${c.unlock.level}`;
  if (c.unlock.supporter) return 'Supporters';
  if (c.unlock.store) return 'In a bundle';
  return howToUnlock(c);
}

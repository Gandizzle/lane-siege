/**
 * The name filter. See nameFilter.ts for where it comes from and what it
 * cannot do.
 *
 * Two lists that pull against each other: names it must refuse however they
 * are disguised, and innocent names with a refused word inside that it must
 * let be - the Scunthorpe problem, and why a library was chosen over a list.
 */

import { describe, expect, it } from 'vitest';
import { nameAllowed } from './nameFilter.ts';

/** The names the filter lets through: a list that must all be refused passes empty. */
const letThrough = (names: string[]) => names.filter((name) => nameAllowed(name));

/** The names the filter refuses: a list that must all be let be passes empty. */
const refused = (names: string[]) => names.filter((name) => !nameAllowed(name));

describe('a name with a refused word in it is refused', () => {
  it('as typed', () => {
    expect(letThrough(['fuck', 'Shit', 'Bitch', 'cunt', 'Whore', 'Faggot', 'Retard'])).toEqual([]);
  });

  it('in leetspeak and symbols', () => {
    expect(letThrough(['sh1t', '$hit', '5h1t', 'b1tch', 'f*ck', 'A$$Hat', '4ss'])).toEqual([]);
  });

  it('with stretched letters or mixed case', () => {
    expect(letThrough(['fuuuuck', 'FuCk', 'sHiT', 'SHIT'])).toEqual([]);
  });

  it('in look-alike, styled or accented letters', () => {
    // Cyrillic ѕ and і; full-width; mathematical bold; an umlaut.
    expect(letThrough(['ѕhіt', 'ｆｕｃｋ', '𝐟𝐮𝐜𝐤', 'fück'])).toEqual([]);
  });

  it('with invisible characters inside', () => {
    // A soft hyphen and a word joiner, neither of which cleanName removes.
    expect(letThrough(['f\u00aduck', 'sh\u2060it'])).toEqual([]);
  });

  it('welded to another word', () => {
    expect(
      letThrough([
        'BigAss',
        'Big_Ass',
        'ShitHead',
        'BullShitter',
        'XxAssxX',
        'NaziKing',
        'dumbass',
      ]),
    ).toEqual([]);
  });

  it('spelled out', () => {
    expect(letThrough(['f u c k', 'f.u.c.k', 'S-H-I-T', 'Big A S S'])).toEqual([]);
  });

  it('including the slurs and hate references added to the library', () => {
    expect(letThrough(['Hitler', 'H1tl3r', 'Nazi', 'Pedo', 'Wetback', 'Spic', 'Gook'])).toEqual([]);
  });
});

describe('an innocent name with a refused word inside is let be', () => {
  it('as one word', () => {
    expect(
      refused([
        'Scunthorpe',
        'Dickens',
        'Cassandra',
        'Assassin',
        'Classic',
        'Grape',
        'Therapist',
        'Hancock',
        'Cockburn',
        'Peacock',
        'Essex',
        'Sussex',
        'Bassist',
        'Analyst',
        'Arsenal',
        'Titan',
        'Sexton',
        'Cumberbatch',
        'Nigel',
        'Spicy',
        'Japan',
        'Pakistan',
        'Raccoon',
      ]),
    ).toEqual([]);
  });

  it('as words welded or spaced', () => {
    expect(
      refused([
        'TheAssassin',
        'TitanSlayer',
        'MassEffect',
        'ClassAct',
        'DanAllen',
        'IanAlbert',
        'SeanAlvarez',
        'Maine Coon',
        'Kung Fu',
        'KungFu',
      ]),
    ).toEqual([]);
  });

  it('in the real names it was found refusing, and now allows', () => {
    expect(
      refused([
        'Annalise',
        'Analía',
        'Anushka',
        'Dickinson',
        'Cummings',
        'Fukushima',
        'Georgy',
        'Jaap',
        'Cockpit',
        'Shiitake',
      ]),
    ).toEqual([]);
  });

  it('in an ordinary player name', () => {
    expect(
      refused([
        'xXSniperXx',
        'NoobMaster69',
        'DarkKnight',
        'Player AB12',
        'José',
        'Zoë',
        'Wei Chen',
        '😀😀',
      ]),
    ).toEqual([]);
  });
});

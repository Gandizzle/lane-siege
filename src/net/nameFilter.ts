/**
 * Whether a name is fit to put on other players' screens. §17 (M6).
 *
 * A LIBRARY, NOT A LIST OF OUR OWN
 *
 * A word filter written from scratch fails in ways other people have already
 * found: the list, the look-alike letters ("ѕhit" in Cyrillic), the leetspeak
 * ("sh1t", "$hit"), the stretched letters ("fuuuck") and the innocent words
 * with a bad one inside (Scunthorpe, Dickens, Assassin) are each a project of
 * their own. `obscenity` (MIT) does all of them, and this is built on it: its
 * English dataset, in which every word comes with the innocent words around it
 * already allowed, and its recommended transformers, which read a disguised
 * word as what it is before matching.
 *
 * WHAT A NAME NEEDS ON TOP
 *
 * The library is built for sentences, where words have spaces between them. A
 * name is the opposite - words welded together, the welds hidden in capitals
 * and underscores - and some words in the dataset only count whole ("ass", but
 * not "class"), so welding one to another hides it. So a name is checked as
 * three readings, and refused if any of them is:
 *
 *   - as typed, folded to plain letters: accents, ligatures, styled letters
 *     ("𝐟𝐮𝐜𝐤", "ｆｕｃｋ") and invisible characters taken off;
 *   - pulled apart where capitals and underscores say words were joined
 *     ("BigAss" and "Big_Ass" read "Big Ass");
 *   - closed up where letters were spaced out to slip past ("f u c k",
 *     "f.u.c.k" read "fuck").
 *
 * The dataset is fitted to names where testing showed it needed to be (`ADDED`,
 * `dataset`, `ALLOWED`). Run over 11,000 first names, 69,000 surnames and
 * 188,000 first and last names welded together ("SeanAllen"), it refuses
 * 0.15%, 0.2% and 0.06% of them, and those really do contain a word on the
 * list - "Dick", "VinceStone" - which only a dictionary could tell apart.
 *
 * WHAT IT CANNOT DO
 *
 * English only, and words only. A name can be offensive in a way no list
 * knows, and a determined player will find a spelling this misses. It is the
 * first line, keeping the obvious off three other people's screens; reporting
 * and muting are the second, and need the server-side accounts this version
 * does not have (identity.ts).
 */

import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from 'obscenity';

/**
 * What is added to the English dataset. In a pattern `|` is a word's edge and
 * `[x]` an optional letter, so `|spic|` is the word alone and not the start of
 * "spicy".
 */
const ADDED = new DataSet<{ originalWord: string }>()
  // Slurs and hate references the dataset does not have, which is where names
  // go wrong most.
  .addPhrase((p) => p.setMetadata({ originalWord: 'hitler' }).addPattern(pattern`hitler`))
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'nazi' })
      .addPattern(pattern`|nazi|`)
      .addPattern(pattern`|nazis|`),
  )
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'pedophile' })
      .addPattern(pattern`p[a]edophil`)
      .addPattern(pattern`|p[a]edo|`)
      .addPattern(pattern`|p[a]edos|`),
  )
  .addPhrase((p) => p.setMetadata({ originalWord: 'molest' }).addPattern(pattern`molest`))
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'coon' })
      .addPattern(pattern`|coon|`)
      .addPattern(pattern`|coons|`)
      .addWhitelistedTerm('maine coon'),
  )
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'spic' })
      .addPattern(pattern`|spic|`)
      .addPattern(pattern`|spics|`),
  )
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'gook' })
      .addPattern(pattern`|gook|`)
      .addPattern(pattern`|gooks|`),
  )
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'paki' })
      .addPattern(pattern`|paki|`)
      .addPattern(pattern`|pakis|`),
  )
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'jap' })
      .addPattern(pattern`|jap|`)
      .addPattern(pattern`|japs|`),
  )
  .addPhrase((p) => p.setMetadata({ originalWord: 'beaner' }).addPattern(pattern`|beaner`))
  .addPhrase((p) => p.setMetadata({ originalWord: 'wetback' }).addPattern(pattern`wetback`))
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'raghead' })
      .addPattern(pattern`raghead`)
      .addPattern(pattern`towelhead`),
  )
  // Compounds of words the dataset only counts whole, so that "badass" goes
  // the way "Bad Ass" already does.
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'ass' })
      .addPattern(pattern`asshole`)
      .addPattern(pattern`dumbass`)
      .addPattern(pattern`jackass`)
      .addPattern(pattern`badass`)
      .addPattern(pattern`fatass`)
      .addPattern(pattern`smartass`)
      .addPattern(pattern`kickass`),
  )
  .addPhrase((p) => p.setMetadata({ originalWord: 'cock' }).addPattern(pattern`cocksuck`))
  // Two of the dataset's words can never match as it writes them: its
  // transformers fold a doubled "z" or "t" to one letter before matching.
  .addPhrase((p) => p.setMetadata({ originalWord: 'jizz' }).addPattern(pattern`|jiz`))
  .addPhrase((p) => p.setMetadata({ originalWord: 'buttplug' }).addPattern(pattern`butplug`))
  // "anal" at the start of a word, in place of the dataset's own (`dataset`).
  .addPhrase((p) =>
    p
      .setMetadata({ originalWord: 'anal' })
      .addPattern(pattern`|anal`)
      .addWhitelistedTerm('analabos')
      .addWhitelistedTerm('analagous')
      .addWhitelistedTerm('analav')
      .addWhitelistedTerm('analy')
      .addWhitelistedTerm('analog')
      // Annalise, Analise, Analía, Analiese.
      .addWhitelistedTerm('annal')
      .addWhitelistedTerm('analis')
      .addWhitelistedTerm('analia')
      .addWhitelistedTerm('analie'),
  );

/**
 * The English dataset, fitted to names.
 *
 * Its "anal" also matches the word welded on after a letter ("danal", "ianal"),
 * and in a name that is "DanAllen", "IanAlvarez" - every first name ending in
 * "-an" welded to a surname starting "Al-", which was nine in ten of the welded
 * names it refused. Here "anal" counts only at the start of a word, the way the
 * dataset counts "ass", and "BigAnal" is still found by pulling it apart.
 */
const dataset = new DataSet<{ originalWord: string }>()
  .addAll(englishDataset)
  .removePhrasesIf((phrase) => phrase.metadata?.originalWord === 'anal')
  .addAll(ADDED);

/**
 * Common names and words the filter refused, found by running it over lists of
 * first names and surnames. A refused word inside one of these is let be.
 */
const ALLOWED = [
  'anush', // Anusha, Anushka
  'cockpit',
  'cumming', // Cumming, Cummings
  'cummins',
  'dickerson',
  'dickinson',
  'dickson',
  'fuku', // Fukuda, Fukushima, Fukuoka
  'georgy',
  'jaap', // Dutch, and "jap" once the double letter is folded
  'shiitake', // the dataset allows "shitake", but folds the double "i" first
];

const built = dataset.build();
const matcher = new RegExpMatcher({
  blacklistedTerms: built.blacklistedTerms,
  whitelistedTerms: [...(built.whitelistedTerms ?? []), ...ALLOWED],
  ...englishRecommendedTransformers,
});

/**
 * Accents, ligatures, styled and full-width letters folded to plain ones, and
 * invisible characters dropped: "ｆüｃｋ" and "f\u00ADuck" become "fuck".
 */
function fold(name: string): string {
  return name.normalize('NFKD').replace(/[\p{M}\p{Cf}]/gu, '');
}

/** "BigAss", "Big_Ass" and "BIGAss" read as "Big Ass". */
function pullApart(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2');
}

/**
 * Whatever separates the pieces of a spaced-out word. Not the symbols leetspeak
 * reads as letters ("$h!t"), which belong to the word.
 */
const GAP = /[^\p{L}\p{N}@$!(|]+/u;

/** "f u c k", "f.u.c.k" and "Big A S S" read as "fuck" and "Big ASS". */
function closeUp(name: string): string {
  let read = '';
  let lastWasLone = false;
  for (const piece of name.split(GAP)) {
    if (!piece) continue;
    const lone = [...piece].length === 1;
    if (read && !(lone && lastWasLone)) read += ' ';
    read += piece;
    lastWasLone = lone;
  }
  return read;
}

/**
 * Whether `name` may be shown to other players. Expects a name already through
 * `cleanName` (identity.ts), and says nothing about one that is empty.
 */
export function nameAllowed(name: string): boolean {
  const folded = fold(name);
  for (const reading of new Set([folded, pullApart(folded), closeUp(folded)])) {
    if (matcher.hasMatch(reading)) return false;
  }
  return true;
}

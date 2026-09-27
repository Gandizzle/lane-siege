# Audio credits

Every file here is listed with who made it and the licence it is used under.
A file without an entry does not ship.

## Made for Lane Siege

Everything currently in this folder was made for the game, from code in the
repository, and is dedicated to the public domain (CC0). Nobody needs crediting
and nothing needs asking.

| Folder       | What                                     | Made by                                                 |
| ------------ | ---------------------------------------- | ------------------------------------------------------- |
| `sfx/synth/` | 23 sound effects, the `synth` sound pack | `src/audio/synth/sfx.ts`, rendered by `npm run audio`   |
| `music/`     | "Hold the Line", "Between Waves"         | `src/audio/synth/music.ts`, rendered by `npm run audio` |

To change one, edit its recipe and run `npm run audio`. The output is
deterministic, so a regenerated file only differs if its recipe did.

## Adding sounds from elsewhere

Free sounds that can go in a game without asking anyone:

- **CC0 (public domain)** - no conditions at all. Kenney (kenney.nl) publishes
  whole CC0 packs of game sound effects and short music jingles; OpenGameArt
  (opengameart.org) and Freesound (freesound.org) both let you filter a search
  to CC0.
- **CC-BY** - free to use, but the author must be credited, in the game's
  credits and in this file. Much of OpenGameArt's music is CC-BY.

Avoid anything marked NC (non-commercial) or ND (no derivatives), and anything
"royalty free" whose licence you have not read: royalty-free is a price, not a
permission.

To add a pack: put the files in their own folder under `sfx/` (say
`sfx/kenney-impact/`), add an entry to `SOUND_PACKS` in `src/audio/catalog.ts`
mapping every cue to its files, and add a section here with the source URL,
the author and the licence. A track is the same, in `music/` and
`MUSIC_TRACKS`.

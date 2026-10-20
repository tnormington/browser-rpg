# Ambient music (HOM-117)

Eight themes, one per place, playing under the ambience beds `sfx.ts` already loops. `src/music.ts` holds the
tables and the player; `sfx.ts` owns the AudioContext and hands it one, so M mutes the music and a death ducks it
along with everything else.

## Why it is generated and not a file

A track long enough that a player does not hear it loop is minutes of audio per region, and eight of those would
weigh more than the rest of the game ships. A key, a mode and four chords per place cost nothing, never reach a
seam, and are tuned here by ear the way the sound table in `sfx.ts` is. What repeats is the chord round; what never
repeats exactly is the line over it, so the ear does not learn a bar and start waiting for it.

## What a theme is

| Part | What it does |
| --- | --- |
| Drone | The root and its fifth, two octaves under the pad, sounding for as long as the place does. |
| Pad | Three notes of a chord, each two oscillators a few cents apart, through a lowpass. Swells over a third of `hold`, dies over the rest, then the next chord of the round. |
| Line | One to three notes of the same scale, `lift` degrees above the pad, struck softly and left to ring. Stepwise, never a leap, every `pace` seconds give or take half. |
| Reverb | One shared convolver on a generated impulse: a stone room, not a hall. |

Nothing has a beat. The pace is in how long a chord is held, because the game is quiet and a pulse would fight it.

## The places

Each is meant to be told from its neighbours inside two chords: no two share both a root and a mode, and the one
that resolves is the one you start in.

| Theme | Key and mode | Reads as |
| --- | --- | --- |
| `hale` | D aeolian | Home. The only round with a major chord in it. |
| `greywater` | E dorian | Travelling. The brightest minor there is, and the quickest round. |
| `saltmarrow` | G lydian | Open water and a lit town; the raised fourth does the lifting. |
| `dunmere` | C phrygian | The fens. A flat second that never settles, and the pad nearly closed. |
| `thornwick` | A aeolian, an octave down | Close, under a canopy. The lowest pad above ground. |
| `barrowdowns` | G half-diminished | Grave country. A flat fifth in every chord, and the sparsest line in the game. |
| `highmoor` | E minor pentatonic | A bare heath. Nothing between the notes, the pad wide open and cold. |
| `cave` | The hollow five | Underground, wherever it is. The lowest and slowest, a line about once a minute. |

Which theme a region plays is `themeFor`, which uses the same rule the ambience beds do (`byRegion`): the region's
own, else - underground - the cave one, else its zone's. That last fallback is why the Grotto Ghostcap, which is
`cave: false` in a dungeon zone, now has a bed and a theme at all; it had neither before.

## Tuning

Everything is a number in `THEMES`. `hold` and `pace` are the pace, `cutoff` is how bright the pad is, `lift` is how
far the line sits above the chords, `vol` is the theme's level - every one of them under the ambience bed it plays
beneath. `FADE`, `REVERB` and `DETUNE` at the foot of the tables are the lot.

## Checking it

- `npm run verify` runs `src/music.test.ts`: every region plays something, every chord names a degree its scale has,
  the line sits above the pad, nothing is loud.
- `node bench/music.mjs` drives the playtest server in real Chromium and reads each theme's level off an analyser
  for a round, so "it plays" and "it is quiet" are measured and not assumed.

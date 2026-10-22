// What an enemy sounds like: the blow it throws, the noise it makes when one lands on it, and the last of it. A wolf, a
// robed raider and a thing made of masonry should not share a throat, so every species resolves to one of five voices and
// the voice carries all four of its sounds. sfx.ts reads it on 'attack', on a 'hit' that landed on an enemy, and on 'kill'.
//
// It lives apart from sfx.ts so the table can be checked without a browser (voices.test.ts), as ambience.ts does. There are
// no new sample files: every voice is built from the CC0 ogg already in assets/audio (LICENSES.md), pitched and layered.
import type { Layer } from './sfx';
import { ENEMY_TYPES } from './sim/data';

export type Voice = 'beast' | 'man' | 'big' | 'shell' | 'stone';

/** The voice each creature rig speaks in. The rig is already the thing's body, so an enemy added on one sounds right unlisted. */
const RIG_VOICE: Record<string, Voice> = { boar: 'beast', pup: 'beast', wolf: 'beast', brute: 'big', hexer: 'man' };
/** The ones their rig gets wrong: a crab and two giants built on the small rigs, and the four things with nothing alive inside them. */
const VOICE: Record<string, Voice> = {
  shore_crab: 'shell',
  gutterhook: 'big', elder_thornback: 'big',
  rune_golem: 'stone', hollow_knight: 'stone', cairn_king: 'stone', ashen_colossus: 'stone',
};
/** A species with neither an entry nor a rig of its own would be a beast; voices.test.ts says none reaches that. */
export const voiceOf = (species: string): Voice =>
  VOICE[species] ?? RIG_VOICE[ENEMY_TYPES[species]?.look?.model ?? species] ?? 'beast';

/**
 * attack: the melee blow leaving it (a bolt is SOUNDS.bolt, shared: every shooter in the game is robed or a boss).
 * cry: what it says when the player's weapon lands — its own group in sfx.ts, so a thing struck twice a second calls out once.
 * hit: the impact of that weapon on it. kill: the last of it.
 */
export interface VoiceSounds { attack: Layer[]; cry: Layer[]; hit: Layer[]; kill: Layer[] }

const FLESH: Layer = { files: ['hit-flesh-1', 'hit-flesh-2', 'hit-flesh-3'], vol: 0.55, jitter: 0.06 };

export const VOICES: Record<Voice, VoiceSounds> = {
  // teeth: a short snap of air, and a yelp pitched well clear of the player's own grunt
  beast: {
    attack: [{ files: ['swing-1', 'swing-2'], vol: 0.32, jitter: 0.12, rate: 1.45 }],
    cry: [{ files: ['hurt-1', 'hurt-2'], vol: 0.4, jitter: 0.08, rate: 1.55 }],
    hit: [FLESH],
    kill: [{ files: ['hurt-1', 'hurt-2'], vol: 0.5, jitter: 0.05, rate: 0.75 }],
  },
  // a man in kit: the swing at its own pitch with a chink of metal a frame behind it, and a grunt under the player's
  man: {
    attack: [{ files: ['swing-1', 'swing-2'], vol: 0.3, jitter: 0.08 }, { files: ['interrupt'], vol: 0.1, jitter: 0.1, rate: 1.7, delay: 0.03 }],
    cry: [{ files: ['hurt-1', 'hurt-2'], vol: 0.42, jitter: 0.06, rate: 0.92 }],
    hit: [FLESH],
    kill: [{ files: ['thud'], vol: 0.55, jitter: 0.06, rate: 1.1 }],
  },
  // weight: a slow sweep with the thud of the body behind it
  big: {
    attack: [{ files: ['swing-1', 'swing-2'], vol: 0.42, jitter: 0.06, rate: 0.55 }, { files: ['thud'], vol: 0.22, jitter: 0.05, rate: 0.7, delay: 0.08 }],
    cry: [{ files: ['hurt-1', 'hurt-2'], vol: 0.5, jitter: 0.05, rate: 0.6 }],
    hit: [{ ...FLESH, jitter: 0.05, rate: 0.7 }],
    kill: [{ files: ['slam'], vol: 0.6, jitter: 0.04, rate: 0.9 }],
  },
  // carapace: a claw snapping shut, and a dry clatter for a cry, because a crab has no voice to make one with
  shell: {
    attack: [{ files: ['mine-1', 'mine-2', 'mine-3'], vol: 0.3, jitter: 0.08, rate: 1.55 }],
    cry: [{ files: ['mine-1', 'mine-2', 'mine-3'], vol: 0.32, jitter: 0.08, rate: 1.3 }],
    hit: [FLESH, { files: ['interrupt'], vol: 0.25, jitter: 0.05, rate: 1.6 }],   // a claw on a shell rides on top of the meat under it
    kill: [{ files: ['slam'], vol: 0.45, jitter: 0.04, rate: 1.5 }],
  },
  // masonry: stone grinding on stone, and a chunk knocked off instead of a cry. Nothing in here is alive to make one.
  stone: {
    attack: [{ files: ['swing-1', 'swing-2'], vol: 0.38, jitter: 0.06, rate: 0.5 }, { files: ['mine-1', 'mine-2', 'mine-3'], vol: 0.22, jitter: 0.06, rate: 0.75, delay: 0.06 }],
    cry: [{ files: ['mine-1', 'mine-2', 'mine-3'], vol: 0.42, jitter: 0.06, rate: 0.8 }],
    hit: [{ files: ['mine-1', 'mine-2', 'mine-3'], vol: 0.5, jitter: 0.05, rate: 0.85 }],
    kill: [{ files: ['slam'], vol: 0.6, jitter: 0.04, rate: 0.7 }],
  },
};

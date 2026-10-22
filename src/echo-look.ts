/**
 * What an Echo looks like (HOM-171, docs/combat-99.md 3.3 and 8): an enemy that is the authored thing respawned at the player's level. The rig, the tells and the
 * spawn point are the original's, so the look is a dye and an edge: one hue per level band, laid over whatever the species already is, and a cold rim light that
 * does not depend on the room being lit. Pure data, no Three.js, so the bands are testable and the sim's later `echo` field has one place to land.
 *
 * What it must not say. Not "special": an Echo is ordinary and a world of them is the late game, so the dye is a wash and the rim is thin, never a halo and never
 * a beam. Not gold: gold is the quest marker's, and warm emissive is the forge's. Not red: red is hostile, and the red ground ring under every enemy stays.
 * Every hue is cold arcane light, and they climb teal, blue, violet, orchid, so the band reads off the colour without the name plate.
 */

export interface EchoBand {
  /** Inclusive level range the band covers. */
  from: number; to: number;
  /** The hue laid over the body and the colour of the rim and the ground dashes. */
  color: number;
}

/** The four bands of docs/combat-99.md 8: 42-55, 56-69, 70-83, 84-99. */
export const ECHO_BANDS: readonly EchoBand[] = [
  { from: 42, to: 55, color: 0x3fb8b0 },
  { from: 56, to: 69, color: 0x4f86e6 },
  { from: 70, to: 83, color: 0x8a5cf0 },
  { from: 84, to: 99, color: 0xcf6ef0 },
];

/** The band an Echo of this level wears, or null below the first. Above the last it keeps the last: a level past 99 is still the top band. */
export function echoBand(level: number): EchoBand | null {
  if (!(level >= ECHO_BANDS[0].from)) return null;
  return ECHO_BANDS.find(b => level <= b.to) ?? ECHO_BANDS[ECHO_BANDS.length - 1];
}

/**
 * The level of an enemy that is an Echo, or null for an authored one. The sim will carry it as `echo` on the enemy (the level it was respawned at); the renderer
 * asks only this, so how the sim stores it is the sim's to settle.
 */
export const echoLevelOf = (e: object): number | null => {
  const level = (e as { echo?: unknown }).echo; // `object`, not a shape with an optional `echo`: the sim's Enemy has no such field yet, and a weak type would refuse it
  return typeof level === 'number' && level >= ECHO_BANDS[0].from ? level : null;
};

/** How much of the body's own colour the band hue replaces: enough to read at play distance, little enough that a wolf is still a wolf. */
export const ECHO_MIX = 0.5;
/** The dye is the band colour darkened to this share before it is mixed in: a pale hide (a boar) dyed with the raw hue goes pastel and reads as a prize, not a copy. The rim carries the bright hue. */
export const ECHO_BODY = 0.55;
/** The idle emissive an Echo rests at, as a share of the band colour: the hostile red-brown an enemy normally rests at is replaced by this, so the dye shows in the dark. */
export const ECHO_GLOW = 0.1;
/** The rim's peak strength, as a multiple of the band colour. It sits under the bloom threshold at rest, so the edge is a line and not a haze. */
export const ECHO_RIM = 0.9;
/** The slow shimmer, 0..1 in strength and a period in seconds: the glow and rim breathe by this much, out of phase from one Echo to the next. */
export const ECHO_SHIMMER = { depth: 0.35, period: 2.6 };

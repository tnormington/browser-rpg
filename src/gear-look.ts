// What a piece of worn gear looks like, as data. Pure: no Three.js, no DOM, so verify can test it headlessly.
//
// The ladder is keyed to ItemDef.tier (the same number that colours drop beams and tooltips); there is no second rarity
// concept. An item with no entry in ITEM_LOOKS gets its tier's rung, so a new item is visible the moment it has a tier.
import { ITEMS } from './sim/items';

export interface Appearance {
  /** Main colour: hide, iron, steel. */
  tint: number;
  /** Secondary colour: straps, guards, visors. */
  trim: number;
  metal: number;
  rough: number;
  /** Cold emissive on the trim parts and the blade; 0 = none. Kept low: the forge, blood and arcane cast stay the loudest things in frame. */
  glow: number;
  glowI: number;
  /**
   * Third colour: the leather and cord a plate piece is strapped with, the fleece on a fur piece, the padding under a
   * helm. Nothing on the ladder is one material all over, and this is what keeps a metal set from reading as one tint.
   * Defaulted per rung in `appearanceOf`, so an entry only states it where the stock strap is wrong.
   */
  accent?: number;
  /**
   * The stone a rung-3-and-up piece is set with: brow of the helm, root of the crest, gorget, knee cops. Defaults to the
   * piece's `glow` hue (so a set's jewels match its seams) and, on a set with no glow, to the warm amber below.
   */
  gem?: number;
  /** Silhouette rung: 1 plain, 2 plated, 3 crested and spiked, 4 horned (the epic set), 5 the legendary frame (horns plus a bespoke form). Geometry reads this, not the tier. */
  rung: number;
  /** Weapon length multiplier. */
  scale: number;
  /** Colour of the motes that drift off the piece; 0 = none. */
  motes: number;
  /** Bespoke silhouette for a named metal or piece, layered on the rung's. Absent = the rung's plain shape. */
  form?: 'adamant' | 'storm' | 'star' | 'greywolf' | 'gutterhook' | 'wolfskin' | 'marsh' | 'thorn' | 'moor' | 'crown';
  /** Weapon width multiplier (default 1): adamant is broad, stormiron narrow. */
  width?: number;
}

/** The strap leather a plate piece is buckled with, and the padding it is worn over: the one warm note on a cold set. */
const STRAP = 0x4a3626;
/** The stone on a set that has no cold seam of its own (copper, bronze, iron): lamp-amber, the one warm jewel. */
const AMBER = 0xd08a2e;

/** Index = tier; tier 0 (materials) is never worn, but is given the common look so nothing can throw. Tier 4 is the reserved epic rung. */
export const TIER_LOOKS: Appearance[] = [
  { tint: 0x8a6a4c, trim: 0x4e3a28, metal: 0.02, rough: 0.95, glow: 0, glowI: 0, rung: 1, scale: 0.9, motes: 0, accent: 0x6b5a40 },
  { tint: 0x8a6a4c, trim: 0x4e3a28, metal: 0.02, rough: 0.95, glow: 0, glowI: 0, rung: 1, scale: 0.9, motes: 0, accent: 0x6b5a40 },
  // Tier 2: raw soldier's iron. Neutral grey and pitted, not the blue-grey the rungs above it are, so the first plate a
  // player wears cannot be mistaken for the steel two rungs up; the straps are the only colour on it.
  { tint: 0x9aa0a2, trim: 0x383c40, metal: 0.42, rough: 0.62, glow: 0, glowI: 0, rung: 2, scale: 1.0, motes: 0, accent: STRAP, gem: AMBER },
  // Metalness stays moderate on purpose: metal is lit only by the sky gradient here, and a high value turns any tint into pale sky.
  // Tier 3: blued steel, darker and colder than the iron under it: the lift comes from silhouette and a faint cold seam, not from paleness.
  { tint: 0x6e8098, trim: 0x2e3a54, metal: 0.45, rough: 0.4, glow: 0x5a8cb8, glowI: 0.35, rung: 3, scale: 1.15, motes: 0x8fb4d4, accent: 0x4a2a26 },
  // Tier 4: hardened steel, the set you smith for yourself (HOM-81). Near-black blue plate with a hard cool sheen, lit by inlays (thin seams,
  // visor slit) and by the polish on its edges rather than by the surface: the same metal as tier 3's drops, worked twice as far.
  { tint: 0x5e6b88, trim: 0x232b3e, metal: 0.4, rough: 0.34, glow: 0x7ab0ff, glowI: 0.6, rung: 4, scale: 1.3, motes: 0xa0c0ff, accent: 0x2e2622 },
  // Tier 5: the generic fallback only. Spectral jade, the one cold hue the ladder has not used (blue is 2 and 4, orange is 3, purple is the beam colour of 4).
  // An item with no entry of its own gets this and the rung-4 frame, which is visibly better than the steel set but is a recolour: every tier-5 SET has an entry below.
  { tint: 0x5e8a82, trim: 0x2c4a46, metal: 0.45, rough: 0.35, glow: 0x3ee0c0, glowI: 0.7, rung: 5, scale: 1.35, motes: 0x6ef0d4, accent: 0x2a2a26 },
  // Tier 6, the end of the ladder (starmetal, and whatever a boss drops above it). Every tier below is a hue; this one is the absence of one: meteoric black plate with a hard sheen and
  // points of cold white light, a star-chart on a night sky. White is the one rarity colour no other tier can be mistaken for, and starmetal's form is a different SHAPE as well, not a recolour.
  { tint: 0x5a6080, trim: 0x9aa0bc, metal: 0.12, rough: 0.45, glow: 0xe8f0ff, glowI: 0.5, rung: 6, scale: 1.5, motes: 0xf0f4ff, form: 'star', accent: 0x1a1c26 },
];

/** Beam, tooltip and border colour for tier 5: TIER_COLORS[5] in sim/items.ts should read this value. */
export const TIER5_COLOR = 0x3ee0c0;
/** And for tier 6: star-white, the one colour the ladder leaves (blue is 2 and 4, orange 3, jade 5). TIER_COLORS[6] in sim/items.ts. */
export const TIER6_COLOR = 0xf2f0ff;

const A: Partial<Appearance> = { tint: 0x58887a, trim: 0x2a4238, metal: 0.3, rough: 0.4, glow: 0x3ee0c0, glowI: 0.5, rung: 5, form: 'adamant', motes: 0x3ee0c0, accent: 0x2b2a24 };
const S: Partial<Appearance> = { tint: 0x8c8aa8, trim: 0x4a4866, metal: 0.05, rough: 0.7, glow: 0xd0c8ff, glowI: 0.45, rung: 5, form: 'storm', motes: 0xd8d0ff, accent: 0x2a2630 };

/** Bronze: cast gold-brown, the yellow step between copper's red and iron's grey. Rung 2 gives it the plate silhouette hide lacks. */
const B: Partial<Appearance> = { tint: 0xb08c42, trim: 0x52412a, metal: 0.4, rough: 0.5, rung: 2, accent: STRAP, gem: AMBER };
/** Copper: redder and duller than bronze, and left on rung 1, so the bottom of the ladder reads as beaten plate rather than plated armour. */
const C: Partial<Appearance> = { tint: 0xbc6632, trim: 0x5e3018, metal: 0.3, rough: 0.7, rung: 1, accent: STRAP };

/** The item-id stems each leather set may be filed under: the sim names Hide and Wolfskin `hide_` / `wolfskin_`, and the bible's "Marsh-hide" is not obviously one word. Both spellings carry the look. */
const LEATHER_STEMS = { marsh: ['marshhide', 'marsh_hide'], thorn: ['thornhide'], moor: ['moorhide'] } as const;
function leatherPair(form: keyof typeof LEATHER_STEMS, look: Partial<Appearance>): Record<string, Partial<Appearance>> {
  return Object.fromEntries(LEATHER_STEMS[form].flatMap(stem => [`${stem}_gloves`, `${stem}_boots`].map(id => [id, look])));
}

/** Per-item overrides, merged over the tier rung. Only where the tier look is not the whole story. */
export const ITEM_LOOKS: Record<string, Partial<Appearance>> = {
  rusty_blade: { tint: 0x8c6446, rough: 1, metal: 0.15, scale: 0.85 }, // pitted rust, dull
  // smelted by the player: still carries the forge's heat in the edge, the one warm cue on the ladder
  forged_blade: { tint: 0xc8bcb0, scale: 1.3, glow: 0xb0602a, glowI: 0.15, motes: 0xff9a3c },
  // steel folded round a Warden shard: brighter than the plate it goes with, so the blade is the first thing the eye lands on
  warden_edge: { tint: 0x9db4d8, rough: 0.18 },

  // Smithed copper, the bottom rung: warm red metal, plain silhouette, so hide, copper and bronze are three readable steps.
  copper_helm: C, copper_chestplate: C, copper_greaves: C,
  copper_sword: { ...C, scale: 0.9 },

  // Smithed bronze, tier 1 but plated: copper-brown metal under iron's grey-blue, no glow. Rung 2 gives it the plate silhouette hide lacks.
  bronze_helm: B, bronze_chestplate: B, bronze_greaves: B,
  bronze_sword: { ...B, scale: 0.95 },

  // Tier 5, two metals that must not read as one. Adamant: dark jade-green, heavy and square, jade seams, a broad short blade. Stormiron: pale
  // matte slate, lean and spiked, white-lilac lightning veins, a long narrow blade. Colour, finish, glow hue AND silhouette all differ.
  adamant_helm: A, adamant_chestplate: A, adamant_greaves: A,
  adamant_blade: { ...A, scale: 1.2, width: 1.7 },
  stormiron_helm: S, stormiron_chestplate: S, stormiron_greaves: S,
  stormiron_blade: { ...S, scale: 1.6, width: 0.7 },
  // Tier 6: starmetal. Black plate, white light, and a shape no other set has: a four-point star hanging over the brow, pinion fans on the shoulders, a star on the back (the read from the
  // camera, which is behind the player), a star-spike for a knee. The blade is the longest on the ladder and dark to the edge, with a white line down it. Crownbreaker is the same metal, grander.
  starmetal_helm: {}, starmetal_chestplate: {}, starmetal_greaves: {},
  starmetal_blade: { scale: 1.75, width: 1.1 },
  crownbreaker: { scale: 2.0, width: 1.5, glowI: 0.6 },
  // Leatherworking, the top of the ladder: hands and feet are the leather's slots, and the sets a player is seen in for hours are not recolours of Hide. Marsh-hide is reeds and mud (fringe and
  // a laced shaft), Thornhide the Thornwood's beasts (thorns round the wrist, a spur at the heel), Moorhide the moor's (a deep fleece, horn toggles). Each has a quiet cold glint on its rung.
  ...leatherPair('marsh', { tint: 0x7c8c5c, trim: 0x4a5638, metal: 0.02, rough: 1, glow: 0x6ef0d4, glowI: 0.3, rung: 3, form: 'marsh', motes: 0 }),
  ...leatherPair('thorn', { tint: 0x6a523c, trim: 0xa89878, metal: 0.05, rough: 0.95, glow: 0x7ab0ff, glowI: 0.45, rung: 4, form: 'thorn', motes: 0x7ab0ff }),
  ...leatherPair('moor', { tint: 0xc2b49a, trim: 0x8a7c66, metal: 0.05, rough: 1, glow: 0xb4dcf0, glowI: 0.4, rung: 5, form: 'moor', motes: 0xb4dcf0 }),
  // named pieces: bespoke by form, each carries one cold glint and no more
  greywolf_hauberk: { tint: 0x6a7078, trim: 0x3e444c, metal: 0.05, rough: 1, glow: 0x6ef0d4, glowI: 0.5, rung: 5, form: 'greywolf' },
  // Leatherworking: two plain materials. Hide is the boar's brown; wolfskin is grey pelt in the Hauberk's colours, furred at the cuffs. Rung 1: no plate, no glow.
  hide_gloves: { rung: 1 }, hide_boots: { rung: 1 },
  wolfskin_gloves: { tint: 0x8c9096, trim: 0x50565e, metal: 0.02, rough: 1, glow: 0, glowI: 0, rung: 1, form: 'wolfskin', motes: 0 },
  wolfskin_boots: { tint: 0x8c9096, trim: 0x50565e, metal: 0.02, rough: 1, glow: 0, glowI: 0, rung: 1, form: 'wolfskin', motes: 0 },
  gutterhooks_cap: { tint: 0x5c7266, trim: 0x34423a, metal: 0.55, rough: 0.7, glow: 0x6ef0d4, glowI: 0.5, rung: 5, form: 'gutterhook' },
  // The Cairn King's circlet: the one head piece that is not a helm, so it is the one that leaves the face bare. Cold grey barrow
  // iron, five points, and the crown's own stone over the brow in the beam colour of the tier that drops it.
  kings_crown: { tint: 0x767c84, trim: 0x3a3e46, metal: 0.5, rough: 0.5, glow: 0x3ee0c0, glowI: 0.5, rung: 5, form: 'crown', gem: 0x3ee0c0, motes: 0x6ef0d4 },
  // The two folded blades at the top of tier 5, each in its town's colour rather than the fallback jade: Marrow's Edge is adamant
  // round bone-white anchor shards, the Rotroot Edge stormiron round heartwood, which is the one green on the ladder.
  marrows_edge: { ...A, scale: 1.35, width: 1.5, tint: 0x6a8c7e, glow: 0xe4ece0, glowI: 0.5, motes: 0xe4ece0 },
  rotroot_edge: { ...S, scale: 1.7, width: 0.8, tint: 0x8a9a86, trim: 0x46562e, glow: 0x6ae08c, glowI: 0.5, motes: 0x6ae08c },
};

export const LOOK_SLOT_ORDER = ['weapon', 'head', 'chest', 'legs', 'hands', 'feet'] as const;

export function tierRung(tier: number): number {
  return Math.max(0, Math.min(TIER_LOOKS.length - 1, Math.floor(tier) || 0));
}

/**
 * The look for an item id. Unknown ids (not in ITEMS) get the common rung rather than throwing.
 * `accent` and `gem` are filled in here rather than on every entry: a set states them only where the stock strap leather
 * or the set's own seam colour is the wrong stone.
 */
export function appearanceOf(id: string): Appearance {
  const def = ITEMS[id];
  const ap = { ...TIER_LOOKS[tierRung(def ? def.tier : 1)], ...ITEM_LOOKS[id] };
  ap.accent ??= ap.metal > 0.2 ? STRAP : ap.trim;   // plate is strapped with leather; a leather piece's own trim is its strap
  ap.gem ??= ap.glow || AMBER;
  return ap;
}


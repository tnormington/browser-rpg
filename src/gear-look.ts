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
  /** Silhouette rung: 1 plain, 2 plated, 3 crested and spiked, 4 horned (the epic set), 5 the legendary frame (horns plus a bespoke form). Geometry reads this, not the tier. */
  rung: number;
  /** Weapon length multiplier. */
  scale: number;
  /** Colour of the motes that drift off the piece; 0 = none. */
  motes: number;
  /** Bespoke silhouette for a named metal or piece, layered on the rung's. Absent = the rung's plain shape. */
  form?: 'adamant' | 'storm' | 'greywolf' | 'gutterhook';
  /** Weapon width multiplier (default 1): adamant is broad, stormiron narrow. */
  width?: number;
}

/** Index = tier; tier 0 (materials) is never worn, but is given the common look so nothing can throw. Tier 4 is the reserved epic rung. */
export const TIER_LOOKS: Appearance[] = [
  { tint: 0x8a6a4c, trim: 0x5a4430, metal: 0.02, rough: 0.95, glow: 0, glowI: 0, rung: 1, scale: 0.9, motes: 0 },
  { tint: 0x8a6a4c, trim: 0x5a4430, metal: 0.02, rough: 0.95, glow: 0, glowI: 0, rung: 1, scale: 0.9, motes: 0 },
  { tint: 0xa8b6c4, trim: 0x59626e, metal: 0.5, rough: 0.5, glow: 0, glowI: 0, rung: 2, scale: 1.0, motes: 0 },
  // Metalness stays moderate on purpose: metal is lit only by the sky gradient here, and a high value turns any tint into pale sky.
  // Tier 3: blued steel, darker than the iron under it: the lift comes from silhouette and a faint cold seam, not from paleness.
  { tint: 0x7c8ca4, trim: 0x44526c, metal: 0.45, rough: 0.4, glow: 0x5a8cb8, glowI: 0.35, rung: 3, scale: 1.15, motes: 0x8fb4d4 },
  // Tier 4: dark mithril. Near-black blue plate with a hard cool sheen, lit by inlays (thin veins, visor slit) rather than by the surface.
  { tint: 0x90a4c6, trim: 0x4a5a7e, metal: 0.4, rough: 0.38, glow: 0x7ab0ff, glowI: 0.6, rung: 4, scale: 1.3, motes: 0xa0c0ff },
  // Tier 5: the generic fallback only. Spectral jade, the one cold hue the ladder has not used (blue is 2 and 4, orange is 3, purple is the beam colour of 4).
  // An item with no entry of its own gets this and the rung-4 frame, which is visibly better than mithril but is a recolour: every tier-5 SET has an entry below.
  { tint: 0x5e8a82, trim: 0x2c4a46, metal: 0.45, rough: 0.35, glow: 0x3ee0c0, glowI: 0.7, rung: 5, scale: 1.35, motes: 0x6ef0d4 },
];

/** Beam, tooltip and border colour for tier 5: TIER_COLORS[5] in sim/items.ts should read this value. */
export const TIER5_COLOR = 0x3ee0c0;

const A: Partial<Appearance> = { tint: 0x58887a, trim: 0x2a4238, metal: 0.3, rough: 0.4, glow: 0x3ee0c0, glowI: 0.5, rung: 5, form: 'adamant', motes: 0x3ee0c0 };
const S: Partial<Appearance> = { tint: 0x8c8aa8, trim: 0x5a5878, metal: 0.05, rough: 0.7, glow: 0xd0c8ff, glowI: 0.45, rung: 5, form: 'storm', motes: 0xd8d0ff };

/** Per-item overrides, merged over the tier rung. Only where the tier look is not the whole story. */
export const ITEM_LOOKS: Record<string, Partial<Appearance>> = {
  rusty_blade: { tint: 0x8c6446, rough: 1, metal: 0.15, scale: 0.85 }, // pitted rust, dull
  // smelted by the player: still carries the forge's heat in the edge, the one warm cue on the ladder
  forged_blade: { tint: 0xc8bcb0, scale: 1.3, glow: 0xb0602a, glowI: 0.15, motes: 0xff9a3c },
  // mithril folded round a Warden shard: brighter than the plate it goes with, so the blade is the first thing the eye lands on
  warden_edge: { tint: 0x9db4d8, rough: 0.18 },

  // Tier 5, two metals that must not read as one. Adamant: dark jade-green, heavy and square, jade seams, a broad short blade. Stormiron: pale
  // matte slate, lean and spiked, white-lilac lightning veins, a long narrow blade. Colour, finish, glow hue AND silhouette all differ.
  adamant_helm: A, adamant_chestplate: A, adamant_greaves: A,
  adamant_blade: { ...A, scale: 1.2, width: 1.7 },
  stormiron_helm: S, stormiron_chestplate: S, stormiron_greaves: S,
  stormiron_blade: { ...S, scale: 1.6, width: 0.7 },
  // named pieces: bespoke by form, each carries one cold glint and no more
  greywolf_hauberk: { tint: 0x6a7078, trim: 0x3e444c, metal: 0.05, rough: 1, glow: 0x6ef0d4, glowI: 0.5, rung: 5, form: 'greywolf' },
  gutterhooks_cap: { tint: 0x5c7266, trim: 0x34423a, metal: 0.55, rough: 0.7, glow: 0x6ef0d4, glowI: 0.5, rung: 5, form: 'gutterhook' },
};

export const LOOK_SLOT_ORDER = ['weapon', 'head', 'chest', 'legs'] as const;

export function tierRung(tier: number): number {
  return Math.max(0, Math.min(TIER_LOOKS.length - 1, Math.floor(tier) || 0));
}

/** The look for an item id. Unknown ids (not in ITEMS) get the common rung rather than throwing. */
export function appearanceOf(id: string): Appearance {
  const def = ITEMS[id];
  return { ...TIER_LOOKS[tierRung(def ? def.tier : 1)], ...ITEM_LOOKS[id] };
}

# Art direction

Derived from the four images in `docs/art-reference/` (HOM-39). Read the images first; this is what they have in common.
Rendered comparisons: `sh bench/art.sh` (frames per reference), `python bench/compare.py <before> <after> <out>` (side-by-side).

## What the references say

- **Light does the work.** One strong key, deep unlit shadow, a warm practical (candles, campfires, forge) pooling against cold dark. Big planes catch light so facets read as form, not noise.
- **Flat colour, few hues per object.** Variation comes from light, never from per-triangle tint. The cave is about five colours.
- **Dark surround.** The frame edge falls to near-black; depth fades to dark, not to a lit haze.
- **Small bright accents on large dark areas.** Runes, fire, candle flames, blue crystals.
- **Silhouette is the character.** Horns, flared pauldrons, cape: readable as a black shape.

## Rules

| | |
| --- | --- |
| Key / fill / rim | Key (moon) `DAY.sun` 4.4, cold. Fill (hemisphere + sky environment) is low, 0.4, so shadows go deep. Rim `DAY.rim` 1.5 from the side opposite the key, so actors keep an edge against dark ground. Tune in `render.ts`; keep key:fill roughly 10:1. |
| Warm | Fire only: forge, braziers, gold. The forge light is the one warm pool and must not clip the building to white (`FORGE_LIGHT`, forge slot `light`). |
| Fog / sky | Horizon and fog `0x222c38`, zenith near black. Fog fades to dark, not a bright haze. |
| Grade | Vignette 0.6 from 0.32, contrast 1.12, cold shadows / warm highlights (`POST.grade`). |
| Emissive | Saturation is for fire, blood and arcane light only. Arcane crystals (`CRYSTALS`) and tier 3+ gear glow are cold blue; neither may out-glow the forge. Emissive stays under the bloom threshold unless it is a beacon (`glow.ts`). |
| Colour | Flat per material. Ground and cave floor are tinted per vertex with low variance; never per triangle. |

## Faceting

Facets are deliberate where the surface is hard: **rock, stone, trees, ore, coal, gems, buildings and gear plates** use flat shading (`FACETED` in `render.ts`; static slots and `gear.ts` in `models.ts`). **Organic skinned bodies** (player, enemies, NPCs) get smoothed normals at a 45 degree crease (`CREASE` in `models.ts`), so a body reads as a body while plates, belts and horns keep edges. The board's original ask ("don't show the polygons") is met on characters and ground; the references show hard facets on rock and armour, so those stay.

## Tier 5 (HOM-47)

- **Colour**: spectral jade `0x3ee0c0` (`TIER5_COLOR`, mirrored in `TIER_COLORS[5]`). Blue is tiers 2 and 4, orange is 3, purple is 4's beam; jade is the cold hue left. Tier 6 should be blood-red or white, not another cool.
- **Tier fallback** (`TIER_LOOKS[5]`) is jade plate on the rung-4 horned frame. It is a recolour of the tier-4 steel set and **must not be what a tier-5 set ships with**. Every tier-5 set and named piece needs an `ITEM_LOOKS` entry with a `form`.
- **Adamant** (`form: 'adamant'`): dark jade, heavy and square. Brow slab, flat ridge, cheek slabs, T of light; slab shoulders, gorget, squared knee guards; broad short blade (width 1.7).
- **Stormiron** (`form: 'storm'`): pale matte slate-lilac, lean and spiked. Fan of swept-back crown spikes, upswept shoulder barbs, dorsal and shin barbs; long narrow blade (width 0.7), lilac-white glow.
- **Greywolf Hauberk** (`greywolf`): two-tier wolfskin mantle with a wolf's head on the left shoulder, cold eyes. **Gutterhook's Cap** (`gutterhook`): salvaged cap with a lashed hook over the brow.
- Item ids the looks key on: `adamant_{helm,chestplate,greaves,blade}`, `stormiron_{...}`, `greywolf_hauberk`, `gutterhooks_cap`. If the sim names them differently, rename the `ITEM_LOOKS` keys. Render with `sh bench/tier5.sh`.

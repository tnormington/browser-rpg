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
| Fog / sky | Horizon and fog `0x222c38`, zenith a deep indigo `0x101a33`. Fog fades to dark, not a bright haze. |
| Sky dome | Everything above the horizon is one shader (`sky.ts`), drawn after the opaque world so it only pays for empty pixels. It is the one place in the frame allowed to be vivid: the aurora is the exception to the emissive rule below, and it takes the arcane family (`P.heal` at the foot, `P.violet` at the top) so it still reads as this world's light. It is a clear-sky thing; `cover` takes it away. Nothing up there may out-glow the forge or compete with an enemy ring for attention: check against `bench/sky.sh`, and against `bench/sky-cost.mjs` for what the dome costs. |
| Grade | Vignette 0.6 from 0.32, contrast 1.12, cold shadows / warm highlights (`POST.grade`). |
| Emissive | Saturation is for fire, blood and arcane light only. Arcane crystals (`CRYSTALS`) and tier 3+ gear glow are cold blue; neither may out-glow the forge. Emissive stays under the bloom threshold unless it is a beacon (`glow.ts`); the glow a light throws is a halo over it, not a hotter material (`halo.ts`). |
| Colour | Flat per material. Ground and cave floor are tinted per vertex with low variance; never per triangle. |
| Surface | Relief, not colour (`surface.ts`). Every material class carries a faint greyscale detail map and a normal map, so the key light has something to catch; the colour under them stays flat. Models are dressed too (`surface` on a `SlotDef`): nothing in the world is a bare flat colour except a light. |

## Faceting

Facets are deliberate where the surface is hard: **rock, stone, trees, ore, coal, gems and buildings** use flat shading (`FACETED` in `render.ts`, static slots in `models.ts`). **Organic skinned bodies** (player, enemies, NPCs) get smoothed normals at a 45 degree crease (`CREASE` in `models.ts`), so a body reads as a body while plates, belts and horns keep edges. The board's original ask ("don't show the polygons") is met on characters and ground; the references show hard facets on rock, so those stay.

**Worn gear is the mixed case** (HOM-137): a piece of armour is some of both, and which part is which is decided by the shape, not by the material. Everything `gear.ts` builds goes through `forge()` -- UVs, a split to non-indexed, then that same 45 degree crease -- so **how many segments a part is built from is the whole of the decision**. A helm bowl, a boot shaft or a glove cuff at eighteen sides shades as rolled metal and worked leather; a six-sided greave (sixty degrees to a facet), a box slab, a four-sided spike and a cut stone keep their edges. A pelt is the exception that proves the rule: a fur ruff and the Greywolf mantle stay at seven sides, because a mantle shaded smooth reads as a cone of stone. The glb helm and pauldrons go through the same door (`fitPiece`) when they are mounted.

## Surface detail (HOM-117)

Every material class gets two generated maps from `src/surface.ts`, shared by every material of that class: a detail
map (greyscale, centred just under white, so it darkens into the hollows and never tints the flat colour) and a
normal map cut from the same height field. Grass and heath, trodden earth, chipped rock, coursed stone, limewash,
lapped slate, sawn board, bark, leaf, ore, coal, hammered metal, forged plate, gem, hide, fur, cloth and skin.
**Only a light has no surface**: `glow`, `beacon` and the unlit ground marks (`dark`).

- **The dials** are `repeat` (tiles per world unit), `relief` (how deep the extrusion reads) and `grime` (how far the
  detail map darkens) in `SURFACES`. The ground's is the faintest of the lot on purpose: it is already tinted per
  vertex and the two must not fight; skin's is next, because a face must not read as orange peel.
- **Relief is a property of the lighting, not of the material** (HOM-137). A figure of merit that reads as chipping on
  flat matte rock does two bad things elsewhere. On anything metallic it breaks a polished highlight into blue and
  orange marbling, because every texel of slope samples a different part of a vivid aurora sky -- so `plate`, the one
  class worn at low roughness and high metalness, has the lowest relief of any hard surface. And on anything round it
  swings a whole stop of shading where it crosses the terminator of a dome, which is why `hide`, `fur`, `cloth` and
  `skin` are all low: they are the classes worn on the round.
- **UVs** are world-unit planar projections off the dominant axis of each face, baked by `bakeUV`. A texel is the
  same size on a cottage wall, a boulder, a knight and the ground, so nothing needs unwrapping and a merged slab's
  parts each keep their own scale. A non-indexed geometry projects per triangle, so no facet carries a seam through
  its middle -- which is right for a slab of facets and wrong for a rolled dome, so `gear.ts` bakes UVs *before* it
  splits. `bakeUV`'s `scale` is for geometry still in a file's own units: a static slot carries its fit already, a
  skinned one takes `bindScale(mesh)` (measured off the bind pose, because a pack may hold the factor in its nodes,
  its bind matrices or both) and a worn glb piece takes the rig scale when `gear.ts` mounts it.
- **Three doors, one rule.** `render.ts mesh()` for primitives and merged slabs, `models.ts` for a glTF slot, and
  `gear.ts` / `mount.ts` for what is built onto a rig. Each bakes the UVs and calls `surface.ts dress()`; a material
  that carries a pack texture of its own keeps it and takes no maps.
- **Models say which class each of their materials is** (`surface` on a `SlotDef`): one class for the slot, or one
  per material name with `*` for the rest. The pine is `bark` and `foliage`, the stump's cut face is sawn `wood`,
  the ore and coal rocks wear their own mineral, the smithy is plaster, timber, coursed stone and tiles, and the
  knight is plate, boots and skin. A slot with no `surface` is drawn in flat colour and keeps its own UVs.
- **Buildings** have three surfaces, not one: `plaster` walls over a `stone` footing under a `roof` of slates.
- **Cost** (bench/run.mjs, 1x): draw calls and triangles unchanged (513 / 387k). The first pass cost about +0.6 ms
  GPU a frame; dressing the models cost +0.7 ms GPU, +0.15 ms a frame and +0.1 s of load, for twelve more textures.
- **Looking at it**: `node bench/surfaces.mjs` stands every model slot on the open road and shoots it close, plus
  two frames at the camera the player actually has. Shots land in `bench/shots/surfaces/`.

## The glow round a light (HOM-117)

A lit emitter is held under the bloom threshold so its colour survives tone mapping (`glow.ts`), which is right for
the lamp and leaves it a flat shape with nothing coming off it. The halo is the other half: a camera-facing disc of
light centred on the flame, additive, falling to nothing at its rim (`halo.ts`). It reads as lit air at any distance
and in either quality setting, and where it lies over the emitter the two together cross the threshold, so the core --
and only the core -- blooms.

- **Every light in the world has one**: torches, lamp posts, lit windows, the forge and the inn's range, the cave's
  braziers, the arcane crystals, the Rotroot's fungus, the Grotto's lanterns, the alembic's fire.
- **The dials** are `color`, `radius` (how far the light carries), `strength` (its peak over the emitter) and
  `flicker` in `HALOS`. The budget is two-sided and `halo.test.ts` holds it: a halo alone must stay under
  `BLOOM_THRESHOLD`, or it is a white disc on the ground; over an emitter at `EMISSIVE_CAP` the two must pass it, or
  nothing blooms at all.
- **A lit prop carries its own** (`halos` on a `Prop`), in the prop's frame, so a torch glows wherever it is stood --
  Hale's gate, a barrow's mouth -- and nothing added later can miss it.
- **Cost** is one draw per slab, per room and per prop: the halos of a slab are merged into one geometry and the
  billboarding is in the vertex shader, so a static, merged mesh still faces the camera. Measured at 1x, against the
  same build with the halos off: +3 draw calls, +126 triangles, +2 shader programs, +0.5 ms a frame.

## Tier 5 (HOM-47)

- **Colour**: spectral jade `0x3ee0c0` (`TIER5_COLOR`, mirrored in `TIER_COLORS[5]`). Blue is tiers 2 and 4, orange is 3, purple is 4's beam; jade is the cold hue left. Tier 6 should be blood-red or white, not another cool.
- **Tier fallback** (`TIER_LOOKS[5]`) is jade plate on the rung-4 horned frame. It is a recolour of the tier-4 steel set and **must not be what a tier-5 set ships with**. Every tier-5 set and named piece needs an `ITEM_LOOKS` entry with a `form`.
- **Adamant** (`form: 'adamant'`): dark jade, heavy and square. Brow slab, flat ridge, cheek slabs, T of light; slab shoulders, gorget, squared knee guards; broad short blade (width 1.7).
- **Stormiron** (`form: 'storm'`): pale matte slate-lilac, lean and spiked. Fan of swept-back crown spikes, upswept shoulder barbs, dorsal and shin barbs; long narrow blade (width 0.7), lilac-white glow.
- **Greywolf Hauberk** (`greywolf`): two-tier wolfskin mantle with a wolf's head on the left shoulder, cold eyes. **Gutterhook's Cap** (`gutterhook`): salvaged cap with a lashed hook over the brow.
- Item ids the looks key on: `adamant_{helm,chestplate,greaves,blade}`, `stormiron_{...}`, `greywolf_hauberk`, `gutterhooks_cap`. If the sim names them differently, rename the `ITEM_LOOKS` keys. Render with `sh bench/tier5.sh`.

## Tier 6, the leather ladder's top and the wave-4 rigs (HOM-109)

- **Tier 6** (`TIER_LOOKS[6]`, `TIER6_COLOR` 0xf2f0ff, mirrored in `TIER_COLORS[6]`): star-white, the one rarity colour the ladder has left (blue 2 and 4, orange 3, jade 5). The fallback is already the star form, so a tier-6 item added without a look is still starmetal-shaped, not a tier-5 recolour.
- **Starmetal** (`form: 'star'`): indigo-black plate, low metal so it reads in the dark (high metalness goes black under a sky-only environment), cold white inlays. A four-point star on a stem over the helm, a fan of three pinions on each shoulder, a star on the back (the camera is behind the player, so this is the read), a lit seam and a trailing blade on each shin. Blade scale 1.75, `crownbreaker` 2.0 and broader. Ids: `starmetal_{helm,chestplate,greaves,blade}`, `crownbreaker`. Render with `node bench/tier6.mjs`.
- **Leather**: gloves and boots are the leather's slots, so each set is its own form. Marsh-hide (`marsh`): reeds hung from the cuff and the boot top, a mud line. Thornhide (`thorn`): bone thorns round the wrist and on the knuckles, a crown of thorns on the boot rim, a heel spur. Moorhide (`moor`): a deep pale fleece cuff, a horn toggle on the hand, a horn toe-cap. Ids `marshhide_` / `marsh_hide_`, `thornhide_`, `moorhide_` + `gloves` / `boots`; if the sim names them otherwise, rename the keys (`LEATHER_STEMS` in `gear-look.ts`).
- **Rigs** (`creatures.ts`, keyed on the bible's ids `ashen_colossus`, `rune_golem`, `archmage_vael`; render with `node bench/creatures.mjs`): the Colossus is width and a broken skyline of snapped columns, with the only warm light in the far country (ember is fire, so it is allowed). The Golem is cut blocks and a ringed rune, to read apart from the Cairn Brute's rubble. Vael is built for distance, because he is judged at the length of the room: a vertical halo of blades behind the head (nothing else has one), a spired hat, a pooling robe and four held shards, with a large violet orb in the hand as the cast tell.

## What a worn piece is made of (HOM-137)

Render every set on the ladder from five angles with `node bench/armour.mjs [set ...]`; shots land in `bench/shots/armour/`. Seating numbers come from `node bench/gearprobe.mjs`, which measures the rig rather than guessing at it.

- **Four materials on a piece of plate, never one.** `Finish` in `gear.ts` -- `plate` the shell in the item's own tint and finish, `trim` the darker secondary, `edge` the polished rim, `strap` matte leather, plus `fur`, `gem` and the glowing `inlay`. `Appearance` carries `accent` (the strap leather) and `gem` (the set stone) alongside `tint` and `trim`; both default per rung in `appearanceOf`, so an entry only states them where the stock ones are wrong. A set that is one tint all over is the thing that reads as plastic.
- **Specularity is where a wearer rubs a piece bright**, and nowhere else: `edge` runs at a third of the shell's roughness and takes the metalness up, and the pauldrons are restyled at half the breast's roughness because they are the part always turned up at the sky. Under a single moon, plate at one roughness has no shape.
- **The hard lines are geometry, not a shader.** Brow band and nasal on every plate helm, a comb over the crown, a ridge and two strapped bands down each greave (both cut from the greave's own cone, so they hug its taper), a rolled lip on each toe cap and knuckle, a gorget and a baldric on every plated chest.
- **Gems and crests from rung 3**: `jewel()` sets a faceted stone in a polished collar -- at the root of the crest, in the gorget under the chin, in each knee cop, in the pommel of any blade above plain steel, and over the brow of the King's Crown. A stone lights up only where the set's `glow` is a cold one; the amber a copper or iron piece falls back to is a polished stone catching the key, not a new family of emissive.
- **The helm covers the head.** `HELM_FIT` and `HELM_LIFT` are measured against the knight's skull (`bench/gearprobe.mjs`), not tuned by eye, and clear it by about 40mm on every axis. Any new helm form multiplies `HELM_FIT`; it does not replace it, or the crown comes through the bowl again.
- **The King's Crown** (`form: 'crown'`) is the one head piece that leaves the face bare: a five-point circlet of barrow iron with the tier's stone over the brow. **Marrow's Edge** and the **Rotroot Edge** carry their towns' colours (bone-white, heartwood green) rather than the tier-5 fallback jade.

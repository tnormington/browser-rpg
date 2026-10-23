# Asset credits

Every model in `assets/models/` is by **Quaternius** (bar the `weapon_*.glb` blades, credited in their own section below)
and released under **CC0 1.0 Universal** (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). Credit is not required; it is given here anyway. Each free pack was
downloaded from its OpenGameArt page, where the licence is listed as CC0; the three paid tiers behind `player.glb` came
from itch.io. In every case the pack's own `License.txt` repeats the CC0 grant, which is what makes committing a file
built from them to a public repository fine. Only the files actually used are committed; the full downloads are not in
the repo.

| File(s) in `assets/models/` | Slot | Source file in the pack | Pack | Source URL | Licence |
|---|---|---|---|---|---|
| `player.glb` | Player | three packs, assembled (see below) | Universal Base Characters, Modular Character Outfits – Fantasy, Universal Animation Library | https://quaternius.itch.io/universal-base-characters · https://quaternius.itch.io/modular-character-outfits-fantasy · https://quaternius.itch.io/universal-animation-library | CC0 |
| `helmet.glb`, `pauldrons.glb`, `sword.glb` | Player armour + weapon | `Helmet1.fbx`, `ShoulderPads.fbx`, `Sword.fbx` | Knight Character | https://opengameart.org/content/lowpoly-animated-knight | CC0 |
| `gear_legs_hide.glb`, `gear_legs_plate.glb`, `gear_feet_hide.glb`, `gear_feet_fine.glb` | Worn legs and feet | `Male_Ranger_Legs`, `Male_Knight_Legs_Armor`, `Male_Ranger_Feet_Boots`, `Male_Noble_Feet` (decimated, one material, `scripts/build-garment.py`) | Modular Character Outfits – Fantasy [Source] | https://quaternius.itch.io/modular-character-outfits-fantasy | CC0 |
| `wizard.glb` | Warden Hale | `Wizard.fbx` | Ultimate Animated Character Pack | https://opengameart.org/content/animated-characters-pack | CC0 |
| `viking.glb` | Cave Brute | `Viking_Male.fbx` | Ultimate Animated Character Pack | https://opengameart.org/content/animated-characters-pack | CC0 |
| `wolf.glb` | Dire Wolf | `Wolf.fbx` | Animal Pack Vol.2 | https://opengameart.org/content/animated-animales-low-poly | CC0 |
| `pig.glb` | Wild Boar (stand-in, see report) | `Pig.fbx` | Farm Animals | https://opengameart.org/content/lowpoly-animated-farm-animal-pack | CC0 |
| `pine.glb`, `stump.glb` | Trees, felled stump | `PineTree_1.fbx`, `TreeStump.fbx` | Ultimate Nature Pack | https://opengameart.org/content/low-poly-nature-pack-1 | CC0 |
| `rock5.glb`, `rock3.glb`, `rock2.glb`, `rock6.glb` | Iron rock, coal seam, cave-mouth rocks, boundary boulders | `Rock_5/3/2/6.fbx` | Ultimate Nature Pack | https://opengameart.org/content/low-poly-nature-pack-1 | CC0 |
| `blacksmith.glb` | Forge | `Blacksmith.fbx` | Medieval Village Pack | https://opengameart.org/content/lowpoly-medieval-village-pack | CC0 |
| `anvil.glb` | Anvil | `Anvil.fbx` | Fantasy Props MegaKit (Standard) | https://opengameart.org/content/fantasy-props-megakit | CC0 |
| `horse.glb` | First mount | `Horse` (shipped as glTF, unmodified) | Quaternius, via Poly Pizza | https://poly.pizza/m/F8HAAcLeBL | CC0 |
| destrier.glb | Second mount | Horse (shipped as glTF, unmodified) | Quaternius, via Poly Pizza | https://poly.pizza/m/qvTrSG9pZF | CC0 |


## Weapons (`weapon_<item id>.glb`)

One blade model per weapon item (HOM-203), each CC0 (confirmed on the source page's licence field, and in KayKit's `License.txt`). Each
was imported into Blender 5.2, turned blade-up with the butt at the origin, its materials folded to the four the game restyles
(`Metal`, `Gold`, `Red`, `Brown`), textures and UVs dropped, and exported as binary glTF. No geometry was edited. The rest of each source pack is not in the repo.

| File in `assets/models/` | Source object | Author / pack | Source URL | Licence |
|---|---|---|---|---|
| `weapon_rusty_blade`, `weapon_forged_blade`, `weapon_marrows_edge`, `weapon_crownbreaker`, `weapon_echo_blade_1`, `weapon_echo_blade_7` | `Sword`, `Sword_2`, `Sword_Golden`, `Claymore`, `Sword_Big`, `Dagger_2` | Quaternius, Medieval Weapons Pack | https://opengameart.org/content/lowpoly-medieval-weapons | CC0 |
| `weapon_copper_sword`, `weapon_adamant_blade`, `weapon_echo_blade_5` | `sword_common`, `sword_uncommon`, `sword_rare` | Kay Lousberg, KayKit Dungeon Pack 1.0 | https://opengameart.org/content/kaykit-dungeon-pack-10 | CC0 |
| `weapon_bronze_sword` | Gladius | LordNeo | https://opengameart.org/content/gladius | CC0 |
| `weapon_iron_sword`, `weapon_warden_edge` | `Sword_0.002`, `Sword_0` | zisongbr, LowPoly Sword pack (6 Swords) | https://opengameart.org/content/lowpoly-sword-pack-6-swords | CC0 |
| `weapon_steel_sword` | Knight's Sword | Teh_Bucket | https://opengameart.org/content/knights-sword | CC0 |
| `weapon_stormiron_blade` | Blue Katana Sword | PagDev | https://opengameart.org/content/blue-katana-sword | CC0 |
| `weapon_rotroot_edge` | Serrated Sword | Sykodev | https://opengameart.org/content/serrated-sword | CC0 |
| `weapon_starmetal_blade` | Long Sword - Knights Trust (one of its two swords) | Quandtum | https://opengameart.org/content/long-sword-%E2%80%93-knights-trust | CC0 |
| `weapon_echo_blade_2` | firstsword | Scribe | https://opengameart.org/content/sword | CC0 |
| `weapon_echo_blade_3` | Short Sword | Lucian Pavel | https://opengameart.org/content/short-sword-0 | CC0 |
| `weapon_echo_blade_4` | Heavy Greatsword | Lucian Pavel | https://opengameart.org/content/heavy-greatsword | CC0 |
| `weapon_echo_blade_6` | Katana | Colorado Stark | https://opengameart.org/content/katana-2 | CC0 |
## Cursors

The mouse cursors in `assets/art/cursors/` are the one piece of `assets/art/` not drawn by the generator: they are
built from **game-icons.net** icons under **CC BY 3.0**, which unlike everything above *requires* the credit. It is in
`assets/art/cursors/LICENSES.md`, written by `scripts/cursor-art.ts` out of the same map it builds the pictures from.

## Processing

Most packs ship FBX; each used file was converted once to binary glTF with FBX2glTF (`npm i fbx2gltf`,
`FBX2glTF --binary --input X.fbx --output X`), unmodified otherwise. The game restyles materials at load time
(`src/models.ts`): colours are pulled into the scene palette, shading is forced flat, and static props are baked into
a single shared geometry. No geometry in those files was edited.

`player.glb` is the exception: it is **built**, by `scripts/build-player.py` in Blender, out of three purchased CC0
packs whose `License.txt` each states CC0 1.0. The three share one 65-joint skeleton, name for name, but not one rest
pose, so the clips are retargeted through Blender's rest-relative pose space rather than copied. What the script does:

- the figure is the **Peasant** set from Modular Character Outfits – Fantasy (body, arms, legs, feet). The pack's
  readme is explicit that the garments *are* the body, so this is what "wearing nothing" renders as;
- the head is cut off the male **Universal Base Character** by vertex weight (the readme: *"only the head of the model
  is required. Using the full body will result in clipping"*), and rides the outfit's armature;
- six clips come from the **Universal Animation Library**, under its own names, of which `Jump` is `Jump_Start` and
  `Jump_Land` laid end to end and baked flat;
- each part is given the material name the game dresses it by, the whole is decimated from 16,730 triangles to 7,838,
  and the 4K maps are scaled to 1024 and written as WebP.

Only the one exported file is committed. The three downloads (~1.2 GB unpacked) stay outside the repo.

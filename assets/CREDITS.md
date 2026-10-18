# Asset credits

Every model in `assets/models/` is by **Quaternius** and released under **CC0 1.0 Universal** (public domain dedication,
https://creativecommons.org/publicdomain/zero/1.0/). Credit is not required; it is given here anyway. Each pack was
downloaded from its OpenGameArt page, where the licence is listed as CC0, and the pack's own `License.txt` repeats it.
Only the files actually used are committed; the full downloads are not in the repo.

| File(s) in `assets/models/` | Slot | Source file in the pack | Pack | Source URL | Licence |
|---|---|---|---|---|---|
| `knight.glb` | Player | `KnightCharacter.fbx` | Knight Character | https://opengameart.org/content/lowpoly-animated-knight | CC0 |
| `helmet.glb`, `pauldrons.glb`, `sword.glb` | Player armour + weapon | `Helmet1.fbx`, `ShoulderPads.fbx`, `Sword.fbx` | Knight Character | https://opengameart.org/content/lowpoly-animated-knight | CC0 |
| `wizard.glb` | Warden Hale | `Wizard.fbx` | Ultimate Animated Character Pack | https://opengameart.org/content/animated-characters-pack | CC0 |
| `viking.glb` | Cave Brute | `Viking_Male.fbx` | Ultimate Animated Character Pack | https://opengameart.org/content/animated-characters-pack | CC0 |
| `wolf.glb` | Dire Wolf | `Wolf.fbx` | Animal Pack Vol.2 | https://opengameart.org/content/animated-animales-low-poly | CC0 |
| `pig.glb` | Wild Boar (stand-in, see report) | `Pig.fbx` | Farm Animals | https://opengameart.org/content/lowpoly-animated-farm-animal-pack | CC0 |
| `pine.glb`, `stump.glb` | Trees, felled stump | `PineTree_1.fbx`, `TreeStump.fbx` | Ultimate Nature Pack | https://opengameart.org/content/low-poly-nature-pack-1 | CC0 |
| `rock5.glb`, `rock3.glb`, `rock2.glb`, `rock6.glb` | Iron rock, coal seam, cave-mouth rocks, boundary boulders | `Rock_5/3/2/6.fbx` | Ultimate Nature Pack | https://opengameart.org/content/low-poly-nature-pack-1 | CC0 |
| `blacksmith.glb` | Forge | `Blacksmith.fbx` | Medieval Village Pack | https://opengameart.org/content/lowpoly-medieval-village-pack | CC0 |
| `anvil.glb` | Anvil | `Anvil.fbx` | Fantasy Props MegaKit (Standard) | https://opengameart.org/content/fantasy-props-megakit | CC0 |


## Processing

The packs ship FBX; each used file was converted once to binary glTF with FBX2glTF (`npm i fbx2gltf`,
`FBX2glTF --binary --input X.fbx --output X`), unmodified otherwise. The game restyles materials at load time
(`src/models.ts`): colours are pulled into the scene palette, shading is forced flat, and static props are baked into
a single shared geometry. No geometry was edited.

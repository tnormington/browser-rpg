# World design

The game gets a world: five towns on a road, a ladder from level 12 to 30 (then 40), a mount, flights you pay gold for, and good loot that is out there rather than down the one cave. This is the whole shape with numbers; waves 2 to 4 build it in pieces. Written the way `docs/art-direction.md` is: opinionated, concrete, buildable.

Every number below was derived, not guessed: the XP curve is `sim/xp.ts`, the combat numbers are `sim/data.ts` and `sim/items.ts`, and the model behind the enemy tables is the GCD-limited Crushing Blow / Strike rotation plus auto-attack, **re-derived from QA's measurement of the real loop (HOM-62, sections 3.3, 3.4 and 3.7)**: the first version of it, at 80 % efficiency, had fights 24 to 35 % too long at levels 10 to 12 (9.3 s measured on the road against 11 to 15 claimed). The model and its limits are in sections 3.4 and 8. **I cannot play the game**: what I could not verify by hand is listed there too.

## The calls

| Open question | Call | Why, in one line |
| --- | --- | --- |
| Town count and professions | **Five settlements**: Hale's Rest (mining, smithing, woodcutting: exists), **Saltmarrow** (fishing, cooking), **Thornwick** (herbalism, alchemy, the first stable), **Highmoor** (leatherworking, the second stable), **the Sundered Spire** (enchanting). Six new skills, ten in all. | Each town teaches things no other does, and the order of towns is the order of the climb. |
| Continuous world vs regions | **Connected regions with gates.** Already commented on the task. | The sim has no spatial index, click-to-move has no pathfinding, the cave already is a room system. |
| Mount gate | **Two mounts** (the board's calls, HOM-43). **First: combat 20, 1,000 gold, from Thornwick's stablemaster, 10 u/s. Second: total level 200, 4,000 gold, from Highmoor's, 13 u/s.** | A literal total of 30 is reached by ordinary play at about combat 10, and the gate of 120 I argued first is now met by the gear ladder alone (HOM-56 makes Mining and Smithing about 41 each by combat 24): section 4 recomputes it. The first mount is gold-gated in practice, so it arrives at the mouth of the Barrowdowns. |
| Flight pricing | **25 gold + 1 gold per 6 world units**, rounded to 5: 175 for the first hop, 190 for most, 385 for the longest. Visit on foot first. An 18 to 35 second ride, and it runs in full: the fare buys the whole ride. | About 13 % of an hour's income at level 12 and 4 % at level 30: a decision early, a convenience late. |
| Ladder to 30 | **152 kills** with all three quests, ~200 without (section 3 shows the arithmetic). The board kept the measured pace (HOM-43: "leave it"). | Inside the 150 to 250 target. **2.2 to 2.6 hours** of kills, quests and roads from combat 11, and **4.2 to 4.7 hours from a new character** once the mining and smithing that keep you on the gear line are counted (section 3.7). |

New *systems* (everything else is data) are listed in section 8; there are ten and each is small.

---

## 1. The map

### 1.1 Layout

North is −z (the Hollow already sits at negative z). The world map is a position per region, used only for the map screen and for pricing flights; **walking never uses it**.

```
                       N
   (-z)                ^
                       |
     Hale's Rest ==Greywater Road==> Saltmarrow         Sundered Spire
     (0,0)           ~800 long       (900,0)             (1900,0)
        |                              ||                    ||
   [the Hollow]                  Dunmere Fens          Cairnwaste (~900)
    cave, L7-11                    ~900 long                  ||
   (north, under                     ||                       ||
    the range)                   Thornwick ==Barrowdowns==> Highmoor
                                 (900,1000)   ~900 long     (1900,1000)
                                                               \
                      the chain, in order of level:           [Cairn Hold]
   Hale -> Saltmarrow -> Thornwick -> Highmoor -> Spire        dungeon, L30-32
```

The towns form one chain, east then south then east then north, so the climb never doubles back: Hale (1 to 11), Greywater Road and Saltmarrow (10 to 17), Dunmere Fens and Thornwick (17 to 24), Barrowdowns and Highmoor (24 to 31), Cairnwaste and the Spire (32 to 40). There are no shortcuts on foot. The flight network is the shortcut.

### 1.2 Regions

Size is the walkable rectangle, centred on the region's own origin (x across, z deep). Levels are the combat levels the content is built for. **Soft** means nothing stops you but the enemies; **hard** is a gate that refuses you, with the reason in a line of NPC dialogue.

| id | Name | Kind | Size | Levels | Gates to (and how) | Wave |
| --- | --- | --- | --- | --- | --- | --- |
| `hale` | Hale's Rest + the Hollow | town + dungeon | 60 x 60 + cave | 1 to 11 | east gate to `greywater` (soft) | exists |
| `greywater` | Greywater Road | wilds | 800 x 120 | 10 to 13 | west `hale`, east `saltmarrow` (soft) | 2 |
| `saltmarrow` | Saltmarrow + the Strand | town + wilds | 140 x 140 | town safe; Strand 14 to 17 | west `greywater`; south `dunmere` (**hard**: combat 16); Grotto door (**hard**: Q4) | 2 |
| `grotto` | The Drowned Grotto | dungeon, 3 rooms | inside `saltmarrow` | 16 to 19 | Captain Marrow in the last room | 3 |
| `dunmere` | Dunmere Fens | wilds | 900 x 140 | 17 to 21 | north `saltmarrow`, south `thornwick` (soft) | 3 |
| `thornwick` | Thornwick + Thornwood | town + wilds | 140 x 140 | town safe; Thornwood 21 to 24 | north `dunmere`; east `barrowdowns` (**hard**: combat 22); Rotroot mouth (**hard**: Q5, combat 22) | 3 |
| `rotroot` | The Rotroot | dungeon, 3 rooms | inside `thornwick` | 24 to 26 | the Rotroot Mother in the last room | 3 |
| `barrowdowns` | Barrowdowns | wilds | 900 x 140 | 25 to 29 | west `thornwick`, east `highmoor` (soft) | 3 |
| `highmoor` | Highmoor + the Moor | town + wilds | 140 x 140 | town safe; Moor 28 to 31 | west `barrowdowns`; north `cairnwaste` (**hard**: Q6); Cairn Hold door (**hard**: combat 29) | 3 |
| `cairnhold` | Cairn Hold | dungeon, 3 rooms | inside `highmoor` | 30 to 32 | the Cairn King in the last room | 3 |
| `cairnwaste` | Cairnwaste | wilds | 900 x 140 | 32 to 36 | south `highmoor`, north `spire` (soft) | 4 |
| `spire` | The Sundered Spire | town + ruins | 140 x 140 | town safe; ruins 36 to 40 | south `cairnwaste`; Vault door (**hard**: Q7, combat 38) | 4 |
| `vault` | The Sundered Vault | dungeon, 3 rooms | inside `spire` | 38 to 41 | Archmage Vael in the last room | 4 |

World-map positions: Hale (0, 0), Saltmarrow (900, 0), Thornwick (900, 1000), Highmoor (1900, 1000), Spire (1900, 0). Road regions are placed between their two towns.

Dungeons are the cave's pattern (rooms of walkable floor that overlap, `CAVE_ROOMS`-style) inside their parent region's frame, not separate regions: `inCave` and `caveRank` generalise to a per-region list of rooms. **No mounts in dungeons.**

### 1.3 Continuous vs connected: connected

Already settled on the task and repeated here because it is the one call everything else leans on.

```ts
interface RegionDef {
  id: string; name: string;
  half: { x: number; z: number };         // walkable rect, centred on 0,0 (Hale: 30 x 30, as WORLD_HALF is today)
  world: { x: number; z: number };        // map position: map screen and flight distance only
  levels: [number, number];
  safe?: { x: number; z: number; r: number }; // enemies never aggro or enter within r of this point (towns)
  gates: { id: string; at: Rect; to: { region: string; gate: string };
           need?: { combat?: number; quest?: QuestId; total?: number; blurb: string } }[];
  rooms?: { name: string; rect: Rect }[]; // dungeon rooms, replacing CAVE_ROOMS
}
```

- A **gate** is a rectangle on a region's edge. Walking into it starts a 0.4 s fade and places the player at the partner gate. A hard gate checks `need` first and says `blurb` instead of firing.
- Only the player's region ticks. Every other region is frozen. On entry, catch up by elapsed time: a dead enemy whose `respawn` has elapsed is alive, a node refills. No simulation of absent regions.
- Enemies, nodes and drops carry a `region` id; ids stay stable per region so saves line up. `SPAWNS`, `ROCKS` etc. become per-region lists.
- Hale's Rest changes by exactly one thing on its map: an **east gate at (30, 8)** (a 6-unit gap in the edge, clear of the tree at (22, 12) and the forge). Nothing else in Hale moves, so every existing check stays green.
- The road regions are corridors with the road down the middle (z = 0) and camps to the sides; **the road is the straight line between the two gates**, so click-to-move never needs routing outdoors beyond what it already does round rocks.

### 1.4 What each region is for

- **Greywater Road**: the first time the player is *away*. Wolves and bandits, a toll camp on the road, a rare wolf. And, since HOM-57, a reason to walk it: **the Waysides**, seven stands of ore and trees, one in every hundred units of road bar the toll camp's, alternating sides, nine to eleven units off the road and well clear of every camp's aggro (region `wayside`, listed last so no older node id moved). Since **HOM-77** the stands carry the whole metal ladder above copper, and the ladder climbs with the road: tin and iron at the first stand past Hale's gate, coal from the second on, the richest at the Saltmarrow end, with copper and trees kept along it for the errand below. Hale itself has copper and nothing else, so the first bronze bar is already a walk east. The errand that uses them is **Timber and Copper for Saltmarrow** (`fourth` in the quest state): asked of Warden Hale as an extra line on his dialogue at any time, a level-1 character can take it before ever going east; cut 6 Logs and mine 6 Copper Ore on the road, hand them in to Harbourmaster Pell for 150 Woodcutting and 150 Mining XP. Pure gather, no kills: every road enemy is level 10 to 12. Beside the story chains, not in them: it never locks and never gates anything. Out past Hale's wall the tracker follows it.
- **Saltmarrow Strand**: the sea. Crabs, drowned sailors, a hag in the marsh; the Grotto's door in a cliff; adamant veins in the cliffs.
- **Dunmere Fens**: wet, ranged, hazardous: the first region where standing still hurts (Withering Ground everywhere). Fenbloom grows here.
- **Thornwood**: dense; hard-hitting boars, a cult in the Rotroot. Herb patches and thornoak trees.
- **Barrowdowns**: open grave country; wights and hounds; stormiron in the barrows.
- **Highmoor Moor**: highland; rams and ogres; the stables.
- **Cairnwaste and the Spire** (wave 4): see 3.4.

---

## 2. The towns and what they teach

### 2.1 Services every town has

A town is a **safe region** (`safe` radius ~35 around the square: no spawns, no aggro, and enemies that leash into it reset). Each has: a **flight master** (section 5), a **vendor** (stock below), one **quest giver**, and its professions' **stations**. Hale already has a vendor, quest giver and forge, so it only gains a flight master.

| Town | Teaches | Stations (data: `LANDMARKS`-style per region) | Trainer (abilities, gold) | Vendor adds |
| --- | --- | --- | --- | --- |
| Hale's Rest | mining, smithing, woodcutting | forge | none | unchanged |
| Saltmarrow | **fishing, cooking** | cooking range (the inn, "The Gilded Gull") | Whirlwind 120 g, Rupture 200 g | vials, sea salt |
| Thornwick | **herbalism, alchemy** | alembic bench, **stablemaster (first mount, section 4)** | Guard 350 g | vials |
| Highmoor | **leatherworking** | tanning rack, **stablemaster (second mount, section 4)** | Colossus Blow 500 g, Last Stand 750 g | nothing: leatherworking is self-supplied |
| Sundered Spire | **enchanting** | rune circle | none (talent tiers cover it) | nothing |

The vendor in each town sells the previous tier's dropped gear at the existing `BUY_MARKUP` and never a crafting input except vials (vial value 1, bought for 4; a potion must never sell for more than its herb value plus 4, which the existing no-arbitrage check enforces if the recipe is added to it).

### 2.2 The new skills

All six are `SkillId` entries and `XpTrack`s on the shared curve. Gathering skills are `NODE_TYPES` entries (data in `gathering.ts`); crafting skills are `RECIPES` entries (data in `crafting.ts`). **The one structural change is that a recipe names a `station`** (`'forge' | 'range' | 'alembic' | 'rack' | 'circle'`, default `'forge'`) and `nearForge` becomes `nearStation(s, r.station)`. Mastery (`sim/mastery.ts`) applies to all of them unchanged: more levels above the requirement means quicker and, for stackables, a bonus yield.

**XP rules of thumb** (so a builder can add a rung without asking): a gathering action gives `0.42 x cost(L)` XP, where `cost(L)` is the XP from level L to L+1 (this reproduces iron 35 and mithril 80 to within a few percent); a craft gives `0.6 x cost(L)`, rounded to 5, because it consumes gathered stock. **The metal ladder is the exception, on purpose** (HOM-56, see 2.3): ore pays `0.12 x cost(L)`, a bar `0.25 x`, an armour piece `0.35 x`, a blade `0.4 x`, so a level of Mining or Smithing there takes about 8 to 17 swings, not 2.4. Fishing, cooking and the skills still to come keep the rule above. Raw material value is `2 + L` gold. Time per gather 3 to 5 s, 3 to 5 charges, 20 to 45 s respawn, like the nodes already there.

#### Fishing (Saltmarrow) — gathering, no tool

What the player does: click a fishing spot on the quay or shore, stand, get fish. A spot has 5 charges and refills after 20 s. It yields **raw fish** that only cooking turns into anything. Fish are never dropped by enemies.

| Fish | Level | Spot | XP / catch | Value |
| --- | --- | --- | --- | --- |
| Silverfin | 1 | the quay | 35 | 3 |
| Brine Trout | 8 | the shallows past the quay | 71 | 10 |
| Saltpike | 16 | wreck pools on the Strand | 155 | 18 |
| Redgill | 24 | Thornwood streams (a reason to fish again later) | 342 | 26 |
| Ghost Eel | 32 | the Cairnwaste tarns | 752 | 34 |
| Stormtuna | 40 | the Spire's reflecting pools | 1,658 | 42 |

Base catch time is 4 s. It needs a bag slot; a full bag stops it, as mining does.

#### Cooking (Saltmarrow) — crafting at the range

Cook raw fish into **food** at the cooking range. Cooking level equals the fish's level.

| Dish | Cooking | Inputs | Heals | XP | Time |
| --- | --- | --- | --- | --- | --- |
| Silverfin, cooked | 1 | 1 raw | 15 % max HP | 50 | 3 s |
| Trout, cooked | 8 | 1 raw | 20 % | 100 | 3 s |
| Saltpike, cooked | 16 | 1 raw | 25 % | 220 | 4 s |
| Redgill, cooked | 24 | 1 raw | 30 % | 490 | 4 s |
| Ghost Eel, cooked | 32 | 1 raw | 35 % | 1,075 | 5 s |
| Stormtuna, cooked | 40 | 1 raw | 40 % | 2,370 | 5 s |
| Fish Pie (a "meal") | fish level + 2 | 2 raw of that fish + 1 sea salt (bought, 6 g) | the dish's heal, plus **Well Fed** | craft xp x 1.5 | 6 s |

**What cooking feeds: survival, and what you stand to lose when you die.**
- **Food** is eaten in or out of combat. It is a 5-second heal over time (not instant), **breaks if you are hit**, and shares one **20 s cooldown** with every other food. It is a second self-heal that costs a bag slot, not a rotation button: Second Wind (45 x power, 20 s) is about 105 HP at level 20; a Saltpike is 25 % of 385 = 96 HP on the same clock. A player with both roughly doubles their sustain, which is what the numbers in section 3 assume.
- **Well Fed** (meals only; eaten out of combat): +10 % max health for 20 minutes. **It is lost on death.** It is the stake the death rule (below) puts a price on.
- **Death has to cost something you feel, and it costs two things, not a fee** (HOM-58; the board: "Dying should damage durability of gear, and require a run back from the graveyard"). (1) **Durability.** Every worn piece loses 25 of its 100 points (`DEATH_WEAR` of `MAX_DURABILITY`). At 0 a piece stays on and gives nothing until it is mended; nothing is ever destroyed. Ordinary combat wears nothing: dying is the price, and a maintenance tax on every fight would nag rather than stake. Wear is kept per item, so taking a broken piece off and putting it on again mends nothing. A merchant (Brannoch, Tam Brine) mends everything you carry for `REPAIR_FRAC` (a quarter) of each piece's value, scaled by how worn it is: a mithril set and Warden's Edge (820 value) is about 205 gold from broken and about 51 for one death, against a 175-gold flight. If you cannot pay for every piece, the ones you can are mended, worn pieces first. (2) **The run back.** You wake, healed, at the **graveyard** of the nearest town (by distance from the graveyard) whose flight master you have found, and walk back to where you fell. Hale's is in the clearing's north-west corner, (-20, 26); Saltmarrow's is at the road's end by the west gate, 62 west of the square's centre. Each is a 6-unit safe circle ringed with headstones, and each is 25+ units from the town's wake point, so it is never the town square. The run is about 30 to 50 paces from the clearing's boars, about 110 from the Warden's hall and about 100 from the Barnacle Ogre. Well Fed and every potion buff are cleared. **The gold toll is retired**: death takes no gold and no item. The death overlay and the log name the gear that wore down and the length of the run. Saves: durability is stored by item id, and a save from before it loads every piece whole.

#### Herbalism (Thornwick) — gathering, no tool

Click a herb patch (3 charges, 3 s). Herbs grow where they would: the high ones only far from the town that teaches them, which is what makes it worth walking.

| Herb | Level | Where | XP | Value |
| --- | --- | --- | --- | --- |
| Marrowleaf | 1 | Thornwick's own garden, Greywater verges | 35 | 3 |
| Fenbloom | 10 | Dunmere Fens | 86 | 12 |
| Thornmint | 18 | Thornwood | 189 | 20 |
| Sunpetal | 26 | Barrowdowns | 416 | 28 |
| Ghostcap | 34 | Drowned Grotto and Cairn Hold (dungeon-only) | 916 | 36 |
| Dragonroot | 42 | Cairnwaste ridges | 2,020 | 44 |

#### Alchemy (Thornwick) — crafting at the alembic

Herb + empty vial (the vendor sells them) makes a **potion**. Alchemy level equals the herb's level. Potions are **off the global cooldown, usable in combat, and share one 45 s potion cooldown**.

| Potion | Alchemy | Herb | Effect | XP |
| --- | --- | --- | --- | --- |
| Healing Draught | 1 | Marrowleaf | instantly heals 30 % max HP | 50 |
| Draught of Vigour | 10 | Fenbloom | restores 60 energy | 120 |
| Stoneskin | 18 | Thornmint | +20 % damage reduction for 20 s (stacks additively with armour, under the 75 % cap) | 270 |
| Draught of Fury | 26 | Sunpetal | +15 % damage for 20 s | 595 |
| Greater Healing | 34 | Ghostcap | instantly heals 50 % max HP | 1,310 |
| Titan's Elixir | 42 | Dragonroot | +25 % max HP and +15 % damage for 30 s | 2,885 |

What alchemy feeds is **consumables**, and specifically the boss fights: the bosses in section 3 are meant to be won with them: a boss fight costs about all of a player's health, so a potion on the right slam is the difference. I have not been able to test that intent against a real player.

#### Leatherworking (Highmoor) — crafting at the tanning rack

Tan hides into leather, then make **gloves and boots**. This is the one profession that needs **two new equipment slots**, `hands` and `feet`; the smith still makes the other four. It uses hides the player has been carrying since level 1 (`boar_hide`, `wolf_pelt` finally have a use), so arriving at Highmoor with a full bag is a moment.

| Set | Leatherworking | Materials | Gloves / boots armour | Tier |
| --- | --- | --- | --- | --- |
| Hide | 1 | boar hide | 2 / 3 | 1 |
| Wolfskin | 10 | wolf pelt | 5 / 7 | 2 |
| Marsh-hide | 18 | Saltmarrow and Fen hides | 8 / 10 | 3 |
| Thornhide | 26 | Thornwood and Barrow hides | 11 / 14 | 4 |
| Moorhide | 34 | Moor and Cairnwaste hides | 15 / 18 | 5 |

A pair adds about 15 % to the armour of the set it sits beside. Every enemy table in section 3 is tuned to the four-slot line, so a player in a full six-slot kit is roughly 10 to 20 % ahead of the curve; that is the reward for the extra profession.

**Art obligation (standing rule):** two new slots means two new worn looks per tier, from 3D Artist. Until they exist, `hands` and `feet` do not ship: see wave 3b.

#### Enchanting (the Spire) — crafting at the rune circle, wave 4

You **disenchant** any equippable of tier 2 or above (at the circle; it destroys the item) into **arcane dust**, in proportion to its value (value / 10, at least 1), and spend dust and rare crystals on **slot enchants**. A slot enchant belongs to the *slot*, not the item: it keeps working when you change your sword. That avoids per-item instance data, which the inventory does not have (`ItemStack` is `{ id, qty }`). It also finally gives the bag of junk gear a use beyond the vendor.

| Enchant | Slot | Enchanting | Effect | Dust |
| --- | --- | --- | --- | --- |
| Keen | weapon | 36 | +3 % crit | 40 |
| Vigour | weapon | 38 | +1 energy/s | 80 |
| Warding | any armour | 36 | +4 armour | 25 |
| Vitality | chest | 40 | +6 % max HP | 60 |

What enchanting feeds is **gear** and the long tail, not ability unlocks. Abilities are bought from trainers with gold (section 3.5), which is a better sink and a better reason to visit each town. Enchants are consumed when overwritten.

### 2.3 What stays in Hale's Rest

Mining and smithing run a **metal ladder** that starts at the bottom of the world, the way WoW's does: copper from level 1, tin smelted with it into bronze, then iron and steel, mithril, adamant. It was too short: the first ladder gave a level in under three swings (`0.42 x cost(L)`), so a player went from the first rock to adamant in about 50 swings, five minutes, and no step was worn long enough to feel like anything. The ladder is now longer in the two ways that matter, more rungs at the bottom and **about 6 to 8 times the swings between rungs**:

| Rock (`NODE_TYPES`) | Mining | XP a swing | Smelts into | Smithing: bar | Smithing: pieces |
| --- | --- | --- | --- | --- | --- |
| Copper Rock | 1 | 10 | Copper Bar (2 copper), Bronze Bar (1 copper + 1 tin) | copper 1, bronze 1 | copper: sword 1, helm 1, greaves 2, chestplate 3; bronze: sword 2, helm 3, greaves 4, chestplate 5 |
| Tin Rock | 3 | 12 | (with copper) | | |
| Iron Rock | 7 | 18 | Iron Bar (2 ore), Steel Bar (iron bar + 2 coal) | iron 7, steel 8 | Forgemaster's Blade 9 |
| Coal Seam | 10 | 24 | (the fuel, from here on) | | |
| Mithril Vein | 18 | 54 | Mithril Bar (1 ore + 2 coal) | 15 | helm 16, greaves 17, chestplate 18, Warden's Edge 20 |
| Adamant Vein | 28 | 145 | Adamant Bar (1 ore + 3 coal) | 24 | helm 25, blade 26, greaves 27, chestplate 29 |

**Levels in each tier** (Smithing, from a tier's bar to the next tier's bar): bronze 6, iron and steel 8, mithril 9, adamant 6 and on. **Swings** (Mining, mining the best rock open): Mining 7, where iron opens, is about 65 swings in; mithril at 18 is about 185 (it was 22 to Mining 9); adamant at 28 is about 320 (it was 49 to Mining 17). That is 6 to 8 times the swings at every rung. The chain as a whole is about 3 times longer, because fighting and walking did not move: a headless bot that never idles takes **11 minutes** from the first swing to the Forgemaster's Blade (it took 4), has the mithril set smithed at **28 minutes** (12), and hands in the second quest at **32** (18). A real player is slower than the bot. Mining and Smithing climb together if you smelt what you mine (a bar is about 0.25 x cost, ore about 0.12 x, and a bar eats one to two swings), so a character who uses the forge is never more than a few bars short of a gate; the **bronze set** (armour 3 / 6 / 4 = 13, Bronze Sword +3, tier 1) is the first armour they can make and is made from the 12 bars the gate to iron asks for anyway.

The knob is one number, the `0.12`. If the ladder reads as too long, raise it; if it still reads as too short, lower it. **Not verified by play.**

**Where each rock stands (HOM-77).** The ladder is also a map: a rung is somewhere you have to go, not something laid out in the starting square. **Hale's Rest has copper and nothing else** — three on the ridge, three in the Seams by the forge, six rocks where there were thirteen of four kinds. Everything above it is out in the world: **tin and iron** at the Greywater Road's first waysides past the east gate, **coal** from the second stand on, **mithril** on the Hollow's south-west wall behind the Ravager pack, **adamant** in Saltmarrow's cliffs, and stormiron in the Barrowdowns when that ground is built. The Hollow keeps its veins because the second quest is about them, but it lost its coal seams with the ridge: the nearest coal must never be one a player on the *first* quest has to walk past the Cave Brute to reach. Two consequences worth holding on to: the first quest is now a haul out to the road and back to the forge rather than a lap of the clearing, and because the waysides are clear of every camp's aggro, mining no longer levels a character by accident — the bronze set the Warden tells you to wear is what carries a combat-4 player through the Brute.

**A rung under bronze (HOM-81).** HOM-77 left Hale with a rock and nothing to make out of it: the lowest set was bronze, and bronze wants tin, which is now out on the road. So the ladder gains a **copper** rung below it — a Copper Bar is two copper ore and no second metal, and the sword, helm, greaves and chestplate (armour 2 / 5 / 3 = 10, Copper Sword +2 at a quick 2.1 s swing) are smithed from the ridge alone. It shares bronze's Smithing 1 gate rather than sitting under it, because Smithing starts at 1 and the bronze tier must keep its six levels to the iron bar; what separates the two rungs is the **map and the XP**, not the gate. A copper bar pays 12 XP against bronze's 20 for the same two ore, so walking out to the first wayside for tin is still the better climb as well as the better metal. What copper buys a new character is that they leave town in something they made, instead of in nothing.

Below the metal ladder, woodcutting keeps its own and the metal ladder is extended with new ore (**stormiron**, Mining 40; **starmetal**, Mining 52: derived from the pace rule above in 3.3, HOM-62: ore pays `0.12 x cost` at its own gate, 475 and 1,550 XP a swing), new logs (ash, Woodcutting 12; thornoak, 24; elderwood, 36), all as `NODE_TYPES` rows. A rock a long way from the forge is why **bars are carried home**: smithing stays at the forge in Hale (and gains a forge in each later town in wave 4, so the loop does not need a 6-minute walk).

---

## 3. The ladder to 30, then 40

### 3.1 The rules the ladder is built on

1. **Bands.** Every region has a level band. Content is built for a player of the band's level in the gear the band expects.
2. **XP parity, not flat XP.** One new rule: a kill's XP is `base x clamp(1 + 0.05 x (enemy − player), 0.1, 1.25)`, i.e. +5 % per level the enemy is above you (to +25 %), and **−5 % per level below** (to a 10 % floor; the first draft of this line said −15 %, but its own formula and the code say 5). It is one line in `killEnemy`. It is what makes "appropriate content" a real thing: without it the Hollow Warden (900 XP, three kills a level) stays the best farm in the game forever. It also means existing enemies simply pay less to players who have outgrown them; no existing number changes.
3. **Trash XP at parity is `20 + L`**; an elite is 3x; a boss 10x; a rare spawn 6x. A normal pull is 85 % trash, 12 % elite, 3 % boss, so the mean kill is 1.51x trash.
4. **Time to kill** on the line gear (3.3), no talents, no food: trash **9.4 s at level 17, rising 0.2 s a level to 12.4 s at 32**; elite ~3x that (32 to 46 s); boss ~8x (95 to 120 s). This replaces the first draft's 11 s at level 12 rising to 14.6 s at 30, which QA measured at 9.3 s on the road (HOM-53) and the board then kept ("leave it", HOM-43). The shipped road and Strand rows measure 6.9 to 11.8 s on mithril (7.5 to 9.0 on adamant) and stand as they are.
5. **The fight costs health, by what the enemy is.** A plain melee trash fight costs **25 % of max health** after armour (a big one 28 %, a caster that marks the ground 30 %, a ranged one 15 %): the road's six measured 24.4 % on average, 13 % to 36 %, and that spread is the design (the ranged ones die before most of their bolts land). A pair costs ~47 %, a camp of three ~70 %. Elites cost 65 to 85 % with no heal and 45 to 60 % with one Second Wind; rares 90 to 95 % and 70 to 85 %; a boss more than a bar, and is won with Second Wind on cooldown and a potion for the margin (3.4 has the rows). The first draft said 30 % for trash and 60 % for elites: the elite figure was already right, and trash comes down to what was measured because the board kept that pace.
6. **Level 11 to 12 is the Hollow's last step** and is unchanged.

### 3.2 The curve, and the arithmetic

XP to level, from `xp.ts`: L11 1,358 · L12 1,584 · L20 4,470 · L30 13,363 · L40 37,224. So **12,005 XP between 11 and 30**.

Mean XP per kill at level L is `(20 + L) x 1.51 x 0.95`, where 0.95 is drift (fighting a little under parity half the time and a little over the rest). Three quests pay combat XP: **Q3 The Salt Road 600, Q4 Brine and Bone 900, Q5 The Rotroot 1,200** (2,700 together). Running the ladder level by level:

| Level | XP to next | Kills at this level | Running kills | XP per kill |
| --- | --- | --- | --- | --- |
| 11 → 12 | 226 | 6 | 6 | 44 |
| 12 → 14 | 523 | 0 (Q3's 600 pays both) | 6 | 46 |
| 14 → 15 | 304 | 4 | 10 | 49 |
| 15 → 16 | 335 | 7 | 17 | 50 |
| 16 → 17 | 369 | 7 | 24 | 52 |
| 17 → 18 | 408 | 8 | 32 | 53 |
| 18 → 20 | 947 | 1 (Q4's 900 pays most) | 33 | 55 |
| 20 → 21 | 548 | 9 | 42 | 57 |
| 21 → 22 | 606 | 11 | 53 | 59 |
| 22 → 23 | 667 | 11 | 64 | 60 |
| 23 → 24 | 737 | 12 | 76 | 62 |
| 24 → 25 | 814 | 13 | 89 | 63 |
| 25 → 26 | 898 | 0 (Q5's 1,200 pays it) | 89 | 65 |
| 26 → 27 | 990 | 10 | 99 | 66 |
| 27 → 28 | 1,094 | 16 | 115 | 67 |
| 28 → 29 | 1,207 | 18 | 133 | 69 |
| 29 → 30 | 1,332 | 19 | **152** | 70 |

**152 kills from level 11 to 30 with all three quests; 199 without any quest.** The honest planning figure is "150 to 200", inside the 150 to 250 target. 30 → 40 is longer: 23,861 XP, **~280 kills** (302 without the Q6 1,500), about two more evenings.

Time: **see 3.7, which restates it against the measured loop.** In one line: 152 mean kills are about 85 minutes of fighting at the bot's pace (111 at a person's), **2.2 to 2.6 hours** with the three quests and the roads, and the mining and smithing that keep you on the gear line add about 1.25 hours more. Pace comes from the curve, not from padding: kills per level start at 4 and end at 19, which is the RuneScape shape.

### 3.3 Gear tiers by band, on HOM-56's pace

Weapons add flat `damage` to every direct hit; armour feeds `armor / (armor + 40)` (cap 0.75). Gear comes in steps, so TTK dips after each new set (a power spike) and drifts back up as the player levels: that is the point. **One pace model decides when each step arrives, and the enemy tables are tuned to the line through those steps** (re-derived in HOM-62; the first draft of this section was written before HOM-56 slowed the ladder, and its line, `28 + 2.1 x (L − 11)` and `50 + 1.4 x (L − 11)`, was a guess at what the ladder would deliver).

**What a set is worth.** A direct hit is `(base + W) x power`, so a blade's `W` is diluted by the ability's own base: the Crushing Blow and three Strikes that fill each 6 s cycle average `11 + W` per global cooldown, and the auto-attack adds a little. **DPS rises by `(11 + W2) / (11 + W1)`** between blades; armour cuts damage taken by `(1 − red2) / (1 − red1)` with `red = A / (A + 40)`. That gives the steps below, and it is why the first draft's "adamant is about 40 % quicker" (reading `+43 % weapon damage` as DPS) came out at 23 to 27 % on the road: the blade is +43 % of `W`, but only +31 % of what a hit is.

| Step | Blade | DPS | TTK | Armour | Damage taken |
| --- | --- | --- | --- | --- | --- |
| Mithril + Warden's Edge to adamant | 28 to 40 | +31 % | −24 % | 50 to 68 | −17 % |
| Adamant to Marrow's Edge | 40 to 50 | +20 % | −17 % | 68 (same) | 0 |
| Marrow's Edge to stormiron | 50 to 58 | +13 % | −12 % | 68 to 86 | −14 % |
| Stormiron to Rotroot Edge | 58 to 72 | +20 % | −17 % | 86 (same) | 0 |
| Rotroot Edge to starmetal | 72 to 80 | +10 % | −9 % | 86 to 100 | −10 % |

QA measured the first row on the road: TTK −23 to −27 %, damage taken −31 to −54 % (the fight is shorter and each hit is softer, so the two multiply).

**The pace model.** Mining and Smithing climb together if you smelt what you mine (2.3), so the minutes to a set are the minutes of one loop, not two. A planner on the real `NODE_TYPES` and `RECIPES` (HOM-56's numbers, each swing 1.5 s of walking and clicking on top of its gather time, mastery's speed-up applied as the levels come) takes a player who does nothing else from the first copper rock to:

| Set | Mining / Smithing at the set | Gathering and smithing, in minutes | Of which the next rung adds |
| --- | --- | --- | --- |
| Bronze set | 3 / 5 | 8 | |
| Iron, steel, the Forgemaster's Blade | 10 / 9 | 11 | +3 |
| Mithril set | 18 / 18 | 24 | +13 |
| Adamant set and blade | 29 / 29 | 49 | +25 |
| Stormiron set and blade | 41 / 41 | 92 | +43 |
| Starmetal set and blade | 52 / 53 | 151 | +59 |

Two things in that table. The rungs lengthen 3, 13, 25, 43, 59 minutes (from mithril up each is 1.4 to 1.9 times the one before), which is the shape the board asked for. And **Smithing is the long pole from mithril up**: Mining alone reaches 28 in 28 minutes and 40 in 45, but the smithing that opens each set takes 44 and 87 (the smelting is where the swings go, and a bar eats one ore and two to four coal). The Mining column below is nearly decoration once you smelt; the Smithing column is the gate.

**Where each set lands in the combat bands** depends on how much of a session goes to the forge, which only a playtest can say. Two players are modelled: a **committed** one who spends half their play mining and smithing, and a **casual** one who spends a third (the fight clock is 3.7's: 152 kills, the quests and the roads, with the mean kill at 33.6 s).

| Set | Committed arrives | Casual arrives | First band it is tuned for |
| --- | --- | --- | --- |
| Mithril + Warden's Edge | combat 11 | 16 | Greywater (10 to 13) |
| Adamant + Adamant Blade | **16** | 24 | the Strand and Dunmere (14 to 21) |
| Marrow's Edge | 20 (the Grotto's shards are the limit, not the forge) | 26 | Dunmere, Thornwood |
| Stormiron | **23 to 24** | 32 | Thornwood, Barrowdowns (21 to 29) |
| Rotroot Edge | 27 (the Mother is level 26) | 33 | Barrowdowns, Highmoor |
| Starmetal | 30, worn from 32 (the equip requirement binds) | 39 | Cairnwaste (32 to 36) |

**The enemies are tuned to the committed player.** Their ladder, the gear worn at each level, is: 28 / 50 from 11, 40 / 68 from 16, 50 / 68 from 20, 58 / 86 from 24, 72 / 86 from 27, 80 / 100 from 32 (weapon / armour). The line through it, which sets HP and hit in 3.4, is **`weapon = 36 + 2.6 x (L − 16)`, `armour = 60 + 2.2 x (L − 16)`**. Against the first draft's line that is 3 to 8 % more weapon and 14 to 20 % more armour from level 24, because the first draft had never seen stormiron's 86 or starmetal's 100. A player on schedule swings between the steps and the line: on a plain melee row, a new set puts them up to 12 % under the target TTK and the stale end of a set up to 7 % over (the table's first column). The floor is the player who is a set behind, and two:

| Level | On schedule: TTK, health cost | One set behind | Two sets behind |
| --- | --- | --- | --- |
| 16 | 8.1 s, 20 % (adamant) | 11.0 s, 35 % | (same) |
| 19 | 10.5 s, 27 % | 13.7 s, 41 % | (same) |
| 20 | 9.2 s, 24 % (Marrow's Edge) | 11.0 s, 30 % | 14.8 s, 45 % |
| 23 | 11.2 s, 29 % | 13.6 s, 34 % | 17.1 s, 51 % |
| 24 | 10.5 s, 22 % (stormiron) | 12.2 s, 29 % | 14.1 s, 32 % |
| 27 | 10.2 s, 21 % (Rotroot Edge) | 12.5 s, 26 % | 14.0 s, 32 % |
| 31 | 12.6 s, 27 % | 15.2 s, 32 % | 17.0 s, 42 % |
| 32 | 12.2 s, 24 % (starmetal) | 13.5 s, 28 % | 16.0 s, 34 % |

One set behind costs 1.3 to 3.0 s a fight and 5 to 14 points of health; two behind, 4 to 7 s and up to half a bar from a plain trash pull. That is slow and wearing, never deadly: the casual player is two sets behind from level 17 to 23 and that is the worst of it. It is the pressure to mine and smith, and it has a floor. **If the playtest finds most people are casual, the one knob is the same `0.12`:** raising ore and bar XP to about `0.18` moves every arrival about half of the way toward the committed column (a casual's adamant from combat 24 to about 20). No table below changes.

| Set | Mining | Smithing (bar / pieces) | Equip combat | Armour (helm / chest / greaves) | Blade | Capstone blade | `tier` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Copper** (HOM-81) | 1 (copper) | 1 / 1, 2, 3 | none | 2 / 5 / 3 = 10 | Copper Sword +2 at 2.1 s (Smithing 1) | none | 1 |
| **Bronze** (HOM-56) | 1 (copper), 3 (tin) | 1 / 3, 4, 5 | none | 3 / 6 / 4 = 13 | Bronze Sword +3 (Smithing 2) | none | 1 |
| Iron and steel (the drops, and the Forgemaster's Blade) | 7 (iron), 10 (coal) | 7 (iron), 8 (steel) / the blade 9 | none | 5 / 9 / 6 = 20 dropped | Forgemaster's Blade 18 (Smithing 9) | none | 2 to 3 |
| Mithril (exists) | 18 | 15 / 16, 17, 18 | none (legacy) | 12 / 22 / 16 = 50 | Warden's Edge 28 (Smithing 20) | (that is the capstone) | 4 |
| **Adamant** | 28 | 24 / 25, 27, 29 | 14 | 16 / 30 / 22 = 68 | Adamant Blade 40 (Smithing 26) | **Marrow's Edge 50** (Smithing **30**, equip combat 18, 3 Marrow shards) | 5 |
| **Stormiron** | 40 | 36 / 37, 39, 41 | 23 | 20 / 38 / 28 = 86 | Stormiron Blade 58 (Smithing 37) | **Rotroot Edge 72** (Smithing 42, equip combat 26, 3 Heartwood shards) | 5 |
| **Starmetal** (wave 4) | 52 | 48 / 49, 51, 53 | 32 | 24 / 44 / 32 = 100 | Starmetal Blade 80 (Smithing 49) | **Crownbreaker 100** (Smithing 54, 3 Crown shards) | 6 |

- A bar is one ore plus coal: adamant 1 ore + 3 coal, stormiron 1 + 4, starmetal 1 + 5. A helm is 2 bars, greaves 3, a chestplate 4, a blade 3 + 1 log (ash, thornoak, elderwood respectively). Smithing XP per craft follows the metal-ladder rule in 2.3. HOM-56 moved the Mining and Smithing columns up (mithril 9 to 18, adamant 17 to 28, stormiron and starmetal pushed past it), and HOM-62 checks them against the pace model above: **stormiron at Mining 40 and Smithing 36 to 41 and starmetal at 52 and 48 to 53 stand** (the first draft had stormiron at Mining 26, below adamant; HOM-56 had already moved it, and the pace model above is what says the new numbers are right). What changes is **Marrow's Edge: Smithing 22 becomes 30**, because the blade is 3 adamant bars and the bar needs Smithing 24, so the old gate asked for a bar the smith could not yet make (30 is one past the chestplate's 29, the same spacing as every other capstone: Rotroot Edge 42 over stormiron's 41, Crownbreaker 54 over starmetal's 53). **Equip combat** is set at, or one or two levels under, the committed player's arrival (14 against 16, 18 against 20, 23 against 23 to 24, 26 against 27, 32 against 30) so it only ever stops a player who rushed the forge, never one who was on schedule; at starmetal it binds, and that is intended. A player can still be combat-ready for a set long before their Smithing is, which is the pressure this column is for.
- **A new item field, `req: { combat?: number }`**, is read by the equip action. Legacy items have none (Warden's Edge and the mithril set stay unrestricted, so no old save breaks); every new set does.
- **Tier 5 and tier 6 are new.** Today `TIER_COLORS` stops at 4 (epic, purple). The rule that rarer must look better means **tier 5 (legendary) and tier 6 (mythic)** need art and colours: 3D Artist's call, but I would not reuse orange (tier 3 already owns it). Adamant and stormiron sets share tier 5; they must still look like different metals, which is bespoke art, not tier fallback. **If the fallback is all that exists, stormiron will look the same as adamant, and that is unworthy of 12 levels of grind: say so rather than ship it.**
- A new set is a **step of 9 to 24 % in TTK** (the first table above), and the enemy tables sit on the line through the steps, so it puts the player a little *ahead* of it and the stale end of the set a little behind. A player who skips crafting and wears dropped iron (armour 20, blade 9 at level 20) is **far behind** and will die on elites. That is the pressure to mine and smith.
- **Capstones are shard-gated, not forge-gated, so they arrive late and in lumps.** Each is 3 shards at 35 % a kill from a boss on a 10-minute respawn (6.1): about 9 kills, an hour and a half of loops. Marrow's Edge is therefore the committed player's step at about 20, not 18 (when Smithing 30 is ready), and the Rotroot Edge's at about 27. A player who is not hunting the boss keeps the previous blade, which is one set behind on the table above.

### 3.4 The enemies

Rigs are the five the game already has (`boar`, `wolf`, `brute`, `pup`, `hexer`), reused with `look: { model, scale, tint }` exactly as the cave does it. **No new rig is needed through level 30**; wave 4's colossus, golems and the Archmage will want their own.

**Status of the rows.** The rows through level 16 are built and measured (QA, HOM-53) and **stand as shipped**: on mithril they take 6.9 to 11.8 s (9.3 mean) and cost 13 to 36 % of health, and the board kept that pace. **Everything from level 17 up is restated below from the corrected model** (HOM-62). One shipped row should change (the Greywater Wolf camp, below); the Barnacle Ogre, the only built row in the restated range, stands (HP 2,790 against 2,565 corrected is +9 %, hit and heavy within 4 %).

How the columns are derived (so the table can be extended rather than argued with). **The model, as corrected by HOM-62:**

- **DPS(L, W)** = `((20 + W) + 3 x (8 + W)) x power / 6 x 1.05 + (4 + 0.15 W) x power / 2.4`, with `power = 1 + 0.07 (L − 1)`: a Crushing Blow and three Strikes in every 6 s cycle (the GCD is the limit, and 10 energy a Strike is sustainable on 8 a second), 5 % for crits, plus the auto-attack. **There is no efficiency factor.** The first draft multiplied the rotation by 0.8 and the real one delivers all of it: at 16 pairs of level and weapon from L10 / 28 to L32 / 80 the formula is within **±2 %** of a headless bot running the real sim (ratio 1.00).
- **TTK = HP / DPS − 1.0 s.** The first blow lands the moment the player presses (nothing is cast), so a fight of `n` blows lasts `(n − 1)` global cooldowns; the intercept fitted over the same 16 pairs is −1.0 s (−0.7 to −1.3).
- **HP** = `(TTK target + 1.0 s) x DPS(L, W line) x role` (trash 1, elite 3, rare 4, boss 8). The target is **9.4 s at level 17 plus 0.2 s a level** (3.1 rule 4), and the line gear is 3.3's: `W = 36 + 2.6 (L − 16)`, `A = 60 + 2.2 (L − 16)`. Rounded to 5.
- **Hit** is whatever makes the fight cost its target share of max health after armour on the real sim, by what the enemy is: **plain melee 25 %, big melee 28 %, ranged 15 %, caster that marks the ground 30 %** (the road's measured split: wolf and hog 23 to 24, crab 33, footpad 13, sailor 17, hag 36). Cost is linear in hit, so each row is two runs and a solve; scaled by swing interval for free, since a longer swing is a bigger hit. **Elite hit is 1.2x the big-melee trash hit at its swing, rare 1.1x, boss 0.55x**: a boss fight is eight times as long, so a trash-sized hit would cost it three bars.
- **Heavy** is a telegraphed slam (`heavy` in `EnemyDef`, windup 1.6 to 1.8 s), interruptible with Pummel, for **30 % of max health after armour when it is an elite's only big attack, 24 % when the row also has a ground hazard or is a rare** (a boss has both, so 24); the **ground hazard** (`hazard`, radius 3 to 3.2, every 8 s) is **10 %**, and a trash caster's is 16 %. Raw `damage` is the figure over `1 − armour reduction` at the line armour for the enemy's own level. The first draft's 30 % for both slam and hazard together put every heavy-plus-hazard elite at 92 to 99 % even with a Second Wind; at 24 and 10 they cost 73 to 86 % with none and 49 to 62 % with one (Stonehorn, 77 % either way, is the exception: the bot's heal did not fire before the end, which a person should check).
- **A camp costs its bodies, not their sum.** A lone melee body costs 25 %; every extra body in a pack takes a discount so the camp is a fight, not a wall: **a pair carries HP x 0.85 and hit x 0.7 each (~47 % for the pair), a camp of three HP x 0.75 and hit x 0.6 (~70 %)**, with Cleave or Whirlwind in use. The rows below give the **member's** numbers. The shipped Greywater Wolf camp has no discount and kills a mithril player on the first pull (QA's bot died on the first pull, 102 % of health, 135 % with Cleave and a Second Wind; mine dies 8 of 8 with Cleave, Whirlwind and a Second Wind): the fix is two numbers on `road_wolf`, **HP 470 to 355 and hit 33 to 20**, which makes the camp 72 % (46 % with a Second Wind) and one wolf alone 13 % (a data line and one assertion at `golden-path.test.ts:3345`: not in this task).
- **Ranged enemies do not kite.** A shooter (`ranged`) closes to firing range, then holds the ground it is standing on and keeps shooting, in melee or not. Running one down is the answer to it, and that answer has to keep working.
- **The net** (`net`) is the one exception, and only the higher-level shooters carry one: the Footpad's Bola (level 12) and the Drowned Sailor's Tangling Net (15). Thrown from close (6 to 7 units), interruptible like any wind-up, needing a line of fire like a bolt, and doing no damage: it holds the player where they stand for 2.5 to 3 s while the caster backs off to a 7 to 8-unit gap. What it costs you is the ground you have to make up again, not health.
- **XP** = `(20 + L)` × role multiplier (elite 3, rare 6, boss 10).
- **Respawn**: trash 30 to 45 s; elite 120 s; rare **30 minutes**; boss **10 minutes**.
- **Aggro radius** 8 to 12, as the cave's. `aggroRadius()` already lets a player who has outgrown an enemy walk past it.

**Why the first draft's claims came out wrong, with the arithmetic** (HOM-53 measured; HOM-62 explains). The six enemies QA ran, on mithril and the Warden's Edge, no talents:

| Enemy (level, HP) | Claimed TTK | Model now: HP / DPS − 1.0 | QA, real bot | Cost: QA | Cost: my headless re-run |
| --- | --- | --- | --- | --- | --- |
| Marsh Hog (10, 415) | 10.6 s | 7.3 s | 6.9 s | 23.0 % | 23.6 % |
| Greywater Wolf (11, 470) | 10.8 | 8.0 | 7.4 | 23.6 | 24.8 |
| Footpad (12, 530) | 11.0 | 8.7 | 8.4 | 13.4 | 15.6 |
| Shore Crab (14, 665) | 11.4 | 10.3 | 10.1 | 33.4 | 34.2 |
| Drowned Sailor (15, 745) | 11.6 | 11.2 | 10.8 | 17.2 | 17.1 |
| Tide Hag (16, 840) | 11.8 | 12.3 | 11.8 | 35.7 | 35.5 |
| **Mean** | **11.2** | **9.6** | **9.2** (9.3 in QA's report) | **24.4** | **25.1** |

(My re-run is a headless bot on the real sim with QA's rotation: Pummel a wind-up, then Crushing Blow, Serrated Throw if nothing is bleeding, Strike; it matches QA's TTK within 0.5 s on all six and the health cost within 2.2 points. It is a scratch tool and is not committed: no code in this task; QA's `bench/combat.mjs --mode ttk` is the instrument to keep using.)

- **Two constants were wrong, and a third hid them.** (1) The rotation efficiency of 0.8 under-counted DPS by 13 to 20 %: the model said 48 at level 12, the sim does 54. (2) The model forgot the free first blow, 1.0 s on a 9 s fight, 11 %. Together they put the level 10 to 12 rows 24 to 35 % under their claim. At 14 to 16 the rows had been sized for the line weapon (`28 + 2.1 (L − 11)`: 34 to 38) that a mithril player does not own until adamant, which takes 14 to 21 % of the DPS back and lands the Tide Hag exactly on its claim, by accident. On adamant the same three rows take 7.3 to 9.1 s.
- **The cost followed the TTK.** Hit is linear in cost and cost is hits landed, so the claimed 30 % over a mean 11.2 s is 30 × 9.2 / 11.2 = 24.6 % over the measured 9.2 s, against 24.4 measured. The 13 to 36 % spread is the tells, not error: a footpad dies before most of its throws land.
- **"40 s a kill" and "24 s" are two different things.** 24 s is a bot on plain trash; the 40 s was meant for a person on the *mean* kill, which is 1.51x trash by XP and 1.4x by time (3.7: the 85 / 12 / 3 mix at 24 / 70 / 150 s makes 33.6 s) and, if a person is 1.3x slower than a bot (my assumption: nobody has timed one), 44 s. The claim was right about what it described, and QA's measurement was right about what it measured.
- **"Adamant is about 40 % quicker"** read `+43 % weapon damage` as DPS. It is `+31 %` (3.3), so −24 % TTK, which is what QA measured (−23 to −27).
- **Levels 17 to 32 were roughly right by accident, too.** The first draft credited the player with +25 % from talent tiers by level 30 (the tiers are not built; the three trees that exist give about +15 to 20 %) and docked 20 % for rotation: at level 30, 194 against 185 real without talents and about 215 with the trees that exist, on the same weapon. Run on the real sim at the new line gear, the first draft's 13 rows from 18 to 32 take **88 % of their claimed TTK** (9.7 to 14.0 s) and cost 85 % of their claimed health (melee 27 to 31 %, ranged 15 to 19 %). So the restatement below moves HP only about **−7 to −11 %**: most of it is the board keeping the measured pace, not a correction of the model.

**The rows.** Levels 10 to 16 are as built. From 17 up they are the corrected model's (HOM-62). Where a row has a slam and a ground hazard the **Heavy** column reads `slam / ground`; a trash caster's ground mark is listed as `ground N`. A row marked *camp* or *pair* gives the **member's** numbers (the pack discount above is already in them).

**Greywater Road** (as built, except the wolf)

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `marsh_hog` | Marsh Hog | 10 | trash | boar x1.3 | 415 | 35 | 2s | - | 30 | plain melee, charges (speed 5.2) |
| `road_wolf` | Greywater Wolf | 11 | trash | wolf | 470 (**355**) | 33 (**20**) | 1.8s | - | 31 | camp of 3 (pack 7): Cleave it. **Bold is the camp rule; as built, the camp kills a mithril player outright (3.4)** |
| `footpad` | Footpad | 12 | trash | hexer | 530 | 46 | 2.4s | - | 32 | ranged knife: Pummel the throw; Bola pins you while it backs off |
| `toll_captain` | Toll Captain | 13 | elite | brute | 1785 | 54 | 2.2s | 195 | 99 | heavy Cudgel Slam; guards the toll camp |
| `old_grey` | Old Grey | 12 | rare | wolf x1.4 pale | 2120 | 40 | 1.6s | 180 | 192 | rare spawn: every third hit opens a bleed |

**Saltmarrow Strand**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `shore_crab` | Shore Crab | 14 | trash | boar x0.8 tint | 665 | 34 | 1.6s | - | 34 | quick, light hits |
| `drowned_sailor` | Drowned Sailor | 15 | trash | hexer | 745 | 59 | 2.6s | - | 35 | ranged harpoon; Tangling Net pins you while it backs off |
| `tide_hag` | Tide Hag | 16 | trash | hexer x1.15 | 840 | 71 | 3s | - | 36 | ranged + Undertow ground hazard (the Seer tell) |
| `barnacle_ogre` | Barnacle Ogre | 17 | elite | brute x1.15 tint | 2790 (2565) | 71 | 2.4s | 250 (260) | 111 | heavy Anchor Slam. Stands as built; the corrected figures are in brackets (67 % of health with no heal, 43 % with a Second Wind) |
| `gutterhook` | Gutterhook | 16 | rare | boar x1.6 tint | 3365 | 55 | 1.8s | 235 | 216 | rare spawn: heavy claw |

**Drowned Grotto**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `captain_marrow` | Captain Marrow | 19 | boss | brute x1.5 tint | 8350 | 35 | 2.4s | 235 / 105 | 390 | boss: Anchor Slam + Cannon Volley (hazard) + Harpoon (ranged). 94 s; dies without a heal, 75 % of health with Second Wind on cooldown |

**Dunmere Fens**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `fen_stalker` | Fen Stalker | 18 | trash | wolf tint | 805 | 32 | 1.8s | - | 38 | plain, quick, **pairs** (alone: 945 / 45) |
| `bog_witch` | Bog Witch | 19 | trash | hexer x1.1 | 1045 | 71 | 2.8s | ground 160 | 39 | ranged + Withering Ground |
| `mire_troll` | Mire Troll | 20 | trash | brute tint | 1145 | 67 | 2.4s | - | 40 | big trash: slam every 10 s (a heavy swing; see the note after the tables) |
| `bogfather` | The Bogfather | 21 | elite | brute x1.3 | 3770 | 81 | 2.4s | 270 / 115 | 123 | heavy + hazard. 34 s; 73 % no heal, 49 % with Second Wind |
| `mother_mire` | Mother Mire | 20 | rare | brute x1.7 tint | 4585 | 74 | 2.4s | 250 / 110 | 240 | rare spawn: hazard-heavy. 45 s; 72 % with Second Wind, a death or near it without |

**Thornwood**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `thornback` | Thornback Boar | 21 | trash | boar x1.4 | 1255 | 51 | 1.9s | - | 41 | hits hard, dies fast |
| `rotwood_cultist` | Rotwood Cultist | 23 | trash | hexer | 1495 | 78 | 2.6s | - | 43 | ranged + hex |
| `blight_stag` | Blight Stag | 22 | trash | wolf x1.3 tint | 1370 | 54 | 1.8s | - | 42 | plain, quick |
| `thorn_warden` | Thorn Warden | 24 | elite | brute x1.3 | 4865 | 91 | 2.4s | 310 / 135 | 132 | heavy + hazard. 35 s; 76 % no heal, 52 % with Second Wind |
| `elder_thornback` | Elder Thornback | 23 | rare | boar x2 | 5975 | 80 | 2s | 295 | 258 | rare spawn: heavy gore. 47 s; 83 % with Second Wind, dead without |

**The Rotroot**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `rotroot_mother` | The Rotroot Mother | 26 | boss | brute x1.6 tint | 15205 | 46 | 2.4s | 350 / 150 | 460 | boss: Spore Cloud (hazard) + Root Slam (heavy) + Hex Bolt. 107 s; dies without a heal, 67 % of health with Second Wind on cooldown |

**Barrowdowns**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `barrow_wight` | Barrow Wight | 25 | trash | hexer | 1760 | 81 | 2.6s | - | 45 | ranged |
| `grave_hound` | Grave Hound | 26 | trash | wolf | 1425 | 32 | 1.7s | - | 46 | **camp of 3**: Cleave it (alone: 1900 / 53) |
| `cairn_brute` | Cairn Brute | 27 | trash | brute | 2050 | 87 | 2.4s | - | 47 | slam every 9 s (a heavy swing) |
| `barrow_lord` | Barrow Lord | 29 | elite | brute x1.4 | 7115 | 116 | 2.4s | 400 / 175 | 147 | heavy + hazard. 38 s; 83 % no heal, 62 % with Second Wind |
| `hollow_knight` | The Hollow Knight | 28 | rare | brute x1.5 pale | 8830 | 92 | 2.2s | 385 | 288 | rare spawn: two slams back to back. 52 s; 92 % no heal, 74 % with Second Wind |

**Highmoor Moor**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `moor_ram` | Moor Ram | 28 | trash | boar x1.5 | 2205 | 62 | 1.9s | - | 48 | charges |
| `moor_raider` | Moor Raider | 29 | trash | hexer | 2370 | 85 | 2.4s | - | 49 | ranged |
| `ridge_ogre` | Ridge Ogre | 30 | trash | brute x1.2 | 2545 | 100 | 2.4s | - | 50 | slam every 9 s (a heavy swing) |
| `stonehorn` | Stonehorn | 31 | elite | boar x2.2 | 8170 | 106 | 2.2s | 440 / 195 | 153 | heavy Gore + hazard. 40 s; 77 % of health on the bot, to be checked by a person |

**Cairn Hold**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `cairn_king` | The Cairn King | 32 | boss | brute x1.8 tint | 23290 | 58 | 2.4s | 460 / 200 | 520 | boss: Crown Slam + Falling Stone (hazard) + Grave Bolt. 118 s; dies without a heal, 79 % of health with Second Wind on cooldown |

**Cairnwaste**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `waste_reaver` | Waste Reaver | 32 | trash | hexer | 2910 | 97 | 2.4s | - | 52 | ranged |
| `dune_hound` | Dune Hound | 34 | trash | wolf | 2480 | 40 | 1.7s | - | 54 | **camp of 3** (alone: 3310 / 66) |
| `sand_ogre` | Sand Ogre | 35 | trash | brute | 3525 | 119 | 2.4s | - | 55 | slam |
| `ashen_colossus` | Ashen Colossus | 36 | elite | brute x1.5 | 11240 | 136 | 2.4s | 540 / 235 | 168 | heavy + hazard. 44 s; 86 % no heal, 62 % with Second Wind |

**Sundered Spire**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `spire_adept` | Spire Adept | 36 | trash | hexer | 3745 | 112 | 2.6s | - | 56 | ranged |
| `void_hound` | Void Hound | 37 | trash | wolf tint | 2980 | 43 | 1.7s | - | 57 | **camp of 3** (alone: 3975 / 71) |
| `rune_golem` | Rune Golem | 38 | trash | brute tint | 4215 | 120 | 2.4s | - | 58 | slam |
| `spire_warden` | Spire Warden | 39 | elite | brute x1.5 | 13395 | 140 | 2.4s | 605 / 265 | 177 | heavy + hazard. 46 s; 83 % no heal, 61 % with Second Wind |

**The Sundered Vault**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `archmage_vael` | Archmage Vael | 41 | boss | hexer x1.6 | 39915 | 81 | 2.8s | 650 / 285 | 610 | boss: ranged barrage, two hazards, heavy on anyone in melee. **Falls out of the rule; not checked by the bot** (it is a ranged boss and my probe is a melee one) |

**Rows 32 to 41 are wave 4's**, and they fall out of the same rule for free, which is why they are here and why they are not reviewed: nothing about them is a decision yet. Two things to carry into the building of any row: **a "slam every N s" tell on a trash row is a heavier swing, not a telegraphed `heavy`** (a 25 % slam every 9 s in a 12 s fight adds about 30 points of health: a row that has a real slam is an elite and is priced as one), and **the Hit column already has the pack discount in it** for pairs and camps, so the sim must not apply one again.

Camps and counts per region (suggestions; a builder places them against the actual scenery, as the cave's were): trash in groups of 1 to 3; one elite guarding a choke on the road; one rare in a corner off the road; the dungeon's rooms hold a camp, an ambush and the boss.

**Greywater Road layout (wave 2).** Region 800 x 120, road along z = 0, Hale gate at x = −400, Saltmarrow gate at x = +400. Levels climb west to east.

| Camp | Position (x, z) | Contents |
| --- | --- | --- |
| Hog pasture | (−330 to −260, ±30) | 4 marsh hogs |
| Wolf camp A | (−170, −35) | 3 Greywater wolves (pack) |
| Ambush | (−60, 30) and (−50, −28) | 1 footpad each |
| **Toll camp** | (60, 0), across the road | the Toll Captain and 2 footpads |
| Wolf camp B | (190, 40) | 3 Greywater wolves |
| Hogs | (260, −30) | 2 marsh hogs |
| Old Grey | (330, −45), behind a rock | the rare spawn |

**What rewards beyond XP** is in section 6. Trash drops are tuned so that **the expected sale value of a kill is `0.6 x L + 3` gold**, times the role (elite 3, boss 8): that is 10 gold at level 12 and 21 at level 30 for trash. A headless check (see section 8) asserts each drop table is within 15 % of that.

### 3.5 Abilities and talents: what unlocks where

**Today all six abilities are open at combat 5 and the nine talents are all bought by combat 19** (`talentPoints` = level − 1, 18 ranks in total). After 19 a level gives nothing. So the ladder has to give each level something.

**Abilities.** Five new ones. Each has an `unlockLevel` and is **bought from a trainer for gold** (a gold sink that also makes each town worth visiting). The bar grows from 6 to 11 slots: that is a Game Engineer change, a second row of keys. Combat 5 abilities stay free.

| Ability | Combat | Trainer | Price | Kind | What it does | Cost / CD |
| --- | --- | --- | --- | --- | --- | --- |
| **Whirlwind** | 12 | Saltmarrow | 120 g | `cleave`, `arc: 360` | hits everything within 4 units, each for `8 + 0.6 x weapon` | 35 energy / 10 s |
| **Rupture** | 16 | Saltmarrow | 200 g | `dot` | a deep bleed: `10 + 14 per tick x 5`; a stronger bleed replaces a weaker one | 35 / 15 s |
| **Guard** | 20 | Thornwick | 350 g | new kind `guard` | halves damage taken for 4 s; off the GCD | 20 / 30 s |
| **Colossus Blow** | 25 | Highmoor | 500 g | `strike` | `60 + 2.5 x weapon`: the big hit | 55 / 18 s |
| **Last Stand** | 30 | Highmoor | 750 g | `heal` | `140 x power`, three times Second Wind | 40 / 90 s |

**A design problem the existing numbers hide.** An ability is `(base + weapon) x power`, so by level 12 the weapon (28) is already 78 % of a Strike (8 + 28). A new ability with a bigger `base` is nearly indistinguishable from Strike. That is why the new ones carry a **`weaponMult`** (default 1; Whirlwind 0.6, Colossus Blow 2.5): without it Colossus Blow would deal 10 % more than Strike for five times the energy. It is a field on `AbilityDef`, not a system.

**Talents.** Two new tiers per tree, so a point is worth spending every level from 20 to 40. `TIER_COST` becomes `[0, 2, 4, 8, 12]`. Each tree gains tier 3 (two talents, 3 ranks each) and tier 4 (one capstone, 1 rank) = **7 ranks a tree, 21 in all: 18 + 21 = 39 = `talentPoints(40)`**. At level 30 a player holds 29 of the 39, so ten ranks are still unbought: choices keep mattering, and at 40 everything is open. Resetting stays free.

| Tree | Tier 3 | Tier 3 | Tier 4 (capstone) |
| --- | --- | --- | --- |
| **Fury** | *Relentless* (3): +3 % crit per rank, Crushing Blow −0.5 s cooldown per rank | *Overpower* (3): Strike hits 10 % harder per rank | *Bloodthirst* (1): every auto-attack gives back 2 energy |
| **Bulwark** | *Bastion* (3): +5 % max HP per rank | *Stalwart* (3): Pummel staggers 0.3 s longer and is 2 s quicker per rank | *Unbreakable* (1): Guard lasts 2 s longer and its cooldown is 10 s shorter |
| **Hunt** | *Rending* (3): bleeds last 1 tick longer per rank | *Predator* (3): +4 % damage per rank against a target that is bleeding | *Open Wounds* (1): Rupture ticks twice as often |

Same rule as today's file header: **no talent adds an ability**; each changes a button the player has. They are lines in `TALENTS` and in `deriveTalents`, plus fields on `TalentEffects`.

### 3.6 Level 40 and the long tail

Level 30 to 40 is wave 4 (Cairnwaste, the Spire, the Vault, starmetal, enchanting). Mean XP continues the same rule: trash XP `20 + L` gives **~280 kills**. Past 40 the same rule would make kills per level fall off a cliff against a curve that grows ~10 % a level, so the rule changes from "XP per kill is `20 + L`" to **a target kills-per-level that rises from 45 at level 40 to 150 at 98**: `xp_per_kill(L) = cost(L) / kpl(L)`.

| Level | Total XP | Cost to next | Target kills per level | XP per mean kill |
| --- | --- | --- | --- | --- |
| 40 | 37,224 | 3,947 | 45 | 88 |
| 50 | 101,333 | 10,612 | 63 | 168 |
| 60 | 273,742 | 28,546 | 81 | 352 |
| 70 | 737,627 | 76,818 | 99 | 774 |
| 80 | 1,986,068 | 206,750 | 117 | 1,761 |
| 90 | 5,346,332 | 556,499 | 136 | 4,106 |
| 98 | 11,805,606 | 1,228,825 | 150 | 8,192 |

That is about **5,750 kills, ~64 hours** of combat from 40 to 99, the shape of a RuneScape grind. The gathering and crafting skills run the same curve at 3 to 5 s an action; the 40 to 99 node ladders (a new ore, log, fish and herb every 8 to 10 levels, each only in a farther region) are the long tail, and **`MAX_LEVEL` stays 99**. Regions past the Spire are not designed here. The rule above is what they follow when they are. (The 64 hours is at 40 s a kill, which 3.7 argues is a person's mean kill: it stands.)

### 3.7 The rhythm: regen, food, and how long the climb takes (HOM-62)

**The loop QA measured** (HOM-53: a bot, plain trash, no heals, pulling the next camp at 80 % health):

| Enemy | Loop per fight | Waiting for health | Share of the loop |
| --- | --- | --- | --- |
| Marsh Hog | 19.6 s | 7.0 s | 36 % |
| Footpad | 24.1 | 0.0 | 0 % (it costs 13 %: nothing to wait for) |
| Shore Crab | 28.5 | 12.0 | 42 % |
| Drowned Sailor | 31.9 | 10.0 | 31 % |
| Tide Hag (with the bot's Second Wind) | 32.5 | 1.2 | 4 % |
| **Mean per kill** | **23.9 s** | **6.0 s** | **25 %** |

**The call on regen: it stays as it is, 3 % of max health a second after 5 s out of combat, and the wait is the intended rhythm.** Four reasons, in the order I would defend them:

1. **The wait is a choice the bot made.** It stands off until 80 % health because a bot needs a threshold; a person pulls at 60 or 90. QA found the extreme the other way, too: never waiting is not sustainable (it died after 3 to 5 fights). The wait is the price of the pull-at-80 policy, not a tax on the game.
2. **There is a free heal for exactly this.** Second Wind is `45 x power`: **28 % of max health at level 16, 26 % at 24, 25 % at 30**, for 25 energy every 20 s. A plain trash pull costs 25 %. QA's loops did not press it (only the `--tactics` runs did, and the Tide Hag's wait there is 1.2 s). A player who presses it between pulls has no wait: the loop is the 24 s minus the 6 s wait, **about 18 s** (arithmetic from QA's own Wait column, not a measurement).
3. **Food earns its keep where Second Wind runs out, which is every fight that costs more than one heal.** A pair costs 47 %, a camp of three 70 %, an elite 65 to 85 %, a boss over 100 %. A Saltpike (Cooking 16) is 25 %, a Redgill 30 %, a Ghost Eel 35 %, on its own 20 s cooldown separate from Second Wind's: together they are two heals every 20 s, 50 to 60 % of the bar. That chains pairs and keeps a camp or an elite survivable, and a Fish Pie's Well Fed (+10 % max health) makes every cost in this document 9 % smaller. On plain trash food is a convenience (8 or 9 s saved when Second Wind is cooling down), and it should be: if it were the trash answer, a level 1 cook would be mandatory.
4. **Speeding regen up buys little and costs the food its job.** At 5 % a second the melee wait drops from about 8 s to about 5 and the mean loop from 24 s to about 21.5, which takes about 6 minutes off 152 kills. The board has just kept this pace; there is nothing to fix.

**What would make me change it:** a person playing Dunmere who *still* stands more than 8 s a pull with Second Wind unlocked. The fix then is the 5 s `OOC_DELAY` (to 3 s: saves 2 s a loop), not the 3 %: the delay is the dead time, the rate is the price of the fight.

**How long the climb to 30 takes.** The board's answer (HOM-43) was "leave it, about 2.5 hours". Here is what that is made of. The mean kill is not the trash kill: of 152 kills, 129 are trash (24 s a loop), 18 elites (about 70 s: a 33 s fight, then resting off 65 to 85 % and the walk) and 5 bosses (about 150 s), which makes **33.6 s a mean kill**. A person is slower than a bot; I assume 1.3x on the fighting, which nobody has timed.

| | At the bot's pace | At a person's pace |
| --- | --- | --- |
| 152 mean kills (129 trash, 18 elites, 5 bosses) | 85 min | 111 min |
| Three quests, about 10 min each | 30 | 30 |
| The roads, towns, trainers, mending | 15 | 15 |
| **Combat 11 to 30: kills, quests, roads** | **130 min (2.2 h)** | **156 min (2.6 h)** |
| Mining and smithing to stay on the gear line (3.3: the Rotroot Edge's 100 minutes, less the mithril's 24 done before level 11) | 76 | 76 |
| **Combat 11 to 30, on schedule** | **206 min (3.4 h)** | **232 min (3.9 h)** |
| From a new character (25 min of the Hollow chain and the 24 of mithril in front) | 255 min (4.2 h) | 281 min (4.7 h) |

So the board's 2.5 hours is the combat half and it is right; the forge adds another hour and a quarter, which is where "the grind lives in the gathering skills" is true in minutes; **a new character reaches 30, geared, in 4.2 to 4.7 hours, which is the first draft's four hours reached by a different road** (fewer fighting minutes, more forging ones). The 61 minutes (152 kills at 24 s) is the trash-only floor; the mean kill takes 85.

The three targets, modelled from the same table, for the day the board wants to move it (hours at a person's pace, kills, roads and quests only):

| Target | Kills to 30 | XP per kill | Hours (combat 11 to 30) |
| --- | --- | --- | --- |
| **As it is (the board's pick)** | **152** | **x 1 (`20 + L`)** | **2.6** |
| About 4 hours | 270 | x 0.56 | 4.0 |
| About 8 hours | 600 | x 0.25 | 8.0 |

The lever is **XP per kill** and nothing else: one constant in `killEnemy`, tables untouched. Lengthening fights instead (to 15 to 25 s a trash kill) is a different game from the one QA measured, and the board kept this one. **Recommendation: as it is.** Gold per hour moves with the kills per hour and not with the loop's speed: §5.4's 90 kills an hour is a person's mean kill (40 to 44 s), so its table stands; the bot's 107 an hour is not what a person earns.

---

## 4. The mounts

**Decision: two mounts, the board's calls (HOM-43).** The **first** comes at **combat 20 from Thornwick's stablemaster** for **1,000 gold** at **10 units/s**; the **second**, faster one comes from **Highmoor's stablemaster** at **total level 250** and **3,000 gold** at **13 units/s**. (The board first said "both, at combat 30 and total 120" and then moved the first to 20 so it speeds up the Barrowdowns instead of arriving after them; the stable that sells it is Thornwick's, not Highmoor's.) HOM-62 recomputes the total-level gate on HOM-56's ladder, and it comes out **harder, not softer**: the first draft's 120 now gates nothing.

*Why 120 stopped working.* The gate was argued as combat 30 plus eight skills at about level 11, "roughly an hour" of levelling for a fighter. It assumed the metal skills would be at about level 11 too. HOM-56 slowed Mining and Smithing 3.5x, and **the gear ladder forces them up regardless**: a player on schedule has Mining 41 and Smithing 41 by combat 24 and about 50 each at combat 28 (3.3's pace model). Skills at combat 28, on schedule against a casual (a third of the session at the forge), each with the other skills at what the content gives them (Woodcutting for the thornoak and elderwood blades, Fishing and Cooking for food, Herbalism and Alchemy for potions):

| Skill | Committed at combat 28 | Casual at combat 28 |
| --- | --- | --- |
| Combat | 28 | 28 |
| Mining, Smithing | 50, 50 | 35, 35 |
| Woodcutting | about 30 (thornoak 24, elderwood 36) | about 12 (ash) |
| Fishing, Cooking | about 14 each | about 10 each |
| Herbalism, Alchemy | about 12 each | about 8 each |
| Leatherworking | 1 (taught at Highmoor) | 1 |
| **Total** | **about 211** | **about 147** |

Both are over 120 before they have cooked a fish on purpose. A gate that is passed by ordinary play gates nothing, and a literal total of 30 failed the same way (it was met at combat 10). The board's own reading of the gate, "a reward for being a citizen of the world: you have learned something in every town", is worth keeping; the number has to move with the ladder.

*Is it the 3.5 hours the issue feared?* No, and the reason matters. Only Mining and Smithing run at `0.12 x cost`; Fishing, Cooking and the skills still to come keep `0.42` (2.2), and those are where a fighter's missing levels are. At that rate a skill is **cheap: Fishing to 25 takes 6.7 minutes and Cooking to 25, 4.2** (the planner above, 4 s a catch, 1.5 s of walking each, mastery's speed-up applied), so the five skills outside the gear loop climb about **4 to 6 levels a minute of pure action and, with the walking between towns and the stock to gather, about 2 levels a minute (0.5 min a level), which is what I price a level at**. The "hour" survives as an hour; it is just no longer the right size for the gate. *If* the board slows every skill to the metal pace, those levels cost 3.5x as much (1.75 min a level) and the gate wants to fall to about 200 to cost the same.

*The number.* **250** is nine skills at an average of 28: combat and the gear loop's 98 to 128 levels, plus about 30 of Woodcutting, plus the five others averaging 15 to 20. It is a **committed** player's 211 plus **39 levels (about 20 minutes)** in the five cheap skills; a **casual's** 147 plus **103 (about 50 minutes)**, which is the board's hour. A player who ignores the forge entirely cannot realistically be at Highmoor (they would be four sets behind and dying in the Barrowdowns), so there is no "pure fighter" case left to protect. The same gate, written without total level, is "the five skills outside the gear loop sum to 100 (an average of 20)"; I prefer total level because the skills screen shows it. Show the player a **`Total level 211 / 250`** line; seeing the target is half the motivation.

| | |
| --- | --- |
| Acquired | **First mount:** the **Stablemaster at Thornwick**, combat 20 and **1,000 gold**. **Second mount:** the **Stablemaster at Highmoor** (west edge of town), **total level 250** and **3,000 gold**. The mount appears as an ability toggle and a key; player state holds which mounts are owned (a `mounts` list, saved) and one `mounted` flag; with both owned the faster is the one that is ridden. |
| Speed | **First 10 units/s, second 13**, against 6: ×1.67 (about WoW's 160 % ground mount) and ×2.17. Crossing a 900-unit road takes 150 s on foot, **90 s on the first, 69 s on the second**: the step from the first to the second is 21 s a road, which is the least of the second mount's reward; it is meant to be looked at as much as ridden (art, below). Jump unchanged. |
| Mounting | A **1.0 s cast**, stationary, interrupted by damage or movement. **Not in combat, not in dungeons, not while gathering or crafting.** Free dismount. |
| Dismount | **Any damage** from an enemy (a ranged bolt dismounts you; so does a heavy you ride into) and **any ability key** (the ability fires on the same tick, so it feels continuous, not like a punished misclick). Interacting with a node, forge or NPC dismounts. |
| Aggro | Unchanged: you are not harder to see. Enemy speeds are 3.8 to 5.6 and **cannot catch a mount**: it is a way past camps, not through them. Ranged camps on the road are what make that interesting: you can be shot off the horse. |
| Combat while mounted | None. No auto-attack, no abilities until dismounted. |
| Cosmetic | The mount skins in section 6 are rare drops and change only the model. |

**Why 1,000 and 3,000 gold, and when each is actually bought.** Income is a person's pace (3.7): about 82 mean kills an hour, so 1,720 gold an hour from kills at level 20 and 2,410 at level 30, a third more with gathering sold. **1,000 gold is 27 minutes of income at level 20**, and about a fifth of everything the climb to 30 pays (section 7). Lifetime kill-gold reaches 690 at combat 20 (about 900 with gathering) and 1,500 at 24, so **the level gate of 20 is not what holds the first mount back, the gold is**: a player who has bought nothing else can pay at about 22; one who has also bought Whirlwind, Rupture and Guard (670) and made the two flights (365) can pay at 24 to 25, which is the mouth of the Barrowdowns (25 to 29). That is the board's intent ("you ride the Barrowdowns rather than walking them") and it needs no number to change. **3,000 gold is 57 minutes of income at level 30**, about 60 % of the 4,900 the next five levels pay: expect it bought around combat 33 to 35, after the total-level gate has been met in passing. It is the first sink the economy has past 30.

**Art obligations to 3D Artist and Game Engineer:** two mounts, and the standing rule applies to them as it does to gear: **the second must look plainly better than the first** (it costs three times as much and takes 250 levels), so a different animal or a rider's tack, not a tint; a mounted rider pose; the speed constant becomes `moveSpeed(player)`, which reads the best mount owned; the camera pulls back and the FOV opens slightly mounted, and a little more at 13. **A stablemaster at Thornwick as well as Highmoor** (Game Engineer: an NPC and a purchase, the same shape as the trainer's). I cannot judge whether 10 u/s feels fast or just loose with the existing camera, and 13 is a guess at "about a third faster again": the first thing to try is 9 to 11 and 12 to 14, and the thing to watch is whether the click-to-move arrival still reads at 13 (0.43 units a tick against an arrival distance of 0.15).

---

## 5. The flight network

### 5.1 Rules

- **Every town has a flight master.** Hale's Rest has one from the start (it is home, and already "found").
- **You can fly to a town only after you have walked there and spoken to its flight master.** This is the rule that makes the world feel big: the first trip to anywhere is on foot (or mounted), through the road's enemies, and the master sits just inside the town's gate so the arrival is the unlock. You take a flight from the flight master you are standing at, to any found master.
- You fly between **any two found masters**, not only neighbours. A found network is a graph, not a line.
- You cannot take a flight in combat or mounted (dismount is free, and you will be asked).

### 5.2 Price

`price = round5(25 + distance / 6)`, where distance is the straight-line world-map distance between the towns (section 1.2).

| From / to | Distance | Price | Ride |
| --- | --- | --- | --- |
| Hale ↔ Saltmarrow | 900 | **175** | 27 s |
| Saltmarrow ↔ Thornwick | 1,000 | 190 | 29 s |
| Thornwick ↔ Highmoor | 1,000 | 190 | 29 s |
| Highmoor ↔ Spire | 1,000 | 190 | 29 s |
| Saltmarrow ↔ Spire | 1,000 | 190 | 29 s |
| Hale ↔ Thornwick | 1,345 | 250 | 34 s |
| Saltmarrow ↔ Highmoor | 1,414 | 260 | 36 s |
| Thornwick ↔ Spire | 1,414 | 260 | 36 s |
| Hale ↔ Spire | 1,900 | 340 | 44 s |
| Hale ↔ Highmoor | 2,147 | **385** | 48 s |

### 5.3 The ride

**Watchable, and skippable after 3 s.** Ride time is `12 + distance / 60` seconds. The player is invulnerable and untargetable for the ride. The camera takes an on-rails shot over a low-detail world-map mesh (the same mesh the map screen needs): wave 2's engineer builds one world-map mesh and uses it twice. On arrival the player is at the destination's flight master. **A first-time flight to somewhere you already walked to is a treat; the thousandth is a skip** — the skip is why a ride this long does not become a complaint.

Sim shape: a `flight` entry in the player's `action` (`{ k: 'flight', to, t, duration }`), cleared on arrival; the player is in no region while it runs and the destination is warmed up for the arrival. It is a new action kind, not a new system.

### 5.4 Sanity-check against income

Income comes from the loot rule in 3.4 (value per kill `0.6 x L + 3`, times the pull mix 1.4) at **90 kills an hour** (40 s a kill: a person's mean kill, elites and bosses in it; QA's 24 s was a bot on plain trash, 3.7):

| Level | Gold / kill | Gold / hour |
| --- | --- | --- |
| 12 | 14.6 | 1,310 |
| 20 | 21.0 | 1,890 |
| 30 | 29.4 | 2,650 |

Gathering sold to the vendor adds roughly 30 %. The first hop (175) is **13 % of an hour at level 12**: a real decision against a 2.5-minute walk. The same 190 at level 30 is **4 %**: affordable convenience. The longest flight (385) is 15 % of an hour at 30. That is the intended shape: **poor and in a hurry you pay; rich you pay more often; nobody can afford to fly everywhere on the way up**.

The whole picture to level 30 (section 7) shows flights are the largest *optional* sink, not a mandatory one.

---

## 6. The rare-loot chase

Principle: **the best gear is still smithed from rare drops** (the Warden's Edge pattern: a drop opens a craft), and **named pieces are the lottery on top**: a little better than the crafted equivalent and one step more spectacular to look at. A player who never hunts rares is never behind the curve; a player who does gets to look like it.

### 6.1 Three layers

| Layer | Source | Rate | What it does |
| --- | --- | --- | --- |
| **Boss shards** | the dungeon boss | **35 % per kill, 1 shard** (3 make the capstone blade) | the reliable chase: ~9 kills, a 10-minute respawn, ~90 minutes of loops through the region |
| **Named pieces** | each dungeon boss (1 piece), each rare spawn (its signature piece) | boss **1 in 10** per kill; rare **1 in 4** per kill (~4 kills, ~2 hours of a 30-minute respawn: hence the loop through several rares) | unique look, stats ~8 to 10 % above the crafted piece of the band; sells for 4x its band value |
| **Mount skins** | an elite in each wilderness region | **1 in 100** per elite kill | a cosmetic mount; speed identical |

- **Rare spawns** are one per wilderness region, off the road in a fixed hidden spot, **30-minute respawn**, 4x HP, a unique tell, and a *guaranteed* roll on the signature table (the rate above is that roll; **rare spawns are the cheapest named piece to get**). They are found by exploring; the vendor and the quest NPCs in each town drop a rumour ("a white wolf has been seen east of the toll"). A rumour pins a hint on the map, not a marker.
- **Pity.** Rates below 1-in-5 are a bad-luck lottery in a single-player game. A per-player counter per drop id increments on each failed roll and **forces the drop at 3x the expected kills** (30 kills for a 1-in-10). The counter is saved. It is the only thing between a player and a 100-kill drought, and it costs one `Record<string, number>`.
- **A gathering chase too.** The high herbs, ores and fish are only in far regions (2.2): Ghostcap in the Grotto and Cairn Hold, Dragonroot on Cairnwaste's ridges, Ghost Eel in its tarns. Alongside, **crystal nodes** (cold-blue, matching the art direction) in the dungeons yield the enchanting reagent in wave 4.

### 6.2 The named pieces (through level 30)

Stats are the band's line + 8 to 10 %. `tier` is one above the set the player is likely wearing in that band, so it reads as better before you read the tooltip. **Each needs a bespoke look from 3D Artist; until it exists, tier fallback shows the set's look and the piece is not shipped** (standing rule: no equippable without an appearance).

| Source | Piece | Slot | Stat | Tier |
| --- | --- | --- | --- | --- |
| Old Grey (rare, Greywater) | **Greywolf Hauberk** | chest | armour 25 (vs mithril 22) | 5 |
| Gutterhook (rare, Strand) | **Gutterhook's Cap** | head | armour 18 (vs adamant 16) | 5 |
| Captain Marrow (boss) | **Marrow's Coat** | chest | armour 33 (vs adamant 30) | 6 |
| Mother Mire (rare, Fens) | **Fen-Hide Greaves** | legs | armour 24 (vs adamant 22) | 5 |
| Elder Thornback (rare, Thornwood) | **Thornback Tusk** | weapon | damage 55 (vs Marrow's Edge 50): the best blade there is until stormiron | 5 |
| The Rotroot Mother (boss) | **Rootbound Helm** | head | armour 22 (vs stormiron 20) | 6 |
| The Hollow Knight (rare, Barrowdowns) | **Knight's Greaves** | legs | armour 30 (vs stormiron 28) | 6 |
| The Cairn King (boss) | **The King's Crown** | head | armour 24 | 6 |

Tier here only orders colour and glow; the bespoke look decides the rest, so a boss's `tier 6` coat at level 19 and starmetal's `tier 6` set at 32 do not have to look alike. (Eight pieces, which is eight bespoke looks over waves 2 to 3. If that is too much for art to take on, the first four are enough for wave 2 to 3a and the rest can wait for 3b.)

**What a named piece does for the player.** It is a straight stat step (no procs, no new system), and it is **the only way to wear mixed sets**: the crafted line is a matched set, and one lucky piece is a visible trophy among it.

### 6.3 Mount skins (wave 4)

| Source | Skin |
| --- | --- |
| Stonehorn (elite, Moor) | Stonehorn Ram |
| Barrow Lord (elite, Barrowdowns) | Barrow Charger |
| The Bogfather (elite, Fens) | Marsh Strider |

A cosmetic chase for a player who already has everything.

---

## 7. The economy: sources and sinks to the mount

**Sources** (level 12 to 30): combat, 152 kills × ~22 gold (mean over the band) ≈ **3,400**; gathering sold (fish, herbs, spare ore and bars) ≈ +30 % ≈ **1,000**. **~4,400 to 4,900** over the climb.

**Sinks** (a thorough player):

| Sink | Amount |
| --- | --- |
| First mount (Thornwick) | 1,000 |
| Ability trainers (120 + 200 + 350 + 500 + 750) | 1,920 |
| Flights (about 8 at ~190) | 1,500 |
| Potions and vials | ~600 |
| Repairs (~10 deaths at ~50) | ~500 |
| **Total** | **~5,400** |

That is **above** the income, deliberately: **a player cannot buy everything by 30**. They choose between the two top abilities, flights, and the mount, and the ones who walk have the gold. The gap is the gold sink the economy lacked. The cheapest thing to cut if it reads as grim is the repair bill (`REPAIR_FRAC`); the cheapest to raise if it reads as slack is the trainer price. HOM-62 changes none of this: kills to 30 are the same 152 and gold is paid per kill, so the cumulative table does not care that the loop is faster than the first draft thought (only the per-hour figures in 5.4 and 3.7 do). **The second mount (3,000 gold, 4) is a sink past 30**: levels 30 to 35 pay about 4,900 and it takes 60 % of it.

---

## 8. Waves, new systems, asks, and what I could not check

### 8.1 What each wave builds

**Wave 2: the second town and travel.** The regions refactor (parallel). Hale's east gate. Greywater Road (all 4 trash + the Toll Captain + Old Grey). Saltmarrow town and Strand (shore crab, drowned sailor, tide hag, Barnacle Ogre, Gutterhook). **Fishing, cooking** and the `station` field. **Food** (not potions yet), Well Fed. Flight masters at Hale and Saltmarrow (175). The **world-map mesh** and ride. Safe zones. Death at the nearest found town's graveyard, with gear durability and repair (HOM-58; this replaced the gold repair toll). The XP-parity rule. Q3 The Salt Road. Whirlwind and the trainer. **Adamant** ore, bars and set (Mining 28 since HOM-56, equip combat 14), tier 5. Named pieces: Greywolf Hauberk and Gutterhook's Cap.

**Wave 3: the climb to 30 and the mount** (large: ship as 3a and 3b).
- **3a (to combat ~24):** Grotto, Dunmere Fens, Thornwick with **herbalism, alchemy**, potions, the Rotroot. Rupture, Guard (+ the `guard` kind and potion buffs). Talent tiers 3 and 4 and their cap. Stormiron. Q4 and Q5. Named pieces from Marrow, Mother Mire, Elder Thornback, the Rotroot Mother. **The first mount and Thornwick's stablemaster** (combat 20, 1,000 gold, 10 u/s: the mount cast, dismount rules and `moveSpeed`), since it is bought at about 22 to 25. Enemy rows from 3.4 (HOM-62).
- **3b (to 30 and the second mount):** Barrowdowns, Highmoor, Cairn Hold. **Leatherworking** and the **`hands` / `feet` slots**. Colossus Blow, Last Stand. **The second mount** (Highmoor's stablemaster, total level 250, 3,000 gold, 13 u/s) and the `Total level` readout, Q6. The pity counter. The headless drop-value check. All remaining flights.

**Wave 4: the remaining towns and the long tail.** Cairnwaste, the Spire and the Vault (levels 32 to 41), starmetal, **enchanting** and slot enchants, a forge in each later town, mount skins, the 40 to 99 node ladders, the first tier 6 art, Q7.

### 8.2 New systems (everything else is data)

Ten, each small, each named so it is not a surprise:

1. **Regions and gates** (the navigation refactor, parallel): per-region entity lists, frozen regions, catch-up on entry.
2. **Flight**: one new `action` kind, the found-masters set in the save.
3. **Mounts**: a `mounts` list, a `mounted` flag, `moveSpeed(player)` reading the best mount owned, mounting rules.
4. **Consumables and buffs**: `ItemDef.use` (heal, energy, a buff), a shared food and a shared potion cooldown, buff timers (`wellFed`, `stoneskin`, `fury`, `titan`), cleared on death. The biggest of the ten; ~150 lines in a new `sim/consumables.ts`.
5. **Equipment extensions**: `hands` / `feet` slots, `req` on items, slot enchants (wave 4).
6. **Ability extras**: `weaponMult`, trainers and a learned-abilities list, the `guard` kind.
7. **The XP-parity multiplier** (one line).
8. **Safe zones** and **respawn at the nearest found town's graveyard** with gear durability and repair (HOM-58; first built as a 3 % gold toll).
9. **Pity counters** for named drops.
10. **Recipe `station`** (a field and `nearStation`).

### 8.3 Asks of other roles

- **Game Engineer**: the region and gate transitions (fade, async preload); the world-map screen and its mesh; the flight ride camera; 11 ability slots; the food and potion buttons; the mount toggle, a stablemaster NPC in Thornwick and in Highmoor, and the total-level readout (`Total level N / 250`); fishing spots and herb patches on the existing node interaction (they are `NODE_TYPES` rows, so no new click path).
- **3D Artist**: tiers 5 and 6 (colours, glow); a look per metal set, not only a tier fallback; `hands` and `feet` looks per leather set; eight named pieces; two mounts (the second plainly better than the first) and a rider pose; a flying mount for the ride; a fishing spot, herb patch and tanning rack; rigs for the Ashen Colossus, Rune Golem and the Archmage (wave 4). **Where tier fallback would give a set a look unworthy of its grind, say so rather than let it ship.**

### 8.4 What I tuned, what I compared it to, what I could not verify

- **Model** (re-derived, HOM-62; 3.4 has the constants): DPS of the GCD-limited Crushing Blow / Strike rotation plus auto-attack with **no efficiency factor**, TTK = HP / DPS − 1.0 s, enemy HP from a target TTK of 9.4 s at level 17 plus 0.2 s a level on a line through the gear ladder, hit from a health-cost target by what the enemy is (25 / 28 / 15 / 30 %). The first draft's model (80 % efficiency, no free first blow, +25 % from unbuilt talents by level 30: 48 DPS at level 12, 194 at 30) had fights 24 to 35 % too long at levels 10 to 12 (and the right length at 16 only because it also assumed a weapon the player does not own).
- **Compared against**: QA's six road and Strand enemies (HOM-53): the model's mean TTK is 9.6 s against 9.2 measured, within 0.5 s on every one; a headless bot of mine on the real sim reproduces QA's TTK within 0.5 s and health cost within 2.2 points on all six, and the formula is within ±2 % of it at 16 pairs of level and weapon from L10 / 28 to L32 / 80. And the cave: the Hollow's 54 DPS at level 11 with Warden's Edge is 52 here.
- **Could not verify by play**: everything a person does that a bot does not. A person's DPS (the bot queues perfectly, so the model is the ceiling; a person at 80 % of it makes every TTK here 25 % longer and the trash fights cost 25 % more), the 1.3x person factor behind 44 s a mean kill and every "at a person's pace" hour, elites and bosses in a person's hands (the bot steps out of slams, Pummels, and presses Second Wind below 45 %, and clears every elite and rare here; whether they are *fun* is a playtest's question), the committed / casual split that places the sets in the bands (a third and a half of a session at the forge are my assumption; 3.3 gives the knob), the 0.5 minutes a level that prices the total-level gate, mount speeds 10 and 13, ride length, how the sawtooth after a new set feels, and whether 152 kills is a satisfying number. Stonehorn (the bot ends at 77 % either way, its heal did not fire) and Archmage Vael (a ranged boss, my probe is melee) are not confirmed even by the bot.
- **Existing balance this changes**: nothing built moves except, if you take the recommendation, the Greywater Wolf's two numbers (3.4). The XP-parity rule reduces the pay of the cave's enemies for anyone above level 11, and the Warden stops being the best farm: intended, and no existing number changes. The doc changes that are not data: Marrow's Edge's Smithing gate 22 to 30, the first mount at Thornwick and the second at total level 250, the parity prose (it said −15 % a level below; the formula and the code say −5 %).
- **Follow-ups this leaves, named so they are not lost** (all code, all mine or QA's): (1) the wolf camp fix and its assertion; (2) a headless `model` check in the golden path (the DPS formula within 3 % of the sim at six pairs of level and weapon; every built row's TTK within ±15 % of 3.1's target on the ladder and its cost within ±5 points of 3.4's), so the table cannot drift from the sim again; (3) QA's loop mode taking talents and a Second Wind policy, so the loop it times is the one a person plays; (4) a person's pass over the elites (HOM-52's shape) once the Fens and Thornwood are built.
- **A headless check to add in wave 3**: each enemy's drop table has an expected sale value within 15 % of `(0.6 x L + 3) x role`; XP follows `(20 + L) x role` at parity; kills from 11 to 30 on the model is within 150 to 250.

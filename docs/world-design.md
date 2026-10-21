# World design

The game gets a world: five towns on a road, a ladder from level 12 to 30 (then 40), a mount, flights you pay gold for, and good loot that is out there rather than down the one cave. This is the whole shape with numbers; waves 2 to 4 build it in pieces. Written the way `docs/art-direction.md` is: opinionated, concrete, buildable.

Every number below was derived, not guessed: the XP curve is `sim/xp.ts`, the combat numbers are `sim/data.ts` and `sim/items.ts`, and the model behind the enemy tables is the GCD-limited Crushing Blow / Strike rotation plus auto-attack, **re-derived from QA's measurement of the real loop (HOM-62, sections 3.3, 3.4 and 3.7)**: the first version of it, at 80 % efficiency, had fights 24 to 35 % too long at levels 10 to 12 (9.3 s measured on the road against 11 to 15 claimed). The model and its limits are in sections 3.4 and 8. **I cannot play the game**: what I could not verify by hand is listed there too.

## The calls

| Open question | Call | Why, in one line |
| --- | --- | --- |
| Town count and professions | **Five settlements**: Hale's Rest (mining, smithing, woodcutting: exists), **Saltmarrow** (fishing, cooking), **Thornwick** (herbalism, alchemy, the first stable), **Highmoor** (leatherworking, the second stable), **the Sundered Spire** (enchanting). Six new skills, ten in all. | Each town teaches things no other does, and the order of towns is the order of the climb. |
| Continuous world vs regions | **Connected regions with gates.** Already commented on the task. | The sim has no spatial index, click-to-move has no pathfinding, the cave already is a room system. |
| Mount gate | **Two mounts** (the board's calls, HOM-43). **First: combat 20, 1,000 gold, from Thornwick's stablemaster, 10 u/s. Second: total level 285, 3,000 gold, from Highmoor's, 13 u/s.** | A literal total of 30 is reached by ordinary play at about combat 10, and the gate of 120 I argued first is now met by the gear ladder alone (HOM-56 makes Mining and Smithing about 41 each by combat 24): section 4 recomputes it. The first mount is gold-gated in practice, so it arrives at the mouth of the Barrowdowns. |
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

**XP rules of thumb** (so a builder can add a rung without asking): a gathering action gives `0.42 x cost(L)` XP, where `cost(L)` is the XP from level L to L+1 (this reproduces the first ladder's iron 35 and its top rock's 80 to within a few percent); a craft gives `0.6 x cost(L)`, rounded to 5, because it consumes gathered stock. **The metal ladder is the exception, on purpose** (HOM-56, see 2.3): ore pays `0.12 x cost(L)`, a bar `0.25 x`, an armour piece `0.35 x`, a blade `0.4 x`, so a level of Mining or Smithing there takes about 8 to 17 swings, not 2.4. Fishing, cooking and the skills still to come keep the rule above. Raw material value is `2 + L` gold. Time per gather 3 to 5 s, 3 to 5 charges, 20 to 45 s respawn, like the nodes already there.

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
- **Death has to cost something you feel, and it costs two things, not a fee** (HOM-58; the board: "Dying should damage durability of gear, and require a run back from the graveyard"). (1) **Durability.** Every worn piece loses 25 of its 100 points (`DEATH_WEAR` of `MAX_DURABILITY`). At 0 a piece stays on and gives nothing until it is mended; nothing is ever destroyed. Ordinary combat wears nothing: dying is the price, and a maintenance tax on every fight would nag rather than stake. Wear is kept per item, so taking a broken piece off and putting it on again mends nothing. A merchant (Brannoch, Tam Brine) mends everything you carry for `REPAIR_FRAC` (a quarter) of each piece's value, scaled by how worn it is: a steel set and Warden's Edge (820 value) is about 205 gold from broken and about 51 for one death, against a 175-gold flight. If you cannot pay for every piece, the ones you can are mended, worn pieces first. (2) **The run back.** You wake, healed, at the **graveyard** of the nearest town (by distance from the graveyard) whose flight master you have found, and walk back to where you fell. Hale's is in the clearing's north-west corner, (-20, 26); Saltmarrow's is at the road's end by the west gate, 62 west of the square's centre. Each is a 6-unit safe circle ringed with headstones, and each is 25+ units from the town's wake point, so it is never the town square. The run is about 30 to 50 paces from the clearing's boars, about 110 from the Warden's hall and about 100 from the Barnacle Ogre. Well Fed and every potion buff are cleared. **The gold toll is retired**: death takes no gold and no item. The death overlay and the log name the gear that wore down and the length of the run. Saves: durability is stored by item id, and a save from before it loads every piece whole.

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

Tan hides into leather, then make **gloves and boots**. This is the one profession that needs **two new equipment slots**, `hands` and `feet`; the smith still makes the other four. It runs on hides that drop all the way up the road, so arriving at Highmoor with a full bag is a moment. **Built (HOM-96): Hide and Wolfskin. HOM-102 specifies the other three**: until then `boar_hide` and `wolf_pelt` were the only hides in the game and the ninth skill topped out at 11, two towns before the town that teaches it.

| Set | Leatherworking (gloves / boots) | Hide | Gloves / boots armour | Tier | Equip combat |
| --- | --- | --- | --- | --- | --- |
| Hide | 1 / 2 | boar hide | 2 / 3 | 1 | none |
| Wolfskin | 10 / 11 | wolf pelt | 5 / 7 | 2 | none |
| Marsh-hide | 18 / 19 | **marsh hide**: the Strand's and the Fens' beasts | 8 / 10 | 3 | 18 |
| Thornhide | 26 / 27 | **thorn hide**: the Thornwood's and the Barrowdowns' beasts | 11 / 14 | 4 | 24 |
| Moorhide | 34 / 35 | **moor hide**: the Moor's beasts, and Cairnwaste's in wave 4 | 15 / 18 | 5 | 32 |

**The rule the ladder runs on (HOM-102): the early hides are the experience, the regional hides are the set.** Nothing tans below its own gate, so Leatherworking 1 to 18 can only be climbed on boar hides and wolf pelts: **35 boar hides open the pelts (Leatherworking 10) and 29 pelts more reach 18**, and 93 more pelts would reach 26. No later hide changes that, so a bag carried since level 1 is never worth less for having something better in it: it is the toll every gate is paid in, and the regional hides are what the sets are cut from (five a pair, and each pays more experience a hide than a pelt does). **No shipped hide entry is removed or reduced anywhere**; the three new hides are *added* to the beasts of their two regions, at a fraction of the entry already there, with `nothing` re-solved to keep each table on `0.6 x L + 3`.

**Recipes** (the rule from 2.3: a tan pays `a` x `cost(L)`, a piece `b` x, `L` the recipe's own level; round the tan to 5). Hide and Wolfskin are as built and use 0.25 / 0.35.

| Recipe | Leatherworking | Takes | Time | XP | Value |
| --- | --- | --- | --- | --- | --- |
| Tan Marsh Hide | 18 | 1 marsh hide | 3 s | 115 | leather 8 (hide 4) |
| Marsh-hide Gloves / Boots | 18 / 19 | 2 / 3 marsh leather | 8 s / 9 s | 158 / 174 | 32 / 48 |
| Tan Thorn Hide | 26 | 1 thorn hide | 3 s | 150 | leather 10 (hide 5) |
| Thornhide Gloves / Boots | 26 / 27 | 2 / 3 thorn leather | 9 s / 10 s | 208 / 230 | 40 / 60 |
| Tan Moor Hide | 34 | 1 moor hide | 3 s | 220 | leather 12 (hide 6) |
| Moorhide Gloves / Boots | 34 / 35 | 2 / 3 moor leather | 10 s / 11 s | 306 / 337 | 48 / 72 |

The two new factors fall (0.15 / 0.21 at Thornhide, 0.10 / 0.14 at Moorhide) because a rung's hides get more plentiful as the bands get longer: the Strand and the Fens are 36 kills on 3.2's table, the Thornwood and the Barrowdowns 73, the Moor and Cairnwaste more, so the experience a hide is worth falls to keep the kills a level costs about level. A tanned hide is worth twice the raw one and a piece twice its leather (Wolfskin's rule), so selling a pair beats selling its hides, as the smith's pieces do.

**Which beasts drop what.** The rule is the road's (3.4): a beast drops its band's hide where it already dropped one, an elite or rare in a lump (qty 2 to 4, 3 to 5), and a caster never does (the sailor, the hag, the witch, the cultist, the wight and the raider drop none, as today). The new entry copies the beast's existing hide entry's `qty` and takes **0.65 of its weight in the Strand and the Fens, 0.5 elsewhere** (the Strand and the Fens are the shortest windows). Hide values are 4, 5 and 6, which is why `nothing` moves by a point or four. Solved to within 0.6 % of `(0.6 L + 3) x role` on the real tables:

| Hide | Beast (table) | New entry (weight, qty) | `nothing` | New hides a kill |
| --- | --- | --- | --- | --- |
| marsh | `shore_crab` | w 20, 1 to 3 | 31 to 39 | 0.64 |
| marsh | `barnacle_ogre` (elite) | w 10, 2 to 4 | 52 to 51 | 0.91 |
| marsh | `gutterhook` (rare) | w 10, 3 to 5 | 45 (same) | 1.33 |
| marsh | `fen_stalker` | w 26, 1 to 3 | 34 to 38 | 0.75 |
| marsh | `mire_troll` | w 13, 1 to 3 | 77 to 78 | 0.40 |
| marsh | `bogfather` (elite) | w 10, 2 to 4 | 43 to 40 | 1.01 |
| marsh | `mother_mire` (rare) | w 10, 3 to 5 | 40 to 38 | 1.41 |
| thorn | `thornback` | w 15, 1 to 3 | 31 to 36 | 0.59 |
| thorn | `blight_stag` | w 15, 1 to 3 | 53 to 57 | 0.48 |
| thorn | `thorn_warden` (elite) | w 8, 2 to 4 | 38 to 37 | 0.85 |
| thorn | `elder_thornback` (rare) | w 10, 3 to 5 | 25 to 24 | 1.58 |
| thorn | `grave_hound` | w 20, 1 to 3 | 24 to 26 | 0.78 |
| thorn | `cairn_brute` | w 10, 1 to 3 | 60 (same) | 0.36 |
| thorn | `barrow_lord` (elite) | w 8, 2 to 4 | 27 to 25 | 0.99 |
| thorn | `hollow_knight` (rare) | w 8, 3 to 5 | 21 to 19 | 1.50 |
| moor | `moor_ram` | w 15, 1 to 3 | 22 to 25 | 0.66 |
| moor | `ridge_ogre` | w 10, 1 to 3 | 51 to 52 | 0.39 |
| moor | `stonehorn` (elite) | w 8, 3 to 5 | 23 (same) | 1.35 |

Wave 4 follows the same rule: `dune_hound`, `sand_ogre` and `ashen_colossus` add moor hide at half their pelt entry's weight, and the Spire's beasts drop the next hide, which is not designed here. Past Moorhide the ladder is 3.6's long tail: a new hide every 8 to 10 levels in a farther region, the first at about Leatherworking 42.

**What the bag buys.** Tables above, 3.2's kills (Hale and the road are my estimate of about 26 hides, a guess: **nothing here is measured by play**), no hide sold: a player arrives at Highmoor with about **58 boar hides, 110 pelts, 16 marsh, 34 thorn and, by the end of the Moor, 16 moor hide**. Spent in gate order that is **Leatherworking about 36 in one sitting**, roughly ten minutes at the rack (about 230 tans at 3 s, quicker with mastery), and 41 for a player who does 1.4 times the kills. Every gate is crossed; the weak point is not a new hide but the **boar hide**: fewer than 35 and the pelts never open (a player on half the 3.2 kills stalls at Leatherworking 8), and the Thornhide gate is the next closest (a player on 60 % of the kills stalls at 25). Both are a reason to keep hoarding, not to loosen the gates.

**The rungs, ruled.** Five sets is right, and **the gap from 11 to 18 wants nothing in it**. Every gap is seven levels (the pair's second level to the next set's first: 2 to 10 is eight), so 11 to 18 is not the long one; and nobody is ever at the rack with Leatherworking 14 for long, because the rack is at Highmoor and the bag is crossed in one sitting: the gap is 26 pelts and about two minutes, and a rung in it would be made once, worn for no time, and cost 3D Artist another pair of looks. What the real gear line shows instead is that **the sets worth wearing are the top two**. A pair takes damage taken down by (before the cap) Marsh-hide 12 % on stormiron, Thornhide 17 %, Moorhide 21 %, which is the "10 to 20 % ahead of the curve" the enemy tables allow a six-slot player. The bag makes Marsh-hide and Thornhide in the same sitting and Thornhide is the set a player walks out in at combat 27; Hide, Wolfskin and Marsh-hide are stepping stones. (The first draft of this section said a pair adds about 15 % of armour: it is 24 to 33 % of the matched set's armour and 12 to 21 % off damage taken.)

**The armour cap bites at the top, and it is the one number this leaves for wave 4.** The best metal is starmetal at 100 and `MAX_REDUCTION` caps armour at 120 (0.75). Thornhide's 25 on starmetal is 125 and Moorhide's 33 is 133, so **at starmetal both come to exactly the cap and Moorhide is worth nothing over Thornhide**: damage taken is 12.5 % lower for either, where Moorhide uncapped would be 19 % lower. Nothing below starmetal reaches the cap (stormiron plus Moorhide is 119). The fix is one constant when Moorhide and starmetal ship together: `MAX_REDUCTION` 0.75 to 0.80 (armour 160), which puts the full six-slot best kit at 133, 0.77, as the table above promised. It also gives Stoneskin back the room the cap takes from it at stormiron and above. Not changed here: nothing built reaches the cap, and it wants its own check.

**What it changes elsewhere, said plainly.**
- **The second mount's gate.** 4 priced the total-level gate with Leatherworking at 1. A bag-carrier is about 36 at arrival, so a committed player is 246, not 211, and met the old 250 with about 4 levels (2 minutes) of the cheap skills where the gate was priced at 39 levels (20 minutes); a casual is 182 and was short by about 68 (35 minutes, where the board's hour was 50). **The board moved it to 285** (HOM-43), the number that costs the committed player what this section priced it at and costs a casual the full 103.
- **Income.** Hides are about a fifth of what a kill is worth in this band, and a player who hoards them does not sell them: at 3.2's kills that is roughly 780 gold of the climb's 3,400 from kills, partly given back in leather a player sells (a Marsh-hide to Moorhide pair is worth 80 to 120). That is the price of the moment, and it is why the hoard is a choice and not a default. It also makes **a vendor that buys a hide for 2 gold a trap for a player who does not know**: the hides' tooltips should say where they go (see the follow-ups in 8.4).
- **The pace is the bag's, not the rack's.** The skill has no pace of its own; it spends what the fighting brought, and what the fighting brought arrives at the pace of the kills. The cost is that the ninth skill is the shortest one in the game once you stand at the rack (ten minutes, against Smithing's 92), and the pace knob if it reads too fast in play is the two old rungs' experience: cutting Hide and Wolfskin to 0.15 / 0.21 would make the bag reach about 25 before the new hides are used, with the stall risk above. I would not pull it before a playtest.

**Art obligation (standing rule):** two new slots means two new worn looks per tier, from 3D Artist: Hide and Wolfskin are built; **Marsh-hide, Thornhide and Moorhide are three more pairs**. The first three sets are stepping stones, worn for minutes, and tier fallback is enough for them; **Thornhide (tier 4) and Moorhide (tier 5) are the sets a player is seen in for hours and should be bespoke, not a recolour of the tier below**: say so before they ship rather than let the fallback decide. Each needs a bench screenshot of the pair on the character when built. Equip combat 18, 24 and 32 are set at the band each set belongs to, so a burst of tanning at Highmoor cannot hand a player Moorhide at combat 28: it is made and kept until 32, the way starmetal is.

#### Enchanting (the Spire) — crafting at the rune circle, wave 4

You **disenchant** any equippable of tier 2 or above (at the circle; it destroys the item) into **arcane dust**, in proportion to its value (value / 10, at least 1), and spend dust and rare crystals on **slot enchants**. A slot enchant belongs to the *slot*, not the item: it keeps working when you change your sword. That avoids per-item instance data, which the inventory does not have (`ItemStack` is `{ id, qty }`). It also finally gives the bag of junk gear a use beyond the vendor.

| Enchant | Slot | Enchanting | Effect | Dust |
| --- | --- | --- | --- | --- |
| Keen | weapon | 36 | +3 % crit | 40 |
| Vigour | weapon | 38 | +1 energy/s | 80 |
| Warding | any armour | 36 | +4 armour | 25 |
| Vitality | chest | 40 | +6 % max HP | 60 |

**The pace (HOM-125): grinding pays `8 x value` Enchanting XP, and 8 is a designed number.** Enchanting 36 is 24,815 XP, which is **3,102 gold of gear ground: one hour of the Spire's income** (3.4's loot rule at level 36, the 1.4 pull mix and 90 kills an hour make about 3,100 gold of vendor value an hour). Three things follow, and `vault.test.ts` asserts each so the constant cannot drift: (1) **a hoarder arrives at the top of the list**: every metal and leather piece the climb makes (the steel set, Warden's Edge, the adamant, marrow, stormiron and rotroot sets, the leather pairs) is 5,238 gold, which grinds to Enchanting 41, so a player who kept their old sets can set every enchant the day they arrive; a player who sold half of it is at 36 and has a short smith for the rest; (2) **the shop is a sink, not a shortcut**: the shop sells iron and steel at 4 x value, so buying gear to grind pays 2 XP a gold and opening the skill that way costs 12,400 gold, four hours of income; (3) **smelting for it is the cheap road**: a crafted piece costs 0.6 to 0.8 of its value in materials, so a piece ground for XP is worth 10 to 13 XP a gold of ore against 2 at the shop, and pays 2.5 times the Smithing XP a stormiron piece paid (6 times an adamant one, about the same for starmetal). Dust is not the limit: one hour to 36 also yields 310 dust and the whole slot-enchant list is 305 (Vael adds about 90 a kill). Not measured by play: whether an hour reads as a gate or a chore. If it does, **6 is 45 minutes and 12 is an hour and a half**, one constant.

What enchanting feeds is **gear** and the long tail, not ability unlocks. Abilities are bought from trainers with gold (section 3.5), which is a better sink and a better reason to visit each town. Enchants are consumed when overwritten.

### 2.3 What stays in Hale's Rest

Mining and smithing run a **metal ladder** that starts at the bottom of the world, the way WoW's does: copper from level 1, tin smelted with it into bronze, then iron, steel, adamant. It was too short: the first ladder gave a level in under three swings (`0.42 x cost(L)`), so a player went from the first rock to adamant in about 50 swings, five minutes, and no step was worn long enough to feel like anything. The ladder is now longer in the two ways that matter, more rungs at the bottom and **about 6 to 8 times the swings between rungs**:

| Rock (`NODE_TYPES`) | Mining | XP a swing | Smelts into | Smithing: bar | Smithing: pieces |
| --- | --- | --- | --- | --- | --- |
| Copper Rock | 1 | 10 | Copper Bar (2 copper), Bronze Bar (1 copper + 1 tin) | copper 1, bronze 1 | copper: sword 1, helm 1, greaves 2, chestplate 3; bronze: sword 2, helm 3, greaves 4, chestplate 5 |
| Tin Rock | 3 | 12 | (with copper) | | |
| Iron Rock | 7 | 18 | Iron Bar (2 ore), Steel Bar (iron bar + 2 coal) | iron 7, steel 8 | Forgemaster's Blade 9; steel helm 16, greaves 17, chestplate 18, Warden's Edge 20 |
| Coal Seam | 10 | 24 | (the fuel, from here on) | | |
| Adamant Vein | 28 | 145 | Adamant Bar (1 ore + 3 coal) | 24 | helm 25, blade 26, greaves 27, chestplate 29 |

**Levels in each tier** (Smithing, from a tier's bar to the next tier's bar): bronze 6, iron and steel 17 (it was 8, with mithril's 9 above it until HOM-81 folded the two into one metal), adamant 6 and on. **Swings** (Mining, mining the best rock open): Mining 7, where iron opens, is about 65 swings in; coal at 10, now the last gate under adamant, is about 86 (it was 22 to Mining 9); adamant at 28 is about 490 (it was 49 to Mining 17). That is 4 to 10 times the swings at every rung. The chain as a whole is about 3 times longer, because fighting and walking did not move: a headless bot that never idles takes **24 minutes** from the first swing to the Forgemaster's Blade, has the steel set smithed at **45**, and hands in the second quest at **49**. A real player is slower than the bot. Mining and Smithing climb together if you smelt what you mine (a bar is about 0.25 x cost, ore about 0.12 x, and a bar eats one to two swings), so a character who uses the forge is never more than a few bars short of a gate; the **bronze set** (armour 3 / 6 / 4 = 13, Bronze Sword +3, tier 1) is the first armour they can make and is made from the 12 bars the gate to iron asks for anyway.

The knob is one number, the `0.12`. If the ladder reads as too long, raise it; if it still reads as too short, lower it. **Not verified by play.**

**Where each rock stands (HOM-77).** The ladder is also a map: a rung is somewhere you have to go, not something laid out in the starting square. **Hale's Rest has copper and nothing else** — three on the ridge, three in the Seams by the forge, six rocks where there were thirteen of four kinds. Everything above it is out in the world: **tin and iron** at the Greywater Road's first waysides past the east gate, **coal** from the second stand on, **adamant** in Saltmarrow's cliffs, and stormiron in the Barrowdowns when that ground is built. The Hollow's own seam is **tin** (HOM-81; it was mithril), and it lost its coal seams with the ridge: the nearest coal must never be one a player on the *first* quest has to walk past the Cave Brute to reach. Nothing the trackers point at is ever the Hollow's tin — `nodeTarget` keeps to the player's own side of the cave mouth — so the seam is a convenience for someone who has already taken that door, not a second rung a Mining 3 character is sent down for. Two consequences worth holding on to: the first quest is now a haul out to the road and back to the forge rather than a lap of the clearing, and because the waysides are clear of every camp's aggro, mining no longer levels a character by accident — the bronze set the Warden tells you to wear is what carries a combat-4 player through the Brute.

**A rung under bronze (HOM-81).** HOM-77 left Hale with a rock and nothing to make out of it: the lowest set was bronze, and bronze wants tin, which is now out on the road. So the ladder gains a **copper** rung below it — a Copper Bar is two copper ore and no second metal, and the sword, helm, greaves and chestplate (armour 2 / 5 / 3 = 10, Copper Sword +2 at a quick 2.1 s swing) are smithed from the ridge alone. It shares bronze's Smithing 1 gate rather than sitting under it, because Smithing starts at 1 and the bronze tier must keep its six levels to the iron bar; what separates the two rungs is the **map and the XP**, not the gate. A copper bar pays 12 XP against bronze's 20 for the same two ore, so walking out to the first wayside for tin is still the better climb as well as the better metal. What copper buys a new character is that they leave town in something they made, instead of in nothing.

**Mithril out of the early game (HOM-81).** The starting zone's deepest metal was mithril, three veins on the Hollow's wall at Mining 18 — a rung above coal that nothing else in the world had, sitting inside the first dungeon a character ever walks into. That is backwards for a starting zone, so the veins are now **tin**, and the rung they held belongs to **steel**: the same metal the Forgemaster's Blade is already made of, hardened at the forge from the road's iron and coal. Three things fall out of it, and all three were deliberate.

- **The rung keeps its numbers.** Steel Helm / Greaves / Chestplate are 12 / 22 / 16 = 50 armour and the Warden's Edge is +28, exactly what mithril and its blade were, so the Hollow's enemies and the Greywater band are tuned as they were tuned and **nothing was retuned**. The piece gates (Smithing 16, 17, 18) and the Edge's 20 are also unchanged, which is what keeps the arrival schedule in 3.3 honest.
- **What moved is the map and the shape of the grind.** The set's nine bars cost 18 iron ore and 18 coal off the Greywater Road rather than nine ore off a cave wall, so the binding Mining gate for the second quest falls from 18 to coal's 10 — a gate the *first* quest already opens. And the grind inverts: mithril gated the bar (15) and nine of them overshot the whole set; steel's bar is the blade's own 8, so a smith reaches the helm on practice bars and tops up a few more between the pieces. About thirty bars either way.
- **A dropped metal and a smithed metal now share a name.** Tier 2 and 3 are the iron and steel the dead were wearing (armour 20, Steel Sword +9); tier 4 is steel a player hardened and beat into plate. The game already made that distinction with one metal — the Forgemaster's Blade is +18 against the dropped Steel Sword's +9 — and the look ladder carries it: tier 3 is blued steel, tier 4 is near-black plate with a cold seam.

Below the metal ladder, woodcutting keeps its own and the metal ladder is extended with new ore (**stormiron**, Mining 40; **starmetal**, Mining 52: derived from the pace rule above in 3.3, HOM-62: ore pays `0.12 x cost` at its own gate, 475 and 1,550 XP a swing), new logs (ash, Woodcutting 12; thornoak, 24; elderwood, 36), all as `NODE_TYPES` rows. A rock a long way from the forge is why **bars are carried home**: smithing stays at the forge in Hale (and gains a forge in each later town in wave 4, so the loop does not need a 6-minute walk).

---

## 3. The ladder to 30, then 40

### 3.1 The rules the ladder is built on

1. **Bands.** Every region has a level band. Content is built for a player of the band's level in the gear the band expects.
2. **XP parity, not flat XP.** One new rule: a kill's XP is `base x clamp(1 + 0.05 x (enemy − player), 0.1, 1.25)`, i.e. +5 % per level the enemy is above you (to +25 %), and **−5 % per level below** (to a 10 % floor; the first draft of this line said −15 %, but its own formula and the code say 5). It is one line in `killEnemy`. It is what makes "appropriate content" a real thing: without it the Hollow Warden (900 XP, three kills a level) stays the best farm in the game forever. It also means existing enemies simply pay less to players who have outgrown them; no existing number changes.
3. **Trash XP at parity is `20 + L`**; an elite is 3x; a boss 10x; a rare spawn 6x. A normal pull is 85 % trash, 12 % elite, 3 % boss, so the mean kill is 1.51x trash.
4. **Time to kill** on the line gear (3.3), no talents, no food: trash **9.4 s at level 17, rising 0.2 s a level to 12.4 s at 32**; elite ~3x that (32 to 46 s); boss ~8x (95 to 120 s). This replaces the first draft's 11 s at level 12 rising to 14.6 s at 30, which QA measured at 9.3 s on the road (HOM-53) and the board then kept ("leave it", HOM-43). The shipped road and Strand rows measure 6.9 to 11.8 s in the tier-4 set (7.5 to 9.0 on adamant) and stand as they are.
5. **The fight costs health, by what the enemy is.** A plain melee trash fight costs **25 % of max health** after armour (a big one 28 %, a caster that marks the ground 30 %, a ranged one 15 %): the road's six measured 24.4 % on average, 13 % to 36 %, and that spread is the design (the ranged ones die before most of their bolts land). A pair costs ~47 %, a camp of three ~70 %. Elites cost 65 to 85 % with no heal and 45 to 60 % with one Second Wind; rares 90 to 95 % and 70 to 85 % (**these are for a player who steps out of every slam and uses Pummel; a player who dodges nothing is dead on the Barnacle Ogre and on every rare, and 3.4a has both columns**); a boss more than a bar, and is won with Second Wind on cooldown and a potion for the margin (3.4 has the rows). The first draft said 30 % for trash and 60 % for elites: the elite figure was already right, and trash comes down to what was measured because the board kept that pace.
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
| Steel + Warden's Edge to adamant | 28 to 40 | +31 % | −24 % | 50 to 68 | −17 % |
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
| Steel set | 18 / 18 | 24 | +13 |
| Adamant set and blade | 29 / 29 | 49 | +25 |
| Stormiron set and blade | 41 / 41 | 92 | +43 |
| Starmetal set and blade | 52 / 53 | 151 | +59 |

Two things in that table. The rungs lengthen 3, 13, 25, 43, 59 minutes (from the steel set up each is 1.4 to 1.9 times the one before), which is the shape the board asked for. And **Smithing is the long pole from the steel set up**: Mining alone reaches 28 in 28 minutes and 40 in 45, but the smithing that opens each set takes 44 and 87 (the smelting is where the swings go, and a bar eats one ore and two to four coal). The Mining column below is nearly decoration once you smelt; the Smithing column is the gate.

**Where each set lands in the combat bands** depends on how much of a session goes to the forge, which only a playtest can say. Two players are modelled: a **committed** one who spends half their play mining and smithing, and a **casual** one who spends a third (the fight clock is 3.7's: 152 kills, the quests and the roads, with the mean kill at 33.6 s).

| Set | Committed arrives | Casual arrives | First band it is tuned for |
| --- | --- | --- | --- |
| Steel + Warden's Edge | combat 11 | 16 | Greywater (10 to 13) |
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
| Iron and steel, dropped (what the dead were wearing) | 7 (iron), 10 (coal) | 7 (iron), 8 (steel) / the blade 9 | none | 5 / 9 / 6 = 20 dropped | Forgemaster's Blade 18 (Smithing 9) | none | 2 to 3 |
| **Steel, smithed** (HOM-81; was mithril) | 7 (iron), 10 (coal) | 8 (steel) / 16, 17, 18 | none (legacy) | 12 / 22 / 16 = 50 | Warden's Edge 28 (Smithing 20) | (that is the capstone) | 4 |
| **Adamant** | 28 | 24 / 25, 27, 29 | 14 | 16 / 30 / 22 = 68 | Adamant Blade 40 (Smithing 26) | **Marrow's Edge 50** (Smithing **30**, equip combat 18, 3 Marrow shards) | 5 |
| **Stormiron** | 40 | 36 / 37, 39, 41 | 23 | 20 / 38 / 28 = 86 | Stormiron Blade 58 (Smithing 37) | **Rotroot Edge 72** (Smithing 42, equip combat 26, 3 Heartwood shards) | 5 |
| **Starmetal** (wave 4) | 52 | 48 / 49, 51, 53 | 32 | 24 / 44 / 32 = 100 | Starmetal Blade 80 (Smithing 49) | **Crownbreaker 100** (Smithing 54, 3 Crown shards) | 6 |

- A bar is one ore plus coal: adamant 1 ore + 3 coal, stormiron 1 + 4, starmetal 1 + 5. A helm is 2 bars, greaves 3, a chestplate 4, a blade 3 + 1 log (ash, thornoak, elderwood respectively). Smithing XP per craft follows the metal-ladder rule in 2.3. HOM-56 moved the Mining and Smithing columns up (the tier-4 rung 9 to 18, adamant 17 to 28, stormiron and starmetal pushed past it), and HOM-62 checks them against the pace model above: **stormiron at Mining 40 and Smithing 36 to 41 and starmetal at 52 and 48 to 53 stand** (the first draft had stormiron at Mining 26, below adamant; HOM-56 had already moved it, and the pace model above is what says the new numbers are right). What changes is **Marrow's Edge: Smithing 22 becomes 30**, because the blade is 3 adamant bars and the bar needs Smithing 24, so the old gate asked for a bar the smith could not yet make (30 is one past the chestplate's 29, the same spacing as every other capstone: Rotroot Edge 42 over stormiron's 41, Crownbreaker 54 over starmetal's 53). **Equip combat** is set at, or one or two levels under, the committed player's arrival (14 against 16, 18 against 20, 23 against 23 to 24, 26 against 27, 32 against 30) so it only ever stops a player who rushed the forge, never one who was on schedule; at starmetal it binds, and that is intended. A player can still be combat-ready for a set long before their Smithing is, which is the pressure this column is for.
- **A new item field, `req: { combat?: number }`**, is read by the equip action. Legacy items have none (Warden's Edge and the steel set stay unrestricted, so no old save breaks); every new set does.
- **Tier 5 and tier 6 are new.** Today `TIER_COLORS` stops at 4 (epic, purple). The rule that rarer must look better means **tier 5 (legendary) and tier 6 (mythic)** need art and colours: 3D Artist's call, but I would not reuse orange (tier 3 already owns it). Adamant and stormiron sets share tier 5; they must still look like different metals, which is bespoke art, not tier fallback. **If the fallback is all that exists, stormiron will look the same as adamant, and that is unworthy of 12 levels of grind: say so rather than ship it.**
- A new set is a **step of 9 to 24 % in TTK** (the first table above), and the enemy tables sit on the line through the steps, so it puts the player a little *ahead* of it and the stale end of the set a little behind. A player who skips crafting and wears dropped iron (armour 20, blade 9 at level 20) is **far behind** and will die on elites. That is the pressure to mine and smith.
- **Capstones are shard-gated, not forge-gated, so they arrive late and in lumps.** Each is 3 shards at 35 % a kill from a boss on a 10-minute respawn (6.1): about 9 kills, an hour and a half of loops. Marrow's Edge is therefore the committed player's step at about 20, not 18 (when Smithing 30 is ready), and the Rotroot Edge's at about 27. A player who is not hunting the boss keeps the previous blade, which is one set behind on the table above.

### 3.4 The enemies

Rigs are the five the game already has (`boar`, `wolf`, `brute`, `pup`, `hexer`), reused with `look: { model, scale, tint }` exactly as the cave does it. **No new rig is needed through level 30**; wave 4's colossus, golems and the Archmage will want their own.

**Status of the rows.** The rows through level 16 are built and measured (QA, HOM-53) and **stand as shipped**: in the tier-4 set they take 6.9 to 11.8 s (9.3 mean) and cost 13 to 36 % of health, and the board kept that pace. **Everything from level 17 up is restated below from the corrected model** (HOM-62). One shipped row should change (the Greywater Wolf camp, below); the Barnacle Ogre, the only built row in the restated range, stands (HP 2,790 against 2,565 corrected is +9 %, hit and heavy within 4 %).

How the columns are derived (so the table can be extended rather than argued with). **The model, as corrected by HOM-62:**

- **DPS(L, W)** = `((20 + W) + 3 x (8 + W)) x power / 6 x 1.05 + (4 + 0.15 W) x power / 2.4`, with `power = 1 + 0.07 (L − 1)`: a Crushing Blow and three Strikes in every 6 s cycle (the GCD is the limit, and 10 energy a Strike is sustainable on 8 a second), 5 % for crits, plus the auto-attack. **There is no efficiency factor.** The first draft multiplied the rotation by 0.8 and the real one delivers all of it: at 16 pairs of level and weapon from L10 / 28 to L32 / 80 the formula is within **±2 %** of a headless bot running the real sim (ratio 1.00).
- **TTK = HP / DPS − 1.0 s.** The first blow lands the moment the player presses (nothing is cast), so a fight of `n` blows lasts `(n − 1)` global cooldowns; the intercept fitted over the same 16 pairs is −1.0 s (−0.7 to −1.3).
- **HP** = `(TTK target + 1.0 s) x DPS(L, W line) x role` (trash 1, elite 3, rare 4, boss 8). The target is **9.4 s at level 17 plus 0.2 s a level** (3.1 rule 4), and the line gear is 3.3's: `W = 36 + 2.6 (L − 16)`, `A = 60 + 2.2 (L − 16)`. Rounded to 5.
- **Hit** is whatever makes the fight cost its target share of max health after armour on the real sim, by what the enemy is: **plain melee 25 %, big melee 28 %, ranged 15 %, caster that marks the ground 30 %** (the road's measured split: wolf and hog 23 to 24, crab 33, footpad 13, sailor 17, hag 36). Cost is linear in hit, so each row is two runs and a solve; scaled by swing interval for free, since a longer swing is a bigger hit. **Elite hit is 1.2x the big-melee trash hit at its swing, rare 1.1x, boss 0.55x**: a boss fight is eight times as long, so a trash-sized hit would cost it three bars.
- **Heavy** is a telegraphed slam (`heavy` in `EnemyDef`, windup 1.6 to 1.8 s), interruptible with Pummel, for **30 % of max health after armour when it is an elite's only big attack, 24 % when the row also has a ground hazard or is a rare** (a boss has both, so 24); the **ground hazard** (`hazard`, radius 3 to 3.2, every 8 s) is **10 %**, and a trash caster's is 16 %. Raw `damage` is the figure over `1 − armour reduction` at the line armour for the enemy's own level. The first draft's 30 % for both slam and hazard together put every heavy-plus-hazard elite at 92 to 99 % even with a Second Wind; at 24 and 10 they cost 73 to 86 % with none and 49 to 62 % with one (Stonehorn, 77 % either way, is the exception: the bot's heal did not fire before the end, which a person should check).
- **A camp costs its bodies, not their sum.** A lone melee body costs 25 %; every extra body in a pack takes a discount so the camp is a fight, not a wall: **a pair carries HP x 0.85 and hit x 0.7 each (~47 % for the pair), a camp of three HP x 0.75 and hit x 0.6 (~70 %)**, with Cleave or Whirlwind in use. The rows below give the **member's** numbers. The shipped Greywater Wolf camp has no discount and kills a player in the tier-4 set on the first pull (QA's bot died on the first pull, 102 % of health, 135 % with Cleave and a Second Wind; mine dies 8 of 8 with Cleave, Whirlwind and a Second Wind): the fix is two numbers on `road_wolf`, **HP 470 to 355 and hit 33 to 20**, which makes the camp 72 % (46 % with a Second Wind) and one wolf alone 13 % (a data line and one assertion at `golden-path.test.ts:3345`: not in this task).
- **Ranged enemies do not kite.** A shooter (`ranged`) closes to firing range, then holds the ground it is standing on and keeps shooting, in melee or not. Running one down is the answer to it, and that answer has to keep working.
- **The net** (`net`) is the one exception, and only the higher-level shooters carry one: the Footpad's Bola (level 12) and the Drowned Sailor's Tangling Net (15). Thrown from close (6 to 7 units), interruptible like any wind-up, needing a line of fire like a bolt, and doing no damage: it holds the player where they stand for 2.5 to 3 s while the caster backs off to a 7 to 8-unit gap. What it costs you is the ground you have to make up again, not health.
- **XP** = `(20 + L)` × role multiplier (elite 3, rare 6, boss 10).
- **Respawn**: trash 30 to 45 s; elite 120 s; rare **30 minutes**; boss **10 minutes**.
- **Aggro radius** 8 to 12, as the cave's. `aggroRadius()` already lets a player who has outgrown an enemy walk past it.

**Why the first draft's claims came out wrong, with the arithmetic** (HOM-53 measured; HOM-62 explains). The six enemies QA ran, in the tier-4 set and the Warden's Edge, no talents:

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

- **Two constants were wrong, and a third hid them.** (1) The rotation efficiency of 0.8 under-counted DPS by 13 to 20 %: the model said 48 at level 12, the sim does 54. (2) The model forgot the free first blow, 1.0 s on a 9 s fight, 11 %. Together they put the level 10 to 12 rows 24 to 35 % under their claim. At 14 to 16 the rows had been sized for the line weapon (`28 + 2.1 (L − 11)`: 34 to 38) that a player in the tier-4 set does not own until adamant, which takes 14 to 21 % of the DPS back and lands the Tide Hag exactly on its claim, by accident. On adamant the same three rows take 7.3 to 9.1 s.
- **The cost followed the TTK.** Hit is linear in cost and cost is hits landed, so the claimed 30 % over a mean 11.2 s is 30 × 9.2 / 11.2 = 24.6 % over the measured 9.2 s, against 24.4 measured. The 13 to 36 % spread is the tells, not error: a footpad dies before most of its throws land.
- **"40 s a kill" and "24 s" are two different things.** 24 s is a bot on plain trash; the 40 s was meant for a person on the *mean* kill, which is 1.51x trash by XP and 1.4x by time (3.7: the 85 / 12 / 3 mix at 24 / 70 / 150 s makes 33.6 s) and, if a person is 1.3x slower than a bot (my assumption: nobody has timed one), 44 s. The claim was right about what it described, and QA's measurement was right about what it measured.
- **"Adamant is about 40 % quicker"** read `+43 % weapon damage` as DPS. It is `+31 %` (3.3), so −24 % TTK, which is what QA measured (−23 to −27).
- **Levels 17 to 32 were roughly right by accident, too.** The first draft credited the player with +25 % from talent tiers by level 30 (the tiers are not built; the three trees that exist give about +15 to 20 %) and docked 20 % for rotation: at level 30, 194 against 185 real without talents and about 215 with the trees that exist, on the same weapon. Run on the real sim at the new line gear, the first draft's 13 rows from 18 to 32 take **88 % of their claimed TTK** (9.7 to 14.0 s) and cost 85 % of their claimed health (melee 27 to 31 %, ranged 15 to 19 %). So the restatement below moves HP only about **−7 to −11 %**: most of it is the board keeping the measured pace, not a correction of the model.

**The rows.** Levels 10 to 16 are as built. From 17 up they are the corrected model's (HOM-62). Where a row has a slam and a ground hazard the **Heavy** column reads `slam / ground`; a trash caster's ground mark is listed as `ground N`. A row marked *camp* or *pair* gives the **member's** numbers (the pack discount above is already in them).

**Greywater Road** (as built, except the wolf)

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `marsh_hog` | Marsh Hog | 10 | trash | boar x1.3 | 415 | 35 | 2s | - | 30 | plain melee, charges (speed 5.2) |
| `road_wolf` | Greywater Wolf | 11 | trash | wolf | 470 (**355**) | 33 (**20**) | 1.8s | - | 31 | camp of 3 (pack 7): Cleave it. **Bold is the camp rule; as built, the camp kills a player in the tier-4 set outright (3.4)** |
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
| `fen_stalker` | Fen Stalker | 18 | trash | wolf tint | 805 | 32 | 1.8s | - | 38 | plain, quick, **pairs** (alone: 945 / 45). **Tested as a pair (HOM-102): 15.4 s and 44 % with Cleave, no heal (the model: 16.3 s, 47 %); the row stands.** Every stalker spawns in a pair, so none is ever met alone; one alone with these numbers is 7.7 s and 14 %, which is what QA's lone run saw |
| `bog_witch` | Bog Witch | 19 | trash | hexer x1.1 | 1045 | 71 | 2.8s | ground 160 | 39 | ranged + Withering Ground |
| `mire_troll` | Mire Troll | 20 | trash | brute tint | 1145 | 67 | 2.4s | - | 40 | big trash: slam every 10 s (a heavy swing; see the note after the tables) |
| `bogfather` | The Bogfather | 21 | elite | brute x1.3 | 3770 | 81 | 2.4s | 270 / 115 | 123 | heavy + hazard. 34 s; 73 % no heal, 49 % with Second Wind |
| `mother_mire` | Mother Mire | 20 | rare | brute x1.7 tint | 4585 | 74 | 2.4s | 250 / 110 | 240 | rare spawn: hazard-heavy. 45 s; 72 % with Second Wind, a death or near it without |

**Thornwood**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `thornback` | Thornback Boar | 21 | trash | boar x1.4 | 1255 | 51 | 1.9s | - | 41 | hits hard, dies fast |
| `rotwood_cultist` | Rotwood Cultist | 23 | trash | hexer | 1495 | 78 | 2.6s | - | 43 | ranged + hex |
| `blight_stag` | Blight Stag | 22 | trash | wolf x1.3 tint | 1370 | 54 | 1.8s | - | 42 | plain, quick. **Decided (HOM-102): left as it is.** 10.4 s and 27 % on the sim, the model's 10.4 s; QA's 11.3 s and 30 % are the bench casting Second Wind on cooldown (a global cooldown on a fight this short, and gross damage a heal never lowers). The plain-melee rows all run 1 to 2.4 points over their 25 %: Thornback 26, Stag 27, Troll 29 against 28 |
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
| `stonehorn` | Stonehorn | 31 | elite | boar x2.2 | 8170 | 106 | 2.2s | 440 / 195 | 153 | heavy Gore + hazard. 40 s; 76 % no heal and 62 % with Second Wind for a slam-dodger (3.4a: the old 77 % either way was a probe whose heal had not fired; it fires). Still to be checked by a person |

**Cairn Hold**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `cairn_king` | The Cairn King | 32 | boss | brute x1.8 tint | 23290 | 58 | 2.4s | 460 / 200 | 520 | boss: Crown Slam + Falling Stone (hazard) + Grave Bolt. **Ruled (HOM-125, 3.4a): stands.** 118 s on the line gear, **130 s in the rotroot edge and stormiron a player is in when they reach him**, 120 s in starmetal (HOM-118's 177 s was a 50-damage Marrow's Edge at level 32). Costs 20 % net for a player who steps out of everything, 47 % at 80 % of the telegraphs and 57 to 63 % at 60 % with 3 deaths in 16 |

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
| `archmage_vael` | Archmage Vael | 41 | boss | hexer x1.6 | 39915 | 81 | 2.8s | 650 / 285 | 610 | boss: ranged barrage, two hazards, heavy on anyone in melee. **Ruled (HOM-125, 3.4a): stands.** 140 to 144 s (the model's 130, +8 %), 12 % net for a player who steps out of everything, 57 % at 80 % of the telegraphs with 3 deaths in 16, dead 13 in 16 at 60 %: a dodge check and nothing else, n = 16 to 20 a cell. The bot is a melee probe; a person at range is the one thing it cannot confirm |

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

### 3.4a Elites and rares: what a bracket means, and what the bench must do (HOM-102)

**The ruling: the bot under-plays, the rows are not mistuned, and nothing about them moves.** HOM-94 found Mother Mire, Barnacle Ogre and Elder Thornback dying 10 out of 10 with Second Wind, against brackets of 72, 43 and 83 %, and offered two explanations. The evidence picks one.

1. **The brackets were never a standing-still number.** 8.4 said so in its last sentence and nobody reread it: the scratch bot that produced them "steps out of slams, Pummels, and presses Second Wind". QA's bench Pummels and presses Second Wind, and **never steps out of anything**. Those are different players, and the brackets belong to the first.
2. **The sim agrees with both of them, which settles it.** A bot of mine on the real sim (not committed; line gear, the bench's rotation, 40 fights a cell, each fight 33 to 52 s) reproduces the bench's deaths with no dodge and the brackets with a slam dodge. Table below. Its gross damage with no dodge is 130, 131 and 131 % on the three rows; QA's was 121 to 131.
3. **HOM-98's bug was real but did not do this.** The bench pressed `KeyR`, an ability slot, instead of the attack key, and many fights had no swings. With it fixed (`7a62c8a`, 8 fights a row, swings 17 to 19 every fight) the same three rows still die: **Ogre 7 of 8, Mother Mire 8 of 8, Elder Thornback 8 of 8, gross 131, 131 and 129 %** against the headless 130, 131 and 131. Bench and sim agree to two points, so these are no-dodge deaths, not no-swing deaths. (HOM-98's own Bogfather rerun, 0 of 5 dead after the fix, is the table's 0 of 40 with no dodge.)

**What each column is.** Net is gross damage taken minus health healed, as a share of maximum health; deaths are out of 40. *No dodge* is the bench as it was. *Slam dodge* steps out of every slam it has not Pummelled and ignores ground circles: **it is the reference player, and the bracket in each row is its no-heal column** (Ogre 67 against 72 here, Bogfather 73 against 69, Thorn Warden 76 against 70, Barrow Lord 83 against 78, Hollow Knight 92 against 87, Stonehorn 77 against 76). *All dodge* steps out of the ground circles as well.

| Row | Lv | No dodge, Second Wind | No dodge, no heal | Slam dodge, Second Wind | Slam dodge, no heal | All dodge, Second Wind | Dodge a row asks of a person (deaths 10 % or under) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `toll_captain` (elite) | 13 | 82 % (0) | 104 % (39) | 53 % (0) | 77 % (0) | 53 % (0) | none, with the heal |
| `barnacle_ogre` (elite) | 17 | **103 % (35)** | 120 % (37) | 31 % (0) | 72 % (0) | 31 % (0) | **about 60 %** |
| `bogfather` (elite) | 21 | 55 % (0) | 81 % (0) | 25 % (0) | 69 % (0) | 24 % (0) | none |
| `thorn_warden` (elite) | 24 | 57 % (0) | 80 % (0) | 32 % (0) | 70 % (0) | 29 % (0) | none |
| `barrow_lord` (elite) | 29 | 66 % (0) | 88 % (0) | 42 % (0) | 78 % (0) | 36 % (0) | none |
| `stonehorn` (elite) | 31 | 67 % (0) | 84 % (0) | 62 % (0) | 76 % (0) | 32 % (0) | none |
| `old_grey` (rare) | 12 | 115 % (40) | 103 % (40) | 65 % (0) | 103 % (40) | 65 % (0) | about 90 % |
| `gutterhook` (rare) | 16 | 103 % (40) | 125 % (40) | 59 % (0) | 103 % (40) | 59 % (0) | about 90 % |
| `mother_mire` (rare) | 20 | **104 % (40)** | 107 % (40) | 49 % (0) | 77 % (0) | 12 % (0) | **about 50 %** |
| `elder_thornback` (rare) | 23 | **103 % (40)** | 112 % (40) | 76 % (0) | 101 % (28) | 76 % (0) | about 80 % |
| `hollow_knight` (rare) | 28 | 104 % (40) | 103 % (40) | 61 % (0) | 87 % (0) | 61 % (0) | about 80 % |

The last column is a sweep (a dodge chance per telegraph, Pummel and Second Wind on). Share dead at 0, 20, 40, 60, 80 and 100 % dodge: Barnacle Ogre 83, 40, 20, 5, 0, 0; Mother Mire 100, 40, 15, 3, 0, 0; Elder Thornback 100, 83, 55, 25, 8, 0; Hollow Knight 100, 80, 53, 23, 10, 0; Old Grey and Gutterhook 100, 100, 80, 63, 25, 0. The five forgiving elites are 0 at every step.

**What the table says about the design, and what I decided.**
- **A landed slam is worth 22 to 30 % of health, about one Second Wind (a ground circle about 10), and dodging the slams is worth 25 to 70 points on most rows: the elite tier is priced almost entirely in dodges.** Pummel and a heal are the floor (they carry five of the eleven rows through with no dodge); with a dodge Pummel matters little, a dodger who never Pummels lands within ten to twenty points of one who does and does better on about half the rows, because a cast that lands on empty ground is time the enemy spent not swinging (N = 20, not in the table). That is a design, not a bug: tab-target on a global cooldown has no other way to make a boss a test. It also means **the single most important thing for the elite tier is whether a person can read a 1.7 second telegraph**, which I cannot judge and the bench cannot measure.
- **Five of the six elites forgive a player who never dodges, provided they heal; the Barnacle Ogre does not**: it is the first elite whose slam is its only mechanic, on the smallest health pool (340), and it flips from lethal to safe between about 40 and 60 % dodge. I left it, on purpose: it teaches the dodge on one telegraph before the Bogfather asks for two. **If a person cannot clear it, the lever is one constant: `heavy.damage` 250 to 210** (the 24 % the row would carry if it also marked ground). On the sim that takes it from 93 % dead at no dodge to 3 % (and 18 to 0 % at 40 % dodge), and lowers its net a few points at every dodge rate (73 to 68 at 40 %, 48 to 46 at 80 %). Not applied: nobody has been through it by hand.
- **Mother Mire and Elder Thornback are right as rares**: dead at no dodge, survivable at half to four-fifths, which is the "a death or near it" the row promises. **Old Grey and Gutterhook want about 90 % dodge and slam damage is not the lever**: cutting the slam from 180 to 125 (Old Grey) or from 235 to 160 (Gutterhook) changes nothing measurable, because what costs the health is 44 to 48 seconds of auto-attacks against 265 and 325 health. They are the road's pre-model rows with no bracket. If they read as walls, the lever is their `damage` (40 and 55), which I have not tested.
- **The with-Second-Wind brackets in the rows were all one heal too few.** They assumed one, and a 33 to 52 second fight on a 20 second cooldown takes two or three: the slam-dodge column above is 15 to 25 points lower (Bogfather 49 to 25, Ogre 43 to 31, Mother Mire 72 to 49). The columns here supersede them; the rows keep their old text so the history reads.

**What the bench must do: dodge, and say what it did.** The fourth bench artifact in five waves would be a dodge that is half-specified, so here it is exactly. Everything below is read from the sim's own rules (`sim/combat.ts`: `updateCast`, `startGroundCast`).

*The telegraphs.* The sim emits `{ t: 'telegraph', id, kind, windup, x?, z?, radius? }` when a cast starts and `{ t: 'slam', id, x, z, radius }` when a `heavy` or `ground` cast lands, hit or miss. The bench already wraps `s.events.push`, so it sees both. Two kinds can be stepped out of:
- **`heavy` (a slam).** Lands when the wind-up ends (1.6 to 1.8 s) as a circle of `ENEMY_TYPES[type].heavy.radius` (4.5 to 6.5) **centred on the enemy**; hits if the *centre-to-centre* distance between enemy and player is at most the radius on that tick (no body radii). The enemy is rooted for the whole wind-up and swings nothing in it, and its swing timer restarts when it lands.
- **`ground` (a marked circle).** Fixed at the **player's position when the cast starts**, radius 3 to 3.2, wind-up 1.3 s; hits if the player is within the radius of that point when the wind-up ends. The enemy is rooted for it, too.

*The rule, per telegraph, decided once on the first frame it is seen.*
1. **If Pummel is available, do not dodge: Pummel it** (the bench's rule: the wind-up is 0.25 s old, Pummel is off cooldown within 0.3 s, energy 10 or more, the enemy within 3.5). A stagger stops the cast.
2. **Otherwise, a slam:** walk straight away from the enemy, along the line from the enemy through the player, to a point `radius + 0.9` from the enemy, and hold it until the `slam` event for that enemy; then walk back until `dist <= 2.2`. It takes about 0.7 s out (4 units at the foot speed of 6) of a 1.7 s wind-up, so the margin is a full second: a dodge that starts later than 0.9 s after the telegraph is not a dodge, and the bench should say so in its count rather than quietly take the hit.
3. **Otherwise, a ground circle (only with `--dodge all`):** pick the point on the circle of radius 2.4 round the enemy that is at least `radius + 0.6` from the mark and nearest to the player, so melee goes on from the far side of the enemy; if none exists, straight away from the mark to `radius + 0.6`. Hold it until the `slam` event, then resume.
4. **Moves are made as a player makes them**: no `p.x = ...`. The browser bot has no world-space stick; it holds `W` with `view.yaw` set to the bearing of the target point (`faceYaw` already does this), and turns back to the enemy afterwards. A netted player (`p.root`) cannot dodge; count it as hit.
5. Everything else is the existing rotation: auto-attack asserted, Pummel on a wind-up, Second Wind when a full heal is missing, then Crushing Blow, Serrated Throw, Strike. **Second Wind stays on cooldown**: an elite fight is two or three casts, not one.

*What it prints, per row, and never a single number:* `--dodge none|slam|all` (default `slam`, because the brackets are its), and for every cell the share dead, **net** and **gross** damage as a share of maximum health (median and mean, as the ttk table already does), **heals cast and health healed**, **swings** and the zero-swing count (HOM-98's), **telegraphs seen, by kind, and how many it dodged and Pummelled**, slams and circles that landed, and ttk. `hpPct` as it stands is gross and a heal never lowers it; that is why HOM-94's brackets and QA's percentages could not be compared. **A row that reads 0 dodged against a non-zero telegraph count with `--dodge slam` is the bench lying and must say so.**

*How the engineer knows it is right:* on `--gear line`, `--n 20`, the bench should land within 8 points of net and 1.5 s of ttk of the table above on every row, and the three contested rows must come out alive in the slam column and dead in the none column. If they do not, the bench is wrong, not the table.

**What I could not verify.** Whether a person reads a 1.7 s telegraph, and the dodge rate a person actually achieves, is the unknown the whole tier turns on; the bot reacts in one tick and never misjudges the circle. That 40 % of dodges clears the Ogre and 80 % clears every rare is a model of a person, not one. A human pass over the Ogre and Mother Mire by hand (HOM-94's own suggestion) is still the check; it should report how many slams it saw and how many it stepped out of, which is exactly the count the bench now prints.

**The three lenient rows, ruled (HOM-125): kept, nothing moves.** The worry was that a bot which dodges "comfortably" had flattened the bottom of the table. It had not; it showed where the bottom is. Measured at **`--fast 1`** (every heal-sensitive number must be: `--fast 4` decides every fourth tick, casts Second Wind late and reads 20 to 25 points of net too high on Toll Captain, Ogre and Mother Mire, gross damage identical), line gear, the row's own level, `--dodge all`, n = 12 a cell, and `--dodge-rate 0.6` for a player who steps out of 60 % of the telegraphs she had time for. Net as a share of maximum health, deaths out of 12 in brackets:

| Row | Perfect dodge | 60 % dodge | Spread |
| --- | --- | --- | --- |
| `toll_captain` | 27 (0) | 68 (0) | 41 |
| `barnacle_ogre` | 30 (0) | 55 (0) | 25 |
| `bogfather` | 30 (0) | 39 (0) | 9 |
| `thorn_warden` | 29 (0) | 38 (0) | 9 |
| `barrow_lord` | 35 (0) | 47 (0) | 12 |
| `stonehorn` | 33 (0) | 34 (0) | 1 |
| `mother_mire` | **10 (0)** | 62 (1) | 52 |
| `elder_thornback` | 63 (0) | 85 (4) | 22 |
| `hollow_knight` | 46 (0) | 84 (6) | 38 |
| `old_grey` | 77 (0) | 97 (9) | 20 |
| `gutterhook` | 77 (0) | 95 (9) | 18 |

- **Toll Captain, Barnacle Ogre and Mother Mire are kept.** A fight at 10 to 30 % net is cheap *for a player who dodges everything*, which is what 3.4a says the elite tier is priced in. The bottom of the table is not flat, it is a cliff: **the same three rows cost 68, 55 and 62 % at 60 % dodge**, more than the tight elites' best case, and Mother Mire has the widest spread in the table (10 to 62, one death in twelve). The honest price of a row is the column for the dodge rate a person actually achieves, and **that is the one number nothing here measures**: at 60 % the band is as hard as it was thought to be, at 100 % the lenient three are nearly free. That is not a reason to move a constant before somebody has played them, and no lever is named because the bench cannot misjudge a circle and so cannot say which one a person needs. `bogfather`, `thorn_warden`, `barrow_lord` and `stonehorn` barely move between 100 and 60 % dodge (spread 1 to 12): they are the elites a poor dodger still gets through.
- **The Barnacle Ogre cliff, run** (`--dodge slam --dodge-rate P`, `--fast 1`, line gear, level 17, n = 24): 40 % dodge **5 of 24 dead, 67 % net**; 60 % **0 of 24, 51 %**; 80 % **0 of 24, 51 %**; a perfect dodger 30 %. The claim stands, softened to a slope: the sim sweep said 20 % dead at 40 % dodge and 5 % at 60 %, the bench says 21 % and 0 %. The lever stays `heavy.damage` 250 to 210, **not applied**.
- **Old Grey and Gutterhook are the one place the spread is a problem**: 77 % net at a perfect dodge and nine deaths in twelve at 60 %, so no player gets them cheap. Already said above (their `damage`, 40 and 55, is the lever and untested); unchanged, and a thing for a person to look at before it is a ruling.

### 3.5 Abilities and talents: what unlocks where

**All six starting abilities are open at combat 5.** The talents used to run out with them: nine of them, 18 ranks, all bought by combat 19. HOM-80 rebuilt the trees, and they now hold **54 ranks**, which is more than level 40 hands out — so from here the ladder's job is the abilities, not the talents.

**Abilities.** Five new ones. Each has an `unlockLevel` and is **bought from a trainer for gold** (a gold sink that also makes each town worth visiting). The bar is **11 slots** as of HOM-80, which is where the three capstones below went; the trainer's five will share it. Combat 5 abilities stay free.

| Ability | Combat | Trainer | Price | Kind | What it does | Cost / CD |
| --- | --- | --- | --- | --- | --- | --- |
| **Whirlwind** | 12 | Saltmarrow | 120 g | `cleave`, `arc: 360` | hits everything within 4 units, each for `8 + 0.6 x weapon` | 35 energy / 10 s |
| **Rupture** | 16 | Saltmarrow | 200 g | `dot` | a deep bleed: `10 + 14 per tick x 5`; a stronger bleed replaces a weaker one | 35 / 15 s |
| **Guard** | 20 | Thornwick | 350 g | new kind `guard` | halves damage taken for 4 s; off the GCD | 20 / 30 s |
| **Colossus Blow** | 25 | Highmoor | 500 g | `strike` | `60 + 2.5 x weapon`: the big hit | 55 / 18 s |
| **Last Stand** | 30 | Highmoor | 750 g | `heal` | `140 x power`, three times Second Wind | 40 / 90 s |

**A design problem the existing numbers hide.** An ability is `(base + weapon) x power`, so by level 12 the weapon (28) is already 78 % of a Strike (8 + 28). A new ability with a bigger `base` is nearly indistinguishable from Strike. That is why the new ones carry a **`weaponMult`** (default 1; Whirlwind 0.6, Colossus Blow 2.5): without it Colossus Blow would deal 10 % more than Strike for five times the energy. It is a field on `AbilityDef`, not a system.

**Talents (shipped, HOM-80).** `TIER_COST` is `[0, 2, 4, 8, 12]`: five tiers a tree, **two talents abreast at each of tiers 0–3 and one capstone alone at tier 4**. That is 9 talents and **18 ranks a tree, 27 talents and 54 ranks in all** — `talentPoints(55)`, so the trees outlast the ladder and a build is always a choice rather than a checklist. A tree cannot be filled before combat 19; a capstone wants 12 points in its own tree, so the earliest anyone holds one is combat 14. Resetting stays free.

**Two gates, not one.** The tier's points are the floor. A talent may also name a **`prereq`**: another talent, lower down the same tree, that must already be at full rank. That is what makes a tier a fork instead of a shelf — three ranks of Overpower buys Ruin, three of Brutality buys Berserk, and nine points will not buy both.

| Tree | Tier 0 | Tier 1 | Tier 2 | Tier 3 | Tier 4 (capstone) |
| --- | --- | --- | --- | --- | --- |
| **Fury** | *Brutality* (3): +5 % damage per rank · *Overpower* (3): Strike hits 12 % harder per rank | *Frenzy* (2): swing 10 % faster per rank · *Relentless* (2): +3 % crit and Crushing Blow −1 s per rank | *Execute* (1): Crushing Blow +50 % under 35 % health, and a kill resets it · *Ruin* (2, needs Overpower): crits deal 15 % more per rank | *Berserk* (2, needs Brutality): +8 % damage per rank under half health · *Unbridled* (2, needs Frenzy): every swing gives back 3 energy per rank | *Bloodthirst* (1, needs Execute): **teaches Bloodthirst** |
| **Bulwark** | *Toughened* (3): −4 % damage taken per rank · *Bastion* (3): +5 % max health per rank | *Rally* (2): Second Wind +25 % and −3 s per rank · *Stalwart* (2): staggers last 0.4 s longer and Pummel −2 s per rank | *Counterstrike* (1): Pummel at half cooldown, +30 energy on a landed interrupt · *Thick Skin* (2, needs Toughened): −12 % per rank from slams and marked ground | *Guardian* (2, needs Bastion): −10 % damage taken per rank under half health · *Vigour* (2, needs Rally): +75 % out-of-combat regen and −1 s to leave combat per rank | *Iron Will* (1, needs Counterstrike): **teaches Shield Bash** |
| **Hunt** | *Serration* (3): bleeds tick 25 % harder per rank · *Predator* (3): +4 % damage per rank against anything bleeding | *Whirling* (2): Cleave +20° and −5 energy per rank · *Rending* (2): bleeds run 1 tick longer per rank | *Bloodscent* (1): +6 % crit, and a crit adds two ticks to the bleed · *Carnage* (2, needs Predator): sweeps deal 12 % more per rank | *Exsanguinate* (2, needs Serration): bleeds tick 20 % faster per rank · *Opportunist* (2, needs Rending): +10 energy per rank on a crit | *Hemorrhage* (1, needs Bloodscent): **teaches Hemorrhage** |

**The capstones reverse the old rule.** Every other talent still only bends a button the player already has — combat reads one derived `TalentEffects` record, never the ranks. The capstone of each tree is the exception and the only one: it hands over an ability, gated by **`AbilityDef.talent`** exactly as a trainer's ability is gated by `AbilityDef.trainer`. The bar grew to **11 keys** (`1 2 3 4 5 6 Q E R F T`) to hold them.

| Capstone ability | Kind | What it does | Cost / CD |
| --- | --- | --- | --- |
| **Bloodthirst** | `strike`, `leech: 0.25` | `24 + 1.1 x weapon`, and a quarter of what it deals comes back as health | 35 / 12 s |
| **Shield Bash** | new kind `bash`, off the GCD | `10 + 0.5 x weapon` and a stagger on anything it hits, wind-up or no wind-up — the shutdown Pummel only gets on a cast | 25 / 25 s |
| **Hemorrhage** | new kind `burst`, range 9 | `10 + 0.8 x weapon`, then tears the bleed off the target and deals everything it still owed at once | 30 / 15 s |

The trainer's five abilities above are still the ladder's job; the capstones are not for sale and cost no gold.

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
| Mining and smithing to stay on the gear line (3.3: the Rotroot Edge's 100 minutes, less the steel set's done before level 11) | 76 | 76 |
| **Combat 11 to 30, on schedule** | **206 min (3.4 h)** | **232 min (3.9 h)** |
| From a new character (25 min of the Hollow chain and the steel set in front) | 255 min (4.2 h) | 281 min (4.7 h) |

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

**Decision: two mounts, the board's calls (HOM-43).** The **first** comes at **combat 20 from Thornwick's stablemaster** for **1,000 gold** at **10 units/s**; the **second**, faster one comes from **Highmoor's stablemaster** at **total level 285** and **3,000 gold** at **13 units/s**. (The board first said "both, at combat 30 and total 120" and then moved the first to 20 so it speeds up the Barrowdowns instead of arriving after them; the stable that sells it is Thornwick's, not Highmoor's.) HOM-62 recomputes the total-level gate on HOM-56's ladder, and it comes out **harder, not softer**: the first draft's 120 now gates nothing.

*Why 120 stopped working.* The gate was argued as combat 30 plus eight skills at about level 11, "roughly an hour" of levelling for a fighter. It assumed the metal skills would be at about level 11 too. HOM-56 slowed Mining and Smithing 3.5x, and **the gear ladder forces them up regardless**: a player on schedule has Mining 41 and Smithing 41 by combat 24 and about 50 each at combat 28 (3.3's pace model). Skills at combat 28, on schedule against a casual (a third of the session at the forge), each with the other skills at what the content gives them (Woodcutting for the thornoak and elderwood blades, Fishing and Cooking for food, Herbalism and Alchemy for potions):

| Skill | Committed at combat 28 | Casual at combat 28 |
| --- | --- | --- |
| Combat | 28 | 28 |
| Mining, Smithing | 50, 50 | 35, 35 |
| Woodcutting | about 30 (thornoak 24, elderwood 36) | about 12 (ash) |
| Fishing, Cooking | about 14 each | about 10 each |
| Herbalism, Alchemy | about 12 each | about 8 each |
| Leatherworking | 1 (taught at Highmoor; **about 36 once the carried bag is spent, HOM-102, see 2.2**) | 1 (same) |
| **Total** | **about 211** (246 with the bag) | **about 147** (182 with it) |

*HOM-102: the totals in the last row and the numbers below were priced with Leatherworking at 1. The bag the leatherworker carries to Highmoor is worth about 35 levels in about ten minutes, which softened a total-level gate of 250 to 4 levels (2 minutes) for a committed player; the gate that costs the committed player what this section priced it at is **285**. The board took that number (HOM-43) and it is now the one in code; 2.2 has the arithmetic.*

Both are over 120 before they have cooked a fish on purpose. A gate that is passed by ordinary play gates nothing, and a literal total of 30 failed the same way (it was met at combat 10). The board's own reading of the gate, "a reward for being a citizen of the world: you have learned something in every town", is worth keeping; the number has to move with the ladder.

*Is it the 3.5 hours the issue feared?* No, and the reason matters. Only Mining and Smithing run at `0.12 x cost`; Fishing, Cooking and the skills still to come keep `0.42` (2.2), and those are where a fighter's missing levels are. At that rate a skill is **cheap: Fishing to 25 takes 6.7 minutes and Cooking to 25, 4.2** (the planner above, 4 s a catch, 1.5 s of walking each, mastery's speed-up applied), so the five skills outside the gear loop climb about **4 to 6 levels a minute of pure action and, with the walking between towns and the stock to gather, about 2 levels a minute (0.5 min a level), which is what I price a level at**. The "hour" survives as an hour; it is just no longer the right size for the gate. *If* the board slows every skill to the metal pace, those levels cost 3.5x as much (1.75 min a level) and the gate wants to fall to about 200 to cost the same.

*The number.* **285** is ten skills at an average of 28.5: combat and the gear loop's 98 to 128 levels, plus about 30 of Woodcutting, plus the Leatherworking the carried bag pays for, plus the five others averaging 15 to 20. It is a **committed** player's 246 (211 before the bag, 2.2) plus **39 levels (about 20 minutes)** in the five cheap skills; a **casual's** 182 plus **103 (about 50 minutes)**, which is the board's hour. A player who ignores the forge entirely cannot realistically be at Highmoor (they would be four sets behind and dying in the Barrowdowns), so there is no "pure fighter" case left to protect. The same gate, written without total level, is "the five skills outside the gear loop sum to 100 (an average of 20)" — that phrasing was priced against the old 250 and I have not restated it, because the skills screen shows total level and that is the one the player reads. Show the player a **`Total level 246 / 285`** line; seeing the target is half the motivation.

| | |
| --- | --- |
| Acquired | **First mount:** the **Stablemaster at Thornwick**, combat 20 and **1,000 gold**. **Second mount:** the **Stablemaster at Highmoor** (west edge of town), **total level 285** and **3,000 gold**. The mount appears as an ability toggle and a key; player state holds which mounts are owned (a `mounts` list, saved) and one `mounted` flag; with both owned the faster is the one that is ridden. |
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
| Old Grey (rare, Greywater) | **Greywolf Hauberk** | chest | armour 25 (vs the steel chestplate's 22) | 5 |
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
- **3b (to 30 and the second mount):** Barrowdowns, Highmoor, Cairn Hold. **Leatherworking** and the **`hands` / `feet` slots**. Colossus Blow, Last Stand. **The second mount** (Highmoor's stablemaster, total level 285, 3,000 gold, 13 u/s) and the `Total level` readout, Q6. The pity counter. The headless drop-value check. All remaining flights.

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

- **Game Engineer**: the region and gate transitions (fade, async preload); the world-map screen and its mesh; the flight ride camera; 11 ability slots; the food and potion buttons; the mount toggle, a stablemaster NPC in Thornwick and in Highmoor, and the total-level readout (`Total level N / 285`); fishing spots and herb patches on the existing node interaction (they are `NODE_TYPES` rows, so no new click path).
- **3D Artist**: tiers 5 and 6 (colours, glow); a look per metal set, not only a tier fallback; `hands` and `feet` looks per leather set; eight named pieces; two mounts (the second plainly better than the first) and a rider pose; a flying mount for the ride; a fishing spot, herb patch and tanning rack; rigs for the Ashen Colossus, Rune Golem and the Archmage (wave 4). **Where tier fallback would give a set a look unworthy of its grind, say so rather than let it ship.**

### 8.4 What I tuned, what I compared it to, what I could not verify

- **Model** (re-derived, HOM-62; 3.4 has the constants): DPS of the GCD-limited Crushing Blow / Strike rotation plus auto-attack with **no efficiency factor**, TTK = HP / DPS − 1.0 s, enemy HP from a target TTK of 9.4 s at level 17 plus 0.2 s a level on a line through the gear ladder, hit from a health-cost target by what the enemy is (25 / 28 / 15 / 30 %). The first draft's model (80 % efficiency, no free first blow, +25 % from unbuilt talents by level 30: 48 DPS at level 12, 194 at 30) had fights 24 to 35 % too long at levels 10 to 12 (and the right length at 16 only because it also assumed a weapon the player does not own).
- **Compared against**: QA's six road and Strand enemies (HOM-53): the model's mean TTK is 9.6 s against 9.2 measured, within 0.5 s on every one; a headless bot of mine on the real sim reproduces QA's TTK within 0.5 s and health cost within 2.2 points on all six, and the formula is within ±2 % of it at 16 pairs of level and weapon from L10 / 28 to L32 / 80. And the cave: the Hollow's 54 DPS at level 11 with Warden's Edge is 52 here.
- **Could not verify by play**: everything a person does that a bot does not. A person's DPS (the bot queues perfectly, so the model is the ceiling; a person at 80 % of it makes every TTK here 25 % longer and the trash fights cost 25 % more), the 1.3x person factor behind 44 s a mean kill and every "at a person's pace" hour, elites and bosses in a person's hands (the bot steps out of slams, Pummels, and presses Second Wind below 45 %, and clears every elite and rare here; whether they are *fun* is a playtest's question), the committed / casual split that places the sets in the bands (a third and a half of a session at the forge are my assumption; 3.3 gives the knob), the 0.5 minutes a level that prices the total-level gate, mount speeds 10 and 13, ride length, how the sawtooth after a new set feels, and whether 152 kills is a satisfying number. Archmage Vael (a ranged boss, my probe is melee) is not confirmed even by the bot. **HOM-102: the dodge is that assumption, measured (3.4a).** The bot that wrote the elite brackets stepped out of slams; one that does not is dead on the Barnacle Ogre and every rare; so every elite and rare figure here is a statement about a person who reads a 1.7 s telegraph, and whether a person does is the first thing a playtest of the Ogre, Mother Mire and the Barrowdowns' elites has to answer. (Stonehorn, which this paragraph once said the bot ended at 77 % either way with its heal unfired, is 76 % without a heal and 62 % with one for a slam-dodger: the heal fires.)
- **Existing balance this changes**: nothing built moves except, if you take the recommendation, the Greywater Wolf's two numbers (3.4). The XP-parity rule reduces the pay of the cave's enemies for anyone above level 11, and the Warden stops being the best farm: intended, and no existing number changes. The doc changes that are not data: Marrow's Edge's Smithing gate 22 to 30, the first mount at Thornwick and the second at total level 250, the parity prose (it said −15 % a level below; the formula and the code say −5 %).
- **Follow-ups this leaves, named so they are not lost** (all code, all mine or QA's): (1) the wolf camp fix and its assertion; (2) a headless `model` check in the golden path (the DPS formula within 3 % of the sim at six pairs of level and weapon; every built row's TTK within ±15 % of 3.1's target on the ladder and its cost within ±5 points of 3.4's), so the table cannot drift from the sim again; (3) QA's loop mode taking talents and a Second Wind policy, so the loop it times is the one a person plays; (4) a person's pass over the elites (HOM-52's shape) once the Fens and Thornwood are built.
- **Follow-ups from HOM-102** (code; none is done here): (1) **Game Engineer / QA, the bench:** `--dodge none|slam|all` and the counters in 3.4a, validated against its table. (2) **Me, the three hides:** `marsh_hide`, `thorn_hide`, `moor_hide`, their leathers, six pieces and nine recipes, the 18 table rows, `req: { combat: 18 | 24 | 32 }`, with headless checks that no recipe takes a hide below its gate, that each new hide drops only in its own beasts' tables, that every changed table is within 1 % of `0.6 L + 3`, and that a bot which fights 3.2's kills and sells nothing reaches Leatherworking 26 or more at Highmoor with the tables as given. (3) **Me, the old hides' tooltips:** the boar hide and wolf pelt say where they go ("Highmoor's tanning rack will want this"), because the vendor buys them for 2 and 3 gold and a player who does not know will sell the bag. (4) **Me, with starmetal:** `MAX_REDUCTION` 0.75 to 0.80 (2.2), with a check that the six-slot best kit is under it. (5) **The board:** whether the second mount's gate (250) moves to 285 (2.2 and 4). (6) **3D Artist:** three more `hands` / `feet` pairs; bespoke for Thornhide and Moorhide.
- **HOM-107 built follow-ups 2, 3 and 4** (`src/leatherworking.test.ts`, `src/golden-path.test.ts`). The three hides, their leathers, six pieces, nine recipes and the 18 rows are in as 2.2 specifies them, every changed table within 0.59 % of `0.6 L + 3`. All five hides' tooltips say "Highmoor's tanning rack will want this" and to keep it. `MAX_REDUCTION` is 0.80 (armour 160): **the best six-slot kit already built (King's Crown, stormiron chest and greaves, Moorhide) is 123 armour, 75.5 %**, past the old cap before starmetal ships, so the cap was biting a step earlier than 2.2 said; the check builds that kit from whatever is in `ITEMS`, so starmetal enters it by itself. **What the bot check found (the number 2.2 did not have):** a bot that fights 3.2's 152 kills from combat 11 (and its formula's roughly 40 below it), real drop rolls, 40 seeds, elites left out, ends at Leatherworking 33 in the median tour and 37 at best, so the card's 26 holds. **But 12 of 40 tours (30 %) stall at 7 to 9**: they carry about 37 boar hides on average, the 35 or so that open the pelts at Leatherworking 10 is the knife edge, and a tour a few hides short sits on 100 pelts it cannot tan. The 2.2 text says this ("a player on half the kills stalls at 8"); the bot says it is not a half-the-kills problem, it is a coin flip at the kills 3.2 plans. Nothing is changed for it here: the pre-11 kill model is mine and a guess, and the levers (more boar hides on the road, or the pelt gate at 8) are a playtest's call. The check asserts the median and prints the stall count.
- **HOM-111 built the ground and the metal** (`src/cairnwaste.test.ts`, `bench/cairnwaste.mjs`). **The Cairnwaste** is 140 x 830, not 900 (the towns are 1,000 apart on the map and their floors take the rest), x 1910 to 2050 so it clears the Cairn Hold's rock; Corvin's corridor meets its south-west corner and the road is the straight line from there to the Spire. Rows 32 to 36 as written, 35 enemies: 9 reavers, 6 packs of hounds, 7 ogres and the Colossus off the road to the east. **The Spire** is the south half town (flight master, Keeper, provisioner, **a forge**, graveyard) and the north half ruins (rows 36 to 39, 14 enemies). **Starmetal**: Mining 52 at 1,550 a swing, 12 veins in four stands, the bar at Smithing 48 (1 ore + 5 coal), the set 49 / 51 / 53 at 24 / 44 / 32, the blade 80, **Crownbreaker 100** at Smithing 54, three bars folded round three **Crown shards**, which the Cairn King now drops on 35 % of kills on the roll his crown is on (the crown stays at 10 %). All tier 6, equip combat 32. **The forge is now a station with more than one site** (`STATIONS.forge.also`), and the Spire's is the second: the top of the ladder is smelted where its ore is. **The other later towns' forges are not built.** **Flights**: all ten pairs now exist and cost what 5.2 says. **Q7, The Sundered Seal** (code `eighth`): the Keeper gives it once the writ is signed; it is Q2's shape (the lesser wards first, then the Warden alone, which counts only once they are down) and pays 1,800 combat XP, 300 over the writ's. It is what the Vault's door will ask for (`need: 'sealed'`), and **the door is built, held by Wardkeeper Osric Thale, and shut** (`closed`) until HOM-112 builds what is behind it. **Not built, on purpose**: enchanting's rune circle (HOM-112), the Vault and Vael (HOM-112), a trainer in the Spire (2.1 says it teaches nothing: the talent tiers cover it), the Ghost Eel tarns and Dragonroot ridges (3.6's ladders), a rare for the Cairnwaste (3.4 has none), mount skins. **Art that is a stand-in**: the six new rows that are not the Colossus or the Golem wear their rig tinted (reaver and adept: hexer; hounds: wolf; ogre and Warden: brute), as the Barrowdowns' first draft did; the starmetal vein is a colour on the ore model; the Spire's ruins are primitives. **Audio**: the wastes and the Spire borrow the barrows' and the moor's beds.
- **A headless check to add in wave 3**: each enemy's drop table has an expected sale value within 15 % of `(0.6 x L + 3) x role`; XP follows `(20 + L) x role` at parity; kills from 11 to 30 on the model is within 150 to 250.
- **HOM-112 built the top of the game** (`src/vault.test.ts`, `bench/vault.mjs`). **Enchanting** (the tenth skill) is at the Spire's rune circle: a bag piece of tier 2 or more is ground to `value / 10` arcane dust and `8 x value` Enchanting XP (`DISENCHANT_XP_PER_VALUE`, **the one knob, not measured by play**: Enchanting 36 is 24,815 XP, which is the player's old adamant and stormiron sets, about 21,000), and the four enchants of 2.2 are set on a *slot* (`player.enchants`, saved), paid in dust and in XP by the blade rule (0.4 x the cost of the enchant's level); a broken piece or a bare slot gives nothing. They enter through `deriveStats` (`crit`, `energyRegen`, `hpFrac`, armour folded in). No crystal nodes: Vael drops dust (two rolls of 30 to 60) and that is the Vault's reason to go back. **The Vault** is three rooms in the Spire's frame (stair, archive, a 40 x 36 sanctum) behind Thale's gate, opened by the seal; trash is the ruins' own. **Vael** is the bible's row exactly, and the one engine change is `ranged.holds`: a caster who closes to 0.9 of his reach (16) and stands there, and whose `heavy` is a nova for whoever is inside its radius. **"Two hazards"** is his Rune Storm (a marked circle) and three warded scars on the sanctum floor (Withering Ground). **Q7** goes on from `cleared` (seal read, door open) to `closing` (Vael slain) and `done` (the Keeper pays 2,400 combat and 3,000 Enchanting XP). **The floor stack** now lifts within a dungeon (`src/floor-stack.ts`): stacked across the cave list the sixteenth room reached 0.064, over the 0.06 ground marks, and would have buried every circle in the Vault.
- **What the bench makes of Vael** (`node bench/combat.mjs --mode ttk --types archmage_vael --n 6 --level 41 --gear line --dodge all --fast 2 --cap 300`; three fights finished before the run was stopped): a bot that Pummels a wind-up and steps out of every nova and every Rune Storm kills him in **126, 136 and 143 s** and **none of the three died** (the bible's 130 s model; the bot never gets a heal, nothing here is food or potions). The bot is the melee probe the bible warned about: it runs the sixteen paces to him and then fights him in the nova's radius, so it says nothing about a player who stays at range. **No person has fought him.** Not run: `--dodge slam` (the bot that ignores circles, which killed the Cairn King 20 of 20), the ranged-only player, and the warded floor, which the bot does not avoid.

# World design

The game gets a world: five towns on a road, a ladder from level 12 to 30 (then 40), a mount, flights you pay gold for, and good loot that is out there rather than down the one cave. This is the whole shape with numbers; waves 2 to 4 build it in pieces. Written the way `docs/art-direction.md` is: opinionated, concrete, buildable.

Every number below was derived, not guessed: the XP curve is `sim/xp.ts`, the combat numbers are `sim/data.ts` and `sim/items.ts`, and the rotation model behind the enemy tables is a greedy Strike / Crushing Blow / Serrated Throw loop plus auto-attack at 80 % efficiency. The model and its limits are in section 8. **I cannot play the game**: what I could not verify by hand is listed there too.

## The calls

| Open question | Call | Why, in one line |
| --- | --- | --- |
| Town count and professions | **Five settlements**: Hale's Rest (mining, smithing, woodcutting: exists), **Saltmarrow** (fishing, cooking), **Thornwick** (herbalism, alchemy), **Highmoor** (leatherworking, the stables), **the Sundered Spire** (enchanting). Six new skills, ten in all. | Each town teaches things no other does, and the order of towns is the order of the climb. |
| Continuous world vs regions | **Connected regions with gates.** Already commented on the task. | The sim has no spatial index, click-to-move has no pathfinding, the cave already is a room system. |
| Mount gate | **Total level 120**, not combat 30. Costs 1,000 gold at Highmoor. | A literal total of 30 is reached by ordinary play at about combat 10; at 120 a pure fighter is ~80 levels short and has to go and learn every profession. |
| Flight pricing | **25 gold + 1 gold per 6 world units**, rounded to 5: 175 for the first hop, 190 for most, 385 for the longest. Visit on foot first. An 18 to 35 second ride, and it runs in full: the fare buys the whole ride. | About 13 % of an hour's income at level 12 and 4 % at level 30: a decision early, a convenience late. |
| Ladder to 30 | **152 kills** with all three quests, ~200 without (section 3 shows the arithmetic). | Inside the 150 to 250 target; about 4 hours of play with the professions. |

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

- **Greywater Road**: the first time the player is *away*. Wolves and bandits, a toll camp on the road, a rare wolf. No gathering.
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
| Thornwick | **herbalism, alchemy** | alembic bench | Guard 350 g | vials |
| Highmoor | **leatherworking** | tanning rack | Colossus Blow 500 g, Last Stand 750 g | nothing: leatherworking is self-supplied |
| Sundered Spire | **enchanting** | rune circle | none (talent tiers cover it) | nothing |

The vendor in each town sells the previous tier's dropped gear at the existing `BUY_MARKUP` and never a crafting input except vials (vial value 1, bought for 4; a potion must never sell for more than its herb value plus 4, which the existing no-arbitrage check enforces if the recipe is added to it).

### 2.2 The new skills

All six are `SkillId` entries and `XpTrack`s on the shared curve. Gathering skills are `NODE_TYPES` entries (data in `gathering.ts`); crafting skills are `RECIPES` entries (data in `crafting.ts`). **The one structural change is that a recipe names a `station`** (`'forge' | 'range' | 'alembic' | 'rack' | 'circle'`, default `'forge'`) and `nearForge` becomes `nearStation(s, r.station)`. Mastery (`sim/mastery.ts`) applies to all of them unchanged: more levels above the requirement means quicker and, for stackables, a bonus yield.

**XP rules of thumb** (so a builder can add a rung without asking): a gathering action gives `0.42 x cost(L)` XP, where `cost(L)` is the XP from level L to L+1 (this reproduces iron 35 and mithril 80 to within a few percent); a craft gives `0.6 x cost(L)`, rounded to 5, because it consumes gathered stock. Raw material value is `2 + L` gold. Time per gather 3 to 5 s, 3 to 5 charges, 20 to 45 s respawn, like the nodes already there.

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
- **Death in a world this size has to cost something.** Today a death is free and you wake at the clearing. With a world, that stops working (you would wake 3 minutes from where you died). Wave 2 changes it: you **wake at the nearest town (by world-map distance from where you died) whose flight master you have found**, healed, and pay a **repair toll of 3 % of the value of what you are wearing** (a mithril set and Warden's Edge: 820 value, 25 gold; a full stormiron set at level 30: ~70 gold). If you cannot pay, you pay what you have; death never takes items and never takes more gold than you carry. Well Fed and every potion buff are cleared. This is a judgement about feel I cannot test; the toll is deliberately small so it nags rather than punishes. Tune `TOLL_FRAC` (0.03) before anything else if it reads as too kind or too harsh.

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

Mining, smithing and woodcutting keep their ladders and extend them: new ore (**adamant**, Mining 17; **stormiron**, Mining 26; **starmetal**, Mining 35), new logs (ash, Woodcutting 12; thornoak, 24; elderwood, 36), all as `NODE_TYPES` rows. A rock a long way from the forge is why **bars are carried home**: smithing stays at the forge in Hale (and gains a forge in each later town in wave 4, so the loop does not need a 6-minute walk).

---

## 3. The ladder to 30, then 40

### 3.1 The rules the ladder is built on

1. **Bands.** Every region has a level band. Content is built for a player of the band's level in the gear the band expects.
2. **XP parity, not flat XP.** One new rule: a kill's XP is `base x clamp(1 + 0.05 x (enemy − player), 0.1, 1.25)`, i.e. +5 % per level the enemy is above you (to +25 %), and **−15 % per level below** (to a 10 % floor). It is one line in `killEnemy`. It is what makes "appropriate content" a real thing: without it the Hollow Warden (900 XP, three kills a level) stays the best farm in the game forever. It also means existing enemies simply pay less to players who have outgrown them; no existing number changes.
3. **Trash XP at parity is `20 + L`**; an elite is 3x; a boss 10x; a rare spawn 6x. A normal pull is 85 % trash, 12 % elite, 3 % boss, so the mean kill is 1.51x trash.
4. **Time to kill** at parity gear: trash **11 s at level 12, rising 0.2 s a level to 14.6 s at 30**; elite ~3x that (35 to 45 s); boss ~8x (90 to 120 s).
5. **The fight costs health.** A trash fight at parity costs about **30 % of max health** after armour. That is the number that makes eating and resting a decision every second or third pull. Elites cost about 60 %, bosses about 100 % (a death without potions, food and the interrupt).
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

Time: 152 to 200 kills at 40 s a kill (11 to 15 s of fighting, the rest looting, regen, walking to the next camp) is **100 to 135 minutes of fighting**. Add three quests (~10 min each), gathering the ore for two metal sets, crafting, and the walk: **~4 hours, two or three evenings**. Pace comes from the curve, not from padding: kills per level start at 4 and end at 19, which is the RuneScape shape.

### 3.3 Gear tiers by band

Weapons add flat `damage` to every direct hit; armour feeds `armor / (armor + 40)` (cap 0.75). The line the enemies are tuned to is `weapon = 28 + 2.1 x (L − 11)`, `armour = 50 + 1.4 x (L − 11)` (four slots). Gear comes in steps, so TTK dips after each new set (a power spike) and drifts back up as the player levels: that is the point.

| Set | Mining | Smithing (bar / pieces) | Equip combat | Armour (helm / chest / greaves) | Blade | Capstone blade | `tier` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mithril (exists) | 9 | 7 / 8, 9, 10 | 9 | 12 / 22 / 16 = 50 | Warden's Edge 28 (Smithing 11) | (that is the capstone) | 4 |
| **Adamant** | 17 | 14 / 15, 17, 19 | 14 | 16 / 30 / 22 = 68 | Adamant Blade 40 (Smithing 16) | **Marrow's Edge 50** (Smithing 22, 3 Marrow shards) | 5 |
| **Stormiron** | 26 | 23 / 24, 26, 28 | 23 | 20 / 38 / 28 = 86 | Stormiron Blade 58 (Smithing 24) | **Rotroot Edge 72** (Smithing 29, 3 Heartwood shards) | 5 |
| **Starmetal** (wave 4) | 35 | 32 / 33, 35, 37 | 32 | 24 / 44 / 32 = 100 | Starmetal Blade 80 (Smithing 33) | **Crownbreaker 100** (Smithing 38, 3 Crown shards) | 6 |

- A bar is one ore plus coal: adamant 1 ore + 3 coal, stormiron 1 + 4, starmetal 1 + 5. A helm is 2 bars, greaves 3, a chestplate 4, a blade 3 + 1 log (ash, thornoak, elderwood respectively). Smithing XP per craft follows the rule in 2.2.
- **A new item field, `req: { combat?: number }`**, is read by the equip action. Legacy items have none (Warden's Edge and the mithril set stay unrestricted, so no old save breaks); every new set does.
- **Tier 5 and tier 6 are new.** Today `TIER_COLORS` stops at 4 (epic, purple). The rule that rarer must look better means **tier 5 (legendary) and tier 6 (mythic)** need art and colours: 3D Artist's call, but I would not reuse orange (tier 3 already owns it). Adamant and stormiron sets share tier 5; they must still look like different metals, which is bespoke art, not tier fallback. **If the fallback is all that exists, stormiron will look the same as adamant, and that is unworthy of 12 levels of grind: say so rather than ship it.**
- A full set at its band is a **power spike of roughly 20 to 25 %** in TTK terms over the previous set; the enemy tables are set on the line, so a crafted set puts the player a little *ahead* of it. A player who skips crafting and wears dropped iron (armour 20, blade 9 at level 20) is **far behind** and will die on elites. That is the pressure to mine and smith.

### 3.4 The enemies

Rigs are the five the game already has (`boar`, `wolf`, `brute`, `pup`, `hexer`), reused with `look: { model, scale, tint }` exactly as the cave does it. **No new rig is needed through level 30**; wave 4's colossus, golems and the Archmage will want their own.

How the columns are derived (so the table can be extended rather than argued with):

- **HP** = model DPS at that level × target kill time × role multiplier (trash 1, elite 3, rare 4, boss 8).
- **Hit** = the damage that makes a trash fight cost 30 % of max health after armour, scaled by swing interval and role (elite 1.2, rare 1.3, boss 1.3). It is the raw `damage` field; armour reduces it.
- **Heavy** is a telegraphed slam (`heavy` in `EnemyDef`, windup 1.6 to 1.8 s) for 30 % of max health after armour, interruptible with Pummel. Boss hazards (`hazard`) use the same figure at 3 to 3.2 radius.
- **XP** = `(20 + L)` × role multiplier (elite 3, rare 6, boss 10).
- **Respawn**: trash 30 to 45 s; elite 120 s; rare **30 minutes**; boss **10 minutes**.
- **Aggro radius** 8 to 12, as the cave's. `aggroRadius()` already lets a player who has outgrown an enemy walk past it.

**Greywater Road**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `marsh_hog` | Marsh Hog | 10 | trash | boar x1.3 | 415 | 35 | 2s | - | 30 | plain melee, charges (speed 5.2) |
| `road_wolf` | Greywater Wolf | 11 | trash | wolf | 470 | 33 | 1.8s | - | 31 | camp of 3 (pack 7): Cleave it |
| `footpad` | Footpad | 12 | trash | hexer | 530 | 46 | 2.4s | - | 32 | ranged knife: Pummel the throw |
| `toll_captain` | Toll Captain | 13 | elite | brute | 1785 | 54 | 2.2s | 195 | 99 | heavy Cudgel Slam; guards the toll camp |
| `old_grey` | Old Grey | 12 | rare | wolf x1.4 pale | 2120 | 40 | 1.6s | 180 | 192 | rare spawn: every third hit opens a bleed |

**Saltmarrow Strand**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `shore_crab` | Shore Crab | 14 | trash | boar x0.8 tint | 665 | 34 | 1.6s | - | 34 | quick, light hits |
| `drowned_sailor` | Drowned Sailor | 15 | trash | hexer | 745 | 59 | 2.6s | - | 35 | ranged harpoon |
| `tide_hag` | Tide Hag | 16 | trash | hexer x1.15 | 840 | 71 | 3s | - | 36 | ranged + Undertow ground hazard (the Seer tell) |
| `barnacle_ogre` | Barnacle Ogre | 17 | elite | brute x1.15 tint | 2790 | 71 | 2.4s | 250 | 111 | heavy Anchor Slam |
| `gutterhook` | Gutterhook | 16 | rare | boar x1.6 tint | 3365 | 55 | 1.8s | 235 | 216 | rare spawn: heavy claw |

**Drowned Grotto**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `captain_marrow` | Captain Marrow | 19 | boss | brute x1.5 tint | 9035 | 83 | 2.4s | 280 | 390 | boss: Anchor Slam + Cannon Volley (hazard) + Harpoon (ranged) |

**Dunmere Fens**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `fen_stalker` | Fen Stalker | 18 | trash | wolf tint | 1025 | 46 | 1.8s | - | 38 | plain, quick, pairs |
| `bog_witch` | Bog Witch | 19 | trash | hexer x1.1 | 1130 | 74 | 2.8s | - | 39 | ranged + Withering Ground |
| `mire_troll` | Mire Troll | 20 | trash | brute tint | 1240 | 67 | 2.4s | - | 40 | big trash: slam every 10 s |
| `bogfather` | The Bogfather | 21 | elite | brute x1.3 | 4070 | 83 | 2.4s | 310 | 123 | heavy + hazard |
| `mother_mire` | Mother Mire | 20 | rare | brute x1.7 tint | 4955 | 87 | 2.4s | 295 | 240 | rare spawn: hazard-heavy |

**Thornwood**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `thornback` | Thornback Boar | 21 | trash | boar x1.4 | 1355 | 54 | 1.9s | - | 41 | hits hard, dies fast |
| `rotwood_cultist` | Rotwood Cultist | 23 | trash | hexer | 1615 | 80 | 2.6s | - | 43 | ranged + hex |
| `blight_stag` | Blight Stag | 22 | trash | wolf x1.3 tint | 1480 | 53 | 1.8s | - | 42 | plain, quick |
| `thorn_warden` | Thorn Warden | 24 | elite | brute x1.3 | 5270 | 91 | 2.4s | 360 | 132 | heavy + hazard |
| `elder_thornback` | Elder Thornback | 23 | rare | boar x2 | 6460 | 80 | 2s | 345 | 258 | rare spawn: heavy gore |

**The Rotroot**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `rotroot_mother` | The Rotroot Mother | 26 | boss | brute x1.6 tint | 16750 | 105 | 2.4s | 395 | 460 | boss: Spore Cloud (hazard) + Root Slam (heavy) + Hex Bolt |

**Barrowdowns**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `barrow_wight` | Barrow Wight | 25 | trash | hexer | 1905 | 85 | 2.6s | - | 45 | ranged |
| `grave_hound` | Grave Hound | 26 | trash | wolf | 2095 | 57 | 1.7s | - | 46 | camp of 3: Cleave it |
| `cairn_brute` | Cairn Brute | 27 | trash | brute | 2265 | 83 | 2.4s | - | 47 | slam every 9 s |
| `barrow_lord` | Barrow Lord | 29 | elite | brute x1.4 | 7900 | 106 | 2.4s | 450 | 147 | heavy + hazard |
| `hollow_knight` | The Hollow Knight | 28 | rare | brute x1.5 pale | 9770 | 102 | 2.2s | 430 | 288 | rare spawn: two slams back to back |

**Highmoor Moor**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `moor_ram` | Moor Ram | 28 | trash | boar x1.5 | 2445 | 68 | 1.9s | - | 48 | charges |
| `moor_raider` | Moor Raider | 29 | trash | hexer | 2635 | 88 | 2.4s | - | 49 | ranged |
| `ridge_ogre` | Ridge Ogre | 30 | trash | brute x1.2 | 2835 | 91 | 2.4s | - | 50 | slam every 9 s |
| `stonehorn` | Stonehorn | 31 | elite | boar x2.2 | 9130 | 102 | 2.2s | 485 | 153 | heavy Gore + hazard |

**Cairn Hold**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `cairn_king` | The Cairn King | 32 | boss | brute x1.8 tint | 26120 | 123 | 2.4s | 505 | 520 | boss: Crown Slam + Falling Stone (hazard) + Grave Bolt |

**Cairnwaste**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `waste_reaver` | Waste Reaver | 32 | trash | hexer | 3265 | 95 | 2.4s | - | 52 | ranged |
| `dune_hound` | Dune Hound | 34 | trash | wolf | 3745 | 71 | 1.7s | - | 54 | camp of 3 |
| `sand_ogre` | Sand Ogre | 35 | trash | brute | 4000 | 103 | 2.4s | - | 55 | slam |
| `ashen_colossus` | Ashen Colossus | 36 | elite | brute x1.5 | 12955 | 126 | 2.4s | 585 | 168 | heavy + hazard |

**Sundered Spire**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `spire_adept` | Spire Adept | 36 | trash | hexer | 4320 | 113 | 2.6s | - | 56 | ranged |
| `void_hound` | Void Hound | 37 | trash | wolf tint | 4605 | 76 | 1.7s | - | 57 | camp of 3 |
| `rune_golem` | Rune Golem | 38 | trash | brute tint | 4900 | 110 | 2.4s | - | 58 | slam |
| `spire_warden` | Spire Warden | 39 | elite | brute x1.5 | 15640 | 134 | 2.4s | 650 | 177 | heavy + hazard |

**The Sundered Vault**

| id | Name | Lv | Role | Rig | HP | Hit | Swing | Heavy | XP | Tell |
|---|---|---|---|---|---|---|---|---|---|---|
| `archmage_vael` | Archmage Vael | 41 | boss | hexer x1.6 | 46600 | 177 | 2.8s | 695 | 610 | boss: ranged barrage, two hazards, heavy on anyone in melee |

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

That is about **5,750 kills, ~64 hours** of combat from 40 to 99, the shape of a RuneScape grind. The gathering and crafting skills run the same curve at 3 to 5 s an action; the 40 to 99 node ladders (a new ore, log, fish and herb every 8 to 10 levels, each only in a farther region) are the long tail, and **`MAX_LEVEL` stays 99**. Regions past the Spire are not designed here. The rule above is what they follow when they are.

---

## 4. The mount at 30

**Decision: gated on total level, 120, not combat 30.**

*Why not a literal total level 30.* The four existing skills at the levels of a player who has finished the first quest chain (combat 11, mining 9, smithing 11, woodcutting 5) already total 36. A gate that a player passes at combat ~10 gates nothing. Total level is only a meaningful axis if the threshold grows with the number of skills.

*Why total level and not combat.* Gated on combat 30, the mount is a reward for the player who only fights, who can stay out of every town's profession. Gated on total level, it is a reward for being a citizen of the world: **the mount means you have learned something in every town.** That is the RuneScape shape. And it costs the fighter almost nothing: a player at combat 30 has total 30 + 9 skills at 1 = 38, so they are ~82 levels short, which is eight skills at about level 11 (1,358 XP each). roughly **an hour for all of them** with mastery's speed-up, and the road to Highmoor passes every profession on the way.

*The number.* 120 = combat 30 plus an average of ~11 in the other eight skills (wave 3: nine skills; in wave 4, with enchanting, it is combat 30 plus an average of 10 across nine). Show the player a **`Total level 94 / 120`** line on the skills screen; seeing the target is half the motivation.

| | |
| --- | --- |
| Acquired | The **Stablemaster at Highmoor** (west edge of town): total level ≥ 120 and **1,000 gold**. The mount appears as an ability toggle and a key (one `mounted` flag in player state, saved). |
| Speed | **10 units/s** against 6: ×1.67, about WoW's 160 % ground mount. Crossing a 900-unit road takes 90 s instead of 150. Jump unchanged. |
| Mounting | A **1.0 s cast**, stationary, interrupted by damage or movement. **Not in combat, not in dungeons, not while gathering or crafting.** Free dismount. |
| Dismount | **Any damage** from an enemy (a ranged bolt dismounts you; so does a heavy you ride into) and **any ability key** (the ability fires on the same tick, so it feels continuous, not like a punished misclick). Interacting with a node, forge or NPC dismounts. |
| Aggro | Unchanged: you are not harder to see. Enemy speeds are 3.8 to 5.6 and **cannot catch a mount**: it is a way past camps, not through them. Ranged camps on the road are what make that interesting: you can be shot off the horse. |
| Combat while mounted | None. No auto-attack, no abilities until dismounted. |
| Cosmetic | The mount skins in section 6 are rare drops and change only the model. |

**Why 1,000 gold.** That is about 20 to 25 minutes of income at level 30 (section 7): the first big purchase, not an impulse one.

**Art obligations to 3D Artist and Game Engineer:** a mount and a mounted rider pose; the speed constant becomes `moveSpeed(player)`; the camera pulls back and the FOV opens slightly mounted. I cannot judge whether 10 u/s feels fast or just loose with the existing camera: the first thing to try is 9 to 11, and the thing to watch is whether the click-to-move arrival still reads at that speed.

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

Income comes from the loot rule in 3.4 (value per kill `0.6 x L + 3`, times the pull mix 1.4) at **90 kills an hour** (40 s a kill):

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
| Mount | 1,000 |
| Ability trainers (120 + 200 + 350 + 500 + 750) | 1,920 |
| Flights (about 8 at ~190) | 1,500 |
| Potions and vials | ~600 |
| Repair tolls (~10 deaths at ~40) | ~400 |
| **Total** | **~5,400** |

That is **above** the income, deliberately: **a player cannot buy everything by 30**. They choose between the two top abilities, flights, and the mount, and the ones who walk have the gold. The gap is the gold sink the economy lacked. The cheapest thing to cut if it reads as grim is the repair toll; the cheapest to raise if it reads as slack is the trainer price.

---

## 8. Waves, new systems, asks, and what I could not check

### 8.1 What each wave builds

**Wave 2: the second town and travel.** The regions refactor (parallel). Hale's east gate. Greywater Road (all 4 trash + the Toll Captain + Old Grey). Saltmarrow town and Strand (shore crab, drowned sailor, tide hag, Barnacle Ogre, Gutterhook). **Fishing, cooking** and the `station` field. **Food** (not potions yet), Well Fed. Flight masters at Hale and Saltmarrow (175). The **world-map mesh** and ride. Safe zones. Death at the nearest found town and the repair toll. The XP-parity rule. Q3 The Salt Road. Whirlwind and the trainer. **Adamant** ore, bars and set (Mining 17, equip combat 14), tier 5. Named pieces: Greywolf Hauberk and Gutterhook's Cap.

**Wave 3: the climb to 30 and the mount** (large: ship as 3a and 3b).
- **3a (to combat ~24):** Grotto, Dunmere Fens, Thornwick with **herbalism, alchemy**, potions, the Rotroot. Rupture, Guard (+ the `guard` kind and potion buffs). Talent tiers 3 and 4 and their cap. Stormiron. Q4 and Q5. Named pieces from Marrow, Mother Mire, Elder Thornback, the Rotroot Mother.
- **3b (to 30 and the mount):** Barrowdowns, Highmoor, Cairn Hold. **Leatherworking** and the **`hands` / `feet` slots**. Colossus Blow, Last Stand. Total-level gate and the Stablemaster, the mount (speed, mount cast, dismount rules), Q6. The pity counter. The headless drop-value check. All remaining flights.

**Wave 4: the remaining towns and the long tail.** Cairnwaste, the Spire and the Vault (levels 32 to 41), starmetal, **enchanting** and slot enchants, a forge in each later town, mount skins, the 40 to 99 node ladders, the first tier 6 art, Q7.

### 8.2 New systems (everything else is data)

Ten, each small, each named so it is not a surprise:

1. **Regions and gates** (the navigation refactor, parallel): per-region entity lists, frozen regions, catch-up on entry.
2. **Flight**: one new `action` kind, the found-masters set in the save.
3. **Mount**: a `mounted` flag, `moveSpeed(player)`, mounting rules.
4. **Consumables and buffs**: `ItemDef.use` (heal, energy, a buff), a shared food and a shared potion cooldown, buff timers (`wellFed`, `stoneskin`, `fury`, `titan`), cleared on death. The biggest of the ten; ~150 lines in a new `sim/consumables.ts`.
5. **Equipment extensions**: `hands` / `feet` slots, `req` on items, slot enchants (wave 4).
6. **Ability extras**: `weaponMult`, trainers and a learned-abilities list, the `guard` kind.
7. **The XP-parity multiplier** (one line).
8. **Safe zones** and **respawn at the nearest found town** with the toll.
9. **Pity counters** for named drops.
10. **Recipe `station`** (a field and `nearStation`).

### 8.3 Asks of other roles

- **Game Engineer**: the region and gate transitions (fade, async preload); the world-map screen and its mesh; the flight ride camera; 11 ability slots; the food and potion buttons; the mount toggle and the total-level readout; the `Total level` line; fishing spots and herb patches on the existing node interaction (they are `NODE_TYPES` rows, so no new click path).
- **3D Artist**: tiers 5 and 6 (colours, glow); a look per metal set, not only a tier fallback; `hands` and `feet` looks per leather set; eight named pieces; a mount and a rider pose; a flying mount for the ride; a fishing spot, herb patch and tanning rack; rigs for the Ashen Colossus, Rune Golem and the Archmage (wave 4). **Where tier fallback would give a set a look unworthy of its grind, say so rather than let it ship.**

### 8.4 What I tuned, what I compared it to, what I could not verify

- **Model**: a greedy Strike / Crushing Blow / Serrated Throw loop with auto-attack at 80 % efficiency, and talents plus the new abilities adding up to +40 % damage by level 40 (+25 % by level 30). That yields **48 DPS at level 12 and 194 at level 30**, against the Hollow's 54 DPS at level 11 with Warden's Edge, which is the existing game I can check against: it reproduces the cave's 20 to 30 s elite fights.
- **Compared against**: the cave's existing enemies (trash ~320 HP and 6 s at level 7 to 9; elites 1,250 HP in ~23 s; the Warden 1,600 HP in ~30 s). The new trash at 11 to 15 s is **deliberately slower than the cave's trash**: mid-tier content should feel like a fight, not a swat.
- **Could not verify by play**: every TTK figure (the model is analytic and the real rotation is messier and lower), the 30 % health-per-fight cost, how the sawtooth after a new set feels, mount speed 10, ride length, whether 40 s a kill is the real loop time, and whether 152 kills is a satisfying number. The first three should be checked with a headless bot fight before wave 3 commits enemy HP; the mount and ride speeds need a person.
- **Existing balance this changes**: the XP-parity rule reduces the pay of the cave's enemies for anyone above level 11, and the Warden stops being the best farm. That is intended, and no existing number changes. **The golden-path checks that kill things to level up will need an update when wave 2 lands the rule: say which, and why, in that task.**
- **A headless check to add in wave 3**: each enemy's drop table has an expected sale value within 15 % of `(0.6 x L + 3) x role`; XP follows `(20 + L) x role` at parity; kills from 11 to 30 on the model is within 150 to 250.

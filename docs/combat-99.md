# Combat to 99

What it costs to put combat levels 42 to 99 in this game, where the enemies for them come from, and the repeatable objective that gives a player a reason to open the game tomorrow (HOM-162). No code ships with this document: it is the spec the build cards work from, written the way `docs/world-design.md` and `docs/action-layer.md` are.

**The board has ruled that combat goes to 99, so this document prices that and does not argue it.** Nothing below makes it impossible. It does make it expensive in one specific place, and says where.

**Method.** Every figure was computed against the sim as it stands at `3414cae`, with throwaway scripts run through `tsx` against `src/sim/` (`xp.ts` for the curve, `data.ts` for the 51 enemy rows, `XP_PARITY`, `powerForLevel` and `maxHpForLevel`; `items.ts` for the armour cap and the gear). **No benched number appears in this document.** Where it quotes a measurement it is the bible's, with the speed the bible took it at. The enemy model is 3.4's, which is within ±2 % of a headless bot from level 10 to 32; **everything above level 41 is that model extended, and nobody has measured it there** (section 9).

**HOM-125 is settled, so nothing here derives from the uncorrected numbers.** The bible's 3.4 and 3.4a already rule it: the Cairn King is 118 s on the line gear (HOM-118's 177 s was a 50-damage Marrow's Edge at level 32), and the elite rows span the dodge column they were measured in at `--fast 1`. The band above 41 is derived from the model (HP from a target time to kill, hit from a target health cost), never from a bracket, so the 25 to 80 % spread does not enter it.

**I cannot play the game.** Whether 31 minutes a level is a pleasant number or a chore, and whether a person reads a 1.7 s telegraph at level 80, are exactly what arithmetic cannot say. Section 9 lists what I could not verify and the one constant that moves each.

## The calls

| Question on the card | Call | Why, in one line |
| --- | --- | --- |
| Is "level curve exponential, reward curve linear" right? | **Yes, to the digit.** Every one of the 42 enemy rows from level 10 sits on `trash = 20 + L`, elite 3x, rare 6x, boss 10x, except the Hollow Warden (29x). At the rule as shipped, **41 to 99 is 84,202 mean kills, 936 hours**; level 80 alone is 15,173. | 1.1, 1.2 |
| The board's flat 56 kills a level | **Right shape, wrong baseline and the bot's clock.** 56 is *trash* kills, which is 39 mean kills; the bible already prices level 40 at 46, so the table is 15 % faster than the pace it joins. And "22 hours" is a bot at 24 s a kill: **25 to 28 hours at a person's 40 to 44 s**. | 1.2 |
| How long should 41 to 99 take | **44 hours at a person's pace, about 52 from a new character.** Kills a level rise from 46 at level 40 to **90 at level 98**: a level takes 31 minutes at 41 and 60 at 98. One coefficient (`K98`) moves it: 46 is 30 hours, 150 (the bible's 3.6) is 64. | 1.3 |
| The XP rule above 40 | **`enemyXp(E, role) = cost(E) / (1.4345 x kpl(E))` times 1 / 3 / 6 / 10**, with `kpl` linear from 46 at 40 to 90 at 98. Continuous with `20 + L` at 40 (59.8 against 60). A level-80 trash kill pays 1,888; a level-45 one 91. | 2 |
| **Where do level 42 to 99 enemies come from** | **Echoes: the enemies that already stand in the world, respawning as copies at your level once the Seal is broken.** The same 177 spawn points, the same rigs and tells, stats from a formula, XP from the rule above. No new region, row or placement. | 3 |
| `XP_PARITY` | **Does not move.** Step 5 %, floor 10 %, ceiling 125 %. The enemies come up to meet the player, so the floor never binds on the road; where it binds it is doing its job. | 4 |
| The Hollow Warden | **900 XP becomes 310 (the boss rule) and its respawn 180 s becomes 600 s.** A windfall belongs in a quest lump, which is paid once, and not on a body that comes back. Not applied: it edits one assertion (`golden-path.test.ts:3653`). | 5 |
| What fills 58 empty levels | **A blade every 8 levels from 48 (seven), one last armour step at 48, a talent row that takes the 44 points that have nowhere to go, and a new ability every 10 levels from 50 (six).** Armour has 13 % left in it, so the ladder past 48 is weapons, talents and abilities. | 6 |
| **HOM-181**: the ladder is a dividend; Hard at 90 is nearly free; the pair is a speed-up; shooters get nothing | **An ignored tell hits for its stake (mark 1.6, slam 2.2) on Standard and Hard, and Easy keeps the dividend; Hard stays +3 and costs the read, 1.3 to 1.4x XP an hour; a pair body pays 0.88; the net at 92 is out.** | 3.10 |
| **HOM-192**: the full kit kills an Echo in 6 s | **The Echo is priced against the character (the talents a level has), not the line; K98 stays 90.** Shipped, the game was 27 to 30 hours (the board's 30); re-priced it is 46 with talents alone and 42 with the six abilities (44). The six-second floor was a first pull. The ladder survives; the stakes go 1.6 -> 3 and 2.2 -> 4; a Pummel on 1 s is a separate card. | 10 |
| The repeatable objective | **Writs: 2 a board, in each of the five towns, refilling 20 hours after you hand one in.** Ask 12 trash-kills' worth; **pay the same again** as a bonus, indexed on your level at hand-in, plus an Echo mark. **A supplement**: a full daily tour takes about 25 % off the road, and nothing caps the kills. | 7 |
| HOM-163's shape (landed at `96d05d5`) | **The loop is right and the table stays a table. Four changes:** a reward that resolves against `trashXp(level)` instead of a linear `Scale`, a 20-hour refill per bounty (today it is on offer again at once), the enemy's level on the kill, `finishable` that knows about Echoes. | 7.4 |

---

## 1. The arithmetic, checked

### 1.1 It is right

| Level | XP to next | Trash XP today | Trash kills for a level | Trash XP if it doubles every 7 levels (pinned to the Rune Golem's 58) | Trash kills for a level |
| --- | --- | --- | --- | --- | --- |
| 20 | 548 | 40 | 14 | | |
| 41 | 4,358 | 61 | 71 | 78 | 55.8 |
| 60 | 28,546 | 80 | 357 | 512 | 55.7 |
| 80 | 206,750 | 100 | 2,068 | 3,712 | 55.7 |
| 98 | 1,228,825 | 118 | **10,414** | 22,064 | 55.7 |

Cost per level grows 10.40 % a level and doubles every **7.00** levels (`xp.ts`: `floor(l + 300 x 2^(l/7)) / 4`). The Rune Golem pin gives 55.7 to 55.8 trash kills at every level from 41 to 98, so the board's result stands. The shape is real: XP to 99 is **12,993,260 above level 41, against 41,171 to reach it**, level 92 is the halfway mark of all XP, and levels 93 to 99 are the other half.

### 1.2 What the table does not say

1. **"Kills" are trash kills, and nobody fights only trash.** 3.1 puts the mean kill at 1.51 x trash by XP and 0.95 for drift: **1.4345**. 56 trash kills is 39 mean kills. 3.6 prices **level 40 at 45 mean kills** (3,947 / 88 XP a mean kill), and `20 + L` itself gives 46 (3,947 / 86), so a pin at 58 on level 38 leaves a 15 % step down in the pace at 41, for nothing. I pin to continuity instead: 46 mean kills at level 40.
2. **The hours are a bot's.** 3,250 trash kills at 24 s is 21.7 hours; the same kills as 2,270 mean kills at the bot's 33.6 s is 21.2. 3.7 ruled that a person is about 1.3x slower and that the mean kill a *person* takes is 40 s (44 at the extreme), which is the figure 3.6 and 5.4 already use. **At 40 s the flat curve is 29.6 hours, not 22.**
3. **3.6 already ruled 40 to 99 and nothing built it.** It asked for kills a level rising from 45 to 150 and costed 5,750 kills, 64 hours. Every row stops at level 41, so the sim has no rule above it: XP per kill is still `20 + L` at level 98. **That is the state the board's number was taken from, and it is 936 hours** (84,202 mean kills at 40 s), 169 of them to level 80. Section 2 is 3.6 built, with its constant revisited.

### 1.3 Pace is one coefficient, and here is what it buys

Kills a level (mean kills), linear from 46 at level 40 to `K98` at level 98. Hours are a person's, 40 s a mean kill; minutes are what one level takes.

| `K98` | Mean kills 41 to 99 | Hours to 99 (33.6 s bot / 40 s / 44 s) | At 40 s: to 60 | to 80 | to 90 | A level at 41 | at 98 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 46 (flat) | 2,668 | 24.9 / **29.6** / 32.6 | 9.7 h | 19.9 h | 25.0 h | 31 min | 31 min |
| 70 | 3,376 | 31.5 / 37.5 / 41.3 | 10.6 | 23.5 | 30.7 | 31 | 46 |
| **90 (recommended)** | **3,966** | **37.0 / 44.1 / 48.5** | **11.3** | **26.5** | **35.4** | **31** | **60** |
| 120 | 4,851 | 45.3 / 53.9 / 59.3 | 12.4 | 31.0 | 42.4 | 31 | 80 |
| 150 (3.6) | 5,736 | 53.5 / 63.7 / 70.1 | 13.5 | 35.5 | 49.5 | 32 | 100 |

**I recommend 90.** Three reasons, in the order I would defend them:

1. **Flat makes 99 an ordinary level.** At `K98 = 46` every level takes 31 minutes whether it is the 42nd or the 98th. A player is always one quiet half-hour from the next number, which is a fine rhythm and a poor ending: nothing says "this one is the last". A ramp to 60 minutes a level makes the top *feel* longer than the middle, without making any single level a wall.
2. **150 is more hours of one loop than the content can carry.** Section 3 is a single activity: fight the world at your level. Past about 45 hours it is the same fight at plus 1 % numbers, and the hours would be spent on the part of the game that varies least. 3.6 chose 150 before there was an answer to where the enemies come from; with the answer it is the one number I would take back.
3. **90 is the middle of the table and the cheapest to move.** If a playtest finds 31 to 60 minutes a level is too slow, `K98 = 70` is 37.5 hours; if it finds 99 arrives too quickly, 120 is 54. It is one constant in one function.

**What I did not do is treat "level 92 is the halfway point" as the clock.** It is a fact about XP. The clock is kills, and under this rule a level-90 player is at **80 %** of the hours to 99 and a level-92 one at 85 %, not 50.

### 1.4 The precedent that makes this safe

The gathering skills already work this way: a swing pays a fixed share of the cost of *its own node's level* (Stormiron Mining 40 pays 475 XP and Starmetal Mining 52 pays 1,550: `0.12 x cost`, asserted in `barrowdowns.test.ts:158` and `cairnwaste.test.ts:175`), and a new node arrives every 8 to 10 levels. Reward follows the level curve in every skill but combat, which is the only one whose rows were authored against `20 + L`. Combat 42 to 99 is combat being brought in line.

---

## 2. The rule above 40

```
cost(L)    = xpForLevel(L + 1) - xpForLevel(L)
kpl(L)     = 46 + (K98 - 46) x (L - 40) / 58           mean kills a level, K98 = 90
trashXp(E) = E <= 40 ? 20 + E : cost(min(E, 98)) / (1.4345 x kpl(E))     the one function the writ and the Echo share
enemyXp(E, role) = round(trashXp(E) x { trash 1, elite 3, rare 6, boss 10 })
```

The role multipliers are 3.1's and are time-fair: an elite is about 3x a trash fight and a boss about 8x (3.4), so a writ's "12 trash, or 4 elites, or a boss" costs the player about the same minutes whichever it asks. `E` is the enemy's level; the kill pays `enemyXp(E, role) x xpParity(E, L)` as every kill does. `enemyXp` is the one new function. It prices **Echo rows**; the authored rows keep their `xp`, which the rule already agrees with (Vael's 610 against the formula's 650 at level 41: 6 % high, the price of continuity at 40 and not worth a row edit).

| Level | Cost to next | Kills a level | Trash | Elite | Rare | Boss | Mean kill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 3,947 | 46 | 60 | 179 | 359 | 598 | 86 |
| 45 | 6,471 | 50 | 91 | 272 | 544 | 906 | 130 |
| 50 | 10,612 | 54 | 138 | 414 | 828 | 1,381 | 198 |
| 60 | 28,546 | 61 | 325 | 976 | 1,952 | 3,253 | 467 |
| 70 | 76,818 | 69 | 779 | 2,336 | 4,673 | 7,788 | 1,117 |
| 80 | 206,750 | 76 | 1,888 | 5,664 | 11,327 | 18,878 | 2,708 |
| 90 | 556,499 | 84 | 4,622 | 13,866 | 27,733 | 46,221 | 6,630 |
| 98 | 1,228,825 | 90 | 9,518 | 28,554 | 57,108 | 95,180 | 13,654 |

The `min(E, 98)` is because level 99 has no next level to pay toward: a level-99 Echo pays what a level-98 one does. XP past 99 keeps accumulating on the track and buys nothing; I have not ruled what 99 *gives* (a cape, a title) because the card did not ask.

---

## 3. Where the enemies come from

### 3.1 The reframe that decides it

A level-99 enemy cannot be 381 times a level-41 one, because the player is not. Player power from levels is `1 + 0.07 (L - 1)`: **x2.07 from 41 to 99**, and max health x2.24. Add a weapon on the existing line (`W = 36 + 2.6 (L - 16)`, 6.2 below) and damage per second is x4.86. Enemy trash HP on that line goes from **4,989 at level 41 to 24,057 at 99, x4.8**, and its hit from 143 to 371, x2.6. XP per kill goes **x381**.

So above 40 **the number printed on an enemy stops being a measure of how hard it is and becomes the currency it pays in**, exactly as a mining swing's XP already is. That is what makes Echoes possible: difficulty is a modest, calibrated line; the reward is the exponential; the two are joined by one function (section 2) and no row has to be authored per level.

### 3.2 The options, priced

| Option | What it costs | What it does not fix |
| --- | --- | --- |
| **Author levels 42 to 99** | Waves 1 to 7 built 31 levels as 42 rows from level 10, 177 spawn points, five towns and five dungeons. Scaled by 58 / 31: **about 80 rows, 330 placements, 19 more places**, on five rigs. | It is the whole project to date again, for the fight of "a bigger one of the same". |
| **A few authored high-level zones** | Seven zones of 8 levels, each with a boss. The cheapest honest version of the above. | Seven places is a project the size of waves 3 and 4, and a player who has cleared one zone for its 8 levels has nothing to do at level 51. |
| **Scale the whole world to the player** | Almost free in the sim. | It deletes the outgrown ground: Hale's boars at level 70 become a threat to the player mining copper, a new character's world changes under them, and nothing is a place any more. |
| **Echoes** (recommended) | One formula, one switch, a tint. **No new row, placement or region.** | The fight is the existing fights; novelty comes from the tell ladder (3.4), not new rigs. |

I considered the Slayer-style task (RuneScape's answer) as the *supply* and rejected it as one: a task needs something level-appropriate to point at, which is the question. It is the right shape for the **reward** and is section 7.

### 3.3 What an Echo is

- **Unlocked by the Seal.** The Echo switch appears when `quest.eighth` is `done`: Vael's seal is what was holding the dead regions down. (The lore is one line; the gate is that Vael, the last authored row, is behind you.) Before that nothing changes for anyone.
- **One setting on the player**: `echo: null | -3 | 0 | 3`, off, **Easy, Standard, Hard**. It is a menu switch, not a place.
- **What it does.** When an enemy that stands in the world respawns (or is first loaded) with the switch on, it becomes an **Echo row**: the same species, rig, tells, spawn point and respawn time, with level `E = clamp(L + d, 42, 99)` where `L` is the player's combat level at that moment. Its stats are the original's, scaled by the two ratios in 3.5. Its XP is `enemyXp(E, role)`. The name plate shows `E`, and the 3D Artist tints it (section 8).
- **It is not instanced and not a dial per region.** The world is the world; the switch changes what the fixed spawn points hold. Turning it off returns the authored rows at their next respawn. Echoes are not offered in a safe zone, and a fight in progress is not rescaled.
- **Loot.** The original's table, plus **Echo marks** (section 7): 1 an elite, 3 a boss, 1 a writ. Gold per kill is the bible's `0.6 L + 3` at `E`, unchanged.

### 3.4 Why Easy, Standard and Hard, and why Hard stops at plus 3

The reward grows with an enemy's level much faster than the fight does. Per level above you, the XP is about **+9 % from the curve and +5 % from parity**, while an enemy's HP and hit rise about **3 % and 1.5 %** (60 to 65 on the line gear). So whatever offset is allowed, a player picks the highest, and the highest is therefore the real difficulty and ought to be a number chosen on purpose.

A level-60 player, line gear, against an Echo at `L + d`. HP, hit and health cost are the fight against Standard's; the cost is the product of the other two (more hits landed over a longer fight):

| Setting | `d` | Parity | Curve vs `E = L` | **XP per kill vs Standard** | HP | Hit | Health cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | -3 | 0.85 | 0.77 | **0.66x** | -9 % | -5 % | -13 % |
| Standard | 0 | 1.00 | 1.00 | **1.00x** | the line | | |
| Hard | +3 | 1.15 | 1.30 | **1.49x** | +9 % | +5 % | **+14 %** |

The XP ratios hold at 0.65 to 0.66 and 1.48 to 1.51 from level 50 to 90; the cost is +17 % at 50 and +10 % at 90, because a level is a smaller share of a bigger player (and Hard at 47 or Easy at 50 crosses the armour step at 48, which moves it ten points). Hard pays about 49 % more XP for 10 to 17 % more health cost (**HOM-181, 3.10: that is the ignoring player's number, and above 70 the health a player who reads pays is under a point; Hard's price is the read**). That is a lot, and it is the point: it is the one place a person who reads telegraphs well is paid for it, the opposite of the elite brackets in 3.4a, which price the same skill only in survival. **+5 would be 1.93x for +24 % cost, which is where I stopped.** The ceiling is `ECHO_MAX_OFFSET = 3`.

### 3.5 The stats

The bible's 3.4 model is parametric in level, which is what lets a row be generated. The rows it produced for levels 10 to 41 are its output at that level; an Echo row is the same row at `E`, so **every hand-placed variation in the template (the pack discount, a shooter's lower cost, a heavy's size) is kept by ratio**. For a row of level `b` at `E`:

```
DPS(L, W)  = ((20 + W) + 3 (8 + W)) x power(L) / 6 x 1.05 + (4 + 0.15 W) x power(L) / 2.4      (3.4, unchanged)
W(L)       = 36 + 2.6 (L - 16)                          the weapon line (3.3), extended
TTK(b)     = 9.4 + 0.2 (b - 17)    for the template;   TTK(E) = 14.2 for every Echo   (held at level 41's value)
hp_E       = hp_b x (TTK(E) + 1) DPS(E, W(E)) / ((TTK(b) + 1) DPS(b, W(b)))
damage_E   = damage_b x [maxHp(E) / (TTK(E) x (1 - red(A_E)))] / [maxHp(b) / (TTK(b) x (1 - red(A_b)))]
```

`damage` applies to the swing, `heavy.damage`, `hazard.damage` and a ranged hit alike, so each keeps its **share of the player's health**. `red(A) = min(0.8, A / (A + 40))`, `A_b = 60 + 2.2 (b - 16)` as the bible has it, and **`A_E` is the armour the player really wears: 133 up to level 47 (the starmetal set, 100, and Moorhide gloves and boots, 33) and 160, the cap, from 48** (section 6.2). The model reproduces the Rune Golem to the digit (HP 4,216 against 4,215, hit 120 against 120).

**TTK is frozen at 14.2 s, level 41's, instead of rising 0.2 s a level to 26 s at 99.** *(HOM-192, 10.2: for the character a level has, with its talents spent. For the bare line it was 8 s of an Echo, and the HP column below is the line's, to be multiplied by the talents' 1.15 to 1.9.)* The pace in section 1 is kills; every second added to a kill is an hour added to the road, so the bible's drift stops where the bible's rows do.

| Row | Level `b` to `E` | HP | Hit | Heavy | XP |
| --- | --- | --- | --- | --- | --- |
| `rune_golem` (trash) | 38 to 56 | 4,215 to 8,559 | 120 to 219 | | 58 to 230 |
| `rune_golem` | 38 to 80 | 4,215 to 16,245 | 120 to 304 | | 58 to 1,888 |
| `spire_warden` (elite) | 39 to 70 | 13,395 to 38,255 | 140 to 306 | 605 to 1,323 | 177 to 2,336 |
| `stonehorn` (elite) | 31 to 99 | 8,170 to 72,170 | 106 to 391 | 440 to 1,623 | 153 to 28,554 |
| `archmage_vael` (boss) | 41 to 99 | 39,915 to 192,463 | 81 to 234 | 650 to 1,881 | 610 to 95,180 |

A level-99 Vael is 192,463 HP against 1,583 DPS on the line gear, **122 seconds**, two over 3.4's 95 to 120 for a boss; his 1,881 slam is 376 after armour, 24 % of 1,570 health, which is the bible's share for a boss with two attacks. Factors for the Rune Golem, `b = 38`: HP x1.23, 1.55, 2.03, 2.57, 3.18, 3.85, 4.59, 5.39 and 5.71, hit x1.22, 1.59, 1.82, 2.06, 2.30, 2.53, 2.77, 3.01 and 3.09 at `E` = 42, 48, 56, 64, 72, 80, 88, 96 and 99.

### 3.6 The tell ladder: where the novelty comes from

"The same wolves with more health" is 58 levels of one fight. The game already has five tells (`heavy`, `hazard`, `ranged`, `net`, `pack`) and a player who has learned them. **An Echo row gains tells it did not have, from that set, as `E` climbs.** No new engine rule.

| `E` | Every Echo trash row gains | What a player learns | Share of the fight's health cost it carries, landing once |
| --- | --- | --- | --- |
| 42 to 55 | nothing | the numbers: the adjustment, about 9 hours at 40 s a kill | |
| 56 to 69 | **a ground mark** (the Seer's, radius 3, every 8 s) | keep moving | 15 % |
| 70 to 83 | **a slam** on every melee row (the Ogre's, 1.7 s wind-up, Pummel or step out) | read the telegraph on a body you used to ignore | 30 % |
| 84 to 99 | **a pair**: each trash row arrives with a mate, 3.4's pair discount (HP x 0.85, hit x 0.7 each) | Cleave and Whirlwind come back | the pair costs 47 %, two kills |

**A tell takes its share out of the auto-attack's budget; it does not add to it.** 3.4 sizes a slam or a mark as a share of *max health per landing* (24 to 30 % and 10 %), which is the right figure for an elite's 65 to 85 % fight and the wrong one for a 14-second trash fight, where one slam would be the whole budget. So an Echo trash tell is sized so that **landing once costs the share in the table's last column of the fight's 25 to 30 %, and the swings are cut by the same points.** A player who answers nothing pays what the pace model says (25 to 30 %, 28 for a big one, 15 for a ranged one), and one who answers the tells pays less. **(HOM-181, 3.10: that is Easy. On Standard and Hard an ignored tell hits for its stake, so a player who answers nothing pays 35, 46 and 76 % at 60, 75 and 90 and the dividend is a demand.)** Elites and bosses already carry both a slam and a mark and gain nothing from the first two rungs. A pair is neutral per kill (each member costs about 23 %, and each pays its own XP), and kills 15 % faster per body; **what it does to the loop's rest time is unmeasured.** *(Measured in 3.9 and 3.10: it is 14 to 16 % faster an hour, and a body pays 0.88.)* The 3.4a caveat applies in full: **whether a person reads a 1.7 s telegraph is the unknown the tier turns on**, and the bench measures it at `--fast 1` only. Check 3 in 8.1 is the one that holds the share to the model.

### 3.7 What it costs

- **Sim (mine).** `enemyXp`, the two ratio functions, `echoRow(def, E)`, the setting in the save, the respawn rule, the tell ladder as data. The one invasive piece: **37 places read `ENEMY_TYPES[...]`** (9 in `combat.ts`, 1 each in `quest.ts` and `admin.ts`, 3 in `sim.ts`, 14 in `render.ts`, 8 in `hud.ts`, 1 in `voices.ts`), and an Echo enemy needs them to read the *instance's* stats. The fix is `defOf(enemy)`, one function every site calls. The 11 under `src/sim/` are mine; the 26 in `sim.ts`, `render.ts`, `hud.ts` and `voices.ts` are Game Engineer's, and I need them to take it.
- **Game Engineer.** The Echo switch (a menu row), the level on the name plate, `defOf` in the renderer and HUD, the writ board (section 7).
- **3D Artist.** An Echo tint per band: no new rig. Section 8 has the ask.
- **Not needed:** a region, a placement, a spawn row, a rig, a map.

### 3.8 The risk, said plainly

**An Echo is the fight you already know.** Section 3.6 is the only thing standing between 44 hours and 44 hours of one pull. Past level 55 the player has a ground mark to keep moving through, past 69 a slam to answer, past 83 a pair to sweep; there is nothing after 84. If that proves too little the levers are, in order: another tell at 92 (the Footpad's net, to the ranged rows; **tried and ruled out in 3.10**), `K98` down to 70, or a second authored place. I would watch the first before spending any of the others.

### 3.9 Landed (HOM-174): what the build found

`src/sim/echo.ts` is 3.3 to 3.6 as data and rules; `src/echo.test.ts` is checks 3, 4, 5 and 6, in `npm run verify`; `src/echo-bot.ts` is the bench's bot (`bench/combat.mjs --mode ttk`) on the real sim at one decision a tick (`--fast 1`), without the browser. The ratios reproduce 3.5's table to the digit (the Rune Golem 4,216 HP and 120 hit, its nine factors, the Warden, Stonehorn and Vael rows), and a bot takes the model's time and loses the template's share of health at E = 42, 60, 80 and 99 for the four rows of the check. **Seven things the build did that the text above does not say, and one it found:**

1. **The rows built before the model are anchored to their role, not to their shipped HP.** From level 18 every row is the model's output (HP 1.00 / 3.00 / 4.00 / 8.00 of the template, a camp's 0.75, the stalkers' pair 0.85) and the ratio keeps that. Under it the road, the Strand and the cave "stand as shipped": the Marsh Hog is **13.5 % over** the template, the Hollow Warden 3.8x where a boss is 8x, a starter boar 2x. Kept by ratio, a hog Echo took 16 s and a boar Echo 28 s at every level, which breaks the pace in section 1. `anchoredHp` snaps rows at level 17 and under to `role multiple x template` (`MODEL_FROM`). Their hit stays the authored one by ratio: **the starter and cave rows were built with light hits (a boar's whole fight is 7 % of health), so their Echoes are soft by design and I left that alone.**
2. **`14.2 s` is the trash row's.** An elite is 3 and a boss 8 of the model's `TTK + 1`: the Spire Warden Echo takes 49 s and Vael 141 s on the bot (the template takes 48 and 141: the bench's own "140 to 144 s"; 3.5's 122 is the model without a bot that steps out of slams). Check 3 holds trash to 14.2 within 8 % and an elite or boss to the template's own time scaled by the model.
3. **A pair is checked as a pair**: 2 x 0.85 x 14.2 s and 3 x 0.85 x 0.7 of one body's cost (53 % against 54 %); each body takes 12.9 s, 7 % over, which is the retarget. A row that already comes in a group (the camps and the stalkers) is its own pair and does not get a second.
4. **"The swings are cut by the same points" is the wrong direction in the 56 to 69 band.** A cast already displaces the swings it spans, because an enemy winding up swings nothing and its timer restarts when it lands. With a mark worth 15 % a landing and two landings a fight, the swings have to be **x1.3** of the model's to keep the fight at its cost, not less; at 70 and above a golem's are x1.07, a shooter's x1.4, a quick crab's x0.7. The invariant the card asks for holds and is what is built: `unansweredFight` counts a row's cost by the enemy's own schedule, each new tell is worth its share of that per landing, and one factor on the swings and the row's old casts solves the rest. All 31 trash rows at 56, 60, 70 and 80 cost what they cost at 42 to within 1.5 % by that count, and the bot agrees to within 2 points.
5. **A kill's gold is a top-up.** Drop tables are items sold for gold, with `nothing` solved to `0.6 L + 3`; an Echo keeps the original's table (its hides and swords) and the kill pays the gold that brings the expected value to `(0.6 E + 3) x role` (an elite 3, a rare 4, a boss 8), on the `kill` event as `gold`. Marks: **1 an elite, 3 a boss, and 2 a rare** (the document is silent on rares; a rare is 6 trash fights of work against an elite's 3, which is the same one in three).
6. **A mate is made the first time it is wanted** (an `Enemy` with `mateOf`), stands at its leader's post, wakes with it, respawns on its own clock, stays down when its leader is not an Echo at 84 or more, and is not saved. Nothing is allocated for a character with the switch off.
7. **The setting snaps to a step**: a saved number is held to +-3 and rounded to the nearest of -3, 0 and 3 (a 5 is 3, a 1 is 0); before the Seal it loads as off whatever the file says. It takes effect at each enemy's next respawn and at load, and **not on the enemies standing there when the switch is pressed** (the menu should say so: the world turns over as things die).

**The one it found: the ladder is a discount and not a demand.** Because each rung is sized out of the swings' budget, a player who answers nothing pays exactly what 3.6's pace model says at every level. The player who answers pays less: the reference player of 3.4a loses **22 %** of health to a Rune Golem Echo at 42 (Pummelling the sweep), **21 %** at 60, **15 %** at 80 and **30 %** for a pair at 99, against **30 %, 30 %, 30 % and 52 %** for the one who answers nothing, in the same time (14.1 to 14.7 s). A mark is **4 to 5 points of health** a landing and a slam **9**. That is the doc's design and it is a skill dividend of about 15 points at 80 (out of combat regen is 3 % of health a second, so about 5 s of regen a pull, 12 % of a 40 s mean kill), but nothing in 56 to 99 is a *threat*, and for a **shooter** the mark is worth less than stepping out of it: the bot that answers it loses 18.7 % at 60 against 17.9 % for the one that does not, because leaving melee to dodge costs bolts. So 3.8's first lever (a net on the ranged rows at 92) would add a real stake, and **the weakest stretch is 84 to 99, where nothing is added after the pair**: fifteen levels, about 14 hours (1,270 of the 3,966 mean kills), of the fight at 80 with two of them.

### 3.10 Ruled (HOM-181): the ladder is a demand, Hard is a reader's setting, a pair pays 0.88, and the net is out

QA measured 3.6 on the real sim against `1fd5fd4` (`src/echo-bot.ts`, one decision a tick, procs off, line gear, 12 seeds a cell) and found it does what this document says: a dividend and nothing else. Their numbers reproduce to the digit here (the same bot, `src/echo-bot.ts`: 30.0 / 29.9 / 29.8 / 51.8 % ignoring, 22.9 / 21.5 / 15.4 / 29.9 % answering at 50 / 60 / 75 / 90). **Four rulings; the constants are in `src/sim/echo.ts` and the checks in `src/echo.test.ts` ("HOM-181").** Golem, 16 seeds, health lost and (loop per kill: fight, then the 5 s delay and 3 %/s to full):

| E | Ignoring, was | **Ignoring, now** | Answering, was | **Answering, now** | Kill loop, ignoring / answering |
| --- | --- | --- | --- | --- | --- |
| 50 | 30.0 % | **29.6 %** | 22.9 % | **22.2 %** | 29.0 s / 26.6 s |
| 60 (mark) | 29.9 % | **34.9 %** | 21.5 % | **20.6 %** | 30.5 / 25.9 |
| 75 (slam) | 29.8 % | **46.0 %** | 15.4 % | **15.2 %** | 34.5 / 24.7 |
| 90 (pair) | 51.8 % | **75.5 %** | 29.9 % | **29.6 %** | 27.9 / 21.2 (a body) |

**1. The ladder is a demand. Ruled in, on Standard and Hard; Easy keeps the dividend.** A player who reads nothing should not get the same fight as one who reads everything, and 30 % of a bar a pull for 44 hours is that. One number a tell: **an ignored tell hits for its `stake`, the swings are not touched** (`ECHO_MARK.stake` 1.6, `ECHO_SLAM.stake` 2.2; *re-based to 3 and 4 in HOM-192, 10.5, for a character with talents, who takes 0.69 of what the line takes: the figures in this section are the line's*). The sizing rule of 3.6 is unchanged (a landing is worth its `share` of the fight, and the swings are cut by the same points), so **a player who answers pays what he paid** (22 / 21 / 15 / 30 %) and **one who does not pays the stake on every landing**: the mark is 7 % of health a landing and not 4.5, the slam 20 % and not 9 (an elite's slam is 24 to 30, so a trash slam you ignore is now a real one), and a pair at 90 takes three quarters of a bar. Nobody died in any cell (16 seeds a cell); at a slam stake of 2.6 and a mark of 1.8 a pair at 90 killed 1 in 6, which is the edge, so 2.2 and 1.6 stay a step inside it. **The demand is time before it is survival**: the ignoring player's kill takes 30 to 34 s where a reader's takes 25 and a reader's at 90 takes 21, so a reader earns about 1.4x the XP an hour at 75 (176,819 against 126,237). Chain-pulling two ignored pairs at 90 kills; resting does not. **Easy takes the stake off** (`echoRow(def, E, staked)`, set by `dress` from the setting): an Easy player who ignores everything pays the pace model's 30 % as before (26 % at 60, 28 at 75, 46 for a pair at 90, against 35, 46 and 76 on Standard), which is what gives Easy a job at the top (finding 2).

**2. Hard stays at +3 and its price is not health. Ruled, with the number that is its price.** The finding is right that the health cost of Hard falls with level (answering: +6, +4, +0.6 and +0.8 points at 50, 60, 75 and 90) and wrong that there is a fix in the offset: the cause is 3.1, the reward is exponential in the level and the fight is linear, so 3 levels are 49 % of the XP and about 3 % of the stats at 90, and any offset big enough to price Hard at the 10 to 17 % of health that 3.4 quoted would pay a multiple of the XP that nothing else in the document can carry. **What Hard costs is not flat in health but it is flat in the thing the pace is made of, XP an hour**:

| L | Hard against Standard, answering | Hard, ignoring | Easy against Standard, answering | Easy, ignoring |
| --- | --- | --- | --- | --- |
| 50 | 1.32x | 1.33x | 0.77x | 0.75x |
| 60 | 1.35x | 1.37x | 0.72x | 0.76x |
| 75 | 1.43x | 1.42x | 0.69x | 0.82x |
| 90 | 1.43x | 1.40x | 0.70x | 0.82x |

That is the true price list: **Hard is 1.3 to 1.4x the XP an hour and pays in the read** (an ignoring player on Hard at 90 loses 85 % to a pair against 75 on Standard and 46 on Easy), Easy is 0.7 to 0.8x and pays in relief (**29 points at 90 for a player who ignores, against 1 for one who reads**), and Standard is the middle. So Hard at 90 *is* the right choice for a player who reads, and nobody else, which is what 3.4 asked of it ("the one place a person who reads telegraphs well is paid for it"). I did not move `ECHO_MAX_OFFSET`. **What it does to the road: a Hard reader reaches 99 in about 31 hours of the 44** (44 / 1.4). If the board does not want a reader 30 % faster than the pace model, the levers are `ECHO_MAX_OFFSET` 3 to 2 (Hard 1.31x XP a kill: arithmetic, not a bench) or the stake; neither is a number to turn before a person has played it. The menu's tips ("9 to 13 % less health", "10 to 17 % more", `menu-ui.ts`) are wrong now and are Game Engineer's to reword: Easy "0.66x the XP, and a tell you ignore costs no more than it did", Standard "the XP the fight is balanced around; a mark or slam you ignore hurts", Hard "1.49x the XP: costs a player who reads almost nothing more, and one who does not a lot".

**3. The pair pays 0.88 of a single body's XP (`ECHO_PAIR.xp`).** Measured on the golem and the footpad at 83 against 84 with the bot answering: a pair's kill takes 86 and 88 % of the time (the 5 s delay is paid once for two), so a pair was **14 to 16 % faster**; five more rows said Spire Adept +13, Waste Reaver +13, Marsh Hog +21, Shore Crab +8 and Bog Witch +9 % (the Dune Hounds come in a pack, are their own pair, and did not move, which is the control). **0.88 makes the median row neutral to the hour (the golem 102 % of the hour before it, the footpad 100, and the rest 95 to 107)**; the XP a kill pays dips by 4 % across 83 to 84 (2,467 to 2,374) and the hour does not. The pace model absorbs nothing: **K98 stands at 90 and the 44 hours with it**. Hard and Easy are unmoved (both discount alike, 1.49x and 0.65x hold to 0.03: check 6). It is one number in one place; a Hard reader still goes 1.4x faster than a Standard one, as in 2. **Left open: a writ counts kills, and its bonus is `trashXp(level)` a kill and is not discounted, so a writ at 84 and above takes about 14 % less time than one below it** (the fix is to count a pair's body as 0.88 of a kill in `bounties.ts`, which is Game Engineer's module).

**4. The net at 92 is ruled out, and the stake is what fixes the shooter.** I built it as 3.8 sketches it (the Footpad's Tangling Net on the ten ranged trash rows that have none, 92 and up, sized by the same rule) and ran it. A net does no damage, so the rule has nothing to size it against, and what it costs is time: a Spire Adept at 90 against 95 with the net takes **22 against 34 % of health when answered, 36 against 58 ignored, and 28 against 30 s answered, 25 against 34 s ignored**. A player who answers pays about 10 points more for a tell he answered (5 levels account for 1 or 2 of the 12), because the player rooted three seconds eats bolts, and the 14.2 s the whole ladder is held to goes. It needs a model of the retreat in `unansweredFight` and a card of its own; it is out until someone wants that card. **The shooter finding was a sign, and the stake fixes it**: a footpad at 60 costs **21.3 % and 17.3 s ignoring against 18.7 % and 15.0 s answering** (it was 18.0 against 19.0), at 75 21.1 against 18.6. It is a small number (a shooter's whole fight is 15 to 18 %, so a mark is 3 points of it, 4.5 stuck), which is what shooters are in the pace model; **they gain the least from the ladder and nothing is added for them at 84 to 99**. If the board wants a shooter to matter, the lever is a larger stake on `ranged` rows only.

**What I could not verify, and the one thing every ruling here depends on**: whether a person reads a 1.2 s mark and a 1.7 s slam. The bot answers each at its first sight with a fixed rule. If a person misses half of them, a player on Standard at 75 pays about 30 % (the middle of the two columns), which is 3.6's dividend again, and ruling 1 is then a tax on the whole road and not on the inattentive. **I would get this measured by a human before the stakes ship to anyone who is not testing**: ten pulls of a golem at 60 and at 75 on Standard, health lost a pull. **Under 25 % at 75 means they read it; over 40 means they did not, and the knob is `stake` (to 1 for the old dividend, with the rest of this section still true) or the mark's `windup` (1.2 s) and the slam's (1.7 s), which move nothing measured here.** The pair xp of 0.88 and the stakes were measured at `--fast 1` and 16 seeds a cell (12 on the shooters); nobody has run them with procs on, or with the six abilities of 6.3 (which out-damage the 14.2 s).

---

## 4. `XP_PARITY`: ruled, and unchanged

`{ step: 0.05, min: 0.1, max: 1.25 }` at `data.ts:202`. The question was "does the floor move, does it go, or do the enemies come up to meet the player?" **The enemies come up.** An Echo row is at your level, so a kill is at parity and the floor never binds on the road. Where it binds it is doing what it was built for: a level-70 player killing an unscaled level-41 boss gets 10 % of 610, 61 XP, against an Echo trash kill at 779. That 13x gap is not a defect; it is the instruction to switch Echoes on.

Raising the floor would be wrong, not just unneeded. It would make outgrown ground pay, and 3.1's rule is that it should not. Lowering the step to widen the band would fight the curve 3.4 above already does, since the curve itself pays about 9 % a level above you on top of the parity's 5.

---

## 5. The Hollow Warden: ruled

**900 XP becomes 310; respawn 180 s becomes 600 s.** The evidence:

| | Hollow Warden | The rule |
| --- | --- | --- |
| XP | **900** | `10 x (20 + 11) = 310` |
| XP against HP | 0.563 per HP | 0.015 to 0.047 for the four other bosses (Vael 0.015) |
| Multiple of the rule | **29x trash** | exactly 1.00 / 3.00 / 6.00 / 10.00 on all 41 other rows |
| Respawn | **180 s** | a boss is 600 s (3.4) |

The Warden is the **only** row of 42 from level 10 that is off the rule, and its HP (1,600) is an elite's, not a boss's: its XP is three elites' worth for one elite's work. Against the Archmage it is **0.563 XP per HP against Vael's 0.015**: the board's "25 times the health for two thirds of the reward" is 37 times the reward per HP.

**It is also the best farm in the game for much longer than the parity rule suggests.** Parity shrinks the pay per kill; it does nothing about how often the kill comes. At 180 s the Warden can be killed 20 times an hour and is respawn-limited (its fight is about 30 s: 1,600 HP at the 54 DPS 8.4 gives at level 11 with Warden's Edge):

| Player level | Warden pays | XP an hour at 180 s | at 600 s | A band mean-kill hour |
| --- | --- | --- | --- | --- |
| 11 | 900 | **18,000** | 5,400 | 4,709 |
| 17 | 630 | 12,600 | 3,780 | 5,620 |
| 22 | 405 | 8,100 | 2,430 | 6,379 |
| 25 | 270 | 5,400 | 1,620 | 6,835 |

The Warden beats a band's mean-kill hour until about **level 23**, 12 levels past the band it is built for, and by 3.8x at level 11. `golden-path.test.ts:3653` asserts "it stops being the best farm in the game" for the per-kill column, which is true, and which is not the farm. At 600 s it is 1.15x at level 11 and below the band from about 13; at 310 as well it is 0.4x, a boss to be killed once, which is what a boss is.

**The first-kill windfall moves to where a windfall belongs.** A full clear of the Hollow plus Q1 and Q2 is 1,900 + 400 + 1,000 = 3,300 XP before parity, which is **level 17** against the bible's ladder arriving at Greywater at 11 to 12. That is arithmetic and not a measurement (nobody clears the whole Hollow; the parity at levels 9 to 12 is 0.9 to 1.05). With the Warden at 310 it is 2,710, **level 15**: two levels closer to the band the Greywater rows are tuned for, which is the right direction for a number that was already running hot. If the board wants the first boss to feel big, raise **Q2's 1,000 to 1,300**: a quest pays once.

**Landed (HOM-169): the Warden at 310 and 600 s, `src/sim/enemy-xp.ts` with `K98 = 90`, and two rulings the card asked for.** *Q2 stays at 1,000*: 310 is already 1.4 levels of cost at level 11 (226), the full clear is 2,710 (level 15) and raising Q2 by 300 hands back half of the two levels this took off the road. *The Hollow Ogre goes to 360 s* (XP stays 240): there are **two** ogre spawns, so 120 s was 60 kills an hour and **2.7x** the band's hour at level 11, not the 1.4x one ogre gives; at 360 s the pair is 0.9x. Below the first line of this paragraph is the original, written before it landed.

**Not applied here** (no code): the card that does it edits `data.ts` (`xp: 310`, `respawn: 600`) and one assertion, `golden-path.test.ts:3653`, which hard-codes 900, 720, 495 and 90 (the four above it read `warden.xp` and move on their own). That is the only test I found that names the Warden's pay. The cave's other rows pay 2.2 to 8.5x the rule (`brute` 220 against 26, `ogre` 240 against 29) and **stand**: together they are the tutorial's bank, and the Ogre's 120 s respawn makes it 6.8k an hour at level 10, 1.4x the band: worth a look and not a ruling.

---

## 6. The empty ladder

58 levels with nothing hanging off them is a number going up. At level 41 the character's power sources are: levels (x2.07 more by 99), a weapon on the 3.3 line, armour that is 133 of its 160, 54 talent ranks (all bought by level 55), a full 16-key bar, and an economy with nothing to buy. The cadence below puts a *thing* every 4 to 5 levels.

### 6.1 What is already exhausted, with numbers

| Axis | State at level 41 | Left in it |
| --- | --- | --- |
| **Armour** | the starmetal set (24 + 44 + 32 = 100) and Moorhide gloves and boots (15 + 18) = **133**; `MAX_REDUCTION` is 0.8, armour 160 | **13.5 %**: damage taken x0.865 from 133 to 160, and nothing after |
| **Talents** | 27 talents, **54 ranks**; `talentPoints(L) = L - 1` | points **run out of places at 56**: 15 dead at level 70, **44 dead at 99** |
| **Abilities** | 16 abilities, the bar is 16 keys | no key for a 17th |
| **Weapon** | Crownbreaker, 100, tier 6 | the line is 252 at 99: **x2.4 on a hit** |
| **Gold** | income `(0.6 L + 3) x 1.4 x 90` an hour: **3,478 at 41, 7,862 at 99** | no sink above 41 that matters: the second mount is 3,000 and repairs are about 50 a death |

The armour row is the finding: **the ladder past level 48 cannot be armour.** HOM-107 raised the cap to 160 because starmetal with the best hide already met 120; the full kit is now one step from it. The weapon, the talents and the abilities are the three axes with room.

### 6.2 The cadence

| Level | Hands over | From |
| --- | --- | --- |
| 42 | Echoes | the Seal (Q8) |
| **48** | **Blade 1** (damage 119) and **the last armour step** (hands and feet, 133 to 160) | Echo marks and shards |
| **50** | **Ability 1** | a trainer |
| 56 | **Blade 2** (140) | |
| **60** | **Ability 2** | a trainer |
| 64 | **Blade 3** (161) | |
| **70** | **Ability 3** | a trainer |
| 72 | **Blade 4** (182) | |
| **80** | **Ability 4**; **Blade 5** (202) | |
| 88 | **Blade 6** (223) | |
| **90** | **Ability 5** | a trainer |
| 96 | **Blade 7** (244) | |
| **99** | **Ability 6** | a trainer |

**Weapons.** One blade every 8 levels, each from the last, on `W(L) = 36 + 2.6 (L - 16)` (3.3): **119, 140, 161, 182, 202, 223, 244**. Each is +19, +16, +14, +12, +11, +10 and +9 % damage per second on its own, the same 10 to 20 % step the first 41 levels give. Equip level is the arrival level (as 3.3's "set at or one under the committed player's arrival"), and **Smithing gates each at 54 + 6k (60, 66, 72, 78, 84, 90, 96)**: the Smithing line keeps its job as the long pole. The materials are **Echo shards and marks** dropped by Echo elites and bosses, not new ore: there is no region past the Spire to put a node in, and a blade is the one place a shard-gated capstone (3.3) already works. **Each blade is `tier` 7 or 8** and needs its own look (section 8): tier fallback for a 244-damage blade is exactly the unworthy-of-the-grind case the standing rule says to flag.

**Armour.** One step: the hands and feet (leather) and a fourth plate piece to take 133 to 160 at level 48. After that **armour is done**. Slot enchants (Enchanting) are the continuing axis and are not priced here.

**Talents.** A point a level continues to 99. **A fifth tier, opening at 18 points in the tree** (`TIER_COST` `[0, 2, 4, 8, 12, 18]`), five talents of four ranks a tree: **60 more ranks, 114 in all, against 98 points at level 99.** That leaves 16 spare, so a build at 99 is still a choice, as 54 ranks against 39 points was at 40 (3.5). The cheap version is three talents of five ranks a tree, 45 ranks, which fills exactly and ends the choice at 99. It is nine effects against fifteen; I would pay for fifteen.

**Abilities.** Six, at 50, 60, 70, 80, 90 and 99, each bought from a trainer. That puts the bar at 22 abilities for 16 keys, so **the bar becomes a loadout: a book of 22, 16 slots** (Game Engineer; the spellbook UI exists). A loadout is also the first build choice the kit has had since the capstones. Price **one hour of the band's gold income each**: 4,158, 4,914, 5,670, 6,426, 7,182 and 7,862, **36,212 in all**. Against the roughly 250,000 gold of 41 to 99 (44 hours at an average 5.6k) that is about 15 %, so **gold stays soft past 41 and I am not pricing a sink for it**: that is a separate card if the board wants gold to matter.

### 6.3 Landed (HOM-176): what the build found

`src/sim/items.ts` (the seven blades, the two leathers and the materials), `src/sim/crafting.ts` (the recipes), `src/sim/data.ts` and `src/sim/consumables.ts` (the six abilities and their two buffs), `src/sim/talents.ts` (the fifth tier and its fifteen effects) and `src/ladder.test.ts` (check 9 and one check for each of the fifteen, in `npm run verify`). The blades are exactly 6.2's numbers and gates, 119 to 244 at 48 to 96 and Smithing 60 to 96; 22 abilities, `talentPoints(99)` 98 against 114 ranks, and armour 160 reached and nothing worth more past it. **Six things the build did that the text above does not say, and one it found:**

1. **The Smithing gate was unreachable as written, and the Echo bar is what makes it reachable.** After the starmetal bar nothing pays Smithing XP: the gate at 96 is 9.5 million XP from level 54, and a starmetal bar pays 2,175, which is **4,383 bars** and 22,000 coal. So the "long pole" would not have been long, it would have been a wall. The fix is the metal ladder's own rule: **the action you repeat pays 0.25 of the cost of its own level**. The **Echo bar** is a starmetal bar tempered with one Echo shard, made at seven levels (54, 60, 66, 72, 78, 84, 90: the level before each blade's gate, so a smith leaves Crownbreaker straight into it). From one gate to the next is **about 31 bars at the best recipe open**, 220 in all, and three of them go into every blade with three more shards and the 20 marks. A blade is 3 bars, 3 shards, 20 marks; it pays 0.4 of the cost of its level (the rule Crownbreaker's 6,305 is). The bars are my addition to the card, and they are the one place it is bigger than the text: **about 250 shards, 220 starmetal bars and 1,100 coal over the road** for the Smithing line, against the 140 marks the seven blades want.
2. **Shards are a new drop: 1 an elite, 1 a rare, 2 a boss** (`ECHO_SHARDS` in `echo.ts`, beside the marks): about two shards for every three marks, 13 an hour at the doc's 19 marks, so the 250 is about 19 hours of the 44 and the 140 marks about a sixth of the 840 the same time pays. Marks are not the scarce thing on this road; **shards and starmetal are**. The tell: a player who only fights Echoes and never opens the forge is not behind the curve (the blades are the only place the shards go).
3. **The "fourth plate piece" does not exist, because there is no fourth plate slot.** Head, chest and legs are the starmetal set's 24, 44 and 32, hands and feet are leather, and the one other slot is the off hand, which holds the torch and would want a shield model nobody has built. So the whole 133 to 160 is in the leather: **Echohide gloves 27 and boots 33 on top of the set's 100 is 160, the cap, to the point** (`echoArmour(48)` was already 160). They are cut from Echo leather (moor leather tanned in two marks, ten marks the pair, half of one blade step) at Leatherworking 40 and 41, and ask combat 48. **If the board wants the fourth piece it is a shield in the off hand, which competes with the torch in a cave, and it needs the 3D Artist.**
4. **The six are bought from Ravn Highcastle in Highmoor**, because he is the last trainer there is: the Spire has a vendor and no trainer. A trainer in the Spire is a landmark, a portrait and a rig (Game Engineer and 3D Artist), and a reason to be there at 50; I did not build it. The prices are exactly an hour of the band's income, `round((0.6 L + 3) x 1.4 x 90)`, 36,212 in all, and a level-99 character with the gold and none bought has none open.
5. **What the six are**, each one a job and none a bigger number alone: **Rampart** (50, off the GCD, three quarters off for 2.5 s: the one slam you cannot step out of), **Reaping Blow** (60, 3.2x the weapon, Colossus Blow's bigger sibling), **Shockwave** (70, a 360 degree sweep that staggers everything it hits: a slam answered, a pair held), **Echo Surge** (80, off the GCD, +50 % for 15 s, on top of Battle Fury, a 90 s cooldown), **Bloodbath** (90, a 360 degree sweep that heals a third of what the whole sweep deals: a pair pays double) and **Final Reckoning** (99, 6x the weapon and 90 of the 100 energy). Two are only data (a buff row each) and Reaping Blow and Final Reckoning only a row; **Shockwave and Bloodbath add one flag each to `cleave`**, the stagger and the leech. They are entries 17 to 22 of `ABILITIES`, in the order they open, so no slot a save holds moves. **A book of 22 is `ABILITIES` in index order**, each gated by `abilityOpen`; the loadout bar (HOM-179) takes it as that list.
6. **The fifth tier opens to a finished tree and to no other.** Eighteen points is every rank the tree had below it, so a player who has not filled the tree cannot reach it, and **nobody has all three trees' tier 5 at 99**: 3 trees of 18 is 54, leaving 44 of the 60 new ranks (a tree and a half, or two trees' fifth tier and a half-built third). The fifteen effects are **one derived number each**, and each is checked against the rule it bends: Annihilator (+6 % a rank on every heavy strike), Momentum (8 energy a kill), Savagery (+8 % on a swing), Warcry (Battle Fury +4 % a rank), Cull (+6 % a rank below 35 % health), Triumph (2 % of health a kill), Steadfast (a guard takes 10 % a rank more off what is left), Concussion (Shield Bash 3 s sooner), Adrenaline (3 energy a hit taken), Deflection (6 % a rank off a bolt), Open Veins (Serrated Throw 1.5 s sooner), Far Reach (a sweep 0.4 u further), Lifeblood (0.3 % of health a bleed tick), Predator's Eye (+3 % crit on a bleeder) and Rupture (Hemorrhage pays 15 % more of the wound).

**The one it found: `legalTalents` counted a tier's own ranks towards opening it.** A save holding 17 points in a tree and one rank of a talent in the fifth tier was "legal", because the rank itself made the 18. It is now the ranks in the tiers below that open a tier, which is the order a player could have bought them in, and it rejects exactly that save (`src/ladder.test.ts`).

**What I could not verify.** *Feel*: whether Shockwave's 4.5 u is the right size to hold a pair, and whether 2.5 s of Rampart is long enough to be worth a button at 50, are numbers in `data.ts`. *The model*: the Echo rows are sized for the four-ability rotation on line gear, and a player with six more abilities, Echo Surge's 8 % of the time and a fifth tier will out-damage it; **nobody has run the bot with them, so what the new kit does to the 14.2 s and to the 44 hours is unmeasured** *(measured in HOM-184 and HOM-192: section 10. It was the smaller half; the talents were the larger)*. The levers are the six `cooldown`s and Echo Surge's 1.5. *The icons*: 31 new art files (ten items, six abilities, fifteen talents) are placeholders, copies of the nearest old icon, so `art.test.ts` is green; the 3D Artist owns the real ones.

---

## 7. Writs: the repeatable objective

### 7.1 What the card asked, answered

| Question | Call |
| --- | --- |
| **What it pays** | A **bonus equal to the work: `perKill x count x trashXp(L)` XP** (`perKill` is 1.0), where `trashXp(L)` is `20 + L` to level 40 and section 2's above it, **paid on the player's level at hand-in**, on top of what the kills themselves paid. **Gold: the placeholder's `3 + L` stands** (a tip: 23 at level 20, against 15 a kill; the bible's economy, 7, is built to run short and doubling it would break that). From the Seal, **1 Echo mark**. |
| **What it asks** | **8 to 12 kills as HOM-163's table has them** (3 for the Ridge Ogres, 6 for a caster), counted in trash-kill equivalents once the Seal is broken: **12 trash, or 4 elites, or 1 boss and 2 trash** (the role multipliers are time-fair, section 2). After the Seal each board also offers **one Echo writ**, `levelBand: 3` (HOM-163's `spire-peace`, "foes of your own mettle", already has the shape), counting Echoes within 3 levels of the player. |
| **How often** | **Two bounties on each board, each its own slot; a slot refills 20 hours after it is handed in.** Nothing banks: a slot unclaimed for a week offers one writ. A writ in progress survives a save and a level-up. |
| **Obey parity?** | **The bonus does not; the kills do.** The same reason as the chests (7.4 of `action-layer.md`): a bonus on the player's level at hand-in never decays and never inflates. A writ pays the same share of the road at 45 as at 95. |
| **Per town or global** | **Per town, five boards** (Hale's Rest, Saltmarrow, Thornwick, Highmoor, the Spire), as built. The Echo setting is global. **A board's rows name the species of its own region**, so a full tour is a reason to fly and a board is a reason to be in that town. |
| **Primary or supplement** | **Supplement.** 7.2 has the numbers. Nothing caps the kills, and a player who never opens a board reaches 99 in 44 hours. |

### 7.2 What it is worth

A kill-equivalent is a trash kill at parity. 12 of them is **17.9 % of a level at 41, 13.7 % at 60, 11.0 % at 80 and 9.3 % at 98**: ten of them a day is 1.8 levels at 41 and 0.93 at 98.

| | Baseline | A full tour (10 writs a day) |
| --- | --- | --- |
| Work | | 120 trash-equivalents of kills, about 56 minutes of fighting at 40 s a mean kill, plus travel: **about 85 minutes, of which the 29 minutes of flights and walking between five towns are my assumption and nobody has timed** |
| XP, in trash-equivalents | 129 an hour | **240 a day: 169 an hour** |
| **Rate** | 1.0x | **2.0x while fighting, 1.3x over the tour** |
| 41 to 99 (5,689 trash-equivalents) | 44.1 hours | **23.7 days of the tour, about 33 hours** |

**A full daily tour takes about a quarter off the road** and puts about half of that day's XP in the bonus. A player who tours once a week gets about a seventh of it. That is a modest size on purpose: enough that a player who has been away has a reason to go round the towns, small enough that nobody who plays four hours on a Saturday is behind someone who plays 85 minutes a day. **The bonus is `perKill` times the count (nominally 12), and `perKill` is the one number to turn.** With the 29 minutes of travel, the tour breaks even with simply fighting at a `perKill` of **0.53**: at 0.5 it is 0.98x (nobody tours), at 1.0 it is 1.31x and 99 is 33.6 hours, at 2.0 it is 1.97x and 99 is 22.4. So 1.0 is not generous, it is the smallest round number that pays for the walk; a board that wants the tour to be the way to play wants 1.5 to 2.

**Echo marks** are the currency of section 6: **a blade step costs 20 marks**, about an hour of kills (a mean pull's elite and boss share is about 19 marks an hour at 1 an elite and 3 a boss) or two days of tours at one a writ. A player who never opens a board is never behind the curve, which is 6.1's rule for capstones: reliable, not gated on a daily.

### 7.3 Why not the other shapes

- **Dailies as the road** (WoW before Legion). A cap on a day's XP is a cap on play, and the board asked for a *pull*. Every quest-log game that capped play by daily eventually removed it.
- **Rested XP.** It rewards absence with no task and no destination; a writ rewards the same absence with a reason to be somewhere. I would add it only after a playtest says writs are not enough.
- **A streak.** It needs a calendar day, and a calendar day needs a time zone. A 20-hour per-slot timer is a day that drifts earlier and needs no reset.
- **A table of fixed targets per level** (a row for "kill 4 X" at every level). 58 levels of target rows is the authoring the whole of section 3 exists to avoid. The table HOM-163 built is a table of *places*, ten rows, and stays that size, because the reward scales and Echoes supply the level.

### 7.4 HOM-163's shape

HOM-163 landed (`96d05d5`) while this was being written, and I read `sim/bounties.ts`. **accept → track → turn in → re-accept is right, and the table stays a table**: I withdraw the "pure offer function" I asked for in my note on this card, because two rows a board are already the two slots. `MAX_ACTIVE`, saving by id and target signature, `abandon` costing nothing, and `levelBand` are all kept. **Four things in it must change**, in the order they are expensive to retrofit:

1. **A reward cannot be a literal XP number, and `Scale` cannot say this one.** `Scale` is `base + perLevel x level`, which is the rule exactly up to level 40 (`xp: { base: 20 x count, perLevel: count }`) and linear where the road is exponential above it. Add a form that resolves against a function: `xp: { perKill: 1 }`, meaning `perKill x count x trashXp(level)`, with `trashXp` the one function section 2 adds. Resolve it **at hand-in** (the chests' rule) and not at accept, which is a difference of one level, about 9 %.
2. **A handed-in bounty is on offer again at once** (`done` is a counter, nothing waits). With a bonus equal to the work that is a 2x faucet with no pull and no rhythm. Add `readyAt` per bounty id to the save and a `now` the shell passes in; a bounty is takeable when `now >= readyAt`, and handing one in sets it 20 hours on. The sim never calls `Date`, and a test passes its own `now`.
3. **A kill must carry the instance's level.** `bountyOnKill(s, type, region)` and `counts()` read `ENEMY_TYPES[type].level`, which is the authored row's. An Echo of a level-38 golem at 70 is a level-70 kill. Pass `defOf(e).level` (section 3.7) and `counts` compares that.
4. **`finishable()` is computed once from the authored spawns.** After the Seal a `levelBand` row is finishable whenever Echoes are on, and not otherwise, so the board does not offer an Echo writ to a player who has switched them off.

---

## 8. What gets built, and by whom

| Order | Card | Owner | Depends on |
| --- | --- | --- | --- |
| 1 | `enemyXp`, `kpl`, and the XP-rule check; the Warden (`xp: 310`, `respawn: 600`) | me | nothing |
| 2 | `defOf(enemy)` through the 37 reads | me for 11, **Game Engineer for 26** | 1 |
| 3 | `echoRow`, the setting, the respawn rule, the tell ladder as data | me | 2 |
| 4 | The Echo switch and name plate level | Game Engineer | 3 |
| 5 | Writs: the reward rule (`xp: { perKill }`, the 20-hour refill, the kill's level, `finishable`), the table's rewards and the Echo row, marks | Game Engineer (the module, 7.4's four changes); me (the rewards and `trashXp`) | 1, 3 |
| 6 | Blades, the armour step, six abilities, the fifth talent tier | me (data and effects) | 3 |
| 7 | The loadout bar | Game Engineer | 6 |

**3D Artist asks, in the order the build needs them:**
1. **An Echo look**: a tint per band (42 to 55, 56 to 69, 70 to 83, 84 to 99) on the existing rigs, and a shimmer or edge light that says "this one is an Echo" before the name plate does.
2. **Seven blade looks and tiers 7 and 8.** `TIER_COLORS` stops at 6. Blades 1 to 3 are tier 7 and 4 to 7 are tier 8, each with its own look: the bench must show each in the character's hand (the standing rule). **If tier fallback is all there is, a level-96 blade will look like a level-32 one, and that is unworthy of 48 levels of grind: say so rather than ship it.**
3. **One leather look** for the hands and feet at 48.
4. **The writ board**: a prop for each town (a notice board is enough).

### 8.1 The headless checks that make this executable

Assertions in `src/golden-path.test.ts` or a sibling that joins `npm run verify`:

1. **The rule is continuous and monotone.** `trashXp(40)` is 60 and `trashXp(41)` is within 7 % of 61; it rises with `E` to 98; `enemyXp(99)` equals `enemyXp(98)`; an elite is 3x, a rare 6x, a boss 10x.
2. **The pace is what section 1.3 says.** The sum of `kpl(L)` for 41 to 98 is 3,966 within 1 %, and at every `L` a Standard Echo trash kill pays `cost(L) / (1.4345 x kpl(L))` within 1 XP.
3. **An Echo row is the model's.** For a spread of templates (`marsh_hog`, `rune_golem`, `spire_warden`, `archmage_vael`) at `E` = 42, 60, 80 and 99, the row's HP is `(TTK + 1) x DPS` within 2 %, and a bot on the real sim in line gear takes **14.2 s within 8 %** and loses **the template's share of health within 4 points**. Measured at `--fast 1`: the bible has already been bitten twice by `--fast 4`.
4. **Echoes change nothing before the Seal, and everything is restored after.** A save with `echo: null` runs the golden path unchanged; switching off returns the authored rows at their next respawn.
5. **The offset is capped.** `ECHO_MAX_OFFSET = 3`; a saved `echo: 5` loads as 3.
6. **The ratios are held.** Hard pays 1.49x Standard within 0.03, Easy 0.65x within 0.03.
7. **The Warden**: pays 310 at level 11, respawns in 600 s, and `golden-path.test.ts:3653` carries the new numbers.
8. **A writ**: the offer is pure (the same inputs give the same writ); a slot is not ready until `readyAt`; the bonus is the same share of a level at 45 and at 95; a kill 4 levels under the accepted level does not count; a save round-trips an unfinished writ; marks are granted exactly once.
9. **The ladder**: seven blades at the damage in 6.2, each with `req.combat` and a Smithing gate; every one has a `tier` of 7 or 8 and a look; armour 160 is reachable and 161 is not worth more; `talentPoints(99)` is at most the total ranks; the six abilities are bought, not granted.
10. **Existing checks stay green**, with `:3653` as the only edit.

---

## 9. What I tuned, what I compared it to, and what I could not verify

**Tuned**, and to what:
- **`K98 = 90`**, against the flat curve (`46`, 29.6 hours) and 3.6's (`150`, 63.7). It is the middle of the table and the choice that makes the top feel longer without a wall.
- **TTK frozen at 14.2 s**, against the bible's drift, because the pace is kills and a second on a kill is an hour on the road.
- **Hard at +3**, against +5: +3 is 1.49x XP for 10 to 17 % more cost, +5 is 1.93x for 24 % (at level 60).
- **The writ at 12 and 12**, against a 24-kill bonus (1.97x, 22 hours) and a 6-kill one (0.98x, no pull): a tour is 1.31x over its length, with 29 minutes of travel that is my assumption.
- **The cadence**: 8 levels a blade, the step sizes (+19 to +9 %) matching 3.3's 10 to 20 %.

**Compared against**: the bible's own 3.4 model, which reproduces the Rune Golem to the digit and a headless bot within ±2 % for levels 10 to 32; 3.6's 45 to 150 kills a level; 3.7's 33.6 s mean kill and the person's 40 s; 3.3's weapon and armour lines; the gathering skills' `0.12 x cost` rule; and `action-layer.md` 7.4's parity rule for chests.

**I could not verify**, and the one constant that moves each:
- **The model above level 41.** It was validated against a bot to level 32 and a handful of rows to 41. `power(L)` is linear and this document takes it to 99 at x7.86, which no bot has run. The enemy rows at 80 could be 20 % off in either direction. *Lever: `TTK(E)` and the two ratio functions.*
- **A person's mean kill at 41 to 99.** 40 s is 3.7's, and 3.7 says nobody has timed one. Every hour in this document is that number times a kill count. *Lever: `K98`.*
- **Whether the gear keeps pace.** The line assumes a blade every 8 levels on schedule. A player a blade behind is 9 to 19 % slower per set, the same as 3.3's table, and a player two behind takes up to half a bar from trash. *Lever: the blade's mark cost and the equip level.*
- **Whether Echoes are fun.** The tell ladder is the whole of the variety, and 3.8 names what happens if it is not enough. This is the biggest unknown and a playtest is the only instrument.
- **Whether a person reads a 1.7 s telegraph at level 70.** 3.4a's unknown, now applied to every trash row from 70. *Lever: the slam's share, 24 %.*
- **The writ's pull.** 1.3x is a model of a person's evening, with a travel figure nobody has timed; the real unknown is whether anyone opens a board twice. *Lever: `perKill`.*
- **The pair at 84.** Measured (3.9, 3.10): 14 to 16 % faster an hour than the rung before it, so a body pays 0.88 and the hour is neutral. *Lever: `ECHO_PAIR.xp`.*
- **The first 41 levels in practice.** The Warden arithmetic assumes a full clear; it is a direction, not a prediction.

**Existing balance this changes**: nothing built moves. If the recommendations are taken, the Warden's `xp` and `respawn` change (one assertion), `TIER_COST` gains a sixth entry, the ranks outrun the talent points again, and the bar becomes a loadout. `XP_PARITY` does not move.

**One thing I noticed and did not rule**: the bible's ladder (3.2) starts at level 11 on the Greywater Road, and the Hollow's bank (1,900 XP plus Q1 and Q2) lands a full-clear player at level 15 to 17. The ladder from 11 to 30 may be running three to four levels hot for anyone who clears the cave, and that predates this document.


---

## 10. The road re-priced against the character (HOM-192)

**What was asked.** QA ran the full kit against an Echo (HOM-184) and an Echo fell in 9.0 s at 50 and 6.0 s from 60, against 15 to 16 s for the "four-ability kit". Three rulings: re-price the road (and say which of 30 / 44 / 64 hours the measured game is now closest to), rule the six-second floor, rule the tell ladder. **Method.** `bench/kit-loop.ts` and `bench/road-hours.ts` on the real sim through `src/echo-bot.ts` (one decision a tick, procs off, the bench's own rotation ported: Rampart, Echo Surge, Reaping Blow, Shockwave, Bloodbath and Final Reckoning on `bench/combat.mjs`'s rules), pull after pull with the cooldowns carried across the rest between them. The bot reproduces QA's cells (first pull, full kit: 9.0 to 9.5 s at 50, 6.0 s at 60).

| Question | Call | Why, in one line |
| --- | --- | --- |
| Where did the 60 % go? | **Mostly not the six abilities. The "4-ability kit" is a character with no talents, and that is what the Echo was priced against.** Talents alone take 14.0 s to 12.4 at 42 and 14.8 to 10.8 at 50; the six abilities add nothing until 60 (Rampart is never pressed at 50). | 10.1 |
| Re-price the road? | **No constant moves. K98 stays 90.** The Echo's health is re-priced instead: **the Echo is sized for the character a level has (the points it has been given, spent), not for the line.** | 10.2 |
| **30 / 44 / 64?** | **As shipped the game was 27 to 30 hours: the board's 30.** After the re-price it is **46 hours for a character on talents alone and 42 with the six abilities: the board's 44.** Which is the one constant (`K98`) again: 30 is 46, 44 is 90, 64 is 150. | 10.3 |
| The six-second floor | **There was no floor and it was not the kit.** It was a first pull (every cooldown ready, a full bar) against health that did not know the character had talents. **Steady, the six abilities buy 16 to 28 % of a fight and 9 % of the road**; the six second fight is gone (12 to 14 s at 60 to 80, a pair 17 to 19 s). | 10.4 |
| The ladder | **It survives, and the claim narrows.** It never stopped being a demand; the 0.69 the talents take off every hit took the demand away, and **the stakes are re-based, 1.6 to 3 and 2.2 to 4**. The finding behind QA's "the dodge is worth nothing": it is, to a bot that presses Pummel first, and **Pummel on a 1 s cooldown is a complete answer to every caster and every boss, which is a separate card.** | 10.5 |

### 10.1 What the measurement was, and what it was not

QA's table is right about every cell it measured and the cells hide two things. **The "old" arm has no talents** (`combat.mjs`: `rot === 'old'` resets them and `setBar({})`), and **every fight starts with every cooldown ready** (the default `--spacing 0`). Pulling them apart on a golem (reference build, the real blades and Echohide, `--price old`: the Echo as it stood at `1100971`; seconds, steady state with the cooldowns carried, the first pull in brackets):

| Level | No talent | Talents | Talents and the six | Talents are | The six are |
| --- | --- | --- | --- | --- | --- |
| 42 | 14.0 | 12.4 | 12.4 | x1.13 | x1.00 |
| 50 | 14.8 | 10.8 | 10.8 | x1.37 | x1.00 |
| 60 | 14.9 | 9.7 | 8.1 [7.0] | x1.54 | x1.20 |
| 75 | 15.3 | 8.9 | 7.3 [6.3] | x1.72 | x1.22 |
| 80 | 15.0 | 8.2 | 6.0 [3.0] | x1.83 | x1.37 |
| 90 (pair) | 28.8 | 14.7 | 10.1 [8.0] | x1.96 | x1.46 |
| 99 (pair) | 29.2 | 14.9 | 9.3 [6.1] | x1.96 | x1.60 |

**The bible's model was never a character, it was the line**: the weapon and the armour and nothing else, "no efficiency factor" (3.4), and HOM-174 held every Echo to a bot with no talent ("talents only under `--rotation new`"). A player of level L has been handed `L - 1` points since level 2, so every Echo a talented player has fought since the Seal went up has been dying in 8 to 12 s at 42 to 60. **I wrote at HOM-176 that the six abilities would out-damage the model. That was the smaller half**: the talents were 54 ranks that had been in the game for a long time and were never in the price. The same is true below 41 (the rows are priced for the bare line and a talented player kills them 1.1 to 1.7x faster than priced); I did not measure it and did not touch it.

**The talents are not one number, they are a build.** Six orders to fill three trees (golem, steady, the old price): at 42 the three that start with Fury or Hunt take 7.2 to 9.3 s, the three that start with Bulwark 11.4 to 13.7; at 80 6.6 to 10.4; and by 99, when 98 points have filled most of every tree, they are one number, 14.1 to 14.9 s (a pair), against 29 for no talent.

### 10.2 The ruling: price the character, not the buttons

**An Echo's health is `(14.2 + 1) x DPS(line) x talentRatio(E, role)`** (`src/sim/echo.ts`, `ECHO_TALENTS`, `ECHO_ROLE_TALENTS`). The talents are priced in and the six abilities are not, for one reason: **a talent is what a character is and a button is what a player does.** A kit of 22 buttons played by a person is the least bot-like part of the game (cooldown windows lined up, Echo Surge held for Final Reckoning); an Echo priced against a bot's perfect use of it would be a fight that is too long for everyone who is not a bot and a gate on 36,212 gold of trainer fees. Priced against the passive half, the abilities are a **dividend** a player is paid in time (10.3), and a player who has not bought them is where the document always had them.

| Level | 42 | 50 | 60 | 70 | 80 | 90 and up |
| --- | --- | --- | --- | --- | --- | --- |
| HP multiple for the talents, trash | **1.15** | **1.40** | **1.53** | **1.53** | **1.65** | **1.90** |

Linear between the knots, flat past 90; an elite is x1.17 and a boss x1.25 on top (the longer the fight the more of the build is spent on it). It is a table, not a formula, because the curve is concave and a fit to a bot: the early ranks of each tree are most of it. **The reference is the median of the six orders, which is the build that takes the Bulwark first and then Fury** (`ECHO_TALENTS.build`). It is a fit, so **it is held to the bot by the checks** (`src/echo.test.ts`, check 3): a golem at 42, 60, 80 and 99 takes 14.2 s (24.1 for a pair) within 8 %, an elite and a boss the template's time scaled by the model within 8 %. The result at the row level: a golem at 60 is 9,671 HP on the line and **14,797** now; at 80 16,245 and **26,804**; at 99 a body of the pair is 24,053 and **38,846** (x1.9 less the pair's 0.85).

**What the hit does.** Nothing moves: an Echo's damage is still sized to the line, and the character takes **0.69 of what the line takes** in the same fight (Bastion's 15 % more health, Thick Skin on a slam, Guardian below half; 0.65 to 0.72 from 42 to 99). A player the Echo is priced for loses 21 % to a golem at 42, 22 at 60, 20 at 80 and 36 for a pair at 99, answering nothing on Easy; the check holds the template's share x 0.69 within 4 points (a test constant, nothing in the sim reads it).

### 10.3 The road in hours, and which of 30 / 44 / 64

`bench/road-hours.ts`: a golem, a Spire Warden and Vael at 13 levels from 42 to 99 (pairs from 84, a body a loop), weighted 85 / 12 / 3, the fight and the rest to full health counted as 3.10 counts them (5 s, then 3 % a second), then the kills a level takes (`kpl`) summed over 41 to 98 at the bible's x1.19 on the bot (the 40 s against 33.6). Walking between pulls is not in it, as it was not in the 24 s trash loop the 40 s is built from.

| Character, Echo as priced | 41 to 60 | 60 to 80 | 80 to 90 | 90 to 99 | **41 to 99** |
| --- | --- | --- | --- | --- | --- |
| No talent, before (the bible's) | 12.1 | 16.1 | 9.5 | 9.1 | **46.7** |
| Talents, before (as shipped) | 8.8 | 10.7 | 5.5 | 4.9 | **29.9** |
| Talents and the six, before (as shipped) | 8.9 | 9.4 | 4.4 | 3.9 | **26.6** |
| **Talents, after** | 12.1 | 16.4 | 9.1 | 8.5 | **46.1** |
| **Talents and the six, after** | 12.5 | 14.5 | 7.7 | 7.2 | **42.0** |

(The bible's 44.1 against 46.7 is the bot's loop being 6 % longer than the 24 s the bible quotes; the table is read as ratios.) **Three things in it.**

**1. The shipped game was 27 to 30 hours, not 44 x 0.4 = 18.** QA's guess assumed the whole kill shrinks with the fight. The 5 s delay and the rest to full health do not shrink with it as much, an elite is three trash fights and a boss eight, and the rest of a trash loop is 9 to 10 s of the 18 to 20. **27 to 30 hours is the board's lowest option, reached by accident**, and a Hard reader at 1.4x (3.10) was at 19 to 21.

**2. After the re-price it is 46 and 42, which is 44 within 5 %, and K98 does not move.** The six abilities cost the road 9 % (46.1 to 42.0): about 4 hours, most of it past 80 where the abilities that matter open. That is the dividend and I priced it to be small enough that nobody buys 36,212 gold of abilities to be 40 % faster. **The board's question is now the real one: 30, 44 and 64 hours are `K98` 46, 90 and 150** (measured: 31 and 28 hours, 46 and 42, 67 and 61, for talents and for talents and the six), the table in 1.3, and the game under them is the measured one. I stay on **44 (K98 90)** for the reasons in 1.3 and ask for nothing else.

**3. What it costs to keep the shipped fight instead.** If the Echo stays as it was and K98 moves to hold 44 hours against 26.6, the kill count must go from 3,966 to about 6,575: **K98 = 178** (154 from the talents alone), an XP per kill that is half what it is, on a fight that is 6 to 10 s, with the ladder not arriving (10.5). Past the bible's own 150 and past the point 1.3 said the content could carry. I do not recommend it and I have not built it.

**Walking.** HOM-183's lap is **2.4 minutes** of moving against the 29 minutes 7.2 assumed. The grind is mob to mob, not town to town, so walking is not in the road and every second of it per kill is 2.8 % (about 1.2 hours of 42). **It is the writ that moved**: a tour of ten writs is 56 minutes of fighting and 2.4 of walking, so at `perKill` 1.0 it is **about 1.8x the fighting rate, not the 1.3x in 7.2**, and 99 by tour is about 25 hours of the 44. `perKill` 0.5 keeps the 1.3x. **I have not changed it**: the writ and the pace are one question (a board that answers 64 hours wants the tour at 1.8x, one that answers 30 wants it at 1.3), so it waits for the board's answer.

### 10.4 The six-second floor

It was not a floor, and it was not the enemy's health being too small for the kit. **It is four global cooldowns** (6.0 s) **on a first pull**: every cooldown ready, a full bar, Reaping Blow and Surge and Final Reckoning in the opening 6 seconds. The steady state, with the cooldowns carried across a 25 s loop, is 8.1 s at 60, 7.3 at 75, 6.0 at 80 and 9.3 for a pair at 99 against the old health (10.1). **After the re-price: 12.5 s at 60 (11.4 on the line gear), 11.2 at 75, 9.7 at 80 on the line, and 18.8 for a pair at 90**; the first pull is 12 to 13 s at 60 to 75 and 14 for the pair, because the same burst now has fifteen seconds of health in front of it. So **QA's reading, that a length set by the cooldowns is not the enemy's, is right about the first pull, and the lever was the enemy's health after all**: priced for the character it is 10 to 19 s, with the energy bar (100, 8 a second), the 20 to 90 s cooldowns and the 5 s delay doing what they were built to do, which is bound the burst. Echo Surge's 8 % of the time and the fifth tier are both in the measurement (the Surge in "and the six", the tier in the talents' points).

The dividend by level, talents against talents and the six, after the re-price, on the real blades: 60: 15.1 to 12.5 s (-17 %), 75: 14.1 to 11.2 (-21 %), pair at 90: 26.0 to 18.8 (-28 %); at the price (line gear) 60: -16 %, 80: -28 %. A bot with one decision a tick is the upper end of what a hand does with 22 buttons; **I expect a person to see half of it**.

### 10.5 The tell ladder

**It survives, and so does 3.10.** QA's reading: net health with `--dodge none` against `--dodge all` was 11.5 / 5.0 / 0 / 0 against 12.5 / 4.5 / 0.8 / 0. It is correct and it measures the bot: **Pummel is pressed first, and with Counterstrike and two ranks of Stalwart a Pummel is a 1 s cooldown that pays back 30 energy**, so the golem's mark, slam and sweep are interrupted before a step is ever planned, and 10 of 10 tells at 60 and 75 are Pummelled. **A step is worth a great deal when it is the answer**, golem, Standard, Hard off, the character the Echo is priced for, the real blades (loss of health % / seconds a kill and its rest):

| Level | Answers nothing | Steps out only | Pummels only | Pummel first, then steps | The six, Pummel first | The six, nothing answered but Rampart |
| --- | --- | --- | --- | --- | --- | --- |
| 60 (a mark) | 36.1 / 32.3 | **20.4** / 28.1 | 25.8 / 28.6 | 25.8 / 28.6 | 22.2 / 24.9 | 27.0 / 27.1 |
| 75 (a slam) | 50.8 / 36.0 | **11.0** / 23.6 | 19.7 / 25.6 | 19.7 / 25.6 | 15.6 / 21.4 | 33.9 / 28.0 |
| 90 (a pair) | 71.4 / 52.4 | **20.8** / 40.8 | 46.9 / 45.0 | 31.1 / 41.3 | 27.5 / 32.9 | 39.8 / 36.6 |

**Stepping out beats a Pummel by 9 points at 75 and 26 at 90**: a slam is a circle you walk out of for nothing, and a Pummel on a slam is a press and a stagger that keeps the swings coming. The attention test is alive and a person who steps out of every slam is the best player in this table; the bench's bot cannot show it because it is written to Pummel first. **The demand is what HOM-181 ruled it**: a reader earns **1.13 / 1.41 / 1.27x** the XP an hour of one who answers nothing (60 / 75 / 90; HOM-181's 1.18 / 1.40 / 1.32), 1.15 / 1.53 / 1.28 against one who steps.

**What did change: the stake.** The ignoring player lost 35 / 46 / 76 % in 3.10 and, for the character the Echo is priced for at the same stake, loses 28 / 32 / 50 (a step in the 0.69). That is what took HOM-181's demand to 1.03 / 1.16 / 1.14x. **`ECHO_MARK.stake` 1.6 -> 3 and `ECHO_SLAM.stake` 2.2 -> 4** put it back: 36 / 51 / 71 %, the readers (the six, a Pummel, a step) unmoved at 20 to 26 / 11 to 20 / 21 to 31 % because the stake is on an ignored tell and nothing else. Easy still has no stake. Nobody died in any golem cell, on Standard and on Hard (+3, a pair at 90 ignored: 77 %); **a build with no Bulwark (Fury and Hunt: no Bastion, no Thick Skin) that answers nothing at all loses 101 % to a pair at 90 on Standard**, which is HOM-181's edge and is what Easy is for. A player who has spent **no** talent now fights an Echo 1.1 to 2x as long and takes 1.3 to 1.9x the damage: one who answers nothing to a golem at 75 dies in all three seeds, **so an Echo is not tuned for unspent points** (Game Engineer: the Echo switch could say so).

**Rampart: the question can be answered now.** With a build that has no Counterstrike (Fury and Hunt, Pummel on its 10 s), no step and nothing else answered, the bot presses it **once a fight** and a golem at 75 costs 12 % instead of 38 (20 against 39 at 60, 41 against 101 for a pair at 90, with the rest of the six on). **In every other cell it is pressed zero times because the bot has answered the tell by other means first**, which is its job: it is the answer for a player who is not stepping and has no interrupt, and **a build with Counterstrike and Stalwart does not need it**. That makes it a Fury and Hunt player's button. It is not dead, and no forced arm was needed: `fullnone` on a build with no Pummel talents is that arm.

**Pummel on 1 s is a finding and not a ruling.** A caster, a shooter and **a boss** that is Pummelled at every wind-up lands nothing: a Bog Witch, a Footpad and **Vael cost 0 to 3 % of health from 42 to 99** (the fight is 60 to 150 s: the swings are the only damage and a mage has none); an elite costs 33 to 50 % before the re-price and 63 to 69 % after it (a Spire Warden's blows are swings, and the fight is now as long as the model says: the model's 65 to 85 % band for an elite, 3.4). It predates this card and it is the one thing that makes the ladder cheap for the player who has it. **The lever** is the floor in `cooldownOf` (`Math.max(1, ...)`, `combat.ts:96`): a floor of 4 s would leave a cast in every fight. **I have not touched it**: it re-tunes a shipped talent and every boss fight, and it needs a person to press it before a number is chosen. `src/echo.test.ts` pins the current behaviour so a change is a decision.

### 10.6 What I tuned, what I compared it to, what I could not verify

**Tuned**, and to what: the HP multiple (the table in 10.2) to the median of six builds' bot at 42 to 99 so that a golem takes 14.2 s within 8 % (the bot reads 13.7 to 14.3 s; a pair 24.6); the role multiples (1.17, 1.25) to the elite's and the boss's time scaled by the model within 8 %; the stakes (3, 4) to HOM-181's 36 / 51 / 71 against its own 35 / 46 / 76. **Compared against**: QA's 16 cells (reproduced), the bible's loops (24 s trash, 70 s elite, 150 s boss) and 40 s a mean kill, HOM-181's reader and ignorer numbers, and HOM-183's lap.

**Could not verify.** *A person.* Every number here is a bot, one decision a tick, a rotation written for the bench and a build filled greedily tier by tier; the 9 % dividend is a ceiling, the 0.69 and the HP curve are fits (the golem is the row they are fitted to: the other rows are held to 8 % on time and no better on loss, and the loss is not held for an elite or a boss at all, because of Pummel). *The reference build.* Fury first is a third faster than priced at 42 to 70 and the last-Fury builds a fifth slower; if a playtest finds half of all players on one order, `ECHO_TALENTS.build` and the curve move together. *Hard and Easy* were measured at one row and their XP ratios do not depend on health; the doc's 1.49x and 0.65x are unmoved. *The first 41 levels*, for which the same price is probably short by 1.1 to 1.7x, and for which I did nothing.

**What I need.** QA: `combat.mjs --rotation old` is no longer the character the Echo is priced for (it is the one with no talent and now fights twice as long); a `talents` rotation (the new one with the six off the bar) is the priced character, and `--spacing 25` is the loop. Game Engineer: a line on the Echo menu row when talent points are unspent. The board: 30, 44 or 64.
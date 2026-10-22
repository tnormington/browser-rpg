# The action layer

What the jump answers, what Agility unlocks, and what is in the chests (HOM-150). No code ships with this document: it is the spec the build cards work from, written the way `docs/world-design.md` is, with numbers where that file has numbers.

**Method.** Every figure below was computed against the sim as it stands at `630adbf` (`sim/data.ts` for gravity and the enemy rows, `sim/agility.ts` for the meter, the roll and `JUMP_LIFT`, `sim/combat.ts` for how a cast resolves) with a throwaway script, not by hand: the jump windows, the sprint-time to a level, the roll economy, the sweep roster. While I wrote it the foundation card landed (HOM-151, `3c0f7ee`: `top` on obstacles, `perchAt`, a double jump, `SLAM_CLEARANCE`) and so did the Artist's chest and standable-rock look (HOM-152, `7c8a00f`), so I read both. Four of HOM-151's placeholder constants collide with rulings here. They are listed in 8.1; nothing in this document needs the engineer to throw work away.

**I cannot play the game.** Every window below is a number of milliseconds a person has to hit a key, and whether 238 ms is fair is exactly what a number cannot tell me. Section 9 lists what I could not verify and the one constant that moves each.

## The calls

| Question on the card | Call | Why, in one line |
| --- | --- | --- |
| 1. What the jump answers that the roll does not | **Exactly two tells: the new low sweep and the net. Slams, ground marks, bolts and swings still land on an airborne player.** The roll answers all six. | A jump that beats a slam is a free dodge of the elite tier's whole price (3.4a: elites are "priced almost entirely in dodges"). The sweep is the tell the roll alone cannot answer *twice*, which is the jump's reason to exist. |
| 1. Is "roll = emergency, costs breath; jump = economical, tighter window" right? | **Half.** Breath binds the roll only below **Agility 17**, and no tell that exists today comes fast enough to spend it. The honest division is *the roll buys safety against everything and moves you five units; the jump buys safety against two things and keeps you where you are.* | Numbers in 1.1 to 1.3. The "tighter window" half is true up to Agility 22 and false after it, by design. |
| 1. The fifth `CastKind` | **`'sweep'`.** Wind-up 0.9 s, a ring of reach + 5.5 u, a pair 0.9 s apart on elites and rares, a single on trash. 23 enemy types, from level 10, none in a pack, none in a dungeon. Damage is derived so that eating every sweep costs what the swings it displaces cost. | 2. |
| 2. Is the net jumpable? | **Yes.** Same clearance as the sweep (1.1 u above the floor). | It already telegraphs, it is already a ground-level thing, and it is the cheapest reason to jump in the game. 3. |
| 3. The double jump | **Agility 25, 40 breath, a fixed apex of 3.2 u above the floor you took off from** (not Agility-scaled, not a share of the first jump). | 25 is 12 minutes of unbroken sprinting. A fixed apex is what makes the reach rule hold. 4. |
| 4. The reach rule | **Reach is gated on three discrete capabilities and nothing else.** Standable tops are 0.4 to 1.0 u (a hop) or 2.5 to 2.8 u (a double jump) above the floor beside them; **nothing is standable between 1.0 and 2.5 or above 2.8**; gaps are 2.5 u or less. **`JUMP_LIFT` stays**, but it may only ever scale *time in the air*, never *reach*. **The roll is not a reach capability: it covers 4.8 u and a sprinting hop at Agility 1 covers 4.98.** | 5. |
| 5. The chests | **50, never respawning: 18 stashes (need nothing), 17 caches (need a hop), 15 hoards (need the double jump), in 9 open places and 5 dungeons.** They pay coin, Agility XP and four lanterns, and **no combat XP, no gear and no item the ladder produces.** Payouts are indexed on *the player's* level at the moment of opening, so parity cannot decay them. A counter ("Greywater 2 / 4") and a final lantern say when it is done. | 7. |
| 6. The anti-kite rule | **Reach is measured rim-to-rim for both sides; a player on a rooftop (top 2.0 or more) is out of the fight and every enemy resets; a mounted player cannot perch.** | 6. |

---

## 1. What the numbers say

The card's table is right. At Agility 1 the hop is 1.35 u high for 0.554 s; at 99 it is 2.109 u for 0.692 s; the meter is 100 and 590; the roll costs 45 breath, lasts 0.3 s, covers 4.8 u and locks out for 1.5 s in all. Three things follow from it that the card did not assume.

### 1.1 What each answer costs

| | Window to be in it | Breath | Position | Beats |
| --- | --- | --- | --- | --- |
| **Roll** | **0.30 s** at every level (the i-frames) | 45 | five units away from where you were (about 0.6 s of lost swings: the enemy closes the gap at 4 to 5.6 u/s) | all six tells |
| **Hop** (clearance 1.1 u) | **0.238 s at Agility 1**, 0.266 at 10, **0.301 at 22**, 0.309 at 25, 0.372 at 50, **0.479 at 99** | 0 | none; you keep swinging, abilities work mid-jump | sweep, net |
| **Double jump** (Agility 25 and up) | 0.69 s (pressed at once) to 0.85 s (pressed at the top of the hop) | 40 | none | sweep, net |
| **Walk out** | needs only to be moving | 0 | about 1.4 s of lost swings (0.7 out, 0.7 back) | slam, ground mark; not a sweep |

*Window* is how long you are above the clearance, which is the span in which a hit that resolves is a miss. At 30 ticks a second the hop is 7 ticks wide at Agility 1 and 14 at 99. The hop's window crosses the roll's at **Agility 22**: below it the jump is the tighter answer and the card's sentence holds; above it the jump is the *easier* one, which is what Agility is for. (Clearance 1.0 gives 0.282 s at Agility 1, 1.2 gives 0.185: that is the one constant that sets how hard the first hop is.)

### 1.2 Two premises the numbers do not support

**Walking is already the free answer to the two telegraphs the roll "beats".** A slam is walked out of in about 0.7 s of its 1.7 s wind-up, a marked circle in about 0.5 s of 1.3 (3.4a: the bot that wrote the elite brackets does exactly this and never rolls, though that note predates the roll). So today **nothing in the game requires the roll**; it is an option against a swing or a bolt, and a luxury against everything else. The card's "the roll is the emergency answer" describes a game where the slam could not be walked out of. Any tell that is meant to force a roll or a jump has to be one walking does not answer. That is the first design constraint on the sweep (2.2).

**Breath makes a player count their rolls only for the first 17 levels, and only against tells closer together than 2.7 s.**

| Agility | Meter | Rolls in a burst | Seconds per roll the refill can sustain | What stops the next roll |
| --- | --- | --- | --- | --- |
| 1 | 100 | 2 | **2.70** | breath |
| 10 | 145 | 3 | 1.86 | breath |
| **17** | 180 | 4 | **1.50** | breath and lockout are equal |
| 25 | 220 | 4 | 1.23 | **the 1.5 s lockout** |
| 50 | 345 | 7 | 0.78 | lockout |
| 99 | 590 | 13 | 0.46 | lockout |

At Agility 1 the sustained supply is 22 rolls a minute; the densest telegraphed tells that exist, the Hollow Warden's slam every 8 s and its falling rock every 6 s, come at 17 a minute, and an elite's are 7 to 10; all of them are walked out of for free. (A caster's bolt every 2.4 s is 25 a minute, but nobody rolls every bolt: the lockout alone forbids it.) So **breath never forces a jump in any fight that exists today**, at any level. It will not do so after this document either: what forces the jump is the 1.5 s lockout, which is the same at Agility 1 and 99. The card's "they cannot roll everything" is true, but it is the *lockout* that makes it true, and so it holds at 99.

### 1.3 The division, and the tell-by-tell matrix

**The roll buys safety against everything and moves you; the jump buys safety against two things and keeps you where you are.** Neither dominates: against a sweep from Agility 22 up the hop is the easier answer and costs nothing, but against a bolt it does nothing at all.

| Tell | Walk out | Hop | Double jump | Roll |
| --- | --- | --- | --- | --- |
| Melee swing | none | no | no | **yes** |
| Slam (`heavy`) | yes | **no** | no | yes |
| Marked circle (`hazard`) | yes | **no** | no | yes |
| Bolt | leave range or break line of sight | no | no | yes |
| Net | leave range + 2, or line of sight | **yes** | yes | yes |
| **Sweep** | **no** (2.2) | **yes** | yes | yes, once per 1.5 s |

This reverses `golden-path.test.ts:1675` (as at `630adbf`) for sweeps and nets only. Its assertion, *the slam telegraph, the heavy hit and ordinary swings all land on an airborne player*, **stays true and stays in the file unchanged**; `:1711` (range is measured on the ground plane) stays too, with the one amendment in 6.

**What this rules against.** The foundation card (HOM-151, landed) gives a hop 0.4 u off the ground a dodge of every slam and ground mark (`SLAM_CLEARANCE`, `clearsGround`). On the numbers that is a 0.46 s window, wider than the roll's, for nothing: the elite tier is priced in dodges (a landed slam is 22 to 30 % of health; 3.4a), and a hop would make all of them free *and* keep the player swinging, which walking out does not. It is also the "second dodge with worse range and no reason to exist" the card warns of. It comes off `heavy` and `hazard` and is replaced by the sweep's and the net's check (2.4, 8.1).

---

## 2. The sweep

### 2.1 What it is

A low swing that goes under a jump. It is a `CastKind`, so the machinery that exists takes it: `startCast`, the `telegraph` event, the cast bar, `castName`, the bench's telegraph counters. The enemy plants its feet for the wind-up exactly as it does for a slam; when it resolves, a player inside the ring who is not above the clearance and not inside a roll is hit.

```
SWEEP_CLEAR = 1.1     // u above the floor under the player: a hop clears it by 0.25 at Agility 1 (apex 1.35)
sweep = { windup: 0.9, gap: 0.9 (pairs only), radius: attackRange + 5.5, every, first, damage }
```

It starts under the same conditions as a `heavy` (the enemy is in melee reach and its cooldown is up), with the slam taking priority when both are ready.

### 2.2 The ring is sized so that walking does not answer it

The player stands about 0.9 x `attackRange` from the enemy. The ring is `attackRange + 5.5`, so the distance to leave it is 5.5 + 0.1 x `attackRange`, **5.7 to 5.9 u** on every row below, whatever the enemy's size. In the 0.6 s left after a 0.3 s reaction the player covers **3.6 u walking and 5.4 u sprinting**: neither gets out. A sprint gets out only if it starts within **0.26 s** of the wind-up beginning, which is faster than a person reads a cast bar. A roll covers 4.8 u, also short, but it is untouchable throughout and so does not need to. The 5.5 is the one number that makes the sweep a *jump-or-roll* tell. For contrast, a slam's radius is 4.5 to 6.5 and is left in about 0.7 s.

### 2.3 The hop's timing, in the sweep's own units

The hit resolves when the wind-up ends. A hop clears it if the player is above 1.1 u at that instant, so the key has to go down inside a span measured back from the resolve:

| Agility | Press between (before the hit) | Which is, into the 0.9 s wind-up |
| --- | --- | --- |
| 1 | 0.171 and 0.409 s | **0.49 to 0.73 s after the bar starts** |
| 99 | 0.116 and 0.594 s | 0.31 to 0.78 s |

A reaction of 0.3 s (the slowest one that still reads it) is enough at Agility 1. This is why the wind-up is 0.9 and not 0.8: at 0.8 the earliest press is 0.39 s in, which is the limit of a reaction, and the first hop in the game would be a coin flip.

**A pair** is one cast: the enemy stays rooted for 0.9 s of wind-up, a first ring, **0.9 s more**, a second ring. Nobody rolls both: the lockout is 1.5 s, at every Agility, so **at least one of every pair must be hopped, double-jumped or eaten, at any level.** Two timed hops do answer a pair even at Agility 1: the second take-off has to follow the first landing, which leaves 0.346 s of slack in a 0.9 s gap, and the worst timing of two windows uses 0.238 of it. One hop and a roll answers it too. A pair at 0.9 s is longer than a double jump's 0.85 s air window, so one flip does not cover both: it is the hop's rhythm that the pair teaches.

**Holding the key.** The hop re-fires on landing while it is held, so a player who simply holds jump is above the clearance 43 % of the time at Agility 1 and 69 % at 99 (0.238 / 0.554 and 0.479 / 0.692), and dodges that share of sweeps by luck. A sweep is a quarter to a third of a fight's damage (it is the displaced swings: 25 to 33 % of a trash fight's, about 30 % of an elite's, 2.4), so holding the key cuts a fight's damage by **12 to 21 %** with no skill, against the 25 to 33 % a player who reads the tell saves. That is a ratio of about 2 to 1 between reading and mashing, and it is the weakest joint in this design. I have not spent a landing lag on it, because a lag changes the feel of every hop in the game; **if the bench finds a bot that holds jump through a fight comes out too far ahead, the lever is a 0.35 s `JUMP_LAG` after landing, which takes the share to 26 % and 46 %** (and the saving to 7 to 15 %).

### 2.4 What it costs the player, and why the tables do not move

A sweep is a cast, and a cast displaces swings: after it the enemy waits a full `attackInterval` as it does after a slam, and it swings nothing during the wind-up. A single sweep therefore costs the enemy (0.9 + I) / I swings of its time, **1.38 to 1.56 swings** on these rows. If it lands for exactly that, a player who eats every sweep is where the tuned tables already put them. So damage is **derived, not chosen**:

- a single sweep deals `damage x (0.9 + I) / I`;
- each ring of a pair deals `damage x (0.9 + 0.9 + I) / (2 I)`, **0.88 to 1.06 x the swing**;
- it is flat like a heavy (no 0.85 to 1.15 jitter) and goes through armour like any hit.

Each row equals the swings it displaces by construction, so eating every one is neutral to the accuracy of the model (the swing's own 0.85 to 1.15 jitter averages out over a fight, and the sweep is flat). The coefficient runs 1.38 to 1.56 across rows only because the intervals differ: a crab swinging every 1.6 s loses more swings to a 0.9 s cast than an ogre swinging every 2.4 s. **The reward for answering is the displaced swings**: on a trash fight of ten seconds with one sweep, a clean hop is worth about 1.45 swings of 5, nearly a third of the damage; an elite fight is priced the same way against four pairs. It is a bonus for reading the tell, not a requirement: **no sweep is mandatory and no existing row's time-to-kill or health cost moves for a player who eats them.**

A landed sweep, at the line gear for that level, costs this much of maximum health (the table's last-but-one column): 5 to 10 % for a single, 10 to 15 % for a pair (both rings).

### 2.5 Who carries one, and from where

**Level 10, which is where the road starts, and not before:** the Hale rows (levels 1 to 9) do not carry one, so the first sweep the player meets is a solo Marsh Hog on the Greywater Road, one ring, ten seconds into a fight, at 10 % of health if they eat it. Every enemy in the roster is a solo melee fighter; **no pack carries one** (three rings landing out of step is unreadable: the wolves, hounds and pups are out), **no caster or archer does**, and **no dungeon enemy does**, bosses included: each boss already runs three tells (3.4) and a fourth is a decision for after somebody has played the first three. That leaves **126 of the 353 spawns at level 10 or above**.

| Enemy | Lv | Kind | Swing | Interval | Sweep x swing | Sweep | First / every (s) | Ring (u) | Landed, of max health | Spawns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Marsh Hog | 10 | trash | 35 | 2 | 1.45 | 51 | 5 / 10 | 7.7 | 10 % | 12 |
| Shore Crab | 14 | trash | 34 | 1.6 | 1.56 | 53 | 5 / 10 | 7.2 | 8 % | 8 |
| Mire Troll | 20 | trash | 67 | 2.4 | 1.38 | 92 | 5 / 10 | 8.1 | 9 % | 8 |
| Thornback Boar | 21 | trash | 51 | 1.9 | 1.47 | 75 | 5 / 10 | 7.8 | 7 % | 6 |
| Blight Stag | 22 | trash | 54 | 1.8 | 1.50 | 81 | 5 / 10 | 7.6 | 7 % | 6 |
| Cairn Brute | 27 | trash | 87 | 2.4 | 1.38 | 120 | 5 / 10 | 8.2 | 8 % | 12 |
| Moor Ram | 28 | trash | 62 | 1.9 | 1.47 | 91 | 5 / 10 | 7.9 | 6 % | 6 |
| Ridge Ogre | 30 | trash | 100 | 2.4 | 1.38 | 138 | 5 / 10 | 8.4 | 8 % | 10 |
| Sand Ogre | 35 | trash | 119 | 2.4 | 1.38 | 164 | 5 / 10 | 8.4 | 8 % | 14 |
| Rune Golem | 38 | trash | 120 | 2.4 | 1.38 | 165 | 5 / 10 | 8.4 | 7 % | 12 |
| Toll Captain | 13 | elite (pair) | 54 | 2.2 | 0.91 | 49 x 2 | 4 / 8 | 8.3 | 15 % | 2 |
| Barnacle Ogre | 17 | elite (pair) | 71 | 2.4 | 0.88 | 62 x 2 | 4 / 8 | 8.4 | 14 % | 6 |
| The Bogfather | 21 | elite (pair) | 81 | 2.4 | 0.88 | 71 x 2 | 4 / 8 | 8.5 | 13 % | 2 |
| Thorn Warden | 24 | elite (pair) | 91 | 2.4 | 0.88 | 80 x 2 | 4 / 8 | 8.5 | 12 % | 4 |
| Barrow Lord | 29 | elite (pair) | 116 | 2.4 | 0.88 | 102 x 2 | 4 / 8 | 8.6 | 12 % | 2 |
| Stonehorn | 31 | elite (pair) | 106 | 2.2 | 0.91 | 96 x 2 | 4 / 8 | 8.9 | 10 % | 2 |
| Ashen Colossus | 36 | elite (pair) | 136 | 2.4 | 0.88 | 119 x 2 | 4 / 8 | 9.0 | 11 % | 2 |
| Spire Warden | 39 | elite (pair) | 140 | 2.4 | 0.88 | 123 x 2 | 4 / 8 | 9.0 | 10 % | 2 |
| Old Grey | 12 | rare (pair) | 40 | 1.6 | 1.06 | 43 x 2 | 3 / 8 | 7.7 | 14 % | 2 |
| Gutterhook | 16 | rare (pair) | 55 | 1.8 | 1.00 | 55 x 2 | 3 / 8 | 8.1 | 14 % | 2 |
| Mother Mire | 20 | rare (pair) | 74 | 2.4 | 0.88 | 65 x 2 | 3 / 8 | 8.9 | 12 % | 2 |
| Elder Thornback | 23 | rare (pair) | 80 | 2.0 | 0.95 | 76 x 2 | 3 / 8 | 8.7 | 12 % | 2 |
| The Hollow Knight | 28 | rare (pair) | 92 | 2.2 | 0.91 | 84 x 2 | 3 / 8 | 8.7 | 11 % | 2 |

Trash carry one ring, elites and rares a pair; `every` is a cooldown from the cast's end, as a heavy's is, so an elite's cycle is about ten seconds and a forty-second fight sees four pairs. Ring = `attackRange + 5.5`. "Landed" is the whole cast against the player's maximum health at the line armour of 3.3 (`60 + 2.2 (L - 16)`, floor 50), health `100 + 15 (L - 1)`.

Names, one each, for the cast bar: hogs, boars and the ram *Tusk Sweep* / *Horn Sweep*, the stag *Antler Sweep*, the crab *Pincer Sweep*, the troll, brutes and ogres *Low Swing*, the golem *Stone Sweep*, and the elites and rares the slam's own name with *Sweep* for *Slam* (the Anchor Slam becomes the *Anchor Sweep*). Names are the data's, the art is the Engineer's.

### 2.6 Why a fight with sweeps is "not fully rollable" at any level, and "comfortable" at a high one

The card asked for a fight a low-Agility player cannot roll end to end and a high-Agility player handles easily. The first half is stronger than asked: **an elite or rare fight cannot be rolled through at any Agility**, because a pair's rings are 0.9 s apart and the lockout is 1.5 s (2.3). What changes with Agility is the *other* answer: the hop's window goes from 7 ticks to 14 (1.1) and at 25 the double jump arrives, so by Agility 99 the pair is two comfortable hops; at Agility 1 it is one roll and one tight hop, or two tight hops. A single trash sweep *is* rollable end to end at every level (a roll per ten seconds is well inside 22 a minute), and that is intended: the trash sweep is the lesson, and rolling it costs 0.6 s of swings that hopping does not.

### 2.7 The bench

The tell has to be dodgeable by the bench before it can be priced by it. Extend `bench/combat.mjs`'s `--dodge none|slam|all` with **`hop`**: jump so that the hit resolves in the middle of the window (0.29 s before it at Agility 1, 0.35 at 99), count sweeps and nets seen, hopped, rolled, landed, and **say so if a mode that claims to hop lands none** (the bench has lied about this three times: 3.4a). `--dodge-rate P` applies as it does to slams.

---

## 3. The net

**Jumpable: yes, at the same clearance as the sweep, 1.1 u above the floor under the player.** The card is right that it is the cheapest reason to jump in the game: it already telegraphs (1.1 to 1.2 s), it already resolves at one instant in `updateCast`, and the only enemies that throw one (Footpad level 12, Drowned Sailor 15) are two rows. The same arithmetic as 2.3: the press goes down 0.17 to 0.41 s before the net resolves, which is 0.7 to 1.0 s into a 1.1 or 1.2 s wind-up, so the reaction budget is generous.

What a miss does: the net passes under you, `netCd` is still spent (the enemy has thrown it), and `netRun` is *not* set, so **the shooter does not back away**; that is what a roll already does (`updateCast` returns before it sets `netRun`), so a hop is the same answer without the 45 breath, and it keeps your feet and your place. `ROOT_CUT` (a net lets go of an Agility-99 player in half the time) is unchanged and stacks: a player who misses the hop still gets the shorter hold.

The window is the hop's (0.238 s at Agility 1 to 0.479 at 99), against a 12 to 14 s cooldown and a 1.1 to 1.2 s wind-up, so it is as hard as the first sweep and far rarer. Nothing else about nets changes.

---

## 4. The double jump

### 4.1 The level: 25

The file says it itself (`agility.ts`): *level 10 in about three minutes of running, 50 in an afternoon, and 99 out of reach.* I checked it against the real curve (`xp.ts`) with a bot that sprints whenever it can and stops when winded, which is what the meter allows (the refill is a share of the meter, so recovery from empty to 30 % is 1.8 s at any level):

| Agility | XP | Minutes of continuous sprinting |
| --- | --- | --- |
| 10 | 1,154 | **2.0** |
| 17 | 3,115 | 5.2 |
| 20 | 4,470 | 7.2 |
| **25** | **7,842** | **12.2** |
| 30 | 13,363 | 19.9 |
| 40 | 37,224 | 51.7 |
| 50 | 101,333 | **133** |
| 60 | 273,742 | 344 |
| 99 | 13,034,431 | out of reach |

The file's claims hold (2.0 minutes unbroken is its "three" once a person stops to look, and 133 minutes is its "afternoon"). **25 is 12 minutes unbroken**, which for a player who sprints a quarter of the walking they do (my guess; section 9) is the first hour or so after leaving Hale. Against the alternatives:

- **10 to 17** is under five minutes and the unlock disappears into the skill's first screen of levels, so the board's "unlock by levelling Agility" would be over before it was noticed.
- **20** is 7 minutes: defensible, a round number, and the lever to pull if 25 reads as slow (it costs nothing but the number; the reach rule does not depend on it).
- **30 and over** is 20 minutes or more of unbroken running, and the first mount (combat 20, 10 u/s against a sprint's 9) ends sprinting for most players, so a threshold that needs a lot of it is one many never reach.

The unlock should arrive while the player is still on foot and still in the first half of the climb. 25 is that.

### 4.2 What the second jump is

**A fixed apex.** The second jump takes the player to **3.2 u above the floor they took off from**, from wherever in the hop they press it: its takeoff speed is whatever gets there (`sqrt(2 x GRAVITY x (3.2 - height above the floor))`), so pressing at once and pressing at the top land on the same height, and Agility, which scales the first jump, has no say in it. It is not a share of the first jump and not additive.

I tried the alternatives against the one thing this section has to satisfy, that a rooftop is reachable by *every* double jumper and by *no* single jumper:

| Rule | Total reach at Agility 25 | at 99 | A rooftop between the best single hop (+0.39) and the worst double (-0.4) |
| --- | --- | --- | --- |
| Full second jump (the card's "2.7 u", 2 x the first) | 3.04 | 4.22 | 2.5 to 2.64: a 0.14 band, nothing to author |
| HOM-151's placeholder (0.85 of the first) | 2.62 | 3.63 | **none**: the worst double less its 0.4 slack is 2.22, under the best single hop's 2.5 |
| **Fixed apex 3.2** | **3.2** | **3.2** | **2.5 to 2.8, a 0.3 band, equal at every level** |

A reach that depends on the first jump is continuous again, which is the thing 5.1 rules against. A fixed apex has no continuous part.

**It costs 40 breath**, which is 18 % of the meter at Agility 25 (220) and a second of refill: a free flip would make the sweep trivial for every player past 25, and a 70-breath one would take a third of the meter at the level it unlocks. At 40 the double jump costs less than a roll (45) and its window is 2.3 to 2.8 times a roll's, so against a sweep **it is the cheapest answer there is**: that is the reward. **It is pressed separately** (a held key does not spend it), once per time in the air, and it **is available again on landing on any top or the ground**. It does nothing above 2.9 u of height (it would be a wasted breath) and is not allowed **while mounted** (6).

---

## 5. The reach rule

### 5.1 The rule

The card names it exactly. Height is continuous in Agility (1.35 u to 2.11 u); a ledge between those two is reachable iff you have ground enough Agility, and the player's experience of that is "almost". So: **reach is gated on three discrete capabilities, the hop, the double jump and nothing continuous, and content is only ever authored in the bands between them.**

| Capability | Who has it | Worst case | Best case |
| --- | --- | --- | --- |
| **Hop** | everyone | apex **1.35 u** (Agility 1, from a standing start) | apex 2.109 u (Agility 99) |
| **Double jump** | Agility 25 and 40 breath | apex **3.2 u** (every level) | 3.2 u |

The standable tops (a `top` on an obstacle, as HOM-151 builds it), **measured above the floor beside them**:

| Tier | Top height | Clearance from the capability it needs | Clearance above the one it must not be open to |
| --- | --- | --- | --- |
| **Step** (a hop) | **0.4 to 1.0 u**, author at **0.6 and 1.0** | **0.35 u** under the worst hop (1.35 - 1.0) | n/a |
| **Rooftop** (a double jump) | **2.5 to 2.8 u**, author at **2.6 and 2.8** | **0.40 u** under the fixed apex (3.2 - 2.8) | **0.39 u** over the best single hop (2.5 - 2.109) |
| *Dead zone* | **1.0 to 2.5 u: nothing is standable.** Above **2.8** nothing is standable either | | |

- **Steps top out at 1.0.** At 1.0 a player who clips a step's rim at Agility 1 still has 0.35 u of apex over it and the time above the top that goes with it (about 0.13 s on the way down); at 1.2 they would have 0.15 u and a lottery.
- **A rooftop needs a 2.0 u radius.** The player is above a 2.8 top for 0.14 s on the way down from the apex (`sqrt(2 x 0.4 / 42)`), which is 0.83 u of runway walking and 1.24 sprinting; with `STAND_LIP` 0.3 a 4 u wide roof is landable and a 2 u one is a lottery. Steps need 1.2.
- **The rule is relative, not absolute.** Take the step *between two standable tops*: any two tops a hop apart (gap 2.5 u or less) differ by 1.0 or less, or by 2.5 to 2.8. That forbids a 2.8 rooftop beside a 1.0 ledge (a 1.8 rise, the dead zone), which would otherwise be an Agility-99 hop from the ledge, 3.11 u, the "almost" back by a side door. A staircase of 1.0 steps is fine and has no upper bound; a rooftop on a rooftop (5.4 total) is two flips and fine too.
- **Nothing standable that is not authored.** Every obstacle without a `top` stays a wall at any height, as HOM-151 has it. That is what keeps an Agility-99 player who rises 2.1 u past a 1.6 u rock from being told they were almost on it: a rock is a rock. The art has to say which is which, and HOM-152 already does: a standable rock is cut off flat under a pale worn cap, where every other rock is a dome with a point. That grammar is the rule's other half and it should be held for rooftops (a flat pale cap on a roof ridge or a tower's parapet) as well.

### 5.2 Gaps

Horizontal reach is continuous too (airtime is 0.554 s to 0.692 s and speed is 6 walking, 9 sprinting), so the same rule applies, and it leaves much less room:

| | Distance covered in a hop |
| --- | --- |
| Walking, Agility 1 (the worst case anyone has) | **3.32 u** |
| Walking, Agility 99 | 4.15 |
| Sprinting, Agility 1 | **4.98** |
| Sprinting, Agility 99 | 6.23 |
| Roll | 4.8 (ground only) |

**Gaps between tops are 2.5 u or less (rim to rim), and no wider gap is authored.** 2.5 is 75 % of the worst walking hop, so it is a hop for anyone, standing or running. A wider tier does not fit. A gap that needs a sprint has to be longer than the best *walking* hop (4.15) plus a margin and shorter than the worst *sprinting* one (4.98) minus a margin, and with 0.35 each side that is **4.5 to 4.63 u**, a band of 0.13 that no level designer can place a rock inside. A gap that needs a double jump has more room, 6.6 to 7.35 u (above the best sprinting single hop, 6.23, plus 0.35; below the worst sprinting double, 7.7, minus 0.35), but it is open only to a player who is sprinting *and* flipping (a walking double jump covers 5.2 to 6.2), which is a third capability on top of the two, with 0.75 u to place it in. Chests do not need it. So **horizontal reach is not a tier**; the gate is height.

### 5.3 The roll is not a reach capability

The card offers it; the numbers refuse it. **The roll covers 4.8 u and a sprinting hop at Agility 1 covers 4.98, for 11 breath against 45.** Any gap a roll can cross, a sprinting hop crosses cheaper, and a gap past 4.98 is past the roll as well. A roll that carried you over a pit would also be the only move in the game that does, which is a new rule with nothing under it. **The roll's role in the world is the combat role it already has.** (Rejected with it: a *breath gate*, a sprint through a closing door. It is a real capability, but it is continuous in the meter (45 u at Agility 1, 87 at 20, with nothing between that stays unambiguous) and needs an object, the timed door, that does not exist.)

### 5.4 `JUMP_LIFT`

**It stays.** With 5.1 in place it cannot produce an "almost" at any standable top: every top is at least 0.35 u under the worst hop, or at least 0.39 u over the best, so a player at any level either clears it with room to spare or cannot clear it by a margin they can see. What it does buy is *time*: the hop window of 1.1 grows from 7 to 14 ticks and the hang is 0.13 s longer, and those are the Agility rewards the card's own "comfortably so at high" asks for. **The constraint on it is permanent: `JUMP_LIFT` may scale time in the air, and never reach.** If a later change makes it scale the height of a standable top, 5.1 breaks. The comment on `JUMP_LIFT` in `agility.ts` (*"a free one: the world is flat and nothing reads `y`"*) and the one on `JUMP_VELOCITY` in `data.ts` (*"expression, not traversal"*) are now false and are rewritten by whoever builds 8.1.

### 5.5 The checker that proves it

The rule is a property of the *data*, so it is a headless check, not a review: **build the graph of standable tops** (nodes are tops, edges join two tops with a gap of 2.5 u or less, labelled *hop* if the rise is 1.0 or less and *double* if it is 2.5 to 2.8, anything else being an error), find each chest's cheapest route from the ground, and assert (a) no edge is in the dead zone, (b) no top is above 2.8 or between 1.0 and 2.5, (c) the tier each chest *declares* is the tier the route *needs*. It is about forty lines and it is the whole reach rule, executable.

---

## 6. The anti-kite rule

If a player can stand on a rock and a melee enemy cannot follow, every melee fight in the game is free: the throw has range 9 (`Serrated Throw`), the burst has range 9, and the perch needs no skill. Rules, in order of what they close:

1. **Reach is measured rim to rim for both sides.** HOM-151 has the enemy's half: it closes in on the rim and reaches across it (`dist - perch.r <= attackRange`). **The player's half is missing and the asymmetry hurts the player**: an enemy stops at `0.9 x attackRange + r` from the middle and hits from there, while `AUTO_RANGE` and every ability's `range` are 3 to 4 centre to centre, so on a step wider than about 1.0 u (0.4 against an ogre) the player cannot answer a hit that lands. The rule is: while the player is on a top, **every distance their reach, abilities and auto-attack read has the top's radius taken off it.** Standing on a step then changes who is standing where and nothing about who can hit whom, which is what a rock should do. (`golden-path.test.ts:1711` stays true: range is still measured on the ground plane; it is measured to the rim.)
2. **A step does not make you immune to a sweep or a net.** The clearance of 1.1 is measured *above the floor under the player* (`y - floor`), not above zero, so standing on a 1.0 step is not already 1.0 of a 1.1 clearance. Without this a perched player is above every low tell for as long as they stay on it.
3. **A rooftop (a top of 2.0 or more) is out of the fight, and it is a reset, not a win.** No enemy acquires a player standing on one, and an enemy already chasing one drops the chase after **2 s** with `startReturn` (it walks home, heals, and cannot be targeted while evading, which is the leash's existing rule). Bolts and the throw cannot be the exploit because there is nothing left to throw at. **Intended consequence:** a Hoard is an escape hatch for a player who can reach one, and the fight does not carry on.
4. **Nobody can stand somewhere a boss fights.** No top is placed in a boss room or within 14 u of a boss spawn (a boss's slam reaches 6.5 and its marked circle 16, but a rooftop is out of the fight anyway, rule 3: 14 is the margin round the room).
5. **A mounted player does not perch and does not double jump.** A horse is not a climber, and it keeps mounted speed (10 to 13 u/s) out of the gap rule's arithmetic (5.2), which assumes 6 to 9. Mounted, the tops are walls.
6. **Falling is free.** No fall damage, from any top; the highest is 2.8. A player on a rooftop can always step off.
7. **A chest is opened from the floor it stands on** (7.6). Without it a player on the ground beside a rooftop is in horizontal reach (1.5 + the chest's radius + 0.5) of a chest two metres over their head.

---

## 7. The chests

### 7.1 Count and tiers

The card says 32 regions; `REGIONS` has **30** at `630adbf`: sixteen are cave rooms of five dungeons, and fourteen are open country (the ridge, the seams, the waysides and the districts are parts of a larger place). **The unit is the place, not the region:** nine open places and five dungeons.

| Tier | Needs | In the dark | Count |
| --- | --- | --- | --- |
| **Stash** | nothing: it is off the road, behind something | no pin, no marker; a chime within 12 u | **18** |
| **Cache** | a hop: a step (0.6 or 1.0 u) or a run of them | glimpsed from the road | **17** |
| **Hoard** | **the double jump (Agility 25)**: a rooftop (2.6 or 2.8 u) | **visible from the road, on purpose** (7.4) | **15** |
| | | | **50** |

| Place | Band | Stash | Cache | Hoard | Total |
| --- | --- | --- | --- | --- | --- |
| Hale's Rest and the ridge | 1 to 11 | 1 | 1 | 1 | 3 |
| The Hollow | 7 to 11 | 1 | 1 | | 2 |
| Greywater Road | 10 to 13 | 2 | 1 | 1 | 4 |
| Saltmarrow and the Strand | 14 to 17 | 1 | 2 | 2 | 5 |
| The Drowned Grotto | 16 to 19 | 1 | 1 | | 2 |
| Dunmere Fens | 18 to 21 | 2 | 1 | 1 | 4 |
| Thornwick and the Thornwood | 21 to 24 | 1 | 2 | 2 | 5 |
| The Rotroot | 23 to 26 | 1 | 1 | | 2 |
| The Barrowdowns | 25 to 29 | 2 | 1 | 2 | 5 |
| Highmoor and the Moor | 28 to 31 | 1 | 2 | 2 | 5 |
| The Cairn Hold | 30 to 32 | 1 | 1 | | 2 |
| The Cairnwaste | 32 to 36 | 2 | 1 | 2 | 5 |
| The Spire and its ruins | 36 to 40 | 1 | 1 | 2 | 4 |
| The Sundered Vault | 38 to 41 | 1 | 1 | | 2 |
| | | **18** | **17** | **15** | **50** |

**A dungeon holds a stash and a cache and no hoard**: there is no rooftop underground, a cave's ceiling is not a thing the sim knows, and a boss room has no tops at all (6, rule 4). **Players can open 35 of the 50 with a hop and a walk (70 %); the other 15 are the double jump's, and a player who has it opens all of them.**

### 7.2 Spread

- **One per 165 to 215 u of the long roads** (Greywater 800 long: 4; Dunmere 850: 4; Barrowdowns 900: 5; Cairnwaste 830: 5), against a walking pace of 6 u/s: about half a minute between possibilities. The towns' squares and their 140 x 140 floors carry 4 to 5 apiece.
- **No two chests of the same place closer than 100 u** in open country, and **at most one per room** in a dungeon.
- **15 to 60 u off the road line**, so finding one means *leaving the road*, and **at least 16 u from any spawn** (the widest notice radius is 12, and 4 is the margin).
- **Not inside a safe circle** except hoards: a town rooftop is the best-placed, most-visible hoard there is and the player is safe while they work out the climb. Hale's is the one that matters (7.4).
- **Each region's keeper has one line for each chest tier.** "There's a pot of coin on top of the old watchtower; nobody's got up there since the fire" is the rumour of 6.1 applied to chests: it pins nothing on the map, and it says which capability it wants.

### 7.3 What is in them

The two facts the card names decide this, and so does a third it did not: **every item in the game is worth its `value` in gold at any vendor** (`shop.ts` sells at full `value`), so any item a chest holds competes with the gold, the crafting and the drop tables at once, whatever it is. A chest therefore holds **coin, Agility XP and one of four lanterns, and nothing else.**

| | Stash | Cache | Hoard |
| --- | --- | --- | --- |
| **Coin** | 0.5 x (0.6 L + 3) | 0.5 x (0.6 L + 3) | 1.0 x (0.6 L + 3) |
| **Agility XP** | none | **half a level** | **a full level** |
| **A find** | | | 3 of the 15: a lantern |

- **L is the player's combat level at the moment they open it**, not the region's. `0.6 L + 3` is the expected sale value of a kill's drops at level L (3.1 and the headless check in 8.4 of world-design; the mean kill, with elites and bosses in, is 1.51 times it), so a stash or cache pays a third of a mean kill's gold (about 5 gold at level 10, 11 at 30) and a hoard two thirds (15 at level 20, 27 at 40). That is all of the money this adds: **557 gold over all fifty, 371 of it through combat 31, which is 8 % of the 4,650 the climb to 30 pays** (7 of world-design: 4,400 to 4,900), and it leaves most of the 500 to 1,000 by which the sinks exceed income where it was. If the board wants chests richer in coin, the knob is the three multipliers, and every extra 0.5 x (0.6 L + 3) on every chest costs about 425 gold over the game. I priced it low on purpose: gold is the one currency the economy is short of by design, and the rest of what is in a chest is not gold.
- **Agility XP is paid as a share of the level the player is on, capped.** "Half a level" is half of the XP from this level to the next, at the level they are *when they open it*, and **a lamp never pays more than 10,000 XP** (the span of level 50 is 10,612, about 11 minutes of sprinting at the ~15 XP/s the meter allows). So the same cache is worth 274 XP at Agility 20 and 1,974 at 40, and a player who comes back at 60 gets a hoard's 10,000 rather than 28,546. Over all 50 it is **at most 23.5 levels' worth (17 half-levels and 15 whole ones), and the cap bites a hoard from Agility 50**. It is the one thing a chest gives that sprinting does not give faster, and it is the reward for the capability the chest tested, which is the card's "reasons to explore other than quests and skills": a hoard pays the skill it asked for.
- **The finds: four lanterns, an off-hand item whose only stat is light.** The torch (HOM-148) is the one item in the game whose stat is light and not damage or armour, which makes a lantern the one equippable that adds nothing to the gear ladder: it takes the off hand, it does nothing in a fight, and it lights the dark further. TORCH_REACH is 26.

  | Lantern | Light | `tier` | Where |
  | --- | --- | --- | --- |
  | **Tinker's Lantern** | 30 | 2 | the Hale hoard |
  | **Hedge-Warden's Lantern** | 34 | 3 | the first Thornwick hoard |
  | **Cairn Lantern** | 38 | 4 | the first Highmoor hoard |
  | **Surveyor's Lantern** | 44 | 6 | **the 50th chest** (7.5): it is given for the finishing, not found in one |

  Each ships with the standing rule: **an equippable has a `tier` and an appearance, and the bench has to show it in the character's hand.** No lantern look exists (the torch is the only off-hand model), so this is three to four models for the 3D Artist and is the cost of this item (8.2); the tier fallback has no offhand model to fall back to. **A lantern's `value` is 10**, not what it deserves: the vendor pays full `value`, and the rune circle turns a piece of tier 2 or more into `value / 10` dust and `8 x value` Enchanting XP, so a lantern worth 500 would be 4,000 Enchanting XP across a counter.
- **What is deliberately not in a chest**: **combat XP** (it feeds the level ladder, and a lamp of it is a shortcut round 3.2's 152 kills), **gear** (the ladder is fed by smithing and drops, 3.3, and a chest of it competes with the thing the player is grinding), **ore, bars, shards, hides, herbs** (every one is somebody's skill XP or a capstone's gate), **dust** (the Vault's reason to go back), **potions and food** (alchemy's and cooking's; each is also worth its `value`). The lanterns are the only items.
- **An optional slot I have not filled:** each stash could carry a short note, a page of the world's own writing. It costs nothing in the economy and writing time rather than balance time; the text is not mine to write.

### 7.4 Parity, and why a chest is never worth less than it was

`XP_PARITY` floors old content at 10 %, so a chest that paid parity XP would be worth a tenth the moment the player outlevelled the region, which defeats hiding it. **A chest does not use parity because it does not pay combat XP**; what it pays is indexed on the *player* at the moment of opening: coin on their combat level, the lamp on their Agility level. A level-40 player who opens a level-6 stash in Hale gets the coin of a level-40 stash and the lamp of their Agility, so **no chest decays, and none inflates**: the only gain from waiting is that coin is `0.6 L + 3`, so opening all fifty at 40 is worth 877 gold against 557 in order, a difference nobody will plan a game around. The finds and the final lantern are constants.

**A hoard is seen before it is reached, on purpose.** The tier's point is the card's "some would require jumping or agility skills to get to": a player at Agility 1 standing in Hale's square sees a chest on a roof they cannot reach, and the journal says why ("a hoard on the old watchtower: needs a second jump, Agility 25"). That is the reason to run the roads and the reason to come back, and it is why a hoard's position must be visible from the road rather than from the roof. (HOM-152's chest is built the other way, for a stash: a single cold glint that reads as "something is there" at the edge of sight. That is right for the stash and the cache; the hoard is the one chest that has to be loud.) **Every chest tells its requirement by name**, so "almost" is never what a player feels: a hoard says Agility 25; a cache says a jump; a stash says nothing, because there is nothing to say.

### 7.5 No respawn, a counter, and a last lantern

**No chest respawns.** Respawn plus parity is a farm, and a respawn timer plus a fixed content is a grind; the entire reason to hide a thing is that it is found once. Every chest is saved as opened (an id in `player.chests`, a string array, in the save).

**"All of them" is a thing the player can be told they have done**, because the total is finite and never changes: **50.** The journal shows each place's count ("Greywater 2 / 4"; the total is told, the places are not), the map's region label carries it, and **the 50th chest** gives the **Surveyor's Lantern** (44 light, tier 6) as a find of its own, announced like a level. A player cannot open the last hoard without the second jump, which is the point of the lantern's being at the end.

### 7.6 The interaction rule

The chest is an interactable like a node (the E key; the `Interact` union gains `'chest'`; `REACH` 1.5 applies). **It is opened from the floor it stands on:** the player's floor under their feet must be within 0.3 of the chest's, so a player on the ground cannot open a chest on a rooftop through its footprint, and a player on the rooftop can. The chest itself is a 0.8 u prop with no `top`: you stand beside it, it is not something to climb.

---

## 8. What gets built, and who builds it

### 8.1 The four constants that change in HOM-151's working tree

These are on master in `3c0f7ee` (`sim/agility.ts:87-90`, `sim/combat.ts:29-31`), each marked a placeholder pending this document. The structure (a `top`, `perchAt`, falling, a double jump, the enemy's rim reach) is what this document needs and is not touched.

| In the tree | Ruling | Where |
| --- | --- | --- |
| `SLAM_CLEARANCE = 0.4` on `heavy` and `hazard` (`clearsGround`) | **Delete from both.** The `clearsGround` check moves to a new `sweep` kind and the net, at **1.1**, measured **`y - floor`**. | 1.3, 2.1, 6.2 |
| `DOUBLE_JUMP_LEVEL = 10` | **25** | 4.1 |
| `DOUBLE_JUMP_SHARE = 0.85` (`vy = jumpVelocity x share`) | **Replace with a fixed apex of 3.2 above the floor**: `vy = sqrt(2 x GRAVITY x (3.2 - (y - floor)))`; do nothing above 2.9. | 4.2 |
| `DOUBLE_JUMP_COST = 0` | **40** | 4.2 |

Also from `3c0f7ee`: the enemy's rim reach is right and the **player's is missing** (6, rule 1); a mounted player must not perch or double jump (6, rule 5); and the slam assertion HOM-151 rewrote (it said a slam, a heavy hit and ordinary swings all land on an airborne player; it now says a well-timed hop dodges the slam) **should be put back as it was**, with a new one added for the sweep and the net (8.4). The second test (abilities work mid-jump) it kept as it was, which is right.

**Applied in HOM-158**, with one finding the document did not have. The sim stepped `y` with semi-implicit Euler, which loses `v dt / 2` off every rise: the 1.35 hop peaked at 1.20, so the 0.238 s window over 1.1 was **0.133 s (4 ticks)**, and a double jump aimed at 3.2 would have peaked at 2.97. `stepVertical` now uses the exact step for a constant `g`, so `JUMP_HEIGHT` is the peak and the windows are the ones worked out in 2.3 (7 ticks, 0.233 s, at Agility 1; 15, 0.5 s, at 99). Everything else in the table is as ruled: `SLAM_CLEARANCE` is gone from the slam and the marked patch (the `:1675` test is back as it was), `clearsGround` is `y - floor >= SWEEP_CLEAR = 1.1` and the net asks it, the double jump is Agility 25, 40 breath, a fixed 3.2 apex and nothing above 2.9 (a press up there is not spent). The sweep itself (8.3 step 2) is not built yet.

### 8.2 Who builds which part

- **Me, in `src/sim/`:** the `'sweep'` kind (`data.ts`: the `CastKind`, the `EnemyDef.sweep` field, `castName`; `combat.ts`: the cast, the pair, the floor-relative clearance, the rim rule for reach; the 23 rows), the net's clearance, the chest module (`chests.ts`: `CHESTS`, `openChest`, the counters, the Agility lamp, the four lanterns in `items.ts`), the save field, and the headless checks (8.4). **Coordinated with Game Engineer through HOM-151**, who owns `sim.ts` and the vertical step: the 8.1 table is the request.
- **Game Engineer:** the telegraph for a ring (it is the slam's circle at a bigger radius with a visible second ring for a pair), the `sweep` cast bar, the chest interaction and a chest prop, the journal and the map counters, the bench's `--dodge hop` (2.7). **Ask:** `telegraph` for `'sweep'` carries `radius` like a ground mark does, so the renderer does not have to look it up.
- **3D Artist:** HOM-152 has the chest (closed, open, spent: "a dull, low, near-rock-coloured box found by its one cold glint") and the standable rock's flat pale cap, and the first is exactly a **stash**. What is left: **a cache variant** and **a hoard variant that is visible from the road on purpose** (7.4: it has to read from 60 u, from a rooftop, which a single glint does not), **the cap on rooftops** (5.1), four lanterns, and the sweep's ring (a low blade of dust, not a column). **Where the tier fallback would give a lantern a look unworthy of the grind, say so**: there is no offhand fallback at all, so it is not a fallback question this time.
- **Sound:** the chest chime (12 u), the opening, the lantern.

### 8.3 The build order

1. **HOM-151** (in flight): `y` readable, tops, the double jump, with 8.1 applied.
2. **The sweep and the net** (mine): small, nothing else depends on it, and it is the half of this document that makes the jump matter. The 23 rows are data.
   **Applied in HOM-165** (`data.ts`: `CastKind` `'sweep'`, `EnemyDef.sweep`, `castName`, the 23 rows in `SWEEP_ROWS`; `combat.ts`: `startSweepCast`, `sweepRing`, a pair as one cast of 1.8 s with `struck` marking the first ring; `sim.ts`: `Enemy.sweepCd`; `src/sweep.test.ts` in `npm run verify`). The rows are **derived, not typed**: a row is `(name, tier)` and the damage, ring, first and every come from the enemy's own `damage`, `attackInterval` and `attackRange`, so a retune of a swing carries into its sweep (all 23 equal 2.5's figures). The telegraph carries `radius`, the ring's centre and, for a pair, `gap`; each ring raises the existing `slam` event (the dust ring and the shake come free; a bench that counts `slam` will count rings). A hit is `heavy`, so Thick Skin answers it. Three findings the document did not have. **Spawns:** 2.5's "126 of 353 spawns" is 63 of 196 in the world as it stands (every row's count is exactly half the table's); the 23 rows and the roster are right, the count was of a larger spawn list. **Neutrality is 4 % off, not 0:** eating every sweep costs within 0.9 % of the old tables on 21 of 23 rows over 600 s, but the Barnacle Ogre reads 4.0 % under and Mother Mire 2.9 % under, because the slam takes priority and a cast now sits in front of it; inside 8.4's 5 %, and the same sign (a little kinder) on both. **Holding jump** saves 9 % / 15 % (hog, Agility 1 / 99) and 14 % / 20 % (Barnacle Ogre) against 22 % / 27 % for reading the tell: at Agility 99 that is three quarters of reading, not the 2.3's one half, so the weakest joint holds up worse at the top than at the bottom; `JUMP_LAG` is not applied (it changes every hop in the game), and 2.3's lever stands.
3. **The chests** (mine, after the reach checker): the module, then the fifty placements, a place at a time.
   **Applied in HOM-160** (the reach checker, `sim/reach.ts` and `reach.test.ts`; the props, `sim/perches.ts`): 25 of the 32 caches and hoards are placed (11 caches on steps of 0.6 and 1.0, 14 hoards on rooftops of 2.6 and 2.8; steps r 1.3, rooftops r 2.2), each chest standing in the middle of the perch it is read off, so the two cannot disagree. Three things the document did not have. **Spacing:** 7.2 asks for 100 u between a place's chests and for four or five in a town's 140 x 140 floor, which cannot both hold; the 100 u is kept along the four long roads and a town's is **35 u**. **Seven are not placed:** Hale's cache and hoard and the five dungeons' caches, because every region render.ts draws itself (Hale's clearing, ridge and seams; every cave, where an obstacle is a standing stone) has no way to show a top, and a step you cannot see is a chest floating over bare floor. **A dungeon's rooms:** each has three or four, one of them the boss's (no top within 14 u of a boss spawn, 6 rule 4) and the corridors are 5 to 8 u wide, so a cache wants either a corridor step or a boss-room corner, and 7.2's "one chest per room" leaves no third choice: that is a call for whoever builds the cave perches. The hoard is 2.8 u of plinth under a small chest and reads from 45 u as a pale block with a glint; "visible from the road, on purpose" (7.4) is the 3D Artist's hoard variant.

   **Applied in HOM-161** (Hale's clearing and every cave draw a prop with a top as a standable rock, render.ts and world-view.ts; the seven are data in `sim/perches.ts`): all 50 chests are placed, 18 stashes, 17 caches and 15 hoards. Hale's cache is on the clearing's west edge (-27, -3) and its hoard is a 2.8 u watchtower on the middle of the south edge (2, 26), in plain sight of the square. **A dungeon's cache is in a room, never a corridor**: the Hollow's corridors are 5 u wide, and a 1.3 u step leaves a lane too narrow for the Hollow Ogre to follow you out. Steps stand 2.7 u from a cave's wall, so there is no slot narrower than a body for one to be shoved into. Grotto, Rotroot, Cairn Hold and Vault put it in the corner of the boss's room on the door's wall, as far from the door as the wall goes, 17 to 29 u from the boss. **The Hollow is the exception**: the Warden's hall is 22 u square, no point of it clear of the pillars is 14 u from him (6, rule 4), so its cache is in the cavern (the east end, 5 u from the nearest spawn, where the other dungeons keep 8) and its stash moved into the hall (-27, -89), 11 u from him: the loot in the Warden's room is the stash, not a top. **Hale's spawn rule:** 16 u from every spawn does not fit a 60 u square with eleven of them; the rule there is 4 u outside every spawn's notice radius (the widest is 10).
4. **Art, in parallel from step 2**: the sweep ring, the chest and the lanterns are the long lead.

### 8.4 The headless checks that make this executable

These are assertions in `src/golden-path.test.ts` (or a sibling that joins `npm run verify`), each a sentence above:

1. **The windows**: the hop clears 1.1 for 0.238 s at Agility 1 and 0.479 s at 99 (within 0.01); the double jump's apex is 3.2 within 0.02 at Agility 25, 50 and 99 and at three press times; the hop at Agility 1 and a walking start reaches 3.3 u horizontally.
2. **The tells**: a hit that resolves while the player is above 1.1 is a miss for a `sweep` and a `net`, and a hit on a player 3.0 u up still lands for a `heavy`, a `hazard`, a bolt and a swing (this is `:1675` unchanged).
3. **The sweep is neutral**: a bot that does not dodge takes within 5 % of the damage the old tables give on all 23 rows (it replaces swings 1:1), and one that hops every sweep takes less by the swings displaced (1.38 to 1.56 a single), within 20 %. A bot that holds jump through the fight is measured too, against 2.3's 12 to 21 %.
4. **The pair cannot be rolled twice**: the second ring of a pair always lands on a player who rolled the first.
5. **The reach checker** (5.5): no top in the dead zone, no two tops a hop apart with a rise in (1.0, 2.5), every gap 2.5 u or less, every chest's declared tier equal to the tier its cheapest route needs.
6. **The anti-kite rules** (6): a player on a step is hit and can hit back at the same range as one beside it; a player on a rooftop is dropped by the chase after 2 s and acquired by nobody; a mounted player cannot take a top.
7. **The chests**: 50 ids, unique; 18 / 17 / 15; the per-place counts in 7.1; none inside a safe circle but a hoard; none within 16 u of a spawn; none within 14 u of a boss; coin follows `0.5 / 0.5 / 1.0 x (0.6 L + 3)` at levels 5, 20, 40; the lamp is the share of the span at the player's Agility and never above 10,000; opening twice pays once; the 50th opens the Surveyor's Lantern; a save round-trips `player.chests`; no item but the four lanterns is ever granted; each lantern's `value` is 10.
8. **Existing checks stay green**, with `:1675` unchanged.

---

## 9. What I tuned, what I compared it to, and what I could not verify

**Tuned**, and to what:

- **The sweep's clearance, 1.1**, to a hop window at Agility 1 of **0.238 s (7 ticks)**, against the roll's 0.30. **Compared against:** the roll's i-frames (0.30), the net's wind-up (1.1 to 1.2 s) and a reaction of about 0.3 s. At 1.0 it is 0.282 s, at 1.2 it is 0.185.
- **The wind-up, 0.9 s**, so the earliest press at Agility 1 is 0.49 s into it (0.8 would put the first hop on the edge of a reaction).
- **The ring, `attackRange + 5.5`**, so a walk (3.6 u) and a sprint (5.4 u) in the 0.6 s left after a 0.3 s reaction both fall short of the 5.7 to 5.9 u it takes to leave, against the roll's 4.8.
- **Sweep damage, derived** from the swings it displaces (1.38 to 1.56 for a single, 0.88 to 1.06 each ring of a pair), so that the tuned TTK and health tables do not move.
- **The double jump at Agility 25**, against 12 minutes of unbroken sprinting measured on the real XP curve and the file's own claims (10 in three minutes, 50 in an afternoon: I measure 2.0 and 133 minutes).
- **40 breath**, against a roll's 45 and a meter of 220 at the level it unlocks.
- **Chest coin**, against a mean kill's 22 gold and the 500 to 1,000 by which the economy is deliberately short; **the lamp**, against the sprint's 15 XP/s.

**Could not verify by play, in order of how much it could change:**

1. **Whether 238 ms is a fair window.** Seven ticks is a number; whether a person who has watched a bar for 0.5 s lands a key inside it nine times in ten is not, and the first sweep in the game (the Marsh Hog, level 10) is where it first matters. **Lever: `SWEEP_CLEAR`**, 1.0 gives 0.282 s. The bench's `--dodge hop` with `--dodge-rate` tells how a *bot* that misses some does; it cannot tell how a person does.
2. **Whether people read a pair as a rhythm or as noise.** Two rings 0.9 s apart on every elite is the thing I am least sure of; the pair gap (0.9) is the lever, and the fallback is *singles on elites and pairs on rares only*, which costs the jump its place in the elite fights and leaves it in the ten rares.
3. **The share of their walking that players sprint.** 25 is "an hour after Hale" only if a quarter of the walking is sprinted. If almost nobody holds Shift outside a fight the unlock is a thing most players never see; **the lever is the threshold** (20 is 7 minutes) and the answer is a telemetry count, not a tuning decision.
4. **Chest density.** The four long roads (3,380 u) carry 18 of the 50, one per half a minute of walking; whether that reads as treasure everywhere or as too few is a playtest's call. The count is data, not code; the 12-in-50 hoards are the part that costs the most to place.
5. **What `light` buys outdoors since HOM-149 brightened the world.** A lantern is *meant* to be a cosmetic with a modest cave perk; if light does nothing out of doors it is a trophy, which is acceptable for the three and thin for the Surveyor's.
6. **The rooftop reset's feel**: a player who climbs one to escape a chase and watches every enemy turn and walk home may read it as a bug. The 2 s grace is the lever.
7. **Held-jump luck** (43 % to 69 % of sweeps, 12 to 21 % off a fight's damage, 2.3): the weakest joint of the sweep. A reader of the tell saves about twice what a masher does, and I left the lag off; it is the first thing the bench's held-jump bot has to measure.
8. **The rim reach for the player** is a rule I am confident of but have not seen: on a step wider than about 1.0 u the asymmetry in 6 is the player's loss, and I have established it only by reading the code.
9. **The roll's cost in position (about 0.6 s of swings) and a walk-out's (1.4 s)** are arithmetic on the enemy's speed and the leash, not a measurement; the bench's `--dodge` counters will give the real figure.

**Existing numbers this changes**, so nothing is surprised: `JUMP_VELOCITY`'s and `JUMP_LIFT`'s comments (5.4); `data.ts`'s `CastKind`; `castName`; nothing in `ENEMY_TYPES` moves except the 23 rows gaining a `sweep`; no `damage`, `hp` or `attackInterval` changes. `XP_PARITY` is untouched and chests do not read it.

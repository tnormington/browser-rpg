// All combat numbers live here so tuning is one file.
import { REGIONS, TOWNS } from './world';

export const TICK_RATE = 30;          // fixed simulation steps per second
export const TICK_DT = 1 / TICK_RATE;
export const GCD = 1.5;               // seconds, shared by every ability
export const QUEUE_WINDOW = 0.4;      // a press this close to GCD end is queued, not rejected
export const CRIT_CHANCE = 0.1;
export const CRIT_MULT = 1.5;
export const ENERGY_MAX = 100;
export const ENERGY_REGEN = 8;        // per second
export const RESPAWN_DELAY = 4;       // seconds dead before waking at the nearest graveyard
export const MAX_DURABILITY = 100;    // points a piece of gear starts with (a piece with no entry in `durability` is at this)
export const DEATH_WEAR = 25;         // points every worn piece loses when you die: four deaths break a set. Ordinary combat wears nothing
export const REPAIR_FRAC = 0.25;      // mending a piece from broken to whole costs this share of its value (a steel set and Warden's Edge: ~205 gold, ~51 a death); a vendor does it
export const OOC_DELAY = 5;           // seconds without combat before health regen
export const OOC_REGEN_FRAC = 0.03;   // of max hp per second
export const TAB_RANGE = 30;
export const ACQUIRE_RANGE = 20;      // "attack with no target" / forgiving click: nearest hostile in front within this
export const ACQUIRE_BEHIND_RANGE = 6; // ...and failing that, anything this close even behind you (the wolf biting your back)
export const FRONT_HALF_ARC = 70;     // degrees either side of facing that count as "in front" (a generous 140-degree cone)
/**
 * Jump: expression, not traversal. WoW's hop, which is quick in both directions and quicker coming down than going up --
 * you are off the ground on the frame you press, over the top before you can think about it, and planted again in about
 * half a second, so it never reads as hanging. Gravity is asymmetric for exactly that: the rise is a push, the fall is a
 * drop. ~1.2u high over ~0.53s, in the air at the same speed you ran at (no change to reach).
 */
export const JUMP_VELOCITY = 9;
export const GRAVITY = 30;       // on the way up
export const FALL_GRAVITY = 42;  // on the way down: 1.4x, so the descent is the snappy half
/** How high a takeoff of `v` reaches, and how long it stays up (up at GRAVITY, down at FALL_GRAVITY). Agility raises the takeoff
 * (sim/agility.ts), so both follow it rather than being constants: the jump clip is stretched over the airtime of the hop actually taken. */
export const jumpHeight = (v: number) => v ** 2 / (2 * GRAVITY);
export const jumpAirtime = (v: number) => v / GRAVITY + Math.sqrt((2 * jumpHeight(v)) / FALL_GRAVITY);
export const JUMP_HEIGHT = jumpHeight(JUMP_VELOCITY);
export const JUMP_AIRTIME = jumpAirtime(JUMP_VELOCITY);
export const PLAYER_SPAWN = TOWNS[0].wake;

// Auto-attack: a WoW-style melee swing on its own timer, off the GCD and free of energy. Rhythm, not power:
// the abilities were re-tuned down by what the swings add, and weapon speed changes the beat, not the damage per second.
export const AUTO_RANGE = 3;          // melee reach, same as Strike
export const AUTO_BASE = 4;           // damage at power 1, before weapon and speed
export const AUTO_WEAPON_SHARE = 0.15; // share of the weapon's flat damage a swing carries (abilities carry all of it)
export const BARE_SWING = 2.4;        // seconds between swings with no weapon; weapons override via ItemStats.speed
/** `slot` on an auto-attack's 'hit' event: -1 is damage to the player, -2 is a swing. Never an index into ABILITIES. */
export const AUTO_SLOT = -2;
export const RECAP_WINDOW = 10;       // seconds of incoming damage the death recap remembers
export const RECAP_MAX = 6;

// Player stats per combat level.
export const maxHpForLevel = (level: number) => 100 + 15 * (level - 1);
export const powerForLevel = (level: number) => 1 + 0.07 * (level - 1); // scales damage and healing

export interface AbilityDef {
  name: string;
  desc: string;
  /**
   * `bash` staggers whether or not the target is winding up; `burst` tears the bleed off it and spends what is left at once.
   * `guard` is any self-buff: it takes no target and puts the buff named in `buff` on the player (Guard, Battle Fury).
   * `dash` hits the target and moves the player in the same breath (see `dash`).
   */
  kind: 'strike' | 'dot' | 'heal' | 'cleave' | 'interrupt' | 'guard' | 'bash' | 'burst' | 'dash';
  unlockLevel: number; // combat level that hands the ability over; locked slots do nothing and say why
  damage: number;     // direct damage (strike/dot/cleave) or heal amount (heal), at power 1; 0 for interrupt
  dotDamage?: number; // per tick
  dotTicks?: number;  // one tick per second
  cost: number;       // energy
  cooldown: number;   // seconds, on top of the GCD
  range: number;      // world units, center to center; 0 = self
  /** Nearer than this the ability refuses: a leap has nowhere to go when you are already in their face (Charge). */
  minRange?: number;
  /**
   * `dash`: where the leap puts you. `away` leaps straight back from the target by `gap` units; otherwise it closes to
   * the target and stops `gap` short of it. A leap blocked by rock is shortened, and refused only if even a short one is.
   */
  dash?: { away: boolean; gap: number };
  arc?: number;       // cleave: full width in degrees of the cone, centred on the line to the target
  offGcd?: boolean;   // interrupt, guard, bash: usable mid-GCD, so it can answer a wind-up the instant it starts
  /** guard: the buff it puts on the player (see BUFFS), which is what actually takes the damage down. */
  buff?: string;
  /** Share of the damage dealt that comes back as health (Bloodthirst). */
  leech?: number;
  /** What a talent calls this ability by. `kind` already names the rest; only the strikes need telling apart. */
  tag?: 'crush' | 'strike';
  /** Share of the weapon's damage the ability carries (default 1). Without it a bigger `damage` is just Strike, the weapon being most of a hit by level 12. */
  weaponMult?: number;
  /** Not handed over by level alone: bought from this vendor (see VENDORS) for gold, once the level is reached. */
  trainer?: { vendor: string; price: number };
  /** ...or paid for with a talent point: the capstone of a tree (see TALENTS) hands this over, and nothing else does. */
  talent?: string;
}

export const ABILITIES: AbilityDef[] = [
  { name: 'Strike', desc: 'Cheap, reliable melee hit. Your GCD filler.',
    kind: 'strike', unlockLevel: 1, damage: 8, cost: 10, cooldown: 0, range: 3, tag: 'strike' },
  { name: 'Crushing Blow', desc: 'Heavy melee hit. Save energy for it.',
    kind: 'strike', unlockLevel: 3, damage: 20, cost: 30, cooldown: 6, range: 3, tag: 'crush' },
  { name: 'Serrated Throw', desc: 'Ranged opener that makes the target bleed.',
    kind: 'dot', unlockLevel: 2, damage: 3, dotDamage: 4, dotTicks: 6, cost: 20, cooldown: 9, range: 9 },
  { name: 'Second Wind', desc: 'Heal yourself. Long cooldown: pick your moment.',
    kind: 'heal', unlockLevel: 4, damage: 45, cost: 25, cooldown: 20, range: 0 },
  { name: 'Cleave', desc: 'Sweep a wide arc: hits every enemy in front of you, not just your target.',
    kind: 'cleave', unlockLevel: 5, damage: 10, cost: 25, cooldown: 8, range: 3.5, arc: 140 },
  { name: 'Pummel', desc: 'Off the global cooldown. Stops an enemy wind-up dead and staggers it. Useless when nothing is winding up.',
    kind: 'interrupt', unlockLevel: 4, damage: 0, cost: 10, cooldown: 10, range: 3.5, offGcd: true },
  { name: 'Whirlwind', desc: 'Spin and hit everything around you, whichever way it stands. Learned from the Saltmarrow trainer.',
    kind: 'cleave', unlockLevel: 12, damage: 8, weaponMult: 0.6, cost: 35, cooldown: 10, range: 4, arc: 360, trainer: { vendor: 'trainer', price: 120 } },
  { name: 'Guard', desc: 'Off the global cooldown. Halves all damage you take for 4 seconds. Learned from the Thornwick trainer.',
    kind: 'guard', unlockLevel: 20, damage: 0, cost: 20, cooldown: 30, range: 0, offGcd: true, buff: 'guard', trainer: { vendor: 'thorn_trainer', price: 350 } },
  // The three capstones. Each is bought with the last talent point of a tree rather than with gold, so the kit a player
  // ends with says which tree they went down. `unlockLevel` is simply the earliest a tree can hold twelve points.
  { name: 'Bloodthirst', desc: 'A heavy hit that feeds you: a quarter of the damage comes back as health. The Fury capstone.',
    kind: 'strike', unlockLevel: 14, damage: 24, weaponMult: 1.1, leech: 0.25, cost: 35, cooldown: 12, range: 3, talent: 'bloodthirst' },
  { name: 'Shield Bash', desc: 'Off the global cooldown. Staggers whatever you hit, wind-up or no wind-up. The Bulwark capstone.',
    kind: 'bash', unlockLevel: 14, damage: 10, weaponMult: 0.5, cost: 25, cooldown: 25, range: 3.5, offGcd: true, talent: 'ironwill' },
  { name: 'Hemorrhage', desc: 'Tears the bleed off your target from range and deals everything it had left at once. The Hunt capstone.',
    kind: 'burst', unlockLevel: 14, damage: 10, weaponMult: 0.8, cost: 30, cooldown: 15, range: 9, talent: 'hemorrhage' },
  // Highmoor's trainer (bible 4.1, HOM-96)
  { name: 'Colossus Blow', desc: 'The big hit: two and a half times your weapon behind it. Learned from the Highmoor trainer.',
    kind: 'strike', unlockLevel: 25, damage: 60, weaponMult: 2.5, cost: 55, cooldown: 18, range: 3, trainer: { vendor: 'high_trainer', price: 500 } },
  { name: 'Last Stand', desc: 'Heal yourself for three times what Second Wind does. A long cooldown: it is the one you save. Learned from the Highmoor trainer.',
    kind: 'heal', unlockLevel: 30, damage: 140, cost: 40, cooldown: 90, range: 0, trainer: { vendor: 'high_trainer', price: 750 } },
  // The three that gave the fight a shape of its own (HOM-138). The upkeep is free and early, because it is what the
  // rotation is built round; the two leaps are bought, like every ability past combat 5.
  { name: 'Battle Fury', desc: 'Everything you deal hits 15% harder for 20 seconds. No cooldown: keeping it up, and paying for it, is the work.',
    kind: 'guard', unlockLevel: 5, damage: 0, cost: 25, cooldown: 0, range: 0, buff: 'battle_fury' },
  { name: 'Sidestep', desc: 'Off the global cooldown. Cut your target and leap clear of it: out of a slam, off marked ground, still swinging. Learned from the Saltmarrow trainer.',
    kind: 'dash', unlockLevel: 12, damage: 6, weaponMult: 0.5, cost: 15, cooldown: 12, range: 4, offGcd: true,
    dash: { away: true, gap: 8 }, trainer: { vendor: 'trainer', price: 150 } },
  { name: 'Charge', desc: 'Cover the ground to a distant target in one bound and open with a hit. The way back in after a Sidestep. Learned from the Saltmarrow trainer.',
    kind: 'dash', unlockLevel: 14, damage: 12, weaponMult: 0.8, cost: 15, cooldown: 15, range: 25, minRange: 8,
    dash: { away: false, gap: 2 }, trainer: { vendor: 'trainer', price: 200 } },
];

/**
 * The id an ability's art is filed under (assets/art/abilities/<id>.webp), since an ability is known by its
 * position in the array and nothing else. Its name, lowercased, spaces to underscores: the bar, the generator
 * and src/art.test.ts all read it from here, so a renamed ability fails the art check instead of going blank.
 */
export const abilityArtId = (a: AbilityDef) => a.name.toLowerCase().replace(/ /g, '_');

/** How long an interrupted enemy is stunned, and what share of its heavy-attack cooldown it keeps (so it cannot slam again at once). */
export const STAGGER_TIME = 2.2;
export const STAGGER_HEAVY_KEEP = 0.7;

// Aggro, WoW's way round. Two things keep a careless step from waking half a room:
//  - an enemy notices nothing it cannot see (sim/sight.ts), so a pack behind a standing stone sleeps until you round it;
//  - once you outgrow something it stops looking up, so a route that was a gauntlet at level 4 is a walk at level 10.
// The radius only ever shrinks: every one below is hand-placed against the scenery around it (the ore ridge sits
// outside the Cave Brute's, the hollow's groups sit outside each other's), so it is the ceiling, not a starting point.
export const AGGRO_PER_LEVEL = 0.6;  // units of notice radius lost per level the player is above the enemy
export const AGGRO_MIN_FRAC = 0.55;  // ...down to this fraction of the enemy's own radius

export interface EnemyDef {
  name: string;
  level: number;
  hp: number;
  damage: number;
  attackInterval: number;
  speed: number;
  aggroRadius: number;
  leash: number;       // max distance from spawn before it gives up and resets
  attackRange: number;
  radius: number;
  xp: number;
  respawn: number;     // seconds
  /** A telegraphed ground slam: stands still for `windup`, then hits everything within `radius` of itself for flat `damage`. Interruptible; or step out of the radius. */
  heavy?: { name: string; windup: number; every: number; first: number; damage: number; radius: number };
  /**
   * Attacks from a distance: a short interruptible wind-up, then a bolt that lands if the player is still within `range`.
   * It closes to firing range and then holds the ground it is standing on. It never retreats from melee: a shooter you
   * have run down stands and fights (see `net` for the one exception).
   * With a `heavy` as well it is a melee fighter that throws instead: it fights in reach, and throws only at a player standing off.
   * `holds` turns that round: a caster who keeps to his ground and shoots whoever is in range, and whose `heavy` is a nova for whoever has come inside its radius (Archmage Vael).
   */
  ranged?: { name: string; range: number; windup: number; holds?: boolean };
  /**
   * The one way a shooter makes distance. Within `range` of the player it plants its feet for `windup`, then holds them
   * where they stand for `duration` seconds and backs off until it has a `retreat`-unit gap. Interruptible, needs a line
   * of fire like a bolt, and does no damage of its own: the cost is the ground you have to make up again.
   */
  net?: { name: string; windup: number; every: number; first: number; range: number; duration: number; retreat: number };
  /**
   * Marks the ground under the player and, `windup` seconds later, hits everything within `radius` of that spot for flat `damage`.
   * The spot is fixed when the wind-up starts, so a player who keeps moving is long gone and one who stands and trades blows is not.
   * Interruptible. `range` is how far away the enemy will still start one.
   */
  hazard?: { name: string; windup: number; every: number; first: number; damage: number; radius: number; range: number };
  /** Once the first quest has reached this stage the enemy is gone for good: it does not respawn, and a copy that is still standing (an older save) is cleared. */
  retiresAt?: 'report2';
  /** Aggro spreads to every pack-mate within this many units. */
  pack?: number;
  /** Which loaded model slot draws it, and how: no new art, so cave enemies are existing rigs scaled and tinted. Read by the renderer only. */
  look?: { model: string; scale: number; tint: number };
}

/**
 * XP parity (docs/world-design.md 3.1 rule 2): a kill pays its base XP times this, +5 % per level the enemy is above you, to +25 %, and
 * -5 % per level below, to a 10 % floor. It is what stops the Hollow Warden being the best farm in the game for ever: ground you have
 * outgrown pays less. (The bible's prose says -15 % a level below; its formula, which is what is built, says 5 %.)
 */
export const XP_PARITY = { step: 0.05, min: 0.1, max: 1.25 };
export const xpParity = (enemyLevel: number, playerLevel: number) =>
  Math.max(XP_PARITY.min, Math.min(XP_PARITY.max, 1 + XP_PARITY.step * (enemyLevel - playerLevel)));

/** Idle enemies this far from the player are not looked at: nothing can wake them (the widest notice radius is 12), so the tick skips them. */
export const SIM_WAKE_RANGE = 60;

/** How far this enemy notices a player of that combat level from: its own radius, less what the player has outgrown. */
export function aggroRadius(def: EnemyDef, playerLevel: number): number {
  const shrink = AGGRO_PER_LEVEL * Math.max(0, playerLevel - def.level);
  return Math.max(def.aggroRadius * AGGRO_MIN_FRAC, def.aggroRadius - shrink);
}

/** The wind-ups an enemy can be in the middle of. One name for the set, so the sim, the HUD and the renderer agree on it. */
export type CastKind = 'heavy' | 'bolt' | 'ground' | 'net';

/** The name of the wind-up an enemy is casting, for cast bars and the telegraph line. One place, so a new kind cannot crash a HUD that guessed. */
export function castName(def: EnemyDef, kind: CastKind): string {
  return (kind === 'heavy' ? def.heavy?.name : kind === 'ground' ? def.hazard?.name : kind === 'net' ? def.net?.name : def.ranged?.name) ?? def.name;
}

export const ENEMY_TYPES: Record<string, EnemyDef> = {
  boar: { name: 'Wild Boar', level: 1, hp: 100, damage: 4, attackInterval: 2.0, speed: 4.5,
    aggroRadius: 8, leash: 25, attackRange: 1.8, radius: 0.6, xp: 30, respawn: 20 },
  wolf: { name: 'Dire Wolf', level: 3, hp: 180, damage: 8, attackInterval: 1.8, speed: 5.0,
    aggroRadius: 8, leash: 25, attackRange: 1.9, radius: 0.6, xp: 60, respawn: 30 },
  brute: { name: 'Cave Brute', level: 6, hp: 600, damage: 17, attackInterval: 2.2, speed: 4.0,
    aggroRadius: 9, leash: 12, attackRange: 2.6, radius: 1.1, xp: 220, respawn: 60, retiresAt: 'report2', // leash 12 from (-18,-18) ends at the door (z -30): it never follows you down the throat
    heavy: { name: 'Crushing Slam', windup: 1.8, every: 8, first: 3, damage: 60, radius: 4.5 } },
  pup: { name: 'Wolf Pup', level: 2, hp: 60, damage: 4, attackInterval: 1.6, speed: 5.4,
    aggroRadius: 7, leash: 22, attackRange: 1.5, radius: 0.45, xp: 16, respawn: 25, pack: 7 },
  hexer: { name: 'Cave Hexer', level: 4, hp: 140, damage: 9, attackInterval: 2.6, speed: 4.4,
    aggroRadius: 10, leash: 24, attackRange: 11, radius: 0.6, xp: 90, respawn: 40,
    ranged: { name: 'Hex Bolt', range: 11, windup: 0.9 } },

  // The cave. Every one of these is a level above anything outside, and built around one tell the player must read:
  // the Ravagers come in a pack (Cleave), the Archers shoot from range, the Seer punishes standing still, the Ogre slams,
  // and the Warden does the last two at once. They are tuned against the steel set (see sim/cave balance checks in verify): the set's metal
  // changed with HOM-81 and its armour did not, 12 / 22 / 16 either way, so every number below stands where it was.
  // The hollow holds seven of them in one room. The radii below are what each group needs to guard its own ground; what
  // keeps them from arriving together is aggroRadius(), which pares the radius back as the player outgrows them: the
  // nearest Ravager sits 7.8 units from the doorway, and at the recommended combat 9 their 7-unit radius leaves it asleep.
  ravager: { name: 'Cave Ravager', level: 7, hp: 320, damage: 11, attackInterval: 1.6, speed: 5.6,
    aggroRadius: 9, leash: 20, attackRange: 1.9, radius: 0.65, xp: 60, respawn: 75, pack: 8,
    look: { model: 'wolf', scale: 1.15, tint: 0x4a5a7a } },
  // leash 6: it stays within 6 of its post, so the sentry at (-13,-47) cannot be drawn across the hollow into the Ogre and the Seer
  archer: { name: 'Gloom Archer', level: 8, hp: 320, damage: 28, attackInterval: 2.4, speed: 5.2,
    aggroRadius: 11, leash: 6, attackRange: 14, radius: 0.6, xp: 100, respawn: 90,
    ranged: { name: 'Gloom Arrow', range: 14, windup: 0.8 },
    look: { model: 'hexer', scale: 1.0, tint: 0x3a4a6a } },
  seer: { name: 'Cave Seer', level: 9, hp: 650, damage: 12, attackInterval: 3.0, speed: 4.2,
    aggroRadius: 11, leash: 14, attackRange: 12, radius: 0.65, xp: 140, respawn: 90,
    ranged: { name: 'Hex Bolt', range: 12, windup: 0.9 },
    hazard: { name: 'Withering Ground', windup: 1.2, every: 4, first: 1.5, damage: 85, radius: 3, range: 14 },
    look: { model: 'hexer', scale: 1.25, tint: 0x6a3a8a } },
  ogre: { name: 'Hollow Ogre', level: 9, hp: 1250, damage: 42, attackInterval: 2.4, speed: 3.8,
    aggroRadius: 9, leash: 18, attackRange: 2.8, radius: 1.2, xp: 240, respawn: 120,
    heavy: { name: 'Boulder Slam', windup: 1.6, every: 7, first: 3, damage: 140, radius: 5 },
    look: { model: 'brute', scale: 1.15, tint: 0x3a4658 } },
  warden: { name: 'Hollow Warden', level: 11, hp: 1600, damage: 40, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 12, leash: 22, attackRange: 3.2, radius: 1.6, xp: 900, respawn: 180,
    heavy: { name: 'Seismic Crush', windup: 1.8, every: 8, first: 4, damage: 135, radius: 6.5 },
    hazard: { name: 'Falling Rock', windup: 1.6, every: 6, first: 5, damage: 80, radius: 3.2, range: 14 },
    look: { model: 'brute', scale: 1.5, tint: 0x5a6a9a } },

  // The Greywater Road (levels 10 to 13) and the Strand (14 to 17), from docs/world-design.md section 3.4: HP, hit, swing, heavy and XP are the
  // bible's columns as written (hit and heavy are raw: armour takes them down). Rigs are the five that exist, scaled and tinted as the cave's are.
  // Respawns follow its rule: trash 30 to 45 s, an elite 120 s, a rare 30 minutes.
  marsh_hog: { name: 'Marsh Hog', level: 10, hp: 415, damage: 35, attackInterval: 2.0, speed: 5.2,
    aggroRadius: 8, leash: 25, attackRange: 2.2, radius: 0.78, xp: 30, respawn: 35,
    look: { model: 'boar', scale: 1.3, tint: 0x5a6a48 } },
  road_wolf: { name: 'Greywater Wolf', level: 11, hp: 470, damage: 33, attackInterval: 1.8, speed: 5.0,
    aggroRadius: 9, leash: 25, attackRange: 1.9, radius: 0.6, xp: 31, respawn: 35, pack: 7,
    look: { model: 'wolf', scale: 1.0, tint: 0x6a6e78 } },
  footpad: { name: 'Footpad', level: 12, hp: 530, damage: 46, attackInterval: 2.4, speed: 4.4,
    aggroRadius: 10, leash: 24, attackRange: 11, radius: 0.6, xp: 32, respawn: 40,
    ranged: { name: 'Knife Throw', range: 11, windup: 0.8 },
    net: { name: 'Bola', windup: 1.1, every: 14, first: 7, range: 6, duration: 2.5, retreat: 7 },
    look: { model: 'hexer', scale: 1.0, tint: 0x6a5a40 } },
  toll_captain: { name: 'Toll Captain', level: 13, hp: 1785, damage: 54, attackInterval: 2.2, speed: 4.0,
    aggroRadius: 10, leash: 22, attackRange: 2.8, radius: 1.25, xp: 99, respawn: 120,
    heavy: { name: 'Cudgel Slam', windup: 1.7, every: 9, first: 3, damage: 195, radius: 5 },
    look: { model: 'brute', scale: 1.15, tint: 0x6a4a30 } },
  old_grey: { name: 'Old Grey', level: 12, hp: 2120, damage: 40, attackInterval: 1.6, speed: 5.4,
    aggroRadius: 10, leash: 25, attackRange: 2.2, radius: 0.85, xp: 192, respawn: 1800,
    heavy: { name: 'Rending Lunge', windup: 1.6, every: 8, first: 3, damage: 180, radius: 4 },
    look: { model: 'wolf', scale: 1.4, tint: 0xe0e0e8 } },
  shore_crab: { name: 'Shore Crab', level: 14, hp: 665, damage: 34, attackInterval: 1.6, speed: 5.0,
    aggroRadius: 8, leash: 22, attackRange: 1.7, radius: 0.5, xp: 34, respawn: 35,
    look: { model: 'boar', scale: 0.8, tint: 0xb8603a } },
  drowned_sailor: { name: 'Drowned Sailor', level: 15, hp: 745, damage: 59, attackInterval: 2.6, speed: 4.4,
    aggroRadius: 10, leash: 24, attackRange: 12, radius: 0.6, xp: 35, respawn: 40,
    ranged: { name: 'Harpoon', range: 12, windup: 0.9 },
    net: { name: 'Tangling Net', windup: 1.2, every: 12, first: 6, range: 7, duration: 3, retreat: 8 },
    look: { model: 'hexer', scale: 1.0, tint: 0x3a6a6a } },
  tide_hag: { name: 'Tide Hag', level: 16, hp: 840, damage: 71, attackInterval: 3.0, speed: 4.2,
    aggroRadius: 11, leash: 14, attackRange: 12, radius: 0.7, xp: 36, respawn: 45,
    ranged: { name: 'Brine Bolt', range: 12, windup: 0.9 },
    hazard: { name: 'Undertow', windup: 1.3, every: 5, first: 2, damage: 120, radius: 3, range: 14 },
    look: { model: 'hexer', scale: 1.15, tint: 0x3a7a5a } },
  barnacle_ogre: { name: 'Barnacle Ogre', level: 17, hp: 2790, damage: 71, attackInterval: 2.4, speed: 3.9,
    aggroRadius: 10, leash: 20, attackRange: 2.9, radius: 1.3, xp: 111, respawn: 120,
    heavy: { name: 'Anchor Slam', windup: 1.7, every: 9, first: 3, damage: 250, radius: 5.5 },
    look: { model: 'brute', scale: 1.15, tint: 0x4a6a6a } },
  gutterhook: { name: 'Gutterhook', level: 16, hp: 3365, damage: 55, attackInterval: 1.8, speed: 5.0,
    aggroRadius: 10, leash: 22, attackRange: 2.6, radius: 0.95, xp: 216, respawn: 1800,
    heavy: { name: 'Gutter Claw', windup: 1.6, every: 8, first: 3, damage: 235, radius: 4.5 },
    look: { model: 'boar', scale: 1.6, tint: 0x5a4a6a } },

  // Dunmere Fens (levels 18 to 21) and the Thornwood (21 to 24): the bible's restated rows (HOM-62), by its columns. Hit and heavy are raw, armour takes them down. A
  // pair's or camp's numbers are the member's, so no discount is applied again (the stalkers are the pair rows: 805 HP, hit 32). The troll's "slam every 10 s"
  // is a heavier swing in its hit, not a telegraphed heavy. Respawns: trash 30 to 45 s, elite 120, rare 30 minutes.
  fen_stalker: { name: 'Fen Stalker', level: 18, hp: 805, damage: 32, attackInterval: 1.8, speed: 5.4,
    aggroRadius: 9, leash: 25, attackRange: 1.9, radius: 0.6, xp: 38, respawn: 35, pack: 7,
    look: { model: 'wolf', scale: 1.0, tint: 0x6a7a70 } },
  bog_witch: { name: 'Bog Witch', level: 19, hp: 1045, damage: 71, attackInterval: 2.8, speed: 4.2,
    aggroRadius: 11, leash: 14, attackRange: 12, radius: 0.7, xp: 39, respawn: 45,
    ranged: { name: 'Bog Bolt', range: 12, windup: 0.9 },
    hazard: { name: 'Withering Ground', windup: 1.3, every: 5, first: 2, damage: 160, radius: 3, range: 14 },
    look: { model: 'hexer', scale: 1.1, tint: 0x4a6a58 } },
  mire_troll: { name: 'Mire Troll', level: 20, hp: 1145, damage: 67, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 9, leash: 22, attackRange: 2.6, radius: 1.1, xp: 40, respawn: 40,
    look: { model: 'brute', scale: 1.0, tint: 0x4e6a48 } },
  bogfather: { name: 'The Bogfather', level: 21, hp: 3770, damage: 81, attackInterval: 2.4, speed: 3.9,
    aggroRadius: 10, leash: 20, attackRange: 3.0, radius: 1.35, xp: 123, respawn: 120,
    heavy: { name: 'Mire Slam', windup: 1.7, every: 9, first: 3, damage: 270, radius: 5.5 },
    hazard: { name: 'Choking Mire', windup: 1.3, every: 8, first: 5, damage: 115, radius: 3.2, range: 14 },
    look: { model: 'brute', scale: 1.3, tint: 0x3e5a52 } },
  mother_mire: { name: 'Mother Mire', level: 20, hp: 4585, damage: 74, attackInterval: 2.4, speed: 3.9,
    aggroRadius: 10, leash: 22, attackRange: 3.4, radius: 1.7, xp: 240, respawn: 1800,
    heavy: { name: 'Sinking Crush', windup: 1.7, every: 9, first: 3, damage: 250, radius: 6 },
    hazard: { name: 'Rising Bog', windup: 1.3, every: 6, first: 4, damage: 110, radius: 3.2, range: 14 },
    look: { model: 'brute', scale: 1.7, tint: 0x56604a } },
  thornback: { name: 'Thornback Boar', level: 21, hp: 1255, damage: 51, attackInterval: 1.9, speed: 5.2,
    aggroRadius: 8, leash: 25, attackRange: 2.3, radius: 0.85, xp: 41, respawn: 35,
    look: { model: 'boar', scale: 1.4, tint: 0x4a4a38 } },
  blight_stag: { name: 'Blight Stag', level: 22, hp: 1370, damage: 54, attackInterval: 1.8, speed: 5.4,
    aggroRadius: 9, leash: 25, attackRange: 2.1, radius: 0.78, xp: 42, respawn: 35,
    look: { model: 'wolf', scale: 1.3, tint: 0x6a5a48 } },
  rotwood_cultist: { name: 'Rotwood Cultist', level: 23, hp: 1495, damage: 78, attackInterval: 2.6, speed: 4.4,
    aggroRadius: 10, leash: 24, attackRange: 12, radius: 0.6, xp: 43, respawn: 40,
    ranged: { name: 'Rot Hex', range: 12, windup: 0.9 },
    look: { model: 'hexer', scale: 1.0, tint: 0x5a3a30 } },
  thorn_warden: { name: 'Thorn Warden', level: 24, hp: 4865, damage: 91, attackInterval: 2.4, speed: 3.9,
    aggroRadius: 10, leash: 20, attackRange: 3.0, radius: 1.35, xp: 132, respawn: 120,
    heavy: { name: 'Thorn Crush', windup: 1.7, every: 9, first: 3, damage: 310, radius: 5.5 },
    hazard: { name: 'Briar Burst', windup: 1.3, every: 8, first: 5, damage: 135, radius: 3.2, range: 14 },
    look: { model: 'brute', scale: 1.3, tint: 0x3e4a32 } },
  elder_thornback: { name: 'Elder Thornback', level: 23, hp: 5975, damage: 80, attackInterval: 2.0, speed: 5.0,
    aggroRadius: 10, leash: 22, attackRange: 3.2, radius: 1.5, xp: 258, respawn: 1800,
    heavy: { name: 'Rending Gore', windup: 1.6, every: 8, first: 3, damage: 295, radius: 5 },
    look: { model: 'boar', scale: 2.0, tint: 0x5a4a3a } },
  // The Barrowdowns (levels 25 to 29) and Highmoor's Moor (28 to 31): section 3.4's rows as written (HOM-95); HOM-94 may retune the numbers, and that is a constants change. Hit and
  // heavy are raw. The hounds are the camp-of-three member's numbers (alone: 1900 HP, hit 53), the brute's and the ogre's "slam every 9 s" is a heavier swing in the hit, as the
  // Mire Troll's is. The Hollow Knight's "two slams back to back" has no telegraph pattern in the sim yet: it is one heavy, every 8 s, for the row's 385.
  barrow_wight: { name: 'Barrow Wight', level: 25, hp: 1760, damage: 81, attackInterval: 2.6, speed: 4.4,
    aggroRadius: 10, leash: 24, attackRange: 12, radius: 0.6, xp: 45, respawn: 40,
    ranged: { name: 'Grave Bolt', range: 12, windup: 0.9 },
    look: { model: 'hexer', scale: 1.05, tint: 0x7a8a82 } },
  grave_hound: { name: 'Grave Hound', level: 26, hp: 1425, damage: 32, attackInterval: 1.7, speed: 5.4,
    aggroRadius: 9, leash: 25, attackRange: 1.9, radius: 0.65, xp: 46, respawn: 35, pack: 7,
    look: { model: 'wolf', scale: 1.1, tint: 0x8a8a78 } },
  cairn_brute: { name: 'Cairn Brute', level: 27, hp: 2050, damage: 87, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 9, leash: 22, attackRange: 2.7, radius: 1.15, xp: 47, respawn: 40,
    look: { model: 'brute', scale: 1.05, tint: 0x6a6a62 } },
  barrow_lord: { name: 'Barrow Lord', level: 29, hp: 7115, damage: 116, attackInterval: 2.4, speed: 3.9,
    aggroRadius: 10, leash: 20, attackRange: 3.1, radius: 1.5, xp: 147, respawn: 120,
    heavy: { name: 'Barrow Crush', windup: 1.7, every: 9, first: 3, damage: 400, radius: 5.5 },
    hazard: { name: 'Grave Chill', windup: 1.3, every: 8, first: 5, damage: 175, radius: 3.2, range: 14 },
    look: { model: 'brute', scale: 1.4, tint: 0x4a5a5a } },
  hollow_knight: { name: 'The Hollow Knight', level: 28, hp: 8830, damage: 92, attackInterval: 2.2, speed: 4.2,
    aggroRadius: 10, leash: 22, attackRange: 3.2, radius: 1.6, xp: 288, respawn: 1800,
    heavy: { name: 'Hollow Cleave', windup: 1.6, every: 8, first: 3, damage: 385, radius: 5 },
    look: { model: 'brute', scale: 1.5, tint: 0xc4c8c0 } },
  moor_ram: { name: 'Moor Ram', level: 28, hp: 2205, damage: 62, attackInterval: 1.9, speed: 5.4,
    aggroRadius: 8, leash: 25, attackRange: 2.4, radius: 0.9, xp: 48, respawn: 35,
    look: { model: 'boar', scale: 1.5, tint: 0x8a7a62 } },
  moor_raider: { name: 'Moor Raider', level: 29, hp: 2370, damage: 85, attackInterval: 2.4, speed: 4.6,
    aggroRadius: 10, leash: 24, attackRange: 12, radius: 0.6, xp: 49, respawn: 40,
    ranged: { name: 'Raider Bolt', range: 12, windup: 0.9 },
    look: { model: 'hexer', scale: 1.0, tint: 0x6a5a48 } },
  ridge_ogre: { name: 'Ridge Ogre', level: 30, hp: 2545, damage: 100, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 9, leash: 22, attackRange: 2.9, radius: 1.3, xp: 50, respawn: 40,
    look: { model: 'brute', scale: 1.2, tint: 0x7a6a52 } },
  stonehorn: { name: 'Stonehorn', level: 31, hp: 8170, damage: 106, attackInterval: 2.2, speed: 4.6,
    aggroRadius: 10, leash: 22, attackRange: 3.4, radius: 1.8, xp: 153, respawn: 120,
    heavy: { name: 'Stone Gore', windup: 1.7, every: 9, first: 3, damage: 440, radius: 5.5 },
    hazard: { name: 'Shattered Ground', windup: 1.3, every: 8, first: 5, damage: 195, radius: 3.2, range: 14 },
    look: { model: 'boar', scale: 2.2, tint: 0x8a8272 } },
  // The Drowned Grotto (levels 16 to 19, section 3.4): its sentry, ogres and hag are the Strand's own rows, and the boss is the bible's: HP, hit, swing, heavy / ground and XP as
  // written. Captain Marrow does all three of the cave's tells: the Anchor Slam under his feet (Pummel it, or step out), the Cannon Volley marked on the ground under you
  // (keep moving), and the Harpoon thrown at anyone who stands off from him (the one tell he shares with no other melee: see updateEnemies). A boss is on a 10 minute respawn.
  captain_marrow: { name: 'Captain Marrow', level: 19, hp: 8350, damage: 35, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 12, leash: 24, attackRange: 3.4, radius: 1.7, xp: 390, respawn: 600,
    heavy: { name: 'Anchor Slam', windup: 1.8, every: 10, first: 4, damage: 235, radius: 6.5 },
    hazard: { name: 'Cannon Volley', windup: 1.5, every: 7, first: 6, damage: 105, radius: 3.5, range: 16 },
    ranged: { name: 'Harpoon', range: 14, windup: 0.9 },
    look: { model: 'brute', scale: 1.5, tint: 0x3a5a6a } },
  // The Rotroot (levels 23 to 26, section 3.4): the cult's sentries and a Thorn Warden are the Thornwood's own rows, the Mother is the bible's. She is Marrow's pattern at a bigger
  // size: the Root Slam under her feet, the Spore Cloud marked on the ground under you, and the Hex Bolt at anyone who stands off.
  rotroot_mother: { name: 'The Rotroot Mother', level: 26, hp: 15205, damage: 46, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 12, leash: 24, attackRange: 3.6, radius: 1.9, xp: 460, respawn: 600,
    heavy: { name: 'Root Slam', windup: 1.8, every: 10, first: 4, damage: 350, radius: 6.5 },
    hazard: { name: 'Spore Cloud', windup: 1.5, every: 7, first: 6, damage: 150, radius: 3.5, range: 16 },
    ranged: { name: 'Hex Bolt', range: 14, windup: 0.9 },
    look: { model: 'brute', scale: 1.6, tint: 0x4a6a3a } },
  // The Cairn Hold (levels 30 to 32, section 3.4): its trash is the Moor's Ridge Ogre, the King is the bible's row, HP, hit, swing, heavy / ground and XP as written. The same three tells as the other
  // bosses at a larger size: the Crown Slam under his feet (Pummel it, or step out), the Falling Stone marked on the ground under you (keep moving), the Grave Bolt at anyone who stands off.
  cairn_king: { name: 'The Cairn King', level: 32, hp: 23290, damage: 58, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 12, leash: 24, attackRange: 3.8, radius: 2.1, xp: 520, respawn: 600,
    heavy: { name: 'Crown Slam', windup: 1.8, every: 10, first: 4, damage: 460, radius: 6.5 },
    hazard: { name: 'Falling Stone', windup: 1.5, every: 7, first: 6, damage: 200, radius: 3.5, range: 16 },
    ranged: { name: 'Grave Bolt', range: 14, windup: 0.9 },
    look: { model: 'brute', scale: 1.8, tint: 0x8a8a78 } },
  // The Cairnwaste (levels 32 to 36) and the Spire's ruins (36 to 40): section 3.4's rows as written (HOM-111). Hit and heavy are raw, the hounds are the camp-of-three member's numbers (alone: 3310 HP, hit 66;
  // 3975 and 71), and the ogre's and the golem's "slam" is a heavier swing in the hit, as the Cairn Brute's is. The Colossus and the Warden are elites: a slam and a ground mark, as the Stonehorn's two.
  waste_reaver: { name: 'Waste Reaver', level: 32, hp: 2910, damage: 97, attackInterval: 2.4, speed: 4.6,
    aggroRadius: 10, leash: 24, attackRange: 12, radius: 0.6, xp: 52, respawn: 40,
    ranged: { name: 'Reaver Bolt', range: 12, windup: 0.9 },
    look: { model: 'hexer', scale: 1.05, tint: 0x8a7458 } },
  dune_hound: { name: 'Dune Hound', level: 34, hp: 2480, damage: 40, attackInterval: 1.7, speed: 5.6,
    aggroRadius: 9, leash: 25, attackRange: 1.9, radius: 0.65, xp: 54, respawn: 35, pack: 7,
    look: { model: 'wolf', scale: 1.15, tint: 0xa89468 } },
  sand_ogre: { name: 'Sand Ogre', level: 35, hp: 3525, damage: 119, attackInterval: 2.4, speed: 4.0,
    aggroRadius: 9, leash: 22, attackRange: 2.9, radius: 1.3, xp: 55, respawn: 40,
    look: { model: 'brute', scale: 1.25, tint: 0x9a8460 } },
  ashen_colossus: { name: 'Ashen Colossus', level: 36, hp: 11240, damage: 136, attackInterval: 2.4, speed: 3.8,
    aggroRadius: 10, leash: 20, attackRange: 3.5, radius: 1.8, xp: 168, respawn: 120,
    heavy: { name: 'Ashen Fall', windup: 1.7, every: 9, first: 3, damage: 540, radius: 5.8 },
    hazard: { name: 'Cinder Rain', windup: 1.3, every: 8, first: 5, damage: 235, radius: 3.2, range: 14 },
    look: { model: 'brute', scale: 1.5, tint: 0x4a4642 } },
  spire_adept: { name: 'Spire Adept', level: 36, hp: 3745, damage: 112, attackInterval: 2.6, speed: 4.4,
    aggroRadius: 10, leash: 24, attackRange: 12, radius: 0.6, xp: 56, respawn: 40,
    ranged: { name: 'Arc Bolt', range: 12, windup: 0.9 },
    look: { model: 'hexer', scale: 1.05, tint: 0x5a4a86 } },
  void_hound: { name: 'Void Hound', level: 37, hp: 2980, damage: 43, attackInterval: 1.7, speed: 5.8,
    aggroRadius: 9, leash: 25, attackRange: 1.9, radius: 0.65, xp: 57, respawn: 35, pack: 7,
    look: { model: 'wolf', scale: 1.15, tint: 0x3a3a5a } },
  rune_golem: { name: 'Rune Golem', level: 38, hp: 4215, damage: 120, attackInterval: 2.4, speed: 3.6,
    aggroRadius: 9, leash: 22, attackRange: 2.9, radius: 1.3, xp: 58, respawn: 40,
    look: { model: 'brute', scale: 1.0, tint: 0x5a6478 } },
  spire_warden: { name: 'Spire Warden', level: 39, hp: 13395, damage: 140, attackInterval: 2.4, speed: 3.9,
    aggroRadius: 10, leash: 20, attackRange: 3.5, radius: 1.8, xp: 177, respawn: 120,
    heavy: { name: "Warden's Verdict", windup: 1.7, every: 9, first: 3, damage: 605, radius: 5.8 },
    hazard: { name: 'Sundering Rune', windup: 1.3, every: 8, first: 5, damage: 265, radius: 3.2, range: 14 },
    look: { model: 'brute', scale: 1.5, tint: 0x6a5a8a } },
  // The Sundered Vault (levels 38 to 41, section 3.4, HOM-112): its trash is the ruins' own (Rune Golem, Spire Adept), the Archmage is the bible's row, HP, hit, swing, heavy / ground and XP as written. He is the
  // first boss who fights from across the room: the Arc Barrage at anyone inside eighteen paces (he closes to sixteen and holds there, and never gives ground), the Rune Storm marked under you (keep moving),
  // the Sundering Nova for whoever has come in to melee him (Pummel it, or step out), and the sanctum's warded floor (world.ts) is his second ground. The row's numbers are the bible's and are NOT checked by the
  // designer's bot (a melee probe): see the Vael section of docs/world-design.md for what the bench makes of them.
  archmage_vael: { name: 'Archmage Vael', level: 41, hp: 39915, damage: 81, attackInterval: 2.8, speed: 4.2,
    aggroRadius: 14, leash: 28, attackRange: 6, radius: 1.3, xp: 610, respawn: 600,
    heavy: { name: 'Sundering Nova', windup: 1.8, every: 10, first: 5, damage: 650, radius: 6 },
    hazard: { name: 'Rune Storm', windup: 1.5, every: 7, first: 6, damage: 285, radius: 3.5, range: 20 },
    ranged: { name: 'Arc Barrage', range: 18, windup: 1.0, holds: true },
    look: { model: 'hexer', scale: 1.6, tint: 0x6a5aa8 } },
};

/** The stats of this enemy: the one place an instance's type becomes a row, so a spawn that differs from its species has one seam to change. */
export const defOf = (enemy: { type: string }): EnemyDef => ENEMY_TYPES[enemy.type];

/**
 * Where enemies stand. Hale's own come first and keep their ids (a save matches by id and type); every other region's follow in region
 * order, from the region's own `spawns` (world.ts), so new ground only ever adds ids at the end.
 */
export const SPAWNS: { type: string; x: number; z: number }[] = [
  { type: 'boar', x: -15, z: -3 }, { type: 'boar', x: 16, z: 3 }, { type: 'boar', x: 12, z: -10 },
  { type: 'wolf', x: -8, z: -14 }, { type: 'wolf', x: 14, z: -15 }, { type: 'wolf', x: -22, z: 12 },
  { type: 'brute', x: -18, z: -18 },
  // pack of pups (one wakes, all wake): the reason to Cleave
  { type: 'pup', x: -5, z: 15 }, { type: 'pup', x: -3.5, z: 16.2 }, { type: 'pup', x: -6.2, z: 16.6 },
  { type: 'hexer', x: 19, z: 19 },
  // inside the Hollow (see DUNGEONS): the pack that holds the room, the ranged pair, the seer, the ogres, and the Warden at the end
  // the pack is posted on the seam along the south-west wall (x -29.2), not out in the middle of the hollow: from the doorway at
  // (-18,-46) the nearest of them is 9.4 units off, outside its own notice radius, so walking in is the Archer alone
  { type: 'ravager', x: -27, z: -50 }, { type: 'ravager', x: -25.8, z: -51.2 }, { type: 'ravager', x: -27.6, z: -51.8 },
  { type: 'archer', x: -13, z: -47 }, { type: 'archer', x: -23, z: -63 },
  { type: 'seer', x: -14, z: -61 },
  { type: 'ogre', x: -8, z: -58 }, { type: 'ogre', x: -26, z: -62.5 },
  { type: 'warden', x: -18, z: -82 },
  ...REGIONS.flatMap(r => r.spawns ?? []),
];

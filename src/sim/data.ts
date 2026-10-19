// All combat numbers live here so tuning is one file.

export const TICK_RATE = 30;          // fixed simulation steps per second
export const TICK_DT = 1 / TICK_RATE;
export const GCD = 1.5;               // seconds, shared by every ability
export const QUEUE_WINDOW = 0.4;      // a press this close to GCD end is queued, not rejected
export const CRIT_CHANCE = 0.1;
export const CRIT_MULT = 1.5;
export const ENERGY_MAX = 100;
export const ENERGY_REGEN = 8;        // per second
export const RESPAWN_DELAY = 4;       // seconds dead before waking at the clearing
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
export const JUMP_HEIGHT = JUMP_VELOCITY ** 2 / (2 * GRAVITY);
/** Seconds a jump stays in the air, up at GRAVITY and down at FALL_GRAVITY. The jump clip is stretched over this. */
export const JUMP_AIRTIME = JUMP_VELOCITY / GRAVITY + Math.sqrt((2 * JUMP_HEIGHT) / FALL_GRAVITY);
export const PLAYER_SPAWN = { x: 0, z: 6 };

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
  kind: 'strike' | 'dot' | 'heal' | 'cleave' | 'interrupt';
  unlockLevel: number; // combat level that hands the ability over; locked slots do nothing and say why
  damage: number;     // direct damage (strike/dot/cleave) or heal amount (heal), at power 1; 0 for interrupt
  dotDamage?: number; // per tick
  dotTicks?: number;  // one tick per second
  cost: number;       // energy
  cooldown: number;   // seconds, on top of the GCD
  range: number;      // world units, center to center; 0 = self
  arc?: number;       // cleave: full width in degrees of the cone, centred on the line to the target
  offGcd?: boolean;   // interrupt: usable mid-GCD, so it can answer a wind-up the instant it starts
  /** What a talent calls this ability by. `kind` already names the other five; only the two strikes need telling apart. */
  tag?: 'crush';
}

export const ABILITIES: AbilityDef[] = [
  { name: 'Strike', desc: 'Cheap, reliable melee hit. Your GCD filler.',
    kind: 'strike', unlockLevel: 1, damage: 8, cost: 10, cooldown: 0, range: 3 },
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
];

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
  /** Attacks from a distance and backs away from melee: a short interruptible wind-up, then a bolt that lands if the player is still within `range`. */
  ranged?: { name: string; range: number; keepAway: number; windup: number };
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

/** How far this enemy notices a player of that combat level from: its own radius, less what the player has outgrown. */
export function aggroRadius(def: EnemyDef, playerLevel: number): number {
  const shrink = AGGRO_PER_LEVEL * Math.max(0, playerLevel - def.level);
  return Math.max(def.aggroRadius * AGGRO_MIN_FRAC, def.aggroRadius - shrink);
}

/** The name of the wind-up an enemy is casting, for cast bars and the telegraph line. One place, so a new kind cannot crash a HUD that guessed. */
export function castName(def: EnemyDef, kind: 'heavy' | 'bolt' | 'ground'): string {
  return (kind === 'heavy' ? def.heavy?.name : kind === 'ground' ? def.hazard?.name : def.ranged?.name) ?? def.name;
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
    ranged: { name: 'Hex Bolt', range: 11, keepAway: 5, windup: 0.9 } },

  // The cave. Every one of these is a level above anything outside, and built around one tell the player must read:
  // the Ravagers come in a pack (Cleave), the Archers shoot from range, the Seer punishes standing still, the Ogre slams,
  // and the Warden does the last two at once. They are tuned against the mithril set (see sim/cave balance checks in verify).
  // The hollow holds seven of them in one room. The radii below are what each group needs to guard its own ground; what
  // keeps them from arriving together is aggroRadius(), which pares the radius back as the player outgrows them: the
  // nearest Ravager sits 7.8 units from the doorway, and at the recommended combat 9 their 7-unit radius leaves it asleep.
  ravager: { name: 'Cave Ravager', level: 7, hp: 320, damage: 11, attackInterval: 1.6, speed: 5.6,
    aggroRadius: 9, leash: 20, attackRange: 1.9, radius: 0.65, xp: 60, respawn: 75, pack: 8,
    look: { model: 'wolf', scale: 1.15, tint: 0x4a5a7a } },
  // leash 6: it backs off 4.8 from its post at most (leash * 0.8), so the sentry at (-13,-47) cannot be chased across the hollow into the Ogre and the Seer
  archer: { name: 'Gloom Archer', level: 8, hp: 320, damage: 28, attackInterval: 2.4, speed: 5.2,
    aggroRadius: 11, leash: 6, attackRange: 14, radius: 0.6, xp: 100, respawn: 90,
    ranged: { name: 'Gloom Arrow', range: 14, keepAway: 7, windup: 0.8 },
    look: { model: 'hexer', scale: 1.0, tint: 0x3a4a6a } },
  seer: { name: 'Cave Seer', level: 9, hp: 650, damage: 12, attackInterval: 3.0, speed: 4.2,
    aggroRadius: 11, leash: 14, attackRange: 12, radius: 0.65, xp: 140, respawn: 90,
    ranged: { name: 'Hex Bolt', range: 12, keepAway: 5, windup: 0.9 },
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
};

export const SPAWNS: { type: string; x: number; z: number }[] = [
  { type: 'boar', x: -15, z: -3 }, { type: 'boar', x: 16, z: 3 }, { type: 'boar', x: 12, z: -10 },
  { type: 'wolf', x: -8, z: -14 }, { type: 'wolf', x: 14, z: -15 }, { type: 'wolf', x: -22, z: 12 },
  { type: 'brute', x: -18, z: -18 },
  // pack of pups (one wakes, all wake): the reason to Cleave
  { type: 'pup', x: -5, z: 15 }, { type: 'pup', x: -3.5, z: 16.2 }, { type: 'pup', x: -6.2, z: 16.6 },
  { type: 'hexer', x: 19, z: 19 },
  // inside the cave (see CAVE_ROOMS): the vein guards, the ranged pair, the seer, the ogres, and the Warden at the end
  // the pack is posted on the mithril seam it guards (x -29.2), not out in the middle of the hollow: from the doorway at
  // (-18,-46) the nearest of them is 9.4 units off, outside its own notice radius, so walking in is the Archer alone
  { type: 'ravager', x: -27, z: -50 }, { type: 'ravager', x: -25.8, z: -51.2 }, { type: 'ravager', x: -27.6, z: -51.8 },
  { type: 'archer', x: -13, z: -47 }, { type: 'archer', x: -23, z: -63 },
  { type: 'seer', x: -14, z: -61 },
  { type: 'ogre', x: -8, z: -58 }, { type: 'ogre', x: -26, z: -62.5 },
  { type: 'warden', x: -18, z: -82 },
];

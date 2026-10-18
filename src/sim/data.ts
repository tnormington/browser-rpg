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
// Jump: expression, not traversal. ~1.4u high for ~0.73s, in the air at the same speed you ran at (no change to reach).
export const JUMP_VELOCITY = 8;
export const GRAVITY = 22;
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
}

export const ABILITIES: AbilityDef[] = [
  { name: 'Strike', desc: 'Cheap, reliable melee hit. Your GCD filler.',
    kind: 'strike', unlockLevel: 1, damage: 8, cost: 10, cooldown: 0, range: 3 },
  { name: 'Crushing Blow', desc: 'Heavy melee hit. Save energy for it.',
    kind: 'strike', unlockLevel: 3, damage: 20, cost: 30, cooldown: 6, range: 3 },
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
  /** Aggro spreads to every pack-mate within this many units. */
  pack?: number;
}

export const ENEMY_TYPES: Record<string, EnemyDef> = {
  boar: { name: 'Wild Boar', level: 1, hp: 100, damage: 4, attackInterval: 2.0, speed: 4.5,
    aggroRadius: 8, leash: 25, attackRange: 1.8, radius: 0.6, xp: 30, respawn: 20 },
  wolf: { name: 'Dire Wolf', level: 3, hp: 180, damage: 8, attackInterval: 1.8, speed: 5.0,
    aggroRadius: 8, leash: 25, attackRange: 1.9, radius: 0.6, xp: 60, respawn: 30 },
  brute: { name: 'Cave Brute', level: 6, hp: 600, damage: 17, attackInterval: 2.2, speed: 4.0,
    aggroRadius: 9, leash: 25, attackRange: 2.6, radius: 1.1, xp: 220, respawn: 60,
    heavy: { name: 'Crushing Slam', windup: 1.8, every: 8, first: 3, damage: 60, radius: 4.5 } },
  pup: { name: 'Wolf Pup', level: 2, hp: 60, damage: 4, attackInterval: 1.6, speed: 5.4,
    aggroRadius: 7, leash: 22, attackRange: 1.5, radius: 0.45, xp: 16, respawn: 25, pack: 7 },
  hexer: { name: 'Cave Hexer', level: 4, hp: 140, damage: 9, attackInterval: 2.6, speed: 4.4,
    aggroRadius: 10, leash: 24, attackRange: 11, radius: 0.6, xp: 90, respawn: 40,
    ranged: { name: 'Hex Bolt', range: 11, keepAway: 5, windup: 0.9 } },
};

export const SPAWNS: { type: string; x: number; z: number }[] = [
  { type: 'boar', x: -15, z: -3 }, { type: 'boar', x: 16, z: 3 }, { type: 'boar', x: 12, z: -10 },
  { type: 'wolf', x: -8, z: -14 }, { type: 'wolf', x: 14, z: -15 }, { type: 'wolf', x: -22, z: 12 },
  { type: 'brute', x: -18, z: -18 },
  // pack of pups (one wakes, all wake): the reason to Cleave
  { type: 'pup', x: -5, z: 15 }, { type: 'pup', x: -3.5, z: 16.2 }, { type: 'pup', x: -6.2, z: 16.6 },
  { type: 'hexer', x: 19, z: 19 },
];

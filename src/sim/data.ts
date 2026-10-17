// All combat numbers live here so tuning is one file.

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
export const PLAYER_SPAWN = { x: 0, z: 6 };

// Player stats per combat level.
export const maxHpForLevel = (level: number) => 100 + 15 * (level - 1);
export const powerForLevel = (level: number) => 1 + 0.07 * (level - 1); // scales damage and healing

export interface AbilityDef {
  name: string;
  desc: string;
  kind: 'strike' | 'dot' | 'heal';
  damage: number;     // direct damage (kind strike/dot) or heal amount (kind heal), at power 1
  dotDamage?: number; // per tick
  dotTicks?: number;  // one tick per second
  cost: number;       // energy
  cooldown: number;   // seconds, on top of the GCD
  range: number;      // world units, center to center; 0 = self
}

export const ABILITIES: AbilityDef[] = [
  { name: 'Strike', desc: 'Cheap, reliable melee hit. Your GCD filler.',
    kind: 'strike', damage: 8, cost: 10, cooldown: 0, range: 3 },
  { name: 'Crushing Blow', desc: 'Heavy melee hit. Save energy for it.',
    kind: 'strike', damage: 26, cost: 30, cooldown: 6, range: 3 },
  { name: 'Serrated Throw', desc: 'Ranged opener that makes the target bleed.',
    kind: 'dot', damage: 4, dotDamage: 4, dotTicks: 6, cost: 20, cooldown: 9, range: 9 },
  { name: 'Second Wind', desc: 'Heal yourself. Long cooldown: pick your moment.',
    kind: 'heal', damage: 45, cost: 25, cooldown: 20, range: 0 },
];

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
}

export const ENEMY_TYPES: Record<string, EnemyDef> = {
  boar: { name: 'Wild Boar', level: 1, hp: 130, damage: 5, attackInterval: 2.0, speed: 4.5,
    aggroRadius: 8, leash: 25, attackRange: 1.8, radius: 0.6, xp: 25, respawn: 20 },
  wolf: { name: 'Dire Wolf', level: 3, hp: 180, damage: 8, attackInterval: 1.8, speed: 5.0,
    aggroRadius: 8, leash: 25, attackRange: 1.9, radius: 0.6, xp: 55, respawn: 30 },
  brute: { name: 'Cave Brute', level: 6, hp: 450, damage: 17, attackInterval: 2.2, speed: 4.0,
    aggroRadius: 9, leash: 25, attackRange: 2.6, radius: 1.1, xp: 220, respawn: 60 },
};

export const SPAWNS: { type: string; x: number; z: number }[] = [
  { type: 'boar', x: -15, z: -3 }, { type: 'boar', x: 16, z: 3 }, { type: 'boar', x: 12, z: -10 },
  { type: 'wolf', x: -8, z: -14 }, { type: 'wolf', x: 14, z: -15 }, { type: 'wolf', x: -22, z: 12 },
  { type: 'brute', x: -18, z: -18 },
];

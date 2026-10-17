// Authoritative simulation. No Three.js / DOM imports: this module must be able to run server-side.
// Rules live in src/sim/*; this file owns state shape and the fixed-step driver.

import { XpTrack, newTrack } from './sim/xp';
import { PLAYER_RADIUS, clampToWorld, resolveCollisions } from './sim/world';
import { ABILITIES, ENEMY_TYPES, SPAWNS, PLAYER_SPAWN } from './sim/data';
import {
  clearTarget, pressAbility, refreshPlayerStats, setTarget, tabTarget,
  updateEnemies, updatePlayerCombat, updatePlayerDeath,
} from './sim/combat';

export * from './sim/world';

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
const MOVE_SPEED = 6;
const ARRIVE_DIST = 0.15;

export type EnemyState = 'idle' | 'chase' | 'return' | 'dead';

export interface Enemy {
  id: number;
  type: string;
  x: number; z: number; facing: number;
  spawnX: number; spawnZ: number;
  hp: number; maxHp: number;
  state: EnemyState;
  attackCd: number;
  respawnIn: number;
  deadFor: number;
  hitFlash: number; // presentation timers kept in sim so they tick deterministically
  swing: number;
  bleed: { ticks: number; timer: number; damage: number } | null;
}

export interface Player {
  x: number; z: number; facing: number; moving: boolean;
  hp: number; maxHp: number;
  energy: number; maxEnergy: number;
  gcd: number;
  cd: number[];            // per-ability cooldown remaining
  queued: number | null;   // ability pressed just before the GCD ended
  cast: number;            // short attack-animation timer
  dead: boolean;
  respawnIn: number;
  outOfCombat: number;
  combat: XpTrack;
  weaponBonus: number;     // flat damage added to direct hits; the smithing milestone sets this
}

export type GameEvent =
  | { t: 'hit'; target: 'player' | number; x: number; z: number; amount: number; crit: boolean; slot: number; dot: boolean }
  | { t: 'heal'; x: number; z: number; amount: number }
  | { t: 'fail'; reason: 'range' | 'cooldown' | 'gcd' | 'energy' | 'target'; slot: number }
  | { t: 'cast'; slot: number }
  | { t: 'kill'; id: number; x: number; z: number }
  | { t: 'xp'; amount: number; x: number; z: number }
  | { t: 'levelup'; level: number }
  | { t: 'death' }
  | { t: 'respawn' };

export interface GameState {
  tick: number;
  rng: number;
  player: Player;
  moveTarget: { x: number; z: number } | null;
  targetId: number | null;
  enemies: Enemy[];
  events: GameEvent[]; // cleared at the start of every step; presentation reads them after each step
}

/** One tick of player intent. dirX/dirZ is a world-space direction (length <= 1). */
export interface Input {
  dirX: number;
  dirZ: number;
  clickTarget: { x: number; z: number } | null; // set only on the tick a click happens
  clickEnemy: number | null;                    // enemy id clicked this tick
  tab: boolean;
  clearTarget: boolean;
  ability: number | null;                       // ability slot pressed this tick
}

export const NO_INPUT: Input = { dirX: 0, dirZ: 0, clickTarget: null, clickEnemy: null, tab: false, clearTarget: false, ability: null };

export function createState(seed = 1): GameState {
  const s: GameState = {
    tick: 0,
    rng: seed,
    player: {
      x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, facing: Math.PI, moving: false,
      hp: 0, maxHp: 0, energy: 0, maxEnergy: 0,
      gcd: 0, cd: ABILITIES.map(() => 0), queued: null, cast: 0,
      dead: false, respawnIn: 0, outOfCombat: 99,
      combat: newTrack(), weaponBonus: 0,
    },
    moveTarget: null,
    targetId: null,
    enemies: SPAWNS.map((sp, i): Enemy => ({
      id: i + 1, type: sp.type, x: sp.x, z: sp.z, facing: 0, spawnX: sp.x, spawnZ: sp.z,
      hp: ENEMY_TYPES[sp.type].hp, maxHp: ENEMY_TYPES[sp.type].hp, state: 'idle',
      attackCd: 0, respawnIn: 0, deadFor: 0, hitFlash: 0, swing: 0, bleed: null,
    })),
    events: [],
  };
  refreshPlayerStats(s, true);
  s.player.energy = s.player.maxEnergy;
  return s;
}

export function step(s: GameState, input: Input, dt: number = TICK_DT): void {
  s.tick++;
  s.events.length = 0;
  const p = s.player;

  if (p.dead) {
    updatePlayerDeath(s, dt);
  } else {
    if (input.clearTarget) clearTarget(s);
    if (input.clickEnemy !== null) setTarget(s, input.clickEnemy);
    else if (input.clickTarget) s.moveTarget = clampToWorld(input.clickTarget);
    if (input.tab) tabTarget(s);
    movePlayer(s, input, dt);
    updatePlayerCombat(s, dt);
    if (input.ability !== null) pressAbility(s, input.ability);
  }
  updateEnemies(s, dt);
}

function movePlayer(s: GameState, input: Input, dt: number) {
  const p = s.player;
  let dx = input.dirX, dz = input.dirZ;
  if (dx !== 0 || dz !== 0) {
    s.moveTarget = null; // keyboard cancels click-to-move
  } else if (s.moveTarget) {
    const tx = s.moveTarget.x - p.x, tz = s.moveTarget.z - p.z;
    const d = Math.hypot(tx, tz);
    if (d < ARRIVE_DIST) {
      s.moveTarget = null;
    } else {
      // don't overshoot the target within a single tick
      const k = Math.min(1, d / (MOVE_SPEED * dt)) / d;
      dx = tx * k; dz = tz * k;
    }
  }

  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  const px = p.x, pz = p.z;
  p.x += dx * MOVE_SPEED * dt;
  p.z += dz * MOVE_SPEED * dt;
  resolveCollisions(p, PLAYER_RADIUS);

  const moved = Math.hypot(p.x - px, p.z - pz);
  p.moving = moved > 1e-4;
  if (len > 1e-4) p.facing = Math.atan2(dx, dz);
  // click-to-move blocked by an obstacle: give up instead of pushing forever
  if (s.moveTarget && len > 1e-4 && moved < len * MOVE_SPEED * dt * 0.1) s.moveTarget = null;
}

// Authoritative simulation. No Three.js / DOM imports: this module must be able to run server-side.

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const WORLD_HALF = 30; // zone is a square of side 2*WORLD_HALF
export const PLAYER_RADIUS = 0.5;
const MOVE_SPEED = 6;
const ARRIVE_DIST = 0.15;

export interface Obstacle { x: number; z: number; r: number }

// Hand-placed zone layout (shared by sim for collision and renderer for drawing).
export const LANDMARKS = {
  clearing: { x: 0, z: 0, r: 9 },
  forge: { x: 20, z: -8 },
  caveMouth: { x: -18, z: -24 },
};

export const OBSTACLES: Obstacle[] = [
  // forge building
  { x: 20, z: -8, r: 2.6 },
  // cave mouth: rock walls either side of a walkable gap facing +z
  { x: -21, z: -26, r: 2.2 },
  { x: -15, z: -26, r: 2.2 },
  { x: -18, z: -28, r: 3 },
];

// Trees: radius-1 obstacles.
export const TREES: Obstacle[] = [
  { x: -12, z: 10, r: 1 }, { x: -20, z: 4, r: 1 }, { x: -8, z: 20, r: 1 },
  { x: 10, z: 18, r: 1 }, { x: 22, z: 12, r: 1 }, { x: 14, z: -20, r: 1 },
  { x: 4, z: -18, r: 1 }, { x: -24, z: -8, r: 1 }, { x: 26, z: 24, r: 1 },
  { x: -26, z: 22, r: 1 }, { x: 8, z: 26, r: 1 }, { x: 28, z: -20, r: 1 },
];

const COLLIDERS = [...OBSTACLES, ...TREES];

export interface GameState {
  tick: number;
  player: { x: number; z: number; facing: number; moving: boolean };
  moveTarget: { x: number; z: number } | null;
}

/** One tick of player intent. dirX/dirZ is a world-space direction (length <= 1). */
export interface Input {
  dirX: number;
  dirZ: number;
  clickTarget: { x: number; z: number } | null; // set only on the tick a click happens
}

export function createState(): GameState {
  return { tick: 0, player: { x: 0, z: 6, facing: Math.PI, moving: false }, moveTarget: null };
}

export function step(s: GameState, input: Input, dt: number = TICK_DT): void {
  s.tick++;
  const p = s.player;

  if (input.clickTarget) s.moveTarget = clampToWorld(input.clickTarget);

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
  resolveCollisions(p);

  const moved = Math.hypot(p.x - px, p.z - pz);
  p.moving = moved > 1e-4;
  if (len > 1e-4) p.facing = Math.atan2(dx, dz);
  // click-to-move blocked by an obstacle: give up instead of pushing forever
  if (s.moveTarget && len > 1e-4 && moved < len * MOVE_SPEED * dt * 0.1) s.moveTarget = null;
}

function clampToWorld(t: { x: number; z: number }) {
  const m = WORLD_HALF - PLAYER_RADIUS;
  return { x: Math.max(-m, Math.min(m, t.x)), z: Math.max(-m, Math.min(m, t.z)) };
}

function resolveCollisions(p: { x: number; z: number }) {
  const m = WORLD_HALF - PLAYER_RADIUS;
  p.x = Math.max(-m, Math.min(m, p.x));
  p.z = Math.max(-m, Math.min(m, p.z));
  for (const o of COLLIDERS) {
    const ox = p.x - o.x, oz = p.z - o.z;
    const d = Math.hypot(ox, oz), min = o.r + PLAYER_RADIUS;
    if (d < min) {
      const nx = d > 1e-6 ? ox / d : 1, nz = d > 1e-6 ? oz / d : 0;
      p.x = o.x + nx * min;
      p.z = o.z + nz * min;
    }
  }
}

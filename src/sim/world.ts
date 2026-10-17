// Static zone layout and collision. Shared by sim (collision) and renderer (drawing).

export const WORLD_HALF = 30; // zone is a square of side 2*WORLD_HALF
export const PLAYER_RADIUS = 0.5;

export interface Obstacle { x: number; z: number; r: number }

// Hand-placed zone layout.
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

export function clampToWorld(t: { x: number; z: number }, radius = PLAYER_RADIUS) {
  const m = WORLD_HALF - radius;
  return { x: Math.max(-m, Math.min(m, t.x)), z: Math.max(-m, Math.min(m, t.z)) };
}

/** Push a circle of the given radius out of the world edge and all obstacles (mutates p). */
export function resolveCollisions(p: { x: number; z: number }, radius = PLAYER_RADIUS) {
  const c = clampToWorld(p, radius);
  p.x = c.x; p.z = c.z;
  for (const o of COLLIDERS) {
    const ox = p.x - o.x, oz = p.z - o.z;
    const d = Math.hypot(ox, oz), min = o.r + radius;
    if (d < min) {
      const nx = d > 1e-6 ? ox / d : 1, nz = d > 1e-6 ? oz / d : 0;
      p.x = o.x + nx * min;
      p.z = o.z + nz * min;
    }
  }
}

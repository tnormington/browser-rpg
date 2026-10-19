// Outdoor click-to-move routing: grid A* round the colliders, string-pulled to a few waypoints. Pure: no Three.js, no DOM.
// The cave keeps its own junction steering (steerPoint in world.ts); this only handles open ground, where a straight line used
// to wedge the player against the ridge rocks.
import { COLLIDERS, PLAYER_RADIUS, WORLD_HALF } from './world';

export interface Pt { x: number; z: number }

const CELL = 0.25;
const MARGIN = 0.02; // extra clearance beyond the player's radius: the gaps between the ridge rocks are only just wide enough to walk

const clearance = (r: number) => r + PLAYER_RADIUS + MARGIN;

/** True when walking the straight segment a->b stays clear of every collider. */
export function segmentClear(a: Pt, b: Pt): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
  for (const o of COLLIDERS) {
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / len2)) : 0;
    const c = clearance(o.r) - MARGIN;
    if (Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) < c) return false;
  }
  return true;
}

/**
 * Waypoints from `from` to `to`, the last being `to` itself (same object), or null when no way round exists. A clear straight
 * line is just [to]. A goal that sits inside a rock (a node) is approached to the nearest free cell first.
 */
export function routeOutdoors(from: Pt, to: Pt): Pt[] | null {
  if (segmentClear(from, to)) return [to];
  const m = WORLD_HALF - PLAYER_RADIUS, n = Math.ceil((2 * m) / CELL) + 1;
  const toCell = (v: number) => Math.max(0, Math.min(n - 1, Math.round((v + m) / CELL)));
  const cellPt = (i: number): Pt => ({ x: -m + (i % n) * CELL, z: -m + Math.floor(i / n) * CELL });
  const free = new Uint8Array(n * n);
  for (let i = 0; i < free.length; i++) {
    const c = cellPt(i);
    free[i] = COLLIDERS.every(o => Math.hypot(c.x - o.x, c.z - o.z) >= clearance(o.r)) ? 1 : 0;
  }
  const nearestFree = (p: Pt): number => {
    const ci = toCell(p.x), cj = toCell(p.z);
    for (let rad = 0; rad < n; rad++) {
      let best = -1, bestD = Infinity;
      for (let j = Math.max(0, cj - rad); j <= Math.min(n - 1, cj + rad); j++) {
        for (let i = Math.max(0, ci - rad); i <= Math.min(n - 1, ci + rad); i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== rad || !free[j * n + i]) continue;
          const c = cellPt(j * n + i), d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
          if (d < bestD) { best = j * n + i; bestD = d; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const start = nearestFree(from), goal = nearestFree(to);
  if (start < 0 || goal < 0) return null;

  const g = new Float64Array(n * n).fill(Infinity), prev = new Int32Array(n * n).fill(-1), done = new Uint8Array(n * n);
  const gp = cellPt(goal);
  const h = (i: number) => { const c = cellPt(i); return Math.hypot(c.x - gp.x, c.z - gp.z); };
  const open: [number, number][] = [[h(start), start]]; // small enough for a linear-scan pop: a route is computed once per click
  g[start] = 0;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, cur] = open.splice(bi, 1)[0];
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) break;
    const cx = cur % n, cz = Math.floor(cur / n);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx, z = cz + dz;
        if (x < 0 || z < 0 || x >= n || z >= n) continue;
        const ni = z * n + x;
        if (!free[ni] || done[ni]) continue;
        if (dx && dz && (!free[cz * n + x] || !free[z * n + cx])) continue; // no cutting a corner between two rocks
        const ng = g[cur] + (dx && dz ? Math.SQRT2 : 1);
        if (ng < g[ni]) { g[ni] = ng; prev[ni] = cur; open.push([ng + h(ni), ni]); }
      }
    }
  }
  if (!done[goal]) return null;

  const cells: Pt[] = [];
  for (let c = goal; c >= 0; c = prev[c]) cells.push(cellPt(c));
  cells.reverse();
  cells.push(to);
  // string-pull: from each anchor, jump to the furthest cell it can see
  const out: Pt[] = [];
  let anchor: Pt = from, i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !segmentClear(anchor, cells[j])) j--;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  out[out.length - 1] = to;
  return out;
}

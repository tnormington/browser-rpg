// Click-to-move routing over the whole world: grid A* across every region's floor and round every collider, string-pulled to a few
// waypoints. One layer for the clearing, the ridge and the cave alike: no hand-placed waypoints. Pure: no Three.js, no DOM.
//
// Cost model. The static part of a route (which cells are floor, which are blocked by scenery, which cells connect to which) is
// built once and cached, keyed on a signature of the footprints and colliders, so it is rebuilt only when the world changes
// (the dev stress knob, a test dropping a collider in) and never per click. A click then costs: the straight-line test; if that
// fails, a reachability check (one array read), the nearest-free-cell lookups, and an A* with a binary heap whose scratch arrays
// are reused. Unreachable goals are rejected before any search by the connected-component labels, so they cost nothing.
import { COLLIDERS, FOOTPRINT, PLAYER_RADIUS, Pt, Rect } from './world';
export type { Pt };

const CELL = 0.25;
const MARGIN = 0.02; // extra clearance beyond the player's radius: the gaps between the ridge rocks are only just wide enough to walk
const EPS = 1e-9;
const SEARCH_CELLS = 64; // how far (in cells) to look for a free cell near a start or goal that sits inside scenery

const clearance = (r: number) => r + PLAYER_RADIUS + MARGIN;

/** Where a circle's centre can be on each footprint rect (a room narrower than the circle collapses to its centreline, as in clampToWorld). */
const walkable = (): Rect[] => FOOTPRINT.map(r => {
  const lx = (r.x0 + r.x1) / 2, lz = (r.z0 + r.z1) / 2;
  return { x0: Math.min(lx, r.x0 + PLAYER_RADIUS), x1: Math.max(lx, r.x1 - PLAYER_RADIUS), z0: Math.min(lz, r.z0 + PLAYER_RADIUS), z1: Math.max(lz, r.z1 - PLAYER_RADIUS) };
});

/** True when the segment a->b lies entirely on the union of the rects: each rect clips the segment to an interval, and the intervals must cover it. */
function onFloor(a: Pt, b: Pt, rects: Rect[]): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, spans: [number, number][] = [];
  for (const r of rects) {
    let t0 = 0, t1 = 1;
    for (const [p, d, lo, hi] of [[a.x, dx, r.x0, r.x1], [a.z, dz, r.z0, r.z1]] as const) {
      if (Math.abs(d) < 1e-12) { if (p < lo - EPS || p > hi + EPS) { t1 = -1; break; } continue; }
      let u = (lo - EPS - p) / d, v = (hi + EPS - p) / d;
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    }
    if (t0 <= t1) spans.push([t0, t1]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let reach = 0;
  for (const [t0, t1] of spans) {
    if (t0 > reach + 1e-9) return false;
    reach = Math.max(reach, t1);
  }
  return reach >= 1 - 1e-9;
}

function clearOf(a: Pt, b: Pt, rects: Rect[]): boolean {
  if (!onFloor(a, b, rects)) return false;
  const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
  for (const o of COLLIDERS) {
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / len2)) : 0;
    const c = clearance(o.r) - MARGIN;
    if (Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) < c) return false;
  }
  return true;
}

/** True when walking the straight segment a->b stays on the floor and clear of every collider. */
export const segmentClear = (a: Pt, b: Pt): boolean => clearOf(a, b, walkable());

interface Nav {
  sig: number;
  rects: Rect[];
  grid: Grid | null; // built on the first route that needs a search
}
interface Grid {
  ox: number; oz: number; nx: number; nz: number;
  free: Uint8Array;
  comp: Int32Array; // connected-component label of each free cell (0 for blocked)
  g: Float64Array; prev: Int32Array; seen: Uint32Array; done: Uint32Array; stamp: number; // A* scratch, reused between routes
}

/** A number that changes whenever a footprint or collider is added, removed or moved. O(colliders): nothing next to a grid rebuild. */
function signature(): number {
  let h = FOOTPRINT.length * 31 + COLLIDERS.length;
  for (const r of FOOTPRINT) h = h * 1.0000007 + r.x0 * 1.3 + r.x1 * 2.7 + r.z0 * 3.1 + r.z1 * 4.3;
  for (const o of COLLIDERS) h = h * 1.0000007 + o.x * 5.3 + o.z * 7.1 + o.r * 11.9;
  return h;
}

let cached: Nav | null = null;
function nav(): Nav {
  const sig = signature();
  if (!cached || cached.sig !== sig) cached = { sig, rects: walkable(), grid: null };
  return cached;
}

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
/** Can a step from cell (cx,cz) by (dx,dz) be taken? A diagonal may not cut the corner between two blocked cells. */
function canStep(gr: Grid, cx: number, cz: number, dx: number, dz: number): boolean {
  const x = cx + dx, z = cz + dz;
  if (x < 0 || z < 0 || x >= gr.nx || z >= gr.nz || !gr.free[z * gr.nx + x]) return false;
  return !(dx && dz && (!gr.free[cz * gr.nx + x] || !gr.free[z * gr.nx + cx]));
}

function buildGrid(rects: Rect[]): Grid {
  const x0 = Math.min(...rects.map(r => r.x0)), x1 = Math.max(...rects.map(r => r.x1));
  const z0 = Math.min(...rects.map(r => r.z0)), z1 = Math.max(...rects.map(r => r.z1));
  const nx = Math.floor((x1 - x0) / CELL + EPS) + 1, nz = Math.floor((z1 - z0) / CELL + EPS) + 1, cells = nx * nz;
  const gr: Grid = {
    ox: x0, oz: z0, nx, nz, free: new Uint8Array(cells), comp: new Int32Array(cells),
    g: new Float64Array(cells), prev: new Int32Array(cells), seen: new Uint32Array(cells), done: new Uint32Array(cells), stamp: 0,
  };
  // floor: every cell centre on some footprint rect
  for (const r of rects) {
    const i0 = Math.max(0, Math.ceil((r.x0 - x0) / CELL - EPS)), i1 = Math.min(nx - 1, Math.floor((r.x1 - x0) / CELL + EPS));
    const j0 = Math.max(0, Math.ceil((r.z0 - z0) / CELL - EPS)), j1 = Math.min(nz - 1, Math.floor((r.z1 - z0) / CELL + EPS));
    for (let j = j0; j <= j1; j++) gr.free.fill(1, j * nx + i0, j * nx + i1 + 1);
  }
  // scenery: rasterise each collider's disc, only the cells near it
  for (const o of COLLIDERS) {
    const c = clearance(o.r);
    const i0 = Math.max(0, Math.floor((o.x - c - x0) / CELL)), i1 = Math.min(nx - 1, Math.ceil((o.x + c - x0) / CELL));
    const j0 = Math.max(0, Math.floor((o.z - c - z0) / CELL)), j1 = Math.min(nz - 1, Math.ceil((o.z + c - z0) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) if (Math.hypot(x0 + i * CELL - o.x, z0 + j * CELL - o.z) < c) gr.free[j * nx + i] = 0;
    }
  }
  // connectivity: flood-fill with the same moves A* may make, so "same component" means "a route exists"
  const queue = new Int32Array(cells);
  let label = 0;
  for (let s = 0; s < cells; s++) {
    if (!gr.free[s] || gr.comp[s]) continue;
    label++;
    let head = 0, tail = 0;
    queue[tail++] = s; gr.comp[s] = label;
    while (head < tail) {
      const cur = queue[head++], cx = cur % nx, cz = (cur - cx) / nx;
      for (const [dx, dz] of NEIGHBOURS) {
        if (!canStep(gr, cx, cz, dx, dz)) continue;
        const ni = (cz + dz) * nx + cx + dx;
        if (!gr.comp[ni]) { gr.comp[ni] = label; queue[tail++] = ni; }
      }
    }
  }
  return gr;
}

/** The free cell nearest to p, searching outwards in rings, or -1 when there is none within SEARCH_CELLS. */
function nearestFree(gr: Grid, p: Pt): number {
  const ci = Math.max(0, Math.min(gr.nx - 1, Math.round((p.x - gr.ox) / CELL))), cj = Math.max(0, Math.min(gr.nz - 1, Math.round((p.z - gr.oz) / CELL)));
  for (let rad = 0; rad < SEARCH_CELLS; rad++) {
    let best = -1, bestD = Infinity;
    for (let j = Math.max(0, cj - rad); j <= Math.min(gr.nz - 1, cj + rad); j++) {
      const edgeRow = Math.abs(j - cj) === rad;
      for (let i = Math.max(0, ci - rad); i <= Math.min(gr.nx - 1, ci + rad); i++) {
        if (!edgeRow && Math.abs(i - ci) !== rad) continue; // only the ring itself
        if (!gr.free[j * gr.nx + i]) continue;
        const d = (gr.ox + i * CELL - p.x) ** 2 + (gr.oz + j * CELL - p.z) ** 2;
        if (d < bestD) { best = j * gr.nx + i; bestD = d; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** A* over the cached grid, 8-connected, octile heuristic, binary heap. Returns the cell indices start..goal, or null. */
function search(gr: Grid, start: number, goal: number): number[] | null {
  const { nx, g, prev, seen, done } = gr, stamp = ++gr.stamp;
  const gx = goal % nx, gz = (goal - gx) / nx;
  const h = (i: number) => { const x = i % nx, dx = Math.abs(x - gx), dz = Math.abs((i - x) / nx - gz); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
  const hk: number[] = [], hv: number[] = []; // heap of (f, cell); stale entries are skipped when popped
  const push = (f: number, v: number) => {
    let i = hk.length; hk.push(f); hv.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= f) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = f; hv[i] = v;
  };
  const pop = (): number => {
    const top = hv[0], f = hk.pop()!, v = hv.pop()!, n = hk.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= f) break;
        hk[i] = hk[c]; hv[i] = hv[c]; i = c;
      }
      hk[i] = f; hv[i] = v;
    }
    return top;
  };
  seen[start] = stamp; g[start] = 0; prev[start] = -1;
  push(h(start), start);
  while (hk.length) {
    const cur = pop();
    if (done[cur] === stamp) continue;
    done[cur] = stamp;
    if (cur === goal) {
      const cells: number[] = [];
      for (let c = goal; c >= 0; c = prev[c]) cells.push(c);
      return cells.reverse();
    }
    const cx = cur % nx, cz = (cur - cx) / nx;
    for (const [dx, dz] of NEIGHBOURS) {
      if (!canStep(gr, cx, cz, dx, dz)) continue;
      const ni = (cz + dz) * nx + cx + dx, ng = g[cur] + (dx && dz ? Math.SQRT2 : 1);
      if (seen[ni] !== stamp || ng < g[ni]) { seen[ni] = stamp; g[ni] = ng; prev[ni] = cur; push(ng + h(ni), ni); }
    }
  }
  return null;
}

/**
 * Waypoints from `from` to `to`, the last being `to` itself (same object), or null when no way round exists. A clear straight
 * line is just [to]. A goal that sits inside a rock (a node) is approached to the nearest free cell first.
 */
export function route(from: Pt, to: Pt): Pt[] | null {
  const n = nav();
  if (clearOf(from, to, n.rects)) return [to];
  const gr = n.grid ??= buildGrid(n.rects);
  const start = nearestFree(gr, from), goal = nearestFree(gr, to);
  if (start < 0 || goal < 0 || gr.comp[start] !== gr.comp[goal]) return null;
  const path = search(gr, start, goal);
  if (!path) return null;

  const cells: Pt[] = path.map(i => ({ x: gr.ox + (i % gr.nx) * CELL, z: gr.oz + Math.floor(i / gr.nx) * CELL }));
  cells.push(to);
  // string-pull: from each anchor, jump to the furthest cell it can see
  const out: Pt[] = [];
  let anchor: Pt = from, i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !clearOf(anchor, cells[j], n.rects)) j--;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  out[out.length - 1] = to;
  return out;
}

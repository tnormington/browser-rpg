// Routing over the whole world: grid A* across a region's floor and round its colliders, string-pulled to a few
// waypoints. One layer for the clearing, the ridge, the cave, the road and the town alike: no hand-placed waypoints.
// Pure: no Three.js, no DOM.
//
// Since HOM-139 took click-to-move out, nothing in the game walks a route: the player walks on the keys and nothing else
// moves them. What this is still for is the walkability guarantee the tests hold the world to - that every town, gate,
// node and spawn can actually be reached on foot - and the steering the test bots use to get about.
//
// The world is continuous, so a route may cross from one region into the next (Hale's gate, the road, Saltmarrow) with no transition.
// What keeps that affordable is that there is no global grid:
//  - Regions are grouped into routing ZONES (Region.zone). A zone has one grid, built the first time a route needs to search it and
//    evicted, least recently used first, once the grids together hold more than GRID_BUDGET cells. Hale and its cave are one zone at a
//    fine cell (the ridge's rock gaps need it); each stretch of open country is a zone of its own at a coarse one.
//  - A route is a chain of legs, one per zone it passes through, joined at the seam points the regions' `connections` name: a search
//    only ever covers the zone it is in, however long the whole walk.
//  - A clear straight line is checked first, over the colliders near the line (the spatial index in world.ts), and is just [to]:
//    walking down the road is one waypoint however far it goes.
// The static part of a zone (which cells are floor, which are blocked, which connect to which) is cached keyed on a signature of that
// zone's footprints and colliders, so it is rebuilt only when the zone changes (the dev stress knob, a test dropping a collider in).
import { COLLIDERS, FOOTPRINT, PLAYER_RADIUS, REGIONS, WILD_CELL, Pt, Rect, Region, clampToWorld, collidersIn, regionAt } from './world';
export type { Pt };

const MARGIN = 0.02; // extra clearance beyond the player's radius: the gaps between the ridge rocks are only just wide enough to walk
const EPS = 1e-9;
const SEARCH_RADIUS = 16; // how far (world units) to look for a free cell near a start or goal that sits inside scenery
/** Most cells the cached grids may hold between them. A grid is ~25 bytes a cell; the whole of today's world is ~250k cells. */
let gridBudget = 600_000;

const clearance = (r: number) => r + PLAYER_RADIUS + MARGIN;

/** Where a circle's centre can be on each footprint rect (a room narrower than the circle collapses to its centreline, as in clampToWorld). */
const walkableOf = (rects: Rect[]): Rect[] => rects.map(r => {
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
  for (const o of collidersIn(a.x, a.z, b.x, b.z)) {
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / len2)) : 0;
    const c = clearance(o.r) - MARGIN;
    if (Math.hypot(a.x + dx * t - o.x, a.z + dz * t - o.z) < c) return false;
  }
  return true;
}

/** True when walking the straight segment a->b stays on the floor and clear of every collider. */
export const segmentClear = (a: Pt, b: Pt): boolean => clearOf(a, b, walkableOf(FOOTPRINT));

// --- zones ----------------------------------------------------------------------------------------------------------------------

interface Zone { id: string; regions: Region[]; cell: number }
const ZONES = new Map<string, Zone>();
for (const r of REGIONS) {
  const z = ZONES.get(r.zone) ?? { id: r.zone, regions: [], cell: Infinity };
  z.regions.push(r);
  z.cell = Math.min(z.cell, r.cell ?? WILD_CELL);
  ZONES.set(r.zone, z);
}
/** Which zones touch which, and the seam point where they do. Built from the regions' symmetric `connections`. */
const SEAMS = new Map<string, { to: string; at: Pt }[]>();
for (const r of REGIONS) {
  for (const c of r.connections) {
    const other = REGIONS.find(o => o.id === c.to)!;
    if (other.zone !== r.zone) SEAMS.set(r.zone, [...(SEAMS.get(r.zone) ?? []), { to: other.zone, at: c.at }]);
  }
}

/** The zone a spot belongs to: that of the region holding it, or of the nearest floor when it is off the map. */
function zoneAt(p: Pt): Zone | null {
  const r = regionAt(p.x, p.z) ?? (() => { const c = clampToWorld(p); return regionAt(c.x, c.z); })();
  return r ? ZONES.get(r.zone)! : null;
}

/** The legs of a walk from one zone to another, fewest zones first: each ends where the next begins, at a seam point. Null when the zones do not connect. */
function zoneLegs(from: Zone, to: Zone): { zone: Zone; end: Pt | null }[] | null {
  if (from === to) return [{ zone: from, end: null }];
  const via = new Map<string, { prev: string; at: Pt }>([[from.id, { prev: '', at: { x: 0, z: 0 } }]]), queue = [from.id];
  for (let head = 0; head < queue.length && !via.has(to.id); head++) {
    for (const e of SEAMS.get(queue[head]) ?? []) if (!via.has(e.to)) { via.set(e.to, { prev: queue[head], at: e.at }); queue.push(e.to); }
  }
  if (!via.has(to.id)) return null;
  const legs: { zone: Zone; end: Pt | null }[] = [{ zone: to, end: null }];
  for (let id = to.id; id !== from.id;) { const v = via.get(id)!; legs.unshift({ zone: ZONES.get(v.prev)!, end: v.at }); id = v.prev; }
  return legs;
}

// --- grids ----------------------------------------------------------------------------------------------------------------------

interface Grid {
  cell: number;
  ox: number; oz: number; nx: number; nz: number;
  free: Uint8Array;
  comp: Int32Array; // connected-component label of each free cell (0 for blocked)
  g: Float64Array; prev: Int32Array; seen: Uint32Array; done: Uint32Array; stamp: number; // A* scratch, reused between routes
}
interface Cached { sig: number; grid: Grid; used: number }
const grids = new Map<string, Cached>();
let useClock = 0;

const zoneRects = (z: Zone) => walkableOf(z.regions.flatMap(r => r.footprint));
const bounds = (rects: Rect[]): Rect => rects.reduce((m, r) => ({ x0: Math.min(m.x0, r.x0), x1: Math.max(m.x1, r.x1), z0: Math.min(m.z0, r.z0), z1: Math.max(m.z1, r.z1) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
/** The colliders that stand on a zone's floor (or just off its edge). */
const zoneColliders = (rects: Rect[]) => {
  const b = bounds(rects), pad = 5;
  return COLLIDERS.filter(o => o.x >= b.x0 - pad - o.r && o.x <= b.x1 + pad + o.r && o.z >= b.z0 - pad - o.r && o.z <= b.z1 + pad + o.r);
};

/** A number that changes whenever a footprint or collider of the zone is added, removed or moved. O(colliders): nothing next to a grid rebuild. */
function signature(rects: Rect[], colliders: { x: number; z: number; r: number }[]): number {
  let h = rects.length * 31 + colliders.length;
  for (const r of rects) h = h * 1.0000007 + r.x0 * 1.3 + r.x1 * 2.7 + r.z0 * 3.1 + r.z1 * 4.3;
  for (const o of colliders) h = h * 1.0000007 + o.x * 5.3 + o.z * 7.1 + o.r * 11.9;
  return h;
}

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;
/** Can a step from cell (cx,cz) by (dx,dz) be taken? A diagonal may not cut the corner between two blocked cells. */
function canStep(gr: Grid, cx: number, cz: number, dx: number, dz: number): boolean {
  const x = cx + dx, z = cz + dz;
  if (x < 0 || z < 0 || x >= gr.nx || z >= gr.nz || !gr.free[z * gr.nx + x]) return false;
  return !(dx && dz && (!gr.free[cz * gr.nx + x] || !gr.free[z * gr.nx + cx]));
}

function buildGrid(rects: Rect[], colliders: { x: number; z: number; r: number }[], CELL: number): Grid {
  const { x0, x1, z0, z1 } = bounds(rects);
  const nx = Math.floor((x1 - x0) / CELL + EPS) + 1, nz = Math.floor((z1 - z0) / CELL + EPS) + 1, cells = nx * nz;
  const gr: Grid = {
    cell: CELL, ox: x0, oz: z0, nx, nz, free: new Uint8Array(cells), comp: new Int32Array(cells),
    g: new Float64Array(cells), prev: new Int32Array(cells), seen: new Uint32Array(cells), done: new Uint32Array(cells), stamp: 0,
  };
  // floor: every cell centre on some footprint rect
  for (const r of rects) {
    const i0 = Math.max(0, Math.ceil((r.x0 - x0) / CELL - EPS)), i1 = Math.min(nx - 1, Math.floor((r.x1 - x0) / CELL + EPS));
    const j0 = Math.max(0, Math.ceil((r.z0 - z0) / CELL - EPS)), j1 = Math.min(nz - 1, Math.floor((r.z1 - z0) / CELL + EPS));
    for (let j = j0; j <= j1; j++) gr.free.fill(1, j * nx + i0, j * nx + i1 + 1);
  }
  // scenery: rasterise each collider's disc, only the cells near it
  for (const o of colliders) {
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

/** The zone's grid: from the cache, or built now. Building may evict the least recently used other grids to stay inside the budget. */
function gridOf(z: Zone): Grid {
  const rects = zoneRects(z), colliders = zoneColliders(rects), sig = signature(rects, colliders), hit = grids.get(z.id);
  if (hit && hit.sig === sig) { hit.used = ++useClock; return hit.grid; }
  grids.delete(z.id);
  const grid = buildGrid(rects, colliders, z.cell);
  grids.set(z.id, { sig, grid, used: ++useClock });
  trimGrids(z.id);
  return grid;
}
const cellsHeld = () => [...grids.values()].reduce((n, c) => n + c.grid.nx * c.grid.nz, 0);
function trimGrids(keep: string) {
  while (cellsHeld() > gridBudget && grids.size > 1) {
    let oldest: string | null = null;
    for (const [id, c] of grids) if (id !== keep && (oldest === null || c.used < grids.get(oldest)!.used)) oldest = id;
    if (oldest === null) return;
    grids.delete(oldest);
  }
}
/** What routing is holding in memory: for tests and the bench. */
export const gridStats = () => ({ zones: [...grids.keys()], cells: cellsHeld(), budget: gridBudget });
/** Dev and tests: how many cells the grids may hold, and a way to drop them all. */
export function setGridBudget(cells: number) { gridBudget = cells; for (const id of grids.keys()) { trimGrids(id); break; } }
export const evictGrids = () => grids.clear();

/** The free cell nearest to p, searching outwards in rings, or -1 when there is none within SEARCH_RADIUS. */
function nearestFree(gr: Grid, p: Pt): number {
  const CELL = gr.cell, reach = Math.ceil(SEARCH_RADIUS / CELL);
  const ci = Math.max(0, Math.min(gr.nx - 1, Math.round((p.x - gr.ox) / CELL))), cj = Math.max(0, Math.min(gr.nz - 1, Math.round((p.z - gr.oz) / CELL)));
  for (let rad = 0; rad < reach; rad++) {
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

/** A* over a zone's grid, 8-connected, octile heuristic, binary heap. Returns the cell indices start..goal, or null. */
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

/** String-pull a list of points: from each anchor, jump to the furthest one it can see. The last point stays the last (same object). */
function pull(from: Pt, pts: Pt[], rects: Rect[]): Pt[] {
  const out: Pt[] = [];
  let anchor = from, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clearOf(anchor, pts[j], rects)) j--;
    out.push(pts[j]);
    anchor = pts[j];
    i = j + 1;
  }
  return out;
}

/** One leg of a route, inside one zone: a clear line, or a search of the zone's grid. Null when no way round exists. */
function routeLeg(zone: Zone, from: Pt, to: Pt, rects: Rect[]): Pt[] | null {
  if (clearOf(from, to, rects)) return [to];
  const gr = gridOf(zone), start = nearestFree(gr, from), goal = nearestFree(gr, to);
  if (start < 0 || goal < 0 || gr.comp[start] !== gr.comp[goal]) return null;
  const path = search(gr, start, goal);
  if (!path) return null;
  const cells: Pt[] = path.map(i => ({ x: gr.ox + (i % gr.nx) * gr.cell, z: gr.oz + Math.floor(i / gr.nx) * gr.cell }));
  cells.push(to);
  return pull(from, cells, rects);
}

/**
 * Waypoints from `from` to `to`, the last being `to` itself (same object), or null when no way round exists. A clear straight
 * line is just [to]. A goal that sits inside a rock (a node) is approached to the nearest free cell first. A walk that crosses
 * from one zone into another is searched a zone at a time, through the seam points between them.
 */
export function route(from: Pt, to: Pt): Pt[] | null {
  const rects = walkableOf(FOOTPRINT);
  if (clearOf(from, to, rects)) return [to];
  const a = zoneAt(from), b = zoneAt(to), legs = a && b && zoneLegs(a, b);
  if (!legs) return null;
  const out: Pt[] = [];
  let anchor = from;
  for (const leg of legs) {
    const end = leg.end ?? to, pts = routeLeg(leg.zone, anchor, end, rects);
    if (!pts) return null;
    out.push(...pts);
    anchor = end;
  }
  const pulled = legs.length > 1 ? pull(from, out, rects) : out; // legs met at seam points: the line may cut across them
  pulled[pulled.length - 1] = to;
  return pulled;
}

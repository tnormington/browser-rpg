// The edge of the world, as data (HOM-190). Where a region's floor ends and nothing else begins, something stands: a heap of boulders, a cliff,
// a treeline, a drowned shore. Which, face by face, is the table below; where each piece of it stands is `buildEdges`, a pure function of the
// regions' footprints and a seed, so the world is the same every run and a test can hold it.
//
// Decoration, not collision: `clampToWorld` is the wall and the routing grids are built from the footprints, neither knows these exist (HOM-45
// paid for that grid once). Pieces stand outside the line, never on a floor, and leave every way through clear. No Three.js and no DOM, like
// the rest of sim/: the renderer (edges-view.ts) reads the pieces and draws them.
import { REGIONS, Rect, Region } from './world';

/** The kinds an edge can be (HOM-191 draws each: src/edges.ts). A fence is the hedgerow's own posts and rails, so the data says hedgerow. */
export type EdgeKind = 'rock' | 'cliff' | 'treeline' | 'thicket' | 'water' | 'hedgerow' | 'ruin' | 'barrow';
/** Which way a face looks, out of the floor: `s` is -z (Hale's rock face), `n` +z, `w` -x, `e` +x (Hale's gate). */
export type Face = 's' | 'n' | 'w' | 'e';

/** One placed piece. `ax`/`az` is where it hangs off the line (the anchor), `x`/`z` where it stands, `rank` how many rows back from the line. */
export interface EdgePiece {
  kind: EdgeKind;
  variant: number;
  x: number; z: number;
  ax: number; az: number;
  rank: number;
  /** Turn about y, radians, from a piece's own frame (+z out of the floor) to the world. */
  rot: number;
  scale: number;
  /** How far it is sunk into the ground, world units. */
  sink: number;
  /** 0..1: a slow drift along the edge plus a little noise: the renderer lightens and darkens by it, so a stretch reads as one patch of ground and not a dapple. */
  tone: number;
}

/**
 * What the placer needs to know of a kind. The numbers are the artist's (a recipe's own, src/edges.ts: they are what the pieces were drawn to), and
 * `edgeStyles()` reads them off the recipes, so the sim never imports a drawing.
 */
export interface EdgeStyle {
  /** Distance between neighbours along the line, drawn between these (and stretched in clumps, see `buildEdges`). */
  spacing: [number, number];
  /** Rows, and how far out the last one sits. */
  ranks: number; depth: number;
  scale: [number, number];
  variants: number;
  /** Chance a piece is left out. */
  gap: number;
  sink: number;
  /** Faces the line (within a little), instead of any way round. */
  along: boolean;
}
export type EdgeStyles = Record<EdgeKind, EdgeStyle>;
type FaceKinds = Partial<Record<Face, EdgeKind>>;
/** A region's faces. `rects` overrides them for one of its footprint rects by index (Saltmarrow's quay is a strip of deck with sea on three sides). */
interface RegionEdges { faces: FaceKinds; rects?: Record<number, FaceKinds> }
const SEA: FaceKinds = { s: 'water', n: 'water', w: 'water', e: 'water' };

/**
 * Every region face that looks onto nothing. A region absent here (a district, a cave: the dungeons wall themselves) has no edge of its own.
 * A face the table leaves out draws nothing, which is what the test notices.
 */
export const EDGES: Record<string, RegionEdges> = {
  clearing:    { faces: { s: 'cliff', n: 'treeline', w: 'thicket', e: 'hedgerow' } },
  greywater:   { faces: { s: 'rock', n: 'hedgerow', w: 'hedgerow', e: 'rock' } },
  saltmarrow:  { faces: { s: 'cliff', n: 'rock', w: 'rock', e: 'water' }, rects: { 1: SEA } },
  dunmere:     { faces: { s: 'thicket', n: 'thicket', w: 'thicket', e: 'water' } },
  thornwick:   { faces: { s: 'treeline', n: 'treeline', w: 'treeline', e: 'thicket' } },
  barrowdowns: { faces: { s: 'barrow', n: 'barrow', w: 'barrow', e: 'barrow' } },
  highmoor:    { faces: { s: 'rock', n: 'cliff', w: 'cliff', e: 'cliff' } },
  cairnwaste:  { faces: { s: 'cliff', n: 'ruin', w: 'cliff', e: 'ruin' } },
  spire:       { faces: { s: 'ruin', n: 'ruin', w: 'ruin', e: 'cliff' } },
};

/** Places an edge must not put a piece on: the east gate's two posts (render.ts stands them at x 30, z 4.4 and 11.6). */
export const EDGE_KEEP_CLEAR: { x: number; z: number; r: number }[] = [{ x: 30, z: 4.4, r: 1.6 }, { x: 30, z: 11.6, r: 1.6 }];
/** How far from a way through a piece stops, and how far a piece's body (up to four across, before its scale) is taken to reach when asking whether it stands on floor. */
const GAP_MARGIN = 2, BODY = 0.8;
const EPS = 0.01;

/** FNV-1a: a string to a 32-bit seed. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32: a seed to a stream of 0..1. Seeds that differ by a digit give streams that agree on their first draws, so the seed is scrambled first. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  a ^= a >>> 16; a = Math.imul(a, 0x85ebca6b); a ^= a >>> 13; a = Math.imul(a, 0xc2b2ae35); a = (a ^ (a >>> 16)) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Smooth 0..1 noise along a line: the slow drift that makes clumps and colour patches rather than a dapple. */
function drift(seed: number, t: number): number {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  const at = (k: number) => stream(seed + Math.imul(k, 2654435761))();
  return at(i) * (1 - u) + at(i + 1) * u;
}

/** A face's outward normal and the line it lies on: the rect's edge as [fixed coordinate, from, to] along the other axis. */
const FACES: { face: Face; alongX: boolean; sign: 1 | -1; line: (r: Rect) => number; from: (r: Rect) => number; to: (r: Rect) => number }[] = [
  { face: 's', alongX: true,  sign: -1, line: r => r.z0, from: r => r.x0, to: r => r.x1 },
  { face: 'n', alongX: true,  sign: 1,  line: r => r.z1, from: r => r.x0, to: r => r.x1 },
  { face: 'w', alongX: false, sign: -1, line: r => r.x0, from: r => r.z0, to: r => r.z1 },
  { face: 'e', alongX: false, sign: 1,  line: r => r.x1, from: r => r.z0, to: r => r.z1 },
];

/** The parts of [a, b] not inside any of the intervals. */
function subtract(a: number, b: number, cuts: [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const [c0, c1] of cuts) out = out.flatMap(([s, e]) => (c1 <= s || c0 >= e) ? [[s, e] as [number, number]] : [[s, Math.max(s, c0)], [Math.min(e, c1), e]].filter(([x, y]) => y - x > EPS) as [number, number][]);
  return out;
}

const within = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.z0 >= b.z0 && a.z1 <= b.z1;
/** Every floor there is to stand on. A district (the ridge, the seams, the waysides) lies inside another region's floor and adds none; two regions sharing one rect count it once. */
export const floors = (regions: Region[]): Rect[] => regions.flatMap((r, i) => r.footprint.filter(a => !regions.some((o, j) => j !== i && o.footprint.some(b => within(a, b) && (!within(b, a) || j < i)))));

/** A run of an edge: one stretch of one face of one rect with open ground beyond it. */
export interface EdgeRun { region: string; rect: number; face: Face; kind: EdgeKind; line: number; from: number; to: number; /** the ends that are corners, not gaps: they get no margin */ open: [boolean, boolean] }

/** Every stretch of every floor's outline that opens onto nothing, with its kind. Pieces of floor another floor covers are ways through, and drop out. */
export function edgeRuns(regions: Region[] = REGIONS): EdgeRun[] {
  const rects = floors(regions);
  const claimed = new Map<string, [number, number][]>(); // the same line seen from two regions (the ridge and the clearing share one) is drawn once
  const runs: EdgeRun[] = [];
  for (const region of regions) {
    const table = EDGES[region.id];
    if (!table || region.cave || region.district) continue;
    region.footprint.forEach((rect, ri) => {
      for (const f of FACES) {
        const kind = (table.rects?.[ri] ?? table.faces)[f.face];
        if (!kind) continue;
        const line = f.line(rect), e0 = f.from(rect), e1 = f.to(rect);
        // another floor that straddles this line is the other side of it: the way through is where it reaches
        const cuts: [number, number][] = [];
        for (const o of rects) {
          if (o === rect) continue;
          const [lo, hi] = f.alongX ? [o.z0, o.z1] : [o.x0, o.x1];
          if (lo < line - EPS && hi > line + EPS) cuts.push(f.alongX ? [o.x0, o.x1] : [o.z0, o.z1]);
        }
        const key = `${f.face}:${line.toFixed(2)}`, done = claimed.get(key) ?? [];
        for (const [a, b] of subtract(e0, e1, [...cuts, ...done])) {
          if (b - a < 1) continue;
          runs.push({ region: region.id, rect: ri, face: f.face, kind, line, from: a, to: b, open: [a > e0 + EPS, b < e1 - EPS] });
        }
        claimed.set(key, [...done, [e0, e1]]);
      }
    });
  }
  return runs;
}

/** Is this point on (or within `pad` of) a floor that is not `own`? Pieces never stand on one. */
const onOtherFloor = (rects: Rect[], own: Rect, x: number, z: number, pad: number) =>
  rects.some(o => o !== own && x > o.x0 - pad && x < o.x1 + pad && z > o.z0 - pad && z < o.z1 + pad);

/** The turn that takes a piece's own frame (+z out of the floor) to the world, for a face. */
const FACING: Record<Face, number> = { s: Math.PI, n: 0, e: Math.PI / 2, w: -Math.PI / 2 };

/**
 * Every piece of every edge. Nothing is regular: how far apart (in clumps), which of the kind's shapes, how big, how turned, how far back, how
 * deep in the ground, what shade, whether it is there at all, each drawn from a stream seeded by the run, so the same run always gives the same stand.
 */
export function buildEdges(styles: EdgeStyles, regions: Region[] = REGIONS): EdgePiece[] {
  const rects = floors(regions);
  const out: EdgePiece[] = [];
  for (const run of edgeRuns(regions)) {
    const st = styles[run.kind], f = FACES.find(q => q.face === run.face)!, own = regions.find(r => r.id === run.region)!.footprint[run.rect];
    const lo = run.from + (run.open[0] ? GAP_MARGIN : 0), hi = run.to - (run.open[1] ? GAP_MARGIN : 0);
    const step = st.ranks > 1 ? st.depth / (st.ranks - 1) : 0;
    for (let rank = 0; rank < st.ranks; rank++) {
      const seed = seedOf(`${run.region}:${run.rect}:${run.face}:${run.from.toFixed(1)}:${run.kind}:${rank}`), rnd = stream(seed);
      const slow = seed ^ 0x9e3779b9;
      let t = lo + rnd() * (st.spacing[0] + st.spacing[1]) / 4 + rank * 0.37; // a rank starts part-way in: the rows do not line up
      while (t <= hi) {
        const clump = drift(slow, t / 14); // 0..1: where it is high, pieces stand closer
        const g = (st.spacing[0] + rnd() * (st.spacing[1] - st.spacing[0])) * (1.35 - clump * 0.7);
        const take = rnd() >= st.gap, size = rnd(), back = rnd(), turn = rnd(), shade = rnd(), pick = rnd(), jig = rnd(), dig = rnd();
        const here = t;
        t += g;
        if (!take) continue;
        const along = here + (jig - 0.5) * st.spacing[0] * 0.5, away = 0.1 + rank * step + back * Math.max(0.6, step * 0.4);
        const ax = f.alongX ? along : run.line, az = f.alongX ? run.line : along;
        const x = f.alongX ? ax : ax + f.sign * away, z = f.alongX ? az + f.sign * away : az;
        if (along < lo - EPS || along > hi + EPS) continue;
        if (onOtherFloor(rects, own, x, z, BODY)) continue;
        if (EDGE_KEEP_CLEAR.some(k => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
        out.push({
          kind: run.kind, variant: Math.min(st.variants - 1, Math.floor(pick * st.variants)), x, z, ax, az, rank,
          rot: FACING[run.face] + (st.along ? (turn - 0.5) * 0.7 : turn * Math.PI * 2),
          scale: st.scale[0] + size * (st.scale[1] - st.scale[0]),
          sink: dig * st.sink,
          tone: Math.min(1, Math.max(0, drift(slow ^ 0x51ed270b, t / 22) * 0.65 + shade * 0.35)),
        });
      }
    }
  }
  return out;
}
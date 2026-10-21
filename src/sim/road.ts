// Where a road actually lies: how its beaten dirt wanders, how wide it is, and the tracks that branch off it.
// Pure geometry and no world data, so sim/world.ts can hold the roads and the branches and both the sim (where the
// verges and the waysides go) and the renderer (the dirt, the waymarks, the scatter it keeps off) ask this file.
//
// A road is not a ruled line. Its centre wanders by a sum of three sines, tapered to nothing at each end so that a
// gate's corridor, a seam between two regions and a town's way in are still met head-on, and its width breathes as
// it goes. All of it is deterministic: the same road every session, which is what the verges and the saves need.

export interface Pt { x: number; z: number }

export interface Road {
  /** Which way the road runs: 'x' is east to west (it wanders in z), 'z' is north to south (it wanders in x). */
  axis: 'x' | 'z';
  /** The straight line it wanders about: z = `at` for an east-west road, x = `at` for a north-south one. */
  at: number;
  /** Where the run begins and ends along `axis`. The bend tapers to nothing at both. */
  run: [number, number];
  /** Picks the bend: two roads with the same seed wander the same way, and every other pair does not. */
  seed: number;
}

/** Amplitude and wavelength/2π of each wave in the bend. Their sum, 6.4, is the furthest a road is ever off its line. */
const WAVES: readonly (readonly [number, number])[] = [[3.4, 43], [2.2, 17], [0.8, 7.5]];
/** How far in from either end the bend has grown to its full depth. */
const TAPER = 70;
const ramp = (d: number) => Math.min(1, Math.max(0, d / TAPER));

/** Where the road's centre is, across its axis, at `s` along it. */
export function roadAt(road: Road, s: number): number {
  const taper = ramp(s - road.run[0]) * ramp(road.run[1] - s);
  if (taper === 0) return road.at;
  let w = 0;
  for (const [amp, len] of WAVES) w += Math.sin(s / len + road.seed * (len + 1)) * amp;
  return road.at + w * taper;
}

/** Half the width of the beaten dirt at `s`: a road pinches and opens out, it is not a strip of one gauge. */
export const roadHalfWidth = (road: Road, s: number) =>
  4.2 + Math.sin(s / 11 + road.seed * 3.3) * 0.9 + Math.sin(s / 31 + road.seed) * 0.7;

/** How far a point is from the road's centre. The bend is gentle (under ten degrees), so the gap across the axis is the distance. */
export const roadDist = (road: Road, x: number, z: number) =>
  road.axis === 'x' ? Math.abs(z - roadAt(road, x)) : Math.abs(x - roadAt(road, z));

/** A point on the road: `s` along it, `off` across it (+z on an east-west road, +x on a north-south one). */
export const roadPoint = (road: Road, s: number, off = 0): Pt =>
  road.axis === 'x' ? { x: s, z: roadAt(road, s) + off } : { x: roadAt(road, s) + off, z: s };

/** How far along its axis a point lies: the other half of `roadPoint`. */
export const roadAlong = (road: Road, p: Pt) => road.axis === 'x' ? p.x : p.z;

// --- the branches ---------------------------------------------------------------------------------------------------

/**
 * A track that leaves a road at a fork and runs to somewhere with a name. The point of one is the choice at the fork:
 * the signpost there has an arm for the waystation and an arm for the next town, and the player picks.
 */
export interface Branch {
  id: string;
  /** The region whose road it leaves, and how far along that road the fork is. */
  region: string;
  at: number;
  /** Where the track ends: the waystation, in world coordinates. */
  to: Pt;
  /** What the waystation is called, and what the road itself goes on to past the fork. */
  name: string;
  onward: string;
  /** Which way along the road's axis `onward` lies. */
  onwardDir: 1 | -1;
  /** What stands at the far end: a wayshrine, or a traveller's fire. */
  mark: 'shrine' | 'wayfire';
}

/** How far off the straight line between the fork and the waystation the track is bowed. */
const BOW = 0.18;
const tracks = new Map<string, Pt[]>();

/**
 * The track as a polyline: a bowed curve out of the fork, so it leaves the road at an angle and never reads as a ruled
 * line. Built once per branch and kept, because the renderer asks for it per vertex of every slab it touches.
 */
export function branchTrack(road: Road, b: Branch): readonly Pt[] {
  let pts = tracks.get(b.id);
  if (pts) return pts;
  const a = roadPoint(road, b.at), dx = b.to.x - a.x, dz = b.to.z - a.z, len = Math.hypot(dx, dz) || 1;
  // the control point of a quadratic, pushed off the midpoint along the perpendicular
  const c = { x: (a.x + b.to.x) / 2 - dz / len * len * BOW, z: (a.z + b.to.z) / 2 + dx / len * len * BOW };
  pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.to.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.to.z });
  }
  tracks.set(b.id, pts);
  return pts;
}

/** The box the track lies in, grown by `pad`: what the renderer tests a slab against before it tests every vertex. */
export function branchBounds(road: Road, b: Branch, pad: number) {
  const pts = branchTrack(road, b);
  return {
    x0: Math.min(...pts.map(p => p.x)) - pad, x1: Math.max(...pts.map(p => p.x)) + pad,
    z0: Math.min(...pts.map(p => p.z)) - pad, z1: Math.max(...pts.map(p => p.z)) + pad,
  };
}

/** How far a point is from the track. */
export function branchDist(road: Road, b: Branch, x: number, z: number): number {
  const pts = branchTrack(road, b);
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], c = pts[i + 1], dx = c.x - a.x, dz = c.z - a.z, len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}

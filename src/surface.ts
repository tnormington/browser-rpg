// Surface detail for every material in the world: one faint greyscale detail map and one normal map ("extrusion mapping") per
// material class, drawn on a canvas at first use and shared by every material of that class. Rendering only.
//
// Why procedural and not image files: the look is a palette of flat colours (docs/art-direction.md) and the detail must not
// fight it. A generated map is tileable by construction, weighs nothing in the bundle, and its contrast is a number here
// rather than a repaint. Colour stays flat; what the maps add is relief, so the key light does the work it already does on
// the facets.
//
// How it reaches the geometry: every mesh in the world is built by render.ts `mesh()`, so `bakeUV` is called there once per
// geometry and `surfaceFor` dresses the material. UVs are world-unit planar projections off the dominant axis of each face,
// so a texel is the same size on a cottage wall, a boulder and the ground, however the geometry was built or merged.
import * as THREE from 'three';

const SIZE = 256;

// ---- tileable value noise -------------------------------------------------------------------------------------------

const fract = (n: number) => n - Math.floor(n);
/** A random value in 0..1 for an integer cell, wrapped to `period` so the field meets itself at the tile edge. */
const cell = (x: number, y: number, period: number, seed: number) =>
  fract(Math.sin(((x % period) + period) % period * 127.1 + ((y % period) + period) % period * 311.7 + seed * 74.7) * 43758.5453);
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * One octave of tileable value noise: `period` cells across the tile. The cell grid is drawn once and then read, never
 * re-hashed per pixel: hashing the four corners of every pixel of every octave is a million sines a surface and a second
 * of load time.
 */
function octave(out: Float32Array, period: number, seed: number, amp: number) {
  const grid = new Float32Array(period * period);
  for (let y = 0; y < period; y++) for (let x = 0; x < period; x++) grid[y * period + x] = cell(x, y, period, seed);
  const step = period / SIZE;
  for (let py = 0; py < SIZE; py++) {
    const gy = py * step, y0 = Math.floor(gy), fy = smooth(gy - y0), r0 = y0 * period, r1 = ((y0 + 1) % period) * period;
    for (let px = 0; px < SIZE; px++) {
      const gx = px * step, x0 = Math.floor(gx), fx = smooth(gx - x0), x1 = (x0 + 1) % period;
      const top = grid[r0 + x0] + (grid[r0 + x1] - grid[r0 + x0]) * fx;
      const bot = grid[r1 + x0] + (grid[r1 + x1] - grid[r1 + x0]) * fx;
      out[py * SIZE + px] += (top + (bot - top) * fy) * amp;
    }
  }
}

/** Fractal noise in 0..1: `period` cells in the first octave, each later one twice as fine and half as loud. */
function fbm(period: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) { octave(out, period * 2 ** o, seed + o * 17, amp); total += amp; amp /= 2; }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Walk the tile, pixel by pixel, in 0..1 coordinates. */
function field(fn: (u: number, v: number, i: number) => number): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) out[py * SIZE + px] = fn(px / SIZE, py / SIZE, py * SIZE + px);
  return out;
}

// ---- the patterns the built surfaces are cut from --------------------------------------------------------------------

/** Distance into a joint: 0 in the middle of a block, 1 in the mortar. `w` is the joint's width as a fraction of the pitch. */
const joint = (t: number, pitch: number, w: number) => {
  const d = Math.abs(fract(t * pitch + 0.5) - 0.5) * 2;   // 0 at the joint, 1 mid-block
  return 1 - Math.min(1, d / w);
};

/** Coursed masonry: `rows` courses of blocks, every other course offset by half a block. */
function courses(rows: number, perRow: number, rough: Float32Array): Float32Array {
  return field((u, v, i) => {
    const row = Math.floor(v * rows), stagger = (row % 2) * 0.5;
    const m = Math.max(joint(v, rows, 0.14), joint(u + stagger, perRow, 0.1));
    return (1 - m) * (0.72 + rough[i] * 0.28) + m * 0.08;   // blocks stand proud and vary; the mortar is the low ground
  });
}

/** Boards running along u, with a sawn seam between each and the grain drawn down its length. */
function planks(count: number, grain: Float32Array, rough: Float32Array): Float32Array {
  const lifts = Array.from({ length: count }, (_, b) => 0.68 + cell(b, 0, count, 5) * 0.3);   // each board sits a little proud of its neighbours
  return field((u, v, i) => {
    const seam = joint(v, count, 0.1);
    return (1 - seam) * (lifts[Math.floor(v * count)] - grain[i] * 0.22 - rough[i] * 0.08) + seam * 0.06;
  });
}

/** Overlapping rows of slates, each row offset by half a slate; the exposed foot of a slate is its highest part. */
function slates(rows: number, perRow: number, rough: Float32Array): Float32Array {
  return field((u, v, i) => {
    const row = Math.floor(v * rows), stagger = (row % 2) * 0.5, down = fract(v * rows);
    const gap = joint(u + stagger, perRow, 0.07);
    return (1 - gap) * (0.25 + down * 0.6 + rough[i] * 0.15) + gap * 0.05;   // the lap: each slate climbs from its head to its foot
  });
}

/** A plain weave: threads over and under in both directions. */
const weave = (threads: number) => field((u, v) =>
  0.5 + 0.5 * Math.sin(u * threads * Math.PI * 2) * Math.sin(v * threads * Math.PI * 2) * 0.6 + 0.2 * Math.sin(v * threads * Math.PI * 2));

/** Mix two fields: `a * (1 - k) + b * k`. */
const mix = (a: Float32Array, b: Float32Array, k: number) => a.map((v, i) => v * (1 - k) + b[i] * k);
/** Pull a field toward its extremes, so a soft noise reads as chips and ridges rather than haze. */
const sharpen = (a: Float32Array, p: number) => a.map(v => v ** p);

// ---- the surfaces ----------------------------------------------------------------------------------------------------

/** `repeat`: tiles per world unit. `relief`: how deep the normal map's extrusion reads. `grime`: how far the detail map darkens. */
interface Surface { height: () => Float32Array; repeat: number; relief: number; grime: number }

const SURFACES = {
  /** Grass and heath: a fine tufted mat with coarser drifts under it. Kept the faintest of the lot: the ground is already tinted per vertex and the two must not fight. */
  ground: { height: () => mix(fbm(26, 3, 1), fbm(6, 2, 2), 0.3), repeat: 0.5, relief: 1.1, grime: 0.15 },
  /** Trodden earth: coarser than grass, with scuffs and small stones. */
  dirt: { height: () => mix(fbm(14, 3, 3), sharpen(fbm(30, 2, 4), 3), 0.3), repeat: 0.5, relief: 1.3, grime: 0.2 },
  /** Raw rock: chipped planes, hard-edged. */
  rock: { height: () => sharpen(mix(fbm(5, 4, 5), fbm(14, 3, 6), 0.4), 1.7), repeat: 0.45, relief: 2.1, grime: 0.3 },
  /** Cut and coursed stone: a footing, a chimney, a waymark, a gate post. */
  stone: { height: () => courses(4, 3, fbm(18, 3, 7)), repeat: 0.5, relief: 2.4, grime: 0.3 },
  /** Limewash over render: near flat, a faint stipple and the trowel's drift, so a wall is not a bare plane. */
  plaster: { height: () => mix(fbm(22, 3, 8), fbm(3, 2, 9), 0.45), repeat: 0.35, relief: 0.8, grime: 0.16 },
  /** A roof: rows of lapped slates. The one surface whose relief is its silhouette, so it reads from across a square. */
  roof: { height: () => slates(7, 5, fbm(20, 2, 10)), repeat: 0.85, relief: 2.6, grime: 0.24 },
  /** Sawn timber: boards with their grain. */
  wood: { height: () => planks(5, fbm(40, 2, 11), fbm(12, 3, 12)), repeat: 0.55, relief: 1.4, grime: 0.24 },
  /** Leaf: clumped, not grainy, so a bush keeps its mass. */
  foliage: { height: () => sharpen(fbm(10, 3, 13), 1.4), repeat: 0.8, relief: 1.6, grime: 0.26 },
  /** Hammered metal: shallow dimples, nothing that would read as rust. */
  metal: { height: () => fbm(12, 2, 14), repeat: 1.4, relief: 0.7, grime: 0.12 },
  /** Hide and leather: a fine pebble grain. */
  hide: { height: () => mix(fbm(28, 3, 15), fbm(8, 2, 16), 0.3), repeat: 1.2, relief: 0.9, grime: 0.16 },
  /** Woven cloth: awnings, banners, a townsman's robe. */
  cloth: { height: () => mix(weave(14), fbm(20, 2, 17), 0.35), repeat: 1.4, relief: 0.6, grime: 0.14 },
} satisfies Record<string, Surface>;

export type SurfaceId = keyof typeof SURFACES;
export const hasSurface = (id: string): id is SurfaceId => id in SURFACES;

// ---- turning a height field into the two maps --------------------------------------------------------------------------

function canvas(): [HTMLCanvasElement, ImageData] {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')!.createImageData(SIZE, SIZE)];
}
function texture(c: HTMLCanvasElement, data: ImageData, repeat: number, srgb: boolean): THREE.CanvasTexture {
  c.getContext('2d')!.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The detail map: greyscale, centred just under white, so it darkens into the hollows and never tints the flat colour. */
function detailMap(h: Float32Array, grime: number, repeat: number): THREE.CanvasTexture {
  const [c, img] = canvas();
  for (let i = 0; i < h.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, 1 - grime + (h[i] - 0.5) * grime * 2)) * 255);
    img.data.set([v, v, v, 255], i * 4);
  }
  return texture(c, img, repeat, true);
}

/** The normal map: the height field's slope, wrapped at the tile edge so neighbouring tiles agree. */
function normalMap(h: Float32Array, relief: number, repeat: number): THREE.CanvasTexture {
  const [c, img] = canvas();
  const at = (x: number, y: number) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * relief * SIZE / 32, dy = (at(x, y + 1) - at(x, y - 1)) * relief * SIZE / 32;
    const len = Math.hypot(dx, dy, 1);
    img.data.set([
      Math.round((-dx / len * 0.5 + 0.5) * 255),
      Math.round((-dy / len * 0.5 + 0.5) * 255),
      Math.round((1 / len * 0.5 + 0.5) * 255), 255,
    ], (y * SIZE + x) * 4);
  }
  return texture(c, img, repeat, false);
}

const built = new Map<SurfaceId, { map: THREE.Texture; normalMap: THREE.Texture } | null>();

/**
 * The shared maps for a material class, built the first time one is asked for. Null where the class has no surface
 * (emitters, skin, gems: the art direction keeps those clean) or where there is no canvas to draw on (node tests).
 */
export function surfaceFor(cls: string): { map: THREE.Texture; normalMap: THREE.Texture } | null {
  if (!hasSurface(cls)) return null;
  if (!built.has(cls)) {
    if (typeof document === 'undefined') return null;
    const s: Surface = SURFACES[cls], h = s.height();
    built.set(cls, { map: detailMap(h, s.grime, s.repeat), normalMap: normalMap(h, s.relief, s.repeat) });
  }
  return built.get(cls) ?? null;
}

// ---- UVs ---------------------------------------------------------------------------------------------------------------

/** Which axis a normal points most along: 0 x, 1 y, 2 z. */
const dominant = (x: number, y: number, z: number) => {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
};

/**
 * Replace a geometry's UVs with a world-unit planar projection off the dominant axis of each face, so one UV unit is one
 * world unit whatever the shape is and however it was placed. A non-indexed geometry (everything merged, which is nearly
 * everything here) projects per triangle, so a facet never carries a seam through its middle; an indexed one (the ground
 * planes) projects per vertex off the normals it already carries.
 */
export function bakeUV(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return geo;   // an empty geometry stood up only to carry a material (world-view.ts's instanced boulders)
  const uv = new Float32Array(pos.count * 2);
  const write = (v: number, axis: number) => {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    uv[v * 2] = axis === 0 ? z : x;
    uv[v * 2 + 1] = axis === 1 ? z : y;
  };
  if (geo.index) {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.normal as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) write(v, dominant(n.getX(v), n.getY(v), n.getZ(v)));
  } else {
    for (let t = 0; t + 2 < pos.count; t += 3) {
      const ax = pos.getX(t + 1) - pos.getX(t), ay = pos.getY(t + 1) - pos.getY(t), az = pos.getZ(t + 1) - pos.getZ(t);
      const bx = pos.getX(t + 2) - pos.getX(t), by = pos.getY(t + 2) - pos.getY(t), bz = pos.getZ(t + 2) - pos.getZ(t);
      const axis = dominant(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      write(t, axis); write(t + 1, axis); write(t + 2, axis);
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

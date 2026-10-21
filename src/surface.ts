// Surface detail for every material in the world: one faint greyscale detail map and one normal map ("extrusion mapping") per
// material class, drawn on a canvas at first use and shared by every material of that class. Rendering only.
//
// Why procedural and not image files: the look is a palette of flat colours (docs/art-direction.md) and the detail must not
// fight it. A generated map is tileable by construction, weighs nothing in the bundle, and its contrast is a number here
// rather than a repaint. Colour stays flat; what the maps add is relief, so the key light does the work it already does on
// the facets.
//
// How it reaches the geometry: a mesh is built either by render.ts `mesh()` (primitives and merged slabs), by models.ts
// (a glTF slot: a tree, a rock, a building, a creature) or by gear.ts, and each of those calls `bakeUV` on the geometry
// and `dress` on the material. UVs are world-unit planar projections off the dominant axis of each face,
// so a texel is the same size on a cottage wall, a boulder and the ground, however the geometry was built or merged.
import * as THREE from 'three';

/** A map's side in pixels. The default suits a tile a world unit or two across; the ground's tile is many times that and says so. */
const SIZE = 256;

// ---- tileable value noise -------------------------------------------------------------------------------------------

const fract = (n: number) => n - Math.floor(n);
/** A random value in 0..1 for an integer cell, wrapped to `period` so the field meets itself at the tile edge. */
const cell = (x: number, y: number, period: number, seed: number) =>
  fract(Math.sin(((x % period) + period) % period * 127.1 + ((y % period) + period) % period * 311.7 + seed * 74.7) * 43758.5453);
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * One octave of tileable value noise over an `n` by `n` map: `period` cells across the tile. The cell grid is drawn once
 * and then read, never re-hashed per pixel: hashing the four corners of every pixel of every octave is a million sines a
 * surface and a second of load time.
 */
function octave(n: number, out: Float32Array, period: number, seed: number, amp: number) {
  const grid = new Float32Array(period * period);
  for (let y = 0; y < period; y++) for (let x = 0; x < period; x++) grid[y * period + x] = cell(x, y, period, seed);
  const step = period / n;
  for (let py = 0; py < n; py++) {
    const gy = py * step, y0 = Math.floor(gy), fy = smooth(gy - y0), r0 = y0 * period, r1 = ((y0 + 1) % period) * period;
    for (let px = 0; px < n; px++) {
      const gx = px * step, x0 = Math.floor(gx), fx = smooth(gx - x0), x1 = (x0 + 1) % period;
      const top = grid[r0 + x0] + (grid[r0 + x1] - grid[r0 + x0]) * fx;
      const bot = grid[r1 + x0] + (grid[r1 + x1] - grid[r1 + x0]) * fx;
      out[py * n + px] += (top + (bot - top) * fy) * amp;
    }
  }
}

/** Fractal noise in 0..1: `period` cells in the first octave, each later one twice as fine and half as loud. */
function fbm(n: number, period: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(n * n);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) { octave(n, out, period * 2 ** o, seed + o * 17, amp); total += amp; amp /= 2; }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Walk the tile, pixel by pixel, in 0..1 coordinates. */
function field(n: number, fn: (u: number, v: number, i: number) => number): Float32Array {
  const out = new Float32Array(n * n);
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) out[py * n + px] = fn(px / n, py / n, py * n + px);
  return out;
}

// ---- ground variation in world space -----------------------------------------------------------------------------------

/** A random value in 0..1 for an integer cell of the world, unwrapped: unlike `cell` there is no period, so nothing repeats. */
const worldCell = (x: number, z: number, seed: number) => fract(Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453);

/** Smooth value noise in 0..1 over world x/z, one feature every `scale` units. */
function worldNoise(x: number, z: number, scale: number, seed: number) {
  const u = x / scale, v = z / scale, x0 = Math.floor(u), z0 = Math.floor(v), fx = smooth(u - x0), fz = smooth(v - z0);
  const top = worldCell(x0, z0, seed) + (worldCell(x0 + 1, z0, seed) - worldCell(x0, z0, seed)) * fx;
  const bot = worldCell(x0, z0 + 1, seed) + (worldCell(x0 + 1, z0 + 1, seed) - worldCell(x0, z0 + 1, seed)) * fx;
  return top + (bot - top) * fz;
}

/**
 * How far apart a ground mesh sets its vertices, in world units. The drift below is carried by the vertex tint, so a
 * floor has to be cut fine enough to sample the smallest scale in it; at the 3 and 4 units the floors used to be cut at,
 * everything under a slab's width averaged away and the ground came out one flat tone.
 */
export const GROUND_CELL = 1.5;

/**
 * How much of a second ground colour shows through at a world point, 0..1. The ground's tint is built out of this
 * (render.ts for Hale, world-view.ts for everywhere else), so the floor varies at scales the texture's own grain cannot
 * reach and never lands on a grid. `seed` picks an independent field: the drift that dries the turf is not the drift
 * that lets the peat through.
 *
 * Most of its weight sits at a nine-unit patch, not at the broadest scale, because the camera sees about thirty units:
 * a field that only varied over a clearing's width would show one half of one feature and read as flat again.
 */
export function groundDrift(x: number, z: number, seed = 0): number {
  const v = (worldNoise(x, z, 26, seed) * 0.5 + worldNoise(x, z, 9, seed + 1) + worldNoise(x, z, 3.5, seed + 2) * 0.55) / 2.05;
  return Math.max(0, Math.min(1, (v - 0.5) * 2 + 0.5));   // stacked octaves crowd the middle; pulled back out so a caller's threshold means what it did of a flat hash
}

// ---- the patterns the built surfaces are cut from --------------------------------------------------------------------

/** Distance into a joint: 0 in the middle of a block, 1 in the mortar. `w` is the joint's width as a fraction of the pitch. */
const joint = (t: number, pitch: number, w: number) => {
  const d = Math.abs(fract(t * pitch + 0.5) - 0.5) * 2;   // 0 at the joint, 1 mid-block
  return 1 - Math.min(1, d / w);
};

/** Coursed masonry: `rows` courses of blocks, every other course offset by half a block. */
function courses(n: number, rows: number, perRow: number, rough: Float32Array): Float32Array {
  return field(n, (u, v, i) => {
    const row = Math.floor(v * rows), stagger = (row % 2) * 0.5;
    const m = Math.max(joint(v, rows, 0.14), joint(u + stagger, perRow, 0.1));
    return (1 - m) * (0.72 + rough[i] * 0.28) + m * 0.08;   // blocks stand proud and vary; the mortar is the low ground
  });
}

/** Boards running along u, with a sawn seam between each and the grain drawn down its length. */
function planks(n: number, count: number, grain: Float32Array, rough: Float32Array): Float32Array {
  const lifts = Array.from({ length: count }, (_, b) => 0.68 + cell(b, 0, count, 5) * 0.3);   // each board sits a little proud of its neighbours
  return field(n, (u, v, i) => {
    const seam = joint(v, count, 0.1);
    return (1 - seam) * (lifts[Math.floor(v * count)] - grain[i] * 0.22 - rough[i] * 0.08) + seam * 0.06;
  });
}

/** Overlapping rows of slates, each row offset by half a slate; the exposed foot of a slate is its highest part. */
function slates(n: number, rows: number, perRow: number, rough: Float32Array): Float32Array {
  return field(n, (u, v, i) => {
    const row = Math.floor(v * rows), stagger = (row % 2) * 0.5, down = fract(v * rows);
    const gap = joint(u + stagger, perRow, 0.07);
    return (1 - gap) * (0.25 + down * 0.6 + rough[i] * 0.15) + gap * 0.05;   // the lap: each slate climbs from its head to its foot
  });
}

/** Bark: `count` fissures running up the bole, wandering with `warp`, with `rough` as the grain on the ridges between them. */
function fissures(n: number, count: number, warp: Float32Array, rough: Float32Array): Float32Array {
  return field(n, (u, v, i) => Math.abs(Math.sin((u + (warp[i] - 0.5) * 0.22) * Math.PI * count)) ** 0.55 * (0.7 + rough[i] * 0.3));
}

/** A plain weave: threads over and under in both directions. */
const weave = (n: number, threads: number) => field(n, (u, v) =>
  0.5 + 0.5 * Math.sin(u * threads * Math.PI * 2) * Math.sin(v * threads * Math.PI * 2) * 0.6 + 0.2 * Math.sin(v * threads * Math.PI * 2));

/** Mix two fields: `a * (1 - k) + b * k`. */
const mix = (a: Float32Array, b: Float32Array, k: number) => a.map((v, i) => v * (1 - k) + b[i] * k);
/** Pull a field toward its extremes, so a soft noise reads as chips and ridges rather than haze. */
const sharpen = (a: Float32Array, p: number) => a.map(v => v ** p);
/** Crystal faces scattered through a field: anything over `t` stands proud as a flat chip, the rest falls away under it. */
const chips = (a: Float32Array, t: number) => a.map(v => (v > t ? 0.8 + (v - t) : v * 0.55));

// ---- the surfaces ----------------------------------------------------------------------------------------------------

/**
 * `height` draws the tile on an `n` by `n` grid. `repeat`: tiles per world unit. `relief`: how deep the normal map's
 * extrusion reads. `grime`: how far the detail map darkens. `size`: the map's side in pixels, SIZE unless the tile is
 * wide enough to need more.
 */
interface Surface { height: (n: number) => Float32Array; repeat: number; relief: number; grime: number; size?: number }

const SURFACES = {
  /**
   * Grass and heath. A nine-unit tile, four times the width of any other surface's and about what the camera can see,
   * because this is the one material laid out flat and unbroken to the fog: at the pace-and-a-half tile it used to have,
   * a frame held two hundred copies of one patch of grass and the ground read as sandpaper. A tile that wide can hold
   * what real ground has and a small one cannot — the tufted mat, hummocks and hollows a stride across, and the odd
   * stone or bare scuff, sparse enough that no two square yards of the world look alike. Kept the faintest of the lot on
   * grime: the ground is tinted per vertex as well, and the two must not fight.
   *
   * Weighted toward the hummocks, not the mat: ground seen from the game's camera is read as lumps with a grain on them,
   * and a field that is mostly grain is sandpaper however wide the tile is. `relief` is low for the same reason the tile
   * is wide — the slope the normal map carries is per texel, and this surface's texels are four times the width of any
   * other's, so the figure that gave the old two-unit tile its depth would give this one a crust.
   */
  ground: { size: 512, repeat: 0.11, relief: 0.45, grime: 0.15,
    height: (n) => mix(mix(fbm(n, 6, 4, 2), fbm(n, 64, 2, 1), 0.32), chips(fbm(n, 22, 2, 27), 0.78), 0.1) },
  /** Trodden earth: coarser than grass, with scuffs and small stones. */
  dirt: { height: (n) => mix(fbm(n, 14, 3, 3), sharpen(fbm(n, 30, 2, 4), 3), 0.3), repeat: 0.5, relief: 1.3, grime: 0.2 },
  /** Raw rock: chipped planes, hard-edged. */
  rock: { height: (n) => sharpen(mix(fbm(n, 5, 4, 5), fbm(n, 14, 3, 6), 0.4), 1.7), repeat: 0.45, relief: 2.1, grime: 0.3 },
  /** Cut and coursed stone: a footing, a chimney, a waymark, a gate post. */
  stone: { height: (n) => courses(n, 4, 3, fbm(n, 18, 3, 7)), repeat: 0.5, relief: 2.4, grime: 0.3 },
  /** Limewash over render: near flat, a faint stipple and the trowel's drift, so a wall is not a bare plane. */
  plaster: { height: (n) => mix(fbm(n, 22, 3, 8), fbm(n, 3, 2, 9), 0.45), repeat: 0.35, relief: 0.8, grime: 0.16 },
  /** A roof: rows of lapped slates. The one surface whose relief is its silhouette, so it reads from across a square. */
  roof: { height: (n) => slates(n, 7, 5, fbm(n, 20, 2, 10)), repeat: 0.85, relief: 2.6, grime: 0.24 },
  /** Sawn timber: boards with their grain. */
  wood: { height: (n) => planks(n, 5, fbm(n, 40, 2, 11), fbm(n, 12, 3, 12)), repeat: 0.55, relief: 1.4, grime: 0.24 },
  /** Bark: fissures up the bole over a coarse grain. A bole, a limb, a fallen bough; a board that was sawn out of one is `wood`. */
  bark: { height: (n) => fissures(n, 9, fbm(n, 8, 2, 18), fbm(n, 26, 3, 19)), repeat: 0.6, relief: 2.2, grime: 0.3 },
  /** Leaf: clumped, not grainy, so a bush keeps its mass. */
  foliage: { height: (n) => sharpen(fbm(n, 10, 3, 13), 1.4), repeat: 0.8, relief: 1.6, grime: 0.26 },
  /** Ore-bearing rock: a chipped face with crystal flecks standing proud of it, so a node reads as mineral and not as another boulder. */
  ore: { height: (n) => mix(sharpen(fbm(n, 6, 3, 20), 1.6), chips(fbm(n, 18, 2, 21), 0.62), 0.45), repeat: 0.8, relief: 2, grime: 0.28 },
  /** Coal: brittle and glassy, broken in big conchoidal flakes with no grain between them. Kept shallow on grime: the colour is already near black. */
  coal: { height: (n) => sharpen(mix(fbm(n, 4, 3, 22), fbm(n, 11, 2, 23), 0.35), 2.2), repeat: 0.7, relief: 1.8, grime: 0.18 },
  /** A cut gem: a fine facet grain, barely there. A gem is read by its colour and its glint, not by its texture. */
  gem: { height: (n) => fbm(n, 16, 2, 24), repeat: 2.6, relief: 0.5, grime: 0.08 },
  /** Skin: pores, and the faintest surface of the lot — a face must not read as orange peel across a square. */
  skin: { height: (n) => mix(fbm(n, 30, 2, 25), fbm(n, 9, 2, 26), 0.25), repeat: 3, relief: 0.45, grime: 0.07 },
  /** Hammered metal: shallow dimples, nothing that would read as rust. */
  metal: { height: (n) => fbm(n, 12, 2, 14), repeat: 1.4, relief: 0.7, grime: 0.12 },
  /** Hide and leather: a fine pebble grain. */
  hide: { height: (n) => mix(fbm(n, 28, 3, 15), fbm(n, 8, 2, 16), 0.3), repeat: 1.2, relief: 0.9, grime: 0.16 },
  /** Woven cloth: awnings, banners, a townsman's robe. */
  cloth: { height: (n) => mix(weave(n, 14), fbm(n, 20, 2, 17), 0.35), repeat: 1.4, relief: 0.6, grime: 0.14 },
} satisfies Record<string, Surface>;

export type SurfaceId = keyof typeof SURFACES;
export const hasSurface = (id: string): id is SurfaceId => id in SURFACES;

// ---- turning a height field into the two maps --------------------------------------------------------------------------

function canvas(n: number): [HTMLCanvasElement, ImageData] {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return [c, c.getContext('2d')!.createImageData(n, n)];
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
function detailMap(n: number, h: Float32Array, grime: number, repeat: number): THREE.CanvasTexture {
  const [c, img] = canvas(n);
  for (let i = 0; i < h.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, 1 - grime + (h[i] - 0.5) * grime * 2)) * 255);
    img.data.set([v, v, v, 255], i * 4);
  }
  return texture(c, img, repeat, true);
}

/** The normal map: the height field's slope, wrapped at the tile edge so neighbouring tiles agree. */
function normalMap(n: number, h: Float32Array, relief: number, repeat: number): THREE.CanvasTexture {
  const [c, img] = canvas(n);
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * relief * n / 32, dy = (at(x, y + 1) - at(x, y - 1)) * relief * n / 32;
    const len = Math.sqrt(dx * dx + dy * dy + 1);   // not Math.hypot: it guards against overflow these slopes cannot reach, and costs several times as much over a 512-pixel map
    img.data.set([
      Math.round((-dx / len * 0.5 + 0.5) * 255),
      Math.round((-dy / len * 0.5 + 0.5) * 255),
      Math.round((1 / len * 0.5 + 0.5) * 255), 255,
    ], (y * n + x) * 4);
  }
  return texture(c, img, repeat, false);
}

const built = new Map<SurfaceId, { map: THREE.Texture; normalMap: THREE.Texture } | null>();

/**
 * The shared maps for a material class, built the first time one is asked for. Null where the class has no surface
 * (emitters and the unlit ground marks: a light has no grain) or where there is no canvas to draw on (node tests).
 */
export function surfaceFor(cls: string): { map: THREE.Texture; normalMap: THREE.Texture } | null {
  if (!hasSurface(cls)) return null;
  if (!built.has(cls)) {
    if (typeof document === 'undefined') return null;
    const s: Surface = SURFACES[cls], n = s.size ?? SIZE, h = s.height(n);
    built.set(cls, { map: detailMap(n, h, s.grime, s.repeat), normalMap: normalMap(n, h, s.relief, s.repeat) });
  }
  return built.get(cls) ?? null;
}

/**
 * Hang a material class's shared maps on a material: the one door every surface in the world goes through, whether the
 * material was built by the renderer (render.ts `material`), restyled off a glTF file (models.ts) or built for a piece of
 * gear. A material that already carries a colour map of its own (a pack's own texture) keeps it.
 */
export function dress(m: THREE.MeshStandardMaterial, cls: string) {
  const s = surfaceFor(cls);
  if (!s || m.map) return;
  m.map = s.map;
  m.normalMap = s.normalMap;
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
 *
 * `scale` is what the geometry's own units are multiplied by before it is drawn: 1 for anything authored in world units,
 * and a skinned model's fit scale for geometry that is still in its file's units (models.ts). A texel is then the same
 * size on a knight as on the ground he stands on.
 */
export function bakeUV(geo: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return geo;   // an empty geometry stood up only to carry a material (world-view.ts's instanced boulders)
  const uv = new Float32Array(pos.count * 2);
  const write = (v: number, axis: number) => {
    const x = pos.getX(v) * scale, y = pos.getY(v) * scale, z = pos.getZ(v) * scale;
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

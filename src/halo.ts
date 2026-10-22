// The glow round a light: the lit air about a flame, which no amount of emissive on the flame itself can draw.
//
// An emitter's own material is held under the bloom threshold (glow.ts), so its colour survives tone mapping instead of
// clipping to a white hole. That is right for the lamp and leaves it a flat shape with nothing coming off it. The halo is
// the other half: a camera-facing disc of light centred on the flame, additive, falling to nothing at its rim. It reads as
// lit air at any distance and in any quality setting, and where it lies over the emitter the two together cross the bloom
// threshold, so the core -- and only the core -- blooms. A halo on its own never does: `halo.test.ts` holds it to that.
//
// Cost: every halo of a slab is one merged geometry and one draw, the way the lamp pools are (world-view.ts `emit`). The
// billboarding is in the vertex shader -- each corner carries its own offset, applied in view space -- so a merged, static
// geometry still faces the camera, and a halo built into a group moves and turns with it.
import * as THREE from 'three';

/** A kind of light: its colour, how far the glow carries (world units), its peak over the emitter, and how hard it flickers (0 = steady). */
export interface HaloKind { color: number; radius: number; strength: number; flicker: number }

/** Every light in the world that glows, by what it is. Colours match the emitter they sit on, a shade warmer or no shade at all. */
export const HALOS = {
  torch: { color: 0xff7a30, radius: 1.9, strength: 0.75, flicker: 0.3 },
  lantern: { color: 0xff9a3c, radius: 2.2, strength: 0.6, flicker: 0.1 },      // a wick behind horn: steadier than a flame in the open
  window: { color: 0xffa348, radius: 1.3, strength: 0.4, flicker: 0.05 },
  forge: { color: 0xff7a2a, radius: 2.6, strength: 0.9, flicker: 0.18 },
  ember: { color: 0xff8a30, radius: 1.1, strength: 0.5, flicker: 0.22 },        // a cooking fire, the alembic's: a few coals, not a furnace
  brazier: { color: 0x6ad8ff, radius: 2.0, strength: 0.7, flicker: 0.28 },      // the cave's cold flame
  crystal: { color: 0x2f7fe0, radius: 1.5, strength: 0.45, flicker: 0.06 },
  fungus: { color: 0x9ae07a, radius: 1.0, strength: 0.45, flicker: 0.05 },
  glass: { color: 0x58d8c8, radius: 1.6, strength: 0.55, flicker: 0.08 },       // the Grotto's drowned lanterns
  trove: { color: 0x6fb8d8, radius: 0.7, strength: 0.5, flicker: 0.04 },        // a hidden chest's pinprick: a cold glint at the edge of sight, small enough to be "something" and not "a chest"
}satisfies Record<string, HaloKind>;
export type HaloId = keyof typeof HALOS;

/** One halo standing somewhere: a kind, a point in whatever frame its mesh is built in, and a size multiplier. */
export interface HaloSpot { id: HaloId; x: number; y: number; z: number; scale?: number }

const VERTEX = `
  attribute vec2 corner;     // -1..1 across the disc
  attribute float radius;    // its radius, world units
  attribute vec3 tint;       // colour x strength, linear
  attribute vec2 flick;      // (amount, phase)
  uniform float time;
  varying vec2 vCorner;
  varying vec3 vTint;
  #include <fog_pars_vertex>
  void main() {
    vCorner = corner;
    vTint = tint * (1.0 + flick.x * (0.6 * sin(time * 7.3 + flick.y) + 0.4 * sin(time * 17.1 + flick.y * 2.7)));
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    mvPosition.xy += corner * radius;   // billboard in view space: the merged geometry never has to turn
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }`;

// Cubed falloff: a tight core with a long tail, so the halo is a glow and not a disc with an edge. Fog takes it the way it
// takes the ground under it (linear fog, as the scene has always used), or a lamp would burn through a wall of fog.
const FRAGMENT = `
  varying vec2 vCorner;
  varying vec3 vTint;
  #include <fog_pars_fragment>
  void main() {
    float a = 1.0 - min(length(vCorner), 1.0);
    a = a * a * a;
    #ifdef USE_FOG
      a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vTint, a);
  }`;

/** One material for every halo in the scene: they differ only in their attributes, and the flicker clock is shared. */
const haloMaterial = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]),
  vertexShader: VERTEX,
  fragmentShader: FRAGMENT,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  fog: true,
});

const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];
const QUAD = [0, 1, 2, 0, 2, 3];

/** Every halo of a slab, a room or a prop as one mesh. Null for an empty list, so a caller can `if (m) add(m)`. */
export function haloMesh(spots: HaloSpot[]): THREE.Mesh | null {
  if (!spots.length) return null;
  const n = spots.length, c = new THREE.Color();
  const pos = new Float32Array(n * 12), corner = new Float32Array(n * 8), radius = new Float32Array(n * 4);
  const tint = new Float32Array(n * 12), flick = new Float32Array(n * 8), index = new Uint32Array(n * 6);
  let widest = 0;
  spots.forEach((s, i) => {
    const k = HALOS[s.id], r = k.radius * (s.scale ?? 1), phase = (i * 2.399) % 6.283; // golden-angle phases: no two near each other flicker together
    widest = Math.max(widest, r);
    c.setHex(k.color).multiplyScalar(k.strength); // setHex is sRGB -> linear: the same units as glow.ts's cap
    for (let v = 0; v < 4; v++) {
      const j = i * 4 + v;
      pos.set([s.x, s.y, s.z], j * 3);
      corner.set([CORNERS[v * 2], CORNERS[v * 2 + 1]], j * 2);
      radius[j] = r;
      tint.set([c.r, c.g, c.b], j * 3);
      flick.set([k.flicker, phase], j * 2);
    }
    for (let v = 0; v < 6; v++) index[i * 6 + v] = i * 4 + QUAD[v];
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('radius', new THREE.BufferAttribute(radius, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  g.setAttribute('flick', new THREE.BufferAttribute(flick, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.boundingSphere!.radius += widest; // every vertex sits at its halo's centre: the quads reach a radius past it
  const m = new THREE.Mesh(g, haloMaterial);
  m.renderOrder = 2; // after the lamp pools on the ground (renderOrder 1)
  m.raycast = () => {};
  return m;
}

/** Drive the flicker. Once a frame, from the renderer; `seconds` is a clock that only goes forward. */
export function tickHalos(seconds: number) {
  haloMaterial.uniforms.time.value = seconds;
}

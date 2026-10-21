import * as THREE from 'three';
import type { Quality } from './post';

// The visible sky: a live dome (drifting cloud, slow colour) and rain. The lighting environment stays the one PMREM bake from
// render.ts: re-baking it per frame is the cost, and a dim night ambient does not need to follow the clouds. Weather scales its intensity instead.

export interface SkyColors { zenith: number; mid: number; horizon: number; ground: number; moon: number; auroraLow: number; auroraHigh: number }

const DOME_RADIUS = 150; // inside the camera far plane (200); the dome rides the camera so it never has parallax

/** Two octaves on low: the clouds go flatter and the cost drops. */
const OCTAVES = { high: 4, low: 2 } as const; // the broad second layer is always two
/** The trimmings that are pure cost once the clouds are flat: aurora striations, moon mottling, shooting stars. */
const DETAIL = { high: 1, low: 0 } as const;

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;

  constructor(c: SkyColors, sunDir: THREE.Vector3) {
    this.u = {
      zenith: { value: new THREE.Color(c.zenith) }, mid: { value: new THREE.Color(c.mid) }, horizon: { value: new THREE.Color(c.horizon) },
      ground: { value: new THREE.Color(c.ground) }, moon: { value: new THREE.Color(c.moon) }, sun: { value: sunDir.clone().normalize() },
      time: { value: 0 }, cover: { value: 0.4 }, dim: { value: 1 }, octaves: { value: OCTAVES.high }, detail: { value: DETAIL.high },
      cloudDark: { value: new THREE.Color(0x1a2338) }, cloudLight: { value: new THREE.Color(0x6f82a0) },
      auroraLow: { value: new THREE.Color(c.auroraLow) }, auroraHigh: { value: new THREE.Color(c.auroraHigh) },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.u, // depth-tested and drawn last: only the pixels the world left empty pay for the cloud shader
      vertexShader: 'varying vec3 d; void main() { d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 zenith, mid, horizon, ground, moon, sun, cloudDark, cloudLight, auroraLow, auroraHigh;
        uniform float time, cover, dim, octaves, detail; varying vec3 d;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p, float oct) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < 4; i++) { if (float(i) >= oct) break; s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
          return s;
        }
        // Stars on a grid in direction space: one cell in fourteen carries one, each with its own size, colour and twinkle rate.
        // The early-out is what keeps it cheap: a cell is several pixels across, so neighbouring pixels agree and the branch stays coherent.
        vec3 starField(vec3 n) {
          vec3 p = n * 90.0, ci = floor(p), cf = fract(p) - 0.5;
          float h = hash3(ci);
          if (h < 0.93) return vec3(0.0);
          float m = fract(h * 311.0), r = length(cf - (fract(vec3(h * 37.0, h * 91.0, h * 157.0)) - 0.5) * 0.8);
          float tw = 0.55 + 0.45 * sin(time * (0.8 + m * 2.4) + h * 53.0);
          vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.91, 0.78), fract(h * 17.0));
          return tint * (0.35 + 0.65 * m) * tw * (smoothstep(0.16, 0.02, r) + 0.2 * smoothstep(0.5, 0.1, r));
        }
        // The aurora: a curtain of arcane light hung in a band of the sky, folded by a warped noise and drifting across it.
        vec3 aurora(vec3 n) {
          float band = smoothstep(0.05, 0.30, n.y) * smoothstep(0.98, 0.50, n.y);
          if (band < 0.003) return vec3(0.0);
          vec2 ap = n.xz / (n.y + 0.30);
          float warp = fbm(ap * 0.40 + vec2(time * 0.020, time * 0.008), 2.0);
          float sheet = fbm(vec2(ap.x * 2.6 + warp * 3.0 + time * 0.035, ap.y * 0.22 - time * 0.012), 3.0);
          float curtain = smoothstep(0.47, 0.64, sheet);
          if (detail > 0.5) curtain *= 0.3 + 1.4 * fbm(vec2(ap.x * 22.0 + warp * 2.0, ap.y * 0.5 + time * 0.25), 2.0); // striations, folded with the sheet and running up it
          return mix(auroraLow, auroraHigh, smoothstep(0.08, 0.45, n.y) * 0.75 + curtain * 0.25) * curtain * band; // green at the foot, violet at the top
        }
        // A shooting star: one track per six-second bucket, over half of them empty, and each lit for only a slice of its bucket.
        float meteor(vec3 n) {
          float id = floor(time / 6.0), ph = fract(time / 6.0);
          float live = smoothstep(0.0, 0.015, ph) * smoothstep(0.30, 0.12, ph);
          if (live < 0.003 || hash(vec2(id, 3.7)) < 0.45) return 0.0;
          vec3 a = normalize(vec3(hash(vec2(id, 1.0)) - 0.5, 0.30 + hash(vec2(id, 2.0)) * 0.6, hash(vec2(id, 3.0)) - 0.5));
          vec3 b = normalize(a + vec3(hash(vec2(id, 4.0)) - 0.5, -0.55, hash(vec2(id, 5.0)) - 0.5) * 1.1);
          float t1 = smoothstep(0.0, 0.30, ph);
          vec3 tail = normalize(mix(a, b, max(t1 - 0.11, 0.0))), seg = normalize(mix(a, b, t1)) - tail;
          float u = clamp(dot(n - tail, seg) / max(dot(seg, seg), 1e-5), 0.0, 1.0);
          return live * smoothstep(0.016, 0.0, length(n - (tail + seg * u))) * (0.1 + 0.9 * u * u); // brightest at the head
        }
        void main() {
          vec3 n = normalize(d);
          float h = clamp(n.y, 0.0, 1.0);
          vec3 m = mix(mid * vec3(0.72, 1.00, 1.18), mid * vec3(1.22, 0.84, 1.26), 0.5 + 0.5 * sin(time * 0.045)); // the band breathes between a cold teal and a violet
          vec3 c = mix(horizon, m, smoothstep(0.0, 0.22, h));
          c = mix(c, zenith, smoothstep(0.1, 0.8, h));
          // clouds: a plane projected overhead, so they thin and flatten toward the horizon like real ones
          vec2 uv = n.xz / (n.y + 0.3) * 0.9;
          vec2 fold = vec2(fbm(uv * 0.5 + time * 0.013, 2.0), fbm(uv * 0.5 + 19.0 - time * 0.009, 2.0)) - 0.5; // warped, so the cloud billows instead of sliding past rigidly
          float q = fbm(uv * 1.3 + fold * 1.1 + vec2(time * 0.022, time * 0.009), octaves) * 0.62
                  + fbm(uv * 0.55 - vec2(time * 0.011, time * 0.004) + 7.0, 2.0) * 0.38;              // the two layers drift apart, which reads as depth
          float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.3, q) * smoothstep(0.0, 0.2, n.y);
          float toMoon = max(dot(n, sun), 0.0), md = length(n - sun);
          // the sky's own lights, all behind the cloud
          c += starField(n) * 0.9 * smoothstep(0.02, 0.26, n.y) * (1.0 - dens);
          c += aurora(n) * clamp((0.75 - cover) / 0.45, 0.0, 1.0) * (0.55 + 0.25 * sin(time * 0.07)); // a clear-sky thing, and it breathes
          c += moon * (exp(-md * 18.0) * 0.55 + exp(-md * 4.0) * 0.07);                              // a tight halo over a faint wide one
          c = mix(c, moon * 2.2 * (detail > 0.5 ? 0.82 + 0.18 * fbm((n.xz - sun.xz) * 55.0, 2.0) : 1.0), smoothstep(0.055, 0.040, md)); // the disc itself, mottled
          c += vec3(0.9, 0.95, 1.0) * meteor(n);
          // thin cirrus, four times the deck's speed and never fully gone: in a clear sky it is the only thing overhead that moves
          float wisp = smoothstep(0.44, 0.74, fbm(vec2(uv.x * 2.2 + time * 0.055, uv.y * 0.55 + time * 0.02), 3.0)) * smoothstep(0.06, 0.32, n.y);
          c = mix(c, mix(cloudDark, cloudLight, 0.75) + moon * pow(toMoon, 6.0) * 0.3, wisp * 0.34 * (1.0 - dens));
          vec3 cloud = mix(cloudDark, cloudLight, smoothstep(0.35, 0.9, q));
          cloud += moon * pow(toMoon, 5.0) * 0.18;                                 // cloud near the moon is lit from behind
          cloud += moon * pow(toMoon, 8.0) * (1.0 - smoothstep(0.4, 0.8, q)) * 0.5; // and its thin edge there takes a silver rim
          cloud = mix(horizon, cloud, smoothstep(0.0, 0.3, n.y));                  // and sinks into the fog colour at the horizon
          c = mix(c, cloud, dens * 0.92);
          c = mix(c, ground, smoothstep(0.0, -0.25, n.y));
          gl_FragColor = vec4(c * dim, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.scale.setScalar(DOME_RADIUS);
    this.mesh.renderOrder = 1000; // after everything opaque
    this.mesh.frustumCulled = false;
  }

  /** `fog` is the live fog colour (the dome's horizon must match it); `dim` is 1 in daylight and 0 deep in a cave. */
  update(time: number, cover: number, fog: THREE.Color, dim: number, camera: THREE.Vector3) {
    this.u.time.value = time;
    this.u.cover.value = cover;
    this.u.dim.value = dim;
    (this.u.horizon.value as THREE.Color).copy(fog);
    this.mesh.position.copy(camera);
    this.mesh.visible = dim > 0.002;
  }

  setQuality(q: Quality) { this.u.octaves.value = OCTAVES[q]; this.u.detail.value = DETAIL[q]; }
}

const RAIN = { high: 1400, low: 500 } as const;
const RAIN_BOX = { w: 44, h: 22 };
const RAIN_STREAK = 0.9, RAIN_SPEED = 22, RAIN_SLANT = 0.18;

/** Rain: one LineSegments draw. Each streak falls and wraps inside a box around the camera, entirely in the vertex shader (no per-frame CPU work). */
export class Rain {
  readonly lines: THREE.LineSegments;
  private u = { time: { value: 0 }, cam: { value: new THREE.Vector3() }, amount: { value: 0 }, color: { value: new THREE.Color(0x8fa6bc) } };

  constructor() {
    const n = RAIN.high, seed = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const r = [Math.random(), Math.random(), Math.random()]; // both ends of a streak share a seed
      for (let v = 0; v < 2; v++) { seed.set(r, (i * 2 + v) * 3); end[i * 2 + v] = v; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3)); // unused, three needs it for the draw count
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('end', new THREE.BufferAttribute(end, 1));
    this.lines = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec3 seed; attribute float end; uniform float time, amount; uniform vec3 cam; varying float a;
        void main() {
          float fall = fract(seed.y - time * ${(RAIN_SPEED / RAIN_BOX.h).toFixed(4)} * (0.85 + seed.z * 0.3));
          vec3 p = vec3((seed.x - 0.5) * ${RAIN_BOX.w.toFixed(1)}, fall * ${RAIN_BOX.h.toFixed(1)}, (fract(seed.z * 7.31) - 0.5) * ${RAIN_BOX.w.toFixed(1)});
          p.x -= p.y * ${RAIN_SLANT.toFixed(3)};
          // wrap the box around the camera, so the shower follows the player
          vec3 w = p; w.xz = mod(p.xz - cam.xz + ${(RAIN_BOX.w / 2).toFixed(1)}, ${RAIN_BOX.w.toFixed(1)}) - ${(RAIN_BOX.w / 2).toFixed(1)} + cam.xz;
          w.y += cam.y - 4.0;
          w += vec3(-${RAIN_SLANT.toFixed(3)}, 1.0, 0.0) * end * ${RAIN_STREAK.toFixed(2)}; // after the wrap, so a streak never straddles the box edge
          // each streak has its own threshold: raising the amount brings more of them in
          a = step(fract(seed.x * 13.7 + seed.y * 5.1), amount) * (0.25 + 0.2 * end);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: 'uniform vec3 color; varying float a; void main() { gl_FragColor = vec4(color, a); }',
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
  }

  /** `amount` 0..1: the rain intensity already scaled down to nothing in a cave. */
  update(time: number, amount: number, camera: THREE.Vector3) {
    this.u.time.value = time;
    this.u.amount.value = amount;
    this.u.cam.value.copy(camera);
    this.lines.visible = amount > 0.01;
  }

  setQuality(q: Quality) { this.lines.geometry.setDrawRange(0, RAIN[q] * 2); }
}

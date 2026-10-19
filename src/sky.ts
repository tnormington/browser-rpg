import * as THREE from 'three';
import type { Quality } from './post';

// The visible sky: a live dome (drifting cloud, slow colour) and rain. The lighting environment stays the one PMREM bake from
// render.ts: re-baking it per frame is the cost, and a dim night ambient does not need to follow the clouds. Weather scales its intensity instead.

export interface SkyColors { zenith: number; mid: number; horizon: number; ground: number; moon: number }

const DOME_RADIUS = 150; // inside the camera far plane (200); the dome rides the camera so it never has parallax

/** Two octaves on low: the clouds go flatter and the cost drops. */
const OCTAVES = { high: 4, low: 2 } as const; // the broad second layer is always two

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private drift = new THREE.Color(0x1a2030); // the slow colour the mid band breathes toward: a cold violet-teal, never warm

  constructor(c: SkyColors, sunDir: THREE.Vector3) {
    this.u = {
      zenith: { value: new THREE.Color(c.zenith) }, mid: { value: new THREE.Color(c.mid) }, horizon: { value: new THREE.Color(c.horizon) },
      ground: { value: new THREE.Color(c.ground) }, moon: { value: new THREE.Color(c.moon) }, sun: { value: sunDir.clone().normalize() },
      time: { value: 0 }, cover: { value: 0.4 }, dim: { value: 1 }, octaves: { value: OCTAVES.high },
      cloudDark: { value: new THREE.Color(0x1b2330) }, cloudLight: { value: new THREE.Color(0x56667c) },
    };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.u, // depth-tested and drawn last: only the pixels the world left empty pay for the cloud shader
      vertexShader: 'varying vec3 d; void main() { d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 zenith, mid, horizon, ground, moon, sun, cloudDark, cloudLight; uniform float time, cover, dim, octaves; varying vec3 d;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p, float oct) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < 4; i++) { if (float(i) >= oct) break; s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
          return s;
        }
        void main() {
          vec3 n = normalize(d);
          float h = clamp(n.y, 0.0, 1.0);
          vec3 m = mix(mid, mid * 0.6 + vec3(0.012, 0.018, 0.03), 0.5 + 0.5 * sin(time * 0.035)); // drifting colour
          vec3 c = mix(horizon, m, smoothstep(0.0, 0.22, h));
          c = mix(c, zenith, smoothstep(0.1, 0.8, h));
          // clouds: a plane projected overhead, so they thin and flatten toward the horizon like real ones
          vec2 uv = n.xz / (n.y + 0.3) * 0.9;
          float q = fbm(uv * 1.3 + vec2(time * 0.012, time * 0.005), octaves) * 0.65 + fbm(uv * 0.6 - vec2(time * 0.006, 0.0) + 7.0, 2.0) * 0.35;
          float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.3, q) * smoothstep(0.0, 0.2, n.y);
          float moonGlow = pow(max(dot(n, sun), 0.0), 40.0);
          vec3 cloud = mix(cloudDark, cloudLight, smoothstep(0.35, 0.9, q));
          cloud += moon * pow(max(dot(n, sun), 0.0), 5.0) * 0.18;                // cloud near the moon is lit from behind
          cloud = mix(horizon, cloud, smoothstep(0.0, 0.3, n.y));                  // and sinks into the fog colour at the horizon
          c += moon * moonGlow * 0.55 * (1.0 - dens);                              // the moon shows in the gaps
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

  setQuality(q: Quality) { this.u.octaves.value = OCTAVES[q]; }
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

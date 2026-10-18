// Post-processing, assembled in one place. Pass order is the array in `PostStack.constructor`: reorder or drop entries there.
//   render (HDR, MSAA) -> GTAO (contact shadow) -> bloom (HDR) -> output (ACES + sRGB) -> grade + vignette (display space)
// Quality 'low' skips the composer entirely and renders straight to the canvas (renderer MSAA + tone mapping).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export type Quality = 'high' | 'low';

/** Every post-processing tunable. Bloom threshold is in linear HDR units, before exposure. */
export const POST = {
  msaa: 4,
  ao: { radius: 1.2, distanceExponent: 1.5, thickness: 1.5, scale: 1.3, samples: 16, intensity: 0.95 },
  bloom: { strength: 0.25, radius: 0.25, threshold: 1.5, knee: 1.5 },
  grade: { crush: 0.015, shadowTint: [0.93, 0.99, 1.08], highlightTint: [1.06, 1.0, 0.93], tintAmount: 0.6, contrast: 1.08, vignette: 0.38, vignetteStart: 0.45 },
};

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    crush: { value: POST.grade.crush }, contrast: { value: POST.grade.contrast },
    shadowTint: { value: new THREE.Vector3(...POST.grade.shadowTint) },
    highlightTint: { value: new THREE.Vector3(...POST.grade.highlightTint) },
    tintAmount: { value: POST.grade.tintAmount },
    vignette: { value: POST.grade.vignette }, vignetteStart: { value: POST.grade.vignetteStart },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float crush, contrast, tintAmount, vignette, vignetteStart;
    uniform vec3 shadowTint, highlightTint; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = max(c - crush, 0.0) / (1.0 - crush);                               // crush the blacks
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = mix(shadowTint, highlightTint, smoothstep(0.15, 0.6, l));  // cool shadows, warm highlights
      c *= mix(vec3(1.0), tint, tintAmount);
      c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
      float d = distance(vUv, vec2(0.5)) * 1.4142;                            // 0 centre .. 1 corner
      c *= 1.0 - vignette * smoothstep(vignetteStart, 1.0, d);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class PostStack {
  readonly composer: EffectComposer;
  readonly ao: GTAOPass;
  readonly bloom: UnrealBloomPass;
  quality: Quality;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera, quality: Quality) {
    this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: POST.msaa });
    this.composer = new EffectComposer(renderer, target);

    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.updateGtaoMaterial({ radius: POST.ao.radius, distanceExponent: POST.ao.distanceExponent, thickness: POST.ao.thickness, scale: POST.ao.scale, samples: POST.ao.samples });
    this.ao.blendIntensity = POST.ao.intensity;
    // AO only makes sense on solid geometry: hide blended things (rings, sprites, beams) from the normal/depth pre-pass.
    const hideDefault = this.ao.overrideVisibility.bind(this.ao);
    this.ao.overrideVisibility = () => {
      hideDefault();
      scene.traverse(o => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if ((o as THREE.Sprite).isSprite || (m && m.transparent)) o.visible = false;
      });
    };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), POST.bloom.strength, POST.bloom.radius, POST.bloom.threshold);

    // Bloom keys on the brightest channel, not luma: luma all but ignores saturated fire (orange is ~0.3 luma at full brightness).
    const high = this.bloom.materialHighPassFilter;
    high.uniforms.smoothWidth.value = POST.bloom.knee;
    high.fragmentShader = high.fragmentShader.replace('luminance( texel.xyz )', 'max( texel.r, max( texel.g, texel.b ) )');
    high.needsUpdate = true;

    const passes: Pass[] = [
      new RenderPass(scene, camera),
      this.ao,
      this.bloom,
      new OutputPass(),
      new ShaderPass(GRADE_SHADER),
    ];
    for (const p of passes) this.composer.addPass(p);
  }

  setQuality(q: Quality) { this.quality = q; }

  setSize(w: number, h: number) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }

  render(scene: THREE.Scene) {
    if (this.quality === 'low') this.renderer.render(scene, this.camera); else this.composer.render();
  }
}

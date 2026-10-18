// The emissive budget. Pure: no Three.js, no DOM, so verify can test it headlessly.
//
// Bloom blew out three times on new emissive content (Warden Hale's gem, the forge core, the Hollow Warden's brazier). Each was
// fixed locally and came back, because the cause is one of two numbers nobody was checking against the post stack:
//   1. a lit mesh's emissive peak (emissive x intensity, linear) set past the bloom threshold, where ACES clips a saturated colour to white;
//   2. a point light parked inside or beside a prop, so the prop's own diffuse term (albedo x I / (pi d^2)) goes far over the threshold.
// Both are capped here, in terms of BLOOM_THRESHOLD, and post.ts reads the same constant. Anything that needs to read as a
// hot spark instead is a `beacon` (thin rings, flat markers, ore flecks): deliberately over the cap, never near a light.
// `bench/glow-audit.sh` lists every scene material and light that breaks either number.

/** Bloom's high-pass threshold, in linear HDR units before exposure (post.ts POST.bloom.threshold). */
export const BLOOM_THRESHOLD = 1.5;
/** Peak linear channel a lit emitter (gear trim, gems, flames, furnace) may reach: under the threshold, so its own colour survives tone mapping. */
export const EMISSIVE_CAP = 1.2;
/** Intensity of a beacon: thin unlit-purpose shapes that are meant to cross the threshold and bloom. */
export const BEACON_INTENSITY = 3;
/** The most radiance a surface lit by a point light may reach before it blooms to white, linear. Same units as the threshold. */
export const LIT_CAP = BLOOM_THRESHOLD;

const lin = (c8: number) => { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

/** The brightest linear channel of an sRGB hex colour, as Three.js sees it after colour management. */
export function linearPeak(hex: number): number {
  return Math.max(lin((hex >> 16) & 255), lin((hex >> 8) & 255), lin(hex & 255));
}

/** `want` clamped so that colour x intensity peaks at `cap` or less. */
export function cappedIntensity(hex: number, want: number, cap = EMISSIVE_CAP): number {
  return Math.min(want, cap / Math.max(1e-6, linearPeak(hex)));
}

/** Nearest a surface of this albedo (0..1) may be to a point light of this intensity (candela) before it passes LIT_CAP. */
export function minLightDistance(intensity: number, albedo = 1): number {
  return Math.sqrt((intensity * albedo) / (Math.PI * LIT_CAP));
}

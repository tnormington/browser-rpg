// Seeded RNG (mulberry32) so the sim stays deterministic and testable. State is one number.
export function nextRandom(box: { rng: number }): number {
  box.rng = (box.rng + 0x6d2b79f5) | 0;
  let t = box.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

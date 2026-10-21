// Seeded RNG (mulberry32) so the sim stays deterministic and testable. State is one number.
export function nextRandom(box: { rng: number }): number {
  box.rng = (box.rng + 0x6d2b79f5) | 0;
  let t = box.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A roll off to one side: deterministic from the seed, the tick and a label, and it does not advance `rng`.
 * For dice that are added to a system that already had some (proc windows, sim/procs.ts). Drawing them from the
 * world's own stream would re-roll every drop, crit and damage spread that came after them, so a fight recorded
 * before the new dice existed would come out differently for no reason the player could see.
 */
export function sideRandom(box: { rng: number; tick: number }, label: string): number {
  let t = (box.rng ^ Math.imul(box.tick + 1, 0x9e3779b1)) | 0;
  for (let i = 0; i < label.length; i++) t = (Math.imul(t, 31) + label.charCodeAt(i)) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

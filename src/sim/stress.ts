// Dev-only scalability knob (?stress=N, debug builds only). Grows the zone by sqrt(N) per side and adds
// (N-1)x the hand-placed enemies, trees and ore rocks in the new ring, so density stays at the original value.
// Additive: factor <= 1 changes nothing. Pure sim, no DOM.
import { ROCKS, TREES, WORLD_HALF, addScenery, setWorldHalf } from './world';
import { SPAWNS } from './data';
import { nextRandom } from './rng';

/** Number of decorative interior boulders the renderer adds, matching the original ring's ~84 per 1x. */
export const BOULDERS_PER_FACTOR = 84;

/** Deterministic uniform points in the stressed zone that lie outside the original square. */
export function* ringPoints(box: { rng: number }, half: number, inner: number, margin: number) {
  for (;;) {
    const x = (nextRandom(box) * 2 - 1) * (half - margin), z = (nextRandom(box) * 2 - 1) * (half - margin);
    if (Math.abs(x) > inner - margin || Math.abs(z) > inner - margin) yield { x, z };
  }
}

export function applyStress(factor: number) {
  if (!(factor > 1)) return;
  const base = { enemies: SPAWNS.length, trees: TREES.length, rocks: ROCKS.length, half: WORLD_HALF };
  setWorldHalf(base.half * Math.sqrt(factor));
  const box = { rng: 12345 };
  const pts = ringPoints(box, WORLD_HALF, base.half, 3);
  const extra = (n: number) => Math.round(n * (factor - 1));
  const orig = SPAWNS.slice(), origRocks = ROCKS.slice();
  for (let i = 0, n = extra(base.enemies); i < n; i++) SPAWNS.push({ type: orig[i % orig.length].type, ...pts.next().value! });
  for (let i = 0, n = extra(base.trees); i < n; i++) { addScenery('clearing', { ...pts.next().value!, r: 1 }); }
  for (let i = 0, n = extra(base.rocks); i < n; i++) { addScenery('clearing', { ...origRocks[i % origRocks.length], ...pts.next().value! }); }
}

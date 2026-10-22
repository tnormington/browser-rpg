// The reach checker (docs/action-layer.md 5.1 and 5.5): the reach rule is a property of the data, so it is a function of the standable tops, not a review.
// Reach is gated on three discrete capabilities (nothing, the hop, the double jump), and a top is only ever authored in the band one of them owns. This
// builds the graph of tops, finds each one's cheapest route up from the ground, and says what it needs: that is the tier a chest standing on it is entitled to.
// Pure arithmetic on circles and heights, so it runs on any list of tops (the world's, or a fixture's).
export interface Top { x: number; z: number; r: number; top: number }

/** What a route asks of the player: the hop everyone has, or the second jump (Agility 25, 40 breath). */
export type Need = 'hop' | 'double';

/** The band a hop owns: 0.4 to 1.0 above the floor beside a top (the worst hop peaks 1.35, so there is 0.35 to spare). */
export const STEP_MIN = 0.4, STEP_MAX = 1.0;
/** The band the double jump owns: 2.5 (0.39 over the best single hop, 2.109) to 2.8 (0.4 under the fixed apex, 3.2). Between the two nothing is standable. */
export const ROOF_MIN = 2.5, ROOF_MAX = 2.8;
/** Rim to rim: 75 % of the worst walking hop (3.32), so a gap this wide is a hop for anyone, standing or running. */
export const HOP_GAP = 2.5;
/** The radius a body can land on: the player is above a rooftop for 0.14 s (0.83 u walking, 1.24 sprinting), so a roof needs more than a step. */
export const STEP_RADIUS = 1.2, ROOF_RADIUS = 2.0;

/** Which capability a rise (or a drop: the rule is about the pair, and falling is free) belongs to, or null in the dead zone and past the apex. */
export const need = (rise: number): Need | null => {
  const h = Math.abs(rise);
  return h <= STEP_MAX ? 'hop' : h >= ROOF_MIN && h <= ROOF_MAX ? 'double' : null;
};
const ORDER: Need[] = ['hop', 'double'];
const harder = (a: Need, b: Need): Need => ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;

/** The horizontal gap between two tops' rims (negative: they overlap). */
export const rimGap = (a: Top, b: Top) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;

/** Every way the tops break the rule: one line each, empty when they keep it. (a) none in the dead zone or past the apex, (b) radius enough to land on, (c) no two a hop apart with a rise outside both bands. */
export function reachErrors(tops: readonly Top[]): string[] {
  const out: string[] = [];
  const at = (t: Top) => `(${t.x}, ${t.z}) top ${t.top}`;
  for (const t of tops) {
    if (need(t.top) === null || t.top < STEP_MIN) out.push(`${at(t)} is in the dead zone or above the apex`);
    else if (t.r < (t.top <= STEP_MAX ? STEP_RADIUS : ROOF_RADIUS)) out.push(`${at(t)} is too narrow to land on (r ${t.r})`);
  }
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
    const a = tops[i], b = tops[j];
    if (rimGap(a, b) <= HOP_GAP && need(a.top - b.top) === null) out.push(`${at(a)} and ${at(b)} are a hop apart with a rise of ${Math.abs(a.top - b.top).toFixed(2)}`);
  }
  return out;
}

/**
 * The cheapest route up from the ground to `to`: each leg is a hop or a double jump, the route needs the hardest of its legs, and the answer is the route
 * whose hardest leg is easiest. Null when there is none (a top in the dead zone, or off every graph). A top at floor 0 is the ground itself: needs nothing.
 */
export function routeNeed(tops: readonly Top[], to: Top): Need | null {
  const best = new Map<Top, Need>();
  for (const t of tops) { const n = need(t.top); if (n) best.set(t, n); } // from the ground, a top is one jump
  for (let changed = true; changed;) { // relax until no route improves: the graph is a few dozen tops
    changed = false;
    for (const a of tops) { const have = best.get(a); if (!have) continue;
      for (const b of tops) {
        if (a === b || rimGap(a, b) > HOP_GAP) continue;
        const leg = need(a.top - b.top);
        if (!leg) continue;
        const via = harder(have, leg), cur = best.get(b);
        if (!cur || ORDER.indexOf(via) < ORDER.indexOf(cur)) { best.set(b, via); changed = true; }
      }
    }
  }
  return best.get(to) ?? null;
}

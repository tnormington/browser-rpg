// The action bar's layout rules, apart from the DOM so they can be tested: which ability a fresh bar holds, and what a stored layout is worth.
// A layout is an ability index (or null) per bar slot.
export type BarLayout = (number | null)[];

/** The layout a fresh player gets: every ability in order, and the rest of the bar left empty for the spell book. */
export const defaultBar = (slots: number, abilities: number): BarLayout => Array.from({ length: slots }, (_, i) => (i < abilities ? i : null));

/**
 * A stored layout, or the default. Anything that is not a list of legal, unrepeated ability indices is thrown away.
 * A layout saved when the bar was shorter keeps every slot the player arranged; the keys added since come after the old ones, so they are the
 * new slots, and each takes an ability the save predates (an index at or past the old length) that is not already on the bar. An ability the
 * player took off the bar on purpose stays off. A longer layout than the bar has keys for is thrown away: it was saved by a build we cannot read.
 */
export function sanitizeBar(raw: unknown, slots: number, abilities: number): BarLayout {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > slots) return defaultBar(slots, abilities);
  const seen = new Set<number>();
  const bar: BarLayout = raw.map(v => {
    if (!Number.isInteger(v) || v < 0 || v >= abilities || seen.has(v)) return null;
    seen.add(v);
    return v as number;
  });
  let next = bar.length;
  while (bar.length < slots) {
    while (next < abilities && seen.has(next)) next++;
    bar.push(next < abilities ? next : null);
    seen.add(next);
  }
  return bar;
}

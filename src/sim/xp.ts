// Reusable XP / level helper. Any skill (combat now, mining/smithing in M3) is just an XpTrack.
// Curve is the RuneScape one: each level costs ~10% more than the last, so it escalates steeply.

export const MAX_LEVEL = 99;

export interface XpTrack { xp: number; level: number }

// CUMULATIVE[l] = total xp needed to reach level l (index 0 unused, level 1 = 0 xp).
const CUMULATIVE: number[] = [0, 0];
for (let l = 1, points = 0; l < MAX_LEVEL; l++) {
  points += Math.floor(l + 300 * Math.pow(2, l / 7));
  CUMULATIVE[l + 1] = Math.floor(points / 4);
}

export const xpForLevel = (level: number): number =>
  CUMULATIVE[Math.max(1, Math.min(MAX_LEVEL, level))];

export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= CUMULATIVE[l + 1]) l++;
  return l;
}

export const newTrack = (): XpTrack => ({ xp: 0, level: 1 });

/** Adds xp; returns how many levels were gained. */
export function addXp(t: XpTrack, amount: number): number {
  const before = t.level;
  t.xp += amount;
  t.level = levelForXp(t.xp);
  return t.level - before;
}

/** Progress within the current level, for XP bars. frac is 1 at max level. */
export function levelProgress(t: XpTrack): { into: number; needed: number; frac: number } {
  if (t.level >= MAX_LEVEL) return { into: 0, needed: 0, frac: 1 };
  const lo = CUMULATIVE[t.level], hi = CUMULATIVE[t.level + 1];
  return { into: t.xp - lo, needed: hi - lo, frac: (t.xp - lo) / (hi - lo) };
}

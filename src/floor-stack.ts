// How far each cave room's floor sits above the last, and the one rule that keeps boss circles from being buried by it. Pure numbers: the renderer reads them and a test checks them.
//
// Rooms of one dungeon overlap at their doorways, so those floors need a hair of height between them or they shimmer. Rooms of different dungeons never touch, so the lift counts *within a dungeon*
// (HOM-112): counting across the whole cave list put the sixteenth room at 0.064, above the 0.06 the ground marks are drawn at, and buried the circles of every boss in the last dungeon, the way a
// stack of thirteen had buried the Rotroot's and the Cairn Hold's before (HOM-100).

/** How far each room's floor sits above the one before it in the same dungeon. */
export const FLOOR_STEP = 0.004;
/** The lowest a ground mark (a boss's circle, a drop ring) is drawn: every floor must stay under it. */
export const GROUND_MARK_Y = 0.06;
/** Height of the floor of the n-th room (from 0) of its dungeon. */
export const floorLift = (nthInDungeon: number) => FLOOR_STEP * (nthInDungeon + 1);
/** Each room's index within its own dungeon, for a list in dungeon order. */
export function roomIndices(dungeons: readonly string[]): number[] {
  const seen = new Map<string, number>();
  return dungeons.map(d => { const n = seen.get(d) ?? 0; seen.set(d, n + 1); return n; });
}

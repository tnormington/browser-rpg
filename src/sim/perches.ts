// The props the cache and hoard chests stand on (HOM-160, docs/action-layer.md 5.1 and 7.1): a step to hop onto for a cache, a rooftop to double-jump onto for a hoard.
// They are data and nothing else, so world.ts can read them into the regions' obstacles without a cycle, and chests.ts can read the chest off each one
// (a chest stands in the middle of its perch, on its top: the two never disagree about where it is). Heights are the two authored in each band of 5.1:
// steps 0.6 and 1.0, rooftops 2.6 and 2.8. src/reach.test.ts proves the rest.
//
// Any region can hold one: world-view.ts, and since HOM-161 render.ts (Hale's clearing and the caves), cut a standable rock flat under a pale cap, so a step is seen
// wherever a chest stands on it. A cave's step is a low table, not in `tall`, so it never breaks sight.
export interface Perch {
  /** The chest that stands on it. */
  chest: string;
  tier: 'cache' | 'hoard';
  /** The region (world.ts) whose obstacles it joins: a cave's own room or corridor (hollow's throat, grotto's hold) for a dungeon's cache. */
  region: string;
  x: number; z: number;
  /** A step is 1.3 (the rule needs 1.2 to land on it), a rooftop 2.2 (it needs 2.0). */
  r: number;
  top: number;
}

const STEP_R = 1.3, ROOF_R = 2.2;
const cache = (chest: string, region: string, x: number, z: number, top: number): Perch => ({ chest, tier: 'cache', region, x, z, r: STEP_R, top });
const hoard = (chest: string, region: string, x: number, z: number, top: number): Perch => ({ chest, tier: 'hoard', region, x, z, r: ROOF_R, top });

export const PERCHES: Perch[] = [
  // Hale: the cache on the clearing's west edge, away from the road and the forge, and the hoard on the middle of its south edge, a watchtower in plain sight of the whole square
  cache('hale-cache-1', 'clearing', -27, -3, 0.6),
  hoard('hale-hoard-1', 'clearing', 2, 26, 2.8),
  cache('greywater-cache-1', 'greywater', 150, 40, 0.6),
  hoard('greywater-hoard-1', 'greywater', 440, -28, 2.6),
  cache('saltmarrow-cache-1', 'saltmarrow', 843, -20, 0.6),
  cache('saltmarrow-cache-2', 'saltmarrow', 838, 72, 1.0),
  hoard('saltmarrow-hoard-1', 'saltmarrow', 891, -15, 2.6),
  hoard('saltmarrow-hoard-2', 'saltmarrow', 888, -50, 2.8),
  cache('dunmere-cache-1', 'dunmere', 840, 450, 1.0),
  hoard('dunmere-hoard-1', 'dunmere', 921, 560, 2.8),
  cache('thornwick-cache-1', 'thornwick', 845, 1050, 0.6),
  cache('thornwick-cache-2', 'thornwick', 926, 950, 1.0),
  hoard('thornwick-hoard-1', 'thornwick', 890, 1006, 2.6),
  hoard('thornwick-hoard-2', 'thornwick', 916, 1065, 2.8),
  cache('barrowdowns-cache-1', 'barrowdowns', 1015, 1052, 0.6),
  hoard('barrowdowns-hoard-1', 'barrowdowns', 1270, 975, 2.6),
  hoard('barrowdowns-hoard-2', 'barrowdowns', 1444, 1039, 2.8),
  cache('highmoor-cache-1', 'highmoor', 1855, 960, 0.6),
  cache('highmoor-cache-2', 'highmoor', 1953, 946, 1.0),
  hoard('highmoor-hoard-1', 'highmoor', 1891, 1020, 2.6),
  hoard('highmoor-hoard-2', 'highmoor', 1958, 1066, 2.8),
  cache('cairnwaste-cache-1', 'cairnwaste', 1934, 140, 1.0),
  hoard('cairnwaste-hoard-1', 'cairnwaste', 2015, 500, 2.6),
  hoard('cairnwaste-hoard-2', 'cairnwaste', 1951, 656, 2.8),
  cache('spire-cache-1', 'spire', 2025, 50, 0.6),
  hoard('spire-hoard-1', 'spire', 1990, 45, 2.6),
  hoard('spire-hoard-2', 'spire', 1932, -44, 2.8),
  // A dungeon's cache: in a room, never a corridor (the Hollow's are 5 u wide and a step leaves a lane too narrow for an ogre to follow you out), and 2.7 u from every wall so
  // no body is wedged between the step and the stone. In four dungeons it is the corner of the boss's room on the door's wall, as far from the door as the wall goes, 17 u or more from him. The Hollow's hall is 22 u
  // square and has no such corner, so its cache is in the cavern, at the east end 10 u from the throat, and its stash moved into the hall (chests.ts).
  // The cavern's eight spawns are never more than 6 u off, so its cache is 5 u from the nearest.
  cache('hollow-cache-1', 'hollow', -8, -46, 0.6),
  cache('grotto-cache-1', 'hold', 895, -103, 1.0),
  cache('rotroot-cache-1', 'heart', 886, 1119, 0.6),
  cache('cairnhold-cache-1', 'chamber', 1901, 885, 1.0),
  cache('vault-cache-1', 'sanctum', 2013, -119, 0.6),
];

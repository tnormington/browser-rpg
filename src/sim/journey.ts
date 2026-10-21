// Wayfinding (HOM-134): how to get from where the player is standing to somewhere on the other side of the world, said in words.
//
// The tracker's arrow has always pointed straight at whatever is next, which is all a player needs while it is in the same field
// and no use at all when it is four regions away: an arrow through the sea is not a direction. This works out the chain of regions
// between the two by the regions' own `connections` (the same data routing and the seams are built from, so it can never disagree
// with the ground), and says it: the way to turn, the country to cross, and the name of the place at the end of it.
//
// Pure sim, and read-only: nothing here changes a quest, it only describes one.
import { Pt, regionAt, regionById } from './world';

/** The compass, as the world is laid out: +x is east (Saltmarrow is east of Hale) and +z is south (Thornwick is south of Saltmarrow). */
const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const heading = (dx: number, dz: number) => POINTS[Math.round(((Math.atan2(dx, -dz) / Math.PI) * 4 + 8) % 8) % 8];

/** The chain of region ids from one to another, fewest hops first, or null if they are not joined. Includes both ends. */
export function regionRoute(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const back = new Map<string, string>([[from, from]]);
  for (let edge = [from]; edge.length; ) {
    const next: string[] = [];
    for (const id of edge) for (const c of regionById(id).connections) {
      if (back.has(c.to)) continue;
      back.set(c.to, id);
      if (c.to === to) {
        const chain = [to];
        while (chain[0] !== from) chain.unshift(back.get(chain[0])!);
        return chain;
      }
      next.push(c.to);
    }
    edge = next;
  }
  return null;
}

/** The walkable seam between two regions that name each other. */
const seam = (a: string, b: string): Pt | undefined => regionById(a).connections.find(c => c.to === b)?.at;

/** How far from the target the tracker starts saying which way to walk rather than leaving it to the arrow. */
const FAR = 150;

/**
 * The way to `dest` from where the player stands, as one line for the tracker, or null when it is near enough or in the same
 * country that the arrow is answer enough. `Travel south through Dunmere Fens to Thornwick`.
 */
export function journeyTo(p: Pt, dest: Pt): string | null {
  const from = regionAt(p.x, p.z), to = regionAt(dest.x, dest.z);
  if (!from || !to || from === to) return null;
  if (Math.hypot(dest.x - p.x, dest.z - p.z) < FAR) return null;
  const chain = regionRoute(from.id, to.id);
  if (!chain || chain.length < 2) return null;
  // turn toward the first seam that is actually ahead of you: standing on one, the next leg is the one that says something
  const seams = chain.slice(1).map((id, i) => seam(chain[i], id)).filter((s): s is Pt => !!s);
  const aim = seams.find(sp => Math.hypot(sp.x - p.x, sp.z - p.z) > 25) ?? dest;
  const names = chain.slice(1).map(id => regionById(id).name);
  if (names.length === 1) return `Travel ${heading(aim.x - p.x, aim.z - p.z)} into ${names[0]}`;
  const via = names.slice(0, -1);
  const shown = via.length > 2 ? [...via.slice(0, 2), 'on'] : via;
  return `Travel ${heading(aim.x - p.x, aim.z - p.z)} through ${shown.join(', ')} to ${names[names.length - 1]}`;
}

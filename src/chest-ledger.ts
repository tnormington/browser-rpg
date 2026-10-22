// The chest ledger (HOM-157): what the world-map screen says about the hidden chests, a row per place. Pure, and read from saved chest state only
// (`player.chests` through chestCount): nothing here is a counter of its own. A place whose name is not yet earned reads "???", as an unfound town does on the map.
import type { GameState } from './sim';
import { PLACES, chestCount } from './sim/chests';
import { TOWNS, regionAt } from './sim/world';

export interface LedgerRow {
  id: string;
  /** The place's name, or null while it is not earned: the row is then a "???" with no count, so the map does not give away what a place holds before it is known. */
  name: string | null;
  opened: number;
  total: number;
  /** Every chest of the place is open. */
  done: boolean;
  /** The player is standing in it now. */
  here: boolean;
}

/**
 * A place is known once the player has opened a chest in it, found a flight master in it, or is standing in it. The sim keeps no record of where the player has
 * been, so a place walked through with nothing found and no town in it reads "???" again when they leave; a visited set in the sim would close that.
 */
export function chestLedger(s: GameState): LedgerRow[] {
  const p = s.player, here = regionAt(p.x, p.z)?.id;
  const townRegions = new Set(TOWNS.filter(t => s.found.includes(t.id)).map(t => regionAt(t.wake.x, t.wake.z)?.id));
  return PLACES.map(place => {
    const { opened, total } = chestCount(p, place.id);
    const isHere = !!here && place.regions.includes(here);
    const known = opened > 0 || isHere || place.regions.some(r => townRegions.has(r));
    return { id: place.id, name: known ? place.name : null, opened: known ? opened : 0, total: known ? total : 0, done: known && opened === total, here: isHere };
  });
}

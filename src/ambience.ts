import { REGIONS } from './sim/world';

/** Every cave room (Hollow, Grotto, Rotroot, Cairn Hold) shares one bed: no cave region has an entry above. */
const CAVE_BED = { file: 'cave-ambience', vol: 0.4 };
/** Looping beds by region id (a region with no entry is silent), and the level each plays at. */
const AMBIENCE: Record<string, { file: string; vol: number }> = {
  greywater: { file: 'road-ambience', vol: 0.35 },
  saltmarrow: { file: 'coast-ambience', vol: 0.4 },
  dunmere: { file: 'fen-ambience', vol: 0.4 },
  thornwick: { file: 'forest-ambience', vol: 0.4 },
  barrowdowns: { file: 'barrows-ambience', vol: 0.4 },
  highmoor: { file: 'moor-ambience', vol: 0.35 },
  cairnwaste: { file: 'cairnwaste-ambience', vol: 0.35 },
  spire: { file: 'spire-ambience', vol: 0.3 },   // quieter than the wastes: the one town with no one working in it
  grottoghost: CAVE_BED,   // a district over the Grotto's floor, but marked cave:false, so the cave check in bedFor misses it
  hale: { file: 'hale-ambience', vol: 0.35 },   // a zone key, not a region: ridge, clearing and seams all fall through to it
};
/** A region's own bed, else the cave bed, else its zone's: so a district (the Waysides, the Thornwood Seams) sounds like the land it sits in. */
export const bedFor = (id: string | null) => {
  const r = id ? REGIONS.find(x => x.id === id) : undefined;
  return !id ? undefined : AMBIENCE[id] ?? (r?.cave ? CAVE_BED : r && AMBIENCE[r.zone]);
};

// Every item, ability, talent and NPC the HUD draws has its art on disk, under the id art.ts looks it up by (HOM-135). A missing file
// is not a crash: the slot quietly falls back to the emoji it drew before the art existed, and a face is left off the panel.
// That silence is the point of this check - a new item, a renamed ability or a renamed vendor fails here instead of going
// unnoticed in the bag.
// Run with `npm run verify`.
import { existsSync } from 'node:fs';
import { ITEMS } from './sim/items';
import { ABILITIES, abilityArtId } from './sim/data';
import { TALENTS } from './sim/talents';
import { NPCS } from './sim/quest';
import { VENDORS } from './sim/shop';
import { FLIGHT_MASTERS } from './sim/flight';

let checks = 0;
const want = (file: string, who: string) => {
  if (!existsSync(file)) throw new Error(`FAIL: ${who} has no art at ${file}`);
  checks++;
};

for (const id of Object.keys(ITEMS)) want(`assets/art/items/${id}.webp`, id);
for (const a of ABILITIES) want(`assets/art/abilities/${abilityArtId(a)}.webp`, a.name);
for (const t of TALENTS) want(`assets/art/talents/${t.id}.webp`, t.name);
// the three sets of faces, each by the id its panel asks for: a quest giver plain, a merchant or trainer prefixed, a flight master by town
for (const n of NPCS) want(`assets/art/portraits/${n.id}.webp`, n.name);
for (const v of VENDORS) want(`assets/art/portraits/vendor_${v.id}.webp`, v.name);
for (const m of FLIGHT_MASTERS) want(`assets/art/portraits/flight_${m.id}.webp`, m.name);

console.log(`All ${checks} items, abilities, talents and NPCs have their art on disk.`);

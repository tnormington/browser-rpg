// Every region resolves to an ambience bed whose file exists: a region with no bed is silent by design, which is how Hale went unnoticed.
// Run with `npm run verify`.
import { existsSync } from 'node:fs';
import { REGIONS } from './sim/world';
import { bedFor } from './ambience';

const SILENT_ON_PURPOSE = new Set<string>([]);   // nothing is silent: the Vault's three rooms (HOM-112) are cave regions and share the cave bed

let checks = 0;
for (const r of REGIONS) {
  if (SILENT_ON_PURPOSE.has(r.id)) continue;
  const bed = bedFor(r.id);
  if (!bed) throw new Error(`FAIL: ${r.id} has no ambience bed`);
  if (!existsSync(`assets/audio/${bed.file}.ogg`)) throw new Error(`FAIL: ${r.id}: assets/audio/${bed.file}.ogg is missing`);
  checks++;
}
console.log(`All ${checks} regions have a bed on disk.`);

// HOM-191: the eight edge kinds each build, vary, and are the same every run. Run with `npm run verify`.
import { EDGE_KINDS, edgeRecipe, edgeKind } from './edges';

let failed = 0;
const check = (ok: boolean, what: string) => { if (!ok) { failed++; console.error('FAIL', what); } };

check(edgeKind('fence') === 'hedgerow', 'fence is the hedgerow');
for (const kind of EDGE_KINDS) {
  const r = edgeRecipe(kind);
  check(r.pieces.length >= 4, `${kind}: at least four variants`);
  check(r.pieces.every(p => p.layers.length > 0 && p.layers.every(l => l.geometry.attributes.position.count > 0)), `${kind}: every piece has drawable layers`);
  check(r.spacing[0] < r.spacing[1] && r.scale[0] < r.scale[1], `${kind}: spacing and scale are ranges, not a constant`);
  const sig = (rc: typeof r) => rc.pieces.map(p => p.layers.map(l => l.geometry.attributes.position.count).join('.')).join('|');
  check(new Set(r.pieces.map(p => p.layers.map(l => l.geometry.attributes.position.count).join('.'))).size > 1, `${kind}: variants differ`);
  check(edgeRecipe(kind) === r && sig(r) === sig(edgeRecipe(kind)), `${kind}: cached`);
}
if (failed) { console.error(`${failed} edge checks failed`); process.exit(1); }
console.log('edges: ok');

// HOM-190: the edge of the world is data (sim/edges.ts), and it must not read as "a uniform wall of stones". This holds the placer to the board's own
// sentence: every open face has a kind, nothing about a piece is regular, the same world comes out every run, and no piece stands on a floor or in a way
// through. Run with `npm run verify`.
import { REGIONS } from './sim/world';
import { EDGES, EDGE_KEEP_CLEAR, buildEdges, edgeRuns, floors, type EdgePiece, type EdgeKind } from './sim/edges';
import { EDGE_KINDS } from './edges';
import { edgeStyles } from './edge-styles';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const STYLES = edgeStyles(), pieces = buildEdges(STYLES), runs = edgeRuns();
const spread = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); return sd / m; };

console.log('the table');
{
  const ids = new Set(REGIONS.map(r => r.id));
  assert(Object.keys(EDGES).every(id => ids.has(id)), 'every region the table names exists');
  assert(Object.values(EDGES).every(e => [e.faces, ...Object.values(e.rects ?? {})].every(f => Object.values(f).every(k => k in STYLES))), 'every kind it names has a style');
  const own = new Set(floors(REGIONS));
  const open = REGIONS.filter(r => !r.cave && r.footprint.some(f => own.has(f)));
  assert(open.every(r => EDGES[r.id]), `every land region with a floor of its own has an edge (${open.length})`);
  const faces = (id: string) => new Set(runs.filter(r => r.region === id).map(r => r.kind));
  assert(faces('clearing').size >= 3, `Hale's four faces use at least three kinds (${[...faces('clearing')].join(', ')})`);
  assert(runs.every(r => r.kind), 'no open run is left without a kind');
  for (const r of open) assert(runs.some(x => x.region === r.id), `${r.id} has open ground to dress`);
  assert(new Set(runs.map(r => r.kind)).size === EDGE_KINDS.length, 'every kind in the vocabulary is used somewhere');
}

console.log('\nthe same world every run');
{
  const again = buildEdges(STYLES);
  assert(again.length === pieces.length && JSON.stringify(again) === JSON.stringify(pieces), `${pieces.length} pieces, identical on a second build`);
}

console.log('\nways through stay clear, and floors stay clear');
{
  const floors = REGIONS.filter(r => !r.district).flatMap(r => r.footprint);
  // a piece's body reaches about 0.8: none stands on a floor, whichever floor it is
  const onFloor = pieces.filter(p => floors.some(f => p.x > f.x0 + 0.05 && p.x < f.x1 - 0.05 && p.z > f.z0 + 0.05 && p.z < f.z1 - 0.05));
  assert(onFloor.length === 0, 'no piece stands on any region\'s floor');
  const throat = REGIONS.find(r => r.id === 'throat')!.footprint[0];
  assert(!pieces.some(p => p.x > throat.x0 - 0.5 && p.x < throat.x1 + 0.5 && p.z < -29), 'the cave mouth\'s throat has no piece in it or at its lips');
  const corridor = REGIONS.find(r => r.id === 'greywater')!.footprint[0];
  assert(!pieces.some(p => p.x > corridor.x0 && p.z > corridor.z0 - 0.5 && p.z < corridor.z1 + 0.5 && p.x < 36 && p.x > 30.5 && p.z > corridor.z0 && p.z < corridor.z1), 'the gate corridor is clear');
  assert(!pieces.some(p => EDGE_KEEP_CLEAR.some(k => Math.hypot(p.x - k.x, p.z - k.z) < k.r)), 'the gate posts have their room');
  assert(!pieces.some(p => p.x > 29.5 && p.x < 33 && p.z > 4.3 && p.z < 11.7), 'the east gate\'s six-unit gap is open');
}

console.log('\nnothing uniform');
{
  for (const face of ['s', 'n', 'w', 'e'] as const) {
    const run = runs.filter(r => r.region === 'clearing' && r.face === face).sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    const mine = pieces.filter(p => p.kind === run.kind && (face === 's' || face === 'n' ? Math.abs(p.az - run.line) < 0.01 : Math.abs(p.ax - run.line) < 0.01) && p.rank === 0);
    const along = (p: EdgePiece) => (face === 's' || face === 'n' ? p.ax : p.az);
    const gaps = mine.map(along).sort((a, b) => a - b).map((v, i, a) => v - a[i - 1]).slice(1);
    const distinct = (f: (p: EdgePiece) => number) => new Set(mine.map(p => f(p).toFixed(3))).size;
    assert(mine.length >= 6, `Hale ${face} (${run.kind}): ${mine.length} pieces in the front rank`);
    assert(spread(gaps) > 0.15, `Hale ${face}: spacing varies (spread ${spread(gaps).toFixed(2)})`);
    assert(distinct(p => p.scale) >= mine.length * 0.7, `Hale ${face}: sizes vary (${distinct(p => p.scale)} of ${mine.length})`);
    assert(STYLES[run.kind].along || distinct(p => p.rot) >= mine.length * 0.8, `Hale ${face}: turns vary`);
    assert(distinct(p => p.tone) >= mine.length * 0.8, `Hale ${face}: colours vary`);
    assert(new Set(mine.map(p => p.variant)).size >= Math.min(2, STYLES[run.kind].variants), `Hale ${face}: more than one shape`);
  }
  for (const kind of EDGE_KINDS as readonly EdgeKind[]) {
    const st = STYLES[kind], mine = pieces.filter(p => p.kind === kind);
    if (st.ranks > 1) assert(new Set(mine.map(p => p.rank)).size === st.ranks, `${kind}: ${st.ranks} ranks deep`);
    assert(mine.every(p => p.variant >= 0 && p.variant < st.variants), `${kind}: every variant is one of its ${st.variants}`);
  }
}

console.log('\ncost');
{
  // what the renderer ever has in range: the whole world is thousands of pieces, and the bench measures the few hundred that matter
  assert(pieces.length < 8000, `${pieces.length} pieces in the whole world`);
}

console.log(`\n${checks} checks passed`);

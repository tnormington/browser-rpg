// Navigation tests: the region model and the routing layer over it (sim/world.ts, sim/path.ts). Plain Node, no DOM.
import { COLLIDERS, FOOTPRINT, REGIONS, PLAYER_RADIUS, ROCKS, CAVE_ROCKS, TREES, Pt, clampToWorld, inCave, regionAt, setWorldHalf, addScenery } from './world';
import { route, segmentClear } from './path';
import { createNodes } from './gathering';
import { nextRandom } from './rng';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  console.log('  ok  ' + msg);
}
const ms = (f: () => void, n = 1) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n; };
const walks = (from: Pt, pts: Pt[]) => pts.every((p, i) => segmentClear(i ? pts[i - 1] : from, p));
const length = (from: Pt, pts: Pt[]) => pts.reduce((sum, p, i) => sum + Math.hypot(p.x - (i ? pts[i - 1] : from).x, p.z - (i ? pts[i - 1] : from).z), 0);
const inFootprint = (rects: { x0: number; x1: number; z0: number; z1: number }[], p: Pt) => rects.some(f => p.x >= f.x0 && p.x <= f.x1 && p.z >= f.z0 && p.z <= f.z1);

console.log('\n# the world is region data');
assert(REGIONS.map(r => r.id).join() === 'ridge,clearing,throat,hollow,neck,hall', 'the world is the ridge, the clearing and the four cave rooms, in node-id order');
assert(REGIONS.every(r => r.connections.every(c => REGIONS.find(o => o.id === c.to)?.connections.some(b => b.to === r.id))), 'connections are symmetric and name real regions');
assert(REGIONS.every(r => r.connections.every(c => {
  const there = REGIONS.find(o => o.id === c.to)!, snapped = clampToWorld(c.at);
  return inFootprint(r.footprint, c.at) && inFootprint(there.footprint, c.at) && snapped.x === c.at.x && snapped.z === c.at.z;
})), 'every seam point is floor in both of the regions it joins');
assert(regionAt(0, 0)?.id === 'clearing' && regionAt(-18, -55)?.id === 'hollow' && regionAt(-18, -85)?.id === 'hall' && regionAt(100, 100) === null, 'regionAt names the region a point is in, and null off the map');
const nodes = createNodes();
assert(nodes.length === 24 && nodes.slice(0, 7).every(n => n.type === 'iron' || n.type === 'coal') && nodes.slice(7, 19).every(n => n.type === 'tree') && nodes.slice(19).every(n => n.type === 'mithril' || n.type === 'coal'), 'node ids are as they were: 7 ridge ores, 12 trees, 5 cave veins');
assert(nodes[0].x === -10 && nodes[0].z === -25.5 && nodes[7].x === -12 && nodes[7].z === 10 && nodes[19].x === -29.2 && nodes[19].z === -45.5 && nodes[23].x === -8.2, 'and the same node sits at each id');
assert(ROCKS.length === 7 && CAVE_ROCKS.length === 5 && TREES.length === 12 && COLLIDERS.length === 4 + 3 + 7 + 12 + 7 + 5, 'the flat lists the renderer reads hold what they always did');

console.log('\n# routing');
const spot = (x: number, z: number): Pt => ({ x, z });
const SPOTS: [string, Pt][] = [
  ['the clearing', spot(0, 8)], ['the east side', spot(26, 4)], ['the throat', spot(-18, -35)], ["the hollow's west", spot(-30, -60)],
  ["the hollow's east", spot(-8, -60)], ['the neck', spot(-18, -68)], ['the hall', spot(-10, -90)], ["the hall's west", spot(-27, -80)],
];
for (const [, p] of SPOTS) assert(COLLIDERS.every(o => Math.hypot(p.x - o.x, p.z - o.z) > o.r + PLAYER_RADIUS), `(${p.x}, ${p.z}) is open floor`);
let worst = 0;
for (const [an, a] of SPOTS) {
  for (const [bn, b] of SPOTS) {
    if (a === b) continue;
    const r = route(a, b);
    assert(r !== null && r[r.length - 1] === b && walks(a, r), `${an} -> ${bn}: a route that ends at the goal and never leaves the floor or enters scenery`);
    worst = Math.max(worst, length(a, r) / Math.hypot(a.x - b.x, a.z - b.z));
  }
}
assert(worst < 2.2, `no route is more than ${worst.toFixed(2)}x the straight-line distance (the cave is a corridor, so some detour is real)`);
assert(route(spot(0, 8), spot(5, 8))!.length === 1, 'a clear line is one leg');
{
  const a = spot(-10, -90), b = spot(0, 8), r = route(a, b)!, back = route(b, a)!;
  assert(Math.abs(length(a, r) - length(b, back)) < 1.5, 'a route out of the deepest room and the way back are the same length');
  for (const [name, from] of SPOTS.filter(([n]) => /hall|hollow|neck|throat/.test(n))) {
    const out = route(from, spot(0, 8));
    assert(out !== null && walks(from, out), `out of the cave from ${name}`);
  }
}
{
  // a goal inside a rock (a node): approached, and the walk ends at the goal
  const rock = ROCKS[1], goal = { x: rock.x, z: rock.z }, from = spot(-3, 8);
  const r = route(from, goal)!;
  assert(r !== null && r[r.length - 1] === goal, 'a goal inside a rock is still routed to');
  assert(walks(from, r.slice(0, -1)) && Math.hypot(r[r.length - 2].x - goal.x, r[r.length - 2].z - goal.z) < rock.r + 1.5, 'and the walk up to the last leg is clear, ending beside the rock');
  const vein = CAVE_ROCKS[0], cave = route(spot(0, 8), { x: vein.x, z: vein.z });
  assert(cave !== null && walks(spot(0, 8), cave.slice(0, -1)), 'a vein deep in the cave is reachable from the clearing');
}
{
  // unreachable: a goal sealed in by a ring of scenery, and the warden's hall cut off by a plug in the neck
  const sealed = Array.from({ length: 16 }, (_, k) => ({ x: 15 + 3 * Math.cos(k * Math.PI / 8), z: 15 + 3 * Math.sin(k * Math.PI / 8), r: 1.2 }));
  COLLIDERS.push(...sealed);
  assert(route(spot(0, 8), { x: 15, z: 15 }) === null, 'a goal walled in by scenery is unreachable');
  assert(route({ x: 15, z: 15 }, spot(0, 8)) === null, 'and so is a start walled in');
  assert(route(spot(0, 8), spot(26, 4)) !== null, 'the rest of the world still routes');
  COLLIDERS.splice(COLLIDERS.indexOf(sealed[0]), sealed.length);
  assert(route(spot(0, 8), { x: 15, z: 15 }) !== null, 'and taking the ring away opens it again');
  const plug = { x: -18, z: -68, r: 3.2 };
  COLLIDERS.push(plug);
  assert(route(spot(0, 8), spot(-10, -90)) === null && route(spot(0, 8), spot(-18, -50)) !== null, 'a plugged neck cuts the hall off and nothing else');
  COLLIDERS.splice(COLLIDERS.indexOf(plug), 1);
}
{
  // a spread of random open-floor pairs across the whole map: every one routes, and every route is walkable
  const box = { rng: 4242 }, pick = (): Pt => {
    for (;;) {
      const f = FOOTPRINT[Math.floor(nextRandom(box) * FOOTPRINT.length)];
      const p = { x: f.x0 + 1 + nextRandom(box) * (f.x1 - f.x0 - 2), z: f.z0 + 1 + nextRandom(box) * (f.z1 - f.z0 - 2) };
      if (COLLIDERS.every(o => Math.hypot(p.x - o.x, p.z - o.z) > o.r + PLAYER_RADIUS + 0.3)) return p;
    }
  };
  let bad = 0;
  for (let i = 0; i < 300; i++) { const a = pick(), b = pick(), r = route(a, b); if (!r || r[r.length - 1] !== b || !walks(a, r)) bad++; }
  assert(bad === 0, 'three hundred random pairs anywhere on the map all route, over walkable legs');
  assert(inCave(-18, -85) && !inCave(0, 8), 'inCave still reads the cave regions');
}

console.log('\n# cost');
{
  const a = spot(-10, -90), b = spot(0, 8);
  const report = (label: string) => {
    const cold = ms(() => { COLLIDERS.push({ x: 1e4, z: 1e4, r: 1 }); route(a, b); COLLIDERS.pop(); }); // a changed world: grid rebuilt, then one long route
    const warm = ms(() => route(a, b), 20);
    const open = ms(() => route(spot(-3, 8), spot(26, 4)), 200);
    const unreachable = ms(() => route(a, { x: 1e4, z: 1e4 }), 20);
    const ext = FOOTPRINT.reduce((m, f) => ({ x0: Math.min(m.x0, f.x0), x1: Math.max(m.x1, f.x1), z0: Math.min(m.z0, f.z0), z1: Math.max(m.z1, f.z1) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
    const cells = Math.round(((ext.x1 - ext.x0) / 0.25) * ((ext.z1 - ext.z0) / 0.25));
    console.log(`  nav ${label}: ${COLLIDERS.length} colliders, ~${Math.round(cells / 1000)}k cells; rebuild+long route ${cold.toFixed(1)}ms, long route (hall to clearing) ${warm.toFixed(2)}ms, clear-line click ${open.toFixed(3)}ms, unreachable ${unreachable.toFixed(3)}ms`);
    return { cold, warm };
  };
  const one = report('1x');
  // 4x the clearing's area (twice the side) with 4x the scenery, as the stress knob builds it
  const box = { rng: 99 };
  setWorldHalf(60);
  for (let i = 0; i < 36; i++) addScenery('clearing', { x: (nextRandom(box) * 2 - 1) * 55, z: (nextRandom(box) * 2 - 1) * 55, r: 1 });
  const four = report('4x');
  assert(one.warm < 50 && four.warm < 100, `a long route stays a fraction of a frame: ${one.warm.toFixed(1)}ms now, ${four.warm.toFixed(1)}ms at four times the clearing`);
  assert(route(a, b) !== null && route(a, spot(55, 55)) !== null, 'and the bigger world still routes everywhere');
}
console.log(`\nAll ${checks} navigation checks passed.`);

// Navigation tests: the region model and the routing layer over it (sim/world.ts, sim/path.ts). Plain Node, no DOM.
import {
  COLLIDERS, FOOTPRINT, REGIONS, SAFE_ZONES, PLAYER_RADIUS, ROCKS, CAVE_ROCKS, TREES, GREYWATER, SALTMARROW, LANDMARKS,
  Pt, clampToWorld, collidersAt, collidersIn, inCave, inSafeZone, regionAt, setWorldHalf, addScenery,
} from './world';
import { route, segmentClear, gridStats, setGridBudget, evictGrids } from './path';
import { createNodes } from './gathering';
import { SPAWNS } from './data';
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
const spot = (x: number, z: number): Pt => ({ x, z });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

console.log('\n# the world is region data');
assert(REGIONS.map(r => r.id).join() === 'ridge,clearing,throat,hollow,neck,hall,greywater,saltmarrow', 'the world is Hale (ridge, clearing, four cave rooms), then the road, then Saltmarrow, in node-id order');
assert(REGIONS.every(r => r.connections.every(c => REGIONS.find(o => o.id === c.to)?.connections.some(b => b.to === r.id))), 'connections are symmetric and name real regions');
assert(REGIONS.every(r => r.connections.every(c => {
  const there = REGIONS.find(o => o.id === c.to)!, snapped = clampToWorld(c.at);
  return inFootprint(r.footprint, c.at) && inFootprint(there.footprint, c.at) && snapped.x === c.at.x && snapped.z === c.at.z;
})), 'every seam point is floor in both of the regions it joins');
assert(regionAt(0, 0)?.id === 'clearing' && regionAt(-18, -55)?.id === 'hollow' && regionAt(-18, -85)?.id === 'hall' && regionAt(436, 8)?.id === 'greywater' && regionAt(906, 8)?.id === 'saltmarrow' && regionAt(100, 200) === null, 'regionAt names the region a point is in, and null off the map');
const nodes = createNodes();
assert(nodes.length === 29 && nodes.slice(0, 7).every(n => n.type === 'iron' || n.type === 'coal') && nodes.slice(7, 19).every(n => n.type === 'tree') && nodes.slice(19, 24).every(n => n.type === 'mithril' || n.type === 'coal') && nodes.slice(24).every(n => n.type === 'adamant'),
  'node ids are as they were (7 ridge ores, 12 trees, 5 cave veins), with Saltmarrow\'s five adamant veins added after them');
assert(nodes[0].x === -10 && nodes[0].z === -25.5 && nodes[7].x === -12 && nodes[7].z === 10 && nodes[19].x === -29.2 && nodes[19].z === -45.5 && nodes[23].x === -8.2, 'and the same node sits at each old id');
assert(ROCKS.length === 7 && CAVE_ROCKS.length === 5 && TREES.length === 12, 'the flat lists the renderer reads hold what they always did for Hale');
const SCENERY = REGIONS.reduce((n, r) => n + r.obstacles.length + r.trees.length + r.rocks.length, 0);
assert(COLLIDERS.length === SCENERY, `every region's scenery is a collider: ${COLLIDERS.length} of them across ${REGIONS.length} regions`);
assert(COLLIDERS.every(o => REGIONS.some(r => inFootprint(r.footprint, o))), 'and every one stands on some region\'s floor');

console.log('\n# Hale\'s east gate, the road and Saltmarrow');
{
  const wall = (z: number) => clampToWorld({ x: 31, z }, 0.5).x; // push a point past the clearing's east wall: does it get through?
  assert(wall(8) >= 30.9 && wall(6) >= 30.9 && wall(10) >= 30.9, 'the gate at (30, 8) lets you through the east wall');
  assert(wall(3) <= 29.5 + 1e-9 && wall(12) <= 29.5 + 1e-9 && wall(-20) <= 29.5 + 1e-9 && wall(24) <= 29.5 + 1e-9, 'and the rest of that wall holds: a gap of 6 units, clear of the tree at (22, 12) and the forge');
  assert(!COLLIDERS.some(o => dist(o, spot(30, 8)) < o.r + 4), 'nothing stands in or at the gate');
  const road = REGIONS.find(r => r.id === 'greywater')!, salt = REGIONS.find(r => r.id === 'saltmarrow')!;
  const w = road.footprint[1];
  assert(Math.round(w.x1 - w.x0) === 810 && Math.round(w.z1 - w.z0) === 120 && w.x0 - 400 + 400 === GREYWATER.x - 400, 'Greywater Road is 800 x 120 (and ten units of overlap into Saltmarrow), east of Hale');
  assert(inFootprint(salt.footprint, spot(SALTMARROW.x + 50, SALTMARROW.z)) && !inFootprint(salt.footprint, spot(SALTMARROW.x + 50, SALTMARROW.z + 20)), 'Saltmarrow has a quay: a walkable strip out over the water');
  assert(LANDMARKS.quayEnd.x > SALTMARROW.x + 40 && inFootprint(salt.footprint, LANDMARKS.quayEnd), 'the quay is there for the flight master and the fishing spots to go on');
}

console.log('\n# safe zones');
{
  assert(SAFE_ZONES.length === 2 && inSafeZone(20, -8) && inSafeZone(SALTMARROW.x - 25, SALTMARROW.z) && !inSafeZone(0, 0) && !inSafeZone(0, -20) && !inSafeZone(GREYWATER.x, GREYWATER.z), 'Hale (the forge yard) and Saltmarrow (its square) have safe ground; the middle of the clearing, the road and the Hollow do not');
  const zone = (r: string) => REGIONS.find(x => x.id === r)!.safe![0];
  assert(zone('saltmarrow').r === 35, "Saltmarrow's is 35 across, as the bible asks (Hale's are small: its enemies stand in the square itself)");
  assert(SPAWNS.every(sp => !inSafeZone(sp.x, sp.z)), 'no enemy is placed inside a safe square');
  assert(SPAWNS.every(sp => SAFE_ZONES.every(z => dist(sp, z) >= z.r + 2.5)), 'and none stands within two and a half units of the edge of one');
  const sm = zone('saltmarrow');
  assert(dist(LANDMARKS.harbourmaster, sm) < sm.r && dist(LANDMARKS.harbourVendor, sm) < sm.r && dist(LANDMARKS.inn, sm) < sm.r, 'the harbourmaster, the vendor and the inn are all inside it');
  assert(SPAWNS.filter(sp => sp.x > 800).every(sp => regionAt(sp.x, sp.z)?.id === 'saltmarrow') && SPAWNS.filter(sp => sp.x > 30 && sp.x < 800).every(sp => regionAt(sp.x, sp.z)?.id === 'greywater'), 'every new enemy stands in the region that owns it');
}

console.log('\n# the collider index');
{
  const box = { rng: 31337 };
  const world = (): Pt => { const f = FOOTPRINT[Math.floor(nextRandom(box) * FOOTPRINT.length)]; return { x: f.x0 + nextRandom(box) * (f.x1 - f.x0), z: f.z0 + nextRandom(box) * (f.z1 - f.z0) }; };
  let missed = 0, scanned = 0;
  for (let i = 0; i < 3000; i++) {
    const p = world(), near = collidersAt(p.x, p.z);
    scanned += near.length;
    for (const o of COLLIDERS) if (dist(o, p) < o.r + 3.5 && !near.includes(o)) missed++;
  }
  assert(missed === 0, 'collidersAt finds every collider a body of radius 3 could touch, at three thousand places across the world');
  assert(scanned / 3000 < 12, `...and looks at ${(scanned / 3000).toFixed(1)} colliders on average, not all ${COLLIDERS.length}`);
  const a = spot(100, 8), b = spot(700, 8), mid = collidersIn(a.x, a.z, b.x, b.z);
  assert(COLLIDERS.filter(o => o.x > 90 && o.x < 710 && Math.abs(o.z - 8) < 3).every(o => mid.includes(o)), 'collidersIn covers a segment\'s whole length');
}

console.log('\n# routing');
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

console.log('\n# routing across regions: Hale -> the road -> Saltmarrow, with no transition');
const FAR: [string, Pt][] = [
  ['the clearing', spot(0, 6)], ['the road by the gate', spot(60, 8)], ['the road, mid-way', spot(GREYWATER.x, GREYWATER.z)], ['the road by Old Grey', spot(GREYWATER.x + 320, GREYWATER.z - 20)],
  ['the town square', spot(SALTMARROW.x - 25, SALTMARROW.z + 2)], ['the quay end', spot(SALTMARROW.x + 60, SALTMARROW.z)], ['the Strand', spot(SALTMARROW.x + 5, SALTMARROW.z + 40)], ['the adamant cliffs', spot(SALTMARROW.x - 5, SALTMARROW.z - 58)],
];
for (const [, p] of FAR) assert(COLLIDERS.every(o => Math.hypot(p.x - o.x, p.z - o.z) > o.r + PLAYER_RADIUS), `(${p.x}, ${p.z}) is open floor`);
for (const [an, a] of FAR) {
  for (const [bn, b] of FAR) {
    if (a === b) continue;
    const r = route(a, b);
    assert(r !== null && r[r.length - 1] === b && walks(a, r) && length(a, r) < dist(a, b) * 1.6 + 30, `${an} -> ${bn}: a walkable route, no longer than ${(1.6).toFixed(1)}x the crow flies`);
  }
}
{
  const a = spot(0, -10), b = spot(60, 8), r = route(a, b)!;
  assert(!segmentClear(a, b) && r.some(p => p.x >= 28 && p.x <= 44 && p.z >= 5 && p.z <= 11), 'from the clearing\'s open side to the road the way goes through the gate, not through the wall');
  const hall = spot(-10, -90), quay = spot(SALTMARROW.x + 60, SALTMARROW.z), far = route(hall, quay)!;
  assert(far !== null && walks(hall, far) && far[far.length - 1] === quay, 'all the way from the Warden\'s Hall to the end of Saltmarrow\'s quay is one route, through the cave, the clearing, the gate and the road');
  assert(route(spot(0, 6), spot(GREYWATER.x, GREYWATER.z))!.length <= 2, 'and down the open road it is a line of one or two legs, however long');
}
{
  // a plug across the whole road (a wall of scenery the width of the floor) cuts Saltmarrow off, and nothing else
  const z0 = GREYWATER.z - 59, plug = Array.from({ length: 60 }, (_, i) => ({ x: GREYWATER.x + 100, z: z0 + i * 2, r: 1.5 }));
  COLLIDERS.push(...plug);
  assert(route(spot(0, 6), spot(GREYWATER.x + 200, GREYWATER.z)) === null && route(spot(0, 6), spot(GREYWATER.x - 50, GREYWATER.z)) !== null, 'a barricade across the road cuts off what is behind it and nothing in front');
  COLLIDERS.splice(COLLIDERS.indexOf(plug[0]), plug.length);
  assert(route(spot(0, 6), spot(GREYWATER.x + 200, GREYWATER.z)) !== null, 'and clearing it opens the road again');
}
{
  // grids are built lazily, and let go of when the budget is tight
  evictGrids();
  assert(gridStats().zones.length === 0, 'no grid exists until a search needs one');
  route(spot(0, 8), spot(26, 4)); // clear line: no search
  assert(gridStats().zones.length === 0, 'a clear line never builds one');
  route(spot(-10, -90), spot(0, 8));
  assert(gridStats().zones.join() === 'hale', 'a search in Hale builds Hale\'s grid and only that');
  const before = gridStats();
  route(spot(-10, -90), spot(SALTMARROW.x + 60, SALTMARROW.z));
  assert(gridStats().zones.includes('hale') && !gridStats().zones.includes('greywater'), 'a walk down a clear road is still no search of the road: only the legs that need one build a grid');
  const detour = spot(GREYWATER.x - 100, GREYWATER.z);
  const block = { x: GREYWATER.x - 150, z: GREYWATER.z, r: 3 }; // a boulder in the middle of the road
  addScenery('greywater', block);
  assert(route(spot(GREYWATER.x - 200, GREYWATER.z), detour) !== null && gridStats().zones.includes('greywater'), 'a boulder in the road makes the road search its grid');
  setGridBudget(Math.round(before.cells * 1.1));
  route(spot(SALTMARROW.x - 40, SALTMARROW.z - 55), spot(SALTMARROW.x + 20, SALTMARROW.z + 60)); // a search inside Saltmarrow
  const held = gridStats();
  assert(held.cells <= held.budget || held.zones.length === 1, `with room for ${held.budget} cells the grids held are ${held.cells} (${held.zones.join(', ')}): the oldest were evicted`);
  assert(route(spot(0, 8), spot(-10, -90)) !== null && route(spot(GREYWATER.x - 200, GREYWATER.z), detour) !== null, 'and an evicted zone is simply rebuilt on the next click');
  setGridBudget(600_000);
  // take the boulder out again
  const i = COLLIDERS.indexOf(block); COLLIDERS.splice(i, 1);
  const r = REGIONS.find(x => x.id === 'greywater')!; r.obstacles.splice(r.obstacles.indexOf(block), 1);
  assert(route(spot(GREYWATER.x - 200, GREYWATER.z), detour)!.length === 1, 'and with it gone the road is one line again');
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
  for (let i = 0; i < 400; i++) { const a = pick(), b = pick(), r = route(a, b); if (!r || r[r.length - 1] !== b || !walks(a, r)) bad++; }
  assert(bad === 0, 'four hundred random pairs anywhere on the map (cave to quay) all route, over walkable legs');
  assert(inCave(-18, -85) && !inCave(0, 8) && !inCave(GREYWATER.x, GREYWATER.z), 'inCave still reads the cave regions');
}

console.log('\n# cost');
{
  const hall = spot(-10, -90), clearing = spot(0, 8), quay = spot(SALTMARROW.x + 60, SALTMARROW.z), roadEnd = spot(GREYWATER.x + 300, GREYWATER.z);
  const report = (label: string) => {
    const cold = ms(() => { evictGrids(); route(hall, clearing); }); // nothing cached: build Hale's grid, then one long route
    const warm = ms(() => route(hall, clearing), 20);
    const open = ms(() => route(spot(-3, 8), spot(26, 4)), 200);
    const unreachable = ms(() => route(hall, { x: 1e4, z: 1e4 }), 20);
    const longRoad = ms(() => route(clearing, roadEnd), 200);                      // click on the far end of the road: one clear line
    const crossAll = ms(() => route(hall, quay), 20);                                // from the deepest cave room to the quay: Hale's grid, then lines
    const block = { x: GREYWATER.x + 150, z: GREYWATER.z, r: 3 }; addScenery('greywater', block);
    const coldRoad = ms(() => { evictGrids(); route(spot(GREYWATER.x + 100, GREYWATER.z), spot(GREYWATER.x + 200, GREYWATER.z)); }); // a boulder to go round: build the road's grid, search it
    const warmRoad = ms(() => route(spot(GREYWATER.x + 100, GREYWATER.z), spot(GREYWATER.x + 200, GREYWATER.z)), 50);
    const wideRoad = ms(() => route(spot(GREYWATER.x - 200, GREYWATER.z - 50), spot(GREYWATER.x + 380, GREYWATER.z + 50)), 20); // 580 units, corner to corner, round everything
    const i = COLLIDERS.indexOf(block); COLLIDERS.splice(i, 1);
    const reg = REGIONS.find(x => x.id === 'greywater')!; reg.obstacles.splice(reg.obstacles.indexOf(block), 1);
    const st = gridStats();
    console.log(`  nav ${label}: ${COLLIDERS.length} colliders. Hale: rebuild+long route (hall to clearing) ${cold.toFixed(1)}ms, long route ${warm.toFixed(2)}ms, clear-line click ${open.toFixed(3)}ms, unreachable ${unreachable.toFixed(3)}ms`);
    console.log(`  nav ${label}: the road: click 300 along it ${longRoad.toFixed(3)}ms (a line); hall -> quay ${crossAll.toFixed(2)}ms; round a boulder cold ${coldRoad.toFixed(1)}ms, warm ${warmRoad.toFixed(3)}ms; 580 units corner to corner ${wideRoad.toFixed(2)}ms; grids held: ${st.zones.join(', ')} (${Math.round(st.cells / 1000)}k cells)`);
    return { cold, warm, longRoad, crossAll, wideRoad };
  };
  const one = report('1x');
  // 4x the clearing's area (twice the side) with 4x the scenery, as the stress knob builds it
  const box = { rng: 99 };
  setWorldHalf(60);
  for (let i = 0; i < 36; i++) addScenery('clearing', { x: (nextRandom(box) * 2 - 1) * 55, z: (nextRandom(box) * 2 - 1) * 55, r: 1 });
  const four = report('4x');
  assert(one.warm < 50 && four.warm < 100, `a long route stays a fraction of a frame: ${one.warm.toFixed(1)}ms now, ${four.warm.toFixed(1)}ms at four times the clearing`);
  assert(one.longRoad < 1 && one.crossAll < 50 && one.wideRoad < 50, `and so does the road: a click along it costs ${one.longRoad.toFixed(3)}ms, one all the way from the cave to the quay ${one.crossAll.toFixed(1)}ms`);
  assert(route(hall, clearing) !== null && route(hall, spot(55, 55)) !== null, 'and the bigger world still routes everywhere');
}
console.log(`\nAll ${checks} navigation checks passed.`);

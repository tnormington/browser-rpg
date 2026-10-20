// HOM-95: the Barrowdowns and Highmoor: the two regions, the nine new enemies, the three gates, stormiron, the fourth town and the road from Thornwick.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ENEMY_TYPES, SPAWNS } from './sim/data';
import { DROP_TABLES, ITEMS } from './sim/items';
import {
  REGIONS, GATES, BARROWDOWNS, HIGHMOOR, THORNWICK, LANDMARKS, TOWNS, SAFE_ZONES, COLLIDERS, regionAt, regionById, inSafeZone, nearestTown,
} from './sim/world';
import { route, evictGrids } from './sim/path';
import { createNodes, NODE_TYPES, beginGather } from './sim/gathering';
import { RECIPES } from './sim/crafting';
import { flightPrice, flightSeconds, masterById, FLIGHT_MASTERS } from './sim/flight';
import { xpForLevel } from './sim/xp';
import { refreshPlayerStats } from './sim/combat';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => { for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i); };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A new game with every enemy laid low for good (this is about the ground, not the fight), the player at combat `level`. */
function quiet(level = 1): GameState {
  const s = createState(9500);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  return s;
}
const gateEvent = (s: GameState) => s.events.find(e => e.t === 'gate') as Extract<GameState['events'][number], { t: 'gate' }> | undefined;
const CAIRN = GATES.find(g => g.id === 'cairnhold')!, NORTH = GATES.find(g => g.id === 'cairnwaste')!, HOBB = GATES.find(g => g.id === 'barrowdowns')!;
const bar = regionById('barrowdowns'), high = regionById('highmoor');

// ---------------------------------------------------------------------------
section('the regions: sizes, seams and where they stand');
{
  const bmain = bar.footprint[0], hmain = high.footprint[0];
  assert(bmain.x1 - bmain.x0 === 900 && bmain.z1 - bmain.z0 === 140, 'the Barrowdowns are 900 x 140');
  assert(hmain.x1 - hmain.x0 === 140 && hmain.z1 - hmain.z0 === 140, 'Highmoor is 140 x 140');
  assert(bar.zone === 'barrowdowns' && high.zone === 'highmoor', 'each has a routing zone of its own');
  assert(regionAt(BARROWDOWNS.x, BARROWDOWNS.z)?.id === 'barrowdowns' && regionAt(HIGHMOOR.x, HIGHMOOR.z)?.id === 'highmoor', 'regionAt names them');
  const open = (x: number, z: number) => REGIONS.some(r => r.footprint.some(f => x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1));
  assert(open(HIGHMOOR.x - 66, HIGHMOOR.z - 60) && open(HIGHMOOR.x - 66, HIGHMOOR.z + 60), 'the Barrowdowns and Highmoor overlap across the whole width: the road\'s east end is soft');
  assert(open(THORNWICK.x + 72, THORNWICK.z) && !open(THORNWICK.x + 72, THORNWICK.z + 10) && !open(THORNWICK.x + 72, THORNWICK.z - 10), 'leaving Thornwick the only way on is the 6-unit corridor: the rest of its east edge is wall');
  assert(HOBB.at > THORNWICK.x + 70, 'Hobb holds the line in the corridor, past the town\'s floor, so there is no way round it');
}

// ---------------------------------------------------------------------------
section('the nine new enemies, by section 3.4');
{
  const T = ENEMY_TYPES;
  const rows: [string, number, number, number, number, number, 'trash' | 'elite' | 'rare'][] = [
    ['barrow_wight', 25, 1760, 81, 2.6, 45, 'trash'], ['grave_hound', 26, 1425, 32, 1.7, 46, 'trash'], ['cairn_brute', 27, 2050, 87, 2.4, 47, 'trash'],
    ['barrow_lord', 29, 7115, 116, 2.4, 147, 'elite'], ['hollow_knight', 28, 8830, 92, 2.2, 288, 'rare'],
    ['moor_ram', 28, 2205, 62, 1.9, 48, 'trash'], ['moor_raider', 29, 2370, 85, 2.4, 49, 'trash'], ['ridge_ogre', 30, 2545, 100, 2.4, 50, 'trash'], ['stonehorn', 31, 8170, 106, 2.2, 153, 'elite'],
  ];
  const mult = { trash: 1, elite: 3, rare: 6 }, drop = { trash: 1, elite: 3, rare: 4 };
  const ev = (id: string) => {
    const tb = DROP_TABLES[id], w = tb.entries.map(e => e.weight ?? ITEMS[e.id].dropWeight), tot = tb.nothing + w.reduce((a, b) => a + b, 0);
    return tb.rolls * tb.entries.reduce((a, e, i) => a + (w[i] / tot) * (e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1) * ITEMS[e.id].value, 0);
  };
  for (const [id, L, hp, hit, swing, xp, role] of rows) {
    const d = T[id];
    assert(d.level === L && d.hp === hp && d.damage === hit && d.attackInterval === swing && d.xp === xp, `${d.name}: level ${L}, ${hp} HP, hit ${hit} every ${swing}s, ${xp} XP`);
    assert(d.xp === (20 + L) * mult[role] && (role === 'trash' ? d.respawn >= 30 && d.respawn <= 45 : d.respawn === (role === 'elite' ? 120 : 1800)), `...XP is (20 + ${L}) x ${mult[role]}, and it respawns in ${d.respawn}s`);
    const want = (0.6 * L + 3) * drop[role];
    assert(Math.abs(ev(id) / want - 1) <= 0.05, `...drops worth ${ev(id).toFixed(1)} a kill against the rule's ${want.toFixed(1)}`);
    assert(d.look && ['wolf', 'hexer', 'brute', 'boar'].includes(d.look.model), '...drawn on a rig that exists');
  }
  assert(T.barrow_lord.heavy!.damage === 400 && T.barrow_lord.hazard!.damage === 175 && T.stonehorn.heavy!.damage === 440 && T.stonehorn.hazard!.damage === 195 && T.hollow_knight.heavy!.damage === 385, 'the elites\' slams and ground marks, and the Knight\'s slam, are the bible\'s');
  assert(T.barrow_wight.ranged && T.moor_raider.ranged && T.grave_hound.pack && !T.cairn_brute.heavy && !T.ridge_ogre.heavy, 'the wight and the raider shoot, the hounds come in a pack, and the brute\'s and ogre\'s slam is a heavier swing, not a telegraph');
}

// ---------------------------------------------------------------------------
section('where the enemies stand');
{
  const here = (id: string) => bar.spawns!.filter(sp => sp.type === id).length, moor = (id: string) => high.spawns!.filter(sp => sp.type === id).length;
  assert(here('barrow_wight') === 9 && here('grave_hound') === 18 && here('cairn_brute') === 6 && here('barrow_lord') === 1 && here('hollow_knight') === 1, 'the Barrowdowns hold 9 wights, 6 packs of 3 hounds, 6 brutes, the Lord and the Knight');
  assert(moor('moor_ram') === 3 && moor('moor_raider') === 3 && moor('ridge_ogre') === 2 && moor('stonehorn') === 1, 'the Moor holds 3 rams, 3 raiders, 2 ogres and Stonehorn');
  assert(bar.spawns!.every(sp => regionAt(sp.x, sp.z)?.id === 'barrowdowns') && high.spawns!.every(sp => regionAt(sp.x, sp.z)?.id === 'highmoor'), 'every new enemy stands in the region that owns it');
  assert(bar.spawns!.every(sp => Math.abs(sp.z - BARROWDOWNS.z) >= 30), 'every camp on the Barrowdowns is 30 or more off the road: a walker is never pulled in');
  assert(SPAWNS.every(sp => !inSafeZone(sp.x, sp.z) && SAFE_ZONES.every(z => dist(sp, z) >= z.r + 2.5)), 'none is inside a safe circle, or within two and a half units of its edge');
  const s = createState(9501);
  assert(s.enemies.every((e, i) => e.id === i + 1 && e.type === SPAWNS[i].type), 'enemy ids are positions in the list: the new ones come after every older one');
  assert(s.enemies.filter(e => e.region === 'barrowdowns').length === 35 && s.enemies.filter(e => e.region === 'highmoor').length === 9, 'and each knows its region');
  const lord = bar.spawns!.find(sp => sp.type === 'barrow_lord')!;
  assert(lord.x - BARROWDOWNS.x > 350, 'the elite holds the last stretch before Highmoor');
}

// ---------------------------------------------------------------------------
section('the gate on Thornwick\'s east edge and the walk to Highmoor');
{
  const walk = (level: number, ticks = 30 * 3) => {
    const s = quiet(level);
    s.player.x = HOBB.at - 6; s.player.z = THORNWICK.z;
    let said: ReturnType<typeof gateEvent>;
    for (let i = 0; i < ticks; i++) { tick(s, { dirX: 1, dirZ: 0 }); said ??= gateEvent(s); }
    return { s, said };
  };
  const low = walk(21), ok = walk(22);
  assert(low.said?.keeper === 'Gatewarden Hobb' && low.s.player.x < HOBB.at, 'at 21 Hobb turns the player back');
  assert(!ok.said && ok.s.player.x > HOBB.at + 3, 'at 22 the road is open, and nothing is said');
  const far = walk(25, 30 * 60);
  assert(regionAt(far.s.player.x, far.s.player.z)?.id === 'barrowdowns' && far.s.player.x > BARROWDOWNS.x - 300, `a minute's walk east at 25 is out on the road: x = ${far.s.player.x.toFixed(0)}`);
}

// ---------------------------------------------------------------------------
section('Highmoor\'s two gates: refused with a line, honest that nothing is behind them');
{
  const walkNorth = (g: typeof CAIRN, level: number) => {
    const s = quiet(level), mid = (g.span[0] + g.span[1]) / 2;
    s.player.x = mid; s.player.z = g.at + 6;
    let said: ReturnType<typeof gateEvent>;
    for (let i = 0; i < 90; i++) { tick(s, { dirX: 0, dirZ: -1 }); said ??= gateEvent(s); }
    return { s, said };
  };
  assert(CAIRN.combat === 29 && CAIRN.closed && CAIRN.from === 1 && NORTH.closed && NORTH.from === 1 && NORTH.combat === 0, 'the Cairn Hold\'s door asks combat 29 and the north gate asks a quest (Q6), and both are shut for good');
  const c20 = walkNorth(CAIRN, 20), c30 = walkNorth(CAIRN, 30), n40 = walkNorth(NORTH, 40);
  assert(c20.said?.text === CAIRN.refuse && c20.said.keeper === 'Cairnwarden Ysolt' && c20.said.need === 29 && c20.s.player.z > CAIRN.at, `at 20 the Cairn Hold's keeper says: "${c20.said?.text}"`);
  assert(c30.said?.text === CAIRN.closed && c30.s.player.z > CAIRN.at, `at 30 she says there is nothing to go in to: "${c30.said?.text}"`);
  assert(n40.said?.text === NORTH.closed && n40.said.keeper === 'Watchman Corvin' && n40.s.player.z > NORTH.at, `the north gate is shut at any level: "${n40.said?.text}"`);
  const wall = (g: typeof CAIRN) => { const s = quiet(40); s.player.x = g.span[0] - 12; s.player.z = g.at + 4; run(s, 3, { dirX: 0, dirZ: -1 }); return s.player.z; };
  assert(wall(CAIRN) > CAIRN.at + 1 && wall(NORTH) > NORTH.at + 1, 'and the walls either side hold: there is no way round either line');
}

// ---------------------------------------------------------------------------
section('Highmoor\'s services: flight master, graveyard, safe ground');
{
  const sq = LANDMARKS.highSquare, safe = high.safe![0], m = masterById('highmoor')!;
  assert(safe.r === 35 && dist(safe, sq) === 0, 'a safe circle of 35 about the square');
  assert(m && dist(m, sq) < safe.r && regionAt(m.x, m.z)?.id === 'highmoor' && COLLIDERS.some(o => o.kind === 'person' && o.x === m.x && o.z === m.z), 'a flight master stands in the town, a person you cannot walk through');
  const s = createState(9502);
  assert(!s.found.includes('highmoor'), 'a new game has not found Highmoor');
  s.player.x = m.x - 10; s.player.z = m.z; tick(s);
  assert(s.found.includes('highmoor') && s.events.some(e => e.t === 'discover'), 'walking up to its flight master puts it on the network');
  const gr = TOWNS.find(t => t.id === 'highmoor')!;
  assert(inSafeZone(gr.grave.x, gr.grave.z) && dist(gr.grave, gr.wake) > 25 && regionAt(gr.grave.x, gr.grave.z)?.id === 'highmoor', 'its graveyard is safe ground on the town\'s floor, more than 25 from where a flight lands');
  assert(gr.map.x === 1900 && gr.map.z === 1000 && TOWNS.every(t => FLIGHT_MASTERS.some(f => f.id === t.id)), 'its world-map position is (1900, 1000), and every town has a master');
  const round5 = (n: number) => Math.round(n / 5) * 5;
  assert(flightPrice('thornwick', 'highmoor') === round5(25 + 1000 / 6) && flightPrice('thornwick', 'highmoor') === 190 && Math.abs(flightSeconds('thornwick', 'highmoor') - (6 + 1000 / 75)) < 1e-9, 'Thornwick to Highmoor is 25 + distance / 6 rounded to 5: 190 gold');
  assert(flightPrice('hale', 'highmoor') === round5(25 + Math.hypot(1900, 1000) / 6), 'and from Hale it follows the same rule');
  assert(nearestTown(BARROWDOWNS.x + 440, BARROWDOWNS.z, ['hale', 'thornwick']).id === 'thornwick' && nearestTown(BARROWDOWNS.x + 440, BARROWDOWNS.z).id === 'highmoor', 'a death at the east end of the road wakes you in Highmoor once you have found its master');
}

// ---------------------------------------------------------------------------
section('stormiron: Mining 40, and the smithing it opens');
{
  const def = NODE_TYPES.stormiron;
  assert(def.skill === 'mining' && def.level === 40 && def.item === 'stormiron_ore' && def.xp === 475, 'a stormiron vein is Mining 40 and pays 475 XP a swing (0.12 x the cost of its level)');
  const nodes = createNodes(), storm = nodes.filter(n => n.type === 'stormiron');
  const inTwo = (n: { x: number; z: number }) => ['barrowdowns', 'thornwick'].includes(regionAt(n.x, n.z)?.id ?? '');
  assert(storm.length === 15 && storm.every(inTwo) && storm.filter(n => regionAt(n.x, n.z)?.id === 'barrowdowns').length === 12, 'fifteen veins: three in the Thornwood and twelve in the barrows');
  assert(nodes.slice(-15).every(n => n.type === 'stormiron'), 'they are the last nodes of all, so no older id moved');
  assert(storm.every(n => !COLLIDERS.some(o => o.kind !== undefined && o.kind !== 'rock' && Math.hypot(o.x - n.x, o.z - n.z) < o.r + n.r)), 'and none is inside a tree, a mound or a house');
  const s = quiet(25);
  s.player.skills.mining.level = 39;
  const n = s.nodes.find(x => x.type === 'stormiron')!;
  beginGather(s, n);
  assert(s.events.some(e => e.t === 'actionfail' && e.reason === 'level' && e.need === 40), 'a Mining 39 hand is told it needs 40');
  s.events.length = 0;
  s.player.skills.mining.level = 40;
  beginGather(s, n);
  assert(s.player.action?.k === 'gather', 'a Mining 40 hand starts to mine it');
  const need = (id: string) => RECIPES.find(r => r.id === id)!;
  assert(need('stormiron_bar').level === 36 && need('stormiron_bar').inputs.some(i => i.id === 'coal' && i.qty === 4) && need('stormiron_helm').level === 37 && need('stormiron_blade').level === 37 && need('stormiron_greaves').level === 39 && need('stormiron_chestplate').level === 41, 'the bar is Smithing 36 with four coal; the set is 37, 39, 41 and the blade 37');
  assert(ITEMS.stormiron_blade.stats!.damage === 58 && ITEMS.stormiron_helm.stats!.armor === 20 && ITEMS.stormiron_chestplate.stats!.armor === 38 && ITEMS.stormiron_greaves.stats!.armor === 28, 'the blade is +58 and the set 20 / 38 / 28 = 86, by 3.3');
}

// ---------------------------------------------------------------------------
section('routing: Thornwick to Highmoor on foot, zone by zone');
{
  evictGrids();
  const a = { x: LANDMARKS.thornSquare.x, z: LANDMARKS.thornSquare.z }, b = { x: LANDMARKS.highSquare.x, z: LANDMARKS.highSquare.z };
  const r = route(a, b);
  assert(r !== null && r[r.length - 1] === b, `a route from Thornwick's square to Highmoor's exists (${r?.length} waypoints)`);
  const pts = [a, ...r!], seen = new Set<string | undefined>();
  for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 40; k++) seen.add(regionAt(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k / 40, pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k / 40)?.id);
  assert(seen.has('barrowdowns') && seen.has('highmoor') && !seen.has(undefined), 'and passes through the Barrowdowns, and never leaves the floor');
  const gate = { x: BARROWDOWNS.x - 440, z: BARROWDOWNS.z };
  const lost = [...bar.spawns!, ...high.spawns!].filter(sp => route(gate, sp) === null);
  assert(lost.length === 0, 'every enemy of the Barrowdowns and the Moor can be walked to from the Thornwick gate');
  assert(route(b, a) !== null, 'and the way back routes');
}

// ---------------------------------------------------------------------------
section('the old world is as it was');
{
  const s = createState(9503);
  assert(s.enemies[0].type === 'boar' && s.enemies[19].id === 20, 'Hale\'s enemies keep their ids');
  assert(regionById('thornwick').herbs!.length > 0 && TOWNS.slice(0, 3).map(t => t.id).join() === 'hale,saltmarrow,thornwick', 'the first three towns are where they were');
}

console.log(`\nAll ${checks} Barrowdowns and Highmoor checks passed.`);

// HOM-63: Dunmere Fens, Thornwick and the road between: the regions, the ten new enemies, the two hard gates, Withering Ground, the town's services and the routes.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ENEMY_TYPES, SPAWNS, xpParity } from './sim/data';
import { DROP_TABLES, ITEMS } from './sim/items';
import {
  REGIONS, GATES, WITHERING, DUNMERE, THORNWICK, SALTMARROW, LANDMARKS, TOWNS, SAFE_ZONES, COLLIDERS, regionAt, regionById, inSafeZone, clampToWorld, nearestTown, PLAYER_RADIUS,
} from './sim/world';
import { route, evictGrids, gridStats } from './sim/path';
import { createNodes } from './sim/gathering';
import { flightPrice, flightSeconds, masterById, FLIGHT_MASTERS } from './sim/flight';
import { VENDORS } from './sim/shop';
import { NPCS, dialogueAt } from './sim/quest';
import { WITHERING_FRAC, witheringAt } from './sim/hazards';
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
const inRect = (r: { x0: number; x1: number; z0: number; z1: number }, p: { x: number; z: number }) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;

/** A new game with every enemy laid low for good (this is about the ground, not the fight), the player at combat `level`. */
function quiet(level = 1): GameState {
  const s = createState(6300);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  return s;
}
const gateEvent = (s: GameState) => s.events.find(e => e.t === 'gate') as Extract<GameState['events'][number], { t: 'gate' }> | undefined;
const SALT_GATE = GATES.find(g => g.id === 'dunmere')!, EAST_GATE = GATES.find(g => g.id === 'barrowdowns')!;

// ---------------------------------------------------------------------------
section('the regions: sizes, seams and where they stand');
{
  const dun = regionById('dunmere'), thorn = regionById('thornwick'), main = dun.footprint[0], tmain = thorn.footprint[0];
  assert(Math.round(main.x1 - main.x0) === 140 && main.z1 - main.z0 >= 840 && main.z1 - main.z0 <= 900, `Dunmere Fens is 140 wide and ${main.z1 - main.z0} long (the bible's 900 x 140, less the ten units either end shares with a town)`);
  assert(tmain.x1 - tmain.x0 === 140 && tmain.z1 - tmain.z0 === 140, 'Thornwick is 140 x 140');
  assert(dun.zone === 'dunmere' && thorn.zone === 'thornwick' && dun.cell === undefined, 'each has a routing zone of its own, at the default one-unit cell');
  assert(regionAt(DUNMERE.x, DUNMERE.z)?.id === 'dunmere' && regionAt(THORNWICK.x, THORNWICK.z)?.id === 'thornwick' && regionAt(SALTMARROW.x, SALTMARROW.z)?.id === 'saltmarrow', 'regionAt names them');
  assert(dun.landmarks.gate.z === SALT_GATE.at && inRect(dun.footprint[1], { x: DUNMERE.x, z: SALT_GATE.at }), "the gate stands in the corridor through Saltmarrow's south edge");
  assert(dun.footprint[1].x1 - dun.footprint[1].x0 === 6, 'the corridor is 6 units wide, as Hale\'s gate is');
  const open = (x: number, z: number) => FLAT.some(f => inRect(f, { x, z }));
  const FLAT = REGIONS.flatMap(r => r.footprint);
  assert(open(DUNMERE.x, 95) && !open(DUNMERE.x - 20, 95) && !open(DUNMERE.x + 20, 95), 'south of Saltmarrow the only way on is the corridor: the rest of that edge is wall');
  assert(open(DUNMERE.x - 60, 944) && open(DUNMERE.x + 60, 944), "Dunmere and Thornwick overlap across the whole width: the fen road's end is soft");
  const nodes = createNodes();
  assert(nodes.length === 42 + regionById('wayside').rocks.length + regionById('wayside').trees.length, 'no node id moved: the herb patches and thornoaks are not gathering nodes');
  assert(thorn.trees.length === 0 && thorn.obstacles.filter(o => o.kind === 'thornoak').length >= 40, 'the thornoaks are scenery that stops you: Woodcutting has no rung for them');
  assert(COLLIDERS.filter(o => o.kind === 'thornoak').every(o => inRect(tmain, o)), 'every thornoak stands on Thornwick\'s floor');
}

// ---------------------------------------------------------------------------
section('the ten new enemies, by the retuned table (HOM-62)');
{
  const T = ENEMY_TYPES;
  const rows: [string, number, number, number, number, number, 'trash' | 'elite' | 'rare'][] = [
    ['fen_stalker', 18, 805, 32, 1.8, 38, 'trash'], ['bog_witch', 19, 1045, 71, 2.8, 39, 'trash'], ['mire_troll', 20, 1145, 67, 2.4, 40, 'trash'], ['bogfather', 21, 3770, 81, 2.4, 123, 'elite'], ['mother_mire', 20, 4585, 74, 2.4, 240, 'rare'],
    ['thornback', 21, 1255, 51, 1.9, 41, 'trash'], ['blight_stag', 22, 1370, 54, 1.8, 42, 'trash'], ['rotwood_cultist', 23, 1495, 78, 2.6, 43, 'trash'], ['thorn_warden', 24, 4865, 91, 2.4, 132, 'elite'], ['elder_thornback', 23, 5975, 80, 2, 258, 'rare'],
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
    assert(Math.abs(ev(id) / want - 1) <= 0.15, `...drops worth ${ev(id).toFixed(1)} a kill against the rule's ${want.toFixed(1)}`);
    assert(d.look && ['wolf', 'hexer', 'brute', 'boar'].includes(d.look.model), '...drawn on a rig that exists');
  }
  assert(T.bog_witch.hazard!.damage === 160 && T.bog_witch.ranged && T.bogfather.heavy!.damage === 270 && T.bogfather.hazard!.damage === 115 && T.mother_mire.heavy!.damage === 250 && T.mother_mire.hazard!.damage === 110, 'the witch\'s ground mark, the Bogfather\'s and Mother Mire\'s slam and mark are the bible\'s');
  assert(T.thorn_warden.heavy!.damage === 310 && T.thorn_warden.hazard!.damage === 135 && T.elder_thornback.heavy!.damage === 295 && T.rotwood_cultist.ranged && T.fen_stalker.pack && !T.mire_troll.heavy, 'the Warden\'s, the Elder\'s, the cultist\'s hex, the stalkers\' pack; the troll\'s slam is a heavier swing, not a telegraph');
  // the XP-parity rule applies to the new rows as it does to every other: a level-25 hand gets 65 % of a level-18 kill
  const s = quiet(25), e = s.enemies.find(x => x.type === 'fen_stalker')!;
  s.player.x = 880; s.player.z = 600;
  Object.assign(e, { state: 'idle', hp: 1, x: 881.5, z: 600, respawnIn: 0 });
  s.targetId = e.id; s.player.facing = Math.PI / 2;
  tick(s, { ability: 0 });
  const paid = s.events.find(x => x.t === 'xp' && x.skill === 'combat') as Extract<GameState['events'][number], { t: 'xp' }> | undefined;
  assert(paid && paid.amount === Math.round(38 * xpParity(18, 25)) && paid.amount < 38, `a fen stalker pays ${paid?.amount} XP to a level-25 player, not 38: the parity rule`);
}

// ---------------------------------------------------------------------------
section('where the enemies stand');
{
  const count = (t: string) => SPAWNS.filter(sp => sp.type === t).length;
  assert(count('fen_stalker') === 10 && count('bog_witch') === 6 && count('mire_troll') === 4 && count('bogfather') === 1 && count('mother_mire') === 1, 'the fens hold 5 stalker pairs, 6 witches, 4 trolls, the Bogfather and Mother Mire');
  assert(count('thornback') === 3 && count('blight_stag') === 3 && count('rotwood_cultist') === 4 && count('thorn_warden') === 1 && count('elder_thornback') === 1, 'the Thornwood holds 3 boars, 3 stags, 4 cultists, the Warden and the Elder');
  const dunSpawns = SPAWNS.filter(sp => ENEMY_TYPES[sp.type].level >= 18 && ENEMY_TYPES[sp.type].level <= 21 && sp.z > 100 && sp.z < 940);
  assert(regionById('dunmere').spawns!.every(sp => regionAt(sp.x, sp.z)?.id === 'dunmere') && regionById('thornwick').spawns!.every(sp => regionAt(sp.x, sp.z)?.id === 'thornwick'), 'every new enemy stands in the region that owns it');
  assert(dunSpawns.length === regionById('dunmere').spawns!.length && regionById('dunmere').spawns!.every(sp => Math.abs(sp.x - DUNMERE.x) >= 22), 'every camp in the fens is 22 or more off the road: a walker is never pulled in');
  assert(SPAWNS.every(sp => !inSafeZone(sp.x, sp.z) && SAFE_ZONES.every(z => dist(sp, z) >= z.r + 2.5)), 'none is inside Thornwick\'s safe circle, or within two and a half units of its edge');
  const s = createState(6301);
  assert(s.enemies.every((e, i) => e.id === i + 1 && e.type === SPAWNS[i].type), 'enemy ids are positions in the list: the new ones come after every older one');
  assert(s.enemies.filter(e => e.region === 'dunmere').length === 22 && s.enemies.filter(e => e.region === 'thornwick').length === 12, 'and each knows its region');
  const bf = regionById('dunmere').spawns!.find(sp => sp.type === 'bogfather')!, mm = regionById('dunmere').spawns!.find(sp => sp.type === 'mother_mire')!;
  assert(bf.z - DUNMERE.z > 300 && mm.z - DUNMERE.z > 350, 'the levels climb south: the elite and the rare are at the far end');
}

// ---------------------------------------------------------------------------
section('the hard gate south of Saltmarrow: combat 16');
{
  const s = quiet(10), line = SALT_GATE.at;
  assert(SALT_GATE.combat === 16 && SALT_GATE.from === -1, 'the gate asks combat 16 and holds the Saltmarrow side');
  s.player.x = DUNMERE.x; s.player.z = line - 8;
  tick(s, { clickTarget: { x: DUNMERE.x, z: line + 40 } });
  let said: ReturnType<typeof gateEvent>;
  for (let i = 0; i < 90 && !said; i++) { tick(s); said = gateEvent(s); }
  assert(said && said.id === 'dunmere' && said.keeper === 'Marshwarden Quill' && said.need === 16 && /16/.test(said.text), `a click south from level 10 walks up to the line and the keeper speaks: "${said?.text}"`);
  assert(s.player.z < line && s.player.z > line - 1, `the player stands at z = ${s.player.z.toFixed(2)}, this side of the line at ${line}`);
  run(s, 3);
  assert(s.player.z < line, 'and keeps standing there');
  let repeats = 0;
  s.moveTarget = null;
  for (let i = 0; i < 30 * 8; i++) { tick(s, { dirX: 0, dirZ: 1 }); if (gateEvent(s)) repeats++; }
  assert(repeats >= 2 && repeats <= 4 && s.player.z < line, `leaning on it for eight seconds is told ${repeats} times, not every tick, and never gets through`);
  // the same walk at 16
  const t = quiet(16);
  t.player.x = DUNMERE.x; t.player.z = line - 8;
  run(t, 3, { dirX: 0, dirZ: 1 });
  assert(t.player.z > line + 5 && !gateEvent(t), 'a level-16 player walks through, and is not told anything');
  assert(regionAt(t.player.x, t.player.z)?.id === 'dunmere', '...into Dunmere Fens');
  // the way back is never refused: a level-1 player south of the line walks north through it
  const u = quiet(1);
  u.player.x = DUNMERE.x; u.player.z = line + 10;
  run(u, 3, { dirX: 0, dirZ: -1 });
  assert(u.player.z < line - 3 && !gateEvent(u), 'the way back is never refused: a level-1 player south of the gate walks north through it');
  // a dead player and a flight over it are not stopped (flights land on the far side whatever the level)
  assert(GATES.length === 2 && GATES.every(g => g.keeper && g.refuse), 'there are two gates in the world, each with a keeper and a line');
}

// ---------------------------------------------------------------------------
section('the gate on Thornwick\'s east edge: combat 22, nothing behind it yet');
{
  const x = EAST_GATE.at, z = EAST_GATE.span[0] + 3;
  assert(EAST_GATE.combat === 22 && EAST_GATE.closed && EAST_GATE.from === -1, 'it asks combat 22 and is closed besides');
  const walk = (level: number) => {
    const s = quiet(level);
    s.player.x = x - 6; s.player.z = z;
    let said: ReturnType<typeof gateEvent>;
    for (let i = 0; i < 90 && !said; i++) { tick(s, { dirX: 1, dirZ: 0 }); said = gateEvent(s); }
    return { s, said };
  };
  const low = walk(18), high = walk(24);
  assert(low.said && low.said.text === EAST_GATE.refuse && low.said.keeper === 'Gatewarden Hobb', `at 18 the keeper says: "${low.said?.text}"`);
  assert(high.said && high.said.text === EAST_GATE.closed, `at 24 the road is still shut: "${high.said?.text}"`);
  assert(low.s.player.x < x && high.s.player.x < x, 'neither gets past the line: there is no hole in the edge');
  const wall = clampToWorld({ x: x + 30, z }, PLAYER_RADIUS);
  assert(wall.x < THORNWICK.x + 70, 'and the edge itself holds');
}

// ---------------------------------------------------------------------------
section('Withering Ground: standing still hurts');
{
  const roadDist = (p: { x: number }) => Math.abs(p.x - DUNMERE.x);
  assert(WITHERING.length >= 14 && WITHERING.every(h => regionAt(h.x, h.z)?.id === 'dunmere' && roadDist(h) - h.r >= 10), `${WITHERING.length} patches of Withering Ground, all in the fens and none within ten of the road`);
  assert(regionById('dunmere').spawns!.every(sp => WITHERING.every(h => dist(sp, h) > h.r + 10)), 'none lies on a camp');
  const h = WITHERING[3], s = quiet(18);
  s.player.x = h.x; s.player.z = h.z;
  assert(witheringAt(h.x, h.z) && !witheringAt(DUNMERE.x, h.z), 'a patch is the circle it says, and the road beside it is clear');
  const hp0 = s.player.hp, drain = Math.round(s.player.maxHp * WITHERING_FRAC);
  run(s, 0.5);
  assert(s.player.hp === hp0, 'nothing happens in the first moments: you can cross a patch');
  run(s, 2.6);
  assert(hp0 - s.player.hp === 3 * drain, `three seconds standing in it takes three drains of ${drain} (2 % of ${s.player.maxHp}): ${hp0 - s.player.hp}`);
  // walking out stops it
  const w = quiet(18);
  w.player.x = h.x - h.r + 1; w.player.z = h.z;
  run(w, 1.4, { dirX: -1, dirZ: 0 });
  assert(!witheringAt(w.player.x, w.player.z), 'a walk out of the patch leaves it');
  const hpOut = w.player.hp;
  run(w, 4);
  assert(w.player.hp >= hpOut, 'and nothing more is taken once out');
  // it kills, and says so
  const d = quiet(1);
  d.player.x = h.x; d.player.z = h.z; d.player.hp = 1;
  let death: Extract<GameState['events'][number], { t: 'death' }> | undefined;
  for (let i = 0; i < 240 && !death; i++) { tick(d); death = d.events.find(e => e.t === 'death') as typeof death; }
  assert(death && death.killer === 'Withering Ground' && death.recap.at(-1)?.what === 'Withering Ground' && d.player.dead, 'standing in it long enough is a death, and the death says "Withering Ground"');
  // on a flight nothing touches you
  const f = quiet(18);
  f.player.x = h.x; f.player.z = h.z;
  f.player.action = { k: 'flight', from: 'saltmarrow', to: 'thornwick', t: 0, duration: 1e9 };
  const hpF = f.player.hp;
  run(f, 4);
  assert(f.player.hp === hpF, 'on a flight the ground cannot touch you');
}

// ---------------------------------------------------------------------------
section('Thornwick\'s services: flight master, vendor, quest giver, alembic, safe ground');
{
  const sq = LANDMARKS.thornSquare, safe = regionById('thornwick').safe![0];
  assert(safe.r === 35 && dist(safe, sq) === 0, 'a safe circle of 35 about the square');
  const m = masterById('thornwick')!, v = VENDORS.find(x => x.id === 'thorn')!, npc = NPCS.find(n => n.id === 'thorn')!;
  assert(m && v && npc && [m, v, npc, LANDMARKS.alembic].every(p => dist(p, sq) < safe.r + 20 && regionAt(p.x, p.z)?.id === 'thornwick'), 'a flight master, a vendor, a quest giver and the alembic are all in the town');
  assert([v, npc, m].every(p => COLLIDERS.some(o => o.kind === 'person' && o.x === p.x && o.z === p.z)), 'each of the three people is a collider you stand beside');
  assert(COLLIDERS.some(o => o.kind === 'alembic' && o.x === LANDMARKS.alembic.x && o.z === LANDMARKS.alembic.z), 'the alembic is placed (a landmark and a prop: the skill that uses it is a later card)');
  assert(v.stock.length > 0 && v.stock.every(id => ITEMS[id]) && dialogueAt(createState(1), 'thorn').lines.length >= 1, 'the vendor sells real things, and the reeve speaks (she has no quest to give yet)');
  const s = createState(6302);
  assert(!s.found.includes('thornwick'), 'a new game has not found Thornwick');
  s.player.x = m.x - 10; s.player.z = m.z; tick(s);
  assert(s.found.includes('thornwick') && s.events.some(e => e.t === 'discover'), 'walking up to its flight master puts it on the network');
  const gr = TOWNS.find(t => t.id === 'thornwick')!;
  assert(inSafeZone(gr.grave.x, gr.grave.z) && dist(gr.grave, gr.wake) > 25 && regionAt(gr.grave.x, gr.grave.z)?.id === 'thornwick', 'its graveyard is safe ground on the town\'s floor, more than 25 from where a flight lands');
  assert(FLIGHT_MASTERS.some(f => f.id === 'thornwick') && TOWNS.every(t => FLIGHT_MASTERS.some(f => f.id === t.id)), 'and every town still has its master');
  assert(flightPrice('saltmarrow', 'thornwick') === 190 && Math.abs(flightSeconds('saltmarrow', 'thornwick') - 19.33) < 0.01 && flightPrice('hale', 'thornwick') === 250, 'Saltmarrow to Thornwick is 190 gold and a 19 second ride; from Hale 250');
  // a death at the south end of the fens wakes you at the nearest graveyard among the masters you have found
  assert(TOWNS.length === 3 && nearestTown(DUNMERE.x, 880, ['hale', 'saltmarrow']).id === 'saltmarrow' && nearestTown(DUNMERE.x, 880, ['hale', 'saltmarrow', 'thornwick']).id === 'thornwick' && nearestTown(DUNMERE.x, 880).id === 'thornwick',
    'a death at the south end of the fens wakes you at Saltmarrow until you have found Thornwick\'s master, at Thornwick after');
}

// ---------------------------------------------------------------------------
section('routing: Saltmarrow to Thornwick on foot, zone by zone');
{
  evictGrids();
  const a = { x: LANDMARKS.square.x, z: LANDMARKS.square.z }, b = { x: LANDMARKS.thornSquare.x, z: LANDMARKS.thornSquare.z };
  const r = route(a, b);
  assert(r !== null && r[r.length - 1] === b, `a route from Saltmarrow's square to Thornwick's exists (${r?.length} waypoints)`);
  const pts = [a, ...r!], seen = new Set<string | undefined>();
  for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 40; k++) { const q = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k / 40, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k / 40 }; seen.add(regionAt(q.x, q.z)?.id); }
  assert(seen.has('dunmere') && seen.has('thornwick') && !seen.has(undefined), 'and passes through the fens, and never leaves the floor');
  let len = 0, prev: { x: number; z: number } = a;
  for (const p of r!) { len += dist(prev, p); prev = p; }
  assert(len < dist(a, b) * 1.15, `it is ${len.toFixed(0)} units for a straight ${dist(a, b).toFixed(0)}: no needless detour`);
  const gate = { x: DUNMERE.x, z: 76 };
  const unreachable = SPAWNS.filter(sp => sp.z > 100 && route(gate, sp) === null);
  assert(unreachable.length === 0, 'every enemy of the fens and the Thornwood can be walked to from the Saltmarrow gate');
  const stats = gridStats();
  assert(stats.zones.includes('dunmere') || stats.cells > 0, 'the fens\' grid was built on demand');
  const cells = stats.cells;
  assert(cells <= stats.budget, `the grids held by that walk total ${cells} cells, inside the ${stats.budget} budget`);
  const back = route(b, a);
  assert(back !== null, 'and the way back routes');
}

// ---------------------------------------------------------------------------
section('the old world is as it was');
{
  const s = createState(6303);
  assert(s.enemies[0].type === 'boar' && s.enemies[19].id === 20, 'Hale\'s enemies keep their ids');
  assert(LANDMARKS.square.x === SALTMARROW.x - 25, 'Saltmarrow\'s square is still its own (the town landmarks do not collide)');
}

console.log(`\nAll ${checks} Dunmere and Thornwick checks passed.`);

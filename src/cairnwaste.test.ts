// HOM-111: the Cairnwaste and the Sundered Spire: the two regions, the eight new enemies, the fifth town and its forge, starmetal and Crownbreaker, the flights, Q7 and the Vault's shut door.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ENEMY_TYPES, SPAWNS } from './sim/data';
import { DROP_TABLES, ITEMS, STARMETAL_SET, deriveStats, emptyEquipment } from './sim/items';
import {
  REGIONS, GATES, CAIRNWASTE, HIGHMOOR, SPIRE, LANDMARKS, TOWNS, SAFE_ZONES, COLLIDERS, regionAt, regionById, inSafeZone, nearestTown,
} from './sim/world';
import { route, evictGrids } from './sim/path';
import { createNodes, NODE_TYPES, beginGather } from './sim/gathering';
import { RECIPES, STATIONS, nearStation, nearestSite, stationSites } from './sim/crafting';
import { flightPrice, flightSeconds, masterById, FLIGHT_MASTERS, destinationsFrom } from './sim/flight';
import { xpForLevel, levelForXp } from './sim/xp';
import { refreshPlayerStats } from './sim/combat';
import { addItem, countItem } from './sim/inventory';
import { VENDORS, vendorNear, applyShopAction, SPIRE_VENDOR } from './sim/shop';
import { rollDrops } from './sim/loot';
import { deserialize, serialize } from './sim/save';
import { REWARD8, SEAL_GOALS, QUEST8_NAME, SPIRE_KEEPER, NPCS, activeQuestView, dialogueAt, keeperMarker, npcNear } from './sim/quest';

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
  const s = createState(9700);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  return s;
}
const setSkill = (s: GameState, id: 'mining' | 'smithing', level: number) => { s.player.skills[id].xp = xpForLevel(level); s.player.skills[id].level = level; };
const gateEvent = (s: GameState) => s.events.find(e => e.t === 'gate') as Extract<GameState['events'][number], { t: 'gate' }> | undefined;
const NORTH = GATES.find(g => g.id === 'cairnwaste')!, VAULT = GATES.find(g => g.id === 'vault')!;
const waste = regionById('cairnwaste'), spire = regionById('spire');
const STRIKE = 0;

// ---------------------------------------------------------------------------
section('the regions: sizes, seams and where they stand');
{
  const wmain = waste.footprint[0], smain = spire.footprint[0];
  assert(wmain.x1 - wmain.x0 === 140 && wmain.z1 - wmain.z0 === 830, 'the Cairnwaste is 140 wide and 830 long (the towns are 1,000 apart on the map, and the two towns\' floors take the rest)');
  assert(smain.x1 - smain.x0 === 140 && smain.z1 - smain.z0 === 140, 'the Spire is 140 x 140');
  assert(waste.zone === 'cairnwaste' && spire.zone === 'spire', 'each has a routing zone of its own');
  assert(regionAt(CAIRNWASTE.x, CAIRNWASTE.z)?.id === 'cairnwaste' && regionAt(SPIRE.x, SPIRE.z)?.id === 'spire', 'regionAt names them');
  const open = (x: number, z: number) => REGIONS.some(r => r.footprint.some(f => x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1));
  assert(open(SPIRE.x - 60, SPIRE.z + 74) && open(SPIRE.x + 60, SPIRE.z + 74), 'the wastes\' north end overlaps the Spire across the whole width: that way is soft');
  assert(open(HIGHMOOR.x + 30, HIGHMOOR.z - 100) && !open(HIGHMOOR.x + 20, HIGHMOOR.z - 100) && !open(HIGHMOOR.x + 40, HIGHMOOR.z - 100), 'leaving Highmoor north the only way on is Corvin\'s 6-unit corridor, which runs up into the wastes: the wall either side holds');
  assert(NORTH.at > CAIRNWASTE.z + 440 && NORTH.at === HIGHMOOR.z - 76, 'and Corvin\'s line is where it was (HOM-95), 6 units past the town\'s floor and well south of the wastes');
  const cairnRock = regionById('chamber').footprint[0];
  assert(!(wmain.x0 < cairnRock.x1 && wmain.x1 > cairnRock.x0 && wmain.z0 < cairnRock.z1 && wmain.z1 > cairnRock.z0), 'the wastes do not lie over the Cairn Hold\'s rooms (the Cairn King\'s chamber is just south-west of their corner)');
  const towns = TOWNS.map(t => t.id).join();
  assert(towns === 'hale,saltmarrow,thornwick,highmoor,spire' && TOWNS[4].map.x === 1900 && TOWNS[4].map.z === 0, 'the Spire is the fifth town, at (1900, 0) on the map');
}

// ---------------------------------------------------------------------------
section('the eight new enemies, by section 3.4');
{
  const T = ENEMY_TYPES;
  const rows: [string, number, number, number, number, number, 'trash' | 'elite'][] = [
    ['waste_reaver', 32, 2910, 97, 2.4, 52, 'trash'], ['dune_hound', 34, 2480, 40, 1.7, 54, 'trash'], ['sand_ogre', 35, 3525, 119, 2.4, 55, 'trash'], ['ashen_colossus', 36, 11240, 136, 2.4, 168, 'elite'],
    ['spire_adept', 36, 3745, 112, 2.6, 56, 'trash'], ['void_hound', 37, 2980, 43, 1.7, 57, 'trash'], ['rune_golem', 38, 4215, 120, 2.4, 58, 'trash'], ['spire_warden', 39, 13395, 140, 2.4, 177, 'elite'],
  ];
  const mult = { trash: 1, elite: 3 };
  const ev = (id: string) => {
    const tb = DROP_TABLES[id], w = tb.entries.map(e => e.weight ?? ITEMS[e.id].dropWeight), tot = tb.nothing + w.reduce((a, b) => a + b, 0);
    return tb.rolls * tb.entries.reduce((a, e, i) => a + (w[i] / tot) * (e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1) * ITEMS[e.id].value, 0);
  };
  for (const [id, L, hp, hit, swing, xp, role] of rows) {
    const d = T[id];
    assert(d.level === L && d.hp === hp && d.damage === hit && d.attackInterval === swing && d.xp === xp, `${d.name}: level ${L}, ${hp} HP, hit ${hit} every ${swing}s, ${xp} XP`);
    assert(d.xp === (20 + L) * mult[role] && (role === 'trash' ? d.respawn >= 30 && d.respawn <= 45 : d.respawn === 120), `...XP is (20 + ${L}) x ${mult[role]}, and it respawns in ${d.respawn}s`);
    const want = (0.6 * L + 3) * mult[role];
    assert(Math.abs(ev(id) / want - 1) <= 0.01, `...drops worth ${ev(id).toFixed(1)} a kill against the rule's ${want.toFixed(1)}`);
    assert(d.look && ['wolf', 'hexer', 'brute'].includes(d.look.model), '...drawn on a rig that exists');
  }
  assert(T.ashen_colossus.heavy!.damage === 540 && T.ashen_colossus.hazard!.damage === 235 && T.spire_warden.heavy!.damage === 605 && T.spire_warden.hazard!.damage === 265, 'the elites\' slams and ground marks are the bible\'s: 540 / 235 and 605 / 265');
  assert(T.waste_reaver.ranged && T.spire_adept.ranged && T.dune_hound.pack && T.void_hound.pack && !T.sand_ogre.heavy && !T.rune_golem.heavy, 'the reaver and the adept shoot, the hounds come in packs, and the ogre\'s and the golem\'s slam is a heavier swing, not a telegraph');
  const mh = (id: string) => DROP_TABLES[id].entries.find(e => e.id === 'moor_hide'), pelt = (id: string) => DROP_TABLES[id].entries.find(e => e.id === 'wolf_pelt')!;
  assert(['dune_hound', 'sand_ogre', 'ashen_colossus'].every(id => mh(id) && mh(id)!.weight === pelt(id).weight! / 2 + (pelt(id).weight! % 2 ? 0.5 : 0)) && !['waste_reaver', 'spire_adept', 'void_hound', 'rune_golem', 'spire_warden'].some(id => mh(id)), 'the wastes\' beasts add moor hide at half the weight of their pelt entry, the casters and the Spire\'s beasts none (2.2)');
}

// ---------------------------------------------------------------------------
section('where the enemies stand');
{
  const here = (r: typeof waste, id: string) => r.spawns!.filter(sp => sp.type === id).length;
  assert(here(waste, 'waste_reaver') === 9 && here(waste, 'dune_hound') === 18 && here(waste, 'sand_ogre') === 7 && here(waste, 'ashen_colossus') === 1, 'the Cairnwaste holds 9 reavers, 6 packs of 3 hounds, 7 ogres and the Colossus');
  assert(here(spire, 'spire_adept') === 4 && here(spire, 'void_hound') === 6 && here(spire, 'rune_golem') === 3 && here(spire, 'spire_warden') === 1, 'the Spire\'s ruins hold 4 adepts, 2 packs of 3 hounds, 3 golems and the Warden');
  assert(waste.spawns!.every(sp => regionAt(sp.x, sp.z)?.id === 'cairnwaste') && spire.spawns!.every(sp => regionAt(sp.x, sp.z)?.id === 'spire'), 'every new enemy stands in the region that owns it');
  assert(waste.spawns!.every(sp => Math.abs(sp.x - CAIRNWASTE.x) >= 30), 'every camp on the Cairnwaste is 30 or more off the road: a walker is never pulled in');
  assert(SPAWNS.every(sp => !inSafeZone(sp.x, sp.z) && SAFE_ZONES.every(z => dist(sp, z) >= z.r + 2.5)), 'none is inside a safe circle, or within two and a half units of its edge');
  const s = createState(9701);
  assert(s.enemies.every((e, i) => e.id === i + 1 && e.type === SPAWNS[i].type), 'enemy ids are positions in the list: the new ones come after every older one');
  assert(s.enemies.filter(e => e.region === 'cairnwaste').length === 35 && s.enemies.filter(e => e.region === 'spire').length === 14, 'and each knows its region');
  const colossus = waste.spawns!.find(sp => sp.type === 'ashen_colossus')!;
  assert(CAIRNWASTE.z - colossus.z > 300 && colossus.x > CAIRNWASTE.x, 'the elite holds the last stretch before the Spire, off the road to the east');
  const ogres = waste.spawns!.filter(sp => sp.type === 'sand_ogre'), reavers = waste.spawns!.filter(sp => sp.type === 'waste_reaver');
  const mean = (l: { z: number }[]) => l.reduce((a, p) => a + p.z, 0) / l.length;
  assert(mean(reavers) > mean(ogres), 'the reavers are mostly at the Highmoor end and the ogres toward the Spire: the road climbs as it goes north');
}

// ---------------------------------------------------------------------------
section('Highmoor\'s north gate goes somewhere, and the walk to the Spire');
{
  const walkNorth = (level: number, writ: boolean, seconds: number) => {
    const s = quiet(level), mid = (NORTH.span[0] + NORTH.span[1]) / 2;
    if (writ) s.quest.seventh = 'cleared';
    s.player.x = mid; s.player.z = NORTH.at + 6;
    let said: ReturnType<typeof gateEvent>;
    for (let i = 0; i < seconds / TICK_DT; i++) { tick(s, { dirX: 0, dirZ: -1 }); said ??= gateEvent(s); }
    return { s, said };
  };
  const no = walkNorth(40, false, 3), yes = walkNorth(32, true, 12);
  assert(no.said?.keeper === 'Watchman Corvin' && no.s.player.z > NORTH.at, 'without the writ Corvin still turns the player back, at any level');
  assert(!yes.said && regionAt(yes.s.player.x, yes.s.player.z)?.id === 'cairnwaste' && yes.s.player.z < NORTH.at - 50, `with it, twelve seconds north is out in the Cairnwaste: z = ${yes.s.player.z.toFixed(0)}`);
  const wall = (dx: number) => { const s = quiet(40); s.quest.seventh = 'cleared'; s.player.x = NORTH.span[0] + dx; s.player.z = NORTH.at + 4; run(s, 3, { dirX: 0, dirZ: -1 }); return s.player.z; };
  assert(wall(-4) > NORTH.at + 1 && wall(10) > NORTH.at + 1, 'and the walls either side of the corridor hold, writ or not');
  evictGrids();
  const a = { x: LANDMARKS.highSquare.x, z: LANDMARKS.highSquare.z }, b = { x: LANDMARKS.spireSquare.x, z: LANDMARKS.spireSquare.z };
  const r = route(a, b);
  assert(r !== null && r[r.length - 1] === b, `a route from Highmoor's square to the Spire's exists (${r?.length} waypoints)`);
  const pts = [a, ...r!], seen = new Set<string | undefined>();
  for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 40; k++) seen.add(regionAt(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k / 40, pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k / 40)?.id);
  assert(seen.has('cairnwaste') && seen.has('spire') && !seen.has(undefined), 'and passes through the Cairnwaste, and never leaves the floor');
  const gate = { x: HIGHMOOR.x + 30, z: CAIRNWASTE.z + 430 };
  const lost = [...waste.spawns!, ...spire.spawns!, ...waste.rocks].filter(sp => route(gate, sp) === null);
  assert(lost.length === 0, 'every enemy and vein of the wastes and the ruins can be walked to from Corvin\'s gate');
  assert(route(b, a) !== null, 'and the way back routes');
}

// ---------------------------------------------------------------------------
section('the Spire\'s services: flight master, forge, provisioner, Keeper, graveyard, safe ground');
{
  const sq = LANDMARKS.spireSquare, safe = spire.safe![0], m = masterById('spire')!;
  assert(safe.r === 35 && dist(safe, sq) === 0, 'a safe circle of 35 about the square');
  const person = (p: { x: number; z: number }) => COLLIDERS.some(o => o.kind === 'person' && o.x === p.x && o.z === p.z);
  assert(m && dist(m, sq) < safe.r && regionAt(m.x, m.z)?.id === 'spire' && person(m), 'a flight master stands in the town, a person you cannot walk through');
  assert(dist(LANDMARKS.spireKeeper, sq) < safe.r && dist(LANDMARKS.spireVendor, sq) < safe.r && dist(LANDMARKS.forgeSpire, sq) < safe.r && person(LANDMARKS.spireKeeper) && person(LANDMARKS.spireVendor), 'so do the Keeper, the provisioner and the forge, inside the safe ground');
  const s = createState(9702);
  assert(!s.found.includes('spire'), 'a new game has not found the Spire');
  s.player.x = m.x - 10; s.player.z = m.z; tick(s);
  assert(s.found.includes('spire') && s.events.some(e => e.t === 'discover'), 'walking up to its flight master puts it on the network');
  const gr = TOWNS.find(t => t.id === 'spire')!;
  assert(inSafeZone(gr.grave.x, gr.grave.z) && dist(gr.grave, gr.wake) > 25 && regionAt(gr.grave.x, gr.grave.z)?.id === 'spire', 'its graveyard is safe ground on the town\'s floor, more than 25 from where a flight lands');
  assert(nearestTown(CAIRNWASTE.x, CAIRNWASTE.z - 380, ['hale', 'highmoor']).id === 'highmoor' && nearestTown(CAIRNWASTE.x, CAIRNWASTE.z - 380).id === 'spire', 'a death at the north end of the wastes wakes you in the Spire once you have found its master, and in Highmoor until then');
  const v = VENDORS.find(x => x.id === 'spire')!, near = quiet(1);
  near.player.x = SPIRE_VENDOR.x + 2; near.player.z = SPIRE_VENDOR.z; near.player.gold = 1000;
  assert(vendorNear(near)?.id === 'spire' && v.stock.length > 0 && v.stock.every(id => !RECIPES.some(r => r.inputs.some(i => i.id === id))), 'the provisioner sells and buys, and never sells anything a recipe consumes');
  applyShopAction(near, { k: 'buy', item: v.stock[0], qty: 1 });
  assert(countItem(near.player.inventory, v.stock[0]) === 1, 'and a purchase goes through');
  // every pair of towns is priced by the bible's rule, and the table in section 5.2 holds
  const round5 = (n: number) => Math.round(n / 5) * 5;
  const pairs: [string, string, number][] = [['hale', 'saltmarrow', 175], ['saltmarrow', 'thornwick', 190], ['thornwick', 'highmoor', 190], ['highmoor', 'spire', 190], ['saltmarrow', 'spire', 190],
    ['hale', 'thornwick', 250], ['saltmarrow', 'highmoor', 260], ['thornwick', 'spire', 260], ['hale', 'spire', 340], ['hale', 'highmoor', 385]];
  assert(pairs.every(([a, b, p]) => flightPrice(a, b) === p && flightPrice(b, a) === p), 'all ten flights cost what section 5.2 says: 175, 190 x 4, 250, 260 x 2, 340 and 385');
  assert(flightPrice('highmoor', 'spire') === round5(25 + 1000 / 6) && Math.abs(flightSeconds('highmoor', 'spire') - (6 + 1000 / 75)) < 1e-9, 'Highmoor to the Spire is 25 + distance / 6 rounded to 5: 190 gold');
  s.found.push('hale', 'saltmarrow', 'thornwick', 'highmoor');
  assert(destinationsFrom(s, 'spire').map(d => d.to).sort().join() === 'hale,highmoor,saltmarrow,thornwick' && TOWNS.every(t => FLIGHT_MASTERS.some(f => f.id === t.id)), 'from the Spire you can fly to every other town you have found, and every town has a master');
}

// ---------------------------------------------------------------------------
section('starmetal: Mining 52, and the smithing it opens');
{
  const def = NODE_TYPES.starmetal;
  assert(def.skill === 'mining' && def.level === 52 && def.item === 'starmetal_ore' && def.xp === 1550, 'a starmetal vein is Mining 52 and pays 1,550 XP a swing (0.12 x the cost of its level)');
  const nodes = createNodes(), star = nodes.filter(n => n.type === 'starmetal');
  assert(star.length === 12 && star.every(n => regionAt(n.x, n.z)?.id === 'cairnwaste') && nodes.slice(-12).every(n => n.type === 'starmetal'), 'twelve veins in four stands along the road, and the very last nodes of all: no older id moved');
  assert(star.every(n => Math.abs(n.x - CAIRNWASTE.x) < 24 && waste.spawns!.every(sp => dist(sp, n) > 20)) && star.every(n => !COLLIDERS.some(o => o.kind !== undefined && o.kind !== 'rock' && dist(o, n) < o.r + n.r)), 'each stand is a few paces off the road and 20 or more from every camp, and none is inside a cairn');
  const s = quiet(25);
  setSkill(s, 'mining', 51);
  const n = s.nodes.find(x => x.type === 'starmetal')!;
  beginGather(s, n);
  assert(s.events.some(e => e.t === 'actionfail' && e.reason === 'level' && e.need === 52), 'a Mining 51 hand is told it needs 52');
  s.events.length = 0;
  setSkill(s, 'mining', 52);
  beginGather(s, n);
  assert(s.player.action?.k === 'gather', 'a Mining 52 hand starts to mine it');
  const need = (id: string) => RECIPES.find(r => r.id === id)!;
  assert(need('starmetal_bar').level === 48 && need('starmetal_bar').inputs.some(i => i.id === 'coal' && i.qty === 5) && need('starmetal_helm').level === 49 && need('starmetal_blade').level === 49 && need('starmetal_greaves').level === 51 && need('starmetal_chestplate').level === 53 && need('crownbreaker').level === 54, 'the bar is Smithing 48 with five coal; the set is 49, 51, 53, the blade 49 and Crownbreaker 54');
  const cost = (L: number) => xpForLevel(L + 1) - xpForLevel(L), near5 = (x: number, y: number) => Math.abs(x - y) <= 2.5;
  assert(near5(need('starmetal_bar').xp, 0.25 * cost(48)) && near5(need('starmetal_helm').xp, 0.35 * cost(49)) && near5(need('starmetal_blade').xp, 0.4 * cost(49)) && near5(need('starmetal_greaves').xp, 0.35 * cost(51)) && near5(need('starmetal_chestplate').xp, 0.35 * cost(53)) && near5(need('crownbreaker').xp, 0.4 * cost(54)), 'and the XP follows the ladder\'s rule: a bar 0.25 x the cost of its level, a piece 0.35 x, a blade 0.4 x');
  assert(ITEMS.starmetal_blade.stats!.damage === 80 && ITEMS.crownbreaker.stats!.damage === 100 && ITEMS.starmetal_helm.stats!.armor === 24 && ITEMS.starmetal_chestplate.stats!.armor === 44 && ITEMS.starmetal_greaves.stats!.armor === 32, 'the blade is +80, Crownbreaker +100 and the set 24 / 44 / 32 = 100, by 3.3');
  assert([...STARMETAL_SET, 'starmetal_blade', 'crownbreaker'].every(id => ITEMS[id].tier === 6 && ITEMS[id].req?.combat === 32), 'every starmetal piece is tier 6 and needs combat 32: the requirement binds, as the bible intends');
  assert(deriveStats({ ...emptyEquipment(), head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves' }).armor === 100, 'the set is 100 armour');
  const bar = need('starmetal_bar'), crown = need('crownbreaker');
  assert(!RECIPES.some(r => r.inputs.some(i => i.id === 'crown_shard') && r.id !== 'crownbreaker') && crown.inputs.some(i => i.id === 'crown_shard' && i.qty === 3) && bar.output.id === 'starmetal_bar', 'only Crownbreaker takes Crown shards, three of them');
  // the Cairn King's shard: 35 % a kill, on the roll his crown is on
  const rolls = createState(1);
  for (let i = 0; i < 4000; i++) rollDrops(rolls, 'cairn_king', 0, 0);
  const shards = rolls.drops.filter(d => d.item === 'crown_shard').length, crowns = rolls.drops.filter(d => d.item === 'kings_crown').length;
  assert(Math.abs(shards / 4000 - 0.35) < 0.03 && Math.abs(crowns / 4000 - 0.1) < 0.02, `the Cairn King drops a Crown shard on 35 % of kills (${(shards / 40).toFixed(1)} %) and still the crown on 10 % (${(crowns / 40).toFixed(1)} %)`);
}

// ---------------------------------------------------------------------------
section('the Spire\'s forge: the second one in the world');
{
  const sites = stationSites('forge');
  assert(sites.length === 2 && sites[0] === LANDMARKS.forge && sites[1] === LANDMARKS.forgeSpire && STATIONS.forge!.name === 'forge', 'the forge stands in two places: Hale and the Spire');
  const at = { x: LANDMARKS.forgeSpire.x + 4, z: LANDMARKS.forgeSpire.z }; // (the hut is a collider of 2.6: a player any closer is pushed off, and a push is a move)
  const s = quiet(32);
  s.player.x = at.x; s.player.z = at.z;
  assert(nearStation(s, 'forge') && nearestSite(s, 'forge') === 1 && !nearStation(quiet(1), 'forge'), 'standing at the Spire\'s forge is standing at a forge, and the nearest site is the second');
  setSkill(s, 'smithing', 54);
  addItem(s.player.inventory, 'starmetal_ore', 3); addItem(s.player.inventory, 'coal', 15);
  tick(s, { craft: { recipe: 'starmetal_bar', count: 3 } });
  run(s, 30);
  assert(countItem(s.player.inventory, 'starmetal_bar') >= 3 && countItem(s.player.inventory, 'starmetal_ore') === 0 && s.player.skills.smithing.xp > xpForLevel(54), 'three starmetal bars are smelted there from the ore and fifteen coal');
  addItem(s.player.inventory, 'crown_shard', 3);
  tick(s, { craft: { recipe: 'crownbreaker', count: 1 } });
  run(s, 20);
  assert(countItem(s.player.inventory, 'crownbreaker') === 1 && countItem(s.player.inventory, 'crown_shard') === 0, 'and Crownbreaker is folded from three bars and three Crown shards');
  const hale = quiet(32); hale.player.x = LANDMARKS.forge.x + 4; hale.player.z = LANDMARKS.forge.z;
  assert(nearStation(hale, 'forge') && nearestSite(hale, 'forge') === 0, 'Hale\'s forge is still a forge');
  const click = quiet(32); click.player.x = SPIRE.x; click.player.z = SPIRE.z + 55;
  tick(click, { interact: { k: 'forge', site: 1 } });
  let opened = false;
  for (let i = 0; i < 400 && !opened; i++) { tick(click); opened = click.events.some(e => e.t === 'forge'); }
  assert(opened && nearStation(click, 'forge') && dist(click.player, LANDMARKS.forgeSpire) < 6, 'clicking the Spire\'s forge walks the player over and opens its recipe list');
}

// ---------------------------------------------------------------------------
section('Q7, The Sundered Seal: the Keeper, the ruins, the Warden, the hand-in');
{
  const kp = LANDMARKS.spireKeeper;
  const s = quiet(36);
  s.player.x = kp.x + 2; s.player.z = kp.z; s.player.hp = s.player.maxHp = 1e6;
  assert(NPCS.some(n => n.id === 'spire' && n.name === SPIRE_KEEPER.name) && npcNear(s) === 'spire', 'the Keeper is someone to talk to, and the nearest in earshot');
  assert((s.quest.eighth as string) === 'locked' && keeperMarker(s) === null && dialogueAt(s, 'spire').options.every(o => !o.advance), 'locked until the writ is signed: the Keeper only greets you');
  s.quest.stage = 'done'; s.quest.second = 'cleared'; s.quest.third = 'cleared'; s.quest.fifth = 'cleared'; s.quest.sixth = 'cleared'; s.quest.seventh = 'cleared';
  tick(s);
  assert((s.quest.eighth as string) === 'offer' && keeperMarker(s) === 'offer' && activeQuestView(s).title === QUEST8_NAME && dialogueAt(s, 'spire').options.some(o => o.advance), 'the writ signed: a mark over the Keeper, a tracker, and an offer');
  const kill = (type: string) => {
    const e = s.enemies.find(x => x.type === type)!;
    e.state = 'idle'; e.hp = 1; e.respawnIn = 0; e.x = s.player.x; e.z = s.player.z + 1; e.spawnX = e.x; e.spawnZ = e.z; e.attackCd = 1e9;
    s.targetId = e.id; s.player.energy = s.player.maxEnergy; s.player.cd.fill(0); s.player.gcd = 0; s.player.facing = 0;
    for (let k = 0; k < 40 && (e.state as string) !== 'dead'; k++) tick(s, { ability: STRIKE });
    e.respawnIn = 1e9;
  };
  kill('spire_warden');
  assert((s.quest.eighth as string) === 'offer' && s.quest.kills.spire_warden === undefined, 'a Warden killed before the offer is taken counts for nothing');
  tick(s, { questAdvance: true });
  assert((s.quest.eighth as string) === 'hunt' && keeperMarker(s) === 'wait', 'taken');
  kill('spire_warden');
  assert((s.quest.eighth as string) === 'hunt', 'and the Warden still counts for nothing while the lesser wards stand: it is the last word, not the first');
  for (const [type, n] of Object.entries(SEAL_GOALS)) for (let i = 0; i < n; i++) {
    assert((s.quest.eighth as string) === 'hunt', `${type} ${i + 1} of ${n}: still a hunt`);
    kill(type);
  }
  assert((s.quest.eighth as string) === 'warden' && activeQuestView(s).lines.some(l => l.text.includes('Spire Warden')) && activeQuestView(s).target?.label === 'Spire Warden', 'the last of the lesser wards turns the tracker to the Warden');
  kill('spire_warden');
  assert((s.quest.eighth as string) === 'report' && keeperMarker(s) === 'ready' && activeQuestView(s).ready, 'the Warden makes it a hand-in');
  const xp0 = s.player.combat.xp;
  tick(s, { questAdvance: true });
  assert((s.quest.eighth as string) === 'cleared' && REWARD8[0].xp === 1800 && s.player.combat.xp - xp0 === 1800 && keeperMarker(s) === 'wait', 'handing in pays 1,800 combat XP: 300 over the Moor Writ\'s, as each chain has been (and the Keeper waits, now, for Vael: HOM-112)');
  assert(activeQuestView(s).target?.label === VAULT.keeper && dialogueAt(s, 'spire').options.every(o => !o.advance), 'and the tracker\'s next mark is the Vault\'s keeper, at a door that now opens');
  const rt = deserialize(serialize(s))!;
  assert((rt.quest.eighth as string) === 'cleared' && rt.quest.kills.void_hound === SEAL_GOALS.void_hound, 'the chain survives a save and load');
  const old = JSON.parse(serialize(s)); delete old.quest.eighth;
  assert(deserialize(JSON.stringify(old))!.quest.eighth === 'offer', 'a save from before it, with the writ signed, finds it on offer');
  const old2 = JSON.parse(serialize(quiet(3))); delete old2.quest.eighth;
  assert(deserialize(JSON.stringify(old2))!.quest.eighth === 'locked', 'and one without the writ finds it locked');
  const bad = JSON.parse(serialize(quiet(3))); bad.quest.eighth = 'hunt';
  assert(deserialize(JSON.stringify(bad)) === null, 'a save with it open before the writ is signed is refused');
  assert(levelForXp(xpForLevel(36)) === 36, 'sanity: the player was combat 36 when they took it (the tracker\'s advice)');
}

// ---------------------------------------------------------------------------
section('the Vault\'s door: held until the seal is read, and open after it (HOM-112 built what is behind it)');
{
  assert(VAULT.combat === 38 && VAULT.need === 'sealed' && !VAULT.closed && VAULT.from === 1 && VAULT.keeper === 'Wardkeeper Osric Thale', 'the Vault\'s door asks combat 38 and the Keeper\'s seal (Q7), and is no longer shut for good');
  const gap = VAULT.at - (SPIRE.z - 70);
  assert(gap < 0 && VAULT.at === SPIRE.z - 76, 'the keeper holds the line in the corridor six units past the town\'s floor, so there is no way round it');
  const walkNorth = (level: number, seal: boolean) => {
    const s = quiet(level), mid = (VAULT.span[0] + VAULT.span[1]) / 2;
    if (seal) s.quest.eighth = 'cleared';
    s.player.x = mid; s.player.z = VAULT.at + 6;
    let said: ReturnType<typeof gateEvent>;
    for (let i = 0; i < 90; i++) { tick(s, { dirX: 0, dirZ: -1 }); said ??= gateEvent(s); }
    return { s, said };
  };
  const low = walkNorth(30, false), mid = walkNorth(40, false), full = walkNorth(40, true);
  assert(low.said?.text === VAULT.refuse && low.s.player.z > VAULT.at, 'at 30 the Wardkeeper says the Vault is not for anyone under 38');
  assert(mid.said?.text === VAULT.refuse && mid.s.player.z > VAULT.at, 'at 40, with the seal unread, he holds the door and his line says the seal as well as the level');
  assert(!full.said && full.s.player.z < VAULT.at - 6, 'and at 40 with the seal read he says nothing and lets them through');
  const wall = () => { const s = quiet(40); s.player.x = VAULT.span[0] - 12; s.player.z = VAULT.at + 4; run(s, 3, { dirX: 0, dirZ: -1 }); return s.player.z; };
  assert(wall() > VAULT.at + 1, 'and the wall either side holds');
}

// ---------------------------------------------------------------------------
section('the old world is as it was');
{
  const s = createState(9703);
  assert(s.enemies[0].type === 'boar' && s.enemies[19].id === 20, 'Hale\'s enemies keep their ids');
  assert(TOWNS.slice(0, 4).map(t => t.id).join() === 'hale,saltmarrow,thornwick,highmoor' && regionById('thornseam').rocks.length === 3, 'the first four towns are where they were');
  assert(ITEMS.kings_crown.stats!.armor === 24 && DROP_TABLES.cairn_king.entries.find(e => e.id === 'kings_crown')!.weight === 10, 'the King\'s Crown is as it was');
}

console.log(`\nAll ${checks} Cairnwaste and Spire checks passed.`);

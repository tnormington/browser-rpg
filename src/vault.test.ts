// HOM-112: enchanting at the rune circle, the Sundered Vault, Archmage Vael and the end of Q7.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ENEMY_TYPES, SPAWNS, ENERGY_REGEN, ABILITIES } from './sim/data';
import { DROP_TABLES, ITEMS, EQUIP_SLOTS, deriveStats, emptyEquipment } from './sim/items';
import { CAVE_ROOMS, DUNGEONS, GATES, LANDMARKS, SPIRE, WITHERING, COLLIDERS, caveDepth, dungeonAt, mountsAllowed, regionAt, regionById, dungeonById } from './sim/world';
import { route, evictGrids } from './sim/path';
import { STATIONS, nearStation, stationSites } from './sim/crafting';
import { xpForLevel } from './sim/xp';
import { refreshPlayerStats } from './sim/combat';
import { addItem, countItem } from './sim/inventory';
import { rollDrops } from './sim/loot';
import { deserialize, serialize } from './sim/save';
import { SKILL_IDS, SKILLS, totalLevel } from './sim/skills';
import { ENCHANTS, enchantById, enchantXp, enchantFx } from './sim/enchants';
import { DUST, MIN_DISENCHANT_TIER, canDisenchant, disenchantXp, dustFor, enchantBlocker } from './sim/enchanting';
import { REWARD8B, QUEST8_STAGES, activeQuestView, keeperMarker, dialogueAt, sealRead } from './sim/quest';
import { FLOOR_STEP, GROUND_MARK_Y, floorLift, roomIndices } from './floor-stack';

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
const inRect = (r: { x0: number; x1: number; z0: number; z1: number }, p: { x: number; z: number }, pad = 0) => p.x >= r.x0 + pad && p.x <= r.x1 - pad && p.z >= r.z0 + pad && p.z <= r.z1 - pad;

/** A new game with every enemy laid low for good, the player at combat `level` with health that does not run out (this is about rules, not about surviving). */
function quiet(level = 1): GameState {
  const s = createState(11200);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  p.hp = p.maxHp = 1e6;
  return s;
}
const setSkill = (s: GameState, id: typeof SKILL_IDS[number], level: number) => { s.player.skills[id].xp = xpForLevel(level); s.player.skills[id].level = level; };
const atCircle = (s: GameState) => { s.player.x = LANDMARKS.circle.x + 3; s.player.z = LANDMARKS.circle.z; };
const failOf = (s: GameState) => s.events.find(e => e.t === 'actionfail') as Extract<GameState['events'][number], { t: 'actionfail' }> | undefined;
const bag = (s: GameState, id: string, qty = 1) => { if (addItem(s.player.inventory, id, qty) > 0) throw new Error('bag full'); };
const equipFromBag = (s: GameState, id: string) => { bag(s, id); tick(s, { inv: [{ k: 'equip', slot: s.player.inventory.findIndex(st => st?.id === id) }] }); };

// ---------------------------------------------------------------------------
section('the tenth skill and the rune circle');
{
  assert(SKILL_IDS.length === 10 && SKILL_IDS[9] === 'enchanting' && !!SKILLS.enchanting.name, 'Enchanting is the tenth skill');
  const s = quiet(1);
  assert(s.player.skills.enchanting.level === 1 && totalLevel(s.player.skills) === 10, 'it starts at 1, and the total level counts it');
  assert(!!STATIONS.circle && stationSites('circle').length === 1 && STATIONS.circle.at === LANDMARKS.circle && regionAt(LANDMARKS.circle.x, LANDMARKS.circle.z)?.id === 'spire', 'the rune circle is a station, in the Spire');
  assert(Math.hypot(LANDMARKS.circle.x - LANDMARKS.forgeSpire.x, LANDMARKS.circle.z - LANDMARKS.forgeSpire.z) > 20 && Math.hypot(LANDMARKS.circle.x - LANDMARKS.spireSquare.x, LANDMARKS.circle.z - LANDMARKS.spireSquare.z) < 35, 'across the square from the forge, inside the town\'s safe circle');
  assert(regionById('spire').obstacles.some(o => o.kind === 'circle' && o.x === LANDMARKS.circle.x && o.z === LANDMARKS.circle.z), 'and a solid thing you stand beside');
  s.player.x = LANDMARKS.circle.x + 7; s.player.z = LANDMARKS.circle.z; s.player.hp = s.player.maxHp;
  tick(s, { interact: { k: 'circle' } });
  let opened = false;
  for (let i = 0; i < 200 && !opened; i++) { tick(s); opened = s.events.some(e => e.t === 'circle'); }
  assert(opened && nearStation(s, 'circle'), 'clicking it walks the player over and opens the panel');
}

// ---------------------------------------------------------------------------
section('disenchanting: gear in the bag, ground to dust at the circle');
{
  const s = quiet(36);
  assert(dustFor('iron_chestplate') === 5 && dustFor('steel_sword') === 9 && dustFor('rusty_blade') === 1 && dustFor('starmetal_chestplate') === 69, 'a tenth of the value, never less than one');
  assert(MIN_DISENCHANT_TIER === 2 && !canDisenchant('bronze_helm') && !canDisenchant('rusty_blade') && canDisenchant('iron_helm') && !canDisenchant('copper_ore') && !canDisenchant(DUST), 'tier two and above, and only gear');
  bag(s, 'iron_chestplate');
  s.player.x = LANDMARKS.forge.x; s.player.z = LANDMARKS.forge.z + 3;
  tick(s, { enchant: [{ k: 'disenchant', slot: s.player.inventory.findIndex(st => st?.id === 'iron_chestplate') }] });
  assert(failOf(s)?.reason === 'range' && failOf(s)?.station === 'rune circle' && countItem(s.player.inventory, 'iron_chestplate') === 1 && countItem(s.player.inventory, DUST) === 0, 'away from the circle it does nothing and says where it must be done');
  atCircle(s);
  const slot = s.player.inventory.findIndex(st => st?.id === 'iron_chestplate'), xp0 = s.player.skills.enchanting.xp;
  tick(s, { enchant: [{ k: 'disenchant', slot }] });
  assert(countItem(s.player.inventory, 'iron_chestplate') === 0 && countItem(s.player.inventory, DUST) === 5 && s.player.skills.enchanting.xp - xp0 === disenchantXp('iron_chestplate') && disenchantXp('iron_chestplate') === 45 * 8, 'at the circle the piece is destroyed for five dust and 360 Enchanting XP');
  bag(s, 'bronze_helm'); bag(s, 'copper_ore', 5);
  tick(s, { enchant: [{ k: 'disenchant', slot: s.player.inventory.findIndex(st => st?.id === 'bronze_helm') }, { k: 'disenchant', slot: s.player.inventory.findIndex(st => st?.id === 'copper_ore') }, { k: 'disenchant', slot: 27 }, { k: 'disenchant', slot: -1 }, { k: 'disenchant', slot: 1.5 }] });
  assert(countItem(s.player.inventory, 'bronze_helm') === 1 && countItem(s.player.inventory, 'copper_ore') === 5 && countItem(s.player.inventory, DUST) === 5, 'bronze, ore and an empty or invalid slot are all refused');
  // a worn piece is not in the bag: it cannot be ground
  s.player.equipment.head = 'iron_helm';
  tick(s, { enchant: [{ k: 'disenchant', slot: 0 }] });
  assert(s.player.equipment.head === 'iron_helm', 'what you wear is never ground');
  // a full bag of unstackable gear: the piece's own slot is what the dust goes into
  const f = quiet(36); atCircle(f);
  for (let i = 0; i < 28; i++) f.player.inventory[i] = { id: 'iron_sword', qty: 1 };
  tick(f, { enchant: [{ k: 'disenchant', slot: 0 }] });
  assert(countItem(f.player.inventory, 'iron_sword') === 27 && countItem(f.player.inventory, DUST) === 3, 'with the bag full the freed slot takes the dust');
}

// ---------------------------------------------------------------------------
section('slot enchants: spent on a slot, kept when the item changes');
{
  const bible = Object.fromEntries(ENCHANTS.map(e => [e.id, [e.slots.join('/'), e.level, e.dust]]));
  assert(JSON.stringify(bible) === JSON.stringify({ keen: ['weapon', 36, 40], vigour: ['weapon', 38, 80], warding: ['head/chest/legs/hands/feet', 36, 25], vitality: ['chest', 40, 60] }), 'the four of the bible: Keen, Vigour, Warding, Vitality, at the levels and prices it gives');
  const s = quiet(40); atCircle(s); setSkill(s, 'enchanting', 36);
  equipFromBag(s, 'steel_sword');
  tick(s, { enchant: [{ k: 'enchant', id: 'keen', slot: 'weapon' }] });
  assert(failOf(s)?.reason === 'materials' && s.player.enchants.weapon === undefined, 'no dust: nothing is set, and it says it is short of materials');
  bag(s, DUST, 40);
  const xp0 = s.player.skills.enchanting.xp;
  tick(s, { enchant: [{ k: 'enchant', id: 'keen', slot: 'weapon' }] });
  assert(s.player.enchants.weapon === 'keen' && countItem(s.player.inventory, DUST) === 0 && s.events.some(e => e.t === 'enchanted' && e.id === 'keen') && s.player.stats.crit === 0.03, 'Keen: forty dust, +3% crit');
  assert(s.player.skills.enchanting.xp - xp0 === enchantXp(enchantById('keen')!) && enchantXp(enchantById('keen')!) === Math.round(0.4 * (xpForLevel(37) - xpForLevel(36))), 'paid in Enchanting XP by the ladder\'s blade rule');
  equipFromBag(s, 'forged_blade');
  assert(s.player.equipment.weapon === 'forged_blade' && s.player.stats.crit === 0.03, 'it belongs to the slot: a different sword keeps it');
  tick(s, { inv: [{ k: 'unequip', slot: 'weapon' }] });
  assert((s.player.stats.crit as number) === 0 && s.player.enchants.weapon === 'keen', 'with nothing worn there it does nothing, and is still set');
  equipFromBag(s, 'steel_sword');
  assert(s.player.stats.crit === 0.03, 'and comes back with the next blade');
  s.player.durability.steel_sword = 0;
  tick(s, { inv: [{ k: 'unequip', slot: 'feet' }] });
  Object.assign(s.player.stats, deriveStats(s.player.equipment, s.player.durability, s.player.enchants));
  assert((s.player.stats.crit as number) === 0, 'a broken piece gives nothing, and neither does what is set on it');
  s.player.durability.steel_sword = 100;
  // replacing: consumed when overwritten
  setSkill(s, 'enchanting', 38); bag(s, DUST, 80); equipFromBag(s, 'forged_blade');
  tick(s, { enchant: [{ k: 'enchant', id: 'vigour', slot: 'weapon' }] });
  assert(s.player.enchants.weapon === 'vigour' && (s.player.stats.crit as number) === 0 && s.player.stats.energyRegen === 1 && countItem(s.player.inventory, DUST) === 0, 'Vigour replaces Keen on the slot: the old one is gone, eighty dust spent');
  const e = quiet(40); e.player.energy = 0; setSkill(e, 'enchanting', 38); atCircle(e); equipFromBag(e, 'forged_blade'); bag(e, DUST, 80);
  tick(e, { enchant: [{ k: 'enchant', id: 'vigour', slot: 'weapon' }] });
  const e0 = e.player.energy; e.player.energy = 0; run(e, 1);
  const plain = quiet(40); plain.player.energy = 0; run(plain, 1);
  assert(Math.abs(plain.player.energy - ENERGY_REGEN) < 0.3 && Math.abs(e.player.energy - (ENERGY_REGEN + 1)) < 0.3 && e0 >= 0, `+1 energy a second: ${plain.player.energy.toFixed(1)} a second plain, ${e.player.energy.toFixed(1)} with Vigour`);
  // warding and vitality
  const w = quiet(40); atCircle(w); setSkill(w, 'enchanting', 40); bag(w, DUST, 25 + 25 + 60);
  equipFromBag(w, 'steel_chestplate'); equipFromBag(w, 'iron_helm');
  const a0 = w.player.stats.armor, hp0 = w.player.maxHp;
  tick(w, { enchant: [{ k: 'enchant', id: 'warding', slot: 'weapon' }, { k: 'enchant', id: 'keen', slot: 'chest' }, { k: 'enchant', id: 'warding', slot: 'feet' }] });
  assert(w.player.enchants.weapon === undefined && w.player.enchants.chest === undefined && w.player.enchants.feet === undefined && countItem(w.player.inventory, DUST) === 110, 'an enchant only goes where it belongs, and onto a slot with something worn on it');
  tick(w, { enchant: [{ k: 'enchant', id: 'warding', slot: 'head' }, { k: 'enchant', id: 'warding', slot: 'chest' }] });
  assert(w.player.stats.armor === a0 + 8 && w.player.enchants.head === 'warding' && w.player.enchants.chest === 'warding' && countItem(w.player.inventory, DUST) === 60, 'Warding is +4 armour on each slot it is set on');
  tick(w, { enchant: [{ k: 'enchant', id: 'vitality', slot: 'chest' }] });
  assert(w.player.enchants.chest === 'vitality' && w.player.stats.armor === a0 + 4 && w.player.maxHp === Math.round(hp0 * 1.06) && w.player.hp === w.player.maxHp, 'Vitality on the chest replaces its Warding: +6% max health, and the new health arrives with it');
  tick(w, { inv: [{ k: 'unequip', slot: 'chest' }] });
  assert(w.player.maxHp === hp0 && w.player.hp <= w.player.maxHp, 'and goes with the chestplate when it comes off');
  // the gates
  const g = quiet(40); atCircle(g); setSkill(g, 'enchanting', 35); equipFromBag(g, 'steel_sword'); bag(g, DUST, 200);
  tick(g, { enchant: [{ k: 'enchant', id: 'keen', slot: 'weapon' }] });
  assert(failOf(g)?.reason === 'level' && failOf(g)?.need === 36 && g.player.enchants.weapon === undefined && countItem(g.player.inventory, DUST) === 200 && enchantBlocker(g, 'keen', 'weapon') === 'level', 'at Enchanting 35 Keen asks for 36 and costs nothing');
  g.player.x = LANDMARKS.forge.x; g.player.z = LANDMARKS.forge.z + 3; setSkill(g, 'enchanting', 40);
  tick(g, { enchant: [{ k: 'enchant', id: 'keen', slot: 'weapon' }] });
  assert(g.player.enchants.weapon === undefined && enchantBlocker(g, 'keen', 'weapon') === 'range', 'and away from the circle nothing happens');
  tick(g, { enchant: [{ k: 'enchant', id: 'nonsense', slot: 'weapon' }, { k: 'enchant', id: 'keen', slot: 'nowhere' as never }] });
  assert(g.player.enchants.weapon === undefined, 'an enchant that does not exist, or a slot that does not, is refused');
  const fx = enchantFx(emptyEquipment(), {}, { weapon: 'keen', chest: 'vitality' });
  assert(fx.crit === 0 && fx.hpFrac === 0 && fx.armor === 0, 'enchants on bare slots add nothing');
}

// ---------------------------------------------------------------------------
section('saving: enchants survive, and a hand-edited save cannot invent one');
{
  const s = quiet(40); atCircle(s); setSkill(s, 'enchanting', 40); equipFromBag(s, 'steel_chestplate'); bag(s, DUST, 60);
  tick(s, { enchant: [{ k: 'enchant', id: 'vitality', slot: 'chest' }] });
  const l = deserialize(serialize(s))!;
  assert(l.player.enchants.chest === 'vitality' && l.player.stats.hpFrac === 0.06 && l.player.maxHp === s.player.maxHp && l.player.skills.enchanting.level === 40, 'a save round-trips the enchant, its effect and the skill');
  const old = JSON.parse(serialize(quiet(3))); delete old.player.enchants; delete old.player.xp.enchanting;
  const lo = deserialize(JSON.stringify(old))!;
  assert(lo && Object.keys(lo.player.enchants).length === 0 && lo.player.skills.enchanting.level === 1, 'a save from before the rune circle has none, and starts the skill at 1');
  const bad = (mut: (f: any) => void) => { const f = JSON.parse(serialize(s)); mut(f); return deserialize(JSON.stringify(f)); };
  assert(bad(f => { f.player.enchants = { chest: 'keen' }; }) === null && bad(f => { f.player.enchants = { head: 'nonsense' }; }) === null && bad(f => { f.player.enchants = { toes: 'warding' }; }) === null && bad(f => { f.player.enchants = []; }) === null, 'an enchant on a slot it does not go on, one that does not exist, or a slot that does not: refused');
}

// ---------------------------------------------------------------------------
section('the Vault: three rooms in the Spire\'s frame, behind Thale\'s door');
{
  const vault = dungeonById('vault'), rooms = vault.rooms;
  assert(DUNGEONS.length === 5 && vault.parent === 'spire' && rooms.map(r => r.name).join() === 'sealstair,archive,sanctum', 'the fifth dungeon, three rooms, walked in order: the stair, the archive, the sanctum');
  assert(rooms.every(r => r.rect.x0 >= SPIRE.x - 40 && r.rect.x1 <= SPIRE.x + 40 && r.rect.z1 < SPIRE.z - 70), 'north of the town and its ruins, in the Spire\'s frame');
  const overlap = (a: typeof rooms[0]['rect'], b: typeof rooms[0]['rect']) => ({ w: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), d: Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) });
  const o1 = overlap(rooms[0].rect, rooms[1].rect), o2 = overlap(rooms[1].rect, rooms[2].rect);
  assert(o1.w === 8 && o1.d === 2 && o2.w === 8 && o2.d === 2, 'each pair of rooms overlaps by an eight-wide doorway and no more');
  assert(rooms[0].rect.z1 === SPIRE.z - 82 && regionById('spire').footprint[1].z0 === SPIRE.z - 84, 'the stair opens off the end of the gate\'s corridor, which runs to -84');
  const sanctum = rooms[2].rect;
  assert(sanctum.x1 - sanctum.x0 === 40 && sanctum.z1 - sanctum.z0 === 36, 'the sanctum is the biggest room in the game, forty by thirty-six: a boss who fights from across it needs the length');
  const vaelPost = SPAWNS.find(sp => sp.type === 'archmage_vael')!;
  assert(SPAWNS.filter(sp => sp.type === 'archmage_vael').length === 1 && inRect(sanctum, vaelPost, 3) && dungeonAt(vaelPost.x, vaelPost.z) === vault, 'one Archmage, posted in the sanctum');
  const mine = SPAWNS.filter(sp => dungeonAt(sp.x, sp.z) === vault);
  assert(mine.map(sp => sp.type).sort().join() === 'archmage_vael,rune_golem,rune_golem,rune_golem,spire_adept,spire_adept', 'a golem on the stair, two adepts and two golems in the archive, Vael: the ruins\' own trash and the boss');
  assert(mine.every(sp => !COLLIDERS.some(o => dist(o, sp) < o.r + ENEMY_TYPES[sp.type].radius)), 'no one stands inside a stone');
  assert(mine.every(sp => regionAt(sp.x, sp.z)!.cave && !regionAt(sp.x, sp.z)!.safe), 'and none in the town');
  assert(caveDepth(SPIRE.x, SPIRE.z - 70) === 0 && caveDepth(SPIRE.x, SPIRE.z - 90) > 0 && caveDepth(vaelPost.x, vaelPost.z) === 1, 'the dark comes on down the stair and is full in the sanctum');
  assert(!mountsAllowed(vaelPost.x, vaelPost.z) && mountsAllowed(SPIRE.x, SPIRE.z), 'no mounts in the Vault, as in every dungeon');
  evictGrids();
  const door = { x: SPIRE.x, z: SPIRE.z - 70 };
  const lost = mine.filter(sp => route(door, sp) === null);
  assert(lost.length === 0, 'every enemy of the Vault can be walked to from the corridor\'s mouth');
  const r = route(door, vaelPost)!, pts = [door, ...r], seen = new Set<string | undefined>();
  for (let i = 1; i < pts.length; i++) for (let k = 0; k <= 40; k++) seen.add(dungeonAt(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k / 40, pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k / 40)?.id);
  assert(seen.has('vault') && route(vaelPost, door) !== null, 'and back out again');
  // the wards: three scars of Withering Ground on the sanctum floor, clear of the doorway, the stones and his post
  const wards = WITHERING.filter(h => regionAt(h.x, h.z)?.id === 'sanctum');
  const doorway = { x: SPIRE.x, z: SPIRE.z - 125 };
  assert(wards.length === 3 && wards.every(h => inRect(sanctum, h, h.r + 1) && dist(h, doorway) > h.r + 5 && dist(h, vaelPost) > h.r + 4 && !COLLIDERS.some(o => dist(o, h) < o.r + h.r + 1)), 'three wards in the sanctum, away from the door, his post and every stone');
  assert(regionById('sanctum').hazards!.length === 3, 'they are the sanctum\'s own hazards');
}

// ---------------------------------------------------------------------------
section('the Vault\'s door opens to the seal, and stays open');
{
  const VAULT = GATES.find(g => g.id === 'vault')!;
  const walk = (level: number, stage: GameState['quest']['eighth']) => {
    const s = quiet(level); s.quest.eighth = stage; s.player.x = SPIRE.x; s.player.z = VAULT.at + 6;
    for (let i = 0; i < 150; i++) tick(s, { dirX: 0, dirZ: -1 });
    return s;
  };
  assert(walk(40, 'report').player.z > VAULT.at && walk(40, 'warden').player.z > VAULT.at, 'with the seal unread the door holds');
  assert(walk(40, 'cleared').player.z < VAULT.at - 10 && walk(40, 'closing').player.z < VAULT.at - 10 && walk(40, 'done').player.z < VAULT.at - 10, 'read, and after Vael, it lets through');
  assert(walk(37, 'cleared').player.z > VAULT.at, 'and still not below combat 38');
  const stair = walk(40, 'cleared');
  assert(dungeonAt(stair.player.x, stair.player.z)?.id === 'vault', 'a few seconds on, they are on the Sealed Stair');
  assert(sealRead(quiet(1)) === false && QUEST8_STAGES.join() === 'locked,offer,hunt,warden,report,cleared,closing,done', 'the seal is read from `cleared` on');
}

// ---------------------------------------------------------------------------
section('the last dungeon\'s floors must not bury its boss\'s circles (the class of bug HOM-100 found)');
{
  const idx = roomIndices(CAVE_ROOMS.map(r => r.dungeon)), top = Math.max(...idx);
  assert(floorLift(top) < GROUND_MARK_Y && FLOOR_STEP * (CAVE_ROOMS.length + 1) > GROUND_MARK_Y, `the tallest floor in any dungeon is ${floorLift(top).toFixed(3)}, under the ground marks at ${GROUND_MARK_Y}; stacked across all ${CAVE_ROOMS.length} rooms (as it was) the last would be at ${(FLOOR_STEP * CAVE_ROOMS.length).toFixed(3)}, over them`);
  assert(roomIndices(['a', 'a', 'b', 'a', 'b']).join() === '0,1,0,2,1', 'the index counts within a dungeon');
  assert(DUNGEONS.every(d => d.rooms.length <= 4), 'no dungeon is deeper than four rooms: the lift stays under 0.016');
}

// ---------------------------------------------------------------------------
section('Archmage Vael: the first boss who fights from across the room');
{
  const v = ENEMY_TYPES.archmage_vael;
  assert(v.level === 41 && v.hp === 39915 && v.damage === 81 && v.attackInterval === 2.8 && v.heavy!.damage === 650 && v.hazard!.damage === 285 && v.xp === 610, 'the bible\'s row: level 41, 39,915 HP, hit 81, a 2.8 s swing, a heavy of 650 and a ground mark of 285, 610 XP');
  assert(v.ranged!.holds === true && v.ranged!.range === 18 && v.hazard!.range === 20 && v.respawn === 600 && !v.net, 'a caster who holds his ground: the barrage reaches eighteen, the storm twenty, a ten minute respawn');
  assert(Object.entries(ENEMY_TYPES).filter(([, d]) => d.ranged?.holds).map(([k]) => k).join() === 'archmage_vael', 'and nobody else holds: every other shooter stands and fights');

  const sanctum = regionById('sanctum').footprint[0], post = SPAWNS.find(sp => sp.type === 'archmage_vael')!;
  const arena = (px: number, pz: number) => {
    const s = quiet(41); s.player.x = px; s.player.z = pz;
    const e = s.enemies.find(x => x.type === 'archmage_vael')!;
    e.state = 'idle'; e.hp = e.maxHp; e.respawnIn = 0; e.attackCd = 0;
    return { s, e };
  };
  // across the room: he closes to sixteen and holds there, shooting and marking the ground, and never comes to melee
  const far = arena(post.x, SPIRE.z - 126);
  far.s.enemies.find(x => x.type === 'archmage_vael')!.state = 'chase'; far.s.enemies.find(x => x.type === 'archmage_vael')!.heavyCd = 0;
  const seen = new Set<string>(); let closest = Infinity, slams = 0;
  far.s.player.hp = far.s.player.maxHp = 1e9;
  for (let i = 0; i < 20 / TICK_DT; i++) {
    tick(far.s);
    closest = Math.min(closest, dist(far.e, far.s.player));
    for (const ev of far.s.events) { if (ev.t === 'telegraph') seen.add(ev.kind); if (ev.t === 'slam') slams++; }
  }
  assert(dist(far.e, far.s.player) > 15 && dist(far.e, far.s.player) < 16.3 && closest > 15, `he walks up to sixteen paces (nine tenths of his reach) and stops (${dist(far.e, far.s.player).toFixed(1)}, never nearer than ${closest.toFixed(1)})`);
  assert(seen.has('bolt') && seen.has('ground') && !seen.has('heavy') && slams >= 2, 'from there: the Arc Barrage and the Rune Storm, and no nova for someone who is not in reach of it');
  assert(far.s.player.hp < far.s.player.maxHp && inRect(sanctum, far.e, 0), 'and they land, in the sanctum');
  // a bolt costs him a wind-up you can read, and rock in the way spoils it: it is the same bolt as every shooter\'s
  // in his reach: the nova, which is the one answer to someone close
  const near = arena(post.x, post.z + 4.5);
  const ev = near.s.enemies.find(x => x.type === 'archmage_vael')!;
  ev.state = 'chase'; ev.heavyCd = 0; ev.hazardCd = 99; ev.attackCd = 99;
  const hp0 = near.s.player.hp = near.s.player.maxHp = 1e9;
  let novaTold = false, novaSlam: { radius: number; x: number; z: number } | null = null;
  for (let i = 0; i < 4 / TICK_DT && !novaSlam; i++) { tick(near.s); for (const e of near.s.events) { if (e.t === 'telegraph' && e.kind === 'heavy') novaTold = true; if (e.t === 'slam') novaSlam = e; } }
  assert(novaTold && novaSlam !== null && novaSlam.radius === 6 && Math.abs(novaSlam.x - ev.x) < 0.01, 'close in he answers with the Sundering Nova: a wind-up, then six paces of ground round him');
  assert(hp0 - near.s.player.hp >= 400, `it lands on someone who stays (${Math.round(hp0 - near.s.player.hp)} before armour)`);
  const dodge = arena(post.x, post.z + 4.5);
  const dv = dodge.s.enemies.find(x => x.type === 'archmage_vael')!;
  dv.state = 'chase'; dv.heavyCd = 0; dv.hazardCd = 99; dv.attackCd = 99;
  dodge.s.player.hp = dodge.s.player.maxHp = 1e9;
  let told = false, slammed = false;
  for (let i = 0; i < 4 / TICK_DT && !slammed; i++) {
    tick(dodge.s, told ? { dirZ: 1 } : {}); // the moment the wind-up shows, run out of it
    for (const e of dodge.s.events) { if (e.t === 'telegraph' && e.kind === 'heavy') told = true; if (e.t === 'slam') slammed = true; }
  }
  assert(told && slammed && dodge.s.player.maxHp - dodge.s.player.hp < 100 && dist(dv, dodge.s.player) > 6, 'and stepping out of it is the answer: the ground shakes and nothing lands');
  // Pummel breaks the wind-up, as on every heavy
  const pummel = ABILITIES.findIndex(a => a.kind === 'interrupt');
  const pm = arena(post.x, post.z + 3); const pv = pm.s.enemies.find(x => x.type === 'archmage_vael')!;
  pv.state = 'chase'; pv.heavyCd = 0; pv.hazardCd = 99; pv.attackCd = 99; pm.s.player.hp = pm.s.player.maxHp = 1e9; pm.s.player.facing = Math.PI; pm.s.targetId = pv.id; pm.s.player.cd.fill(0);
  let started = false, interrupted = false, pslam = false;
  for (let i = 0; i < 4 / TICK_DT; i++) {
    tick(pm.s, started && !interrupted ? { ability: pummel } : {});
    for (const e of pm.s.events) { if (e.t === 'telegraph' && e.kind === 'heavy') started = true; if (e.t === 'interrupt') interrupted = true; if (e.t === 'slam') pslam = true; }
  }
  assert(started && interrupted && !pslam, 'Pummel breaks the nova in its wind-up');
  // leash: he does not follow you out of his room
  const lash = arena(post.x, post.z + 12); const lv = lash.s.enemies.find(x => x.type === 'archmage_vael')!;
  lv.state = 'chase'; lash.s.player.hp = lash.s.player.maxHp = 1e9;
  lash.s.player.x = SPIRE.x; lash.s.player.z = SPIRE.z - 100;
  run(lash.s, 12);
  assert(lv.state !== 'chase' || dist(lv, { x: lv.spawnX, z: lv.spawnZ }) <= v.leash + 0.5, 'a player who leaves his room is not followed out of it past the leash');
}

// ---------------------------------------------------------------------------
section('what Vael drops: dust, by the handful, and nothing that has no look');
{
  const t = DROP_TABLES.archmage_vael;
  assert(t.rolls === 2 && t.nothing === 0 && t.entries.length === 1 && t.entries[0].id === DUST && t.entries[0].qty![0] === 30 && t.entries[0].qty![1] === 60, 'two rolls, never nothing, thirty to sixty dust each');
  const s = quiet(41); let total = 0, shaped = true;
  for (let k = 0; k < 50; k++) { s.drops.length = 0; rollDrops(s, 'archmage_vael', 0, 0); shaped &&= s.drops.length === 2 && s.drops.every(d => d.item === DUST && d.qty >= 30 && d.qty <= 60); total += s.drops.reduce((n, d) => n + d.qty, 0); }
  assert(shaped, 'fifty kills: every one is two stacks of dust, thirty to sixty each');
  assert(Math.abs(total / 50 - 90) < 15, `about ninety dust a kill (${(total / 50).toFixed(0)}): a Warding kit and a Vitality, in two kills`);
}

// ---------------------------------------------------------------------------
section('Q7 goes on to the end of the game: Vael, then the Keeper');
{
  const kp = LANDMARKS.spireKeeper;
  const s = quiet(41);
  s.quest.stage = 'done'; s.quest.second = s.quest.third = s.quest.fifth = s.quest.sixth = s.quest.seventh = 'cleared'; s.quest.eighth = 'report';
  s.player.x = kp.x + 2; s.player.z = kp.z;
  tick(s, { questAdvance: true });
  assert((s.quest.eighth as string) === 'cleared' && keeperMarker(s) === 'wait', 'the seal read: the Keeper waits on the Archmage');
  const view = activeQuestView(s);
  assert(view.lines.some(l => l.text.includes('Archmage Vael')) && view.progress === '' && !view.ready, 'the tracker names him');
  const kill = (type: string) => {
    const e = s.enemies.find(x => x.type === type)!;
    e.state = 'idle'; e.hp = 1; e.respawnIn = 0; e.x = s.player.x; e.z = s.player.z + 1; e.spawnX = e.x; e.spawnZ = e.z; e.attackCd = 1e9; e.heavyCd = 1e9; e.hazardCd = 1e9;
    s.targetId = e.id; s.player.energy = s.player.maxEnergy; s.player.cd.fill(0); s.player.gcd = 0; s.player.facing = 0;
    for (let k = 0; k < 40 && (e.state as string) !== 'dead'; k++) tick(s, { ability: 0 });
    e.respawnIn = 1e9;
  };
  const early = quiet(41); early.quest.stage = 'done'; early.quest.second = early.quest.third = early.quest.fifth = early.quest.sixth = early.quest.seventh = 'cleared'; early.quest.eighth = 'hunt';
  { const e = early.enemies.find(x => x.type === 'archmage_vael')!; e.state = 'idle'; e.hp = 1; e.x = early.player.x; e.z = early.player.z + 1; e.attackCd = 1e9; e.heavyCd = 1e9; e.hazardCd = 1e9; early.targetId = e.id; for (let k = 0; k < 40 && (e.state as string) !== 'dead'; k++) tick(early, { ability: 0 }); }
  assert(early.quest.eighth === 'hunt', 'a Vael killed before the seal is read counts for nothing');
  kill('archmage_vael');
  assert((s.quest.eighth as string) === 'closing' && keeperMarker(s) === 'ready' && activeQuestView(s).ready && sealRead(s), 'Vael dead: the Keeper has a hand-in');
  assert(dialogueAt(s, 'spire').options.some(o => o.advance), 'and something to say');
  const c0 = s.player.combat.xp, e0 = s.player.skills.enchanting.xp;
  s.player.x = kp.x + 2; s.player.z = kp.z;
  const rt = deserialize(serialize(s))!;
  assert(rt.quest.eighth === 'closing', 'the stage survives a save and load');
  tick(s, { questAdvance: true });
  assert((s.quest.eighth as string) === 'done' && s.player.combat.xp - c0 === 2400 && s.player.skills.enchanting.xp - e0 === 3000 && REWARD8B.length === 2 && keeperMarker(s) === null, 'the hand-in pays 2,400 combat XP and 3,000 Enchanting XP, and the marks go out');
  assert(activeQuestView(s).lines[0].text.startsWith('Quest complete') && dialogueAt(s, 'spire').options.every(o => !o.advance), 'the tracker says it is over, and the Keeper has nothing more to hand over');
  const again = s.player.combat.xp; tick(s, { questAdvance: true });
  assert(s.player.combat.xp === again, 'it cannot be collected twice');
  assert(deserialize(serialize(s))!.quest.eighth === 'done', 'and the end survives a save');
  const bad = JSON.parse(serialize(quiet(3))); bad.quest.eighth = 'done';
  assert(deserialize(JSON.stringify(bad)) === null, 'a save at the end of it before the writ is signed is refused');
}

console.log(`\nAll ${checks} Vault, Vael and enchanting checks passed.`);

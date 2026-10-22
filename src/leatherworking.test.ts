// HOM-96: leatherworking and its two slots, the second stable, and Highmoor's trainer. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ABILITIES } from './sim/data';
import { LANDMARKS } from './sim/world';
import { HIGH_STABLE, HIGH_TRAINER, VENDORS, vendorNear, SHOP_REACH, applyShopAction } from './sim/shop';
import { MOUNTS, moveSpeed, bestMount } from './sim/mounts';
import { RECIPES, STATIONS, nearStation } from './sim/crafting';
import { EQUIP_SLOTS, ITEMS, DROP_TABLES, HIDE_SET, WOLFSKIN_SET, MARSHHIDE_SET, THORNHIDE_SET, MOORHIDE_SET, deriveStats, emptyEquipment } from './sim/items';
import { ENEMY_TYPES, SPAWNS } from './sim/data';
import { REGIONS } from './sim/world';
import { rollDrops } from './sim/loot';
import { nextRandom } from './sim/rng';
import { SKILL_IDS, totalLevel } from './sim/skills';
import { addItem, countItem } from './sim/inventory';
import { refreshPlayerStats } from './sim/combat';
import { deserialize, serialize } from './sim/save';
import { levelForXp, xpForLevel } from './sim/xp';

/** The five raw hides, and the Leatherworking level each is first tanned at (HOM-102, docs/world-design.md 2.2). */
const HIDE_GATE: Record<string, number> = { boar_hide: 1, wolf_pelt: 10, marsh_hide: 18, thorn_hide: 26, moor_hide: 34 };
const RAW_HIDES = Object.keys(HIDE_GATE);

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
const failed = (s: GameState) => s.events.find(e => e.t === 'actionfail') as Extract<GameState['events'][number], { t: 'actionfail' }> | undefined;

/** A new game with every enemy laid low for good, the player standing at `at` with `gold`. */
function quiet(at: { x: number; z: number }, gold = 0): GameState {
  const s = createState(9600);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  s.player.gold = gold;
  s.player.x = at.x + 2.5; s.player.z = at.z;
  return s;
}
const setCombat = (s: GameState, level: number) => { s.player.combat.xp = xpForLevel(level); s.player.combat.level = level; refreshPlayerStats(s, true); s.player.unlocked = level; };
const setSkill = (s: GameState, id: typeof SKILL_IDS[number], level: number) => { s.player.skills[id].xp = xpForLevel(level); s.player.skills[id].level = level; };

section('The tanning rack: a hide is tanned, then cut into boots, and the boots are worn');
{
  assert(nearStation(quiet(LANDMARKS.rack), 'rack') && STATIONS.rack!.name === 'tanning rack', 'the rack is a station in Highmoor');
  assert(dist(LANDMARKS.rack, LANDMARKS.highSquare) < 35, 'and stands inside the safe ground of the town');
  const s = quiet(LANDMARKS.rack);
  addItem(s.player.inventory, 'boar_hide', 5);
  tick(s, { craft: { recipe: 'hide_boots', count: 1 } });
  assert(failed(s) && s.player.action === null && countItem(s.player.inventory, 'boar_hide') === 5, 'boots cannot be cut from a raw hide (and not at Leatherworking 1 either)');
  tick(s, { craft: { recipe: 'hide_gloves', count: 1 } });
  assert(failed(s)?.reason === 'materials', 'gloves, which level 1 can make, want tanned hide and say so');
  tick(s, { craft: { recipe: 'tanned_hide', count: 5 } });
  run(s, 20);
  const tanned = countItem(s.player.inventory, 'tanned_hide');
  assert(tanned >= 5 && countItem(s.player.inventory, 'boar_hide') === 0 && s.player.skills.leatherworking.xp > 0, 'five boar hides tan into five tanned hides, and pay Leatherworking XP');
  assert(s.player.skills.leatherworking.level >= 2, 'which takes Leatherworking to the 2 that boots ask for');
  tick(s, { craft: { recipe: 'hide_boots', count: 1 } });
  run(s, 8);
  assert(countItem(s.player.inventory, 'hide_boots') === 1 && countItem(s.player.inventory, 'tanned_hide') === tanned - 3, 'three tanned hides make a pair of Hide Boots');
  const slot = s.player.inventory.findIndex(st => st?.id === 'hide_boots');
  tick(s, { inv: [{ k: 'equip', slot }] });
  assert(s.player.equipment.feet === 'hide_boots' && s.player.stats.armor === ITEMS.hide_boots.stats!.armor, 'worn in the feet slot, they count for armour');
  tick(s, { inv: [{ k: 'unequip', slot: 'feet' }] });
  assert(s.player.equipment.feet === null && s.player.stats.armor === 0 && countItem(s.player.inventory, 'hide_boots') === 1, 'and come off again');

  const far = quiet(LANDMARKS.highSquare); addItem(far.player.inventory, 'boar_hide', 1);
  tick(far, { craft: { recipe: 'tanned_hide', count: 1 } });
  assert(failed(far)?.reason === 'range' && failed(far)?.station === 'tanning rack', 'out of reach of the rack it is refused, naming it');
  const green = quiet(LANDMARKS.rack); addItem(green.player.inventory, 'wolf_pelt', 1);
  tick(green, { craft: { recipe: 'wolf_leather', count: 1 } });
  assert(failed(green)?.reason === 'level' && failed(green)?.need === 10, 'a wolf pelt wants Leatherworking 10');
}

section('Two new slots, and the sets that fill them');
{
  assert(EQUIP_SLOTS.includes('hands') && EQUIP_SLOTS.includes('feet') && ITEMS.hide_gloves.slot === 'hands' && ITEMS.hide_boots.slot === 'feet', 'hands and feet are slots of their own');
  const smith = RECIPES.filter(r => (r.station ?? 'forge') === 'forge').flatMap(r => ITEMS[r.output.id].slot ? [ITEMS[r.output.id].slot] : []);
  assert(!smith.includes('hands') && !smith.includes('feet'), 'the smith makes none of them');
  const pairs: [typeof HIDE_SET | typeof WOLFSKIN_SET, number, number][] = [[HIDE_SET, 2, 3], [WOLFSKIN_SET, 5, 7]];
  for (const [set, g, b] of pairs) assert(ITEMS[set[0]].stats!.armor === g && ITEMS[set[1]].stats!.armor === b && set.every(id => RECIPES.some(r => r.output.id === id && r.station === 'rack')), `${set[0]} / ${set[1]}: ${g} and ${b} armour, made at the rack`);
  const kit = deriveStats({ ...emptyEquipment(), hands: 'wolfskin_gloves', feet: 'wolfskin_boots' });
  assert(kit.armor === 12, 'gloves and boots add together');
  assert(RECIPES.filter(r => r.skill === 'leatherworking').every(r => r.inputs.every(i => RAW_HIDES.includes(i.id) || i.id.endsWith('leather') || i.id === 'tanned_hide')), 'leatherworking eats only the hides the player already carries');
  assert(VENDORS.every(v => v.stock.every(id => !RAW_HIDES.includes(id))), 'and no vendor sells a hide');
  const old = JSON.parse(serialize(createState(1))); delete old.player.equipment.hands; delete old.player.equipment.feet; delete old.player.xp.leatherworking;
  const o = deserialize(JSON.stringify(old))!;
  assert(o.player.equipment.hands === null && o.player.skills.leatherworking.level === 1, 'a save from before them loads with both empty and the skill at 1');
  const s = createState(2); s.player.equipment.feet = 'wolfskin_boots'; setSkill(s, 'leatherworking', 12);
  const back = deserialize(serialize(s))!;
  assert(back.player.equipment.feet === 'wolfskin_boots' && back.player.skills.leatherworking.level === 12, 'worn boots and the skill survive a save');
  const bad = JSON.parse(serialize(s)); bad.player.equipment.hands = 'wolfskin_boots';
  assert(deserialize(JSON.stringify(bad)) === null, 'boots in the hands slot refuse the save');
}

section('The three hides (HOM-107): marsh, thorn and moor, their leathers and their six pieces');
{
  const sets: [string, readonly string[], number, number, number, number, number][] = [ // set, [gloves, boots], armour, armour, tier, equip combat, Leatherworking of the gloves
    ['marsh', MARSHHIDE_SET, 8, 10, 3, 18, 18], ['thorn', THORNHIDE_SET, 11, 14, 4, 24, 26], ['moor', MOORHIDE_SET, 15, 18, 5, 32, 34],
  ];
  for (const [name, [gloves, boots], ag, ab, tier, combat, lw] of sets) {
    const g = ITEMS[gloves], b = ITEMS[boots];
    assert(g.slot === 'hands' && b.slot === 'feet' && g.stats!.armor === ag && b.stats!.armor === ab && g.tier === tier && b.tier === tier, `${name}hide: gloves ${ag} and boots ${ab} armour, tier ${tier}`);
    assert(g.req?.combat === combat && b.req?.combat === combat && g.value === 2 * ITEMS[`${name}_leather`].value * 2 && b.value === 2 * ITEMS[`${name}_leather`].value * 3, `...asking combat ${combat}, and each worth twice its leather`);
    assert(ITEMS[`${name}_leather`].value === 2 * ITEMS[`${name}_hide`].value && ITEMS[`${name}_hide`].dropWeight === 0, `...tanning doubles a ${name} hide's worth (a vendor pays ${ITEMS[`${name}_hide`].value}, a tanned one ${ITEMS[`${name}_leather`].value})`);
    const rs = RECIPES.filter(r => r.output.id === gloves || r.output.id === boots || r.output.id === `${name}_leather`);
    assert(rs.length === 3 && rs.every(r => r.skill === 'leatherworking' && r.station === 'rack') && rs.find(r => r.output.id === gloves)!.level === lw, `...three recipes at the rack, the gloves at Leatherworking ${lw}`);
  }
  assert(RECIPES.filter(r => r.station === 'rack').length === 6 + 9, 'nine recipes more: the rack makes fifteen things in all');

  // 1. no recipe takes a hide below its gate: trace every leatherworking recipe back to the raw hide it starts from
  const rawOf = (id: string): string => RAW_HIDES.includes(id) ? id : rawOf(RECIPES.find(r => r.output.id === id)!.inputs[0].id);
  const fromHide = RECIPES.filter(r => r.skill === 'leatherworking').map(r => ({ r, hide: rawOf(r.inputs[0].id) }));
  assert(fromHide.every(({ r, hide }) => r.level >= HIDE_GATE[hide]), 'no recipe takes a hide below its gate: boar from 1, pelt 10, marsh 18, thorn 26, moor 34');
  assert(RAW_HIDES.every(h => fromHide.some(({ r, hide }) => hide === h && r.level === HIDE_GATE[h] && !ITEMS[r.output.id].slot)), 'and each hide is first tanned at exactly its gate');
  const cost = (L: number) => xpForLevel(L + 1) - xpForLevel(L);
  const ladder: [string, number, number][] = [['marsh_leather', 18, 0.25], ['marshhide_gloves', 18, 0.35], ['marshhide_boots', 19, 0.35], ['thorn_leather', 26, 0.15], ['thornhide_gloves', 26, 0.21], ['thornhide_boots', 27, 0.21], ['moor_leather', 34, 0.10], ['moorhide_gloves', 34, 0.14], ['moorhide_boots', 35, 0.14]];
  assert(ladder.every(([id, L, f]) => Math.abs(RECIPES.find(r => r.output.id === id)!.xp - f * cost(L)) <= 0.03 * f * cost(L) + 3), `XP by the ladder's rule: a tan pays 0.25 / 0.15 / 0.10 of the cost of its level, a piece 0.35 / 0.21 / 0.14: ${ladder.map(([id]) => RECIPES.find(r => r.output.id === id)!.xp).join(', ')}`);

  // 2. each new hide drops only in its own region's beasts' tables, as a copy of the beast's existing hide entry
  const zoneOf = new Map<string, Set<string>>();
  for (const r of REGIONS) for (const sp of r.spawns ?? []) zoneOf.set(sp.type, (zoneOf.get(sp.type) ?? new Set()).add(r.zone));
  const HOME: Record<string, string[]> = { marsh_hide: ['saltmarrow', 'grotto', 'dunmere'], thorn_hide: ['thornwick', 'rotroot', 'barrowdowns'], moor_hide: ['highmoor', 'cairnhold', 'cairnwaste'] }; // HOM-111: 2.2 sends moor hide on up the road, to the wastes' three beasts
  const droppers = (hide: string) => Object.entries(DROP_TABLES).filter(([, t]) => t.entries.some(e => e.id === hide)).map(([type]) => type);
  for (const [hide, zones] of Object.entries(HOME)) {
    const types = droppers(hide);
    assert(types.every(t => zoneOf.get(t) && [...zoneOf.get(t)!].every(z => zones.includes(z))), `${hide} drops only from beasts that stand in ${zones.join(' / ')}: ${types.join(', ')}`);
    assert(types.every(t => ENEMY_TYPES[t].respawn < 120 || DROP_TABLES[t].rolls === 3), '...never from a caster or a lone boss');
  }
  assert(droppers('marsh_hide').length === 7 && droppers('thorn_hide').length === 8 && droppers('moor_hide').length === 6, 'seven beasts drop marsh hide, eight thorn and six moor, the Moor\'s three and (HOM-111) the Cairnwaste\'s three (the 18 rows, and three more)');
  const newRows = Object.keys(HOME).flatMap(h => droppers(h).map(t => ({ t, h, e: DROP_TABLES[t].entries.find(e => e.id === h)!, old: DROP_TABLES[t].entries.find(e => e.id === 'boar_hide' || e.id === 'wolf_pelt') })));
  assert(newRows.every(({ e, old }) => old && e.qty![0] === old.qty![0] && e.qty![1] === old.qty![1] && e.weight! / old.weight! >= 0.5 && e.weight! / old.weight! <= 0.67), 'each new entry copies the beast\'s existing hide quantity at half to two thirds of its weight: no shipped hide entry is removed or reduced');
  assert(['boar', 'wolf', 'marsh_hog', 'road_wolf', 'toll_captain', 'old_grey', 'rotwood_cultist', 'barrow_wight', 'moor_raider'].every(t => !newRows.some(r => r.t === t)), 'the road, Hale and every caster are left as they were');
  assert(Object.entries(DROP_TABLES).every(([t, tb]) => !tb.entries.some(e => e.id.endsWith('_leather')) && !(t in ENEMY_TYPES && ENEMY_TYPES[t].level < 14 && tb.entries.some(e => e.id in HOME))), 'nothing drops leather, and nothing under level 14 drops a regional hide');

  // 3. every changed table is still within 1 % of the bible's 0.6 x level + 3 gold a kill (an elite 3x, a rare 4x)
  const ev = (id: string) => {
    const tb = DROP_TABLES[id], w = tb.entries.map(e => e.weight ?? ITEMS[e.id].dropWeight), tot = tb.nothing + w.reduce((a, b) => a + b, 0);
    return tb.rolls * tb.entries.reduce((a, e, i) => a + (w[i] / tot) * (e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1) * ITEMS[e.id].value, 0);
  };
  const worst = newRows.reduce((m, { t }) => Math.max(m, Math.abs(ev(t) / ((0.6 * ENEMY_TYPES[t].level + 3) * (ENEMY_TYPES[t].respawn === 1800 ? 4 : ENEMY_TYPES[t].respawn === 120 ? 3 : 1)) - 1)), 0);
  assert(newRows.length === 21 && worst <= 0.01, `all 21 changed tables (the 18 rows and, HOM-111, the wastes' three) are worth 0.6 x level + 3 a kill to within 1% (the worst is ${(100 * worst).toFixed(2)}%)`);

  // 4. the bag, spent: a bot that fights 3.2's kills and sells nothing is at Leatherworking 26 or more by Highmoor.
  // The kills: 3.2's table from combat 11 (152 of them, quests paying the rest), its XP-per-kill formula below it; at each level the beasts within two below and one above, the ones
  // that respawn in under 100 s (no elites, rares or bosses, which is conservative), weighted by how many of each stand in the world. Real drop rolls, 40 seeds. The spend: each
  // hide is tanned and cut into whatever piece pays most for it, the highest gate first, and nothing is sold.
  const KILLS: Record<number, number> = { 11: 6, 12: 0, 13: 0, 14: 4, 15: 7, 16: 7, 17: 8, 18: 1, 19: 0, 20: 9, 21: 11, 22: 11, 23: 12, 24: 13, 25: 0, 26: 10, 27: 16, 28: 18, 29: 19 };
  const stand = new Map<string, number>(); for (const sp of SPAWNS) stand.set(sp.type, (stand.get(sp.type) ?? 0) + 1);
  const prey = Object.entries(ENEMY_TYPES).filter(([id, d]) => d.respawn < 100 && stand.get(id));
  const killsAt = (L: number) => L >= 11 ? KILLS[L] : Math.ceil(cost(L) / ((20 + L) * 1.51 * 0.95));
  const pieces = RECIPES.filter(r => r.station === 'rack' && ITEMS[r.output.id].slot);
  const tanOf = (leather: string) => RECIPES.find(r => r.output.id === leather)!;
  function tour(seed: number) {
    const s = createState(seed), bag: Record<string, number> = {};
    let kills = 0;
    for (let L = 1; L <= 29; L++) {
      const pool = prey.filter(([, d]) => d.level >= L - 2 && d.level <= L + 1), total = pool.reduce((a, [id]) => a + stand.get(id)!, 0);
      for (let k = 0; k < killsAt(L); k++, kills++) {
        let r = nextRandom(s) * total, type = pool[pool.length - 1][0];
        for (const [id] of pool) if ((r -= stand.get(id)!) < 0) { type = id; break; }
        rollDrops(s, type, 0, 0);
        for (const d of s.drops) bag[d.item] = (bag[d.item] ?? 0) + d.qty;
        s.drops = []; s.events = [];
      }
    }
    const carried = { ...bag };
    let xp = 0;
    for (;;) {
      const lvl = levelForXp(xp);
      const next = pieces.map(p => ({ p, t: tanOf(p.inputs[0].id), q: p.inputs[0].qty })).filter(o => o.p.level <= lvl && o.t.level <= lvl && (bag[o.t.inputs[0].id] ?? 0) >= o.q)
        .sort((a, b) => b.t.level - a.t.level || (b.q * b.t.xp + b.p.xp) / b.q - (a.q * a.t.xp + a.p.xp) / a.q)[0];
      if (next) { bag[next.t.inputs[0].id] -= next.q; xp += next.q * next.t.xp + next.p.xp; continue; }
      const lone = RECIPES.filter(r => r.station === 'rack' && !ITEMS[r.output.id].slot && r.level <= lvl && (bag[r.inputs[0].id] ?? 0) >= 1).sort((a, b) => b.level - a.level)[0];
      if (!lone) break;
      bag[lone.inputs[0].id]--; xp += lone.xp;
    }
    return { level: levelForXp(xp), kills, carried };
  }
  const tours = Array.from({ length: 40 }, (_, i) => tour(7000 + i)), levels = tours.map(t => t.level).sort((a, b) => a - b);
  const mean = (id: string) => (tours.reduce((a, t) => a + (t.carried[id] ?? 0), 0) / tours.length).toFixed(0);
  const stalled = levels.filter(l => l < 18).length;
  console.log(`  the bot: ${tours[0].kills} kills, carrying ${mean('boar_hide')} boar, ${mean('wolf_pelt')} pelt, ${mean('marsh_hide')} marsh, ${mean('thorn_hide')} thorn, ${mean('moor_hide')} moor hide; Leatherworking ${levels.join(' ')}`);
  console.log(`  ${stalled} of 40 tours stalled under 18: fewer boar hides than it takes to open the pelts at Leatherworking 10, which is the weak point the design names`);
  assert(levels[20] >= 26 && levels[39] >= 34, `a bot that fights 3.2's kills and sells nothing reaches Leatherworking ${levels[20]} in the median tour (best ${levels[39]}), where 26 is Thornhide`);

  // 5. the tooltips: every hide says where it goes, so the bag is not sold at the vendor's 2 to 6 gold
  assert(RAW_HIDES.every(h => /Highmoor's tanning rack will want this/.test(ITEMS[h].desc)), "boar hide, wolf pelt and the three new hides each say \"Highmoor's tanning rack will want this\"");
  assert(RAW_HIDES.every(h => /keep it/.test(ITEMS[h].desc)) && ITEMS.boar_hide.value === 2 && ITEMS.wolf_pelt.value === 3, 'and say to keep it, against the 2 and 3 gold a vendor pays for the old two');

  // 6. the equip gate: Moorhide waits for combat 32 however fast the rack made it
  const eq = quiet(LANDMARKS.rack); addItem(eq.player.inventory, 'moorhide_boots', 1);
  setCombat(eq, 31);
  tick(eq, { inv: [{ k: 'equip', slot: 0 }] });
  assert(eq.player.equipment.feet === null && countItem(eq.player.inventory, 'moorhide_boots') === 1, 'Moorhide Boots are refused at combat 31');
  setCombat(eq, 32);
  tick(eq, { inv: [{ k: 'equip', slot: 0 }] });
  assert(eq.player.equipment.feet === 'moorhide_boots' && eq.player.stats.armor === 18, 'and worn at 32, for 18 armour');
  const back = deserialize(serialize(eq))!;
  assert(back.player.equipment.feet === 'moorhide_boots', 'and the pair survives a save');
}

section('The second stable: total level 285 and 3,000 gold');
{
  const m = MOUNTS.find(x => x.id === 'destrier')!;
  assert(m.speed === 13 && m.total === 285 && m.price === 3000 && m.vendor === 'high_stable', 'the second mount: total level 285, 3,000 gold, 13 u/s (bible 4)');
  assert(dist(HIGH_STABLE, LANDMARKS.highStable) === 0 && dist(HIGH_STABLE, LANDMARKS.highSquare) < 35 && HIGH_STABLE.x < LANDMARKS.highSquare.x - 20, 'the stablemaster stands at the town\'s west edge');
  const rich = (gold: number, total: number) => {
    const s = quiet(HIGH_STABLE, gold);
    const per = Math.floor(total / SKILL_IDS.length);
    for (const id of SKILL_IDS) setSkill(s, id, per);
    setSkill(s, 'combat', total - per * (SKILL_IDS.length - 1)); // whatever is left over rides on combat, so the total is exact
    return s;
  };
  const a = rich(5000, 284);
  assert(totalLevel(a.player.skills) === 284, 'a total of 284');
  tick(a, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(a.player.mounts.length === 0 && a.player.gold === 5000 && failed(a)?.reason === 'mount', '284 is turned away and keeps its gold');
  const b = rich(2999, 285);
  tick(b, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(b.player.mounts.length === 0 && b.player.gold === 2999 && failed(b)?.reason === 'gold', '2,999 gold buys nothing');
  const c = rich(3000, 285); c.player.x = HIGH_STABLE.x + SHOP_REACH + 3;
  tick(c, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(c.player.mounts.length === 0 && failed(c)?.reason === 'range', 'out of reach it is refused');
  c.player.x = HIGH_STABLE.x + 2.5;
  const th = quiet(LANDMARKS.thornStable, 9000); for (const id of SKILL_IDS) setSkill(th, id, 40);
  tick(th, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(th.player.mounts.length === 0 && failed(th)?.reason === 'range', 'Thornwick\'s stablemaster does not sell it');
  tick(c, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(c.player.mounts.join() === 'destrier' && c.player.gold === 0 && c.events.some(e => e.t === 'stable'), 'at 285 with 3,000 in reach it is bought and paid for');
  tick(c, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert((c.player.mounts as string[]).length === 1, 'once');
  c.player.mounts.push('courser');
  assert(bestMount(c.player)!.id === 'destrier', 'with both owned the faster is the one ridden');
  c.player.mounted = true;
  assert(moveSpeed(c.player) === 13, '13 u/s in the saddle');
  const back = deserialize(serialize(c))!;
  assert(back.player.mounts.includes('destrier') && moveSpeed(back.player) === 13, 'and it survives a save');
}

section('The Highmoor trainer: Colossus Blow and Last Stand');
{
  const slot = (n: string) => ABILITIES.findIndex(a => a.name === n);
  const cb = ABILITIES[slot('Colossus Blow')], ls = ABILITIES[slot('Last Stand')];
  assert(cb.kind === 'strike' && cb.unlockLevel === 25 && cb.trainer?.price === 500 && cb.damage === 60 && cb.weaponMult === 2.5 && cb.cost === 55 && cb.cooldown === 18, 'Colossus Blow: combat 25, 500 g, 60 + 2.5 x weapon, 55 energy, 18 s');
  assert(ls.kind === 'heal' && ls.unlockLevel === 30 && ls.trainer?.price === 750 && ls.damage === 140 && ls.cost === 40 && ls.cooldown === 90, 'Last Stand: combat 30, 750 g, a heal of 140, 40 energy, 90 s');
  assert(dist(HIGH_TRAINER, LANDMARKS.highTrainer) === 0 && dist(HIGH_TRAINER, LANDMARKS.highSquare) < 35 && vendorNear(quiet(HIGH_TRAINER)) === undefined, 'the trainer stands in Highmoor and sells nothing from a bag');
  const s = quiet(HIGH_TRAINER, 499); setCombat(s, 25);
  applyShopAction(s, { k: 'learn', slot: slot('Colossus Blow') });
  assert(!s.player.learned.includes('Colossus Blow') && s.player.gold === 499 && failed(s)?.reason === 'gold', '499 gold does not buy it');
  s.player.gold = 5000;
  applyShopAction(s, { k: 'learn', slot: slot('Last Stand') });
  assert(!s.player.learned.includes('Last Stand') && s.player.gold === 5000 && s.events.some(e => e.t === 'fail' && e.reason === 'locked'), 'Last Stand at combat 25 is locked, and costs nothing');
  applyShopAction(s, { k: 'learn', slot: slot('Colossus Blow') });
  assert(s.player.learned.includes('Colossus Blow') && (s.player.gold as number) === 4500, 'at 25 with the gold it is learned');
  setCombat(s, 30);
  applyShopAction(s, { k: 'learn', slot: slot('Last Stand') });
  assert(s.player.learned.includes('Last Stand') && (s.player.gold as number) === 3750, 'and at 30, Last Stand');
  s.player.hp = 1; s.player.energy = s.player.maxEnergy; s.player.gcd = 0; s.player.x = LANDMARKS.highSquare.x; s.player.z = LANDMARKS.highSquare.z;
  tick(s, { ability: slot('Last Stand') });
  assert(s.player.hp > s.player.maxHp * 0.3, `Last Stand heals (${s.player.hp} of ${s.player.maxHp})`);
  const far = quiet(LANDMARKS.thornTrainer, 5000); setCombat(far, 30);
  applyShopAction(far, { k: 'learn', slot: slot('Colossus Blow') });
  assert(!far.player.learned.includes('Colossus Blow') && failed(far)?.reason === 'range', 'it is taught only in Highmoor');
}

console.log(`\n${checks} checks passed`);

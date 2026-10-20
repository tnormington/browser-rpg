// HOM-96: leatherworking and its two slots, the second stable, and Highmoor's trainer. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ABILITIES } from './sim/data';
import { LANDMARKS } from './sim/world';
import { HIGH_STABLE, HIGH_TRAINER, VENDORS, vendorNear, SHOP_REACH, applyShopAction } from './sim/shop';
import { MOUNTS, moveSpeed, bestMount } from './sim/mounts';
import { RECIPES, STATIONS, nearStation } from './sim/crafting';
import { EQUIP_SLOTS, ITEMS, HIDE_SET, WOLFSKIN_SET, deriveStats, emptyEquipment } from './sim/items';
import { SKILL_IDS, totalLevel } from './sim/skills';
import { addItem, countItem } from './sim/inventory';
import { refreshPlayerStats } from './sim/combat';
import { deserialize, serialize } from './sim/save';
import { xpForLevel } from './sim/xp';

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
  assert(EQUIP_SLOTS.length === 6 && ITEMS.hide_gloves.slot === 'hands' && ITEMS.hide_boots.slot === 'feet', 'six slots: hands and feet are new');
  const smith = RECIPES.filter(r => (r.station ?? 'forge') === 'forge').flatMap(r => ITEMS[r.output.id].slot ? [ITEMS[r.output.id].slot] : []);
  assert(!smith.includes('hands') && !smith.includes('feet'), 'the smith makes none of them');
  const pairs: [typeof HIDE_SET | typeof WOLFSKIN_SET, number, number][] = [[HIDE_SET, 2, 3], [WOLFSKIN_SET, 5, 7]];
  for (const [set, g, b] of pairs) assert(ITEMS[set[0]].stats!.armor === g && ITEMS[set[1]].stats!.armor === b && set.every(id => RECIPES.some(r => r.output.id === id && r.station === 'rack')), `${set[0]} / ${set[1]}: ${g} and ${b} armour, made at the rack`);
  const kit = deriveStats({ ...emptyEquipment(), hands: 'wolfskin_gloves', feet: 'wolfskin_boots' });
  assert(kit.armor === 12, 'gloves and boots add together');
  assert(RECIPES.filter(r => r.skill === 'leatherworking').every(r => r.inputs.every(i => i.id === 'boar_hide' || i.id === 'wolf_pelt' || i.id.endsWith('leather') || i.id === 'tanned_hide')), 'leatherworking eats only the hides the player already carries');
  assert(VENDORS.every(v => v.stock.every(id => id !== 'boar_hide' && id !== 'wolf_pelt')), 'and no vendor sells a hide');
  const old = JSON.parse(serialize(createState(1))); delete old.player.equipment.hands; delete old.player.equipment.feet; delete old.player.xp.leatherworking;
  const o = deserialize(JSON.stringify(old))!;
  assert(o.player.equipment.hands === null && o.player.skills.leatherworking.level === 1, 'a save from before them loads with both empty and the skill at 1');
  const s = createState(2); s.player.equipment.feet = 'wolfskin_boots'; setSkill(s, 'leatherworking', 12);
  const back = deserialize(serialize(s))!;
  assert(back.player.equipment.feet === 'wolfskin_boots' && back.player.skills.leatherworking.level === 12, 'worn boots and the skill survive a save');
  const bad = JSON.parse(serialize(s)); bad.player.equipment.hands = 'wolfskin_boots';
  assert(deserialize(JSON.stringify(bad)) === null, 'boots in the hands slot refuse the save');
}

section('The second stable: total level 250 and 3,000 gold');
{
  const m = MOUNTS.find(x => x.id === 'destrier')!;
  assert(m.speed === 13 && m.total === 250 && m.price === 3000 && m.vendor === 'high_stable', 'the second mount: total level 250, 3,000 gold, 13 u/s (bible 4)');
  assert(dist(HIGH_STABLE, LANDMARKS.highStable) === 0 && dist(HIGH_STABLE, LANDMARKS.highSquare) < 35 && HIGH_STABLE.x < LANDMARKS.highSquare.x - 20, 'the stablemaster stands at the town\'s west edge');
  const rich = (gold: number, total: number) => {
    const s = quiet(HIGH_STABLE, gold);
    const per = Math.floor(total / SKILL_IDS.length);
    for (const id of SKILL_IDS) setSkill(s, id, per);
    setSkill(s, 'combat', total - per * (SKILL_IDS.length - 1)); // whatever is left over rides on combat, so the total is exact
    return s;
  };
  const a = rich(5000, 249);
  assert(totalLevel(a.player.skills) === 249, 'a total of 249');
  tick(a, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(a.player.mounts.length === 0 && a.player.gold === 5000 && failed(a)?.reason === 'mount', '249 is turned away and keeps its gold');
  const b = rich(2999, 250);
  tick(b, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(b.player.mounts.length === 0 && b.player.gold === 2999 && failed(b)?.reason === 'gold', '2,999 gold buys nothing');
  const c = rich(3000, 250); c.player.x = HIGH_STABLE.x + SHOP_REACH + 3;
  tick(c, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(c.player.mounts.length === 0 && failed(c)?.reason === 'range', 'out of reach it is refused');
  c.player.x = HIGH_STABLE.x + 2.5;
  const th = quiet(LANDMARKS.thornStable, 9000); for (const id of SKILL_IDS) setSkill(th, id, 40);
  tick(th, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(th.player.mounts.length === 0 && failed(th)?.reason === 'range', 'Thornwick\'s stablemaster does not sell it');
  tick(c, { shop: [{ k: 'mount', id: 'destrier' }] });
  assert(c.player.mounts.join() === 'destrier' && c.player.gold === 0 && c.events.some(e => e.t === 'stable'), 'at 250 with 3,000 in reach it is bought and paid for');
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

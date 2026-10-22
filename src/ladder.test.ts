// HOM-176: the ladder past 48 (docs/combat-99.md 6.2 and check 9 of 8.1). What it proves: seven blades at the weapon line's numbers with their Smithing gates and the road up to them,
// the last armour step reaching the cap and nothing past it, six abilities that are bought and never granted, and a fifth talent tier whose fifteen effects each move the rule they name.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState, Enemy } from './sim';
import { ABILITIES, AUTO_SLOT, ENEMY_TYPES } from './sim/data';
import {
  ARMOR_K, TIER_COLORS, ECHOHIDE_SET, ECHO_BLADE_COUNT, ITEMS, MAX_REDUCTION, deriveStats, emptyEquipment, echoBladeDamage, echoBladeId, echoBladeLevel, echoBladeSmithing,
  MOORHIDE_SET, STARMETAL_SET,
} from './sim/items';
import { ECHO_BAR_LEVELS, ECHO_BLADE_BARS, ECHO_BLADE_MARKS, ECHO_BLADE_SHARDS, ECHO_LEATHER_LEVEL, RECIPES, STATIONS, recipeById } from './sim/crafting';
import { addItem, countItem } from './sim/inventory';
import { ECHO_MARKS, ECHO_MARK_ITEM, ECHO_SHARDS, ECHO_SHARD_ITEM, ROLES, dress, echoArmour, weaponLine } from './sim/echo';
import { xpForLevel } from './sim/xp';
import { refreshPlayerStats, abilityOpen, cooldownOf, harmPlayer } from './sim/combat';
import { applyShopAction, vendorById } from './sim/shop';
import { BUFFS, buffedDamage, buffedOutgoing } from './sim/consumables';
import { CAPSTONE_TIER, TALENTS, TIER_COST, TREE_IDS, deriveTalents, learnBlocked, legalTalents, refreshTalents, spentTotal, talentPoints } from './sim/talents';
import { ITEM_LOOKS, TIER_LOOKS } from './gear-look';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => { for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i); };
const slotOf = (name: string) => ABILITIES.findIndex(a => a.name === name);
const cost = (l: number) => xpForLevel(l + 1) - xpForLevel(l);
const within = (a: number, b: number, rel: number) => Math.abs(a / b - 1) <= rel;
const st = (e: Enemy): string => e.state;

function breakSeal(s: GameState) {
  Object.assign(s.quest, { stage: 'done', second: 'cleared', third: 'cleared', fourth: 'cleared', fifth: 'cleared', sixth: 'cleared', seventh: 'cleared', eighth: 'done' });
}
/** A world with nothing alive, the player at `level`, and one boar (given the health of a wall) standing `gap` in front of them: what an ability is thrown at. */
function arena(seed: number, level: number, gap = 2.5, learned = true) {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level; p.unlocked = level;
  if (learned) p.learned = ABILITIES.filter(a => a.trainer).map(a => a.name);
  refreshPlayerStats(s, true);
  p.energy = p.maxEnergy;
  const e = s.enemies.find(x => x.type === 'boar')!;
  e.state = 'idle'; e.respawnIn = 0; e.hp = e.maxHp = 1e8; e.attackCd = 1e9; e.x = e.spawnX = 0; e.z = e.spawnZ = 0;
  p.x = 0; p.z = gap; p.facing = Math.PI;
  tick(s, { clickEnemy: e.id });
  return { s, p, e };
}
/** Another body of the same species at (x, z), alive and idle and as tough as a wall, for the checks that are about a crowd. */
function addBody(s: GameState, x: number, z: number): Enemy {
  const e = s.enemies.find(o => o.type === 'boar' && st(o) === 'dead')!;
  Object.assign(e, { state: 'idle', respawnIn: 0, deadFor: 0, hp: 1e8, maxHp: 1e8, attackCd: 1e9, x, z, spawnX: x, spawnZ: z, cast: null, bleed: null, stagger: 0 });
  return e;
}
/** What one press of an ability does to the wall, from a seed: the damage events' sum. */
function press(seed: number, level: number, name: string, ranks: Record<string, number> = {}, tweak: (a: ReturnType<typeof arena>) => void = () => {}, gap = 2.5) {
  const a = arena(seed, level, gap);
  Object.assign(a.p.talents, ranks); refreshTalents(a.s);
  tweak(a);
  const before = a.e.hp;
  tick(a.s, { ability: slotOf(name) });
  const hits = a.s.events.filter(ev => ev.t === 'hit' && ev.target !== 'player');
  return { dealt: before - a.e.hp, hits, a };
}

// ---------------------------------------------------------------------------
section('check 9: seven blades at the weapon line, each with its gates and a look');
{
  const W = weaponLine; // the line the Echo rows are built against: the same function, so a blade is checked against what the enemy was sized for
  assert(ECHO_BLADE_COUNT === 7, 'there are seven');
  const want = [119, 140, 161, 182, 202, 223, 244];
  const have = Array.from({ length: 7 }, (_, i) => ITEMS[echoBladeId(i + 1)]);
  assert(have.every(d => d !== undefined && d.slot === 'weapon'), 'every one is a weapon in the item table');
  assert(have.map(d => d.stats!.damage).join() === want.join(), `their damage is the line's 119, 140, 161, 182, 202, 223 and 244 (${have.map(d => d.stats!.damage).join(', ')})`);
  assert(have.every((d, i) => Math.abs(d.stats!.damage! - W(echoBladeLevel(i + 1))) <= 0.5 && echoBladeDamage(i + 1) === want[i]), 'each is W(L) = 36 + 2.6 (L - 16) at the level it arrives, to the nearest point');
  assert(have.every((d, i) => d.req?.combat === 48 + 8 * i && d.req.combat === echoBladeLevel(i + 1)), 'and asks for the level it arrives at: 48, 56, 64, 72, 80, 88, 96');
  assert(have.every(d => d.stats!.speed === ITEMS.crownbreaker.stats!.speed), 'at the swing speed Crownbreaker has: the damage line, not the rhythm, moves');
  const steps = have.map((d, i) => d.stats!.damage! / (i === 0 ? ITEMS.crownbreaker.stats!.damage! : have[i - 1].stats!.damage!) - 1);
  assert(steps.every(g => g >= 0.08 && g <= 0.2) && steps.every((g, i) => i === 0 || g < steps[i - 1]), `each step is +8 to +20 % on the last, the ones the first 41 levels give, and they shrink (${steps.map(g => (100 * g).toFixed(0)).join(', ')} %)`);
  assert(have.every((d, i) => d.tier === (i < 3 ? 7 : 8)) && TIER_COLORS.length > 8, 'blades 1 to 3 are tier 7 and 4 to 7 tier 8, and the tier colours reach them');
  assert(have.every((_, i) => ITEM_LOOKS[echoBladeId(i + 1)]?.blade === i + 1) && TIER_LOOKS.length > 8, 'each has a look of its own on the character, not the tier fallback');
  const gates = Array.from({ length: 7 }, (_, i) => recipeById(echoBladeId(i + 1))!);
  assert(gates.every(r => r && r.skill === 'smithing' && r.station === undefined && r.output.id === r.id), 'each is a Smithing recipe at the forge');
  assert(gates.map(r => r.level).join() === '60,66,72,78,84,90,96' && gates.every((r, i) => r.level === echoBladeSmithing(i + 1) && r.level === 54 + 6 * (i + 1)), 'gated at Smithing 54 + 6k: 60, 66, 72, 78, 84, 90, 96');
  assert(gates.every(r => countItem([{ id: ECHO_MARK_ITEM, qty: ECHO_BLADE_MARKS }], ECHO_MARK_ITEM) === 20 && r.inputs.find(i => i.id === ECHO_MARK_ITEM)?.qty === 20), 'and 20 Echo marks, which is what 7.2 prices a step at');
  assert(gates.every(r => r.inputs.every(i => ['echo_bar', ECHO_SHARD_ITEM, ECHO_MARK_ITEM].includes(i.id)) && r.inputs.find(i => i.id === 'echo_bar')!.qty === ECHO_BLADE_BARS && r.inputs.find(i => i.id === ECHO_SHARD_ITEM)!.qty === ECHO_BLADE_SHARDS),
    'made of Echo shards, Echo marks and bars tempered with a shard: no new ore, there is no region to put a node in');
  assert(gates.every(r => Math.abs(r.xp / cost(r.level) - 0.4) < 0.001), "and pay 0.4 of the cost of their level, which is the rule Crownbreaker's 6,305 is");
  assert(!RECIPES.some(r => r.inputs.some(i => i.id === 'warden_shard' || i.id === 'starmetal_ore') && r.output.id.startsWith('echo_blade')), 'no blade asks for a node');

  // the gate has to be reachable: nothing past the starmetal bar pays Smithing XP but the Echo bar, so the bar must climb the same ladder the blades do
  const bars = ECHO_BAR_LEVELS.map((level, i) => recipeById(`echo_bar_${i + 1}`)!);
  assert(bars.length === 7 && bars.every((r, i) => r.skill === 'smithing' && r.level === ECHO_BAR_LEVELS[i] && r.output.id === 'echo_bar' && Math.abs(r.xp / cost(r.level) - 0.25) < 0.001), 'the Echo bar is made at seven levels, each paying 0.25 of its own level, the bar rule');
  assert(bars[0].level === recipeById('crownbreaker')!.level && bars.every((r, i) => i === 0 || r.level === gates[i - 1].level), 'the first bar opens where Crownbreaker leaves a smith (54), and each next one at the gate before it');
  let from = 54;
  const prior: number[] = [];
  for (const g of gates) {
    const best = bars.filter(r => r.level <= from).sort((a, b) => b.level - a.level)[0];
    const crafts = (xpForLevel(g.level) - xpForLevel(from)) / best.xp;
    prior.push(Math.ceil(crafts));
    from = g.level;
  }
  assert(prior.every(n => n >= 20 && n <= 40), `from one gate to the next is 20 to 40 bars at the best recipe open (${prior.join(', ')}): a pole, and not a wall of ${(9.5e6 / 2175).toFixed(0)} starmetal bars`);
}

// ---------------------------------------------------------------------------
section('the blades and the bars are smithed, end to end');
{
  const s = createState(41);
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  const p = s.player, site = STATIONS.forge!.at;
  p.x = site.x + 2; p.z = site.z; p.inventory.fill(null);
  p.skills.smithing.xp = xpForLevel(60); p.skills.smithing.level = 60;
  const stock = (id: string, qty: number) => addItem(p.inventory, id, qty);
  const make = (recipe: string, count = 1) => { tick(s, { craft: { recipe, count } }); for (let n = 0; n < 6000 && (s.player.action !== null); n++) tick(s); };
  stock('echo_bar', ECHO_BLADE_BARS); stock(ECHO_SHARD_ITEM, ECHO_BLADE_SHARDS); stock(ECHO_MARK_ITEM, ECHO_BLADE_MARKS - 1);
  make('echo_blade_1');
  assert(countItem(p.inventory, 'echo_blade_1') === 0, 'a blade is not made one mark short');
  stock(ECHO_MARK_ITEM, 1);
  make('echo_blade_2');
  assert(countItem(p.inventory, 'echo_blade_2') === 0, "and Blade 2's gate (Smithing 66) is not met at 60");
  make('echo_blade_1');
  assert(countItem(p.inventory, 'echo_blade_1') === 1 && countItem(p.inventory, ECHO_MARK_ITEM) === 0 && countItem(p.inventory, 'echo_bar') === 0, 'at 60 with the bars, the shards and the 20 marks it is, and they are spent');
  const xp0 = p.skills.smithing.xp;
  stock('starmetal_bar', 1); stock(ECHO_SHARD_ITEM, 1);
  make('echo_bar_1');
  assert(countItem(p.inventory, 'echo_bar') >= 1 && countItem(p.inventory, 'starmetal_bar') === 0 && p.skills.smithing.xp - xp0 === recipeById('echo_bar_1')!.xp, 'a starmetal bar and a shard make an Echo bar, and the bar pays the Smithing XP the road is made of');
  stock('starmetal_bar', 1); stock(ECHO_SHARD_ITEM, 1);
  make('echo_bar_4');
  assert(countItem(p.inventory, 'echo_bar') === 1, 'the bar at Smithing 72 is shut at 60');
}

// ---------------------------------------------------------------------------
section('check 9: the last armour step reaches the cap, and a point past it is worth nothing');
{
  const set = (...ids: string[]) => ({ ...emptyEquipment(), head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves', hands: ids[0] ?? null, feet: ids[1] ?? null });
  const armor = (e: ReturnType<typeof set>) => deriveStats(e).armor;
  assert(armor(set(...MOORHIDE_SET)) === 133 && echoArmour(47) === 133, 'before the step the best kit is 133: the starmetal set and Moorhide');
  const full = deriveStats(set(...ECHOHIDE_SET));
  assert(full.armor === 160 && echoArmour(48) === 160 && full.reduction === MAX_REDUCTION, `with the Echohide pair it is 160, the cap, and 80 % off (${full.armor}, ${(100 * full.reduction).toFixed(0)} %)`);
  assert(160 / (160 + ARMOR_K) === MAX_REDUCTION, 'which is exactly where armour / (armour + 40) meets MAX_REDUCTION');
  const past = deriveStats({ ...set(...ECHOHIDE_SET) }, {}, {});
  assert(Math.min(MAX_REDUCTION, 161 / (161 + ARMOR_K)) === past.reduction && Math.min(MAX_REDUCTION, 200 / 240) === past.reduction, 'and 161 (or 200) is worth nothing more: the reduction does not move');
  assert(ECHOHIDE_SET.every(id => ITEMS[id].req?.combat === 48 && ITEMS[id].tier >= 6 && ITEM_LOOKS[id]?.form === 'echohide'), 'the pair asks for combat 48, is worn at the top of the ladder, and has its own look');
  const steps = RECIPES.filter(r => r.skill === 'leatherworking' && r.output.id.startsWith('echo'));
  assert(steps.length === 3 && steps.every(r => r.level >= ECHO_LEATHER_LEVEL && r.station === 'rack'), 'it is made at the rack: tan the leather in marks, then cut the gloves and the boots');
  const leather = recipeById('echo_leather')!.inputs.find(i => i.id === ECHO_MARK_ITEM)!.qty * (recipeById('echohide_gloves')!.inputs[0].qty + recipeById('echohide_boots')!.inputs[0].qty);
  assert(leather === 10, 'ten marks the pair, half of one blade step');
  assert(!Object.keys(ITEMS).some(id => ITEMS[id].slot && ['head', 'chest', 'legs', 'hands', 'feet'].includes(ITEMS[id].slot!) && (ITEMS[id].stats?.armor ?? 0) > 44 && !['starmetal_chestplate'].includes(id)), 'and there is no armour past it to go looking for');
}

// ---------------------------------------------------------------------------
section('Echo shards drop from elites, rares and bosses, once the Seal is broken');
{
  assert(ECHO_SHARDS.trash === 0 && ECHO_SHARDS.elite === 1 && ECHO_SHARDS.rare === 1 && ECHO_SHARDS.boss === 2 && ITEMS[ECHO_SHARD_ITEM].stack >= 99, 'a trash kill leaves none, an elite and a rare one and a boss two; the shard stacks');
  assert(Math.abs(ECHO_SHARDS.elite / ECHO_MARKS.elite - 1) < 1e-9 && ECHO_SHARDS.boss < ECHO_MARKS.boss, 'about two shards for every three marks');
  const kill = (type: string, echo: -3 | 0 | 3 | null) => {
    const s = createState(9);
    for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
    const p = s.player;
    p.combat.xp = xpForLevel(80); p.combat.level = 80; p.unlocked = 80; refreshPlayerStats(s, true);
    breakSeal(s); p.echo = echo;
    const e = s.enemies.find(x => x.type === type)!;
    Object.assign(e, { state: 'idle', respawnIn: 0, deadFor: 0, x: e.spawnX, z: e.spawnZ, cast: null, bleed: null });
    dress(s, e); e.hp = 1;
    p.x = e.x + 1.5; p.z = e.z; p.energy = p.maxEnergy; p.cd.fill(0); p.gcd = 0;
    tick(s, { clickEnemy: e.id });
    for (let n = 0; n < 60 && st(e) !== 'dead'; n++) tick(s, { ability: 0 });
    const held = (item: string) => countItem(p.inventory, item) + s.drops.filter(d => d.item === item).reduce((a, d) => a + d.qty, 0);
    return { shards: held(ECHO_SHARD_ITEM), marks: held(ECHO_MARK_ITEM) };
  };
  for (const [type, shards] of [['rune_golem', 0], ['spire_warden', 1], ['old_grey', 1], ['archmage_vael', 2]] as [string, number][]) {
    const k = kill(type, 0);
    assert(k.shards === shards && ECHO_SHARDS[ROLES[type]] === shards && k.marks === ECHO_MARKS[ROLES[type]], `${ENEMY_TYPES[type].name} (${ROLES[type]}) at 80 drops ${shards} shard${shards === 1 ? '' : 's'} and ${k.marks} mark${k.marks === 1 ? '' : 's'}`);
  }
  assert(kill('spire_warden', null).shards === 0, 'an authored kill, with the switch off, drops none');
}

// ---------------------------------------------------------------------------
section('check 9: six abilities, bought and never granted');
{
  const six = ['Rampart', 'Reaping Blow', 'Shockwave', 'Echo Surge', 'Bloodbath', 'Final Reckoning'];
  const prices = [4158, 4914, 5670, 6426, 7182, 7862], levels = [50, 60, 70, 80, 90, 99];
  const defs = six.map(n => ABILITIES[slotOf(n)]);
  assert(defs.every(d => d !== undefined), 'all six are in the book');
  assert(defs.every((d, i) => d.unlockLevel === levels[i]) && defs.map(d => d.unlockLevel).join() === '50,60,70,80,90,99', 'at 50, 60, 70, 80, 90 and 99');
  assert(defs.every((d, i) => d.trainer?.price === prices[i] && d.trainer.vendor === 'high_trainer') && !defs.some(d => d.talent), 'each is sold by a trainer at 4,158 / 4,914 / 5,670 / 6,426 / 7,182 / 7,862 gold, and none is a talent');
  assert(prices.reduce((a, b) => a + b, 0) === 36212 && levels.every((L, i) => Math.round((0.6 * L + 3) * 1.4 * 90) === prices[i]), '36,212 in all: an hour of that band\'s gold income each');
  assert(vendorById('high_trainer') !== undefined && ABILITIES.length === 22, 'the trainer exists, and the book is 22');
  assert(six.every((n, i) => slotOf(n) === 16 + i), 'they are entries 17 to 22, in the order they open: no slot a save already holds moves, and the loadout bar (HOM-179) can take the book as the list in order');
  assert(ABILITIES.slice(0, 16).every(a => a.unlockLevel < 50), 'the sixteen before them are all under 50');

  // a level-99 character who has bought nothing has none of them; a purchase opens exactly one
  const s = createState(5);
  const p = s.player, trainer = vendorById('high_trainer')!;
  p.combat.xp = xpForLevel(99); p.combat.level = 99; p.unlocked = 99; refreshPlayerStats(s, true);
  p.x = trainer.x + 2; p.z = trainer.z; p.gold = 100000;
  assert(six.every(n => !abilityOpen(p, slotOf(n))), 'at 99 with the gold and none of them bought, none is open: nothing is granted by level');
  tick(s, { ability: slotOf('Rampart') });
  assert(s.events.some(e => e.t === 'fail' && e.reason === 'locked' && e.slot === slotOf('Rampart')), 'and pressing one says it is locked');
  const g0 = p.gold;
  applyShopAction(s, { k: 'learn', slot: slotOf('Final Reckoning') });
  assert(abilityOpen(p, slotOf('Final Reckoning')) && p.gold === g0 - 7862 && six.filter(n => abilityOpen(p, slotOf(n))).length === 1, 'buying Final Reckoning opens it for 7,862 gold and nothing else');
  const low = createState(6);
  low.player.combat.xp = xpForLevel(49); low.player.combat.level = 49; low.player.unlocked = 49; low.player.x = trainer.x + 2; low.player.z = trainer.z; low.player.gold = 100000;
  applyShopAction(low, { k: 'learn', slot: slotOf('Rampart') });
  assert(!abilityOpen(low.player, slotOf('Rampart')) && low.player.gold === 100000, 'and a trainer will not sell Rampart at 49: the level still binds');
}

// ---------------------------------------------------------------------------
section('what the six do');
{
  // Rampart: three quarters off, and Steadfast takes a share of what is left
  const { s, p } = arena(11, 50);
  p.buffs = [];
  assert(buffedDamage(p, 1000) === 1000, 'with no buff a hit is the hit');
  tick(s, { ability: slotOf('Rampart') });
  assert(p.buffs.some(b => b.id === 'rampart') && ABILITIES[slotOf('Rampart')].offGcd && p.gcd === 0 && buffedDamage(p, 1000) === 250 && BUFFS.rampart.duration === 2.5, 'Rampart is off the global cooldown, and for 2.5 seconds takes a hit of 1,000 down to 250');
  run(s, 2.6);
  assert(!p.buffs.some(b => b.id === 'rampart') && buffedDamage(p, 1000) === 1000, 'and is gone after it');
  p.cd.fill(0); p.energy = p.maxEnergy;
  tick(s, { ability: slotOf('Guard') });
  tick(s, { ability: slotOf('Rampart') });
  assert(buffedDamage(p, 1000) === 125, 'stacked on Guard it is an eighth: two cooldowns spent for one hit you could not step out of');

  // Reaping Blow: the big hit, bigger. Against Colossus Blow on the same wall from the same seed
  const colossus = press(12, 60, 'Colossus Blow'), reaping = press(12, 60, 'Reaping Blow');
  assert(reaping.dealt > colossus.dealt * 1.15 && reaping.dealt < colossus.dealt * 1.6, `Reaping Blow hits ${(reaping.dealt / colossus.dealt).toFixed(2)}x a Colossus Blow at 60 (${colossus.dealt} to ${reaping.dealt}), on a longer cooldown`);
  assert(ABILITIES[slotOf('Reaping Blow')].cooldown > ABILITIES[slotOf('Colossus Blow')].cooldown && ABILITIES[slotOf('Reaping Blow')].cost > ABILITIES[slotOf('Colossus Blow')].cost, 'and it costs more energy and comes back later');

  // Shockwave: two bodies, one of them winding up, one idle, and one outside the sweep: the two in it are held
  const sw = arena(13, 70, 2);
  const b2 = addBody(sw.s, 2.5, 0), far = addBody(sw.s, 9, 9);
  sw.e.cast = { kind: 'heavy', t: 0.2, total: 1.7 };
  tick(sw.s, { ability: slotOf('Shockwave') });
  assert(sw.e.stagger > 0 && b2.stagger > 0 && far.stagger === 0 && sw.e.cast === null, 'Shockwave staggers everything it hits, cutting a wind-up short, and nothing it does not reach');
  assert(sw.s.events.filter(ev => ev.t === 'interrupt').length === 2, 'and says so once for each');

  // Echo Surge: everything hits half again as hard, on top of Battle Fury
  const flat = press(14, 80, 'Strike'), surge = press(14, 80, 'Strike', {}, a => { a.p.buffs.push({ id: 'echo_surge', left: 15 }); });
  assert(within(surge.dealt, flat.dealt * 1.5, 0.02), `a Strike under Echo Surge lands 1.5x (${flat.dealt} to ${surge.dealt})`);
  const both = createState(1).player; both.buffs.push({ id: 'echo_surge', left: 15 }, { id: 'battle_fury', left: 20 });
  assert(Math.abs(buffedOutgoing(both) - 1.5 * 1.15) < 1e-9 && ABILITIES[slotOf('Echo Surge')].offGcd && ABILITIES[slotOf('Echo Surge')].cooldown >= 60, 'it stacks with Battle Fury (1.5 x 1.15), is off the GCD and comes back no sooner than a minute');

  // Bloodbath: a third of what the whole sweep deals comes back, so a pair pays double
  const bb = arena(15, 90, 2);
  addBody(bb.s, 2.5, 0);
  bb.p.hp = Math.floor(bb.p.maxHp * 0.3);
  const hp0 = bb.p.hp;
  tick(bb.s, { ability: slotOf('Bloodbath') });
  const swept = bb.s.events.filter(ev => ev.t === 'hit' && ev.target !== 'player') as Extract<typeof bb.s.events[number], { t: 'hit' }>[];
  const healed = bb.s.events.filter(ev => ev.t === 'heal').reduce((n, ev) => n + (ev as { amount: number }).amount, 0);
  const total = swept.reduce((n, ev) => n + ev.amount, 0);
  assert(swept.length === 2 && Math.abs(healed - Math.round(total * 0.3)) <= 1 && bb.p.hp - hp0 === healed, `Bloodbath on two bodies deals ${total} and heals ${healed}, 30 % of the sweep`);
  const one = press(15, 90, 'Bloodbath', {}, a => { a.p.hp = Math.floor(a.p.maxHp * 0.3); }, 2);
  const healedOne = one.a.s.events.filter(ev => ev.t === 'heal').reduce((n, ev) => n + (ev as { amount: number }).amount, 0);
  assert(healedOne > 0 && healed > healedOne * 1.7, `against one body it heals ${healedOne}: a pair is a feast`);

  // Final Reckoning: six times the weapon, and nearly all the energy
  const fr = press(16, 99, 'Final Reckoning', {}, a => { a.p.stats.weaponDamage = 244; }, 2.5), col = press(16, 99, 'Colossus Blow', {}, a => { a.p.stats.weaponDamage = 244; }, 2.5);
  assert(fr.dealt > col.dealt * 2 && ABILITIES[slotOf('Final Reckoning')].cost >= 85 && ABILITIES[slotOf('Final Reckoning')].cooldown >= 45, `Final Reckoning deals ${(fr.dealt / col.dealt).toFixed(1)}x a Colossus Blow at 99, for nearly all the bar and a long cooldown`);
  assert(fr.a.p.energy < 20, 'it leaves the bar nearly empty');
}

// ---------------------------------------------------------------------------
section('check 9: the fifth talent tier, fifteen effects at four ranks');
{
  const PAST = TIER_COST.length - 1;
  assert(TIER_COST.join() === '0,2,4,8,12,18' && CAPSTONE_TIER === 4 && PAST === 5, 'TIER_COST is 0, 2, 4, 8, 12 and 18');
  const fifth = TALENTS.filter(t => t.tier === PAST);
  assert(fifth.length === 15 && TREE_IDS.every(t => fifth.filter(x => x.tree === t).length === 5) && fifth.every(t => t.ranks === 4), 'five talents of four ranks a tree: fifteen in all');
  const total = TALENTS.reduce((n, t) => n + t.ranks, 0);
  assert(total === 54 + 60 && total === 114 && fifth.reduce((n, t) => n + t.ranks, 0) === 60, 'sixty more ranks, 114 in all');
  assert(talentPoints(99) === 98 && talentPoints(99) <= total && total - talentPoints(99) === 16, 'against 98 points at 99: at most the ranks, with 16 left over, so a build at 99 is still a choice');
  assert(talentPoints(55) === 54 && 54 === TALENTS.filter(t => t.tier < PAST).reduce((n, t) => n + t.ranks, 0), 'the 54 ranks of the first five tiers are all bought by 55, and the new ones are what the 44 points past it are for');
  assert(new Set(TALENTS.map(t => t.id)).size === TALENTS.length && fifth.every(t => !t.prereq), 'no id is reused, and the tier asks for nothing but the points: the tree itself is what opens it');
  const lower = (tree: string) => Object.fromEntries(TALENTS.filter(t => t.tree === tree && t.tier < PAST).map(t => [t.id, t.ranks]));
  const nearly = (tree: string) => { const b = lower(tree); const last = TALENTS.filter(t => t.tree === tree && t.tier === CAPSTONE_TIER)[0]; b[last.id]--; return b; };
  assert(TREE_IDS.every(tree => learnBlocked(nearly(tree), 99, fifth.find(t => t.tree === tree)!.id) === 'tier'), '17 points in a tree leave its fifth tier shut');
  assert(TREE_IDS.every(tree => learnBlocked(lower(tree), 99, fifth.find(t => t.tree === tree)!.id) === null), 'and 18 open it: it opens for a finished tree and for no other');
  const build = { ...lower('fury'), ...lower('bulwark'), ...lower('hunt') };
  for (const t of fifth.filter(x => x.tree === 'fury')) build[t.id] = 4;
  for (const t of fifth.filter(x => x.tree === 'bulwark').slice(0, 4)) build[t.id] = 4;
  assert(spentTotal(build) === 54 + 20 + 16 && legalTalents(build, 99) && !legalTalents(build, 60), 'a 90-point build is legal at 99 and not at 60');
  assert(!legalTalents({ ...nearly('hunt'), rupture: 1 }, 99), 'and a rank in the fifth tier of a tree that is not finished is not');
  const all = Object.fromEntries(TALENTS.map(t => [t.id, t.ranks]));
  assert(!legalTalents(all, 99) && legalTalents(all, 116), 'nobody has all of them at 99: 114 would take level 115');
  assert(fifth.every(t => [1, 2, 3, 4].every(r => t.desc(r).length > 10) && t.desc(1) !== t.desc(4)), 'every one says in words what its rank does, and the words change with the rank');
  const fx0 = JSON.stringify(deriveTalents({}));
  assert(fifth.every(t => JSON.stringify(deriveTalents({ [t.id]: 4 })) !== fx0), 'and every one moves the derived effects, so none is a name with nothing behind it');
  assert(fifth.every(t => Object.keys(deriveTalents({ [t.id]: 1 })).filter(k => (deriveTalents({ [t.id]: 1 }) as unknown as Record<string, number>)[k] !== (deriveTalents({}) as unknown as Record<string, number>)[k]).length === 1), 'exactly one effect each: fifteen effects over nine, not a few effects spread over fifteen names');
}

// ---------------------------------------------------------------------------
section('the fifteen effects, one by one, against the rule each one bends');
{
  const R = (id: string, n = 4) => ({ [id]: n });
  const near = (a: number, b: number, tol = 0.012) => Math.abs(a / b - 1) <= tol;

  // Fury
  const crush0 = press(21, 70, 'Crushing Blow'), crush4 = press(21, 70, 'Crushing Blow', R('annihilator'));
  const strike0 = press(21, 70, 'Strike'), strike4 = press(21, 70, 'Strike', R('annihilator'));
  const bt0 = press(21, 70, 'Reaping Blow'), bt4 = press(21, 70, 'Reaping Blow', R('annihilator'));
  assert(near(crush4.dealt, crush0.dealt * 1.24) && near(bt4.dealt, bt0.dealt * 1.24) && strike4.dealt === strike0.dealt, `Annihilator: Crushing Blow and Reaping Blow hit 24 % harder at four ranks (${crush0.dealt} to ${crush4.dealt}, ${bt0.dealt} to ${bt4.dealt}) and Strike does not move`);

  const finish = (ranks: Record<string, number>) => {
    const { s, p, e } = arena(22, 60);
    Object.assign(p.talents, ranks); refreshTalents(s);
    p.hp = Math.floor(p.maxHp * 0.5); const hp0 = p.hp; e.hp = 1; p.energy = 10;
    const before = p.energy;
    tick(s, { ability: 0 });
    return { dead: st(e) === 'dead', energy: p.energy - (before - 10) - 0, hp: p.hp - hp0, p, s };
  };
  const k0 = finish({}), k4 = finish({ ...R('momentum'), ...R('triumph') });
  assert(k0.dead && k4.dead && Math.abs((k4.energy - k0.energy) - 32) < 0.01, `Momentum: a kill gives back 32 energy at four ranks (${k0.energy.toFixed(1)} to ${k4.energy.toFixed(1)})`);
  assert(k0.hp <= 1 && Math.abs(k4.hp - Math.round(k4.p.maxHp * 0.08)) <= 1 && k4.hp > 0, `Triumph: a kill heals 8 % of maximum health at four ranks (${k0.hp} to ${k4.hp} of ${k4.p.maxHp})`);

  /** The damage of the first auto-attack swing a fresh arena throws, from a seed. */
  const swung = (ranks: Record<string, number>) => {
    const { s, p } = arena(23, 60, 1.5);
    Object.assign(p.talents, ranks); refreshTalents(s);
    p.swing = 0; let amt = 0; tick(s, { attack: true });
    for (let n = 0; n < 30 && !amt; n++) { for (const ev of s.events) if (ev.t === 'hit' && ev.slot === AUTO_SLOT) amt = ev.amount; if (!amt) tick(s); }
    return amt;
  };
  const a0 = swung({}), a4 = swung(R('savagery'));
  assert(a0 > 0 && near(a4, a0 * 1.32, 0.02), `Savagery: an auto-attack swing hits 32 % harder at four ranks (${a0} to ${a4})`);

  const fury0 = press(24, 60, 'Strike', {}, a => { a.p.buffs.push({ id: 'battle_fury', left: 20 }); }), fury4 = press(24, 60, 'Strike', R('warcry'), a => { a.p.buffs.push({ id: 'battle_fury', left: 20 }); });
  assert(near(fury4.dealt, fury0.dealt * (1.31 / 1.15), 0.02), `Warcry: Battle Fury is 31 % at four ranks and not 15 (${fury0.dealt} to ${fury4.dealt})`);
  const wounded0 = press(25, 60, 'Strike', {}, a => { a.e.hp = a.e.maxHp * 0.3; }), wounded4 = press(25, 60, 'Strike', R('cull'), a => { a.e.hp = a.e.maxHp * 0.3; });
  const healthy4 = press(25, 60, 'Strike', R('cull')), healthy0 = press(25, 60, 'Strike');
  assert(near(wounded4.dealt, wounded0.dealt * 1.24) && healthy4.dealt === healthy0.dealt, `Cull: everything hits 24 % harder below 35 % health (${wounded0.dealt} to ${wounded4.dealt}) and the same above it`);

  // Bulwark
  const guard4 = createState(1).player; guard4.buffs.push({ id: 'guard', left: 4 }, { id: 'rampart', left: 2.5 });
  guard4.talents.steadfast = 4; refreshTalents({ player: guard4 } as unknown as GameState);
  assert(buffedDamage(guard4, 1000) === Math.round(1000 * 0.5 * 0.25 * 0.6 * 0.6) && buffedDamage(createState(1).player, 1000) === 1000, 'Steadfast: Guard and Rampart each take 40 % off what they left at four ranks, and nothing else is touched');
  const pl = createState(2).player; pl.talents.concussion = 4; pl.talentFx = deriveTalents(pl.talents);
  const bash = slotOf('Shield Bash'), throwSlot = slotOf('Serrated Throw');
  assert(cooldownOf(pl, bash) === ABILITIES[bash].cooldown - 12 && cooldownOf(createState(2).player, bash) === ABILITIES[bash].cooldown, `Concussion: Shield Bash comes back 12 seconds sooner at four ranks (${ABILITIES[bash].cooldown} to ${ABILITIES[bash].cooldown - 12})`);
  const hurt = (ranks: Record<string, number>) => { const s = createState(3); Object.assign(s.player.talents, ranks); refreshTalents(s); s.player.energy = 0; harmPlayer(s, 'boar', undefined, 10, 'Melee'); return s.player.energy; };
  assert(hurt({}) === 0 && hurt(R('adrenaline')) === 12, 'Adrenaline: a hit that lands gives back 12 energy at four ranks, and none without it');
  // Deflection: a bolt from a distance, the same bolt, from the same seed
  const bolt = (ranks: Record<string, number>) => {
    const s = createState(4);
    for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
    const p = s.player; p.combat.xp = xpForLevel(40); p.combat.level = 40; p.unlocked = 40; refreshPlayerStats(s, true);
    Object.assign(p.talents, ranks); refreshTalents(s);
    const shooter = s.enemies.find(e => e.type === 'spire_adept')!; // a caster that only ever throws: no slam, no net, no pack
    Object.assign(shooter, { state: 'chase', respawnIn: 0, deadFor: 0, attackCd: 0, x: shooter.spawnX, z: shooter.spawnZ, cast: null });
    p.x = shooter.spawnX + 6; p.z = shooter.spawnZ; p.hp = p.maxHp;
    let dmg = 0;
    for (let n = 0; n < 200 && !dmg; n++) { tick(s); p.x = shooter.spawnX + 6; p.z = shooter.spawnZ; for (const ev of s.events) if (ev.t === 'hit' && ev.target === 'player' && ev.species === shooter.type) dmg = ev.amount; }
    return dmg;
  };
  const b0 = bolt({}), b4 = bolt(R('deflection'));
  assert(b0 > 20 && near(b4, b0 * 0.76, 0.04), `Deflection: a bolt hurts 24 % less at four ranks (${b0} to ${b4})`);

  // Hunt
  assert(cooldownOf(pl, throwSlot) === ABILITIES[throwSlot].cooldown && (() => { const q = createState(2).player; q.talents.openveins = 4; q.talentFx = deriveTalents(q.talents); return cooldownOf(q, throwSlot) === ABILITIES[throwSlot].cooldown - 6; })(),
    `Open Veins: Serrated Throw comes back 6 seconds sooner at four ranks (${ABILITIES[throwSlot].cooldown} to ${ABILITIES[throwSlot].cooldown - 6})`);
  const reach = (ranks: Record<string, number>, gap: number) => {
    const { s, p } = arena(26, 60, gap);
    Object.assign(p.talents, ranks); refreshTalents(s);
    tick(s, { ability: slotOf('Cleave') });
    return s.events.some(ev => ev.t === 'hit' && ev.target !== 'player');
  };
  const cleaveRange = ABILITIES[slotOf('Cleave')].range;
  assert(!reach({}, cleaveRange + 1.0) && reach(R('farreach'), cleaveRange + 1.0) && !reach(R('farreach'), cleaveRange + 1.8) && reach({}, cleaveRange - 0.5), `Far Reach: Cleave reaches 1.6 units further at four ranks (${cleaveRange} to ${cleaveRange + 1.6})`);
  const drain = (ranks: Record<string, number>) => {
    const { s, p, e } = arena(27, 60);
    Object.assign(p.talents, ranks); refreshTalents(s);
    e.bleed = { ticks: 3, timer: 0.05, interval: 1, damage: 5 };
    p.hp = Math.floor(p.maxHp * 0.5); const hp0 = p.hp;
    run(s, 0.2);
    return { healed: p.hp - hp0, p };
  };
  const d0 = drain({}), d4 = drain(R('lifeblood'));
  assert(d0.healed === 0 && Math.abs(d4.healed - Math.round(d4.p.maxHp * 0.012)) <= 1 && d4.healed > 0, `Lifeblood: a bleed tick heals 1.2 % of maximum health at four ranks (${d0.healed} to ${d4.healed} of ${d4.p.maxHp})`);
  // Predator's Eye: crits against a bleeder, counted over many identical swings
  const crits = (ranks: Record<string, number>, bleeding: boolean) => {
    const { s, p, e } = arena(28, 60);
    Object.assign(p.talents, ranks); refreshTalents(s);
    let n = 0;
    for (let i = 0; i < 700; i++) {
      p.energy = p.maxEnergy; p.cd.fill(0); p.gcd = 0; e.hp = e.maxHp;
      if (bleeding) e.bleed = { ticks: 99, timer: 99, interval: 99, damage: 0 };
      tick(s, { ability: 0 });
      n += s.events.filter(ev => ev.t === 'hit' && ev.target !== 'player' && ev.crit).length;
    }
    return n;
  };
  const c0 = crits({}, true), c4 = crits(R('predatoreye'), true), c4plain = crits(R('predatoreye'), false), c0plain = crits({}, false);
  assert(c4 - c0 > 50 && c4 - c0 < 120 && c4plain === c0plain, `Predator's Eye: +12 % crit against a bleeder (${c0} to ${c4} in 700 swings of ~${(100 * c0 / 700).toFixed(0)} %), and none against anything else (${c0plain} and ${c4plain})`);
  // Rupture: Hemorrhage spends 60 % more of the wound at four ranks
  const rupt = (ranks: Record<string, number>) => {
    const a = arena(29, 60, 4);
    Object.assign(a.p.talents, { hemorrhage: 1 }, ranks); refreshTalents(a.s); // the capstone is what hands the ability over
    a.e.bleed = { ticks: 10, timer: 1, interval: 1, damage: 100 };
    tick(a.s, { ability: slotOf('Hemorrhage') });
    const hits = a.s.events.filter(ev => ev.t === 'hit' && ev.target !== 'player') as { amount: number }[];
    return hits[hits.length - 1].amount;
  };
  assert(rupt({}) === 1000 && rupt(R('rupture')) === 1600, `Rupture: Hemorrhage pays out ${rupt(R('rupture'))} of a 1,000 wound at four ranks, 60 % more`);
}

console.log(`\nAll ${checks} ladder checks passed.`);

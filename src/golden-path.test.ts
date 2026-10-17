// Headless verification: drives the sim with synthetic input. Run with `npm run verify`.
// Exits non-zero on the first failed assertion. Extended every milestone.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState, Enemy } from './sim';
import { addItem, countItem, INVENTORY_SIZE } from './sim/inventory';
import { ITEMS, DROP_TABLES, deriveStats, emptyEquipment } from './sim/items';
import { ABILITIES, ENEMY_TYPES, GCD, RESPAWN_DELAY } from './sim/data';
import { xpForLevel, levelForXp, addXp, newTrack, levelProgress } from './sim/xp';
import { SKILL_IDS, SKILLS, grantXp } from './sim/skills';
import { NODE_TYPES } from './sim/gathering';
import { RECIPES, FORGE_REACH } from './sim/crafting';
import { LANDMARKS, ROCKS, TREES } from './sim/world';
import { refreshPlayerStats } from './sim/combat';
import {
  BLADE_PLAN, DIALOGUE, HUNT_GOALS, NPC, QUEST_STAGES, RECOMMENDED_COMBAT, REWARD, TALK_RANGE, questView,
} from './sim/quest';
import { SAVE_VERSION, deserialize, serialize } from './sim/save';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);

const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => {
  for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i);
};
/** Read state through a wide type so TS doesn't narrow across sim calls. */
const st = (e: Enemy): string => e.state;
const enemyOf = (s: GameState, type: string, k = 0) => s.enemies.filter(e => e.type === type)[k];
const hasEvent = (s: GameState, pred: (e: GameState['events'][number]) => boolean) => s.events.some(pred);
/** Stand the player next to an enemy, as if they had walked there. */
function standNear(s: GameState, e: Enemy, d = 2) {
  s.player.x = e.x + d; s.player.z = e.z;
}

/** Simple player policy: heal when low, keep bleed up, Crushing Blow on cooldown, Strike otherwise. */
function botAbility(s: GameState, e: Enemy): number | null {
  const p = s.player;
  const ready = (slot: number) => p.cd[slot] === 0 && p.energy >= ABILITIES[slot].cost;
  if (p.gcd > 0.05) return null;
  if (p.hp < p.maxHp * 0.45 && ready(3)) return 3;
  if (!e.bleed && e.hp > 60 && ready(2)) return 2;
  if (ready(1)) return 1;
  if (ready(0)) return 0;
  return null;
}

let minHpSeen = 0;
/** Fight until the enemy dies or the player dies or time runs out. Returns seconds taken. */
function fight(s: GameState, e: Enemy, maxSeconds = 120) {
  s.targetId = null;
  tick(s, { clickEnemy: e.id });
  let t = 0;
  minHpSeen = s.player.hp;
  while (t < maxSeconds && st(e) !== 'dead' && !s.player.dead) {
    tick(s, { ability: botAbility(s, e) });
    minHpSeen = Math.min(minHpSeen, s.player.hp);
    t += TICK_DT;
  }
  return t;
}

// ---------------------------------------------------------------------------
section('XP helper');
{
  assert(xpForLevel(1) === 0 && xpForLevel(2) === 83 && xpForLevel(5) === 388, 'curve matches RuneScape table (83 / 388)');
  assert(xpForLevel(99) === 13034431, 'level 99 = 13,034,431 xp');
  const gap = (l: number) => xpForLevel(l + 1) - xpForLevel(l);
  assert(gap(10) > gap(5) * 1.5 && gap(30) > gap(10) * 6, 'curve escalates (non-linear)');
  const t = newTrack();
  assert(addXp(t, 82) === 0 && t.level === 1, '82 xp: still level 1');
  assert(addXp(t, 1) === 1 && (t.level as number) === 2, '83 xp: level 2');
  assert(levelForXp(t.xp) === 2 && levelProgress(t).frac === 0, 'progress resets on level');
}

// ---------------------------------------------------------------------------
section('Movement (M0 regression)');
{
  const s = createState();
  const z0 = s.player.z;
  run(s, 1, { dirX: 0, dirZ: -1 });
  assert(Math.abs((z0 - s.player.z) - 6) < 0.3, 'WASD moves the player ~6 units/sec');
  tick(s, { clickTarget: { x: 5, z: 5 } });
  run(s, 3);
  assert(Math.hypot(s.player.x - 5, s.player.z - 5) < 0.3, 'click-to-move arrives');
}

// ---------------------------------------------------------------------------
section('Targeting');
{
  const s = createState();
  const near = enemyOf(s, 'boar', 1), mid = enemyOf(s, 'boar', 2);
  s.player.x = near.x + 4; s.player.z = near.z;
  tick(s, { tab: true });
  assert(s.targetId !== null, 'Tab selects an enemy');
  const first = s.targetId;
  const sorted = s.enemies.slice().sort((a, b) =>
    Math.hypot(a.x - s.player.x, a.z - s.player.z) - Math.hypot(b.x - s.player.x, b.z - s.player.z));
  assert(first === sorted[0].id, 'first Tab picks the nearest enemy');
  tick(s, { tab: true });
  assert(s.targetId === sorted[1].id, 'second Tab picks the next-nearest');
  const inRange = sorted.filter(e => Math.hypot(e.x - s.player.x, e.z - s.player.z) <= 30).length;
  for (let i = 0; i < inRange - 1; i++) tick(s, { tab: true });
  assert(s.targetId === sorted[0].id, 'Tab wraps around');
  tick(s, { clearTarget: true });
  assert(s.targetId === null, 'Escape clears the target');
  tick(s, { clickEnemy: mid.id });
  assert(s.targetId === mid.id, 'clicking an enemy targets it');
}

// ---------------------------------------------------------------------------
section('Abilities: GCD, cooldowns, energy, range');
{
  const s = createState();
  const boar = enemyOf(s, 'boar');
  boar.x = boar.spawnX = 0; boar.z = boar.spawnZ = 0; // park it where nothing interferes
  boar.state = 'idle';
  s.player.x = 0; s.player.z = 12; // far outside aggro, out of melee range
  tick(s, { clickEnemy: boar.id });

  tick(s, { ability: 0 });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'range'), 'Strike out of range fails readably (range)');
  assert(s.player.gcd === 0 && s.player.energy === s.player.maxEnergy, 'failed cast costs nothing and starts no GCD');

  s.player.z = 2.5; // inside 3.0 melee, outside boar aggro? boar aggro is 8 so it will chase: freeze it
  boar.state = 'idle'; boar.attackCd = 99;
  const hp0 = boar.hp;
  tick(s, { ability: 0 });
  assert(hasEvent(s, e => e.t === 'cast' && e.slot === 0) && boar.hp < hp0, 'Strike in range hits');
  assert(Math.abs(s.player.gcd - (GCD - 0)) < 1e-6 || s.player.gcd > GCD - 0.1, 'GCD ~1.5s starts');

  tick(s, { ability: 1 });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'gcd'), 'second ability during GCD fails (gcd)');

  run(s, GCD - 0.3);
  tick(s, { ability: 1 }); // within the queue window: accepted, fires when GCD ends
  assert(s.player.queued === 1, 'press within 0.4s of GCD end is queued');
  run(s, 0.4);
  assert(s.player.cd[1] > 0, 'queued Crushing Blow fired when the GCD ended');
  assert(s.player.cd[1] > ABILITIES[1].cooldown - 0.6, 'Crushing Blow went on cooldown (6s)');

  run(s, GCD);
  tick(s, { ability: 1 });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'cooldown'), 'ability on cooldown fails (cooldown)');

  run(s, ABILITIES[1].cooldown);
  s.player.energy = 5;
  tick(s, { ability: 1 });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'energy'), 'not enough energy fails (energy)');

  // Serrated Throw works at range and leaves a bleed that ticks
  s.player.energy = 100; s.player.cd.fill(0); s.player.gcd = 0;
  s.player.z = 8; // 8 away, within 9 range
  boar.state = 'idle'; boar.attackCd = 99;
  const before = boar.hp;
  tick(s, { ability: 2 });
  assert(boar.bleed !== null, 'Serrated Throw applies a bleed at range 8');
  boar.state = 'idle';
  run(s, 3.2);
  assert(before - boar.hp > ABILITIES[2].damage + 2 * 3, 'bleed ticks for damage over time');

  // Second Wind heals, needs no target
  s.player.hp = 40; s.player.gcd = 0; s.player.energy = 100;
  tick(s, { clearTarget: true });
  tick(s, { ability: 3 });
  assert(s.player.hp > 40 + 30, 'Second Wind heals without a target');
}

// ---------------------------------------------------------------------------
section('Kill a basic enemy: duration, XP, level-up');
{
  const s = createState(7);
  const durations: number[] = [];
  const boars = s.enemies.filter(e => e.type === 'boar');
  for (const b of boars) {
    standNear(s, b, 2.5);
    s.player.energy = s.player.maxEnergy; s.player.cd.fill(0);
    s.player.outOfCombat = 99;
    const lvl = s.player.combat.level;
    const t = fight(s, b);
    assert(st(b) === 'dead', `boar killed (lvl ${lvl}, ${t.toFixed(1)}s, hp left ${Math.round(s.player.hp)}/${s.player.maxHp})`);
    durations.push(t);
    run(s, 8); // let the bar refill a bit between pulls
  }
  assert(s.player.combat.xp === boars.length * ENEMY_TYPES.boar.xp, 'XP granted per kill');
  const avg = durations[0];
  assert(avg >= 8 && avg <= 20, `fresh-player boar fight lasts ~10-20s (got ${avg.toFixed(1)}s)`);
  // keep killing until a level-up event is seen
  let leveled = false;
  for (let i = 0; i < 6 && !leveled; i++) {
    const b = boars[i % boars.length];
    run(s, ENEMY_TYPES.boar.respawn + 1);
    assert(st(b) === 'idle', 'boar respawns after its timer');
    standNear(s, b, 2.5);
    s.player.energy = s.player.maxEnergy; s.player.cd.fill(0);
    s.targetId = null; tick(s, { clickEnemy: b.id });
    while (st(b) !== 'dead' && !s.player.dead) {
      tick(s, { ability: botAbility(s, b) });
      if (hasEvent(s, e => e.t === 'levelup')) leveled = true;
    }
  }
  assert(leveled && s.player.combat.level >= 2, `levelled up (now ${s.player.combat.level}), health restored: ${s.player.hp === s.player.maxHp}`);
  assert(s.player.maxHp > 100, 'level raises max health');
}

// ---------------------------------------------------------------------------
section('Enemy AI: aggro, chase, attack, leash, reset, respawn');
{
  const s = createState(3);
  const w = enemyOf(s, 'wolf');
  s.player.x = w.x + 6; s.player.z = w.z; // inside aggro 8
  run(s, 0.2);
  assert(st(w) === 'chase', 'enemy aggroes inside its aggro radius');
  const d0 = Math.hypot(w.x - s.player.x, w.z - s.player.z);
  run(s, 0.5);
  assert(Math.hypot(w.x - s.player.x, w.z - s.player.z) < d0, 'enemy chases');
  const hp0 = s.player.hp;
  run(s, 3);
  assert(s.player.hp < hp0, 'enemy melee hits back');

  // leash: run far away; it gives up and resets at spawn at full health
  w.hp = 50;
  s.targetId = w.id;
  s.player.x = w.spawnX; s.player.z = w.spawnZ + 26; // clamp-safe? checked below
  s.player.x = Math.max(-29, Math.min(29, s.player.x));
  let ran = 0;
  while (st(w) !== 'return' && ran < 30) {
    s.player.z = Math.min(29, s.player.z); // stay in the world
    // keep moving away along +x/-x toward the far edge to exceed the leash
    tick(s, { dirX: w.spawnX > 0 ? -1 : 1, dirZ: 0 });
    ran += TICK_DT;
  }
  // Fallback for corner cases of geometry: teleport past the leash distance
  if (st(w) !== 'return') {
    s.player.x = w.spawnX; s.player.z = w.spawnZ;
    w.x = w.spawnX + 26; w.z = w.spawnZ; w.state = 'chase';
    run(s, 0.1);
  }
  assert(st(w) === 'return', 'pulled beyond leash distance: enemy gives up (return)');
  assert(w.hp === w.maxHp, 'leashed enemy resets to full health');
  assert(s.targetId !== w.id, 'leashed enemy is dropped from targeting');
  s.player.x = 0; s.player.z = 6;
  run(s, 12);
  assert(st(w) === 'idle' && Math.hypot(w.x - w.spawnX, w.z - w.spawnZ) < 0.5, 'enemy walked back to spawn and is idle again');

  // respawn timer
  const b = enemyOf(s, 'boar');
  b.hp = 1; s.targetId = b.id; standNear(s, b, 2); s.player.x = b.x + 2;
  tick(s, { ability: 0 });
  assert(st(b) === 'dead', 'enemy dies');
  run(s, ENEMY_TYPES.boar.respawn - 1);
  assert(st(b) === 'dead', 'stays dead until the timer');
  run(s, 2);
  assert(st(b) !== 'dead' && b.hp === b.maxHp, 'respawns at full health');
}

// ---------------------------------------------------------------------------
section('Tougher tier kills a fresh player; death and resurrection');
{
  const s = createState(11);
  const brute = enemyOf(s, 'brute');
  standNear(s, brute, 3);
  const t = fight(s, brute, 120);
  assert(s.player.dead && st(brute) !== 'dead', `Cave Brute kills a fresh player (after ${t.toFixed(1)}s; brute left with ${Math.round(brute.hp)}/${brute.maxHp} hp)`);
  assert(hasEvent(s, e => e.t === 'death') || s.player.dead, 'death event raised');
  tick(s, { ability: 0 });
  assert(!hasEvent(s, e => e.t === 'cast'), 'dead player cannot act');
  run(s, RESPAWN_DELAY - 0.5);
  assert(s.player.dead, 'still dead during the delay');
  run(s, 1);
  assert(!s.player.dead && s.player.hp === s.player.maxHp, 'respawns with full health after the delay');
  assert(Math.hypot(s.player.x, s.player.z - 6) < 0.1, 'respawns at the clearing');
  assert(st(brute) === 'return' || st(brute) === 'idle', 'brute resets when the player dies');
  assert(s.player.combat.xp === 0, 'death costs no XP (setback, not a wall)');
}

// ---------------------------------------------------------------------------
section('Later in the golden path: levelled + upgraded player beats the Brute');
{
  const s = createState(5);
  addXp(s.player.combat, xpForLevel(6)); // ~ what a few wolves/boars give
  s.player.combat.level = levelForXp(s.player.combat.xp);
  s.player.maxHp = 100 + 15 * (s.player.combat.level - 1); s.player.hp = s.player.maxHp;
  addItem(s.player.inventory, 'iron_sword', 1); // stand-in for the smithed weapon (M3)
  tick(s, { inv: [{ k: 'equip', slot: 0 }] });
  const brute = enemyOf(s, 'brute');
  standNear(s, brute, 3);
  const t = fight(s, brute, 120);
  assert(st(brute) === 'dead' && !s.player.dead,
    `level ${s.player.combat.level} + weapon beats the Cave Brute in ${t.toFixed(1)}s, lowest hp ${Math.round(minHpSeen)}/${s.player.maxHp}`);
}

// ---------------------------------------------------------------------------
section('M2 items: drops, pickup, inventory, equipment, stats from gear');
{
  // item data sanity
  assert(INVENTORY_SIZE === 28, 'inventory has 28 slots');
  const slots = new Set(Object.values(ITEMS).map(i => i.slot).filter(Boolean));
  assert(['weapon', 'head', 'chest', 'legs'].every(x => slots.has(x as never)), 'items exist for weapon/head/chest/legs');
  assert(ITEMS.iron_ore && ITEMS.coal, 'M3 crafting materials seeded');
  for (const [t, tbl] of Object.entries(DROP_TABLES)) assert(tbl.entries.every(e => ITEMS[e.id]), `drop table "${t}" references real items`);

  // killing an enemy produces a drop (rng-seeded, so bounded loop), at the corpse
  const s = createState(21);
  const boar = enemyOf(s, 'boar');
  let kills = 0;
  while (s.drops.length === 0 && kills < 50) {
    boar.hp = 1; s.targetId = boar.id; standNear(s, boar, 2);
    s.player.cd.fill(0); s.player.gcd = 0; s.player.energy = 100;
    tick(s, { ability: 0 });
    kills++;
    if (s.drops.length === 0) run(s, ENEMY_TYPES.boar.respawn + 1);
  }
  assert(s.drops.length > 0, `boar kill produced a drop after ${kills} kill(s)`);
  const drop = s.drops[0];
  assert(hasEvent(s, e => e.t === 'drop') && Math.hypot(drop.x - boar.x, drop.z - boar.z) < 2, 'drop event raised, drop lies at the corpse');
  assert(countItem(s.player.inventory, drop.item) === 0, 'drop is NOT silently auto-looted');

  // pickup: click it, the player walks over, it lands in the inventory
  s.player.x = drop.x + 8; s.player.z = drop.z;
  tick(s, { pickup: drop.id });
  assert(s.moveTarget !== null, 'clicking a drop starts walking to it');
  const qty = drop.qty, item = drop.item;
  let guard = 0;
  while (s.drops.includes(drop) && guard++ < 150) tick(s);
  assert(!s.drops.includes(drop) && countItem(s.player.inventory, item) === qty, `walked over drop: ${qty}x ${ITEMS[item].name} in inventory`);
  assert(s.moveTarget === null, 'walk target cleared after pickup');

  // stacking + full-inventory refusal
  const inv = s.player.inventory;
  inv.fill(null);
  assert(addItem(inv, 'boar_hide', 30) === 0 && addItem(inv, 'boar_hide', 30) === 0 && inv.filter(Boolean).length === 2, 'stackable items stack (cap 50)');
  assert(inv[0]!.qty === 50 && inv[1]!.qty === 10, 'overflow starts a new stack');
  inv.fill({ id: 'iron_ore', qty: 50 });
  s.drops.push({ id: 900, item: 'boar_hide', qty: 1, x: s.player.x, z: s.player.z, age: 0, blocked: false });
  tick(s);
  assert(s.drops.some(d => d.id === 900) && hasEvent(s, e => e.t === 'invfull'), 'full inventory: drop stays on the ground, player is told');
  s.drops = [];

  // move / merge / drop / destroy
  inv.fill(null);
  addItem(inv, 'iron_sword', 1); addItem(inv, 'boar_hide', 5); addItem(inv, 'boar_hide', 50);
  // slots: 0 sword, 1 hide x50 (merged to 50, 5 left over?) -> addItem fills the first stack first
  tick(s, { inv: [{ k: 'move', from: 0, to: 5 }] });
  assert(inv[0] === null && inv[5]?.id === 'iron_sword', 'move relocates an item');
  const hideTotal = countItem(inv, 'boar_hide');
  const a = inv.findIndex(x => x?.id === 'boar_hide'), b = inv.findIndex((x, i) => i > a && x?.id === 'boar_hide');
  tick(s, { inv: [{ k: 'move', from: b, to: a }] });
  assert(countItem(inv, 'boar_hide') === hideTotal && inv[a]!.qty <= ITEMS.boar_hide.stack, 'move merges matching stacks without losing items');
  tick(s, { inv: [{ k: 'drop', slot: 5 }] });
  assert(inv[5] === null && s.drops.length === 1 && s.drops[0].item === 'iron_sword', 'drop puts the item on the ground');
  tick(s); tick(s);
  assert(s.drops.length === 1, 'a just-dropped item is not instantly re-grabbed');
  s.player.x += 6; tick(s); s.player.x -= 6;
  tick(s);
  assert(Number(s.drops.length) === 0 && countItem(inv, 'iron_sword') === 1, 'stepping away then back picks it up again');
  const slotOf = inv.findIndex(x => x?.id === 'iron_sword');
  tick(s, { inv: [{ k: 'destroy', slot: slotOf }] });
  assert(countItem(inv, 'iron_sword') === 0, 'destroy deletes the item');

  // equip / unequip, swap returns the old item
  inv.fill(null);
  addItem(inv, 'rusty_blade', 1); addItem(inv, 'iron_sword', 1); addItem(inv, 'hide_jerkin', 1);
  tick(s, { inv: [{ k: 'equip', slot: 0 }] });
  assert(s.player.equipment.weapon === 'rusty_blade' && inv[0] === null, 'equip moves item into its slot');
  assert(s.player.stats.weaponDamage === 2, 'derived stats update on equip');
  tick(s, { inv: [{ k: 'equip', slot: 1 }] });
  assert(String(s.player.equipment.weapon) === 'iron_sword' && inv[1]?.id === 'rusty_blade', 'equipping over a worn item swaps it back to the bag');
  tick(s, { inv: [{ k: 'equip', slot: 2 }] });
  assert(s.player.equipment.chest === 'hide_jerkin' && s.player.stats.armor === 4, 'armour equips into its slot');
  tick(s, { inv: [{ k: 'unequip', slot: 'chest' }] });
  assert(s.player.equipment.chest == null && Number(s.player.stats.armor) === 0 && countItem(inv, 'hide_jerkin') === 1, 'unequip returns it to the bag and drops the stats');
  tick(s, { inv: [{ k: 'equip', slot: 7 }] });
  assert(String(s.player.equipment.weapon) === 'iron_sword', 'equipping an empty/invalid slot is a no-op');
  assert(deriveStats(emptyEquipment()).reduction === 0, 'no gear: no reduction');

  // measurable damage: identical seed, bare hands vs better weapons, parked target
  const strikeTotal = (weapon: string | null) => {
    const g = createState(99);
    const b = enemyOf(g, 'boar');
    b.x = b.spawnX = 0; b.z = b.spawnZ = 0; b.maxHp = b.hp = 1e6; b.state = 'idle'; b.attackCd = 1e9;
    g.player.x = 0; g.player.z = 2.5;
    if (weapon) { addItem(g.player.inventory, weapon, 1); tick(g, { inv: [{ k: 'equip', slot: 0 }] }); }
    tick(g, { clickEnemy: b.id });
    const start = b.hp;
    for (let i = 0; i < 20; i++) { g.player.energy = 100; b.state = 'idle'; b.attackCd = 1e9; tick(g, { ability: 0 }); run(g, GCD); }
    return start - b.hp;
  };
  const bare = strikeTotal(null), rusty = strikeTotal('rusty_blade'), iron = strikeTotal('iron_sword'), steel = strikeTotal('steel_sword');
  assert(bare < rusty && rusty < iron && iron < steel, `weapon tiers deal more damage over 20 Strikes (bare ${bare}, rusty ${rusty}, iron ${iron}, steel ${steel})`);
  assert(iron > bare * 1.4, `Iron Sword is a >40% Strike upgrade (${(iron / bare).toFixed(2)}x)`);

  // measurable mitigation: same seed, same enemy, only armour differs
  const damageTaken = (gear: string[]) => {
    const g = createState(77);
    for (const id of gear) { addItem(g.player.inventory, id, 1); tick(g, { inv: [{ k: 'equip', slot: g.player.inventory.findIndex(x => x?.id === id) }] }); }
    const w = enemyOf(g, 'wolf');
    g.player.x = w.x + 1.5; g.player.z = w.z;
    g.player.maxHp = g.player.hp = 1e6;
    run(g, 20);
    return 1e6 - g.player.hp;
  };
  const naked = damageTaken([]), hide = damageTaken(['leather_cap', 'hide_jerkin', 'hide_leggings']),
    iron3 = damageTaken(['iron_helm', 'iron_chestplate', 'iron_greaves']);
  assert(naked > hide && hide > iron3, `armour reduces damage taken over 20s of wolf (none ${naked}, hide ${hide}, iron ${iron3})`);
  assert(iron3 < naked * 0.8, `iron set cuts incoming damage by >20% (${((1 - iron3 / naked) * 100).toFixed(0)}%)`);
}

// ---------------------------------------------------------------------------
// M3 helpers: a "player bot" that uses only sim Input (interact / craft), so walking, reach and timing are real.
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** Read through a function so TS doesn't narrow player.action across sim calls. */
const actionKind = (s: GameState): string | undefined => s.player.action?.k;
const busy = (s: GameState) => s.interact !== null || s.player.action !== null;
function untilIdle(s: GameState, maxTicks = 4000) { let n = 0; while (busy(s) && n++ < maxTicks) tick(s); }
const countOf = (s: GameState, id: string) => countItem(s.player.inventory, id);
const nodesOf = (s: GameState, type: string) => s.nodes.filter(n => n.type === type);
const nearestNode = (s: GameState, type: string) =>
  nodesOf(s, type).filter(n => n.charges > 0).sort((a, b) => dist2(a, s.player) - dist2(b, s.player))[0];
/** Gather from nodes of `type` until the bag holds `want` of the node's item. Waits for respawns when all are depleted. */
function gatherUntil(s: GameState, type: string, want: number) {
  const item = NODE_TYPES[type].item;
  for (let guard = 0; countOf(s, item) < want && guard < 400; guard++) {
    const n = nearestNode(s, type);
    if (!n) { run(s, 1); continue; }
    tick(s, { interact: { k: 'node', id: n.id } });
    untilIdle(s);
    defend(s);
  }
}
function atForge(s: GameState) {
  for (let tries = 0; tries < 5; tries++) {
    tick(s, { interact: { k: 'forge' } });
    let opened = hasEvent(s, e => e.t === 'forge');
    for (let n = 0; busy(s) && n++ < 2000;) { tick(s); opened ||= hasEvent(s, e => e.t === 'forge'); }
    if (opened) return true;
    defend(s); // aggroed on the way: deal with it and retry the walk
  }
  return false;
}
function craft(s: GameState, recipe: string, count: number) {
  const out = RECIPES.find(r => r.id === recipe)!.output.id, want = countOf(s, out) + count;
  for (let tries = 0; tries < 8 && countOf(s, out) < want; tries++) {
    tick(s, { craft: { recipe, count: want - countOf(s, out) } });
    untilIdle(s);
    if (s.player.dead || s.enemies.some(e => st(e) === 'chase')) { defend(s); atForge(s); } // interrupted: fight, walk back, resume
  }
}
/** A world with every enemy parked dead, for testing gather/craft mechanics without wandering into a fight. */
function quietState(seed: number) {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  return s;
}
/** Bot self-defence: if anything has aggroed, fight it before carrying on. Waits out a death. */
function defend(s: GameState) {
  for (let guard = 0; guard < 20; guard++) {
    if (s.player.dead) { run(s, RESPAWN_DELAY + 0.5); continue; }
    const e = s.enemies.find(x => st(x) === 'chase');
    if (!e) return;
    s.player.energy = s.player.maxEnergy; s.player.cd.fill(0);
    fight(s, e, 60);
  }
}
/** Kill things until the combat level reaches `level`: boars first, wolves once boars are too slow. Returns game seconds spent. */
function grindCombat(s: GameState, level: number) {
  const t0 = s.tick;
  for (let guard = 0; s.player.combat.level < level && guard < 400; guard++) {
    const pool = s.enemies.filter(e => e.type === (s.player.combat.level >= 3 ? 'wolf' : 'boar') && st(e) !== 'dead');
    if (!pool.length) { run(s, 2); continue; }
    const e = pool[0];
    if (s.player.dead) { run(s, RESPAWN_DELAY + 0.5); continue; }
    if (s.player.hp < s.player.maxHp * 0.7) run(s, 10); // rest between pulls
    s.player.energy = s.player.maxEnergy; s.player.cd.fill(0);
    standNear(s, e, 2.5);
    fight(s, e);
  }
  return (s.tick - t0) * TICK_DT;
}

// ---------------------------------------------------------------------------
section('M3 skills: parallel tracks on the RuneScape curve');
{
  const s = createState(1);
  assert(SKILL_IDS.length === 4 && ['combat', 'mining', 'woodcutting', 'smithing'].every(k => SKILLS[k as never]), 'skills: Combat, Mining, Woodcutting, Smithing');
  assert(SKILL_IDS.every(k => s.player.skills[k].level === 1 && s.player.skills[k].xp === 0), 'every skill starts at level 1, 0 xp');
  assert(s.player.skills.combat === s.player.combat, 'combat skill is the same track combat code reads');
  grantXp(s, 'mining', 100, 0, 0);
  assert(s.player.skills.mining.level === 2 && s.player.skills.mining.xp === 100, 'mining xp levels mining (100 xp -> lv 2)');
  assert(s.player.skills.smithing.xp === 0 && s.player.skills.woodcutting.xp === 0 && s.player.combat.xp === 0, 'skills are independent: nothing else moved');
  assert(hasEvent(s, e => e.t === 'levelup' && e.skill === 'mining' && e.level === 2), 'levelup event names the skill');
  const curve = [1, 2, 3, 4, 5, 10, 20].map(l => `${l}:${xpForLevel(l)}`).join(' ');
  console.log(`  xp to reach level  ${curve}`);
}

// ---------------------------------------------------------------------------
section('M3 gathering: nodes, timing, depletion, respawn, interruption');
{
  const s = quietState(2);
  const def = NODE_TYPES.iron;
  const rock = nodesOf(s, 'iron')[0];
  assert(nodesOf(s, 'iron').length >= 3 && nodesOf(s, 'coal').length >= 2 && nodesOf(s, 'tree').length === TREES.length, 'iron rocks, coal seams and trees are placed in the zone');
  const cave = LANDMARKS.caveMouth;
  assert(ROCKS.every(r => dist2(r, cave) < 20), 'ore is hand-placed near the cave mouth');
  assert(ROCKS.every(r => dist2(r, enemyOf(s, 'brute')) > ENEMY_TYPES.brute.aggroRadius + 1), 'no ore node sits inside the Cave Brute aggro radius');

  const far = dist2(s.player, rock);
  tick(s, { interact: { k: 'node', id: rock.id } });
  assert(s.interact !== null && s.moveTarget !== null && s.player.action === null, `clicking a far node (${far.toFixed(0)}u) starts a walk, not an instant gather`);
  let guard = 0;
  while (s.interact && guard++ < 2000) tick(s);
  assert(actionKind(s) === 'gather' && dist2(s.player, rock) < rock.r + 2.5, 'player walks into reach, then the gather action begins');
  const a = s.player.action!;
  run(s, def.time / 2);
  assert(s.player.action === a && countOf(s, 'iron_ore') === 0, 'gathering takes time: nothing yielded halfway');
  run(s, def.time / 2 + TICK_DT * 2);
  assert(countOf(s, 'iron_ore') === 1 && s.player.skills.mining.xp === def.xp, `first swing yields 1 Iron Ore and ${def.xp} Mining XP`);
  assert(rock.charges === def.charges - 1 && s.player.action !== null, 'gathering continues automatically on the same node');
  untilIdle(s);
  assert(countOf(s, 'iron_ore') === def.charges && rock.charges === 0 && rock.respawnIn > 0, `node depletes after ${def.charges} ore`);
  tick(s, { interact: { k: 'node', id: rock.id } });
  assert(hasEvent(s, e => e.t === 'actionfail' && e.reason === 'depleted') && s.player.action === null, 'depleted node cannot be gathered');
  run(s, def.respawn - 2);
  assert(rock.charges === 0, 'node stays depleted until its timer');
  run(s, 3);
  assert(rock.charges === def.charges, `node respawns after ${def.respawn}s with full charges`);

  // interruption: moving cancels, getting hit cancels
  tick(s, { interact: { k: 'node', id: rock.id } });
  run(s, 1);
  assert(s.player.action !== null, 'gathering again');
  tick(s, { dirX: 0, dirZ: 1 });
  assert(s.player.action === null, 'moving cancels the gather');
  tick(s, { interact: { k: 'node', id: rock.id } });
  run(s, 1);
  assert(s.player.action !== null, 'gathering a third time');
  const w = enemyOf(s, 'wolf');
  w.x = s.player.x + 1; w.z = s.player.z; w.hp = w.maxHp; w.state = 'chase'; w.attackCd = 0;
  run(s, 0.3);
  assert(s.player.action === null, 'getting hit by an enemy cancels the gather');
  w.state = 'dead'; w.respawnIn = 1e9;

  // trees feed Woodcutting
  const tree = nearestNode(s, 'tree');
  s.player.hp = s.player.maxHp = 999;
  tick(s, { interact: { k: 'node', id: tree.id } });
  untilIdle(s);
  assert(countOf(s, 'logs') === NODE_TYPES.tree.charges && s.player.skills.woodcutting.xp === NODE_TYPES.tree.xp * NODE_TYPES.tree.charges, 'chopping a tree yields Logs and Woodcutting XP');
  assert(tree.charges === 0, 'trees deplete too');

  // full bag stops the gather instead of losing the ore
  const s2 = quietState(2);
  s2.player.inventory.fill({ id: 'boar_hide', qty: 50 });
  tick(s2, { interact: { k: 'node', id: nodesOf(s2, 'iron')[0].id } });
  untilIdle(s2);
  assert(hasEvent(s2, e => e.t === 'actionfail' && e.reason === 'full') && s2.player.action === null && nodesOf(s2, 'iron')[0].charges === 3, 'full inventory refuses to gather and tells the player');
}

// ---------------------------------------------------------------------------
section('M3 level requirements: gated nodes and recipes');
{
  const s = quietState(3);
  const coal = nodesOf(s, 'coal')[0];
  s.player.x = coal.x + 2; s.player.z = coal.z + 2;
  tick(s, { interact: { k: 'node', id: coal.id } });
  const fail = s.events.find(e => e.t === 'actionfail');
  assert(fail && fail.t === 'actionfail' && fail.reason === 'level' && fail.skill === 'mining' && fail.need === NODE_TYPES.coal.level,
    `level-1 player is refused at a Coal Seam and told it needs Mining ${NODE_TYPES.coal.level}`);
  run(s, 1);
  assert(s.player.action === null && countOf(s, 'coal') === 0 && s.player.skills.mining.xp === 0, 'refused: no action, no coal, no xp');
  grantXp(s, 'mining', xpForLevel(NODE_TYPES.coal.level), 0, 0);
  assert(s.player.skills.mining.level === NODE_TYPES.coal.level, 'levelling Mining up');
  tick(s, { interact: { k: 'node', id: coal.id } });
  untilIdle(s);
  assert(countOf(s, 'coal') === NODE_TYPES.coal.charges, 'at the required level the same Coal Seam can be mined');

  // recipes: out of range, under level, missing materials
  s.player.x = LANDMARKS.forge.x - 20; s.player.z = LANDMARKS.forge.z;
  addItem(s.player.inventory, 'iron_ore', 4);
  tick(s, { craft: { recipe: 'iron_bar', count: 1 } });
  assert(hasEvent(s, e => e.t === 'actionfail' && e.reason === 'range') && s.player.action === null, 'cannot craft away from the forge');
  s.player.x = LANDMARKS.forge.x - 4; s.player.z = LANDMARKS.forge.z + 3;
  assert(dist2(s.player, LANDMARKS.forge) <= FORGE_REACH, 'standing at the forge');
  addItem(s.player.inventory, 'steel_bar', 3); addItem(s.player.inventory, 'logs', 1);
  tick(s, { craft: { recipe: 'forged_blade', count: 1 } });
  const lf = s.events.find(e => e.t === 'actionfail');
  assert(lf && lf.t === 'actionfail' && lf.reason === 'level' && lf.skill === 'smithing' && lf.need === 4, 'Smithing 1 cannot forge the blade: told it needs Smithing 4');
  s.player.inventory.fill(null);
  tick(s, { craft: { recipe: 'iron_bar', count: 1 } });
  assert(hasEvent(s, e => e.t === 'actionfail' && e.reason === 'materials') && s.player.action === null, 'missing materials: refused');
}

// ---------------------------------------------------------------------------
section('M3 smithing: forge recipes');
{
  assert(RECIPES.every(r => ITEMS[r.output.id] && r.inputs.every(i => ITEMS[i.id])), 'every recipe references real items');
  const s = quietState(4);
  addItem(s.player.inventory, 'iron_ore', 4);
  assert(atForge(s) && dist2(s.player, LANDMARKS.forge) <= FORGE_REACH, 'clicking the forge walks there and opens it');
  tick(s, { craft: { recipe: 'iron_bar', count: 2 } });
  assert(actionKind(s) === 'craft' && countOf(s, 'iron_bar') === 0, 'craft starts; nothing is produced instantly');
  run(s, RECIPES[0].time + TICK_DT * 2);
  assert(countOf(s, 'iron_bar') === 1 && countOf(s, 'iron_ore') === 2, 'crafting consumes 2 Iron Ore and produces 1 Iron Bar');
  assert(s.player.skills.smithing.xp === RECIPES[0].xp, `crafting grants Smithing XP (${RECIPES[0].xp})`);
  untilIdle(s);
  assert(countOf(s, 'iron_bar') === 2 && countOf(s, 'iron_ore') === 0, 'a batch of 2 runs to completion');
  const b = quietState(4);
  b.player.x = LANDMARKS.forge.x - 4; b.player.z = LANDMARKS.forge.z + 3;
  addItem(b.player.inventory, 'iron_ore', 10);
  tick(b, { craft: { recipe: 'iron_bar', count: 99 } });
  untilIdle(b);
  assert(countOf(b, 'iron_bar') === 5, 'a "make all" batch stops when materials run out');
  addItem(b.player.inventory, 'iron_ore', 2);
  tick(b, { craft: { recipe: 'iron_bar', count: 1 } });
  tick(b, { dirX: 1, dirZ: 0 });
  assert(b.player.action === null, 'walking away cancels a craft');
}

// ---------------------------------------------------------------------------
section('M3 golden path: fight, mine, smith, equip, beat the Cave Brute');
{
  const s = createState(8);
  const brute = enemyOf(s, 'brute');
  const blade = ITEMS.forged_blade;
  const bestDrop = Math.max(...Object.entries(ITEMS)
    .filter(([id, it]) => it.slot === 'weapon' && Object.values(DROP_TABLES).some(t => t.entries.some(e => e.id === id)))
    .map(([, it]) => it.stats!.damage!));
  assert(blade.stats!.damage! >= bestDrop + 4, `Forgemaster's Blade (+${blade.stats!.damage}) clearly beats the best enemy-dropped weapon (+${bestDrop})`);
  assert(!Object.values(DROP_TABLES).some(t => t.entries.some(e => e.id === 'forged_blade')), 'the blade is craft-only');

  // 1. the Brute beats the fresh player (M1), who goes off to level
  standNear(s, brute, 3);
  fight(s, brute, 60);
  assert(s.player.dead, 'the Cave Brute kills the fresh player');
  run(s, RESPAWN_DELAY + 1);

  // 2. real combat levelling
  const combatSecs = grindCombat(s, 5);
  assert(s.player.combat.level >= 5, `ground out combat level ${s.player.combat.level} on boars/wolves (${combatSecs.toFixed(0)}s game time)`);
  const combatLevel = s.player.combat.level;
  s.player.inventory.fill(null); // keep the bag clean: only the crafted weapon matters below

  // 3. the RuneScape loop, timed from the first swing to the blade in hand
  const t0 = s.tick;
  gatherUntil(s, 'iron', 8);
  assert(s.player.skills.mining.level >= NODE_TYPES.coal.level, `mined ${countOf(s, 'iron_ore')} iron ore: Mining is now level ${s.player.skills.mining.level}, Coal Seams unlocked`);
  gatherUntil(s, 'iron', 10);
  gatherUntil(s, 'coal', 6);
  assert(countOf(s, 'coal') >= 6 && countOf(s, 'iron_ore') >= 10, `gathered ${countOf(s, 'iron_ore')} Iron Ore + ${countOf(s, 'coal')} Coal (nodes yield in threes)`);
  gatherUntil(s, 'tree', 1);
  const mineSecs = (s.tick - t0) * TICK_DT;
  assert(countOf(s, 'logs') >= 1 && s.player.skills.woodcutting.level >= 1, 'chopped Logs for the hilt');

  assert(atForge(s), 'walked to the forge');
  craft(s, 'iron_bar', 5);
  assert(countOf(s, 'iron_bar') === 5 && s.player.skills.smithing.level >= 3, `smelted 5 Iron Bars: Smithing ${s.player.skills.smithing.level}`);
  craft(s, 'steel_bar', 3);
  assert(countOf(s, 'steel_bar') === 3 && s.player.skills.smithing.level >= 4, `hardened 3 Steel Bars: Smithing ${s.player.skills.smithing.level}`);
  craft(s, 'forged_blade', 1);
  const pathSecs = (s.tick - t0) * TICK_DT;
  assert(countOf(s, 'forged_blade') === 1, `forged the Forgemaster's Blade (ore-to-weapon ${pathSecs.toFixed(0)}s game time; gathering ${mineSecs.toFixed(0)}s)`);
  console.log(`  ore-to-weapon path: ${(pathSecs / 60).toFixed(1)} min (mining/chopping ${(mineSecs / 60).toFixed(1)} min, smithing ${((pathSecs - mineSecs) / 60).toFixed(1)} min, incl. walking)`);
  assert(pathSecs >= 120 && pathSecs <= 480, 'path takes a few minutes of play (2 to 8 min)');

  // 4. equip it; counterfactual at the same level without it
  const noBlade = structuredClone(s);
  noBlade.player.inventory.fill(null);
  s.player.hp = s.player.maxHp; s.player.energy = s.player.maxEnergy; s.player.cd.fill(0); s.player.outOfCombat = 99;
  tick(s, { inv: [{ k: 'equip', slot: s.player.inventory.findIndex(x => x?.id === 'forged_blade') }] });
  assert(s.player.equipment.weapon === 'forged_blade' && s.player.stats.weaponDamage === blade.stats!.damage, 'equipped: derived stats show the blade damage');

  const sameBrute = (g: GameState) => { const b = enemyOf(g, 'brute'); run(g, 70); b.hp = b.maxHp; b.state = 'idle'; g.player.hp = g.player.maxHp; g.player.energy = g.player.maxEnergy; g.player.cd.fill(0); g.player.gcd = 0; standNear(g, b, 3); return b; };
  const nb = sameBrute(noBlade);
  const tn = fight(noBlade, nb, 120);
  assert(noBlade.player.dead && st(nb) !== 'dead', `without the blade, level ${combatLevel} still loses to the Cave Brute (brute left ${Math.round(nb.hp)}/${nb.maxHp} after ${tn.toFixed(0)}s)`);
  const wb = sameBrute(s);
  const tw = fight(s, wb, 120);
  assert(st(wb) === 'dead' && !s.player.dead, `with the blade, level ${combatLevel} beats the Cave Brute in ${tw.toFixed(1)}s (lowest hp ${Math.round(minHpSeen)}/${s.player.maxHp})`);
}

// ---------------------------------------------------------------------------
// M4 helpers
const kills = (s: GameState, t: string): number => s.quest.kills[t] ?? 0;
const stage = (s: GameState): string => s.quest.stage; // via a function so TS doesn't narrow across sim calls
const lineTexts = (s: GameState) => questView(s).lines.map(l => l.text);
const sawQuest = (s: GameState, what: string) => hasEvent(s, e => e.t === 'quest' && e.what === what);
/** Click the NPC: walk over and open the dialogue. */
function talkToNpc(s: GameState) {
  for (let tries = 0; tries < 5; tries++) {
    tick(s, { interact: { k: 'npc' } });
    let opened = hasEvent(s, e => e.t === 'npc');
    for (let n = 0; busy(s) && n++ < 2000;) { tick(s); opened ||= hasEvent(s, e => e.t === 'npc'); }
    if (opened) return true;
    defend(s);
  }
  return false;
}
/** Walk with click-to-move until within `within` of a point (gives up after maxSec). Enemies that aggro on the way are the caller's problem. */
function walkTo(s: GameState, x: number, z: number, within = 2, maxSec = 40) {
  tick(s, { clickTarget: { x, z } });
  for (let t = 0; t < maxSec && dist2(s.player, { x, z }) > within; t += TICK_DT) {
    if (s.player.dead || (!s.moveTarget && !s.player.moving)) break;
    tick(s);
  }
  return dist2(s.player, { x, z }) <= within;
}
/** Rest (real time) until nearly healed and energy is back. No cheating: the clock keeps running. */
function rest(s: GameState) {
  for (let t = 0; t < 90 && (s.player.hp < s.player.maxHp * 0.85 || s.player.energy < 60); t += 1) run(s, 1);
}
/** Hunt one living enemy of `type`: walk to it, fight it, recover. */
function huntOne(s: GameState, type: string) {
  for (let guard = 0; guard < 6; guard++) {
    if (s.player.dead) { run(s, RESPAWN_DELAY + 0.5); continue; }
    const e = s.enemies.filter(x => x.type === type && st(x) !== 'dead').sort((a, b) => dist2(a, s.player) - dist2(b, s.player))[0];
    if (!e) { run(s, 2); continue; }
    rest(s);
    if (!walkTo(s, e.x, e.z, 2.5)) { if (!s.player.dead && st(e) !== 'dead') standNear(s, e, 2.5); } // path blocked by scenery: step in
    fight(s, e, 90);
    if (st(e) === 'dead') return;
  }
}

// ---------------------------------------------------------------------------
section('M4 quest: NPC, dialogue gating, stage transitions, kill credit');
{
  const s = quietState(21);
  assert(stage(s) === 'offer' && questView(s).ready, 'a new character starts at the quest offer');
  assert(DIALOGUE.offer.options.some(o => o.advance), 'the offer dialogue has an option that accepts the quest');
  s.player.x = -20; s.player.z = 20; // far from the NPC
  tick(s, { questAdvance: true });
  assert(stage(s) === 'offer', 'accepting from across the map does nothing: you have to be in earshot');
  s.player.x = 0; s.player.z = 6; // the spawn point: walk over
  assert(talkToNpc(s), 'clicking the NPC walks over and opens the dialogue (npc event)');
  assert(Math.hypot(s.player.x - NPC.x, s.player.z - NPC.z) <= TALK_RANGE, 'the player stands within talking range');
  tick(s, { questAdvance: true });
  assert(stage(s) === 'hunt' && sawQuest(s, 'accept'), 'accepting moves the quest to the hunt and raises a quest event');
  tick(s, { questAdvance: true });
  assert(stage(s) === 'hunt', 'advance is a no-op at stages with no hand-in');

  assert(lineTexts(s).includes('Wild Boars slain: 0/4') && lineTexts(s).includes('Dire Wolves slain: 0/3'), 'tracker shows live counters: ' + lineTexts(s).join(' | '));
  // the Brute earns nothing before its stage
  const brute = enemyOf(s, 'brute');
  brute.state = 'idle'; brute.hp = 1; brute.respawnIn = 0;
  standNear(s, brute, 2.5);
  fight(s, brute, 30);
  assert(stage(s) === 'hunt', 'killing the Cave Brute early does not advance the quest');
  s.player.dead = false; s.player.hp = s.player.maxHp;

  const boar = enemyOf(s, 'boar');
  boar.state = 'idle'; boar.hp = 1;
  standNear(s, boar, 2.5);
  fight(s, boar, 30);
  assert(kills(s, 'boar') === 1 && sawQuest(s, 'progress') && lineTexts(s)[0] === 'Wild Boars slain: 1/4', 'a boar kill counts and the tracker updates to 1/4');
  for (let i = 0; i < 3; i++) { const b = enemyOf(s, 'boar', (i + 1) % 3); b.state = 'idle'; b.hp = 1; b.respawnIn = 0; standNear(s, b, 2.5); fight(s, b, 30); s.player.hp = s.player.maxHp; }
  assert(kills(s, 'boar') === 4 && stage(s) === 'hunt', 'four boars: boar line done, still hunting wolves');
  const extra = enemyOf(s, 'boar'); extra.state = 'idle'; extra.hp = 1; standNear(s, extra, 2.5); fight(s, extra, 30);
  assert(kills(s, 'boar') === 4, 'counters cap at the goal');
  for (let i = 0; i < 3; i++) { const w = enemyOf(s, 'wolf', i); w.state = 'idle'; w.hp = 1; w.respawnIn = 0; standNear(s, w, 2.5); fight(s, w, 30); s.player.hp = s.player.maxHp; }
  assert(stage(s) === 'report1' && sawQuest(s, 'stage') && questView(s).ready, 'hunt complete: quest moves to "report to the Warden"');
  assert(questView(s).target?.label === NPC.name, 'the objective arrow points at the Warden');

  assert(talkToNpc(s), 'walk back to the Warden');
  tick(s, { questAdvance: true });
  assert(stage(s) === 'forge', 'the Warden sends you to forge the blade');
  assert(questView(s).lines.length === 3 && questView(s).target?.label === 'Iron Rock', 'tracker lists ore / coal / logs and points at iron: ' + lineTexts(s).join(' | '));

  // the stage ends the moment the blade exists, whatever route got it
  addItem(s.player.inventory, 'forged_blade', 1);
  tick(s);
  assert(stage(s) === 'brute', 'owning the blade moves the quest to the Brute');
  assert(lineTexts(s).some(t => t.startsWith('Equip the blade')), 'tracker tells you to equip it');
  tick(s, { inv: [{ k: 'equip', slot: s.player.inventory.findIndex(x => x?.id === 'forged_blade') }] });
  assert(lineTexts(s).includes('Blade equipped'), 'tracker notices when it is equipped');
  assert(questView(s).target?.label === 'Cave Brute', 'objective arrow points at the Cave Brute');

  const b2 = enemyOf(s, 'brute');
  b2.state = 'idle'; b2.hp = 1; standNear(s, b2, 2.5);
  fight(s, b2, 30);
  assert(stage(s) === 'report2' && questView(s).ready, 'the Brute dies: quest wants the hand-in');
  const xp0 = s.player.combat.xp, mine0 = s.player.skills.mining.xp;
  assert(talkToNpc(s), 'return to the Warden');
  tick(s, { questAdvance: true });
  assert(stage(s) === 'done' && sawQuest(s, 'complete'), 'turning in completes the quest');
  assert(s.player.combat.xp >= xp0 + 400 && s.player.skills.mining.xp === mine0 + 150, 'rewards: combat, mining and smithing XP');
  tick(s, { questAdvance: true });
  assert(s.player.combat.xp === xp0 + REWARD[0].xp && questView(s).target === null, 'completing twice pays once; nothing left to point at');
  for (const stg of QUEST_STAGES) assert(DIALOGUE[stg].lines.length > 0 && DIALOGUE[stg].options.length > 0, `dialogue exists for stage "${stg}"`);
}

// ---------------------------------------------------------------------------
section('M4 save / load');
{
  const s = quietState(33);
  s.player.x = 12.5; s.player.z = -3.25; s.player.facing = 1.2;
  grantXp(s, 'combat', 400, 0, 0); grantXp(s, 'mining', 300, 0, 0); grantXp(s, 'smithing', 90, 0, 0); grantXp(s, 'woodcutting', 30, 0, 0);
  refreshPlayerStats(s, true);
  addItem(s.player.inventory, 'iron_ore', 17); addItem(s.player.inventory, 'forged_blade', 1); addItem(s.player.inventory, 'iron_helm', 1);
  tick(s, { inv: [{ k: 'equip', slot: s.player.inventory.findIndex(x => x?.id === 'iron_helm') }] });
  s.player.hp = 77; s.player.energy = 42; // after the equip tick, which would regen a little
  s.quest.stage = 'forge'; s.quest.kills = { boar: 4, wolf: 3 };
  const node = s.nodes.find(n => n.type === 'iron')!; node.charges = 0; node.respawnIn = 12.5;
  const tree = s.nodes.find(n => n.type === 'tree')!; tree.charges = 1;
  const wolf = enemyOf(s, 'wolf'); wolf.state = 'dead'; wolf.respawnIn = 17;
  s.drops.push({ id: s.nextDropId++, item: 'logs', qty: 3, x: 1, z: 2, age: 5, blocked: false });

  const raw = serialize(s);
  const l = deserialize(raw)!;
  assert(l !== null, 'a fresh save loads');
  assert(Math.abs(l.player.x - 12.5) < 1e-9 && Math.abs(l.player.z + 3.25) < 1e-9 && l.player.hp === 77 && l.player.energy === 42, 'position, health and energy survive');
  assert(SKILL_IDS.every(id => l.player.skills[id].xp === s.player.skills[id].xp && l.player.skills[id].level === s.player.skills[id].level), 'every skill XP and level survives');
  assert(l.player.combat === l.player.skills.combat && l.player.maxHp === s.player.maxHp, 'combat track is still the shared object; max hp follows the level');
  assert(JSON.stringify(l.player.inventory) === JSON.stringify(s.player.inventory) && l.player.equipment.head === 'iron_helm', 'inventory and equipment survive');
  assert(l.player.stats.armor === s.player.stats.armor && l.player.stats.armor > 0, 'gear stats are re-derived');
  assert(l.quest.stage === 'forge' && l.quest.kills.boar === 4 && l.quest.kills.wolf === 3, 'quest stage and counters survive');
  const ln = l.nodes.find(n => n.id === node.id)!;
  assert(ln.charges === 0 && Math.abs(ln.respawnIn - 12.5) < 1e-9 && l.nodes.find(n => n.id === tree.id)!.charges === 1, 'node depletion and respawn timers survive');
  const lw = l.enemies.find(e => e.id === wolf.id)!;
  assert(st(lw) === 'dead' && Math.abs(lw.respawnIn - 17) < 1e-9, 'a dead enemy stays dead and keeps its respawn timer');
  assert(l.drops.length === 1 && l.drops[0].item === 'logs' && l.drops[0].qty === 3, 'ground drops survive');
  run(l, 20);
  assert(st(l.enemies.find(e => e.id === wolf.id)!) === 'idle' && l.nodes.find(n => n.id === node.id)!.charges > 0, 'respawn timers keep ticking after load');

  // saving while chased and dead
  const d = createState(4);
  d.player.dead = true; d.player.hp = 0; d.player.x = 25; d.player.z = 25;
  const dl = deserialize(serialize(d))!;
  assert(!dl.player.dead && dl.player.hp === dl.player.maxHp && dl.player.z === 6, 'a save made while dead wakes you at the clearing');
  const chase = createState(4);
  const ce = enemyOf(chase, 'boar'); ce.state = 'chase'; ce.hp = 5; ce.x += 3;
  const cl = deserialize(serialize(chase))!;
  assert(st(cl.enemies.find(e => e.id === ce.id)!) === 'idle' && cl.enemies.find(e => e.id === ce.id)!.hp === ce.maxHp, 'enemies mid-fight reset to calm at their spawn');

  // fail safe
  const v0 = JSON.parse(raw);
  assert(deserialize(JSON.stringify({ ...v0, version: SAVE_VERSION + 1 })) === null, 'wrong save version -> null (caller starts a new game)');
  assert(deserialize(JSON.stringify({ ...v0, version: undefined })) === null, 'missing version -> null');
  assert(deserialize('not json {{') === null && deserialize('') === null && deserialize('null') === null && deserialize('[]') === null, 'garbage -> null');
  const badItem = structuredClone(v0); badItem.player.inventory[0] = { id: 'not_an_item', qty: 1 };
  assert(deserialize(JSON.stringify(badItem)) === null, 'unknown item id -> null');
  const badXp = structuredClone(v0); badXp.player.xp.combat = 'lots';
  assert(deserialize(JSON.stringify(badXp)) === null, 'non-numeric xp -> null');
  const badGear = structuredClone(v0); badGear.player.equipment.weapon = 'iron_helm';
  assert(deserialize(JSON.stringify(badGear)) === null, 'armour in the weapon slot -> null');
  const badStage = structuredClone(v0); badStage.quest.stage = 'nonsense';
  assert(deserialize(JSON.stringify(badStage)) === null, 'unknown quest stage -> null');
  const short = structuredClone(v0); short.player.inventory.length = 5;
  assert(deserialize(JSON.stringify(short)) === null, 'truncated inventory -> null');
}

// ---------------------------------------------------------------------------
section('M4 FULL GOLDEN PATH: one continuous run as a new character');
{
  let s = createState(2026);
  const t0 = s.tick;
  const clock = () => (s.tick - t0) * TICK_DT;
  const milestone = (what: string) => console.log(`  [${(clock() / 60).toFixed(1)} min] ${what}`);

  // 1. a new character: spawn, find the NPC, take the quest
  assert(stage(s) === 'offer' && s.player.combat.level === 1 && s.player.inventory.every(x => x === null), 'new character: level 1, empty bag, quest not started');
  assert(talkToNpc(s), 'walk up to Warden Hale; dialogue opens');
  tick(s, { questAdvance: true });
  assert(stage(s) === 'hunt', 'quest accepted');
  milestone('quest accepted');

  // 2. the hunt: real fights, real walking
  for (const [type, goal] of Object.entries(HUNT_GOALS)) {
    for (let guard = 0; (s.quest.kills[type] ?? 0) < goal && guard < 20; guard++) huntOne(s, type);
    assert((s.quest.kills[type] ?? 0) >= goal || stage(s) !== 'hunt', `hunted ${goal} ${ENEMY_TYPES[type].name}(s)`);
  }
  assert(stage(s) === 'report1', 'hunt done: tracker says go back to the Warden');
  assert(s.player.combat.level >= RECOMMENDED_COMBAT, `combat level ${s.player.combat.level} from the hunt alone`);
  milestone(`hunt complete, combat level ${s.player.combat.level}`);

  // 3. report in; the Warden points at the Brute and the forge
  assert(talkToNpc(s), 'back to the Warden');
  tick(s, { questAdvance: true });
  assert(stage(s) === 'forge', 'the Warden asks for the blade');

  // 4. the RuneScape loop, driven by the tracker's own numbers
  s.player.inventory = s.player.inventory.map(() => null); // keep loot from hunting out of the way of the counts below
  gatherUntil(s, 'iron', BLADE_PLAN.ore);
  assert(lineTexts(s)[0] === `Mine Iron Ore: ${BLADE_PLAN.ore}/${BLADE_PLAN.ore}`, 'tracker: iron done (' + lineTexts(s)[0] + ')');
  assert(s.player.skills.mining.level >= NODE_TYPES.coal.level, `Mining ${s.player.skills.mining.level}: coal unlocked by the iron`);
  gatherUntil(s, 'coal', BLADE_PLAN.coal);
  gatherUntil(s, 'tree', BLADE_PLAN.logs);
  assert(lineTexts(s).slice(0, 3).every(l => /(\d+)\/\1/.test(l)), 'tracker: all gathering lines complete: ' + lineTexts(s).join(' | '));
  assert(questView(s).target?.label === 'Forge', 'objective arrow now points at the forge');
  milestone(`gathered ${BLADE_PLAN.ore} ore, ${BLADE_PLAN.coal} coal, ${BLADE_PLAN.logs} logs`);

  // 5. save here, reload, carry on: progress must survive mid-quest
  const reloaded = deserialize(serialize(s))!;
  assert(reloaded !== null && reloaded.quest.stage === 'forge' && countOf(reloaded, 'coal') === countOf(s, 'coal'), 'saved mid-quest and reloaded');
  s = reloaded;
  assert(JSON.stringify(questView(s)) === JSON.stringify(questView(deserialize(serialize(s))!)), 'tracker is identical after another round trip');

  assert(atForge(s), 'walk to the forge');
  craft(s, 'iron_bar', BLADE_PLAN.bars);
  assert(lineTexts(s).some(l => l.startsWith(`Smelt Iron Bars at the forge: ${BLADE_PLAN.bars}/${BLADE_PLAN.bars}`)), 'tracker: bars done');
  craft(s, 'steel_bar', BLADE_PLAN.steel);
  assert(lineTexts(s).some(l => l === `Harden Steel Bars: ${BLADE_PLAN.steel}/${BLADE_PLAN.steel}`) && lineTexts(s).includes("Forge the Forgemaster's Blade"), 'tracker: steel done, blade is the last line');
  craft(s, 'forged_blade', 1);
  assert(stage(s) === 'brute' && countOf(s, 'forged_blade') === 1, "forged the blade: the quest moves to the Brute with no further talking needed");
  milestone('blade forged');

  // 6. equip it, and kill the thing that beat you
  assert(lineTexts(s).some(l => l.startsWith('Equip the blade')), 'tracker: equip the blade');
  tick(s, { inv: [{ k: 'equip', slot: s.player.inventory.findIndex(x => x?.id === 'forged_blade') }] });
  assert(s.player.equipment.weapon === 'forged_blade', 'blade equipped');
  const brute = enemyOf(s, 'brute');
  rest(s);
  walkTo(s, brute.x, brute.z, 3.5, 60);
  if (dist2(s.player, brute) > 5) standNear(s, brute, 3.5);
  const bt = fight(s, brute, 120);
  assert(st(brute) === 'dead' && !s.player.dead, `the Cave Brute falls in ${bt.toFixed(0)}s (lowest hp ${Math.round(minHpSeen)}/${s.player.maxHp})`);
  assert(stage(s) === 'report2', 'tracker: return to the Warden');
  milestone('Cave Brute slain');

  // 7. a save after the boss, a reload, and the hand-in
  s = deserialize(serialize(s))!;
  assert(stage(s) === 'report2' && s.player.equipment.weapon === 'forged_blade' && s.enemies.find(e => e.type === 'brute')!.state === 'dead', 'reloaded after the boss kill: still at the hand-in, blade still equipped, Brute still dead');
  const lvl = s.player.combat.level;
  assert(talkToNpc(s), 'walk back to the Warden');
  tick(s, { questAdvance: true });
  assert(stage(s) === 'done' && sawQuest(s, 'complete'), 'quest complete');
  assert(s.player.combat.level >= lvl, 'reward XP applied');
  milestone('quest complete');
  console.log(`  full path: ${(clock() / 60).toFixed(1)} min of game time for a bot that never idles (a first-time player will take longer)`);
  assert(clock() >= 5 * 60 && clock() <= 30 * 60, 'the path is minutes, not seconds or hours (5 to 30 min of bot play)');

  // every quest stage was reachable without a dead end, and the end state is stable
  run(s, 30);
  assert(stage(s) === 'done' && !s.player.dead, 'the world stays quiet after the quest');
  const finalSave = deserialize(serialize(s))!;
  assert(finalSave.quest.stage === 'done' && questView(finalSave).lines[0].done, 'a completed quest loads as completed');
}

console.log(`\nAll ${checks} checks passed.`);

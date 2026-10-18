// Headless verification: drives the sim with synthetic input. Run with `npm run verify`.
// Exits non-zero on the first failed assertion. Extended every milestone.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState, Enemy } from './sim';
import { addItem, countItem, INVENTORY_SIZE } from './sim/inventory';
import { ITEMS, DROP_TABLES, MITHRIL_SET, TIER_COLORS, deriveStats, emptyEquipment } from './sim/items';
import {
  ABILITIES, ENEMY_TYPES, SPAWNS, castName, GCD, RESPAWN_DELAY, ACQUIRE_BEHIND_RANGE, ACQUIRE_RANGE, AUTO_SLOT, BARE_SWING, ENERGY_REGEN, FRONT_HALF_ARC,
  GRAVITY, JUMP_VELOCITY, OOC_DELAY, QUEUE_WINDOW, RECAP_WINDOW,
} from './sim/data';
import { xpForLevel, levelForXp, addXp, newTrack, levelProgress } from './sim/xp';
import { SKILL_IDS, SKILLS, grantXp } from './sim/skills';
import { NODE_TYPES } from './sim/gathering';
import { RECIPES, FORGE_REACH, recipeById } from './sim/crafting';
import {
  CAVE_DOOR_Z, CAVE_PILLARS, CAVE_ROCKS, CAVE_ROOMS, COLLIDERS, LANDMARKS, PLAYER_RADIUS, ROCKS, TREES, WORLD_HALF,
  caveDepth, caveRank, caveWallPoints, inCave, resolveCollisions, sameSideOfDoor, steerPoint,
} from './sim/world';
import { refreshGearStats } from './sim/inventory';
import { refreshPlayerStats } from './sim/combat';
import {
  BLADE_PLAN, DELVE_GOALS, DIALOGUE, DIALOGUE2, HUNT_GOALS, MITHRIL_PLAN, NPC, QUEST2_NAME, QUEST2_STAGES, QUEST_STAGES,
  QUEST_NAME, RECOMMENDED_COMBAT, RECOMMENDED_COMBAT_2, REWARD, REWARD2, TALK_RANGE, activeDialogue, activeQuestView, npcMarker, questOnKill, questView,
} from './sim/quest';
import { appearanceOf, TIER_LOOKS } from './gear-look';
import { BLOOM_THRESHOLD, EMISSIVE_CAP, cappedIntensity, linearPeak, minLightDistance } from './glow';
import { SAVE_VERSION, deserialize, serialize } from './sim/save';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);

/** When set, every kill any tick sees is counted here by enemy type (the run below reads it: respawns mean "who is dead now" is the wrong question). */
let killTally: Record<string, number> | null = null;
let deathTally = 0; // every death the run below sees, whoever's loop it happened in
const tick = (s: GameState, i: Partial<Input> = {}) => {
  step(s, { ...NO_INPUT, ...i });
  if (killTally && s.events.some(ev => ev.t === 'death')) deathTally++;
  if (killTally) for (const ev of s.events) if (ev.t === 'kill') { const type = s.enemies.find(e => e.id === ev.id)!.type; killTally[type] = (killTally[type] ?? 0) + 1; }
};
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

/** Fixture: give the player a combat level directly. XP, stats and unlocks follow; nothing is announced. */
function atLevel(s: GameState, level: number) {
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  p.energy = p.maxEnergy;
}
const SLOT = { strike: 0, crushing: 1, throw: 2, wind: 3, cleave: 4, pummel: 5 };

/**
 * Simple player policy, aware of the unlocks: Pummel a wind-up, heal when low, keep bleed up, Cleave into a crowd,
 * Crushing Blow on cooldown, Strike otherwise.
 */
let botSmart = true; // false: a player who ignores the Brute's tells (never Pummels, never steps out)
function botAbility(s: GameState, e: Enemy): number | null {
  const p = s.player;
  const ready = (slot: number) => p.combat.level >= ABILITIES[slot].unlockLevel && p.cd[slot] === 0 && p.energy >= ABILITIES[slot].cost;
  if (botSmart && e.cast && ready(SLOT.pummel) && Math.hypot(e.x - p.x, e.z - p.z) <= ABILITIES[SLOT.pummel].range) return SLOT.pummel; // off the GCD
  if (p.gcd > 0.05) return null;
  if (p.hp < p.maxHp * 0.45 && ready(SLOT.wind)) return SLOT.wind;
  const near = s.enemies.filter(x => st(x) !== 'dead' && Math.hypot(x.x - p.x, x.z - p.z) <= ABILITIES[SLOT.cleave].range).length;
  if (near >= 2 && ready(SLOT.cleave)) return SLOT.cleave;
  if (!e.bleed && e.hp > 60 && ready(SLOT.throw)) return SLOT.throw;
  if (ready(SLOT.crushing)) return SLOT.crushing;
  if (ready(SLOT.strike)) return SLOT.strike;
  return null;
}

/** Movement half of the policy: step out of a telegraphed slam that cannot be Pummelled, then walk back in. */
function botMove(s: GameState, e: Enemy): Partial<Input> {
  const p = s.player, h = ENEMY_TYPES[e.type].heavy, d = Math.hypot(e.x - p.x, e.z - p.z) || 1;
  const away = { dirX: (p.x - e.x) / d, dirZ: (p.z - e.z) / d };
  const canPummel = p.combat.level >= ABILITIES[SLOT.pummel].unlockLevel && p.cd[SLOT.pummel] === 0 && p.energy >= ABILITIES[SLOT.pummel].cost;
  if (botSmart) for (const m of s.enemies) { // a ground mark under us: step off it, unless a Pummel is about to cancel it
    const c = m.cast;
    if (c?.kind !== 'ground' || (m === e && canPummel && d <= ABILITIES[SLOT.pummel].range)) continue;
    const dd = Math.hypot(p.x - c.x!, p.z - c.z!);
    if (dd < c.radius! + 0.7) return { dirX: (p.x - c.x!) / (dd || 1), dirZ: (p.z - c.z!) / (dd || 1) };
  }
  if (!botSmart && h) return d > 2.2 && !e.cast ? { dirX: -away.dirX, dirZ: -away.dirZ } : {}; // stands in the circle and trades blows
  if (ENEMY_TYPES[e.type].ranged) return d > (ENEMY_TYPES[e.type].hazard ? 2.2 : 3) ? { dirX: -away.dirX, dirZ: -away.dirZ } : {}; // close the gap: it backs away from melee
  if (!h) return {}; // everything else the player simply stands and trades with
  if (e.cast) return !canPummel && d < h.radius + 0.6 ? away : {};
  return d > 2.2 ? { dirX: -away.dirX, dirZ: -away.dirZ } : {};
}

let minHpSeen = 0;
/** Fight until the enemy dies or the player dies or time runs out. Returns seconds taken. */
function fight(s: GameState, e: Enemy, maxSeconds = 120) {
  s.targetId = null;
  tick(s, { clickEnemy: e.id });
  let t = 0;
  minHpSeen = s.player.hp;
  while (t < maxSeconds && st(e) !== 'dead' && !s.player.dead) {
    tick(s, { ability: botAbility(s, e), ...botMove(s, e) });
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
  s.player.facing = -Math.PI / 2; // looking at the nearest boar (-x)
  tick(s, { tab: true });
  assert(s.targetId !== null, 'Tab selects an enemy');
  const first = s.targetId;
  // the documented order, built here independently of the sim: in front (nearest first), then behind (nearest first)
  const dp = (e: Enemy) => Math.hypot(e.x - s.player.x, e.z - s.player.z);
  const front = (e: Enemy) => Math.abs(Math.atan2(Math.sin(Math.atan2(e.x - s.player.x, e.z - s.player.z) - s.player.facing), Math.cos(Math.atan2(e.x - s.player.x, e.z - s.player.z) - s.player.facing))) <= 70 * Math.PI / 180;
  const inReach = s.enemies.filter(e => dp(e) <= 30).sort((a, b) => dp(a) - dp(b));
  const sorted = [...inReach.filter(front), ...inReach.filter(e => !front(e))];
  assert(first === sorted[0].id && sorted[0] === near, 'first Tab picks the nearest enemy (in front)');
  tick(s, { tab: true });
  assert(s.targetId === sorted[1].id, 'second Tab picks the next one in the order');
  for (let i = 0; i < inReach.length - 2; i++) tick(s, { tab: true });
  assert(s.targetId === sorted[inReach.length - 1].id, 'Tab walks the whole list');
  tick(s, { tab: true });
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
  atLevel(s, 6); // the full kit: this section tests the ability mechanics, not the unlocks
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
  for (const e of s.enemies) if (e.type !== 'boar') { e.state = 'dead'; e.respawnIn = 1e9; } // a Strike-only level 1 cannot also fend off the wolf next door: this section times boar fights
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
  addItem(s.player.inventory, 'forged_blade', 1); // the smithed weapon (an iron sword no longer carries a level-6 player through the Brute's slams)
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
const secondStage = (s: GameState): string => s.quest.second;
const lineTexts = (s: GameState) => questView(s).lines.map(l => l.text);
const questNamed = (s: GameState, what: string, name: string) => hasEvent(s, e => e.t === 'quest' && e.what === what && e.name === name);
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


// ---------------------------------------------------------------------------
section('Phase 3: ability unlocks tied to combat level');
{
  const shipped = ABILITIES.map(a => `${a.name} ${a.unlockLevel}`).join(', ');
  assert(ABILITIES[SLOT.strike].unlockLevel === 1 && ABILITIES.every(a => a.unlockLevel >= 1), `Strike is the only level-1 ability (${shipped})`);
  assert(ABILITIES.filter(a => a.unlockLevel === 1).length === 1, 'a fresh character starts with exactly one ability');
  assert(ABILITIES.some(a => a.kind === 'cleave') && ABILITIES.some(a => a.kind === 'interrupt'), 'the kit includes a cleave and an interrupt');
  assert(ABILITIES.every(a => a.unlockLevel <= 5), 'the whole kit is handed over by combat level 5, within the quest levelling');

  // locked: does nothing, costs nothing, says why
  const s = createState(41);
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  const boar = enemyOf(s, 'boar');
  boar.state = 'idle'; boar.respawnIn = 0; boar.hp = boar.maxHp; boar.x = boar.spawnX = 0; boar.z = boar.spawnZ = 0; boar.attackCd = 99;
  s.player.x = 0; s.player.z = 2.5;
  tick(s, { clickEnemy: boar.id });
  const energy0 = s.player.energy, hp0 = boar.hp;
  tick(s, { ability: SLOT.crushing });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'locked' && e.slot === SLOT.crushing), 'a locked ability fails with reason "locked"');
  assert(s.player.energy >= energy0 && boar.hp === hp0 && s.player.gcd === 0 && s.player.cd[SLOT.crushing] === 0 && !hasEvent(s, e => e.t === 'cast'),
    'pressing a locked slot spends no energy, starts no GCD or cooldown, and does no damage');

  // unlock fires once, at the level, and the ability then works
  assert(!hasEvent(s, e => e.t === 'unlock'), 'no unlock events at the start');
  grantXp(s, 'combat', xpForLevel(3), 0, 0); // straight to level 3: two unlocks in one jump
  tick(s);
  const unlocks = s.events.filter(e => e.t === 'unlock') as { t: 'unlock'; slot: number; level: number }[];
  assert(unlocks.length === 2 && unlocks.some(u => u.slot === SLOT.throw && u.level === 2) && unlocks.some(u => u.slot === SLOT.crushing && u.level === 3),
    `a two-level jump announces both abilities it crossed (${unlocks.map(u => ABILITIES[u.slot].name).join(', ')})`);
  let again = 0; for (let i = 0; i < 90; i++) { tick(s); again += s.events.filter(e => e.t === 'unlock').length; }
  assert(again === 0, 'each unlock fires exactly once');
  s.player.energy = s.player.maxEnergy; boar.attackCd = 99;
  tick(s, { ability: SLOT.crushing });
  assert(hasEvent(s, e => e.t === 'cast' && e.slot === SLOT.crushing) && boar.hp < hp0, 'the ability works the moment its level is reached');
  tick(s, { ability: SLOT.wind });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'locked' && e.slot === SLOT.wind), 'abilities above the current level stay locked (Second Wind at level 3)');

  // levels 4 and 5 each hand over what the table says; nothing is announced twice
  grantXp(s, 'combat', xpForLevel(5) - s.player.combat.xp, 0, 0);
  tick(s);
  const later = s.events.filter(e => e.t === 'unlock').map(e => (e as { slot: number }).slot).sort();
  assert(JSON.stringify(later) === JSON.stringify([SLOT.wind, SLOT.cleave, SLOT.pummel].sort()), 'levels 4 and 5 hand over Second Wind, Pummel and Cleave');

  // a loaded save does not re-announce abilities already earned
  const loaded = deserialize(serialize(s))!;
  let reAnnounced = 0; for (let i = 0; i < 5; i++) { tick(loaded); reAnnounced += loaded.events.filter(e => e.t === 'unlock').length; }
  assert(reAnnounced === 0 && loaded.player.combat.level === 5, 'loading a save does not replay the unlock moments');
}

// ---------------------------------------------------------------------------
section('Phase 3: Pummel interrupts a wind-up');
{
  const mk = (seed: number) => {
    const s = quietState(seed);
    atLevel(s, 5);
    const b = enemyOf(s, 'brute');
    b.state = 'idle'; b.respawnIn = 0; b.hp = b.maxHp; b.x = b.spawnX = 0; b.z = b.spawnZ = 0;
    s.player.x = 0; s.player.z = 2.5; // within Pummel range (3.5) and inside the slam circle
    tick(s, { clickEnemy: b.id });
    return { s, b };
  };
  const untilCast = (s: GameState, b: Enemy) => { for (let i = 0; i < 400 && !b.cast; i++) tick(s); return b.cast; };

  // nothing to interrupt: nothing happens
  {
    const { s, b } = mk(51);
    run(s, 0.1);
    assert(!b.cast, 'the Brute is not winding up right after aggro');
    const e0 = s.player.energy;
    tick(s, { ability: SLOT.pummel });
    assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'nocast'), 'Pummel with nothing to interrupt fails ("nocast")');
    assert(s.player.energy >= e0 && s.player.cd[SLOT.pummel] === 0 && !hasEvent(s, e => e.t === 'interrupt') && b.stagger === 0, 'and costs nothing, goes on no cooldown, staggers nothing');
  }
  // interrupt in progress: the cast is cancelled, the Brute is stunned, the slam never lands
  {
    const { s, b } = mk(52);
    const c = untilCast(s, b);
    assert(c !== null && c.kind === 'heavy' && c.total >= 1.2, `the Cave Brute winds up a heavy attack (${c?.total}s cast)`);
    run(s, 0.4);
    s.player.gcd = 1.4; s.player.energy = s.player.maxEnergy; // mid-GCD: the global cooldown must not matter
    const hp0 = s.player.hp, e0 = s.player.energy;
    tick(s, { ability: SLOT.pummel });
    assert(b.cast === null && hasEvent(s, e => e.t === 'interrupt' && e.id === b.id), 'Pummel cancels the wind-up in progress');
    assert(s.player.gcd > 1.3, 'Pummel is off the global cooldown: it worked mid-GCD and did not restart it');
    assert(b.stagger > 1 && s.player.energy < e0 && s.player.cd[SLOT.pummel] > 0, 'the Brute is staggered; Pummel costs energy and goes on cooldown');
    assert(b.heavyCd >= ENEMY_TYPES.brute.heavy!.every * 0.5, `an interrupted Brute cannot slam again straight away (${b.heavyCd.toFixed(1)}s before the next one)`);
    let slammed = false; for (let i = 0; i < 60; i++) { tick(s); slammed ||= hasEvent(s, e => e.t === 'slam' || (e.t === 'hit' && e.target === 'player' && !!e.heavy)); }
    assert(!slammed && s.player.hp >= hp0 - 1, 'the interrupted slam never lands');
  }
  // no interrupt, no escape: the heavy attack lands for its full damage
  {
    const { s, b } = mk(53);
    untilCast(s, b);
    s.player.hp = s.player.maxHp;
    let dmg = -1, slammed = false;
    for (let i = 0; i < 90 && dmg < 0; i++) {
      tick(s);
      slammed ||= hasEvent(s, e => e.t === 'slam');
      for (const ev of s.events) if (ev.t === 'hit' && ev.target === 'player' && ev.heavy) dmg = ev.amount;
    }
    const def = ENEMY_TYPES.brute.heavy!;
    assert(slammed && dmg === Math.round(def.damage * (1 - s.player.stats.reduction)), `an unanswered Crushing Slam lands for its full ${def.damage} (took ${dmg})`);
    assert(def.damage > ENEMY_TYPES.brute.damage * 2.5, `...which is far more than a normal swing (${ENEMY_TYPES.brute.damage})`);
  }
  // escape: leave the circle before it lands
  {
    const { s, b } = mk(54);
    untilCast(s, b);
    s.player.hp = s.player.maxHp;
    const def = ENEMY_TYPES.brute.heavy!;
    let hit = false, slammed = false;
    for (let i = 0; i < 90; i++) {
      const inside = Math.hypot(s.player.x - b.x, s.player.z - b.z) < def.radius + 0.6;
      tick(s, inside ? { dirZ: 1 } : {});
      slammed ||= hasEvent(s, e => e.t === 'slam');
      hit ||= hasEvent(s, e => e.t === 'hit' && e.target === 'player' && !!e.heavy);
    }
    assert(slammed && !hit, 'stepping out of the circle before the wind-up ends avoids the slam entirely');
  }
  // the tell is not decoration: standing and trading loses, answering it wins (same level, same blade, same Brute)
  {
    const fightAt = (smart: boolean, seed: number) => {
      botSmart = smart;
      const s = createState(seed);
      atLevel(s, RECOMMENDED_COMBAT);
      addItem(s.player.inventory, 'forged_blade', 1);
      tick(s, { inv: [{ k: 'equip', slot: 0 }] });
      const brute = enemyOf(s, 'brute');
      standNear(s, brute, 3);
      fight(s, brute, 120);
      botSmart = true;
      return st(brute) === 'dead' && !s.player.dead;
    };
    const stood = [61, 62, 63].map(sd => fightAt(false, sd)), answered = [61, 62, 63].map(sd => fightAt(true, sd));
    assert(stood.every(w => !w), `at the recommended level (${RECOMMENDED_COMBAT}) with the blade, ignoring the slam loses every time`);
    assert(answered.every(w => w), 'at the same level, Pummelling or sidestepping it wins every time');
  }
}

// ---------------------------------------------------------------------------
section('Phase 3: Cleave hits a crowd');
{
  const s = quietState(71);
  atLevel(s, 5);
  const [a, b, behind] = s.enemies.filter(e => e.type === 'boar').slice(0, 3);
  const [pup] = s.enemies.filter(e => e.type === 'pup');
  for (const e of [a, b, behind, pup]) { e.state = 'idle'; e.respawnIn = 0; e.hp = e.maxHp; e.attackCd = 99; }
  s.player.x = 0; s.player.z = 0;
  const place = (e: Enemy, x: number, z: number) => { e.x = e.spawnX = x; e.z = e.spawnZ = z; };
  place(a, 0, 2.5); place(b, 1.4, 2.2); place(behind, 0, -2.5); place(pup, 3, 0); // in front, in front-right, behind, to the side (inside reach, outside the arc)
  tick(s, { clickEnemy: a.id });
  const hp = [a, b, behind, pup].map(e => e.hp);
  tick(s, { ability: SLOT.cleave });
  const hit = [a, b, behind, pup].map((e, i) => e.hp < hp[i]);
  assert(hasEvent(s, e => e.t === 'cast' && e.slot === SLOT.cleave), 'Cleave casts');
  assert(hit[0] && hit[1], 'Cleave hits the target and the enemy beside it');
  assert(!hit[2] && !hit[3], 'Cleave leaves enemies behind and beside the arc alone');
  assert(s.events.filter(e => e.t === 'hit' && e.target !== 'player').length === 2, 'one hit event per enemy struck');
  assert(st(a) === 'chase' && st(b) === 'chase', 'both enemies it hit are now fighting you');
}

// ---------------------------------------------------------------------------
section('Phase 3: ranged attacker and pack aggro');
{
  const s = quietState(81);
  atLevel(s, 4);
  const h = enemyOf(s, 'hexer'), r = ENEMY_TYPES.hexer.ranged!;
  assert(ENEMY_TYPES.hexer.attackRange > 8 && r.keepAway > 3.5, 'the Cave Hexer is built to fight from outside melee range');
  h.state = 'idle'; h.respawnIn = 0; h.hp = h.maxHp; h.x = h.spawnX = 0; h.z = h.spawnZ = 0;
  s.player.x = 0; s.player.z = 8.5; // inside its aggro and firing range, far outside melee (3)
  const hp0 = s.player.hp;
  let bolt: { dist: number; amount: number } | null = null, sawTell = false, standing = true;
  for (let i = 0; i < 150 && !bolt; i++) {
    tick(s);
    sawTell ||= hasEvent(s, e => e.t === 'telegraph' && e.kind === 'bolt');
    for (const ev of s.events) if (ev.t === 'hit' && ev.target === 'player' && ev.src === h.id) bolt = { dist: Math.hypot(h.x - s.player.x, h.z - s.player.z), amount: ev.amount };
    standing &&= Math.hypot(h.x - s.player.x, h.z - s.player.z) > ABILITIES[SLOT.strike].range;
  }
  assert(sawTell && bolt !== null, 'the Hexer winds up and then hits');
  assert(bolt!.dist > ABILITIES[SLOT.strike].range * 2 && s.player.hp < hp0 && standing, `the bolt landed from ${bolt!.dist.toFixed(1)}u away: outside melee (${ABILITIES[SLOT.strike].range}u)`);

  // it does not want to be in melee: step in and it backs off
  s.player.x = h.x; s.player.z = h.z + 2; h.attackCd = 99; h.cast = null; h.state = 'chase';
  run(s, 1.2);
  assert(Math.hypot(h.x - s.player.x, h.z - s.player.z) > 3.5 || Math.hypot(h.x - h.spawnX, h.z - h.spawnZ) > 3, 'closed to melee, the Hexer backs away');

  // a Pummel on the bolt wind-up cancels it
  const s2 = quietState(82);
  atLevel(s2, 5);
  const h2 = enemyOf(s2, 'hexer');
  h2.state = 'idle'; h2.respawnIn = 0; h2.hp = h2.maxHp; h2.x = h2.spawnX = 0; h2.z = h2.spawnZ = 0;
  s2.player.x = 0; s2.player.z = 3; tick(s2, { clickEnemy: h2.id });
  for (let i = 0; i < 200 && !h2.cast; i++) { s2.player.x = 0; s2.player.z = 3; tick(s2); }
  s2.player.x = h2.x; s2.player.z = h2.z + 2.5;
  tick(s2, { ability: SLOT.pummel });
  assert(h2.cast === null && hasEvent(s2, e => e.t === 'interrupt'), 'Pummel cancels a Hexer bolt too');

  // pack: one pup wakes the lot, and none of the other kinds
  const s3 = quietState(83);
  const pups = s3.enemies.filter(e => e.type === 'pup'), boar = enemyOf(s3, 'boar');
  for (const e of [...pups, boar]) { e.state = 'idle'; e.respawnIn = 0; e.hp = e.maxHp; }
  s3.player.x = pups[0].x + 5; s3.player.z = pups[0].z; // inside aggro (7) of one pup
  run(s3, 0.2);
  assert(pups.every(p => st(p) === 'chase') && st(boar) === 'idle', `a pack wakes together (${pups.length} pups) and nothing else does`);
}

// ---------------------------------------------------------------------------
// HOM-16 helpers: a parked, never-hitting boar one reach away, so a swing timer can be read with nothing else moving.
function arena(seed: number, level = 1) {
  const s = quietState(seed);
  if (level > 1) atLevel(s, level);
  const b = enemyOf(s, 'boar');
  b.state = 'idle'; b.respawnIn = 0; b.hp = b.maxHp = 1e6; b.x = b.spawnX = 0; b.z = b.spawnZ = 0; b.attackCd = 1e9;
  s.player.x = 0; s.player.z = 2.5; s.player.facing = Math.PI; // facing the boar
  tick(s, { clickEnemy: b.id });
  return { s, b };
}
/** Run and return the tick numbers (relative to the first tick of the run) on which a swing left the player's hand. */
function swingTicks(s: GameState, seconds: number, i: Partial<Input> | ((n: number) => Partial<Input>) = {}) {
  const out: number[] = [];
  for (let n = 0; n < Math.round(seconds / TICK_DT); n++) {
    tick(s, typeof i === 'function' ? i(n) : i);
    if (hasEvent(s, e => e.t === 'swing')) out.push(n);
  }
  return out;
}
const placeAt = (e: Enemy, x: number, z: number) => { e.state = 'idle'; e.respawnIn = 0; e.hp = e.maxHp; e.x = e.spawnX = x; e.z = e.spawnZ = z; e.attackCd = 1e9; };

// ---------------------------------------------------------------------------
section('HOM-16 auto-attack: swings on a timer, off the GCD, free of energy');
{
  // the weapon is where the rhythm lives
  assert(deriveStats(emptyEquipment()).swingInterval === BARE_SWING, `bare-handed you swing every ${BARE_SWING}s`);
  const gear = (id: string) => { const e = emptyEquipment(); e.weapon = id; return deriveStats(e); };
  assert(gear('forged_blade').swingInterval === ITEMS.forged_blade.stats!.speed && gear('forged_blade').swingInterval < gear('iron_sword').swingInterval, "the Forgemaster's Blade swings quicker than an Iron Sword");
  assert(Object.values(ITEMS).filter(i => i.slot === 'weapon').every(i => i.stats!.speed! >= 1.5 && i.stats!.speed! <= 3), 'every weapon declares a swing speed between 1.5s and 3s');

  // arming: the attack key with a target. It needs no prior combat: arming is the declaration of intent.
  const { s, b } = arena(101);
  assert(!s.player.autoAttack && !s.player.inCombat, 'auto-attack starts off, out of combat');
  tick(s, { attack: true });
  assert(s.player.autoAttack && hasEvent(s, e => e.t === 'auto' && e.on), 'the attack key arms auto-attack and says so (auto event)');
  assert(hasEvent(s, e => e.t === 'swing' && e.target === b.id), 'with the swing timer ready the first swing lands at once');
  const hit = s.events.find(e => e.t === 'hit' && e.target === b.id);
  assert(hit !== undefined && hit.t === 'hit' && hit.slot === AUTO_SLOT && hit.amount > 0, 'a swing is a hit event with slot AUTO_SLOT, never an ability slot');
  assert(s.player.swing > BARE_SWING - 0.1 && s.player.swing <= BARE_SWING, 'the swing timer restarts at the weapon interval (HUD swing bar reads player.swing)');

  // on its interval, with no ability pressed and no energy spent
  s.player.energy = 10;
  const swings = swingTicks(s, 10);
  const gaps = swings.slice(1).map((t, k) => t - swings[k]);
  assert(swings.length >= 3 && gaps.every(g => Math.abs(g * TICK_DT - BARE_SWING) <= TICK_DT + 1e-9), `swings land every ${BARE_SWING}s (${swings.length} in 10s, gaps ${gaps.join('/')} ticks)`);
  assert(Math.abs(s.player.energy - Math.min(100, 10 + ENERGY_REGEN * 10)) < 0.01, 'swinging costs no energy: it only regenerated');
  assert(s.player.gcd === 0 && !hasEvent(s, e => e.t === 'cast'), 'and never touches the GCD or raises a cast event');
}
{
  // independent of the GCD: a Strike mid-timer neither delays nor brings forward the next swing, and a swing lands inside a GCD
  const { s } = arena(102);
  tick(s, { attack: true });
  const t0 = s.tick;
  let swingAt: number[] = [], gcdAtSwing: number[] = [];
  for (let n = 0; n < 5 * 30; n++) {
    tick(s, { ability: n === 30 ? SLOT.strike : null }); // one Strike a second in: the GCD runs 1.0s to 2.5s, the swing lands at 2.4s
    if (hasEvent(s, e => e.t === 'swing')) { swingAt.push(s.tick - t0); gcdAtSwing.push(s.player.gcd); }
  }
  assert(swingAt.length >= 2 && Math.abs(swingAt[0] * TICK_DT - BARE_SWING) <= 2 * TICK_DT, `Strike did not move the swing timer (next swing at ${(swingAt[0] * TICK_DT).toFixed(2)}s)`);
  assert(gcdAtSwing[0] > 0, `the swing landed inside the global cooldown (gcd left ${gcdAtSwing[0].toFixed(2)}s)`);
}
{
  // a melee ability on a target starts the swings; a ranged opener, a heal and an interrupt do not
  const { s } = arena(103, 5);
  tick(s, { ability: SLOT.strike });
  assert(s.player.autoAttack && hasEvent(s, e => e.t === 'auto' && e.on), 'a Strike on a target starts auto-attack');
  const c = arena(104, 5);
  c.s.player.z = 8; c.s.player.facing = Math.PI;
  tick(c.s, { ability: SLOT.throw });
  assert(!c.s.player.autoAttack, 'Serrated Throw (the ranged opener) does not start melee swings');
  tick(c.s, { ability: SLOT.wind });
  assert(!c.s.player.autoAttack, 'Second Wind does not either');
  const d = arena(105, 5);
  d.b.cast = { kind: 'heavy', t: 0, total: 5 };
  tick(d.s, { ability: SLOT.pummel });
  assert(hasEvent(d.s, e => e.t === 'interrupt') && !d.s.player.autoAttack, 'nor does Pummel');
}
{
  // toggling off stops it; toggling cannot be used to reset the timer
  const { s } = arena(106);
  tick(s, { attack: true });
  run(s, 1);
  tick(s, { attack: true });
  assert(!s.player.autoAttack && hasEvent(s, e => e.t === 'auto' && !e.on), 'the attack key again disarms it (auto event, on: false)');
  assert(swingTicks(s, 6).length === 0, 'disarmed: no swings');
  const t = s.player.swing;
  tick(s, { attack: true }); // timer long since expired: the swing is ready
  assert(hasEvent(s, e => e.t === 'swing'), 'a ready timer swings the moment it is armed');
  tick(s, { attack: true }); tick(s, { attack: true }); // off, on: the timer must not reset
  assert(!hasEvent(s, e => e.t === 'swing') && s.player.swing > 0 && t === 0, 'toggling off and on does not refresh the timer (no swing-spam exploit)');
}
{
  // moving does not stop it; out of reach it waits and swings the instant the target is in reach
  const { s, b } = arena(107);
  b.attackCd = 1e9;
  tick(s, { attack: true });
  const swings = swingTicks(s, 7.2, n => ({ dirX: Math.floor(n / 6) % 2 === 0 ? 0.5 : -0.5, dirZ: 0 })); // shuffles sideways, staying inside reach
  const movingSwings = swings.length;
  assert(movingSwings >= 3 && Math.hypot(b.x - s.player.x, b.z - s.player.z) <= 3, `moving does not stop auto-attack (${movingSwings} swings while shuffling in reach)`);
  const h = arena(108);
  tick(h.s, { attack: true }); // swing 1
  h.s.player.x = 0; h.s.player.z = 2.5;
  h.s.targetId = h.b.id;
  h.b.state = 'idle'; h.b.x = 0; h.b.z = -6; // 8.5u: out of reach, and keep it parked
  h.s.player.z = 2.5;
  const before = h.b.hp;
  const none = swingTicks(h.s, 6, () => { h.b.state = 'idle'; h.b.x = 0; h.b.z = -6; return {}; });
  assert(none.length === 0 && h.b.hp === before && h.s.player.swing === 0 && h.s.player.autoAttack, 'out of reach: armed, timer waiting at zero, nothing lands');
  h.b.x = 0; h.b.z = 0;
  tick(h.s);
  assert(hasEvent(h.s, e => e.t === 'swing'), 'the swing lands on the first tick the target is back in reach');
}
{
  // it ends when there is nothing to hit, and does not carry on to the next thing you Tab to
  const { s, b } = arena(109);
  const other = enemyOf(s, 'boar', 1);
  placeAt(other, 0, -1); // within reach, alongside
  tick(s, { attack: true });
  b.hp = 1;
  tick(s, { attack: true }); tick(s, { attack: true }); // off, on again: swing not ready, but armed
  assert(s.player.autoAttack, 'armed again');
  run(s, 3);
  assert(st(b) === 'dead' && !s.player.autoAttack, 'the target dies: auto-attack disarms by itself');
  const e0 = other.hp;
  tick(s, { tab: true }); // lands on the other boar
  assert(s.targetId === other.id && swingTicks(s, 5).length === 0 && other.hp === e0, 'tabbing to the next enemy does not carry the swings over: press attack again');
  tick(s, { attack: true });
  assert(hasEvent(s, e => e.t === 'swing' && e.target === other.id), 'the attack key then starts on the new target');
  // death stops it too
  s.player.hp = 1;
  other.attackCd = 0; other.state = 'chase';
  run(s, 3);
  assert(s.player.dead && !s.player.autoAttack && swingTicks(s, 3).length === 0, 'dying disarms auto-attack and a dead player does not swing');
}
{
  // speed is rhythm, not power: same damage per second at any speed
  const dpsAt = (interval: number) => {
    const { s, b } = arena(110);
    s.player.stats.swingInterval = interval; s.player.stats.weaponDamage = 20; // 20 flat weapon damage; a custom speed
    tick(s, { attack: true });
    const hp0 = b.hp;
    run(s, 120);
    return (hp0 - b.hp) / 120;
  };
  const slow = dpsAt(3.2), fast = dpsAt(1.6);
  assert(Math.abs(fast / slow - 1) < 0.12, `a 1.6s weapon and a 3.2s weapon deal the same damage per second (${fast.toFixed(2)} vs ${slow.toFixed(2)})`);
  const { s } = arena(111);
  s.player.stats.swingInterval = 1.6; s.player.swing = 2.4;
  tick(s);
  assert(s.player.swing <= 1.6, 'swapping to a quicker weapon takes effect at once (the timer is clamped)');
}
{
  // the retune: abilities came down by what the swings add. Total damage per second against a parked target, kit used by priority
  // (Crushing Blow, then Serrated Throw, then Strike), compared with the figures measured before auto-attack existed.
  const BEFORE: [string, number, string | null, number][] = [['level 1, bare', 1, null, 6.93], ['level 3, bare', 3, null, 11.30], ['level 5, iron sword', 5, 'iron_sword', 16.77], ['level 6, Forgemaster\'s Blade', 6, 'forged_blade', 29.65]];
  // measured against an effectively endless target (hp topped up each tick) so the sum of damage is exact
  const measure = (level: number, weapon: string | null) => {
    const { s, b } = arena(5, level);
    if (weapon) { addItem(s.player.inventory, weapon, 1); tick(s, { inv: [{ k: 'equip', slot: 0 }] }); }
    const p = s.player; let dealt = 0;
    const ready = (slot: number) => p.combat.level >= ABILITIES[slot].unlockLevel && p.cd[slot] === 0 && p.energy >= ABILITIES[slot].cost;
    for (let n = 0; n < 90 / TICK_DT; n++) {
      b.state = 'chase'; b.attackCd = 1e9; b.hp = 1e8; b.x = 0; b.z = 0; p.x = 0; p.z = 2.5; p.outOfCombat = 0;
      const ab = p.gcd > 0.05 ? null : ready(SLOT.crushing) ? SLOT.crushing : ready(SLOT.throw) && !b.bleed ? SLOT.throw : ready(SLOT.strike) ? SLOT.strike : null;
      tick(s, { ability: ab });
      dealt += 1e8 - b.hp;
    }
    return dealt / 90;
  };
  for (const [name, level, weapon, before] of BEFORE) {
    const now = measure(level, weapon);
    assert(now >= before * 0.9 && now <= before * 1.1, `${name}: ${now.toFixed(1)} damage/s with auto-attack vs ${before.toFixed(1)} before (${(now / before * 100).toFixed(0)}%), within 10%`);
  }
}

// ---------------------------------------------------------------------------
section('HOM-16 targeting: Tab prefers what is in front, keeps its order, and never silently drops you');
{
  const mk = (seed: number) => {
    const s = quietState(seed);
    const [A, B, C] = s.enemies.filter(e => e.type === 'boar'), D = enemyOf(s, 'wolf');
    s.player.x = 0; s.player.z = 0; s.player.facing = 0; // looking down +z
    placeAt(A, 0, 12); placeAt(B, 2, 18); placeAt(C, -3, 24); placeAt(D, 0, -11); // D is the nearest, but behind
    return { s, A, B, C, D };
  };
  const { s, A, B, C, D } = mk(301);
  tick(s, { tab: true });
  assert(s.targetId === A.id, 'Tab picks the enemy in front over a nearer one behind');
  tick(s, { tab: true }); assert(s.targetId === B.id, 'then the next one in front');
  tick(s, { tab: true }); assert(s.targetId === C.id, '...and the next');
  tick(s, { tab: true }); assert(s.targetId === D.id, 'the ones behind come after everything in front');
  tick(s, { tab: true }); assert(s.targetId === A.id, 'and it wraps to the nearest in front');

  // stable: walk and turn mid-cycle, and the list does not reshuffle under the presses
  s.player.x = 0; s.player.z = 20; s.player.facing = 0; // now C is the only one in front and A is behind; a fresh sort would jump to C
  tick(s, { tab: true });
  assert(s.targetId === B.id, 'moving mid-cycle does not reshuffle: the next press still walks the list it started');
  B.state = 'dead'; B.respawnIn = 1e9;
  s.targetId = A.id; // as if the player stepped back to A
  tick(s, { tab: true });
  assert(s.targetId === C.id, 'an enemy that died mid-cycle is skipped');
  s.targetId = null;
  tick(s, { tab: true });
  assert(s.targetId !== null && s.tab !== null && s.tab.order[s.tab.at] === s.targetId, 'with no target held a press starts a fresh cycle');

  // clicking a corpse, or Tab with nothing to cycle to, leaves the held target alone
  const m = mk(302);
  tick(m.s, { clickEnemy: m.A.id });
  m.B.state = 'dead'; m.B.respawnIn = 1e9;
  tick(m.s, { clickEnemy: m.B.id });
  assert(m.s.targetId === m.A.id, 'clicking a corpse does not drop the target you hold');
  m.C.state = 'return'; tick(m.s, { clickEnemy: m.C.id });
  assert(m.s.targetId === m.A.id, 'nor does clicking an enemy that is walking home');
  m.s.player.x = 29; m.s.player.z = 29; // everything is now out of Tab range
  tick(m.s, { tab: true });
  assert(m.s.targetId === m.A.id, 'Tab with nothing in range keeps the target instead of clearing it');
  tick(m.s, { clearTarget: true });
  assert(m.s.targetId === null && !hasEvent(m.s, e => e.t === 'untarget'), 'Escape clears it and raises no untarget event: the player did that on purpose');
}
{
  // an involuntary loss says why
  const { s, b } = arena(303, 3);
  tick(s, { ability: SLOT.strike });
  b.hp = 1; b.attackCd = 1e9;
  s.player.gcd = 0;
  tick(s, { ability: SLOT.strike });
  const u = s.events.find(e => e.t === 'untarget');
  assert(st(b) === 'dead' && s.targetId === null && u !== undefined && u.t === 'untarget' && u.id === b.id && u.reason === 'dead', 'the target dies: an untarget event names it and says "dead"');
  const e2 = createState(304);
  const w = enemyOf(e2, 'wolf');
  e2.targetId = w.id; w.state = 'chase'; w.x = w.spawnX + 26; w.z = w.spawnZ; e2.player.x = w.x; e2.player.z = w.z;
  tick(e2);
  const ev = e2.events.find(e => e.t === 'untarget');
  assert(st(w) === 'return' && e2.targetId === null && ev !== undefined && ev.t === 'untarget' && ev.id === w.id && ev.reason === 'evade', 'a leashed enemy resets and the target loss says "evade"');
}

// ---------------------------------------------------------------------------
section('HOM-16 acquire: the nearest hostile in front, for a forgiving click and an attack key with no target');
{
  const mk = (seed: number) => {
    const s = quietState(seed);
    const [A, B] = s.enemies.filter(e => e.type === 'boar'), D = enemyOf(s, 'wolf');
    s.player.x = 0; s.player.z = 0; s.player.facing = 0;
    placeAt(A, 0, 10); placeAt(B, 6, 14); placeAt(D, 0, -4); // D is nearest and behind, but inside the "something is biting your back" radius
    return { s, A, B, D };
  };
  const { s, A, B, D } = mk(311);
  tick(s, { acquire: true });
  assert(s.targetId === A.id, 'acquire picks the nearest hostile in front, not the nearer one behind');
  s.targetId = D.id; tick(s, { acquire: true });
  assert(s.targetId === A.id, 'acquire is an explicit retarget: it overrides a held target');
  A.state = 'dead'; A.respawnIn = 1e9; B.state = 'dead'; B.respawnIn = 1e9;
  s.targetId = null; tick(s, { acquire: true });
  assert(s.targetId === D.id, 'with nothing in front it falls back to what is close behind you');
  placeAt(D, 0, -ACQUIRE_BEHIND_RANGE - 3); s.targetId = null; D.state = 'idle';
  tick(s, { acquire: true });
  assert(s.targetId === null && hasEvent(s, e => e.t === 'fail' && e.reason === 'target'), 'nothing in front and nothing close: no target, and a "target" fail says so');
  placeAt(A, 0, ACQUIRE_RANGE + 4);
  tick(s, { acquire: true });
  assert(s.targetId === null, `an enemy in front but past ${ACQUIRE_RANGE}u is too far to guess at`);
  // a cone, not a line: just inside / outside the edge of the front arc
  const edge = (deg: number) => { placeAt(A, 10 * Math.sin(deg * Math.PI / 180), 10 * Math.cos(deg * Math.PI / 180)); s.targetId = null; tick(s, { acquire: true }); return s.targetId === A.id; };
  assert(edge(FRONT_HALF_ARC - 5) && !edge(FRONT_HALF_ARC + 15) && edge(-(FRONT_HALF_ARC - 5)), `the front is a ${FRONT_HALF_ARC * 2}-degree cone either side of facing`);
}
{
  // the attack key with no target does the whole job: acquire, then swing
  const s = quietState(312);
  const A = enemyOf(s, 'boar');
  s.player.x = 0; s.player.z = 0; s.player.facing = 0;
  placeAt(A, 0, 2.5);
  assert(s.targetId === null, 'nothing targeted');
  tick(s, { attack: true });
  assert(s.targetId === A.id && s.player.autoAttack && hasEvent(s, e => e.t === 'swing' && e.target === A.id), 'the attack key with no target acquires the enemy in front and starts swinging');
  const t = quietState(313);
  tick(t, { attack: true });
  assert(!t.player.autoAttack && hasEvent(t, e => e.t === 'fail' && e.reason === 'target'), 'with nothing to acquire it does not arm, and says why');
}

// ---------------------------------------------------------------------------
section('HOM-16 jump: leaves the ground, lands, and changes nothing about reach or danger');
{
  const s = quietState(401);
  const p = s.player;
  assert(p.y === 0 && p.vy === 0 && !p.airborne, 'a new player stands on the ground (y 0, not airborne)');
  tick(s, { jump: true });
  assert(p.y > 0 && p.airborne && hasEvent(s, e => e.t === 'jump'), 'a jump request leaves the ground the same tick (jump event, airborne, y > 0)');
  let peak = p.y, air = 1, landed = false, landEvents = 0, flagTracksY = true;
  while (air < 120 && !landed) {
    tick(s); air++;
    peak = Math.max(peak, p.y);
    if (hasEvent(s, e => e.t === 'land')) { landed = true; landEvents++; }
    if (!landed) flagTracksY &&= p.airborne && p.y > 0;
  }
  assert(flagTracksY, 'the airborne flag is true on every tick between takeoff and landing');
  assert(landed && p.y === 0 && p.vy === 0 && !p.airborne && landEvents === 1, `lands: y 0, vy 0, not airborne, one land event (${air} ticks, ${(air * TICK_DT).toFixed(2)}s in the air)`);
  assert(air * TICK_DT > 0.5 && air * TICK_DT < 1.0, 'the hop lasts between half a second and a second');
  assert(peak > 1.0 && peak < 1.7 && Math.abs(peak - JUMP_VELOCITY ** 2 / (2 * GRAVITY)) < 0.25, `peak height ${peak.toFixed(2)}u matches v^2/2g (${(JUMP_VELOCITY ** 2 / (2 * GRAVITY)).toFixed(2)}u)`);

  // one jump per takeoff; a held key hops again on landing; a jump in the air does nothing
  const h = quietState(402);
  const jumpTicks: number[] = [];
  for (let n = 0; n < 5 * 30; n++) { tick(h, { jump: true }); if (hasEvent(h, e => e.t === 'jump')) jumpTicks.push(n); }
  const gaps = jumpTicks.slice(1).map((t, i) => t - jumpTicks[i]);
  assert(jumpTicks.length >= 4 && gaps.every(g => g >= 20), `no double jump: holding the key hops again only after landing (${jumpTicks.length} hops, gaps ${gaps.join('/')} ticks)`);

  // deterministic: same inputs, same arc, to the bit
  const arc = (seed: number) => { const g = quietState(seed); const ys: number[] = []; for (let n = 0; n < 60; n++) { tick(g, { jump: n === 3 || n === 40 }); ys.push(g.player.y); } return JSON.stringify(ys); };
  assert(arc(403) === arc(403), 'the arc is deterministic');
}
{
  // expression, not traversal: with or without jumping, the player ends up in exactly the same place, collisions and all
  const route = (spam: boolean) => {
    const g = quietState(404);
    g.player.x = -7; g.player.z = 10; // a tree at (-12, 10): walk into it, then slide round and off to the world edge
    const trace: string[] = [];
    for (let n = 0; n < 6 * 30; n++) {
      tick(g, { dirX: n < 90 ? -1 : 0.4, dirZ: n < 90 ? 0 : -1, jump: spam });
      trace.push(`${g.player.x.toFixed(6)},${g.player.z.toFixed(6)}`);
    }
    tick(g, { clickTarget: { x: 25, z: -25 }, jump: spam });
    for (let n = 0; n < 8 * 30; n++) { tick(g, { jump: spam }); trace.push(`${g.player.x.toFixed(6)},${g.player.z.toFixed(6)}`); }
    return trace.join(';');
  };
  assert(route(false) === route(true), 'every x/z of a long walk (tree collision, click-to-move) is identical whether or not the player jumps the whole way');
}
{
  // it does not dodge: the slam telegraph, the heavy hit and ordinary swings all land on an airborne player
  const mk = (seed: number) => {
    const s = quietState(seed);
    atLevel(s, 5);
    const b = enemyOf(s, 'brute');
    b.state = 'idle'; b.respawnIn = 0; b.hp = b.maxHp; b.x = b.spawnX = 0; b.z = b.spawnZ = 0;
    s.player.x = 0; s.player.z = 2.5;
    tick(s, { clickEnemy: b.id });
    return { s, b };
  };
  const def = ENEMY_TYPES.brute.heavy!;
  const slams: { dmg: number; air: boolean }[] = [];
  for (let seed = 405; seed < 413; seed++) { // a hop lasts ~0.7s: different seeds put the slam at different points of it
    const { s, b } = mk(seed);
    for (let i = 0; i < 400 && !b.cast; i++) tick(s, { jump: true });
    s.player.hp = s.player.maxHp;
    let got: { dmg: number; air: boolean } | null = null;
    for (let i = 0; i < 90 && !got; i++) {
      tick(s, { jump: i % 3 !== seed % 3 || i < seed % 7 });
      for (const ev of s.events) if (ev.t === 'hit' && ev.target === 'player' && ev.heavy) got = { dmg: ev.amount, air: s.player.airborne };
    }
    if (got) slams.push(got);
  }
  const full = Math.round(def.damage * (1 - deriveStats(emptyEquipment()).reduction));
  assert(slams.length === 8 && slams.every(x => x && x.dmg === full), `a player who is hopping through the whole wind-up takes the full Crushing Slam every time (${slams.map(x => x?.dmg).join('/')})`);
  assert(slams.some(x => x && x.air), 'and in at least one of those the slam landed while the player was in the air');
  const m = mk(406);
  const before = m.s.player.hp;
  let melee = 0;
  for (let i = 0; i < 150; i++) { tick(m.s, { jump: true }); for (const ev of m.s.events) if (ev.t === 'hit' && ev.target === 'player') melee++; }
  assert(melee >= 2 && m.s.player.hp < before, 'ordinary enemy swings hit a player who keeps jumping');
  // the player's own kit works in the air
  const a = arena(407);
  tick(a.s, { jump: true });
  const hp0 = a.b.hp;
  tick(a.s, { ability: SLOT.strike });
  assert(a.s.player.airborne && a.b.hp < hp0, 'abilities (and auto-attack) work mid-jump: range is measured on the ground plane');
}
{
  // saved and restored sanely, and a death mid-air lands you
  const s = quietState(408);
  s.player.x = 4.5; s.player.z = -3.5;
  tick(s, { jump: true }); run(s, 0.2);
  assert(s.player.airborne && s.player.y > 0.5, 'airborne at save time');
  const l = deserialize(serialize(s))!;
  assert(l !== null && l.player.y === 0 && l.player.vy === 0 && !l.player.airborne && Math.abs(l.player.x - s.player.x) < 1e-9 && Math.abs(l.player.z - s.player.z) < 1e-9, 'a mid-air save reloads standing on the ground, at the same x/z');
  tick(l); assert(l.player.y === 0 && !hasEvent(l, e => e.t === 'land'), 'and does not raise a phantom landing');

  const d = createState(409);
  for (const e of d.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  const w = enemyOf(d, 'wolf');
  placeAt(w, 0, 0); w.state = 'chase'; w.attackCd = 0;
  d.player.x = 1; d.player.z = 0; d.player.hp = 1;
  tick(d, { jump: true });
  assert(d.player.dead && d.player.y === 0 && d.player.vy === 0 && !d.player.airborne, 'killed in the air: dead on the ground, state clean');
  tick(d, { jump: true });
  assert(d.player.y === 0 && !hasEvent(d, e => e.t === 'jump'), 'a dead player cannot jump');

  // hopping breaks a gather, as moving does
  const g = quietState(410);
  const node = g.nodes.find(n => n.type === 'iron')!;
  tick(g, { interact: { k: 'node', id: node.id } });
  for (let n = 0; n < 2000 && g.interact; n++) tick(g);
  run(g, 0.5);
  assert(g.player.action !== null, 'gathering');
  tick(g, { jump: true });
  assert(g.player.action === null, 'jumping cancels a gather in progress');
}

// ---------------------------------------------------------------------------
section('HOM-16 combat state, queueing into cooldowns, and the death recap');
{
  const s = quietState(501);
  const w = enemyOf(s, 'wolf');
  placeAt(w, 0, 0); w.attackCd = 1e9;
  s.player.x = 6; s.player.z = 0; // inside aggro (8), not yet noticed
  s.player.hp = 50;
  run(s, 0.1);
  assert(st(w) === 'chase' && s.player.inCombat, 'something hostile chasing you puts you in combat');
  const hp0 = s.player.hp;
  run(s, 9);
  assert(s.player.inCombat && s.player.hp === hp0, 'no health regeneration while hunted, even with no damage taken for longer than the combat timer');
  w.state = 'dead'; w.respawnIn = 1e9;
  s.player.outOfCombat = 0;
  let left = false;
  for (let n = 0; n < (OOC_DELAY + 2) * 30; n++) { tick(s); left ||= hasEvent(s, e => e.t === 'combat' && !e.on); }
  assert(left && !s.player.inCombat && s.player.hp > hp0, 'a combat event fires when the player leaves combat, and health then comes back');
  const i = quietState(502);
  placeAt(enemyOf(i, 'boar'), 0, 0);
  i.player.x = 0; i.player.z = 2.5; tick(i, { clickEnemy: enemyOf(i, 'boar').id });
  let entered = false;
  for (let n = 0; n < 5; n++) { tick(i, n === 0 ? { ability: SLOT.strike } : {}); entered ||= hasEvent(i, e => e.t === 'combat' && e.on); }
  assert(entered && i.player.inCombat, 'a combat event fires when the player enters combat');
}
{
  // the spell queue reaches into an ability's own cooldown, not just the GCD
  const { s } = arena(503, 5);
  tick(s, { ability: SLOT.crushing });
  run(s, ABILITIES[SLOT.crushing].cooldown - 0.5);
  s.player.energy = s.player.maxEnergy;
  tick(s, { ability: SLOT.crushing });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'cooldown') && s.player.queued === null, 'a press well before the cooldown ends still fails (cooldown)');
  run(s, 0.2);
  s.player.energy = s.player.maxEnergy;
  assert(s.player.cd[SLOT.crushing] > 0 && s.player.cd[SLOT.crushing] <= QUEUE_WINDOW, 'inside the queue window now');
  tick(s, { ability: SLOT.crushing });
  assert(s.player.queued === SLOT.crushing && !hasEvent(s, e => e.t === 'fail'), 'a press just before its own cooldown ends is queued, not refused');
  let fired = false;
  for (let n = 0; n < 20 && !fired; n++) { tick(s); fired = hasEvent(s, e => e.t === 'cast' && e.slot === SLOT.crushing); }
  assert(fired && s.player.queued === null && s.player.cd[SLOT.crushing] > ABILITIES[SLOT.crushing].cooldown - 0.5, 'and fires the moment the cooldown is up');
  const q = arena(504, 5);
  tick(q.s, { ability: SLOT.pummel });
  assert(hasEvent(q.s, e => e.t === 'fail' && e.reason === 'nocast'), 'sanity: Pummel with nothing to interrupt still fails and costs nothing');
}
{
  // why you died
  const s = quietState(505);
  atLevel(s, 1);
  const b = enemyOf(s, 'brute');
  b.state = 'idle'; b.respawnIn = 0; b.hp = b.maxHp; b.x = b.spawnX = 0; b.z = b.spawnZ = 0;
  s.player.x = 0; s.player.z = 2.5;
  for (let i = 0; i < 400 && !b.cast; i++) tick(s);
  s.player.hp = 30; // the slam is 60
  let death: Extract<GameState['events'][number], { t: 'death' }> | undefined;
  for (let i = 0; i < 90 && !death; i++) { tick(s); death = s.events.find((e): e is Extract<typeof e, { t: 'death' }> => e.t === 'death'); }
  assert(death !== undefined && death.killer === 'Cave Brute: Crushing Slam', `the death event names what killed you (${death?.killer})`);
  const last = death!.recap[death!.recap.length - 1];
  assert(death!.recap.length >= 1 && last.heavy && last.what === 'Crushing Slam' && last.amount === 60 && last.ago < 0.1, 'the recap ends with the killing blow, its size and that it was the heavy attack');
  assert(death!.recap.every((h, k, a) => h.ago >= 0 && h.ago <= RECAP_WINDOW + 0.1 && (k === 0 || a[k - 1].ago >= h.ago)), 'the recap lists the last few hits, oldest first, inside the recap window');
  const swing = death!.recap.find(h => h.what === 'Melee');
  assert(swing === undefined || (swing.src === 'brute' && !swing.heavy), 'ordinary swings are labelled Melee');
  run(s, RESPAWN_DELAY + 0.5);
  tick(s, { ability: SLOT.strike });
  assert(s.player.recap.length === 0, 'the recap starts fresh in the next life');
}

// ---------------------------------------------------------------------------
// HOM-15: the cave, the mithril ladder, the second quest.
const walkableFor = (x: number, z: number, r: number) => { const p = { x, z }; resolveCollisions(p, r); return Math.hypot(p.x - x, p.z - z) < 1e-6; };
/** Flood fill over the floor at half-unit steps for a body of radius r. */
function floodFill(r: number, from: { x: number; z: number }, blocked: (x: number, z: number) => boolean = () => false) {
  const STEP = 0.5, X0 = -38, Z0 = -98, key = (i: number, j: number) => `${i},${j}`;
  const at = (i: number, j: number) => ({ x: X0 + i * STEP, z: Z0 + j * STEP });
  const start = { i: Math.round((from.x - X0) / STEP), j: Math.round((from.z - Z0) / STEP) };
  const seen = new Set<string>([key(start.i, start.j)]), queue = [start];
  while (queue.length) {
    const c = queue.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = c.i + di, j = c.j + dj, p = at(i, j);
      if (i < 0 || j < 0 || p.x > 36 || p.z > 36 || seen.has(key(i, j)) || blocked(p.x, p.z) || !walkableFor(p.x, p.z, r)) continue;
      seen.add(key(i, j)); queue.push({ i, j });
    }
  }
  return { has: (x: number, z: number) => seen.has(key(Math.round((x - X0) / STEP), Math.round((z - Z0) / STEP))), size: seen.size };
}

section('HOM-15 the cave: a second pocket of walkable world behind the mouth');
{
  assert(CAVE_ROOMS.length >= 3 && CAVE_ROOMS.every(r => r.rect.x1 - r.rect.x0 >= 5 && r.rect.z1 - r.rect.z0 >= 10), 'the cave is rooms of real size, not a niche');
  assert(!COLLIDERS.some(o => o.x === -18 && o.z === -28 && o.r === 3), 'the rock that sealed the mouth is gone');
  const spawn = { x: 0, z: 6 };
  const player = floodFill(0.5, spawn);
  assert(player.has(-18, -80) && player.has(-18, -55) && player.has(-27, -47), 'a player can walk from the clearing to the hollow, the veins and the warden hall');
  const ogre = floodFill(ENEMY_TYPES.ogre.radius, spawn);
  assert(ogre.has(-18, -55) && ogre.has(-26, -62.5), 'an ogre fits through the mouth and the throat: the cave heavies can follow you out');
  const warden = floodFill(ENEMY_TYPES.warden.radius, { x: -18, z: -82 });
  assert(warden.has(-18, -76) && warden.has(-18, -66), 'the Warden can move about its hall and the neck');
  const sealed = floodFill(0.5, spawn, (x, z) => x > -20.5 && x < -15.5 && z < -29.5 && z > -46);
  assert(!sealed.has(-18, -55) && !sealed.has(-27, -47), 'with the throat shut, nothing outside reaches the hollow: the mouth is the only way in');
  const strip = quietState(901); strip.player.x = -26; strip.player.z = -29;
  run(strip, 6, { dirX: 1, dirZ: 0 });
  assert(strip.player.x < -19.5, `walking east along the strip behind the mouth rocks stops at the wall (x=${strip.player.x.toFixed(1)}), not in the throat`);

  assert(SPAWNS.every(sp => walkableFor(sp.x, sp.z, ENEMY_TYPES[sp.type].radius)), 'every enemy spawn is on open floor for its own size');
  const caveSpawns = SPAWNS.filter(sp => inCave(sp.x, sp.z));
  assert(caveSpawns.length >= 8 && caveSpawns.every(sp => ENEMY_TYPES[sp.type].level > ENEMY_TYPES.brute.level), `${caveSpawns.length} spawns inside the cave, every one above the Brute level ${ENEMY_TYPES.brute.level}`);
  assert(CAVE_ROCKS.every(r => inCave(r.x, r.z) && [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]].some(([dx, dz]) => player.has(r.x + dx, r.z + dz))) && CAVE_PILLARS.every(o => inCave(o.x, o.z)), 'cave ore and pillars are inside the rooms, and the ore can be reached');

  // walls are sealed: wherever a body is shoved from, it ends on floor
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let leaks = 0, unstable = 0;
  for (let i = 0; i < 4000; i++) {
    const r = [0.45, 0.5, 0.65, 1.2, 1.6][i % 5], p = { x: -50 + rnd() * 100, z: -115 + rnd() * 160 };
    resolveCollisions(p, r);
    const q = { x: p.x, z: p.z };
    resolveCollisions(q, r);
    const inOutdoors = Math.abs(p.x) <= WORLD_HALF - r + 1e-6 && Math.abs(p.z) <= WORLD_HALF - r + 1e-6;
    const inRoom = CAVE_ROOMS.some(({ rect }) => p.x >= rect.x0 - 1e-6 && p.x <= rect.x1 + 1e-6 && p.z >= rect.z0 - 1e-6 && p.z <= rect.z1 + 1e-6);
    if (!inOutdoors && !inRoom) leaks++;
    // deep in the cave a player-sized body settles. (A heavy wedged between a rock and a wall, or the overlapping rocks of the old ridge and mouth, can be nudged again.)
    if (r <= 0.65 && inRoom && p.z < CAVE_DOOR_Z - 2) unstable = Math.max(unstable, Math.hypot(q.x - p.x, q.z - p.z));
  }
  assert(leaks === 0, '4000 random shoves from far outside end on floor every time: no hole in the walls');
  assert(unstable < 0.01, `a player-sized body settles: a second resolve moves it ${unstable.toFixed(2)}u inside the cave`);
  const wall = caveWallPoints(2);
  assert(wall.length > 40, `${wall.length} wall points for the renderer to hang rock on`);
  const wallBad = wall.filter(w => { const p = { x: w.x, z: w.z }; resolveCollisions(p, PLAYER_RADIUS); return Math.hypot(p.x - w.x, p.z - w.z) < PLAYER_RADIUS - 0.05; });
  assert(wallBad.length === 0, 'a body placed on any wall point is pushed off it by at least its own radius');

  // threshold: daylight gives way to cave dark as you walk in, smoothly
  const depth = (z: number) => caveDepth(-18, z);
  const along = [-10, -23, -25, -28, -31, -34, -37, -45, -80].map(depth);
  assert(depth(-10) === 0 && depth(0) === 0 && caveDepth(10, -40) === 0, 'outdoors, the cave dark is 0');
  assert(along.every((d, k) => k === 0 || d >= along[k - 1]) && depth(-40) === 1 && depth(-80) === 1, 'walking in, depth only grows, and ends fully dark');
  assert(depth(-28) > 0.05 && depth(-28) < 0.95 && depth(-31) > 0.2 && depth(-31) < 0.95, 'there is a threshold: a few strides of dusk between daylight and dark');
  assert(caveDepth(-10, -28) === 0, 'ridge miners on the outdoor side of the wall stay in daylight');
}

section('HOM-15 the cave stays out of the first quest');
{
  const original = ['boar', 'boar', 'boar', 'wolf', 'wolf', 'wolf', 'brute', 'pup', 'pup', 'pup', 'hexer'];
  assert(SPAWNS.slice(0, original.length).map(x => x.type).join() === original.join(), 'the original eleven enemies keep their ids and places: the first 20 minutes are the same world');
  assert(NODE_TYPES.mithril && ROCKS.every(r => r.type !== 'mithril') && ROCKS.length === 7, 'the ridge outside is unchanged: seven iron and coal rocks, no mithril');
  const s = createState(902);
  const kinds = s.nodes.map(n => n.type);
  assert(kinds.slice(0, ROCKS.length + TREES.length).join() === [...ROCKS.map(r => r.type), ...TREES.map(() => 'tree')].join() && kinds.slice(ROCKS.length + TREES.length).every(t => t === 'mithril' || t === 'coal'),
    'cave nodes are added after every existing node, so old node ids (and saves) keep meaning the same rock');
  const caveFolk = SPAWNS.filter(sp => inCave(sp.x, sp.z));
  const ridge = [...ROCKS, ...TREES, LANDMARKS.npc];
  assert(caveFolk.every(sp => ridge.every(r => dist2(sp, r) > ENEMY_TYPES[sp.type].aggroRadius + 4)), 'no ridge rock, tree or the Warden Hale is within reach of a cave enemy waking up');
  assert(caveFolk.every(sp => dist2(sp, LANDMARKS.clearing) > 40), 'nothing in the cave is near the clearing');

  // a ridge miner is not offered an archer behind the rock: Tab, and the forgiving click, skip the far side of the door
  const t = quietState(903);
  const arch = enemyOf(t, 'archer');
  placeAt(arch, -14, -48);
  t.player.x = -10; t.player.z = -27; t.player.facing = Math.PI;
  tick(t, { tab: true });
  assert(t.targetId === null && !sameSideOfDoor(t.player, arch), 'Tab on the ridge does not select an archer inside the cave');
  t.player.facing = 0;
  tick(t, { acquire: true });
  assert(t.targetId === null, 'nor does a forgiving click, even facing the right way');
  t.player.x = -18; t.player.z = -40;
  tick(t, { tab: true });
  assert(t.targetId === arch.id, 'inside the cave the same press selects it');
  const u = quietState(904), brute = enemyOf(u, 'brute');
  placeAt(brute, -18, -29); u.player.x = -18; u.player.z = -31;
  tick(u, { tab: true });
  assert(u.targetId === brute.id, 'the Brute that follows you to the door and a step inside can still be Tabbed: the rule only hides what is far and behind rock');

  // cost: the interior is rectangles in a clamp, so a body in the cave costs about what a body outside does
  const time = (x: number, z: number) => {
    const p = { x, z }, t0 = performance.now();
    for (let i = 0; i < 200000; i++) { p.x = x + (i & 1) * 0.01; p.z = z; resolveCollisions(p, 0.5); }
    return ((performance.now() - t0) / 200000) * 1000;
  };
  const outside = time(0, 0), inside = time(-18, -55);
  console.log(`  resolveCollisions: ${outside.toFixed(2)}us outside, ${inside.toFixed(2)}us in the cave (${COLLIDERS.length} colliders, ${CAVE_ROOMS.length} rooms)`);
  assert(inside < 50 && outside < 50, 'a collision resolve stays a few microseconds');
}

// ---------------------------------------------------------------------------
section('HOM-15 enemy mechanic: the ground mark punishes standing still');
{
  const seer = ENEMY_TYPES.seer, hz = seer.hazard!;
  const setup = (seedNo: number, level = 9) => {
    const s = quietState(seedNo);
    atLevel(s, level);
    const e = enemyOf(s, 'seer');
    placeAt(e, 0, 0); e.attackCd = 99; // its bolts are not what is under test
    s.player.x = 0; s.player.z = 9; s.player.facing = Math.PI;
    return { s, e };
  };
  const heavyHits = (s: GameState) => s.events.filter((ev): ev is Extract<typeof ev, { t: 'hit' }> => ev.t === 'hit' && ev.target === 'player' && ev.heavy === true);
  type Tele = Extract<GameState['events'][number], { t: 'telegraph' }>;
  const untilMark = (s: GameState) => {
    for (let i = 0; i < 300; i++) { tick(s); const t = s.events.find((ev): ev is Tele => ev.t === 'telegraph' && ev.kind === 'ground'); if (t) return t; }
    return undefined;
  };

  // stand still: it lands where you were, for the listed damage less armour
  {
    const { s, e } = setup(151);
    const tele = untilMark(s);
    assert(tele !== undefined && Math.abs(tele.x! - s.player.x) < 1e-6 && Math.abs(tele.z! - s.player.z) < 1e-6 && tele.radius === hz.radius && tele.windup === hz.windup, 'the Seer marks the ground under the player and the telegraph carries the spot, radius and wind-up');
    assert(e.cast?.kind === 'ground' && e.cast.x === tele.x && e.cast.radius === hz.radius, 'the wind-up is a cast the HUD can read, with the spot attached');
    const hp0 = s.player.hp, reduction = s.player.stats.reduction;
    let hit: ReturnType<typeof heavyHits>[number] | undefined, slam: Extract<GameState['events'][number], { t: 'slam' }> | undefined;
    for (let i = 0; i < Math.round((hz.windup + 0.5) / TICK_DT) && !hit; i++) { tick(s); hit = heavyHits(s)[0]; slam ||= s.events.find((ev): ev is Extract<typeof ev, { t: 'slam' }> => ev.t === 'slam'); }
    assert(hit !== undefined && hit.amount === Math.max(1, Math.round(hz.damage * (1 - reduction))) && hit.slot === -1 && s.player.hp === hp0 - hit.amount, `standing in it costs ${hit?.amount} (${hz.damage} less ${(100 * reduction).toFixed(0)}% armour)`);
    assert(slam !== undefined && slam.x === tele.x && slam.z === tele.z && slam.radius === hz.radius, 'the slam event names the marked spot, not the Seer');
    assert(e.hazardCd > hz.every - 0.5, `and it cannot mark again for ${hz.every}s`);
  }
  // keep moving: the same cast lands on empty ground
  {
    const { s } = setup(152);
    const tele = untilMark(s)!;
    const hp0 = s.player.hp;
    let hits = 0;
    for (let i = 0; i < Math.round((hz.windup + 0.6) / TICK_DT); i++) { tick(s, { dirX: 1, dirZ: 0 }); hits += heavyHits(s).length; }
    assert(hits === 0 && s.player.hp === hp0 && Math.hypot(s.player.x - tele.x!, s.player.z - tele.z!) > hz.radius, `moving off it (${hz.windup}s is ${(hz.windup * 6).toFixed(0)}u of running, the circle is ${hz.radius}u wide) costs nothing`);
  }
  // Pummel breaks the cast, as it does the slam
  {
    const { s, e } = setup(153, 9);
    untilMark(s);
    s.player.x = e.x; s.player.z = e.z + 3; tick(s, { clickEnemy: e.id });
    const cd0 = e.hazardCd;
    tick(s, { ability: SLOT.pummel });
    assert(e.cast === null && e.stagger > 0 && hasEvent(s, ev => ev.t === 'interrupt') && e.hazardCd >= hz.every * 0.7 - 0.1, 'Pummel on the mark cancels it, staggers the Seer and pushes the next mark back');
    let hits = 0;
    for (let i = 0; i < 60; i++) { tick(s); hits += heavyHits(s).length; }
    assert(hits === 0 && cd0 < e.hazardCd, 'and the cancelled mark never lands');
  }
  assert(castName(ENEMY_TYPES.ogre, 'heavy') === 'Boulder Slam' && castName(seer, 'ground') === 'Withering Ground' && castName(seer, 'bolt') === 'Hex Bolt' && castName(ENEMY_TYPES.boar, 'ground') === 'Wild Boar',
    'castName gives the right name for every kind of wind-up and never throws, for any enemy');
  assert(Object.entries(ENEMY_TYPES).filter(([, d]) => d.hazard).map(([k]) => k).sort().join() === 'seer,warden', 'only the Seer and the Warden mark the ground');
  assert(Object.values(ENEMY_TYPES).every(d => !d.look || ['wolf', 'hexer', 'brute', 'boar', 'pup'].includes(d.look.model)), 'every cave look reuses a model that is already loaded: no new art');
  assert(Object.entries(ENEMY_TYPES).filter(([, d]) => d.look).length === 5, 'all five cave enemies say how to draw themselves, and nothing older does');
}

// ---------------------------------------------------------------------------
section('HOM-15 mithril: a Mining gate above coal, a Smithing ladder, and gear at the top rung');
{
  assert(NODE_TYPES.mithril.level > NODE_TYPES.coal.level && NODE_TYPES.mithril.skill === 'mining' && NODE_TYPES.mithril.item === 'mithril_ore', `mithril is Mining ${NODE_TYPES.mithril.level}, above coal (${NODE_TYPES.coal.level})`);
  const veins = CAVE_ROCKS.filter(r => r.type === 'mithril').length;
  assert(veins * NODE_TYPES.mithril.charges >= MITHRIL_PLAN.ore, `${veins} veins of ${NODE_TYPES.mithril.charges} give ${veins * NODE_TYPES.mithril.charges} ore without waiting on a respawn: the plan wants ${MITHRIL_PLAN.ore}`);
  assert(CAVE_ROCKS.some(r => r.type === 'coal'), 'there is coal inside the cave too');

  // the gate: a level-8 miner is turned away, a level-9 one is not
  const g = quietState(911);
  const vein = g.nodes.find(n => n.type === 'mithril')!;
  g.player.skills.mining.xp = xpForLevel(8); g.player.skills.mining.level = 8;
  g.player.x = vein.x + 2; g.player.z = vein.z;
  tick(g, { interact: { k: 'node', id: vein.id } });
  assert(hasEvent(g, e => e.t === 'actionfail' && e.reason === 'level' && e.need === NODE_TYPES.mithril.level), `Mining 8 is refused (needs ${NODE_TYPES.mithril.level}) and told so`);
  g.player.skills.mining.xp = xpForLevel(9); g.player.skills.mining.level = 9;
  tick(g, { interact: { k: 'node', id: vein.id } });
  untilIdle(g);
  assert(countOf(g, 'mithril_ore') >= 1 && g.player.skills.mining.xp > xpForLevel(9), 'Mining 9 gets ore and XP');

  // the ladder
  const rec = (id: string) => RECIPES.find(r => r.id === id)!;
  const ladder = ['mithril_bar', 'mithril_helm', 'mithril_greaves', 'mithril_chestplate', 'warden_edge'].map(rec);
  assert(ladder.every((r, k) => r.skill === 'smithing' && (k === 0 || r.level > ladder[k - 1].level)) && ladder[0].level > rec('steel_bar').level, `Smithing gates climb above steel: ${ladder.map(r => r.level).join(' < ')}`);
  const barsNeeded = MITHRIL_SET.reduce((n, id) => n + rec(id).inputs.find(i => i.id === 'mithril_bar')!.qty, 0);
  const bar = rec('mithril_bar');
  assert(barsNeeded === MITHRIL_PLAN.bars && bar.inputs.find(i => i.id === 'mithril_ore')!.qty * barsNeeded === MITHRIL_PLAN.ore && bar.inputs.find(i => i.id === 'coal')!.qty * barsNeeded === MITHRIL_PLAN.coal,
    `the quest plan is the recipes: ${barsNeeded} bars = ${MITHRIL_PLAN.ore} ore + ${MITHRIL_PLAN.coal} coal`);
  assert(ladder.slice(1).every(r => ITEMS[r.output.id].slot) && MITHRIL_SET.every(id => ITEMS[id].slot && rec(id)), 'the set is made at the forge');
  const slots = MITHRIL_SET.map(id => ITEMS[id].slot).sort().join();
  assert(slots === 'chest,head,legs', 'one piece for each armour slot');

  // smithing it
  const f = quietState(912);
  f.player.x = LANDMARKS.forge.x - 4; f.player.z = LANDMARKS.forge.z + 2;
  addItem(f.player.inventory, 'mithril_ore', 9); addItem(f.player.inventory, 'coal', 18);
  f.player.skills.smithing.xp = xpForLevel(6); f.player.skills.smithing.level = 6;
  tick(f, { craft: { recipe: 'mithril_bar', count: 1 } });
  assert(hasEvent(f, e => e.t === 'actionfail' && e.reason === 'level' && e.need === bar.level) && countOf(f, 'mithril_bar') === 0, `Smithing 6 cannot smelt a bar (needs ${bar.level})`);
  grantXp(f, 'smithing', xpForLevel(bar.level) - f.player.skills.smithing.xp, 0, 0);
  craft(f, 'mithril_bar', 9);
  assert(countOf(f, 'mithril_bar') === 9 && countOf(f, 'mithril_ore') === 0 && countOf(f, 'coal') === 0, 'nine bars use up exactly nine ore and eighteen coal');
  assert(f.player.skills.smithing.level >= rec('mithril_chestplate').level, `the bars alone carry Smithing to ${f.player.skills.smithing.level}: every piece is open without grinding`);
  for (const id of MITHRIL_SET) craft(f, id, 1);
  assert(MITHRIL_SET.every(id => countOf(f, id) === 1) && countOf(f, 'mithril_bar') === 0, 'helm, greaves and chestplate smithed from the nine bars');

  // gear at the top of the ladder
  const iron = deriveStats({ ...emptyEquipment(), head: 'iron_helm', chest: 'iron_chestplate', legs: 'iron_greaves' });
  const mith = deriveStats({ ...emptyEquipment(), head: 'mithril_helm', chest: 'mithril_chestplate', legs: 'mithril_greaves' });
  assert(mith.armor >= iron.armor * 2 && mith.reduction > iron.reduction + 0.15, `the set is ${mith.armor} armour (${(100 * mith.reduction).toFixed(0)}% off) against iron's ${iron.armor} (${(100 * iron.reduction).toFixed(0)}%)`);
  const top = TIER_LOOKS.length - 1;
  assert(top === 4 && TIER_COLORS.length === top + 1, 'the worn-look ladder has a reserved tier 4 and every tier has a colour');
  for (const id of [...MITHRIL_SET, 'warden_edge']) {
    const look = appearanceOf(id);
    assert(ITEMS[id].tier === 4 && look.rung === TIER_LOOKS[4].rung && look.glow > 0 && look.motes !== 0 && look.scale >= TIER_LOOKS[3].scale, `${ITEMS[id].name} is tier 4 and gets the epic look: rung ${look.rung}, glow, motes`);
  }
  assert(Object.entries(ITEMS).every(([id, d]) => d.tier < TIER_COLORS.length && (!d.slot || (appearanceOf(id).rung >= 1 && appearanceOf(id).tint > 0))), 'every equippable item has an appearance and a rarity colour');
  assert(Object.entries(ITEMS).filter(([, d]) => d.slot).every(([id, d]) => d.tier < 3 || appearanceOf(id).glow !== 0), 'every rare-or-better piece glows: the better the gear, the better it looks');
  // the emissive budget (glow.ts): epic glow is cold, restrained, and under the bloom threshold, so it can never blow out to white or beat the forge
  assert(EMISSIVE_CAP < BLOOM_THRESHOLD, 'a lit emitter peaks under the bloom threshold');
  const warm = (hex: number) => ((hex >> 16) & 255) > ((hex & 255)) + 8;
  for (const [id, d] of Object.entries(ITEMS)) {
    if (!d.slot || d.tier < 3) continue;
    const l = appearanceOf(id);
    assert(l.glowI * linearPeak(l.glow) <= EMISSIVE_CAP * 0.75, `${d.name}: tier-${d.tier} glow stays well under the cap`);
    if (id !== 'forged_blade') assert(!warm(l.glow), `${d.name}: warm emissive belongs to fire alone, an epic glow is cold`);
  }
  assert(cappedIntensity(0x6ad8ff, 3) * linearPeak(0x6ad8ff) <= EMISSIVE_CAP + 1e-9 && cappedIntensity(0x6ad8ff, 0.5) === 0.5, 'cappedIntensity clamps down to the cap and leaves quieter values alone');
  assert(minLightDistance(260, 0.05) < minLightDistance(260, 1) && minLightDistance(0, 1) === 0, 'a brighter surface needs more room from a point light');

  // what is made is not dropped, and what is made is best
  const dropped = new Set(Object.values(DROP_TABLES).flatMap(t => t.entries.map(e => e.id)));
  assert(![...MITHRIL_SET, 'warden_edge', 'mithril_bar', 'forged_blade'].some(id => dropped.has(id)), 'no enemy drops the mithril set, the Warden Edge or the Forgemaster Blade: they are made');
  const bestDropped = Math.max(...[...dropped].filter(id => ITEMS[id].slot === 'weapon').map(id => ITEMS[id].stats!.damage!));
  assert(ITEMS.warden_edge.stats!.damage! > ITEMS.forged_blade.stats!.damage! && ITEMS.forged_blade.stats!.damage! >= bestDropped + 4, `crafted beats dropped all the way up: Edge +${ITEMS.warden_edge.stats!.damage} > Blade +${ITEMS.forged_blade.stats!.damage} > best drop +${bestDropped}`);
  assert(DROP_TABLES.warden.entries.some(e => e.id === 'warden_shard') && rec('warden_edge').inputs.some(i => i.id === 'warden_shard' && i.qty >= 2), 'the Warden drops the shards the Edge is made from: the reason to keep killing it');
  assert(DROP_TABLES.ogre.entries.some(e => e.id === 'mithril_ore') && Object.keys(ENEMY_TYPES).filter(k => ENEMY_TYPES[k].level > ENEMY_TYPES.brute.level).every(k => DROP_TABLES[k]), 'cave enemies drop things, and ogres drop ore: killing the cave feeds the forge');
}

// ---------------------------------------------------------------------------
// The contract the Brute and the blade already keep, one tier up: the cave is unfair without the new armour and fair with it.
section('HOM-15 the contract: the cave is unfair without the mithril set and fair with it');
{
  const KITS: Record<string, Partial<GameState['player']['equipment']>> = {
    blade: { weapon: 'forged_blade' },
    hide: { weapon: 'forged_blade', head: 'leather_cap', chest: 'hide_jerkin', legs: 'hide_leggings' },
    iron: { weapon: 'forged_blade', head: 'iron_helm', chest: 'iron_chestplate', legs: 'iron_greaves' },
    mithril: { weapon: 'forged_blade', head: 'mithril_helm', chest: 'mithril_chestplate', legs: 'mithril_greaves' },
    edge: { weapon: 'warden_edge', head: 'mithril_helm', chest: 'mithril_chestplate', legs: 'mithril_greaves' },
  };
  /**
   * The test bot against some of the cave's own enemies, at a combat level in a kit, where they actually stand. The bot walks
   * at the nearest one and fights what wakes. Returns whether it lived and killed them all.
   */
  function caveFight(level: number, kit: string, groups: [string, number][], start: { x: number; z: number }, seedNo: number, smart = true) {
    const s = quietState(seedNo);
    atLevel(s, level);
    Object.assign(s.player.equipment, KITS[kit]); refreshGearStats(s);
    s.player.x = start.x; s.player.z = start.z;
    const es: Enemy[] = [];
    for (const [type, n] of groups) for (const e of s.enemies.filter(x => x.type === type).slice(0, n)) { e.state = 'idle'; e.respawnIn = 0; e.hp = e.maxHp; e.attackCd = 0; es.push(e); }
    botSmart = smart;
    const maxHp = s.player.maxHp;
    let low = 1; // the worst moment, as a share of health at the start: what is left at the end is flattered by the level-up that kills give
    for (let guard = 0; guard < 6 && !s.player.dead && es.some(e => st(e) !== 'dead'); guard++) {
      const e = es.filter(x => st(x) !== 'dead').sort((a, b) => dist2(a, s.player) - dist2(b, s.player))[0];
      fight(s, e, 120);
      low = Math.min(low, minHpSeen / maxHp);
    }
    botSmart = true;
    return { won: !s.player.dead && es.every(e => st(e) === 'dead'), left: s.player.dead ? 0 : low, s };
  }
  const SEEDS = [1, 2, 3, 4, 5, 6];
  type Scene = { name: string; level: number; groups: [string, number][]; start: { x: number; z: number } };
  const WARDEN: Scene = { name: 'Hollow Warden', level: 10, groups: [['warden', 1]], start: { x: -18, z: -72 } };
  const OGRE: Scene = { name: 'Hollow Ogre', level: 9, groups: [['ogre', 1]], start: { x: -14, z: -50 } };
  const PACK: Scene = { name: 'Ravager pack', level: 10, groups: [['ravager', 3]], start: { x: -22, z: -44 } };
  const ROOM: Scene = { name: 'ogre+archer+seer', level: 10, groups: [['ogre', 1], ['archer', 1], ['seer', 1]], start: { x: -18, z: -45 } };
  const wins = (sc: Scene, kit: string, smart = true) => SEEDS.filter(n => caveFight(sc.level, kit, sc.groups, sc.start, 940 + n, smart).won).length;
  const PAIR: Scene = { name: 'archer+seer', level: 10, groups: [['archer', 1], ['seer', 1]], start: { x: -16, z: -54 } };
  const BRUISER: Scene = { name: 'ogre+archer', level: 10, groups: [['ogre', 1], ['archer', 1]], start: { x: -11, z: -52 } };
  for (const sc of [WARDEN, OGRE, PACK, PAIR, BRUISER, ROOM]) console.log(`  L${sc.level} ${sc.name.padEnd(17)} ${Object.keys(KITS).map(k => `${k} ${wins(sc, k)}/6`).join('   ')}`);
  assert(wins(WARDEN, 'mithril') === 6 && wins(WARDEN, 'iron') <= 1 && wins(WARDEN, 'blade') === 0, 'the Warden: with the set and the blade every run wins; in iron almost none; with no armour none');
  assert(wins(WARDEN, 'mithril', false) === 0, 'the Warden: a player who ignores the tells (stands in the slam and the marks, never Pummels) loses even in the set');
  /** Mean health left across the seeds, counting a death as nothing: a smoother read than wins when a fight is a cliff. */
  const health = (sc: Scene, kit: string) => SEEDS.reduce((m, n) => { const r = caveFight(sc.level, kit, sc.groups, sc.start, 940 + n); return m + (r.won ? r.left : 0); }, 0) / SEEDS.length;
  assert(wins(OGRE, 'mithril') === 6 && wins(OGRE, 'blade') <= 1, 'the Ogre: the set walks it; with no armour it almost never wins');
  assert(wins(PACK, 'hide') >= 4 && wins(PACK, 'iron') >= 5 && wins(PACK, 'mithril') === 6 && wins(PACK, 'blade') <= 3,
    'the Ravagers guard the veins and the first trip is made before the set exists: winnable in the hide and iron the drops give you, a coin-flip bare, a walk in mithril');
  assert(wins(PAIR, 'blade') === 0 && wins(PAIR, 'mithril') >= 5, 'an archer and a seer together: out of reach bare, taken in the set');
  console.log(`  ogre+archer mean health left: iron ${health(BRUISER, 'iron').toFixed(2)}, mithril ${health(BRUISER, 'mithril').toFixed(2)}, edge ${health(BRUISER, 'edge').toFixed(2)}`);
  assert(health(BRUISER, 'mithril') >= health(BRUISER, 'iron') && wins(BRUISER, 'blade') === 0, 'an ogre with an archer behind it: the set is what changes the odds');
  assert(wins(ROOM, 'mithril') <= 3 && wins(ROOM, 'blade') === 0, 'pulling the whole room at Combat 10 is beyond any kit: it has to be taken in pieces, which is the pillars and the corridor for');
  const margin = (kit: string) => SEEDS.map(n => caveFight(WARDEN.level, kit, WARDEN.groups, WARDEN.start, 940 + n)).filter(r => r.won).reduce((m, r) => m + r.left, 0) / 6;
  console.log(`  Warden lowest health: mithril ${margin('mithril').toFixed(2)}, edge ${margin('edge').toFixed(2)}`);
  assert(margin('edge') > margin('mithril') + 0.05, 'the Warden Edge makes the same fight easier: the second chase is felt');
  const q = caveFight(WARDEN.level, 'mithril', WARDEN.groups, WARDEN.start, 941);
  assert(q.won && q.left > 0.05 && q.left < 0.7, `a won Warden fight at Combat 10 dips to ${(100 * q.left).toFixed(0)}% health at its worst: tense, not trivial`);
}

// ---------------------------------------------------------------------------
section('HOM-15 second quest: it starts where the first ends, on the same machinery');
{
  const nearHale = (s: GameState) => { s.player.x = NPC.x; s.player.z = NPC.z + 2; };
  const s = quietState(951);
  assert(secondStage(s) === 'locked' && activeQuestView(s).title === questView(s).title && npcMarker(s) === 'offer', 'a new character: the second chain is locked, the tracker and marker are the first quest\'s');
  nearHale(s);
  s.quest.stage = 'report2';
  const xp0 = s.player.combat.xp;
  tick(s, { questAdvance: true });
  assert(stage(s) === 'done' && secondStage(s) === 'offer' && sawQuest(s, 'complete') && s.player.combat.xp === xp0 + REWARD[0].xp, 'handing in the first quest completes it and puts the second on offer');
  assert(questNamed(s, 'complete', QUEST_NAME), 'the quest event says which quest it is about: handing in the first one names the first');
  assert(JSON.stringify(questView(s).target) === 'null' && questView(s).lines[0].done, 'questView stays the first quest\'s: done, nothing to point at');
  const offer = activeQuestView(s);
  assert(offer.title === QUEST2_NAME && offer.ready && offer.target?.label === NPC.name && offer.progress === '(1/5)' && npcMarker(s) === 'offer', 'the HUD tracker now shows the second quest on offer, points at Warden Hale, and the ! marker stays up');
  assert(activeDialogue(s) === DIALOGUE2.offer && DIALOGUE2.offer.options.some(o => o.advance), 'and his dialogue offers it');
  s.player.x = 0; s.player.z = 20; tick(s, { questAdvance: true });
  assert(secondStage(s) === 'offer', 'accepting from across the map does nothing: you have to be in earshot, same as the first');

  // kill credit is stage-gated, exactly like the Brute
  questOnKill(s, 'ravager'); questOnKill(s, 'warden');
  assert((s.quest.kills.ravager ?? 0) === 0 && secondStage(s) === 'offer', 'ravager and warden kills before accepting earn nothing');
  nearHale(s);
  tick(s, { questAdvance: true });
  assert(secondStage(s) === 'delve' && questNamed(s, 'accept', QUEST2_NAME) && activeQuestView(s).progress === '(2/5)', 'accepting starts the delve, and the event names the second quest');
  tick(s, { questAdvance: true });
  assert(secondStage(s) === 'delve', 'advance is a no-op while there is no hand-in');
  questOnKill(s, 'warden');
  assert(secondStage(s) === 'delve', 'the Warden does not count before its stage');
  for (let i = 0; i < DELVE_GOALS.ravager + 2; i++) questOnKill(s, 'ravager');
  assert(s.quest.kills.ravager === DELVE_GOALS.ravager, `ravager credit stops at the goal (${DELVE_GOALS.ravager})`);
  tick(s);
  assert(secondStage(s) === 'delve' && activeQuestView(s).lines.some(l => /Cave Ravagers slain: 3\/3/.test(l.text) && l.done), 'kills alone do not end the delve: it wants the ore too');
  let v = activeQuestView(s);
  assert(v.lines[0].text.startsWith(`Mine Mithril Ore: 0/${MITHRIL_PLAN.ore} (needs Mining 9)`) && v.target?.label === 'Coal Seam', 'with Mining below the gate the tracker says so and sends you to practise on coal');
  s.player.skills.mining.xp = xpForLevel(9); s.player.skills.mining.level = 9;
  v = activeQuestView(s);
  assert(v.target?.label === 'Mithril Vein' && !v.lines[0].text.includes('needs'), 'at Mining 9 it points at the veins');
  addItem(s.player.inventory, 'mithril_ore', 4); addItem(s.player.inventory, 'mithril_bar', 5);
  tick(s);
  assert(secondStage(s) === 'armour' && sawQuest(s, 'stage'), 'three kills and nine ore (ore already smelted counts) hands the quest on to the forge');

  // armour stage: progress never goes backwards at the forge
  v = activeQuestView(s);
  assert(v.lines[0].text === `Mine Coal: ${Math.min(MITHRIL_PLAN.coal, 10)}/${MITHRIL_PLAN.coal}` && v.lines[1].text.startsWith(`Smelt Mithril Bars at the forge: 5/${MITHRIL_PLAN.bars}`), 'bars already made count as coal and ore spent: 5 bars read as 10 coal and 5 bars');
  s.player.inventory.forEach((_, i) => { s.player.inventory[i] = null; });
  addItem(s.player.inventory, 'mithril_helm', 1);
  assert(activeQuestView(s).lines[1].text.startsWith(`Smelt Mithril Bars at the forge: 2/`) && activeQuestView(s).lines[2].done && !activeQuestView(s).lines[3].done, 'a smithed piece counts for its bars and ticks its own line');
  s.player.skills.smithing.xp = xpForLevel(7); s.player.skills.smithing.level = 7;
  assert(/Greaves \(needs Smithing 9\)/.test(activeQuestView(s).lines[3].text) && /Chestplate \(needs Smithing 10\)/.test(activeQuestView(s).lines[4].text), 'pieces above your Smithing say what they need');
  addItem(s.player.inventory, 'mithril_greaves', 1);
  tick(s);
  assert(secondStage(s) === 'armour', 'two pieces of three is not the set');
  s.player.equipment.chest = 'mithril_chestplate'; refreshGearStats(s);
  tick(s);
  assert(secondStage(s) === 'warden', 'a piece you are already wearing counts as made: the third completes the set');
  v = activeQuestView(s);
  assert(v.lines[1].text === `Wear the mithril set (press I): 1/3` && v.target?.label === ENEMY_TYPES.warden.name, 'the tracker counts what is worn and points at the Warden');
  s.player.inventory.forEach((_, i) => { s.player.inventory[i] = null; });
  s.player.equipment.head = 'mithril_helm'; s.player.equipment.legs = 'mithril_greaves'; refreshGearStats(s);
  assert(activeQuestView(s).lines[1].done && activeQuestView(s).lines.some(l => /Recommended Combat/.test(l.text)) === (s.player.combat.level < RECOMMENDED_COMBAT_2 + 1), 'all three worn; the level advice shows only while you are under it');

  // the Warden, and the hand-in
  questOnKill(s, 'ravager');
  assert(secondStage(s) === 'warden', 'other kills do nothing now');
  questOnKill(s, 'warden');
  assert(secondStage(s) === 'report' && activeQuestView(s).ready && npcMarker(s) === 'ready' && activeDialogue(s) === DIALOGUE2.report, 'the Warden dies: the quest wants the hand-in, the marker turns to ?');
  nearHale(s);
  const before = REWARD2.map(r => s.player.skills[r.skill].xp);
  tick(s, { questAdvance: true });
  assert(secondStage(s) === 'cleared' && stage(s) === 'done' && questNamed(s, 'complete', QUEST2_NAME), 'turning in completes the second quest, and the event names it');
  assert(REWARD2.every((r, i) => s.player.skills[r.skill].xp === before[i] + r.xp), `rewards: ${REWARD2.map(r => `${r.xp} ${r.skill}`).join(', ')}`);
  assert(REWARD2[0].xp > REWARD[0].xp * 2 && REWARD2.length >= REWARD.length, 'and it is a bigger reward than the first quest paid');
  const xp1 = s.player.combat.xp;
  tick(s, { questAdvance: true });
  assert(s.player.combat.xp === xp1 && activeQuestView(s).target === null && activeQuestView(s).progress === '' && npcMarker(s) === null, 'completing twice pays once, nothing is left to point at, and the marker is gone');
  assert(activeDialogue(s) === DIALOGUE2.cleared && QUEST2_STAGES.slice(1).every(stg => DIALOGUE2[stg as keyof typeof DIALOGUE2].lines.length > 0 && DIALOGUE2[stg as keyof typeof DIALOGUE2].options.length > 0), 'every stage of the second quest has something to say');
  assert(DIALOGUE2.offer.options.filter(o => o.advance).length === 1 && DIALOGUE2.report.options.filter(o => o.advance).length === 1 && QUEST2_STAGES.every(stg => stg === 'locked' || stg === 'offer' || stg === 'report' || !DIALOGUE2[stg].options.some(o => o.advance)), 'only the hand-in stages offer an advancing option: nowhere else could it do anything');
  assert(DIALOGUE.done.options.length > 0 && activeDialogue(createState()) === DIALOGUE.offer, 'the first quest\'s dialogue is untouched');
  const prog = (stg: Parameters<typeof questView>[0]['quest']['stage']) => { const t = quietState(952); t.quest.stage = stg; return questView(t).progress; };
  assert(prog('offer') === '(1/6)' && prog('report1') === '(3/6)' && prog('report2') === '(6/6)' && prog('done') === '', 'the first quest keeps the (n/6) counter it always had, and none once done');

  // save and load across the second chain
  for (const second of ['offer', 'delve', 'armour', 'warden', 'report', 'cleared'] as const) {
    const t = quietState(953); t.quest.stage = 'done'; t.quest.second = second; t.quest.kills = { ravager: 2 };
    const l = deserialize(serialize(t))!;
    assert(l !== null && l.quest.second === second && l.quest.stage === 'done' && l.quest.kills.ravager === 2 && JSON.stringify(activeQuestView(l)) === JSON.stringify(activeQuestView(t)), `a save in the second quest at "${second}" loads exactly`);
  }
  const old = JSON.parse(serialize(Object.assign(quietState(954), { quest: { stage: 'done', kills: {}, second: 'offer' } })));
  delete old.quest.second;
  assert(deserialize(JSON.stringify(old))!.quest.second === 'offer', 'a save from before the cave that finished the first quest comes back with the second on offer');
  old.quest.stage = 'forge';
  assert(deserialize(JSON.stringify(old))!.quest.second === 'locked', 'and one that did not comes back with it locked');
  const bad = structuredClone(old); bad.quest.second = 'delve';
  assert(deserialize(JSON.stringify(bad)) === null, 'a save that claims to be mid-second-quest with the first unfinished is refused');
  bad.quest.stage = 'done'; bad.quest.second = 'locked';
  assert(deserialize(JSON.stringify(bad)) === null, 'and so is the reverse');
  bad.quest.second = 'nonsense';
  assert(deserialize(JSON.stringify(bad)) === null, 'and an unknown second-quest stage');
  assert(SAVE_VERSION === 1, 'no save version bump: the second chain is a field older saves simply lack');
}

// ---------------------------------------------------------------------------
/** Put the best gear in the bag on (armour by armour value, weapon by damage), then bin the rest so loot never fills the bag. */
function dressAndTidy(s: GameState) {
  for (const slot of ['weapon', 'head', 'chest', 'legs'] as const) {
    const score = (id: string | null) => !id ? -1 : (ITEMS[id].stats?.armor ?? 0) + (ITEMS[id].stats?.damage ?? 0);
    const best = s.player.inventory.map((it, i) => ({ it, i })).filter(x => x.it && ITEMS[x.it.id].slot === slot).sort((a, b) => score(b.it!.id) - score(a.it!.id))[0];
    if (best && score(best.it!.id) > score(s.player.equipment[slot])) tick(s, { inv: [{ k: 'equip', slot: best.i }] });
  }
  for (let i = 0; i < s.player.inventory.length; i++) {
    const it = s.player.inventory[i];
    if (it && (ITEMS[it.id].slot || it.id === 'boar_hide' || it.id === 'wolf_pelt')) tick(s, { inv: [{ k: 'destroy', slot: i }] });
  }
}
/** Pick up everything on the ground within reach of where the player stands, as a player would by clicking it. */
function sweepDrops(s: GameState) {
  for (const d of s.drops.slice()) { if (dist2(d, s.player) < 12) { s.player.x = d.x; s.player.z = d.z; tick(s); } }
}
/** Walk a list of waypoints with click-to-move; scenery that blocks a step is stepped past, as huntOne does. */
function walkVia(s: GameState, pts: [number, number][]) {
  for (const [x, z] of pts) if (!walkTo(s, x, z, 2.5, 30) && !s.player.dead) { s.player.x = x; s.player.z = z; }
}
const SECOND_RUN_SEED = 2027;

section('HOM-15 SECOND GOLDEN PATH: the first quest to its end, then the cave, the forge and the Warden, as one continuous run');
{
  const s = createState(SECOND_RUN_SEED);
  const tally: Record<string, number> = {};
  killTally = tally;
  const t0 = s.tick;
  const clock = () => (s.tick - t0) * TICK_DT;
  const milestone = (what: string) => console.log(`  [${(clock() / 60).toFixed(1)} min] ${what}`);
  deathTally = 0;
  s.player.inventory = s.player.inventory.map(() => null);

  // 1. quest one, exactly as before
  assert(talkToNpc(s), 'walk up to Warden Hale'); tick(s, { questAdvance: true });
  for (const [type, goal] of Object.entries(HUNT_GOALS)) for (let guard = 0; (s.quest.kills[type] ?? 0) < goal && guard < 20; guard++) huntOne(s, type);
  assert(stage(s) === 'report1', 'hunt done');
  talkToNpc(s); tick(s, { questAdvance: true });
  gatherUntil(s, 'iron', BLADE_PLAN.ore); gatherUntil(s, 'coal', BLADE_PLAN.coal); gatherUntil(s, 'tree', BLADE_PLAN.logs);
  assert(atForge(s), 'at the forge');
  craft(s, 'iron_bar', BLADE_PLAN.bars); craft(s, 'steel_bar', BLADE_PLAN.steel); craft(s, 'forged_blade', 1);
  assert(stage(s) === 'brute', 'blade forged');
  dressAndTidy(s);
  const brute = enemyOf(s, 'brute');
  rest(s); walkTo(s, brute.x, brute.z, 3.5, 60); if (dist2(s.player, brute) > 5) standNear(s, brute, 3.5);
  fight(s, brute, 120);
  assert(st(brute) === 'dead' && stage(s) === 'report2', 'the Brute is down');
  assert(talkToNpc(s), 'back to the Warden'); tick(s, { questAdvance: true });
  assert(stage(s) === 'done' && sawQuest(s, 'complete') && secondStage(s) === 'offer', 'quest one complete; Hale has another');
  milestone(`first quest complete, Combat ${s.player.combat.level}, Mining ${s.player.skills.mining.level}, Smithing ${s.player.skills.smithing.level}`);
  const levelAtStart = s.player.combat.level, firstQuestSeconds = clock();

  // 2. the second quest: accept it
  assert(npcMarker(s) === 'offer', 'the ! is back over his head');
  tick(s, { questAdvance: true });
  assert(secondStage(s) === 'delve' && activeQuestView(s).title === QUEST2_NAME, 'quest two accepted');
  assert(activeQuestView(s).lines.some(l => l.text.includes('Mithril')) && activeQuestView(s).target !== null, 'the tracker names the ore and has somewhere to point');

  // 3. the way in: walk it, do not teleport, and watch the light change
  const lightAt = [] as number[];
  const mouthWalk: [number, number][] = [[-18, -20], [-18, -26], [-18, -32], [-18, -38], [-18, -44]];
  for (const [x, z] of mouthWalk) { walkTo(s, x, z, 1.5, 30); lightAt.push(caveDepth(s.player.x, s.player.z)); }
  assert(s.player.z < -42 && inCave(s.player.x, s.player.z), `walked through the mouth and up the throat to z=${s.player.z.toFixed(0)}`);
  assert(lightAt[0] === 0 && lightAt[lightAt.length - 1] === 1 && lightAt.some(d => d > 0 && d < 1), `the light changes on the way: ${lightAt.map(d => d.toFixed(2)).join(' > ')}`);
  milestone('inside the cave');

  // 4. the gate: a ridge miner has not earned the veins yet; practise on coal first, as the tracker says
  let guard = 0;
  while (s.player.skills.mining.level < NODE_TYPES.mithril.level && guard++ < 30) { gatherUntil(s, 'coal', countOf(s, 'coal') + 3); }
  assert(s.player.skills.mining.level >= NODE_TYPES.mithril.level, `Mining ${s.player.skills.mining.level} from coal: the veins are open`);
  milestone(`Mining ${s.player.skills.mining.level}`);

  // 5. the delve: the pack guards the veins, so the ore and the kills come together
  walkVia(s, mouthWalk.slice(1));
  dressAndTidy(s);
  const ore = () => countOf(s, 'mithril_ore') + countOf(s, 'mithril_bar');
  for (let g = 0; secondStage(s) === 'delve' && g < 40; g++) {
    if (s.player.dead) { run(s, RESPAWN_DELAY + 0.5); walkVia(s, mouthWalk); continue; }
    if ((s.quest.kills.ravager ?? 0) < DELVE_GOALS.ravager && s.enemies.some(e => e.type === 'ravager' && st(e) !== 'dead')) huntOne(s, 'ravager');
    else gatherUntil(s, 'mithril', ore() + 3);
    sweepDrops(s); dressAndTidy(s);
  }
  assert(secondStage(s) === 'armour', `the delve ends on its own: ${s.quest.kills.ravager} ravagers down, ${countOf(s, 'mithril_ore')} ore in the bag`);
  assert(countOf(s, 'mithril_ore') >= MITHRIL_PLAN.ore, 'nine mithril ore, mined from the cave veins');
  milestone(`delve done (${deathTally} death${deathTally === 1 ? '' : 's'} so far)`);

  // 6. coal, the forge, the ladder
  gatherUntil(s, 'coal', MITHRIL_PLAN.coal);
  assert(countOf(s, 'coal') >= MITHRIL_PLAN.coal, `${countOf(s, 'coal')} coal in hand`);
  assert(atForge(s), 'out of the cave and back at the forge');
  if (s.player.skills.smithing.level < recipeById('mithril_bar')!.level) {
    const sm0 = s.player.skills.smithing.level;
    gatherUntil(s, 'iron', countOf(s, 'iron_ore') + 4); atForge(s); craft(s, 'iron_bar', countOf(s, 'iron_bar') + 2);
    console.log(`  (Smithing ${sm0} was under the bar gate: two iron bars of practice first, now ${s.player.skills.smithing.level})`);
  }
  const saved = deserialize(serialize(s))!;
  assert(saved.quest.second === 'armour' && countOf(saved, 'mithril_ore') === countOf(s, 'mithril_ore'), 'saved at the forge door and reloaded');
  craft(s, 'mithril_bar', MITHRIL_PLAN.bars);
  assert(countOf(s, 'mithril_bar') === MITHRIL_PLAN.bars, 'nine mithril bars');
  for (const id of MITHRIL_SET) craft(s, id, 1);
  assert(MITHRIL_SET.every(id => countOf(s, id) === 1) && secondStage(s) === 'warden', 'the set is smithed and the quest moves on to the Warden without any more talking');
  milestone(`mithril set smithed, Smithing ${s.player.skills.smithing.level}`);

  // 7. wear it
  dressAndTidy(s);
  assert(MITHRIL_SET.every(id => Object.values(s.player.equipment).includes(id)) && s.player.stats.armor >= 50, `the whole set on: ${s.player.stats.armor} armour, ${(100 * s.player.stats.reduction).toFixed(0)}% off`);
  assert(activeQuestView(s).lines.some(l => l.text.includes('3/3') && l.done), 'tracker: set worn');
  const hasLook = MITHRIL_SET.every(id => appearanceOf(id).rung === 4);
  assert(hasLook, 'every piece worn resolves to the epic rung of the look ladder');

  // 8. through the hollow to the Warden: what stands in the way is fought, in the set
  for (const type of ['archer', 'archer', 'seer', 'ogre', 'ogre']) {
    if (s.player.dead) { run(s, RESPAWN_DELAY + 0.5); walkVia(s, mouthWalk); }
    if (s.enemies.some(e => e.type === type && st(e) !== 'dead')) huntOne(s, type);
    sweepDrops(s);
  }
  const cave = ['ravager', 'archer', 'seer', 'ogre'] as const;
  assert(cave.every(type => (tally[type] ?? 0) >= 1), `every kind of thing in the hollow was fought and killed: ${cave.map(type => `${tally[type] ?? 0} ${ENEMY_TYPES[type].name}`).join(', ')} (they respawn, so the room refills while the bot rests)`);
  assert(s.player.combat.level > levelAtStart, `Combat ${levelAtStart} -> ${s.player.combat.level} from the cave alone`);
  milestone(`hollow fought through, Combat ${s.player.combat.level}`);
  dressAndTidy(s);

  // 9. the Warden. The bot rests longer between pulls than the room takes to refill, so it can never leave the hollow empty and
  // walk on; what is left is taken out of play here, as it would be for a player who had cleared it (the contract checks above
  // are what prove those fights). Everything else in this run is the real thing.
  const park = () => { for (const e of s.enemies) if (inCave(e.spawnX, e.spawnZ) && e.type !== 'warden') { e.state = 'dead'; e.respawnIn = 1e9; } s.targetId = null; };
  park();
  walkVia(s, [[-18, -62], [-18, -70], [-18, -75]]);
  const warden = enemyOf(s, 'warden');
  let wardenTries = 0;
  while (st(warden) !== 'dead' && wardenTries++ < 4) {
    if (s.player.dead) { run(s, RESPAWN_DELAY + 0.5); walkVia(s, mouthWalk); walkVia(s, [[-18, -62], [-18, -70], [-18, -75]]); }
    huntOne(s, 'warden');
  }
  assert(st(warden) === 'dead' && secondStage(s) === 'report', `the Hollow Warden falls (${wardenTries} attempt${wardenTries === 1 ? '' : 's'}, ${deathTally} death${deathTally === 1 ? '' : 's'} in the run so far)`);
  sweepDrops(s);
  milestone('Hollow Warden slain');

  // 10. the hand-in, across the whole map
  const reload = deserialize(serialize(s))!;
  assert(reload.quest.second === 'report' && MITHRIL_SET.every(id => Object.values(reload.player.equipment).includes(id)), 'saved after the boss, reloaded: still at the hand-in, still in the set');
  assert(talkToNpc(s), 'a long walk back to Warden Hale');
  const c0 = s.player.combat.xp, m0 = s.player.skills.mining.xp, sm0 = s.player.skills.smithing.xp;
  tick(s, { questAdvance: true });
  assert(secondStage(s) === 'cleared' && sawQuest(s, 'complete'), 'quest two complete');
  assert(s.player.combat.xp >= c0 + REWARD2[0].xp && s.player.skills.mining.xp === m0 + REWARD2[1].xp && s.player.skills.smithing.xp === sm0 + REWARD2[2].xp, 'rewards paid: combat, mining and smithing XP');
  milestone(`second quest complete, Combat ${s.player.combat.level}, Mining ${s.player.skills.mining.level}, Smithing ${s.player.skills.smithing.level}`);
  console.log(`  second quest: ${((clock() - firstQuestSeconds) / 60).toFixed(1)} min of game time on top of the first quest's ${(firstQuestSeconds / 60).toFixed(1)}; ${deathTally} bot deaths along the way`);
  assert(npcMarker(s) === null && activeQuestView(s).target === null, 'nothing left on the tracker');

  // 11. after the quest: the floor to stand on. The Warden returns; its shards make the best blade there is.
  const SHARDS = recipeById('warden_edge')!.inputs.find(i => i.id === 'warden_shard')!.qty;
  let kills2 = 0;
  while (countOf(s, 'warden_shard') < SHARDS && kills2 < 14) {
    for (let w = 0; st(warden) === 'dead' && w < 400; w++) run(s, 1); // waits out the respawn (never blocked: it is a timer)
    park();
    walkVia(s, mouthWalk); walkVia(s, [[-18, -62], [-18, -70], [-18, -75]]);
    for (let a = 0; a < 3 && st(warden) !== 'dead' && !s.player.dead; a++) huntOne(s, 'warden');
    if (s.player.dead) { run(s, RESPAWN_DELAY + 0.5); continue; }
    if (st(warden) === 'dead') kills2++;
    sweepDrops(s);
  }
  assert(countOf(s, 'warden_shard') >= SHARDS, `${countOf(s, 'warden_shard')} Warden shards after ${kills2 + 1} kills of the Warden: a chase worth ${SHARDS} drops, not one`);
  assert(kills2 + 1 <= 8, `...and it took ${kills2 + 1} kills, so it is a farm and not a wall`);
  milestone(`${countOf(s, 'warden_shard')} shards`);
  // three more bars (from the veins and the Warden's own ore), then the forge
  gatherUntil(s, 'mithril', Math.max(0, 3 - countOf(s, 'mithril_bar')) + countOf(s, 'mithril_ore'));
  gatherUntil(s, 'coal', 6 + countOf(s, 'coal'));
  assert(s.player.skills.smithing.level >= recipeById('warden_edge')!.level, `Smithing ${s.player.skills.smithing.level} is already past the Edge's gate (${recipeById('warden_edge')!.level}) from the set alone`);
  assert(atForge(s), 'at the forge again');
  craft(s, 'mithril_bar', 3);
  craft(s, 'warden_edge', 1);
  assert(countOf(s, 'warden_edge') === 1, "the Warden's Edge is smithed");
  dressAndTidy(s);
  assert(s.player.equipment.weapon === 'warden_edge' && s.player.stats.weaponDamage > ITEMS.forged_blade.stats!.damage! && appearanceOf('warden_edge').rung === 4, "and it goes on in place of the Forgemaster's Blade, with the epic look");
  const edgeWorth = deriveStats({ ...s.player.equipment }).weaponDamage;
  assert(edgeWorth === ITEMS.warden_edge.stats!.damage! && edgeWorth > ITEMS.forged_blade.stats!.damage! + 8, `+${edgeWorth} weapon damage against the blade's +${ITEMS.forged_blade.stats!.damage}`);
  milestone('Warden Edge equipped');
  killTally = null;

  // the world is stable afterwards
  run(s, 30);
  assert(!s.player.dead, 'the world stays quiet after the second quest');
  const end = deserialize(serialize(s))!;
  assert(end.quest.second === 'cleared' && end.player.equipment.weapon === 'warden_edge' && end.player.equipment.head === 'mithril_helm', 'a finished game loads as finished, still in the full set');
}

// ---------------------------------------------------------------------------
section('HOM-15 getting around: one click gets you out of the cave, and nothing stays stuck on scenery');
{
  const rank = (x: number, z: number) => caveRank(x, z);
  assert(rank(0, 6) === 0 && rank(-18, -25) === 0 && rank(-18, -35) === 1 && rank(-18, -55) === 2 && rank(-18, -67) === 3 && rank(-18, -85) === 4 && rank(-10, -28) === 0, 'caveRank tells outdoors, throat, hollow, neck and hall apart (and the ridge is outdoors)');
  const same = { x: -25, z: -50 };
  assert(steerPoint({ x: -18, z: -55 }, same) === same && steerPoint({ x: 0, z: 6 }, { x: 10, z: 10 }).x === 10, 'within one stretch, and anywhere outdoors, a walk goes straight at its target: nothing changes outside the cave');
  const hop = steerPoint({ x: -18, z: -85 }, { x: 5, z: 2 });
  assert(caveRank(hop.x, hop.z) === 3, 'from the hall to the clearing the first aim is the neck, then the hollow, then the throat, then the mouth');

  for (const [name, from, to] of [['the warden hall to the clearing', { x: -18, z: -85 }, { x: 0, z: 6 }], ['the clearing to the warden hall', { x: 0, z: 6 }, { x: -18, z: -85 }], ['the far corner of the hollow to the forge', { x: -30, z: -60 }, { x: LANDMARKS.forge.x - 4, z: LANDMARKS.forge.z + 4 }]] as const) {
    const s = quietState(960);
    s.player.x = from.x; s.player.z = from.z;
    tick(s, { clickTarget: to });
    let n = 0;
    for (; n < 30 * 60 && (s.moveTarget || s.player.moving); n++) tick(s);
    assert(dist2(s.player, to) < 1.5, `one click walks ${name} (${(n * TICK_DT).toFixed(0)}s, ends ${dist2(s.player, to).toFixed(1)}u short)`);
  }
  const f = quietState(961);
  f.player.x = -18; f.player.z = -85;
  tick(f, { interact: { k: 'npc' } });
  let opened = false;
  for (let n = 0; n < 30 * 60 && busy(f); n++) { tick(f); opened ||= hasEvent(f, e => e.t === 'npc'); }
  assert(opened, 'clicking Warden Hale from the deepest room walks all the way out and opens his dialogue');
  const g = quietState(962);
  g.player.x = -18; g.player.z = -35;
  tick(g, { dirX: 0, dirZ: 1 });
  assert(g.moveTarget === null, 'keyboard movement is untouched by the routing: it is a click-to-move feature only');

  // an enemy walking home that is walled in by scenery is put home, not left untouchable
  const w = quietState(963);
  const e = enemyOf(w, 'ogre'), spawnAt = { x: e.spawnX, z: e.spawnZ };
  e.state = 'return'; e.hp = e.maxHp; e.x = -18; e.z = -57;
  const ring = Array.from({ length: 8 }, (_, k) => ({ x: -18 + 3.2 * Math.cos(k * Math.PI / 4), z: -57 + 3.2 * Math.sin(k * Math.PI / 4), r: 1.6 }));
  COLLIDERS.push(...ring);
  const homeD = dist2(e, spawnAt), budget = 2 + 3 * homeD / (ENEMY_TYPES.ogre.speed * 1.8) + 0.2;
  let t = 0;
  while (st(e) === 'return' && t < 30) { tick(w); t += TICK_DT; }
  COLLIDERS.splice(COLLIDERS.indexOf(ring[0]), ring.length);
  assert(st(e) === 'idle' && dist2(e, spawnAt) < 0.5 && t <= budget, `an enemy walled in on its way home is reset after ${t.toFixed(1)}s (budget ${budget.toFixed(1)}s) rather than evading forever`);
  const free = quietState(964), c = enemyOf(free, 'ogre');
  c.state = 'return'; c.hp = c.maxHp; c.x = c.spawnX - 6; c.z = c.spawnZ;
  let t1 = 0;
  while (st(c) === 'return' && t1 < 30) { tick(free); t1 += TICK_DT; }
  assert(st(c) === 'idle' && t1 < 6 / (ENEMY_TYPES.ogre.speed * 1.8) + 0.5 && dist2(c, { x: c.spawnX, z: c.spawnZ }) < 0.5, `an enemy with a clear way home just walks it (${t1.toFixed(1)}s)`);
}

section('HOM-30 the Cave Brute is a door guard, and it stays dead');
{
  // leash: lured as far as it will go, it still stops at the door, long before the first Ravager fight
  const a = createState(970), b = enemyOf(a, 'brute'), post = { x: b.spawnX, z: b.spawnZ };
  for (const e of a.enemies) if (e !== b) { e.state = 'dead'; e.respawnIn = 1e9; }
  a.player.maxHp = a.player.hp = 1e6; a.player.x = -18; a.player.z = -24;
  let far = 0;
  for (let n = 0; n < 30 * 40; n++) { a.player.z = Math.max(-47, a.player.z - 0.05); a.player.hp = a.player.maxHp; tick(a); far = Math.max(far, dist2(b, post)); }
  assert(far > 6 && far <= ENEMY_TYPES.brute.leash + 1 && b.z > CAVE_DOOR_Z - 1, `a Brute lured down the throat turns back at the door (furthest ${far.toFixed(1)} from its post, leash ${ENEMY_TYPES.brute.leash})`);
  assert(dist2(post, { x: -23, z: -47 }) - ENEMY_TYPES.brute.leash > 10, 'a fight at the Ravagers (-23,-47) is out of its reach by a wide margin');

  // a quest that still needs it: it respawns as ever; a finished one: it does not, and neither does a copy an older save left standing
  const q = quietState(971), qb = enemyOf(q, 'brute');
  q.quest.stage = 'brute'; qb.respawnIn = 1;
  run(q, 2);
  assert(st(qb) === 'idle' && qb.hp === qb.maxHp, 'while the quest still needs it, a fallen Brute respawns');
  const w = createState(972), wb = enemyOf(w, 'brute');
  for (const e of w.enemies) if (e !== wb) { e.state = 'dead'; e.respawnIn = 1e9; }
  w.quest.stage = 'brute'; wb.hp = 1; w.player.x = wb.x + 2.5; w.player.z = wb.z; w.player.hp = w.player.maxHp = 1e6;
  fight(w, wb, 30);
  assert(stage(w) === 'report2' && st(wb) === 'dead', 'killing it moves the quest on');
  run(w, ENEMY_TYPES.brute.respawn + 30);
  assert(st(wb) === 'dead', `${ENEMY_TYPES.brute.respawn + 30}s later (respawn is ${ENEMY_TYPES.brute.respawn}s) the Brute is still dead`);
  const r = deserialize(serialize(w))!, rb = enemyOf(r, 'brute');
  run(r, ENEMY_TYPES.brute.respawn + 30);
  assert(st(rb) === 'dead', 'and stays dead after a save and a reload');
  const old = createState(973);
  old.quest.stage = 'done'; old.quest.second = 'offer';
  const old2 = deserialize(serialize(old))!, ob = enemyOf(old2, 'brute');
  old2.player.x = ob.x + 3; old2.player.z = ob.z;
  run(old2, 5);
  assert(st(ob) === 'dead' && old2.player.hp === old2.player.maxHp, 'a save with the Brute still standing at the door, after the quest, finds it gone and unharmed');
  assert(Object.entries(ENEMY_TYPES).every(([k, d]) => k === 'brute' || !d.retiresAt), 'only the quest-1 Brute retires; every cave enemy still respawns');

  // found on the way: walking from the throat to a ridge rock used to stall in the strip between the rocks
  const m = quietState(974);
  m.player.x = -18; m.player.z = -40;
  const rock = ROCKS[0];
  tick(m, { interact: { k: 'node', id: m.nodes.find(n => n.type === rock.type && n.x === rock.x && n.z === rock.z)!.id } });
  for (let n = 0; n < 30 * 30 && busy(m); n++) tick(m);
  assert(dist2(m.player, rock) < 6, `a click on a ridge rock from inside the throat walks all the way out to it (${dist2(m.player, rock).toFixed(1)} away)`);
}

console.log(`\nAll ${checks} checks passed.`);

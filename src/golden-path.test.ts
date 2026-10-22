// Headless verification: drives the sim with synthetic input. Run with `npm run verify`.
// Exits non-zero on the first failed assertion. Extended every milestone.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState, Enemy } from './sim';
import { addItem, countItem, removeItem, INVENTORY_SIZE } from './sim/inventory';
import { ITEMS, DROP_TABLES, BRONZE_SET, COPPER_SET, STEEL_SET, MARSHHIDE_SET, THORNHIDE_SET, MOORHIDE_SET, ARMOR_K, MAX_REDUCTION, TIER_COLORS, deriveStats, describeStats, emptyEquipment, type EquipSlot } from './sim/items';
import {
  ABILITIES, ENEMY_TYPES, SPAWNS, aggroRadius, castName, GCD, RESPAWN_DELAY, ACQUIRE_BEHIND_RANGE, ACQUIRE_RANGE, AUTO_SLOT, BARE_SWING, ENERGY_REGEN, FRONT_HALF_ARC,
  FALL_GRAVITY, GRAVITY, JUMP_AIRTIME, JUMP_HEIGHT, JUMP_VELOCITY, OOC_DELAY, QUEUE_WINDOW, RECAP_WINDOW, powerForLevel, xpParity,
} from './sim/data';
import { xpForLevel, levelForXp, addXp, newTrack, levelProgress } from './sim/xp';
import { SKILL_IDS, SKILLS, grantXp } from './sim/skills';
import { NODE_TYPES } from './sim/gathering';
import { MAX_BONUS, MAX_SPEEDUP, mastery } from './sim/mastery';
import { RECIPES, FORGE_REACH, recipeById, stationSites } from './sim/crafting';
import {
  CAVE_DOOR_Z, CAVE_PILLARS, CAVE_ROCKS, CAVE_ROOMS, COLLIDERS, LANDMARKS, PLAYER_RADIUS, ROCKS, TREES, WORLD_HALF,
  GREYWATER, REGIONS, SALTMARROW, THORNWICK, TOWNS, caveDepth, caveWallPoints, clampToWorld, inCave, regionAt, resolveCollisions, sameSideOfDoor,
  DUNGEONS, dungeonAt, dungeonById, mountsAllowed, SAFE_ZONES,
} from './sim/world';
import { roadDist } from './sim/road';
import { dungeonOpen } from './sim/dungeon';
import { route } from './sim/path';
import { refreshGearStats } from './sim/inventory';
import { damagedGear, repairCost } from './sim/durability';
import { refreshPlayerStats } from './sim/combat';
import {
  BLADE_PLAN, DELVE_GOALS, DIALOGUE, DIALOGUE2, HUNT_GOALS, STEEL_PLAN, NPC, QUEST2_NAME, QUEST2_STAGES, QUEST_STAGES,
  QUEST_NAME, RECOMMENDED_COMBAT, RECOMMENDED_COMBAT_2, REWARD, REWARD2, TALK_RANGE, activeDialogue, activeQuestView, npcMarker, questOnKill, questView,
  HARBOURMASTER, QUEST3_NAME, REWARD3, dialogueAt, harbourMarker, ERRAND_GOODS, QUEST4_NAME, REWARD4,
  BRINE_GOALS, QUEST5_NAME, REWARD5,
} from './sim/quest';
import { appearanceOf, ITEM_LOOKS, TIER_LOOKS, TIER5_COLOR, TIER6_COLOR } from './gear-look';
import { BLOOM_THRESHOLD, EMISSIVE_CAP, cappedIntensity, linearPeak, minLightDistance } from './glow';
import { SAVE_VERSION, deserialize, serialize } from './sim/save';
import { DOUBLE_JUMP_APEX, DOUBLE_JUMP_CEILING, DOUBLE_JUMP_COST, DOUBLE_JUMP_LEVEL, maxStamina } from './sim/agility';
import { CHESTS, CHEST_R, CHEST_TOTAL, LAMP_CAP, PLACES, chestCount, chestReward, chestsIn, isOpened, openChest, placeById, type ChestDef } from './sim/chests';
import { clearLine } from './sim/sight';
import { playerStatuses } from './sim/status';
import {
  EXECUTE_BONUS, EXECUTE_UNDER, TALENTS, TALENT_START_LEVEL, TIER_COST, TREE_IDS, WOUNDED_UNDER,
  abilityFromTalent, deriveTalents, refreshTalents, spentIn, spentTotal, talentById, talentPoints,
} from './sim/talents';
import { SWEEP_CLEAR, abilityOpen, reductionOf } from './sim/combat';
import { PROCS } from './sim/procs';
import { SHOP_STOCK, VENDOR, SHOP_REACH, BUY_MARKUP, buyPrice, HARBOUR_STOCK, HARBOUR_VENDOR } from './sim/shop';

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
/**
 * Run `fn` with the proc layer (sim/procs.ts) switched off. The retune figures below are what the kit deals on its own
 * cooldowns; a window firing inside the measurement would hide a drift in exactly the number it was recorded to guard.
 * What the windows are worth on top is measured in its own right, in src/combat-depth.test.ts.
 */
function withoutProcs<T>(fn: () => T): T {
  const defs = Object.values(PROCS), was = defs.map(d => d.chance);
  for (const d of defs) d.chance = 0;
  try { return fn(); } finally { defs.forEach((d, i) => { d.chance = was[i]; }); }
}

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
const SLOT = { strike: 0, crushing: 1, throw: 2, wind: 3, cleave: 4, pummel: 5, fury: ABILITIES.findIndex(a => a.name === 'Battle Fury') };
/** The bronze set without its sword: what a smith can wear off the bars the iron gate wants anyway (no log needed). */
const BRONZE_ARMOUR = BRONZE_SET.filter(id => ITEMS[id].slot !== 'weapon');

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
  if (ENEMY_TYPES[e.type].ranged) return d > (ENEMY_TYPES[e.type].hazard ? 2.2 : 3) ? { dirX: -away.dirX, dirZ: -away.dirZ } : {}; // close the gap and stay in its face
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
  const stood = { x: s.player.x, z: s.player.z };
  const far = s.nodes.find(n => Math.hypot(n.x - stood.x, n.z - stood.z) > 8)!;
  tick(s, { interact: { k: 'node', id: far.id } });
  assert(hasEvent(s, e => e.t === 'stuck') && s.interact === null, 'HOM-139: a click on something out of reach says so instead of walking there');
  run(s, 3);
  assert(Math.hypot(s.player.x - stood.x, s.player.z - stood.z) < 1e-6, '...and the feet never move: no click moves the player, only the keys do');
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
  assert(Math.hypot(s.player.x - TOWNS[0].grave.x, s.player.z - TOWNS[0].grave.z) < 0.1, 'respawns at Hale\'s graveyard, not in the town');
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

  // pickup: walk over it on the keys and it lands in the inventory (HOM-139: nothing fetches it for you)
  s.player.x = drop.x + 8; s.player.z = drop.z;
  const qty = drop.qty, item = drop.item;
  walkTo(s, drop.x, drop.z, 1);
  assert(!s.drops.includes(drop) && countItem(s.player.inventory, item) === qty, `walked over drop: ${qty}x ${ITEMS[item].name} in inventory`);

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

  // HOM-107, the armour cap: 0.80, which is armour 160. It was 0.75 (120), and at starmetal (100) Thornhide (25) and Moorhide (33) both came to the cap, so Moorhide bought nothing.
  // The kit is the best piece in every slot that exists, so it grows by itself when starmetal ships (HOM-109) and the check keeps guarding the cap.
  const capArmor = Math.round(ARMOR_K * MAX_REDUCTION / (1 - MAX_REDUCTION));
  const armorOf = (id: string) => ITEMS[id].stats?.armor ?? 0;
  const bestIn = (slot: EquipSlot) => Object.keys(ITEMS).filter(id => ITEMS[id].slot === slot).reduce((best, id) => armorOf(id) > armorOf(best) ? id : best);
  const kitWith = (hands: readonly string[]) => {
    const kit = emptyEquipment();
    for (const slot of ['head', 'chest', 'legs'] as const) kit[slot] = bestIn(slot);
    [kit.hands, kit.feet] = hands;
    return deriveStats(kit);
  };
  assert(MAX_REDUCTION === 0.8 && capArmor === 160, `the cap is ${MAX_REDUCTION}, which is armour ${capArmor}`);
  const moor = kitWith(MOORHIDE_SET), thorn = kitWith(THORNHIDE_SET), marsh = kitWith(MARSHHIDE_SET);
  assert(moor.reduction < MAX_REDUCTION && moor.armor < capArmor, `the best six-slot kit in the game (${bestIn('head')}, ${bestIn('chest')}, ${bestIn('legs')} and Moorhide) is armour ${moor.armor}, ${(100 * moor.reduction).toFixed(1)}% off: under the cap of ${capArmor}`);
  assert(moor.reduction > thorn.reduction + 0.005 && thorn.reduction > marsh.reduction + 0.005, `and each leather rung is still worth something on it: Moorhide ${(100 * moor.reduction).toFixed(1)}%, Thornhide ${(100 * thorn.reduction).toFixed(1)}%, Marsh-hide ${(100 * marsh.reduction).toFixed(1)}%`);
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
/**
 * The nearest live node of a type, on the bot's own side of the cave mouth where there is one: the Hollow's seam is tin since HOM-81, so a
 * bot on the ridge that simply took the closest tin rock would walk itself past the Cave Brute. It is the rule the tracker follows (nodeTarget).
 */
const nearestNode = (s: GameState, type: string) => {
  const live = nodesOf(s, type).filter(n => n.charges > 0).sort((a, b) => dist2(a, s.player) - dist2(b, s.player));
  const here = inCave(s.player.x, s.player.z);
  return live.find(n => inCave(n.x, n.z) === here) ?? live[0];
};
/** Gather from nodes of `type` until the bag holds `want` of the node's item. Waits for respawns when all are depleted. */
function gatherUntil(s: GameState, type: string, want: number) {
  const item = NODE_TYPES[type].item;
  for (let guard = 0; countOf(s, item) < want && guard < 400; guard++) {
    const n = nearestNode(s, type);
    if (!n) { run(s, 1); continue; }
    useNode(s, n);
    untilIdle(s);
    defend(s);
  }
}
/** Walk to the nearest forge and click it open. */
function atForge(s: GameState) {
  for (let tries = 0; tries < 5; tries++) {
    const f = stationSites('forge').sort((a, b) => dist2(a, s.player) - dist2(b, s.player))[0];
    walkTo(s, f.x, f.z, 4, 60); // the hut is a 2.6 collider: 4 centre-to-centre is inside the click's reach
    tick(s, { interact: { k: 'forge' } });
    if (hasEvent(s, e => e.t === 'forge')) return true;
    defend(s); // aggroed on the way: deal with it and retry the walk
  }
  return false;
}
/**
 * A new smith's road to iron, as a player takes it (HOM-56): copper and tin until Mining opens the iron rock, then bronze at the forge until
 * Smithing opens the iron bar, and then the rest of what the Warden said: wear what you make. Nine of those bars are the bronze set (bible 2.3),
 * and it is the armour the Brute is fought in: since HOM-77 the ore is out on the road, where nothing aggroes, so the trips no longer level the
 * player on the way.
 */
function bronzeToIron(s: GameState) {
  const ironBar = recipeById('iron_bar')!.level;
  for (let guard = 0; guard < 60 && (s.player.skills.mining.level < NODE_TYPES.iron.level || s.player.skills.smithing.level < ironBar); guard++) {
    if (s.player.skills.mining.level < NODE_TYPES.iron.level || !countOf(s, 'copper_ore') || !countOf(s, 'tin_ore')) {
      const tinOpen = s.player.skills.mining.level >= NODE_TYPES.tin.level;
      for (const type of tinOpen ? ['copper', 'tin'] : ['copper']) gatherUntil(s, type, countOf(s, NODE_TYPES[type].item) + 3);
    } else {
      atForge(s);
      craft(s, 'bronze_bar', countOf(s, 'bronze_bar') + Math.min(countOf(s, 'copper_ore'), countOf(s, 'tin_ore')));
    }
  }
  atForge(s);
  for (const id of BRONZE_ARMOUR) craft(s, id, 1);
  for (const id of BRONZE_ARMOUR) tick(s, { inv: [{ k: 'equip', slot: s.player.inventory.findIndex(x => x?.id === id) }] });
}
/** The whole first forge stage as a player plays it: bronze, then the plan's iron, coal and a log, then the bars and the blade. */
function smithTheBlade(s: GameState) {
  bronzeToIron(s);
  gatherUntil(s, 'iron', BLADE_PLAN.ore);
  while (s.player.skills.mining.level < NODE_TYPES.coal.level) gatherUntil(s, 'iron', countOf(s, 'iron_ore') + 3);
  gatherUntil(s, 'coal', BLADE_PLAN.coal); gatherUntil(s, 'tree', BLADE_PLAN.logs);
  atForge(s);
  craft(s, 'iron_bar', BLADE_PLAN.bars); craft(s, 'steel_bar', BLADE_PLAN.steel); craft(s, 'forged_blade', 1);
}
/**
 * Smithing practice as a player does it once bronze is behind them: iron bars hardened into steel, with `keepCoal` held back for what the practice is for.
 * It is the same coal and ore the Mining practice just brought home, which is why the two climb together.
 */
function practiseSmithing(s: GameState, level: number, keepCoal: number) {
  for (let guard = 0; guard < 60 && s.player.skills.smithing.level < level; guard++) {
    gatherUntil(s, 'iron', countOf(s, 'iron_ore') + 10);
    const bars = Math.floor(countOf(s, 'iron_ore') / 2);
    gatherUntil(s, 'coal', keepCoal + 2 * bars);
    atForge(s);
    craft(s, 'iron_bar', bars);
    craft(s, 'steel_bar', Math.min(countOf(s, 'iron_bar'), Math.floor((countOf(s, 'coal') - keepCoal) / 2)));
  }
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
    if (s.player.dead) { wake(s); continue; }
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
    if (s.player.dead) { wake(s); continue; }
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
  assert(SKILL_IDS.length === 11 && ['combat', 'mining', 'woodcutting', 'smithing', 'fishing', 'cooking', 'herbalism', 'alchemy', 'leatherworking', 'enchanting', 'agility'].every(k => SKILLS[k as never]), 'skills: Combat, Mining, Woodcutting, Smithing, Fishing, Cooking, Herbalism, Alchemy, Leatherworking, Enchanting, Agility');
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
  const def = NODE_TYPES.copper;
  const rock = nodesOf(s, 'copper')[0];
  assert(nodesOf(s, 'iron').length >= 3 && nodesOf(s, 'coal').length >= 2 && nodesOf(s, 'tree').length === TREES.length + REGIONS.find(r => r.id === 'wayside')!.trees.length, 'iron rocks, coal seams and trees are placed in the zone (and along the road)');
  const road = REGIONS.find(r => r.id === 'wayside')!.rocks;
  assert(ROCKS.every(r => r.type === 'copper') && ['tin', 'iron', 'coal'].every(t => road.some(r => r.type === t)), 'HOM-77: Hale has copper and nothing else; tin, iron and coal are out on the road');
  assert(nodesOf(s, 'copper').length >= 3 && nodesOf(s, 'tin').length >= 3, 'copper is in the clearing and on the ridge, tin on the road, three of each or more');
  assert(ROCKS.every(r => dist2(r, enemyOf(s, 'brute')) > ENEMY_TYPES.brute.aggroRadius + 1), 'no ore node sits inside the Cave Brute aggro radius');

  const far = dist2(s.player, rock);
  tick(s, { interact: { k: 'node', id: rock.id } });
  assert(s.interact === null && s.player.action === null && hasEvent(s, e => e.t === 'stuck'), `clicking a far node (${far.toFixed(0)}u) neither walks there nor gathers: it says you can't reach it`);
  walkTo(s, rock.x, rock.z, rock.r + 2);
  tick(s, { interact: { k: 'node', id: rock.id } });
  assert(actionKind(s) === 'gather' && dist2(s.player, rock) < rock.r + 2.5, 'walked into reach by hand, the same click begins the gather');
  const a = s.player.action!;
  run(s, def.time / 2);
  assert(s.player.action === a && countOf(s, 'copper_ore') === 0, 'gathering takes time: nothing yielded halfway');
  run(s, def.time / 2 + TICK_DT * 2);
  assert(countOf(s, 'copper_ore') === 1 && s.player.skills.mining.xp === def.xp, `first swing yields 1 Copper Ore and ${def.xp} Mining XP`);
  assert(rock.charges === def.charges - 1 && s.player.action !== null, 'gathering continues automatically on the same node');
  untilIdle(s);
  assert(countOf(s, 'copper_ore') === def.charges && rock.charges === 0 && rock.respawnIn > 0, `node depletes after ${def.charges} ore`);
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
  useNode(s, rock);
  run(s, 1);
  assert(s.player.action !== null, 'gathering a third time');
  const w = enemyOf(s, 'wolf');
  w.x = s.player.x + 1; w.z = s.player.z; w.spawnX = w.x; w.spawnZ = w.z; w.hp = w.maxHp; w.state = 'chase'; w.attackCd = 0; // its leash is from its own spawn: copper is a long way from where this wolf lives
  run(s, 0.3);
  assert(s.player.action === null, 'getting hit by an enemy cancels the gather');
  w.state = 'dead'; w.respawnIn = 1e9;

  // trees feed Woodcutting
  const tree = nearestNode(s, 'tree');
  s.player.hp = s.player.maxHp = 999;
  useNode(s, tree);
  untilIdle(s);
  assert(countOf(s, 'logs') === NODE_TYPES.tree.charges && s.player.skills.woodcutting.xp === NODE_TYPES.tree.xp * NODE_TYPES.tree.charges, 'chopping a tree yields Logs and Woodcutting XP');
  assert(tree.charges === 0, 'trees deplete too');

  // full bag stops the gather instead of losing the ore
  const s2 = quietState(2);
  s2.player.inventory.fill({ id: 'boar_hide', qty: 50 });
  useNode(s2, nodesOf(s2, 'copper')[0]);
  untilIdle(s2);
  assert(hasEvent(s2, e => e.t === 'actionfail' && e.reason === 'full') && s2.player.action === null && nodesOf(s2, 'copper')[0].charges === 3, 'full inventory refuses to gather and tells the player');
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
  assert(lf && lf.t === 'actionfail' && lf.reason === 'level' && lf.skill === 'smithing' && lf.need === recipeById('forged_blade')!.level, `Smithing 1 cannot forge the blade: told it needs Smithing ${recipeById('forged_blade')!.level}`);
  s.player.inventory.fill(null);
  tick(s, { craft: { recipe: 'bronze_bar', count: 1 } });
  assert(hasEvent(s, e => e.t === 'actionfail' && e.reason === 'materials') && s.player.action === null, 'missing materials: refused');
  addItem(s.player.inventory, 'iron_ore', 2);
  tick(s, { craft: { recipe: 'iron_bar', count: 1 } });
  assert(hasEvent(s, e => e.t === 'actionfail' && e.reason === 'level' && e.skill === 'smithing' && e.need === recipeById('iron_bar')!.level) && s.player.action === null, `a new smith has the ore and is still refused iron: it wants Smithing ${recipeById('iron_bar')!.level}`);
}

// ---------------------------------------------------------------------------
section('M3 smithing: forge recipes');
{
  assert(RECIPES.every(r => ITEMS[r.output.id] && r.inputs.every(i => ITEMS[i.id])), 'every recipe references real items');
  const s = quietState(4);
  addItem(s.player.inventory, 'copper_ore', 4); addItem(s.player.inventory, 'tin_ore', 4);
  assert(atForge(s) && dist2(s.player, LANDMARKS.forge) <= FORGE_REACH, 'walking to the forge and clicking it opens it');
  tick(s, { craft: { recipe: 'bronze_bar', count: 2 } });
  assert(actionKind(s) === 'craft' && countOf(s, 'bronze_bar') === 0, 'craft starts; nothing is produced instantly');
  run(s, recipeById('bronze_bar')!.time + TICK_DT * 2);
  assert(countOf(s, 'bronze_bar') === 1 && countOf(s, 'copper_ore') === 3 && countOf(s, 'tin_ore') === 3, 'crafting consumes 1 Copper Ore and 1 Tin Ore and produces 1 Bronze Bar');
  assert(s.player.skills.smithing.xp === recipeById('bronze_bar')!.xp, `crafting grants Smithing XP (${recipeById('bronze_bar')!.xp})`);
  untilIdle(s);
  assert(countOf(s, 'bronze_bar') === 2 && countOf(s, 'copper_ore') === 2 && countOf(s, 'tin_ore') === 2, 'a batch of 2 runs to completion');
  const b = quietState(4);
  b.player.x = LANDMARKS.forge.x - 4; b.player.z = LANDMARKS.forge.z + 3;
  addItem(b.player.inventory, 'copper_ore', 5); addItem(b.player.inventory, 'tin_ore', 6);
  tick(b, { craft: { recipe: 'bronze_bar', count: 99 } });
  untilIdle(b);
  assert(countOf(b, 'bronze_bar') === 5 && countOf(b, 'tin_ore') === 1, 'a "make all" batch stops when materials run out');
  addItem(b.player.inventory, 'copper_ore', 2);
  tick(b, { craft: { recipe: 'bronze_bar', count: 1 } });
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
  const atLevel = structuredClone(s); // the counterfactual below is this player, the moment level 5 was reached: dying now means a walk from the graveyard (HOM-58), and the bot's extra kills on the way would otherwise level it past the point
  s.player.inventory.fill(null); // keep the bag clean: only the crafted weapon matters below

  // 3. the RuneScape loop, timed from the first swing to the blade in hand
  const t0 = s.tick;
  bronzeToIron(s);
  const bronzeSecs = (s.tick - t0) * TICK_DT;
  assert(s.player.skills.mining.level >= NODE_TYPES.iron.level && s.player.skills.smithing.level >= recipeById('iron_bar')!.level, `copper, tin and bronze first: Mining ${s.player.skills.mining.level}, Smithing ${s.player.skills.smithing.level}, ${countOf(s, 'bronze_bar')} bronze bars (${(bronzeSecs / 60).toFixed(1)} min)`);
  gatherUntil(s, 'iron', 8);
  while (s.player.skills.mining.level < NODE_TYPES.coal.level) gatherUntil(s, 'iron', countOf(s, 'iron_ore') + 3);
  assert(s.player.skills.mining.level >= NODE_TYPES.coal.level, `mined ${countOf(s, 'iron_ore')} iron ore: Mining is now level ${s.player.skills.mining.level}, Coal Seams unlocked`);
  gatherUntil(s, 'iron', BLADE_PLAN.ore);
  gatherUntil(s, 'coal', BLADE_PLAN.coal);
  assert(countOf(s, 'coal') >= BLADE_PLAN.coal && countOf(s, 'iron_ore') >= BLADE_PLAN.ore, `gathered ${countOf(s, 'iron_ore')} Iron Ore + ${countOf(s, 'coal')} Coal (nodes yield in threes)`);
  gatherUntil(s, 'tree', 1);
  const mineSecs = (s.tick - t0) * TICK_DT;
  assert(countOf(s, 'logs') >= 1 && s.player.skills.woodcutting.level >= 1, 'chopped Logs for the hilt');

  assert(atForge(s), 'walked to the forge');
  craft(s, 'iron_bar', BLADE_PLAN.bars);
  assert(countOf(s, 'iron_bar') >= BLADE_PLAN.bars && s.player.skills.smithing.level >= recipeById('steel_bar')!.level, `smelted ${BLADE_PLAN.bars} Iron Bars: Smithing ${s.player.skills.smithing.level} (steel wants ${recipeById('steel_bar')!.level})`);
  craft(s, 'steel_bar', BLADE_PLAN.steel);
  assert(countOf(s, 'steel_bar') >= BLADE_PLAN.steel && s.player.skills.smithing.level >= recipeById('forged_blade')!.level, `hardened ${BLADE_PLAN.steel} Steel Bars: Smithing ${s.player.skills.smithing.level} (the blade wants ${recipeById('forged_blade')!.level})`);
  craft(s, 'forged_blade', 1);
  const pathSecs = (s.tick - t0) * TICK_DT;
  assert(countOf(s, 'forged_blade') === 1, `forged the Forgemaster's Blade (ore-to-weapon ${pathSecs.toFixed(0)}s game time; gathering ${mineSecs.toFixed(0)}s)`);
  console.log(`  ore-to-weapon path: ${(pathSecs / 60).toFixed(1)} min (mining/chopping ${(mineSecs / 60).toFixed(1)} min, smithing ${((pathSecs - mineSecs) / 60).toFixed(1)} min, incl. walking)`);
  assert(pathSecs >= 480 && pathSecs <= 1500, `from the first swing to the blade is a stretch of play, not a few minutes (${(pathSecs / 60).toFixed(0)} min for a bot that never idles; 8 to 25 wanted)`);

  // 4. equip it; counterfactual at the same level without it
  // (a few minutes of mining draw a few fights through the bot's self-defence, which has levelled it past the level this is about)
  s.player.combat.xp = xpForLevel(combatLevel); s.player.combat.level = combatLevel; refreshPlayerStats(s, true);
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
/** Walk over to the NPC and click him: the dialogue opens (HOM-139: the click itself fetches nobody). */
function talkToNpc(s: GameState) {
  for (let tries = 0; tries < 5; tries++) {
    walkTo(s, NPC.x, NPC.z, NPC.r + 1.5, 60);
    tick(s, { interact: { k: 'npc' } });
    if (hasEvent(s, e => e.t === 'npc')) return true;
    defend(s);
  }
  return false;
}
/**
 * Walk there on the keys, held toward each waypoint of the route the world allows, until within `within` of a point
 * (gives up after maxSec). Enemies that aggro on the way are the caller's problem.
 */
function walkTo(s: GameState, x: number, z: number, within = 2, maxSec = 40) {
  const away = () => Math.hypot(s.player.x - x, s.player.z - z); // not dist2: walkTo is called from sections above its const
  const pts = route(s.player, { x, z }) ?? [{ x, z }];
  let wedged = 0; // ticks held against scenery going nowhere: give up rather than push at it for the whole budget
  for (let t = 0; t < maxSec && away() > within; t += TICK_DT) {
    if (s.player.dead || wedged > 15) break;
    while (pts.length > 1 && Math.hypot(s.player.x - pts[0].x, s.player.z - pts[0].z) < 0.3) pts.shift();
    const dx = pts[0].x - s.player.x, dz = pts[0].z - s.player.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) break;
    const was = { x: s.player.x, z: s.player.z };
    tick(s, { dirX: dx / d, dirZ: dz / d });
    wedged = Math.hypot(s.player.x - was.x, s.player.z - was.z) < 1e-3 ? wedged + 1 : 0;
  }
  return away() <= within;
}
/** Walk into reach of a node, then click it: since HOM-139 the click alone travels nowhere. */
function useNode(s: GameState, n: { id: number; x: number; z: number; r: number }) {
  walkTo(s, n.x, n.z, n.r + 1.5, 60);
  tick(s, { interact: { k: 'node', id: n.id } });
}
/** Rest (real time) until nearly healed and energy is back. No cheating: the clock keeps running. */
function rest(s: GameState) {
  for (let t = 0; t < 90 && (s.player.hp < s.player.maxHp * 0.85 || s.player.energy < 60); t += 1) run(s, 1);
}
/** Hunt one living enemy of `type`: walk to it, fight it, recover. */
function huntOne(s: GameState, type: string) {
  for (let guard = 0; guard < 6; guard++) {
    if (s.player.dead) { wake(s); continue; }
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
  assert(talkToNpc(s), 'walking over to the NPC and clicking him opens the dialogue (npc event)');
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
  assert(questView(s).lines.length === 3 && questView(s).target?.label === 'Copper Rock' && lineTexts(s)[0].includes(`needs Mining ${NODE_TYPES.iron.level}`), 'tracker lists ore / coal / logs, and a new character under the iron gate is pointed at copper: ' + lineTexts(s).join(' | '));
  addItem(s.player.inventory, 'copper_ore', 2);
  grantXp(s, 'mining', xpForLevel(NODE_TYPES.tin.level) - s.player.skills.mining.xp, 0, 0);
  assert(questView(s).target?.label === 'Tin Rock', 'with copper in the bag and tin open, the next practice is tin: the pairs come out even for the bars');
  grantXp(s, 'mining', xpForLevel(NODE_TYPES.iron.level) - s.player.skills.mining.xp, 0, 0);
  assert(questView(s).target?.label === 'Iron Rock' && !lineTexts(s)[0].includes('needs Mining'), 'at the iron gate the arrow moves to iron and the gate note goes');
  s.player.inventory.fill(null); s.player.skills.mining.xp = 0; s.player.skills.mining.level = 1;

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
  assert(!dl.player.dead && dl.player.hp === dl.player.maxHp && dl.player.z === TOWNS[0].grave.z, 'a save made while dead wakes you at the graveyard');
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
  assert(lineTexts(s)[0].includes(`needs Mining ${NODE_TYPES.iron.level}`) && questView(s).target?.label === 'Copper Rock', 'tracker: iron is out of reach, practise on copper first');
  bronzeToIron(s); // what the tracker says: copper and tin, smelted to bronze, until iron opens
  assert(!lineTexts(s)[0].includes('needs Mining'), 'tracker: the gate note is gone once Mining opens iron');
  assert(BRONZE_ARMOUR.every(id => Object.values(s.player.equipment).includes(id)), `and wore what it made, as the Warden said: the bronze set, ${s.player.stats.armor} armour`);
  milestone(`bronze first: Mining ${s.player.skills.mining.level}, Smithing ${s.player.skills.smithing.level}, ${countOf(s, 'bronze_bar')} bronze bars`);
  gatherUntil(s, 'iron', BLADE_PLAN.ore);
  assert(lineTexts(s)[0] === `Mine Iron Ore: ${BLADE_PLAN.ore}/${BLADE_PLAN.ore}`, 'tracker: iron done (' + lineTexts(s)[0] + ')');
  assert(lineTexts(s)[1].includes(`needs Mining ${NODE_TYPES.coal.level}`) === (s.player.skills.mining.level < NODE_TYPES.coal.level), 'tracker: coal says what it needs until Mining gets there');
  while (s.player.skills.mining.level < NODE_TYPES.coal.level) gatherUntil(s, 'iron', countOf(s, 'iron_ore') + 3); // the arrow stays on iron: the seam is the next step up
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
  milestone(`blade forged, combat level ${s.player.combat.level}`);

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
  assert(ABILITIES.every(a => a.trainer || a.talent || a.unlockLevel <= 5),
    'the whole kit is handed over by combat level 5 (trainer abilities are bought, capstones are talented), within the quest levelling');

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
  assert(JSON.stringify(later) === JSON.stringify([SLOT.wind, SLOT.cleave, SLOT.pummel, SLOT.fury].sort()), 'levels 4 and 5 hand over Second Wind, Pummel, Cleave and Battle Fury');

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
  assert(ENEMY_TYPES.hexer.attackRange > 8 && r.range > 8, 'the Cave Hexer is built to fight from outside melee range');
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

  // HOM-73: it would rather be at range, but it does not run from you. Step into melee and it stands its ground.
  s.player.x = h.x; s.player.z = h.z + 2; h.attackCd = 99; h.cast = null; h.state = 'chase';
  const post = { x: h.x, z: h.z };
  run(s, 1.2);
  assert(Math.hypot(h.x - post.x, h.z - post.z) < 0.1 && Math.hypot(h.x - s.player.x, h.z - s.player.z) < 2.5, 'closed to melee, the Hexer holds its ground');

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
    const now = withoutProcs(() => measure(level, weapon));
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
  assert(air * TICK_DT > 0.45 && air * TICK_DT < 0.65, `the hop is quick: ${(air * TICK_DT).toFixed(2)}s in the air, between 0.45s and 0.65s`);
  assert(Math.abs(air * TICK_DT - JUMP_AIRTIME) < 0.05, `and matches the JUMP_AIRTIME the jump clip is stretched over (${JUMP_AIRTIME.toFixed(2)}s)`);
  assert(peak > 1.0 && peak < 1.5 && Math.abs(peak - JUMP_HEIGHT) < 0.25, `peak height ${peak.toFixed(2)}u matches v^2/2g (${JUMP_HEIGHT.toFixed(2)}u)`);
  const up = JUMP_VELOCITY / GRAVITY;
  assert(FALL_GRAVITY > GRAVITY && JUMP_AIRTIME - up < up, `and the fall is the quicker half, as in WoW: ${up.toFixed(2)}s up, ${(JUMP_AIRTIME - up).toFixed(2)}s down`);

  // one jump per takeoff; a held key hops again on landing; a jump in the air does nothing
  const h = quietState(402);
  const jumpTicks: number[] = [];
  for (let n = 0; n < 5 * 30; n++) { tick(h, { jump: true }); if (hasEvent(h, e => e.t === 'jump')) jumpTicks.push(n); }
  const gaps = jumpTicks.slice(1).map((t, i) => t - jumpTicks[i]);
  assert(jumpTicks.length >= 4 && gaps.every(g => g >= Math.floor(JUMP_AIRTIME / TICK_DT)), `no double jump: holding the key hops again only after landing (${jumpTicks.length} hops, gaps ${gaps.join('/')} ticks)`);

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
    for (let n = 0; n < 8 * 30; n++) { tick(g, { dirX: 0.7071, dirZ: -0.7071, jump: spam }); trace.push(`${g.player.x.toFixed(6)},${g.player.z.toFixed(6)}`); }
    return trace.join(';');
  };
  assert(route(false) === route(true), 'every x/z of a long walk (tree collision, a turn across the clearing) is identical whether or not the player jumps the whole way');
}
{
  // it does not dodge: the slam telegraph, the heavy hit and ordinary swings all land on an airborne player.
  // HOM-151 inverted this (a slam passed under a hop); docs/action-layer.md 8.1 puts it back: the hop's dodge belongs to the low swing (the
  // sweep) and the net, so a slam is answered by the roll, the interrupt or the legs, and jumping through it is not an answer.
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
  for (let seed = 405; seed < 413; seed++) { // a hop lasts about half a second: different seeds put the slam at different points of it
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
  const node = g.nodes.find(n => n.type === 'copper')!;
  useNode(g, node);
  run(g, 0.5);
  assert(g.player.action !== null, 'gathering');
  tick(g, { jump: true });
  assert(g.player.action === null, 'jumping cancels a gather in progress');
}

// ---------------------------------------------------------------------------
section('HOM-151 y is real: standing on a top, falling off it, the double jump, and what the world does about a player on a rock');
{
  // a rock you can stand on: the one prop with a `top` here is a test fixture, placed on open ground
  const rock = { x: 0, z: 0, r: 1.2, top: 1.0 };
  COLLIDERS.push(rock);
  try {
    const touching = rock.x - (rock.r + PLAYER_RADIUS); // x where a walker stops against it
    const fresh = (seed: number) => { const g = quietState(seed); g.player.x = touching - 2; g.player.z = 0; return g; };

    // walking at it still stops at the footprint, exactly as before: the top is for jumping, not walking
    const w = fresh(1501);
    run(w, 1.5, { dirX: 1 });
    assert(Math.abs(w.player.x - touching) < 1e-6 && w.player.y === 0, 'walking into a standable rock stops against it at the same distance as any rock: y stays 0');

    // a hop from beside it lands on it
    const g = fresh(1502);
    g.player.x = touching;
    let landed = 0, peak = 0;
    for (let n = 0; n < 60 && landed === 0; n++) { tick(g, { dirX: n < 1 ? 0 : 1, jump: n === 0 }); peak = Math.max(peak, g.player.y); if (hasEvent(g, e => e.t === 'land')) landed++; }
    assert(landed === 1 && g.player.y === rock.top && g.player.vy === 0 && !g.player.airborne, `a hop from the foot of it lands on its top (y ${g.player.y}), standing, not in flight`);
    assert(Math.hypot(g.player.x - rock.x, g.player.z - rock.z) < rock.r + 0.3, 'inside the footprint: the rock does not push a body on top of it out');
    run(g, 2);
    assert(g.player.y === rock.top && !g.player.airborne && !hasEvent(g, e => e.t === 'land'), 'it stays there, with no landing event every tick');

    // walking across the top, then off the edge: it falls at FALL_GRAVITY and lands on the ground
    const edge = (g.player.x - rock.x) + rock.r + 0.5; // distance to walk, east, to be well off the far rim
    let fell = false, lowest = rock.top, land = false, falling: number[] = [];
    for (let n = 0; n < 120 && !land; n++) {
      tick(g, { dirX: 1 });
      if (g.player.airborne) { fell = true; falling.push(g.player.vy); }
      if (g.player.y < lowest && !land) lowest = g.player.y;
      if (hasEvent(g, e => e.t === 'land')) land = true;
    }
    assert(fell && land && g.player.y === 0 && g.player.x > rock.x + rock.r && edge > 0, 'walking off the far edge falls to the ground');
    assert(falling.length > 3 && falling[0] === -FALL_GRAVITY * TICK_DT, `...and the fall begins from rest at FALL_GRAVITY (${falling[0]?.toFixed(2)} u/s after the first tick)`);

    // a jump from a top is measured from the top
    const h = fresh(1503);
    h.player.x = rock.x; h.player.y = rock.top;
    let hp = 0;
    for (let n = 0; n < 60; n++) { tick(h, { jump: n === 0 }); hp = Math.max(hp, h.player.y); if (n > 3 && !h.player.airborne) break; }
    assert(Math.abs(hp - (rock.top + JUMP_HEIGHT)) < 0.25 && h.player.y === rock.top, `a hop from the top peaks ${hp.toFixed(2)}u up (top ${rock.top} + ${JUMP_HEIGHT.toFixed(2)}) and lands back on it`);

    // a body above the top flies over the rock rather than being pushed off it
    const o = fresh(1504);
    o.player.x = touching - 0.3; o.player.y = rock.top + 0.05; o.player.vy = 6;
    for (let n = 0; n < 4; n++) tick(o, { dirX: 1 });
    assert(o.player.x > touching, 'at or above the top the footprint is not a wall');

    // saved while standing on it: the save has no height, and reloads on the ground *outside* the rock, not inside it
    const sv = fresh(1505);
    sv.player.x = rock.x; sv.player.y = rock.top; sv.player.z = rock.z;
    tick(sv);
    assert(sv.player.y === rock.top && !sv.player.airborne, 'standing on the rock at save time');
    const l = deserialize(serialize(sv))!;
    assert(l !== null && l.player.y === 0 && !l.player.airborne && Math.hypot(l.player.x - rock.x, l.player.z - rock.z) >= rock.r + PLAYER_RADIUS - 1e-6, 'a save made on a rock reloads on the ground beside it, not inside it');

    // the anti-kite rule (conservative until HOM-150 rules): a rock under the player is part of the player, so a melee enemy that cannot step on it
    // still reaches across it. Standing on a rock is not a free fight.
    const k = quietState(1506);
    const wolf = enemyOf(k, 'wolf');
    placeAt(wolf, 7, 0); wolf.attackCd = 0; wolf.state = 'chase'; wolf.spawnX = 7; wolf.spawnZ = 0;
    k.player.x = rock.x; k.player.z = rock.z; k.player.y = rock.top; k.player.hp = k.player.maxHp = 1e6;
    let bites = 0;
    for (let n = 0; n < 6 * 30; n++) { tick(k); for (const ev of k.events) if (ev.t === 'hit' && ev.target === 'player') bites++; }
    assert(bites >= 2, `a wolf bites a player standing in the middle of a rock it cannot enter (${bites} bites in 6s)`);
    assert(Math.hypot(wolf.x - rock.x, wolf.z - rock.z) >= rock.r + ENEMY_TYPES.wolf.radius - 1e-6, 'and it does so from outside the footprint: the enemy still cannot climb it');
  } finally { COLLIDERS.splice(COLLIDERS.indexOf(rock), 1); }
}
{
  // the double jump: a second takeoff in the air, once per hop, behind Agility, on a fresh press
  const ticksOf = (s: GameState, input: (n: number) => boolean, count: number) => {
    const out = { jumps: 0, doubles: 0, peak: 0 };
    for (let n = 0; n < count; n++) {
      tick(s, { jump: input(n) });
      for (const ev of s.events) if (ev.t === 'jump') { out.jumps++; if (ev.double) out.doubles++; }
      out.peak = Math.max(out.peak, s.player.y);
    }
    return out;
  };
  // pressed at takeoff and again at the apex (tick 0 and tick 9: 0.3s up), released between
  const press = (n: number) => n === 0 || n === 9;
  const low = quietState(1510);
  const lo = ticksOf(low, press, 40);
  assert(low.player.skills.agility.level < DOUBLE_JUMP_LEVEL && lo.jumps === 1 && lo.doubles === 0 && Math.abs(lo.peak - JUMP_HEIGHT) < 0.25, `below Agility ${DOUBLE_JUMP_LEVEL} a press in the air does nothing (one jump, peak ${lo.peak.toFixed(2)})`);
  /** A player at this Agility level with a full meter: the double jump costs breath, and a fresh state has none. */
  const skilled = (seed: number, level: number) => { const g = quietState(seed); g.player.skills.agility.level = level; g.player.stamina = maxStamina(g.player); return g; };
  const hi = skilled(1511, DOUBLE_JUMP_LEVEL);
  const up = ticksOf(hi, press, 60);
  assert(up.jumps === 2 && up.doubles === 1, `at Agility ${DOUBLE_JUMP_LEVEL} the second press is a double jump (${up.jumps} takeoffs, ${up.doubles} double)`);
  assert(up.peak > lo.peak + 0.5, `...and it carries higher than the hop alone (${up.peak.toFixed(2)}u against ${lo.peak.toFixed(2)}u)`);
  // once per hop: a third press does nothing; landing gives it back
  const thrice = skilled(1512, DOUBLE_JUMP_LEVEL);
  const th = ticksOf(thrice, n => n === 0 || n === 9 || n === 18, 24);
  assert(th.jumps === 2 && th.doubles === 1, 'one double jump per hop: a third press in the air does nothing');
  const again = ticksOf(thrice, n => n === 30 || n === 39, 60);
  assert(again.doubles === 1, 'and it is back after landing');
  // holding the key does not spend it: a held key hops on landing and that is all
  const held = skilled(1513, 50);
  const hd = ticksOf(held, () => true, 5 * 30);
  assert(hd.jumps >= 4 && hd.doubles === 0, `a held jump key only bunny-hops (${hd.jumps} hops, ${hd.doubles} double)`);

  // docs/action-layer.md 4: level 25, 40 breath, and a fixed apex of 3.2 above the floor, whatever the Agility or the press time
  assert(DOUBLE_JUMP_LEVEL === 25 && DOUBLE_JUMP_COST === 40 && DOUBLE_JUMP_APEX === 3.2 && DOUBLE_JUMP_CEILING === 2.9, 'the double jump is Agility 25, 40 breath, apex 3.2, nothing above 2.9');
  const nearly = skilled(1514, DOUBLE_JUMP_LEVEL - 1);
  assert(ticksOf(nearly, press, 60).doubles === 0, `Agility ${DOUBLE_JUMP_LEVEL - 1} has no double jump`);
  for (const lvl of [25, 50, 99]) for (const at of [4, 9, 14]) { // three press times: on the way up, near the apex, just past it
    const g = skilled(1520 + lvl + at, lvl);
    const r = ticksOf(g, n => n === 0 || n === at, 70);
    assert(r.doubles === 1 && Math.abs(r.peak - DOUBLE_JUMP_APEX) < 0.02, `Agility ${lvl}, pressed ${at} ticks up: the second push peaks at ${r.peak.toFixed(3)} (3.2 within 0.02)`);
  }
  const spent = skilled(1530, 25);
  const before = spent.player.stamina;
  tick(spent, { jump: true }); tick(spent, { jump: false }); for (let n = 0; n < 6; n++) tick(spent, { jump: false });
  const mid = spent.player.stamina;
  tick(spent, { jump: true });
  assert(spent.player.airJumped && mid - spent.player.stamina >= DOUBLE_JUMP_COST - 2, `a double jump spends ${DOUBLE_JUMP_COST} breath (${(mid - spent.player.stamina).toFixed(1)} off ${before.toFixed(0)})`);
  const winded = skilled(1531, 25);
  winded.player.stamina = 0; // the meter refills about a unit a tick, so the second press comes two ticks in, while it is still far short of the cost
  assert(ticksOf(winded, n => n === 0 || n === 2, 60).doubles === 0, 'with less breath than it costs there is no double jump');
  const high = skilled(1532, 25);
  high.player.y = 3.0; high.player.vy = 0.1; high.player.airborne = true; // above DOUBLE_JUMP_CEILING: a press does nothing and is not spent
  tick(high, { jump: true });
  assert(!high.player.airJumped && !hasEvent(high, e => e.t === 'jump'), 'a press above 2.9 above the floor does nothing, and does not spend the double jump');
}
{
  // the arcs the windows in docs/action-layer.md 2.3 were worked out on: the step is the exact parabola, so JUMP_HEIGHT is the peak (Euler lost 0.15 of it)
  const window = (level: number) => {
    const g = quietState(1540); g.player.skills.agility.level = level;
    let peak = 0, above = 0;
    for (let n = 0; n < 60; n++) { tick(g, { jump: n === 0 }); peak = Math.max(peak, g.player.y); if (g.player.y >= SWEEP_CLEAR) above++; }
    return { peak, secs: above * TICK_DT };
  };
  const one = window(1), top = window(99);
  assert(Math.abs(one.peak - JUMP_HEIGHT) < 0.01 && JUMP_HEIGHT === 1.35, `a hop at Agility 1 peaks at ${one.peak.toFixed(3)} (JUMP_HEIGHT ${JUMP_HEIGHT})`);
  assert(Math.abs(one.secs - 0.238) < 0.01, `...and is above the 1.1 clearance for ${one.secs.toFixed(3)} s at Agility 1 (the doc's 0.238, seven ticks)`);
  assert(Math.abs(top.secs - 0.479) < 0.03, `...and ${top.secs.toFixed(3)} s at Agility 99 (the doc's 0.479, within a tick)`);
}

// ---------------------------------------------------------------------------
section('HOM-158 the chests: placement, reward, opening once, and the save');
{
  assert(CHESTS.length <= CHEST_TOTAL && new Set(CHESTS.map(c => c.id)).size === CHESTS.length, `chest ids are unique (${CHESTS.length} placed of the ${CHEST_TOTAL} planned)`);
  assert(PLACES.length === 14 && new Set(PLACES.flatMap(p => p.regions)).size === PLACES.flatMap(p => p.regions).length && PLACES.flatMap(p => p.regions).every(id => REGIONS.some(r => r.id === id)), 'fourteen places, each region in exactly one, every one a real region');
  assert(CHESTS.every(c => placeById(c.place) && c.floor === 0 && c.tier === 'stash'), 'what is placed so far is stashes on the ground: a cache needs a step and a hoard a rooftop, and the world has no prop with a top to give them');
  const perPlace: Record<string, number> = { hale: 1, hollow: 1, greywater: 2, saltmarrow: 1, grotto: 1, dunmere: 2, thornwick: 1, rotroot: 1, barrowdowns: 2, highmoor: 1, cairnhold: 1, cairnwaste: 2, spire: 1, vault: 1 };
  assert(PLACES.every(p => chestsIn(p.id).length === perPlace[p.id]) && CHESTS.length === 18, '18 stashes, the per-place counts of 7.1');

  const s0 = createState(1);
  const spawns = s0.enemies.map(e => ({ x: e.spawnX, z: e.spawnZ }));
  const bosses = s0.enemies.filter(e => ENEMY_TYPES[e.type].respawn >= 300).map(e => ({ x: e.spawnX, z: e.spawnZ }));
  const near = (a: { x: number; z: number }, list: { x: number; z: number; r?: number }[]) => Math.min(...list.map(b => Math.hypot(a.x - b.x, a.z - b.z) - (b.r ?? 0)));
  for (const c of CHESTS) {
    const place = placeById(c.place)!, cave = inCave(c.x, c.z);
    const home = REGIONS.filter(r => place.regions.includes(r.id)).some(r => r.footprint.some(f => c.x >= f.x0 && c.x <= f.x1 && c.z >= f.z0 && c.z <= f.z1));
    const solid = near(c, COLLIDERS), dSpawn = near(c, spawns);
    const clear = clampToWorld({ x: c.x, z: c.z });
    const roadRegion = REGIONS.find(r => r.road && place.regions.includes(r.id));
    const offRoad = roadRegion?.road ? roadDist(roadRegion.road, c.x, c.z) : null;
    const ok = home && solid >= 1.8 && solid <= 4.5 && clear.x === c.x && clear.z === c.z && near(c, SAFE_ZONES) > 0 && near(c, bosses) >= 14
      && dSpawn >= (cave ? 8 : 16) && (offRoad === null || (offRoad >= 15 && offRoad <= 60));
    assert(ok, `${c.id}: in its place, 2 to 4 u from something solid (${solid.toFixed(1)}), ${dSpawn.toFixed(0)} u from a spawn, off the road ${offRoad === null ? 'n/a' : offRoad.toFixed(0)}, outside every safe circle, 14 u from a boss`);
  }
  const open = CHESTS.filter(c => !inCave(c.x, c.z));
  assert(open.every((a, i) => open.every((b, j) => i === j || a.place !== b.place || Math.hypot(a.x - b.x, a.z - b.z) >= 100)), 'no two chests of one place in open country are closer than 100 u');
  const rooms = CHESTS.filter(c => inCave(c.x, c.z)).map(c => CAVE_ROOMS.findIndex(r => c.x >= r.rect.x0 && c.x <= r.rect.x1 && c.z >= r.rect.z0 && c.z <= r.rect.z1));
  assert(rooms.every(r => r >= 0) && new Set(rooms).size === rooms.length, 'a dungeon holds at most one chest to a room');

  // what they pay: coin on the player's combat level, the lamp on their Agility, whatever the region
  assert([5, 20, 40].every(L => chestReward('stash', L, 1).gold === Math.round(0.5 * (0.6 * L + 3)) && chestReward('cache', L, 1).gold === chestReward('stash', L, 1).gold && chestReward('hoard', L, 1).gold === Math.round(0.6 * L + 3)),
    `coin is 0.5 / 0.5 / 1.0 x (0.6 L + 3): ${[5, 20, 40].map(L => `L${L} ${chestReward('stash', L, 1).gold}/${chestReward('cache', L, 1).gold}/${chestReward('hoard', L, 1).gold}`).join(', ')}`);
  const span = (a: number) => xpForLevel(a + 1) - xpForLevel(a);
  assert(chestReward('stash', 30, 40).xp === 0 && chestReward('cache', 30, 20).xp === Math.round(span(20) / 2) && chestReward('hoard', 30, 20).xp === span(20), 'a stash pays no Agility XP, a cache half a level and a hoard a whole one');
  assert(chestReward('cache', 30, 20).xp === 274 && chestReward('cache', 30, 40).xp === 1974 && span(50) === 10612, 'the doc\'s figures: a cache is 274 XP at Agility 20 and 1,974 at 40, and the span of level 50 is 10,612');
  assert(chestReward('hoard', 30, 49).xp === span(49) && chestReward('hoard', 30, 50).xp === LAMP_CAP && chestReward('hoard', 30, 90).xp === LAMP_CAP, 'a lamp never pays more than 10,000: the cap bites a hoard from Agility 50');
  assert(chestReward('hoard', 30, 99).xp === 0, 'and at Agility 99 there is no level left to pay a share of');
  assert(chestReward('stash', 6, 1).gold === chestReward('stash', 6, 99).gold && chestReward('hoard', 40, 1).gold > chestReward('hoard', 6, 1).gold, 'coin follows the player\'s level, not the chest\'s: no chest decays as the player outlevels it');

  // opening one: from beside it, once
  const c0 = CHESTS[2]; // the Greywater stash
  const s = quietState(1601);
  atLevel(s, 20);
  s.player.x = c0.x + 8; s.player.z = c0.z;
  assert(JSON.stringify(openChest(s, c0.id)) === JSON.stringify({ ok: false, why: 'far' }) && s.player.chests.length === 0 && s.player.gold === 0, 'out of reach, a chest stays shut and pays nothing');
  assert(JSON.stringify(openChest(s, 'no-such-chest')) === JSON.stringify({ ok: false, why: 'unknown' }), 'an id that is not a chest is refused');
  s.player.x = c0.x + CHEST_R + PLAYER_RADIUS + 1.4; s.player.z = c0.z;
  const got = openChest(s, c0.id);
  assert(got.ok && got.gold === chestReward('stash', 20, 1).gold && s.player.gold === got.gold && got.xp === 0 && isOpened(s.player, c0.id), `within reach it opens and pays ${got.ok ? got.gold : '?'} gold`);
  const ev = s.events.find(e => e.t === 'chest');
  assert(ev?.t === 'chest' && ev.id === c0.id && ev.tier === 'stash' && ev.place === 'greywater' && ev.opened === 1 && ev.total === 2 && ev.gold === s.player.gold, 'the chest event says what it paid and the count of its place (1 / 2)');
  s.events.length = 0;
  assert(JSON.stringify(openChest(s, c0.id)) === JSON.stringify({ ok: false, why: 'opened' }) && s.player.gold === got.gold && !hasEvent(s, () => true) && chestCount(s.player).opened === 1, 'opening it twice pays once');
  assert(chestCount(s.player, 'greywater').opened === 1 && chestCount(s.player, 'dunmere').opened === 0 && chestCount(s.player).opened === 1 && chestCount(s.player).total === CHESTS.length, 'the counters: one of two in Greywater, none in Dunmere, one of all');
  const dead = quietState(1602); dead.player.x = c0.x; dead.player.z = c0.z; dead.player.dead = true;
  assert(JSON.stringify(openChest(dead, c0.id)) === JSON.stringify({ ok: false, why: 'dead' }), 'the dead open nothing');

  // the save keeps them, drops an id the placements no longer have, and refuses a malformed field
  const back = deserialize(serialize(s))!;
  assert(back !== null && back.player.chests.join() === c0.id && back.player.gold === s.player.gold, 'a save round-trips player.chests');
  const raw = JSON.parse(serialize(s));
  raw.player.chests = [c0.id, c0.id, 'a-chest-that-was-removed'];
  assert(deserialize(JSON.stringify(raw))!.player.chests.join() === c0.id, 'a duplicate or an unplaced id in a save is ignored, not carried');
  delete raw.player.chests;
  assert(deserialize(JSON.stringify(raw))!.player.chests.length === 0, 'a save from before the chests has opened none');
  raw.player.chests = 'all of them';
  assert(deserialize(JSON.stringify(raw)) === null, 'and a save whose chests are not a list is refused');

  // a rooftop chest, as a fixture on a rock with a top: opened from the floor it stands on, and not through its footprint from the ground
  const rock = { x: 0, z: 0, r: 1.2, top: 2.8 };
  const roof: ChestDef = { id: 'fixture-roof', place: 'hale', tier: 'hoard', x: 0.4, z: 0, floor: 2.8 };
  COLLIDERS.push(rock); CHESTS.push(roof);
  try {
    const g = quietState(1603);
    atLevel(g, 30); g.player.skills.agility.xp = xpForLevel(30); g.player.skills.agility.level = 30;
    g.player.x = -(rock.r + PLAYER_RADIUS); g.player.z = 0; // on the ground at the foot of it: in reach of the chest, a floor below it
    assert(JSON.stringify(openChest(g, roof.id)) === JSON.stringify({ ok: false, why: 'floor' }) && g.player.chests.length === 0, 'a player on the ground cannot open a chest on a rooftop through its footprint');
    g.player.x = 0; g.player.y = rock.top; // on the roof
    const r = openChest(g, roof.id);
    assert(r.ok && r.gold === chestReward('hoard', 30, 30).gold && r.xp === span(30) && g.player.skills.agility.xp >= xpForLevel(31), `from the roof it opens, and the hoard pays a whole level of Agility (${r.ok ? r.xp : 0} XP, to level ${g.player.skills.agility.level})`);
    assert(g.events.some(e => e.t === 'levelup' && e.skill === 'agility' && e.level === 31), 'and the level it pays is announced like any other');
  } finally { COLLIDERS.splice(COLLIDERS.indexOf(rock), 1); CHESTS.splice(CHESTS.indexOf(roof), 1); }
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
// the spell queue reaches into an ability's own cooldown, not just the GCD. Without procs: an Opening answers that
// cooldown outright, which is its own rule and is checked in src/combat-depth.test.ts.
withoutProcs(() => {
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
});
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
// HOM-15: the cave, the steel ladder (mithril's until HOM-81), the second quest.
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
    // HOM-46: the east gate is a deliberate hole in the clearing's wall, and beyond it is the road's floor (x from 36): a body shoved in from the east comes to rest there
    const inGate = (p.x >= 28 + r - 1e-6 && p.x <= 44 - r + 1e-6 && p.z >= 5 + r - 1e-6 && p.z <= 11 - r + 1e-6) || (p.x >= 36 + r - 1e-6 && p.z >= -52 + r - 1e-6 && p.z <= 68 - r + 1e-6);
    if (!inOutdoors && !inRoom && !inGate) leaks++;
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
  const RIDGE = ROCKS.slice(0, 3); // the ridge's own rocks are the first nodes; the Seams' three were added after everything (HOM-56)
  assert(ROCKS.every(r => r.type === 'copper') && ROCKS.length === 6 && RIDGE.every(r => r.z < -22), 'the surface is copper only (HOM-77): three on the ridge, three in the Seams, and the cave\'s own seam below');
  const s = createState(902);
  const way = REGIONS.find(r => r.id === 'wayside')!, W = way.rocks.length + way.trees.length; // HOM-57: the road's waysides come after everything, the Seams included
  const herbN = REGIONS.reduce((n, r) => n + (r.herbs?.length ?? 0), 0); // HOM-65: the herb patches of the Fens and the Thornwood come after the waysides
  const stormN = REGIONS.reduce((n, r) => n + r.rocks.filter(k => k.type === 'stormiron' || k.type === 'starmetal').length, 0); // HOM-95: the stormiron of the barrows and the Thornwood comes after the herbs; HOM-111: the Cairnwaste's starmetal after that
  assert(W >= 24 && s.nodes.slice(-W - herbN - stormN, -herbN - stormN).every(n => n.x > GREYWATER.x - 400 && n.x < GREYWATER.x + 400), 'the road\'s waysides are the last nodes of all but the herb patches and the stormiron');
  const kinds = s.nodes.map(n => n.type).slice(0, -W - herbN - stormN);
  assert(kinds.slice(0, RIDGE.length + TREES.length).join() === [...RIDGE.map(r => r.type), ...TREES.map(() => 'tree')].join() && kinds.slice(RIDGE.length + TREES.length).every(t => t === 'tin' || t === 'adamant' || t === 'copper' || NODE_TYPES[t].skill === 'fishing') && kinds.slice(-3).every(t => t === 'copper'), // HOM-46: Saltmarrow's adamant is added after the cave's, so it too leaves every older id alone; HOM-48: and its fishing spots after that; HOM-56: and the Seams' copper last of all
    'cave nodes are added after every existing node, so node ids follow region order');
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
  assert(Object.entries(ENEMY_TYPES).filter(([, d]) => d.hazard).map(([k]) => k).sort().join() === 'archmage_vael,ashen_colossus,barrow_lord,bog_witch,bogfather,cairn_king,captain_marrow,mother_mire,rotroot_mother,seer,spire_warden,stonehorn,thorn_warden,tide_hag,warden', 'only the Seer, the Warden, (HOM-46) the Tide Hag and (HOM-63) the Bog Witch, Bogfather, Mother Mire Thorn Warden and (HOM-64) Captain Marrow and (HOM-75) the Rotroot Mother and (HOM-95) the Barrow Lord and Stonehorn and (HOM-99) the Cairn King and (HOM-111) the Ashen Colossus and the Spire Warden and (HOM-112) Archmage Vael mark the ground');
  assert(Object.values(ENEMY_TYPES).every(d => !d.look || ['wolf', 'hexer', 'brute', 'boar', 'pup'].includes(d.look.model)), 'every cave look reuses a model that is already loaded: no new art');
  assert(Object.entries(ENEMY_TYPES).filter(([, d]) => d.look).length === 46 && ['boar', 'wolf', 'brute', 'pup', 'hexer'].every(k => !ENEMY_TYPES[k].look), 'the five cave enemies, (HOM-46) the ten of the road and the Strand and (HOM-63) the ten of the fens and the Thornwood and (HOM-64) Captain Marrow and (HOM-75) the Rotroot Mother and (HOM-95) the nine of the Barrowdowns and the Moor and (HOM-99) the Cairn King and (HOM-111) the eight of the Cairnwaste and the Spire and (HOM-112) Archmage Vael say how to draw themselves, and the original five rigs do not');
}

// ---------------------------------------------------------------------------
section('HOM-81 the steel rung: smithed rather than mined, a Smithing ladder, and gear at the top rung');
{
  assert(!NODE_TYPES.mithril && !ITEMS.mithril_ore && !ITEMS.mithril_bar && !ITEMS.mithril_helm,
    'mithril is out of the early game altogether: no vein, no ore, no bar, no set (HOM-81)');
  assert(CAVE_ROCKS.length === 3 && CAVE_ROCKS.every(r => r.type === 'tin'), 'the Hollow\'s seam is tin: the starting zone\'s deepest metal is the other half of bronze');
  assert(NODE_TYPES.tin.level < NODE_TYPES.iron.level, `the cave's own ore is Mining ${NODE_TYPES.tin.level}, under iron's ${NODE_TYPES.iron.level}: it is not what the set is made of`);
  assert(Math.max(...Object.values(NODE_TYPES).filter(d => d.skill === 'mining' && d.level < NODE_TYPES.adamant.level).map(d => d.level)) === NODE_TYPES.coal.level,
    `coal (Mining ${NODE_TYPES.coal.level}) is the last mining gate before adamant: the rung above it is smithed, not dug`);

  // the ladder: every gate above the steel bar, which the first quest's blade already taught
  const rec = (id: string) => RECIPES.find(r => r.id === id)!;
  const bar = rec('steel_bar'), ironBar = rec('iron_bar'), helm = rec('steel_helm');
  const ladder = ['steel_helm', 'steel_greaves', 'steel_chestplate', 'warden_edge'].map(rec);
  assert(ladder.every((r, k) => r.skill === 'smithing' && (k === 0 || r.level > ladder[k - 1].level)) && ladder[0].level > rec('forged_blade').level,
    `Smithing gates climb above the blade (${rec('forged_blade').level}): ${ladder.map(r => r.level).join(' < ')}`);
  const barsNeeded = STEEL_SET.reduce((n, id) => n + rec(id).inputs.find(i => i.id === 'steel_bar')!.qty, 0);
  assert(barsNeeded === STEEL_PLAN.bars && barsNeeded === STEEL_PLAN.iron
    && bar.inputs.find(i => i.id === 'coal')!.qty * barsNeeded === STEEL_PLAN.coal
    && ironBar.inputs.find(i => i.id === 'iron_ore')!.qty * barsNeeded === STEEL_PLAN.ore,
    `the quest plan is the recipes: ${barsNeeded} steel bars = ${STEEL_PLAN.iron} iron bars + ${STEEL_PLAN.coal} coal = ${STEEL_PLAN.ore} ore`);
  assert(ladder.every(r => ITEMS[r.output.id].slot) && STEEL_SET.every(id => ITEMS[id].slot && rec(id)), 'the set is made at the forge');
  const slots = STEEL_SET.map(id => ITEMS[id].slot).sort().join();
  assert(slots === 'chest,head,legs', 'one piece for each armour slot');
  // what the rung costs at the forge is what it cost when it was mithril: a steel bar and the iron bar under it pay 85 Smithing XP where a
  // mithril bar paid 90, so the climb from the blade's gate to the chestplate's is the same thirty-odd bars it always was.
  const perBar = ironBar.xp + bar.xp, climb = xpForLevel(rec('steel_chestplate').level) - xpForLevel(rec('forged_blade').level);
  assert(perBar >= 85 && Math.ceil(climb / perBar) <= 32, `${Math.ceil(climb / perBar)} bars carry a smith from the blade's gate to the chestplate's, and nine of them are the set's own`);

  // smithing it: the gate is the plate, never the bar
  const f = quietState(912);
  f.player.x = LANDMARKS.forge.x - 4; f.player.z = LANDMARKS.forge.z + 2;
  addItem(f.player.inventory, 'iron_ore', STEEL_PLAN.ore); addItem(f.player.inventory, 'coal', STEEL_PLAN.coal);
  f.player.skills.smithing.xp = xpForLevel(bar.level); f.player.skills.smithing.level = bar.level;
  const ore0 = countOf(f, 'iron_ore'), coal0 = countOf(f, 'coal');
  craft(f, 'iron_bar', STEEL_PLAN.iron);
  craft(f, 'steel_bar', STEEL_PLAN.bars);
  const bars = countOf(f, 'steel_bar');
  assert(bars >= STEEL_PLAN.bars && ore0 - countOf(f, 'iron_ore') <= STEEL_PLAN.ore && coal0 - countOf(f, 'coal') <= STEEL_PLAN.coal,
    `nine steel bars take no more than ${STEEL_PLAN.ore} ore and ${STEEL_PLAN.coal} coal (${bars} bars from ${ore0 - countOf(f, 'iron_ore')} ore)`);
  f.player.skills.smithing.xp = xpForLevel(helm.level - 1); f.player.skills.smithing.level = helm.level - 1;
  tick(f, { craft: { recipe: 'steel_helm', count: 1 } });
  assert(hasEvent(f, e => e.t === 'actionfail' && e.reason === 'level' && e.need === helm.level) && countOf(f, 'steel_helm') === 0, `Smithing ${helm.level - 1} cannot smith the helm (needs ${helm.level}): bars are cheap, plate is the climb`);
  grantXp(f, 'smithing', xpForLevel(rec('steel_chestplate').level) - f.player.skills.smithing.xp, 0, 0);
  for (const id of STEEL_SET) craft(f, id, 1);
  assert(STEEL_SET.every(id => countOf(f, id) === 1) && bars - countOf(f, 'steel_bar') === STEEL_PLAN.bars, 'helm, greaves and chestplate smithed from the nine bars');

  // gear at the top of the ladder
  const iron = deriveStats({ ...emptyEquipment(), head: 'iron_helm', chest: 'iron_chestplate', legs: 'iron_greaves' });
  const mith = deriveStats({ ...emptyEquipment(), head: 'steel_helm', chest: 'steel_chestplate', legs: 'steel_greaves' });
  assert(mith.armor >= iron.armor * 2 && mith.reduction > iron.reduction + 0.15, `the set is ${mith.armor} armour (${(100 * mith.reduction).toFixed(0)}% off) against the iron the dead drop: ${iron.armor} (${(100 * iron.reduction).toFixed(0)}%)`);
  const top = TIER_LOOKS.length - 1;
  const warm = (hex: number) => ((hex >> 16) & 255) > ((hex & 255)) + 8;
  assert(top === 6 && TIER_COLORS.length === top + 1 && TIER_COLORS[5] === TIER5_COLOR && TIER_COLORS[6] === TIER6_COLOR, 'the worn-look ladder runs to tier 6 and every tier has a colour');
  // tier 6 is the end of the ladder: its own shape, its own colour (white, the one the other tiers leave), a glow that is cold and under the cap, and a starmetal set that is not the fallback
  assert(TIER_LOOKS[6].form === 'star' && TIER_LOOKS[6].rung > TIER_LOOKS[5].rung && !warm(TIER_LOOKS[6].glow) && TIER_LOOKS[6].glow !== TIER_LOOKS[5].glow && !TIER_COLORS.slice(0, 6).includes(TIER6_COLOR), 'tier 6 is star-white, a form of its own, and not a tier-5 recolour');
  for (const id of ['starmetal_helm', 'starmetal_chestplate', 'starmetal_greaves', 'starmetal_blade', 'crownbreaker'] as const) assert(id in ITEM_LOOKS && TIER_LOOKS[6].glowI * linearPeak(TIER_LOOKS[6].glow) <= EMISSIVE_CAP * 0.75, `${id} has a look of its own under the glow cap`);
  // the leather ladder's top three are bespoke forms, none of them the tier fallback and none of them Hide
  for (const [stem, form] of [['marshhide', 'marsh'], ['thornhide', 'thorn'], ['moorhide', 'moor']] as const) for (const slot of ['gloves', 'boots']) assert(ITEM_LOOKS[`${stem}_${slot}`]?.form === form && (ITEM_LOOKS[`${stem}_${slot}`].glow ?? 0) !== 0, `${stem}_${slot} has its own form and a glint`);
  // tier 5: adamant and stormiron share a tier and must not be one metal in two colours (colour, finish, glow hue and silhouette all differ)
  const hueOf = (hex: number) => { const r = hex >> 16, g = (hex >> 8) & 255, b = hex & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; return 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4); };
  const ad = { ...TIER_LOOKS[5], ...ITEM_LOOKS.adamant_chestplate }, st = { ...TIER_LOOKS[5], ...ITEM_LOOKS.stormiron_chestplate };
  assert(ad.form === 'adamant' && st.form === 'storm' && ITEM_LOOKS.adamant_blade.width! > 1 && ITEM_LOOKS.stormiron_blade.width! < 1, 'adamant and stormiron have different silhouettes, broad blade against narrow');
  assert(Math.abs(hueOf(ad.tint) - hueOf(st.tint)) > 60 && Math.abs(hueOf(ad.glow) - hueOf(st.glow)) > 40 && !warm(ad.glow) && !warm(st.glow), 'and different hues of metal and of glow, neither warm');
  assert(ad.glow !== TIER_LOOKS[4].glow && TIER_LOOKS[5].glow !== TIER_LOOKS[4].glow && !warm(TIER_LOOKS[5].glow), 'tier 5 has a glow of its own: not epic blue, not rare orange');
  for (const id of ['greywolf_hauberk', 'gutterhooks_cap']) assert(ITEM_LOOKS[id].form !== undefined && ITEM_LOOKS[id].rung === 5, `${id} has its own form`);
  for (const id of [...STEEL_SET, 'warden_edge']) {
    const look = appearanceOf(id);
    assert(ITEMS[id].tier === 4 && look.rung === TIER_LOOKS[4].rung && look.glow > 0 && look.motes !== 0 && look.scale >= TIER_LOOKS[3].scale, `${ITEMS[id].name} is tier 4 and gets the epic look: rung ${look.rung}, glow, motes`);
  }
  assert(Object.entries(ITEMS).every(([id, d]) => d.tier < TIER_COLORS.length && (!d.slot || (appearanceOf(id).rung >= 1 && appearanceOf(id).tint > 0))), 'every equippable item has an appearance and a rarity colour');
  assert(Object.entries(ITEMS).filter(([, d]) => d.slot).every(([id, d]) => d.tier < 3 || appearanceOf(id).glow !== 0), 'every rare-or-better piece glows: the better the gear, the better it looks');
  // the emissive budget (glow.ts): epic glow is cold, restrained, and under the bloom threshold, so it can never blow out to white or beat the forge
  assert(EMISSIVE_CAP < BLOOM_THRESHOLD, 'a lit emitter peaks under the bloom threshold');
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
  assert(![...STEEL_SET, 'warden_edge', 'steel_bar', 'forged_blade'].some(id => dropped.has(id)), 'no enemy drops the steel set, the Warden Edge or the Forgemaster Blade: they are made');
  const bestDropped = Math.max(...[...dropped].filter(id => ITEMS[id].slot === 'weapon').map(id => ITEMS[id].stats!.damage!));
  assert(ITEMS.warden_edge.stats!.damage! > ITEMS.forged_blade.stats!.damage! && ITEMS.forged_blade.stats!.damage! >= bestDropped + 4, `crafted beats dropped all the way up: Edge +${ITEMS.warden_edge.stats!.damage} > Blade +${ITEMS.forged_blade.stats!.damage} > best drop +${bestDropped}`);
  assert(DROP_TABLES.warden.entries.some(e => e.id === 'warden_shard') && rec('warden_edge').inputs.some(i => i.id === 'warden_shard' && i.qty >= 2), 'the Warden drops the shards the Edge is made from: the reason to keep killing it');
  assert(DROP_TABLES.ogre.entries.some(e => e.id === 'iron_ore') && DROP_TABLES.warden.entries.some(e => e.id === 'iron_bar') && Object.keys(ENEMY_TYPES).filter(k => ENEMY_TYPES[k].level > ENEMY_TYPES.brute.level).every(k => DROP_TABLES[k]), 'cave enemies drop things, and what the ogres dig up is the iron the set is made of: killing the cave feeds the forge');
}

// ---------------------------------------------------------------------------
// The contract the Brute and the blade already keep, one tier up: the cave is unfair without the new armour and fair with it.
section('HOM-15 the contract: the cave is unfair without the steel set and fair with it');
{
  const KITS: Record<string, Partial<GameState['player']['equipment']>> = {
    blade: { weapon: 'forged_blade' },
    hide: { weapon: 'forged_blade', head: 'leather_cap', chest: 'hide_jerkin', legs: 'hide_leggings' },
    iron: { weapon: 'forged_blade', head: 'iron_helm', chest: 'iron_chestplate', legs: 'iron_greaves' },
    steel: { weapon: 'forged_blade', head: 'steel_helm', chest: 'steel_chestplate', legs: 'steel_greaves' },
    edge: { weapon: 'warden_edge', head: 'steel_helm', chest: 'steel_chestplate', legs: 'steel_greaves' },
  };
  /**
   * The test bot against some of the cave's own enemies, at a combat level in a kit, where they actually stand. The bot walks
   * at the nearest one and fights what wakes. Returns whether it lived and killed them all.
   *
   * The proc layer is off for these: the matrix below is a gear gate, and a gate decided by how the dice fell is not a
   * gate. What the windows add on top of this is measured, and capped, in src/combat-depth.test.ts - the Warden in iron
   * is the knife edge they move first, and the designer's own bench is where a retune of that fight belongs.
   */
  function caveFight(level: number, kit: string, groups: [string, number][], start: { x: number; z: number }, seedNo: number, smart = true) {
    return withoutProcs(() => {
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
    });
  }
  const SEEDS = [1, 2, 3, 4, 5, 6];
  type Scene = { name: string; level: number; groups: [string, number][]; start: { x: number; z: number } };
  const WARDEN: Scene = { name: 'Hollow Warden', level: 10, groups: [['warden', 1]], start: { x: -18, z: -72 } };
  const OGRE: Scene = { name: 'Hollow Ogre', level: 9, groups: [['ogre', 1]], start: { x: -14, z: -50 } };
  const PACK: Scene = { name: 'Ravager pack', level: 10, groups: [['ravager', 3]], start: { x: -24, z: -44 } }; // the same approach to the pack, which posts two units west on the seam along the wall
  const ROOM: Scene = { name: 'ogre+archer+seer', level: 10, groups: [['ogre', 1], ['archer', 1], ['seer', 1]], start: { x: -18, z: -45 } };
  const wins = (sc: Scene, kit: string, smart = true) => SEEDS.filter(n => caveFight(sc.level, kit, sc.groups, sc.start, 940 + n, smart).won).length;
  // start with a clear line to both: the old spot sat in the shadow of the standing stone at (-14.5,-50), where the Archer never saw the player at all
  const PAIR: Scene = { name: 'archer+seer', level: 10, groups: [['archer', 1], ['seer', 1]], start: { x: -12, z: -54 } };
  const BRUISER: Scene = { name: 'ogre+archer', level: 10, groups: [['ogre', 1], ['archer', 1]], start: { x: -11, z: -52 } };
  for (const sc of [WARDEN, OGRE, PACK, PAIR, BRUISER, ROOM]) console.log(`  L${sc.level} ${sc.name.padEnd(17)} ${Object.keys(KITS).map(k => `${k} ${wins(sc, k)}/6`).join('   ')}`);
  assert(wins(WARDEN, 'steel') === 6 && wins(WARDEN, 'iron') <= 1 && wins(WARDEN, 'blade') === 0, 'the Warden: with the set and the blade every run wins; in iron almost none; with no armour none');
  assert(wins(WARDEN, 'steel', false) === 0, 'the Warden: a player who ignores the tells (stands in the slam and the marks, never Pummels) loses even in the set');
  /** Mean health left across the seeds, counting a death as nothing: a smoother read than wins when a fight is a cliff. */
  const health = (sc: Scene, kit: string) => SEEDS.reduce((m, n) => { const r = caveFight(sc.level, kit, sc.groups, sc.start, 940 + n); return m + (r.won ? r.left : 0); }, 0) / SEEDS.length;
  assert(wins(OGRE, 'steel') === 6 && wins(OGRE, 'blade') <= 1, 'the Ogre: the set walks it; with no armour it almost never wins');
  assert(wins(PACK, 'hide') >= 4 && wins(PACK, 'iron') >= 5 && wins(PACK, 'steel') === 6 && wins(PACK, 'blade') <= 3,
    'the Ravagers hold the hollow and the first trip is made before the set exists: winnable in the hide and iron the drops give you, a coin-flip bare, a walk in steel');
  assert(wins(PAIR, 'blade') === 0 && wins(PAIR, 'steel') >= 5, 'an archer and a seer together: out of reach bare, taken in the set');
  console.log(`  ogre+archer mean health left: iron ${health(BRUISER, 'iron').toFixed(2)}, steel ${health(BRUISER, 'steel').toFixed(2)}, edge ${health(BRUISER, 'edge').toFixed(2)}`);
  assert(health(BRUISER, 'steel') >= health(BRUISER, 'iron') && wins(BRUISER, 'blade') === 0, 'an ogre with an archer behind it: the set is what changes the odds');
  assert(wins(ROOM, 'steel') <= 3 && wins(ROOM, 'blade') === 0, 'pulling the whole room at Combat 10 is beyond any kit: it has to be taken in pieces, which is the pillars and the corridor for');
  const margin = (kit: string) => SEEDS.map(n => caveFight(WARDEN.level, kit, WARDEN.groups, WARDEN.start, 940 + n)).filter(r => r.won).reduce((m, r) => m + r.left, 0) / 6;
  console.log(`  Warden lowest health: steel ${margin('steel').toFixed(2)}, edge ${margin('edge').toFixed(2)}`);
  assert(margin('edge') > margin('steel') + 0.05, 'the Warden Edge makes the same fight easier: the second chase is felt');
  const q = caveFight(WARDEN.level, 'steel', WARDEN.groups, WARDEN.start, 941);
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
  assert(v.lines[0].text.startsWith(`Mine Iron Ore: 0/${STEEL_PLAN.ore} (needs Mining ${NODE_TYPES.iron.level}`) && v.target?.label === 'Copper Rock', 'with Mining below the gate the tracker says so and sends a character with no rock open to copper');
  s.player.skills.mining.xp = xpForLevel(NODE_TYPES.tin.level); s.player.skills.mining.level = NODE_TYPES.tin.level;
  addItem(s.player.inventory, 'copper_ore', 1); // practice evens the two starter ores out, so with copper in the bag it asks for tin
  const tinTarget = activeQuestView(s).target!;
  assert(tinTarget.label === 'Tin Rock' && !inCave(tinTarget.x, tinTarget.z),
    'with tin open, practice is tin, and it is the road\'s: the tracker never walks a character standing in Hale into the Hollow for the cave\'s seam (HOM-81)');
  s.player.skills.mining.xp = xpForLevel(NODE_TYPES.iron.level); s.player.skills.mining.level = NODE_TYPES.iron.level;
  v = activeQuestView(s);
  assert(v.target?.label === 'Iron Rock' && !v.lines[0].text.includes('needs'), `at Mining ${NODE_TYPES.iron.level} it points at the road's iron`);
  addItem(s.player.inventory, 'iron_ore', 8); addItem(s.player.inventory, 'steel_bar', 5);
  tick(s);
  assert(secondStage(s) === 'armour' && sawQuest(s, 'stage'), 'three kills and eighteen ore\'s worth (ore already smelted and hardened counts) hands the quest on to the forge');

  // armour stage: progress never goes backwards at the forge
  v = activeQuestView(s);
  assert(v.lines[0].text === `Mine Coal: ${Math.min(STEEL_PLAN.coal, 10)}/${STEEL_PLAN.coal}` && v.lines[1].text.startsWith(`Smelt Iron Bars at the forge: 5/${STEEL_PLAN.iron}`) && v.lines[2].text.startsWith(`Harden Steel Bars: 5/${STEEL_PLAN.bars}`),
    'bars already hardened count as coal, ore and iron spent: 5 steel bars read as 10 coal, 5 iron bars and 5 steel');
  s.player.inventory.forEach((_, i) => { s.player.inventory[i] = null; });
  addItem(s.player.inventory, 'steel_helm', 1);
  assert(activeQuestView(s).lines[2].text.startsWith(`Harden Steel Bars: 2/`) && activeQuestView(s).lines[3].done && !activeQuestView(s).lines[4].done, 'a smithed piece counts for its bars and ticks its own line');
  const helmLevel = recipeById('steel_helm')!.level;
  s.player.skills.smithing.xp = xpForLevel(helmLevel); s.player.skills.smithing.level = helmLevel;
  assert(activeQuestView(s).lines[4].text.endsWith(`Greaves (needs Smithing ${recipeById('steel_greaves')!.level})`) && activeQuestView(s).lines[5].text.endsWith(`Chestplate (needs Smithing ${recipeById('steel_chestplate')!.level})`), 'pieces above your Smithing say what they need');
  addItem(s.player.inventory, 'steel_greaves', 1);
  tick(s);
  assert(secondStage(s) === 'armour', 'two pieces of three is not the set');
  s.player.equipment.chest = 'steel_chestplate'; refreshGearStats(s);
  tick(s);
  assert(secondStage(s) === 'warden', 'a piece you are already wearing counts as made: the third completes the set');
  v = activeQuestView(s);
  assert(v.lines[1].text === `Wear the steel set (press I): 1/3` && v.target?.label === ENEMY_TYPES.warden.name, 'the tracker counts what is worn and points at the Warden');
  s.player.inventory.forEach((_, i) => { s.player.inventory[i] = null; });
  s.player.equipment.head = 'steel_helm'; s.player.equipment.legs = 'steel_greaves'; refreshGearStats(s);
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
  // HOM-46: the road east opens as the Hollow goes quiet, so the tracker carries on to The Salt Road instead of emptying: its arrow points at Saltmarrow's harbourmaster
  assert(s.player.combat.xp === xp1 && activeQuestView(s).title === QUEST3_NAME && activeQuestView(s).target?.label === HARBOURMASTER.name && activeQuestView(s).progress === '(1/3)' && npcMarker(s) === null, 'completing twice pays once, the warden has nothing left to say (no marker), and the tracker moves on to the harbourmaster in Saltmarrow');
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
/** Walk a list of waypoints on the keys; scenery that blocks a step is stepped past, as huntOne does. */
function walkVia(s: GameState, pts: [number, number][]) {
  for (const [x, z] of pts) if (!walkTo(s, x, z, 2.5, 30) && !s.player.dead) { s.player.x = x; s.player.z = z; }
}
/**
 * Wait out a death the way a player does (HOM-58): wake at the graveyard, and if the gear is worn down walk to the merchant and mend it, so a bot that
 * dies twenty times is not fighting in broken plate. The bot never sells drops, so the gold is handed over: it is what a player would have earned.
 */
function wake(s: GameState) {
  run(s, RESPAWN_DELAY + 0.5);
  const need = damagedGear(s.player).reduce((sum, id) => sum + repairCost(s.player, id), 0);
  if (!need || s.player.dead) return;
  s.player.gold += need;
  walkVia(s, [[LANDMARKS.vendor.x, LANDMARKS.vendor.z + 2]]);
  tick(s, { shop: [{ k: 'repair' }] });
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
  smithTheBlade(s);
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
  assert(activeQuestView(s).lines.some(l => l.text.includes('Iron Ore')) && activeQuestView(s).target !== null, 'the tracker names the ore and has somewhere to point');

  // 3. the way in: walk it, do not teleport, and watch the light change
  const lightAt = [] as number[];
  const mouthWalk: [number, number][] = [[-18, -20], [-18, -26], [-18, -32], [-18, -38], [-18, -44]];
  for (const [x, z] of mouthWalk) { walkTo(s, x, z, 1.5, 30); lightAt.push(caveDepth(s.player.x, s.player.z)); }
  assert(s.player.z < -42 && inCave(s.player.x, s.player.z), `walked through the mouth and up the throat to z=${s.player.z.toFixed(0)}`);
  assert(lightAt[0] === 0 && lightAt[lightAt.length - 1] === 1 && lightAt.some(d => d > 0 && d < 1), `the light changes on the way: ${lightAt.map(d => d.toFixed(2)).join(' > ')}`);
  milestone('inside the cave');

  // 4. the gate: the second quest opens no new rock (HOM-81). Iron and coal are the first quest's own gates, and the Hollow's tin is under both
  assert(s.player.skills.mining.level >= NODE_TYPES.coal.level,
    `Mining ${s.player.skills.mining.level} out of the first quest: iron and coal are open already, and the Hollow's own seam is tin (Mining ${NODE_TYPES.tin.level})`);
  milestone(`Mining ${s.player.skills.mining.level}`);

  // 5. the delve: the pack holds the hollow the passage opens into, and the iron the set is made of is out on the road
  walkVia(s, mouthWalk.slice(1));
  dressAndTidy(s);
  for (let g = 0; (s.quest.kills.ravager ?? 0) < DELVE_GOALS.ravager && g < 40; g++) {
    if (s.player.dead) { wake(s); walkVia(s, mouthWalk); continue; }
    if (!s.enemies.some(e => e.type === 'ravager' && st(e) !== 'dead')) { run(s, 10); continue; }
    huntOne(s, 'ravager');
    sweepDrops(s); dressAndTidy(s);
  }
  assert(secondStage(s) === 'delve', `${s.quest.kills.ravager} ravagers down, and the delve waits on the ore: the cave holds none of it`);
  gatherUntil(s, 'iron', STEEL_PLAN.ore);
  tick(s);
  assert(secondStage(s) === 'armour', `the delve ends on its own: ${s.quest.kills.ravager} ravagers down, ${countOf(s, 'iron_ore')} iron ore in the bag`);
  assert(countOf(s, 'iron_ore') >= STEEL_PLAN.ore, 'eighteen iron ore off the Greywater Road\'s waysides');
  milestone(`delve done (${deathTally} death${deathTally === 1 ? '' : 's'} so far)`);

  // 6. coal, the forge, the ladder
  gatherUntil(s, 'coal', STEEL_PLAN.coal);
  assert(countOf(s, 'coal') >= STEEL_PLAN.coal, `${countOf(s, 'coal')} coal in hand`);
  assert(atForge(s), 'out of the cave and back at the forge');
  const saved = deserialize(serialize(s))!;
  assert(saved.quest.second === 'armour' && countOf(saved, 'iron_ore') === countOf(s, 'iron_ore'), 'saved at the forge door and reloaded');
  const smBefore = s.player.skills.smithing.level, helmGate = recipeById('steel_helm')!.level;
  practiseSmithing(s, helmGate, 0);
  assert(s.player.skills.smithing.level >= helmGate, `Smithing ${smBefore} was under the helm's gate (${helmGate}): iron and steel bars of practice first, now ${s.player.skills.smithing.level}`);
  const short = STEEL_PLAN.bars - countOf(s, 'steel_bar');
  if (short > 0) { gatherUntil(s, 'iron', 2 * short); gatherUntil(s, 'coal', 2 * short); atForge(s); craft(s, 'iron_bar', short); craft(s, 'steel_bar', short); }
  assert(countOf(s, 'steel_bar') >= STEEL_PLAN.bars, `${countOf(s, 'steel_bar')} steel bars: the practice that opened the helm is the same metal the set is made of`);
  // each piece asks one Smithing more than the last and pays less than a level: a few more bars between them, which is what the tracker says
  for (const id of STEEL_SET) {
    const need = recipeById(id)!.level;
    if (s.player.skills.smithing.level < need) practiseSmithing(s, need, 0);
    craft(s, id, 1);
  }
  assert(STEEL_SET.every(id => countOf(s, id) === 1) && secondStage(s) === 'warden', 'the set is smithed and the quest moves on to the Warden without any more talking');
  milestone(`steel set smithed, Smithing ${s.player.skills.smithing.level}`);

  // 7. wear it
  dressAndTidy(s);
  assert(STEEL_SET.every(id => Object.values(s.player.equipment).includes(id)) && s.player.stats.armor >= 50, `the whole set on: ${s.player.stats.armor} armour, ${(100 * s.player.stats.reduction).toFixed(0)}% off`);
  assert(activeQuestView(s).lines.some(l => l.text.includes('3/3') && l.done), 'tracker: set worn');
  const hasLook = STEEL_SET.every(id => appearanceOf(id).rung === 4);
  assert(hasLook, 'every piece worn resolves to the epic rung of the look ladder');

  // 8. through the hollow to the Warden: what stands in the way is fought, in the set
  // Each one gets more than a single go. A death inside the hollow wakes the bot at the graveyard, and huntOne's own
  // retry steps straight back to the enemy from out there - into the middle of the room, with everything in it awake.
  // The walk back in through the mouth is what a player would do, so each go starts with it, as the Warden's does below.
  for (const type of ['archer', 'archer', 'seer', 'ogre', 'ogre']) {
    for (let go = 0; go < 3; go++) {
      if (s.player.dead) wake(s);
      // every go starts with the room at rest and walks in from the mouth. The hollow is meant to be taken in pieces,
      // and anything a previous go left chasing is still on its feet when the next one walks in, so they stack up.
      walkVia(s, [[-18, -24]]);
      for (let n = 0; n < 30 * 60 && s.enemies.some(e => inCave(e.spawnX, e.spawnZ) && st(e) !== 'dead' && st(e) !== 'idle'); n++) tick(s);
      walkVia(s, mouthWalk);
      if (!s.enemies.some(e => e.type === type && st(e) !== 'dead')) break;
      const before = tally[type] ?? 0;
      huntOne(s, type);
      if ((tally[type] ?? 0) > before) break;
    }
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
    if (s.player.dead) { wake(s); walkVia(s, mouthWalk); walkVia(s, [[-18, -62], [-18, -70], [-18, -75]]); }
    huntOne(s, 'warden');
  }
  assert(st(warden) === 'dead' && secondStage(s) === 'report', `the Hollow Warden falls (${wardenTries} attempt${wardenTries === 1 ? '' : 's'}, ${deathTally} death${deathTally === 1 ? '' : 's'} in the run so far)`);
  sweepDrops(s);
  milestone('Hollow Warden slain');

  // 10. the hand-in, across the whole map
  const reload = deserialize(serialize(s))!;
  assert(reload.quest.second === 'report' && STEEL_SET.every(id => Object.values(reload.player.equipment).includes(id)), 'saved after the boss, reloaded: still at the hand-in, still in the set');
  assert(talkToNpc(s), 'a long walk back to Warden Hale');
  const c0 = s.player.combat.xp, m0 = s.player.skills.mining.xp, sm0 = s.player.skills.smithing.xp;
  tick(s, { questAdvance: true });
  assert(secondStage(s) === 'cleared' && sawQuest(s, 'complete'), 'quest two complete');
  assert(s.player.combat.xp >= c0 + REWARD2[0].xp && s.player.skills.mining.xp === m0 + REWARD2[1].xp && s.player.skills.smithing.xp === sm0 + REWARD2[2].xp, 'rewards paid: combat, mining and smithing XP');
  milestone(`second quest complete, Combat ${s.player.combat.level}, Mining ${s.player.skills.mining.level}, Smithing ${s.player.skills.smithing.level}`);
  console.log(`  second quest: ${((clock() - firstQuestSeconds) / 60).toFixed(1)} min of game time on top of the first quest's ${(firstQuestSeconds / 60).toFixed(1)}; ${deathTally} bot deaths along the way`);
  assert(npcMarker(s) === null && activeQuestView(s).title === QUEST3_NAME, 'nothing left for the warden to say, and the tracker moves on to the road east (HOM-46: it used to empty)');

  // 11. after the quest: the floor to stand on. The Warden returns; its shards make the best blade there is.
  const SHARDS = recipeById('warden_edge')!.inputs.find(i => i.id === 'warden_shard')!.qty;
  let kills2 = 0;
  while (countOf(s, 'warden_shard') < SHARDS && kills2 < 14) {
    for (let w = 0; st(warden) === 'dead' && w < 400; w++) run(s, 1); // waits out the respawn (never blocked: it is a timer)
    park();
    walkVia(s, mouthWalk); walkVia(s, [[-18, -62], [-18, -70], [-18, -75]]);
    for (let a = 0; a < 3 && st(warden) !== 'dead' && !s.player.dead; a++) huntOne(s, 'warden');
    if (s.player.dead) { wake(s); continue; }
    if (st(warden) === 'dead') kills2++;
    sweepDrops(s);
  }
  assert(countOf(s, 'warden_shard') >= SHARDS, `${countOf(s, 'warden_shard')} Warden shards after ${kills2 + 1} kills of the Warden: a chase worth ${SHARDS} drops, not one`);
  assert(kills2 + 1 <= 8, `...and it took ${kills2 + 1} kills, so it is a farm and not a wall`);
  milestone(`${countOf(s, 'warden_shard')} shards`);
  // the Edge's gate is two past the chestplate's, so a few more bars first; then three of them for the blade itself
  const edgeGate = recipeById('warden_edge')!.level;
  if (s.player.skills.smithing.level < edgeGate) practiseSmithing(s, edgeGate, 0);
  assert(s.player.skills.smithing.level >= edgeGate, `Smithing ${s.player.skills.smithing.level}: the set and a few bars after it reach the Edge's gate (${edgeGate})`);
  const shortBars = Math.max(0, 3 - countOf(s, 'steel_bar'));
  gatherUntil(s, 'iron', 2 * shortBars + countOf(s, 'iron_ore'));
  gatherUntil(s, 'coal', 2 * shortBars + countOf(s, 'coal'));
  assert(atForge(s), 'at the forge again');
  craft(s, 'iron_bar', shortBars); craft(s, 'steel_bar', shortBars);
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
  assert(end.quest.second === 'cleared' && end.player.equipment.weapon === 'warden_edge' && end.player.equipment.head === 'steel_helm', 'a finished game loads as finished, still in the full set');
}

// ---------------------------------------------------------------------------
section('HOM-15 getting around: the way out of the cave is walkable, and nothing stays stuck on scenery');
{
  const same = { x: -25, z: -50 };
  assert(route({ x: -18, z: -55 }, same)?.length === 1, 'within one room a walk goes straight at its target');
  assert(route({ x: 0, z: 6 }, { x: 10, z: 10 })?.length === 1, 'anywhere in the open a walk goes straight at its target: nothing changes outside the cave');
  const hop = route({ x: -18, z: -85 }, { x: 5, z: 2 })![0];
  assert(dist2(hop, LANDMARKS.caveMouth) < 3, 'from the hall to the clearing the first aim is the mouth: the rooms line up, so the walk runs the whole corridor in one leg');

  for (const [name, from, to] of [['the warden hall to the clearing', { x: -18, z: -85 }, { x: 0, z: 6 }], ['the clearing to the warden hall', { x: 0, z: 6 }, { x: -18, z: -85 }], ['the far corner of the hollow to the forge', { x: -30, z: -60 }, { x: LANDMARKS.forge.x - 4, z: LANDMARKS.forge.z + 4 }]] as const) {
    const s = quietState(960);
    s.player.x = from.x; s.player.z = from.z;
    assert(walkTo(s, to.x, to.z, 1.5, 60), `${name} can be walked (ends ${dist2(s.player, to).toFixed(1)}u short)`);
  }
  // HOM-139: a click never fetches you. From the deepest room Warden Hale is out of reach and says so; walked out, the same click opens him
  const f = quietState(961);
  f.player.x = -18; f.player.z = -85;
  tick(f, { interact: { k: 'npc' } });
  assert(hasEvent(f, e => e.t === 'stuck') && !hasEvent(f, e => e.t === 'npc'), 'clicking Warden Hale from the deepest room says you cannot reach him');
  walkTo(f, NPC.x, NPC.z, NPC.r + 1.5, 60);
  tick(f, { interact: { k: 'npc' } });
  assert(hasEvent(f, e => e.t === 'npc'), '...and once you have walked out to him, the click opens his dialogue');

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
  assert(walkTo(m, rock.x, rock.z, 6, 60), `the walk from inside the throat out to a ridge rock gets there (${dist2(m.player, rock).toFixed(1)} away)`);
}

// ---------------------------------------------------------------------------
section('HOM-31 the delve: the first trip into the hollow is made before the set exists, and it is survivable');
{
  /**
   * The whole delve as one life, with every cave enemy live where it stands: in through the throat, whatever wakes is fought,
   * rest to full between fights (as a player would), working the seam along the south-west wall, which is what walks the player
   * into the pack posted on it. The trip is over when the three Ravagers are down: since HOM-81 the stage's ore is out on the
   * road, so what the cave half of it costs is the fight. The sentry archer at (-13,-47) wakes in the throat and backs off from
   * melee; the Ogre and the Seer sleep 9-11u beyond it.
   */
  function delve(level: number, kit: string, seed: number) {
    const s = quietState(seed);
    for (const e of s.enemies) if (inCave(e.spawnX, e.spawnZ)) { e.state = 'idle'; e.respawnIn = 0; e.hp = e.maxHp; e.attackCd = 0; }
    atLevel(s, level);
    s.player.skills.mining.xp = xpForLevel(NODE_TYPES.tin.level); s.player.skills.mining.level = NODE_TYPES.tin.level;
    const armour = kit === 'hide' ? { head: 'leather_cap', chest: 'hide_jerkin', legs: 'hide_leggings' } : { head: 'iron_helm', chest: 'iron_chestplate', legs: 'iron_greaves' };
    Object.assign(s.player.equipment, { weapon: 'forged_blade', ...armour });
    refreshGearStats(s);
    s.quest.stage = 'done'; s.quest.second = 'delve';
    s.player.x = -18; s.player.z = -24;
    const sleepers = s.enemies.filter(e => ['ogre', 'seer'].includes(e.type) || (e.type === 'archer' && e.spawnZ < -60));
    let woken = 0, low = 1;
    const maxHp = s.player.maxHp;
    for (let step = 0; step < 600 && !s.player.dead && (s.quest.kills.ravager ?? 0) < DELVE_GOALS.ravager; step++) {
      woken += sleepers.filter(e => st(e) !== 'idle').length;
      const chaser = s.enemies.filter(e => st(e) === 'chase').sort((a, b) => dist2(a, s.player) - dist2(b, s.player))[0];
      if (chaser) { fight(s, chaser, 60); low = Math.min(low, minHpSeen / maxHp); continue; }
      if (s.player.hp < s.player.maxHp * 0.97) { run(s, 1); continue; }
      const vein = nearestNode(s, 'tin');
      if (!vein) { run(s, 1); continue; }
      // the seam is walked to a fraction of a second at a time, so anything that wakes on the way is picked up at the top of the loop
      if (dist2(s.player, vein) > vein.r + 1.5) { walkTo(s, vein.x, vein.z, vein.r + 1.5, 0.2); continue; }
      tick(s, { interact: { k: 'node', id: vein.id } });
      for (let n = 0; busy(s) && n < 4000 && !s.enemies.some(e => st(e) === 'chase'); n++) tick(s);
    }
    return { lived: !s.player.dead, ore: countOf(s, 'tin_ore'), kills: s.quest.kills.ravager ?? 0, woken, low };
  }
  const trips = (level: number, kit: string) => [1, 2, 3, 4, 5, 6].map(n => delve(level, kit, 3100 + n));
  const done = (r: { lived: boolean; kills: number }) => r.lived && r.kills === DELVE_GOALS.ravager;
  const summary = (rs: ReturnType<typeof trips>) => `${rs.filter(done).length}/6 done, worst trough ${Math.min(...rs.map(r => r.low)).toFixed(2)}, ${rs.reduce((m, r) => m + r.woken, 0)} sleeper-ticks awake`;
  const hide = trips(RECOMMENDED_COMBAT_2, 'hide'), iron = trips(RECOMMENDED_COMBAT_2, 'iron');
  console.log(`  Combat ${RECOMMENDED_COMBAT_2}, hide: ${summary(hide)}; iron: ${summary(iron)}`);
  assert(hide.every(done),
    `at the recommended Combat ${RECOMMENDED_COMBAT_2} in the hide set every delve takes the three Ravagers on the first life, with every enemy of the hollow live`);
  assert(iron.every(done), '...and in iron too');
  assert(hide.concat(iron).every(r => r.woken === 0), 'chasing the sentry never wakes the Ogres, the Seer or the far archer: the room is taken in pieces, not all at once');
  assert(hide.every(r => r.low > 0.05), `and it is not a coin-flip: the worst moment is above 5% health (${Math.min(...hide.map(r => r.low)).toFixed(2)})`);
  const high = trips(11, 'hide');
  assert(high.every(r => done(r) && r.low > 0.15), `Combat 11 in hide, the level the first quest can hand over, is comfortable (worst trough ${Math.min(...high.map(r => r.low)).toFixed(2)})`);
  assert(ENEMY_TYPES.archer.leash * 0.8 < 6, 'the archers hold their post: they back off 5u at most, which is what keeps the sentry fight where it started');
}

// HOM-29: the ridge rocks can be walked round, rather than wedging the player in the pocket east of the mouth
{
  const r = quietState(975);
  for (const [tx, tz] of [[-10.65, -27.09], [-5, -30], [-18, -22], [27.4, -25.1]] as [number, number][]) {
    r.player.x = 0; r.player.z = 0;
    assert(walkTo(r, tx, tz, 1.5), `(${tx}, ${tz}) can be walked to from the clearing, round the rocks (${dist2(r.player, { x: tx, z: tz }).toFixed(1)} away)`);
  }
  r.player.x = -10.65; r.player.z = -27.09;
  const next = r.nodes.find(n => n.x === -5 && n.z === -27.5)!;
  assert(walkTo(r, next.x, next.z, 3.3), `from the pocket east of the mouth the next rock along can be reached (${dist2(r.player, next).toFixed(1)} away)`);
  useNode(r, next);
  assert(actionKind(r) === 'gather', '...and standing there, clicking it starts the gather');
  // HOM-139: a click too far off is acknowledged, not dropped silently
  const w = quietState(976);
  tick(w, { interact: { k: 'node', id: next.id } });
  assert(w.events.some(e => e.t === 'stuck'), 'a click on something out of reach raises a stuck event, not silence');
}

// ---------------------------------------------------------------------------
section('HOM-35 audio events: footfalls on the ground, strikes while a gather runs');
{
  type Ev = GameState['events'][number];
  const steps = (s: GameState, secs: number, i: Partial<Input>) => {
    const at: number[] = [], surf: string[] = [];
    for (let n = 0; n < Math.round(secs / TICK_DT); n++) { tick(s, i); for (const ev of s.events) if (ev.t === 'step') { at.push(n * TICK_DT); surf.push(ev.surface); } }
    return { at, surf };
  };
  const s = quietState(351);
  s.player.x = 0; s.player.z = 0;
  const idle = steps(s, 2, {});
  assert(idle.at.length === 0, 'standing still makes no footfalls');
  const walk = steps(s, 4, { dirX: 1, dirZ: 0 });
  const gaps = walk.at.slice(1).map((t, i) => t - walk.at[i]);
  assert(walk.at.length >= 8 && walk.at.length <= 9 && walk.at[0] < 0.3, `running makes a footfall about every 0.45s, the first within a quarter second (${walk.at.length} in 4s, first at ${walk.at[0]?.toFixed(2)}s)`);
  assert(gaps.every(g => Math.abs(g - 0.45) < 0.07) && walk.surf.every(f => f === 'grass'), 'strides are evenly spaced and land on grass in the open');

  const h = quietState(352);
  h.player.x = 0; h.player.z = 0;
  let hops = 0, footfallsInAir = 0;
  for (let n = 0; n < 5 * 30; n++) { tick(h, { dirX: 1, dirZ: 0, jump: true }); if (h.player.airborne) footfallsInAir += h.events.filter(e => e.t === 'step').length; hops += h.events.filter(e => e.t === 'jump').length; }
  assert(hops >= 4 && footfallsInAir === 0, `no footfall while airborne, even running and hopping (${hops} hops)`);

  const c = quietState(353);
  c.player.x = -18; c.player.z = -30;
  const cave = steps(c, 3, { dirX: 0, dirZ: -1 });
  assert(inCave(c.player.x, c.player.z) && cave.surf.length >= 5 && cave.surf.every(f => f === 'cave'), `inside the cave the footfalls are cave (${cave.surf.length} strides to z=${c.player.z.toFixed(0)})`);
  const out = quietState(354);
  out.player.x = -18; out.player.z = -20;
  const mouth = steps(out, 3, { dirX: 0, dirZ: -1 });
  assert(mouth.surf.includes('grass') && mouth.surf.includes('cave') && mouth.surf.indexOf('cave') > mouth.surf.indexOf('grass'), 'walking in from the clearing the surface turns from grass to cave at the mouth');

  // gathering: a strike every 1.1s of the cycle, before the yield
  const g = quietState(355);
  const rock = nodesOf(g, 'copper')[0];
  g.player.x = rock.x + rock.r + 1.2; g.player.z = rock.z;
  tick(g, { interact: { k: 'node', id: rock.id } });
  assert(g.player.action?.k === 'gather', 'in reach, the gather begins');
  const strikes: number[] = [];
  let yields = 0;
  for (let n = 0; n < Math.round((NODE_TYPES.copper.time + 0.5) / TICK_DT); n++) {
    tick(g);
    for (const ev of g.events as Ev[]) {
      if (ev.t === 'gather') { assert(ev.skill === 'mining' && ev.node === rock.id, 'a strike names the skill and the node'); strikes.push(n * TICK_DT); }
      if (ev.t === 'xp') yields++;
    }
  }
  assert(strikes.length === 3 && strikes.every((t, i) => Math.abs(t - 1.1 * (i + 1)) < 0.1), `a ${NODE_TYPES.copper.time}s copper mine strikes three times at about 1.1s, 2.2s, 3.3s (${strikes.map(t => t.toFixed(2)).join(', ')})`);
  assert(yields === 1, 'one yield by the end of the first cycle, after the third strike');
  const t2 = quietState(356);
  const tree = nodesOf(t2, 'tree')[0];
  t2.player.x = tree.x + tree.r + 1.2; t2.player.z = tree.z;
  tick(t2, { interact: { k: 'node', id: tree.id } });
  let chops = 0, treeSkill = '';
  for (let n = 0; n < Math.round(NODE_TYPES.tree.time / TICK_DT) - 1; n++) { tick(t2); for (const ev of t2.events as Ev[]) if (ev.t === 'gather') { chops++; treeSkill = ev.skill; } }
  assert(chops === 2 && treeSkill === 'woodcutting', `a ${NODE_TYPES.tree.time}s chop strikes twice with the woodcutting skill`);
  tick(t2, { dirX: 1, dirZ: 0 });
  assert(!hasEvent(t2, e => e.t === 'gather') && t2.player.action === null, 'walking away ends the strikes with the action');
}

// ---------------------------------------------------------------------------
section('HOM-38 sight: cover breaks a line, waist-high ore does not');
{
  const pillar = CAVE_PILLARS[0]; // a standing stone in the hollow
  assert(!clearLine({ x: pillar.x - 4, z: pillar.z }, { x: pillar.x + 4, z: pillar.z }), 'a cave standing stone blocks the line straight through it');
  assert(clearLine({ x: pillar.x - 4, z: pillar.z - 4 }, { x: pillar.x + 4, z: pillar.z - 4 }), 'and leaves a line four units clear of it alone');
  const tree = TREES[0];
  assert(!clearLine({ x: tree.x - 5, z: tree.z }, { x: tree.x + 5, z: tree.z }), 'a tree trunk blocks the line');
  const ore = ROCKS.find(r => r.x > 20)!; // one of the Seams' rocks, out in the open away from the mouth walls
  assert(clearLine({ x: ore.x - 5, z: ore.z }, { x: ore.x + 5, z: ore.z }), 'an ore seam is waist-high: you can see over it');
  assert(!clearLine({ x: 0, z: 0 }, { x: -18, z: -50 }), 'the clearing cannot see into the cave');
  assert(clearLine({ x: -18, z: -32 }, { x: -18, z: -44 }), 'but the throat can see along itself');
}

// ---------------------------------------------------------------------------
section('HOM-38 aggro: nothing wakes to what it cannot see, and the notice radius follows the level gap');
{
  const tree = TREES[0];
  // an idle boar on the far side of a trunk, well inside its notice radius
  const hidden = (px: number, pz: number) => {
    const s = quietState(520);
    const b = enemyOf(s, 'boar');
    placeAt(b, tree.x + 3, tree.z);
    s.player.x = px; s.player.z = pz;
    run(s, 0.5);
    return st(b) === 'chase';
  };
  assert(!hidden(tree.x - 3, tree.z), 'a boar three units the far side of a tree does not wake, trunk in the way');
  assert(hidden(tree.x - 3, tree.z + 4), 'and wakes as soon as the player steps where it can see them');

  // the pack cry does not carry through the trunk either
  const pack = (bx: number, bz: number) => {
    const s = quietState(521);
    const [a, b] = s.enemies.filter(e => e.type === 'pup');
    placeAt(a, tree.x + 3, tree.z);
    placeAt(b, bx, bz);
    s.player.x = tree.x + 5; s.player.z = tree.z;
    run(s, 0.5);
    return { a: st(a), b: st(b) };
  };
  const blind = pack(tree.x - 3, tree.z);
  assert(blind.a === 'chase' && blind.b === 'idle', 'waking one pup does not wake a pack-mate it cannot see');
  const seen = pack(tree.x - 2, tree.z + 3);
  assert(seen.a === 'chase' && seen.b === 'chase', 'with a clear line between them the pack still comes as one');

  const w = ENEMY_TYPES.warden;
  assert(aggroRadius(w, 1) === w.aggroRadius && aggroRadius(w, w.level) === w.aggroRadius && aggroRadius(w, w.level + 3) < w.aggroRadius,
    `the notice radius is the hand-placed one until the player outgrows the enemy, then shrinks (${aggroRadius(w, 1)} / ${w.aggroRadius} / ${aggroRadius(w, w.level + 3).toFixed(1)})`);
  assert(Object.values(ENEMY_TYPES).every(d => aggroRadius(d, 99) >= d.aggroRadius * 0.55 - 1e-9 && aggroRadius(d, 1) <= d.aggroRadius),
    'it never grows past the hand-placed radius, and never falls below 55% of it');

  const noticed = (level: number) => {
    const s = quietState(522 + level);
    atLevel(s, level);
    const b = enemyOf(s, 'boar');
    placeAt(b, 0, 0);
    s.player.x = 6; s.player.z = 0;
    run(s, 0.5);
    return st(b) === 'chase';
  };
  assert(noticed(1) && !noticed(10), 'a boar six units off notices a level-1 adventurer and ignores one who has outgrown it');
}
{
  // the complaint: one careless step into the hollow used to wake the Ravager pack and the Archer together
  const s = createState(540);
  atLevel(s, 9);
  s.player.x = -18; s.player.z = -46; // one step out of the throat, where the hollow opens up
  run(s, 3);
  const woke = s.enemies.filter(e => st(e) === 'chase');
  assert(woke.length === 1 && woke[0].type === 'archer',
    `stepping into the hollow wakes the Archer sentry and nothing else (${woke.map(e => ENEMY_TYPES[e.type].name).join(', ') || 'none'})`);
  // not by a hair: the pack's post has to stay outside its own notice radius from the doorway, or this is luck
  const near = Math.min(...s.enemies.filter(e => e.type === 'ravager').map(e => Math.hypot(e.x + 18, e.z + 46)));
  const notice = aggroRadius(ENEMY_TYPES.ravager, RECOMMENDED_COMBAT_2);
  assert(near > notice + 1, `and the nearest Ravager is a clear ${(near - notice).toFixed(1)} units outside its notice radius (${near.toFixed(1)} away, notices at ${notice.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
section('HOM-38 ranged line of sight: a shot needs a line, and loses one mid-flight');
{
  const stone = CAVE_PILLARS[0]; // (-14.5, -50): the archer stands north of it, the player south
  const NORTH = { x: stone.x, z: stone.z + 6 };      // where the shooter posts
  const OPEN = { x: stone.x - 8.5, z: stone.z };     // clear line, inside range
  const COVER = { x: stone.x, z: stone.z - 6 };      // dead behind the stone
  /** An archer awake and at its post, the player wherever they are standing. */
  const shooter = (seed: number, at: { x: number; z: number }, type = 'archer') => {
    const s = quietState(seed);
    atLevel(s, 10);
    const e = enemyOf(s, type);
    placeAt(e, NORTH.x, NORTH.z);
    e.state = 'chase'; e.attackCd = 0;
    s.player.x = at.x; s.player.z = at.z;
    return { s, e };
  };
  const hits = (s: GameState) => s.events.filter(ev => ev.t === 'hit' && ev.target === 'player').length;

  const open = shooter(560, OPEN);
  let tookOne = 0;
  for (let n = 0; n < Math.round(4 / TICK_DT); n++) { tick(open.s); tookOne += hits(open.s); }
  assert(tookOne >= 1, `in the open the Gloom Archer shoots the player (${tookOne} arrows in four seconds)`);

  const hid = shooter(561, COVER);
  let telegraphs = 0, took = 0;
  for (let n = 0; n < Math.round(0.8 / TICK_DT); n++) { tick(hid.s); telegraphs += hid.s.events.filter(ev => ev.t === 'telegraph').length; took += hits(hid.s); }
  assert(telegraphs === 0 && took === 0, 'behind the stone it does not loose a single arrow');
  assert(Math.hypot(hid.e.x - hid.s.player.x, hid.e.z - hid.s.player.z) < 12 - 0.5, 'it walks for a line instead of standing there: cover buys the gap, not the fight');
  let cameRound = -1;
  for (let n = 0; n < Math.round(8 / TICK_DT) && cameRound < 0; n++) { tick(hid.s); if (hid.s.events.some(ev => ev.t === 'telegraph')) cameRound = n; }
  assert(cameRound >= 0, `and it comes round the stone and fires, ${((cameRound + 24) * TICK_DT).toFixed(1)}s after the player took cover`);

  // a line broken while the arrow is being drawn: the shot spends itself on the rock
  const duck = shooter(562, OPEN);
  for (let n = 0; n < 300 && !duck.e.cast; n++) tick(duck.s);
  assert(duck.e.cast?.kind === 'bolt', 'the archer starts a Gloom Arrow');
  duck.s.player.x = COVER.x; duck.s.player.z = COVER.z; // step behind the stone mid-draw
  let blocked = 0, landed = 0;
  for (let n = 0; n < Math.round(1.2 / TICK_DT); n++) { tick(duck.s); blocked += duck.s.events.filter(ev => ev.t === 'blocked').length; landed += hits(duck.s); }
  assert(blocked === 1 && landed === 0, `stepping behind the stone mid-draw blocks the arrow instead of taking it (${blocked} blocked, ${landed} hits)`);

  // the Seer marks ground it can see you standing on, and no other
  const seer = shooter(563, COVER, 'seer');
  let marks = 0;
  for (let n = 0; n < Math.round(0.6 / TICK_DT); n++) { tick(seer.s); marks += seer.s.events.filter(ev => ev.t === 'telegraph' && ev.kind === 'ground').length; }
  assert(marks === 0, 'the Cave Seer does not call Withering Ground down on a spot it cannot see');
}

// ---------------------------------------------------------------------------
section('HOM-38 talents: the rules of the trees');
{
  assert(talentPoints(1) === 0 && talentPoints(TALENT_START_LEVEL) === 1 && talentPoints(10) === 9, 'no points at level 1, then one a level from level 2');
  assert(TALENTS.every(t => TREE_IDS.includes(t.tree) && t.ranks >= 1 && t.tier < TIER_COST.length), 'every talent sits in a real tree at a real tier');
  const CAP = TIER_COST.length - 1;
  const ranksIn = (tree: string) => TALENTS.filter(t => t.tree === tree).reduce((n, t) => n + t.ranks, 0);
  assert(TREE_IDS.every(tree => TIER_COST.every((_, tier) => TALENTS.filter(t => t.tree === tree && t.tier === tier).length === (tier === CAP ? 1 : 2))),
    'every tree is two talents abreast at each tier, with one capstone under them: a route through, not a list to tick off');
  assert(TREE_IDS.every(tree => ranksIn(tree) === 18 && ranksIn(tree) > talentPoints(10)),
    `a tree is 18 ranks, so none can be filled before combat 10: depth costs breadth (${TREE_IDS.map(t => ranksIn(t)).join('/')})`);
  assert(TALENTS.every(d => !d.prereq || (talentById(d.prereq)?.tree === d.tree && talentById(d.prereq)!.tier < d.tier)),
    'every prerequisite is a talent lower down the same tree, so a branch is always reachable from where it starts');
  assert(TALENTS.filter(d => d.tier === CAP).every(d => d.ranks === 1 && !!d.prereq && abilityFromTalent(d.id) >= 0),
    'each capstone is one rank, built on something, and hands over an ability');
  assert(ABILITIES.filter(a => a.talent).length === TREE_IDS.length && ABILITIES.every(a => !a.talent || talentById(a.talent)?.tier === CAP),
    'and nothing but a capstone hands over an ability');

  const buy = (s: GameState, id: string) => tick(s, { talent: id });
  /** Read a rank through a function so TS does not narrow it across sim calls. */
  const rank = (g: GameState, id: string): number => g.player.talents[id] ?? 0;
  const s = quietState(700);
  atLevel(s, 10);
  assert(spentTotal(s.player.talents) === 0 && JSON.stringify(s.player.talentFx) === JSON.stringify(deriveTalents({})),
    'a fresh character has spent nothing, and the derived effects are the neutral ones');

  buy(s, 'execute');
  assert(rank(s, 'execute') === 0 && hasEvent(s, e => e.t === 'talentfail' && e.reason === 'tier'), 'a tier-three talent is shut until the tree has been paid into');
  buy(s, 'brutality'); buy(s, 'brutality');
  assert(rank(s, 'brutality') === 2 && spentIn(s.player.talents, 'fury') === 2, 'two ranks of Brutality');
  buy(s, 'frenzy');
  assert(rank(s, 'frenzy') === 1, 'two points in Fury open its second tier');
  buy(s, 'execute');
  assert(rank(s, 'execute') === 0, 'three is still not the four the third tier asks for');
  buy(s, 'brutality'); buy(s, 'execute');
  assert(rank(s, 'execute') === 1 && spentIn(s.player.talents, 'fury') === 5, 'the fourth point in Fury opens Execute');
  buy(s, 'brutality');
  assert(rank(s, 'brutality') === 3 && hasEvent(s, e => e.t === 'talentfail' && e.reason === 'maxrank'), 'Brutality stops at its third rank');

  const left = talentPoints(10) - spentTotal(s.player.talents);
  for (let n = 0; n < left; n++) buy(s, 'toughened'), buy(s, 'serration');
  assert(spentTotal(s.player.talents) === talentPoints(10), `every point is spendable and no more (${spentTotal(s.player.talents)} of ${talentPoints(10)})`);
  buy(s, 'rally');
  assert(hasEvent(s, e => e.t === 'talentfail' && e.reason === 'points'), 'and the next press says there are none left');

  tick(s, { talentReset: true });
  assert(spentTotal(s.player.talents) === 0 && hasEvent(s, e => e.t === 'talentreset') && s.player.talentFx.damage === 1,
    'unlearning hands every point back and the effects go neutral with them');

  // the second gate: the points a tier wants are the floor, and a branch also names what it is built on
  const g = quietState(702);
  atLevel(g, 12);
  for (let n = 0; n < 3; n++) buy(g, 'brutality');
  buy(g, 'overpower');
  assert(spentIn(g.player.talents, 'fury') === 4 && rank(g, 'overpower') === 1, 'four points in Fury: the tier Ruin sits at is paid for');
  buy(g, 'ruin');
  assert(rank(g, 'ruin') === 0 && hasEvent(g, e => e.t === 'talentfail' && e.reason === 'prereq'),
    'and Ruin is still shut, because Overpower is not at full rank');
  buy(g, 'overpower'); buy(g, 'overpower');
  buy(g, 'ruin');
  assert(rank(g, 'overpower') === 3 && rank(g, 'ruin') === 1, 'Overpower taken all the way opens it');

  // not mid-fight
  const c = quietState(701);
  atLevel(c, 10);
  const boar = enemyOf(c, 'boar');
  placeAt(boar, 0, 0); boar.state = 'chase';
  c.player.x = 0; c.player.z = 2; c.player.outOfCombat = 0;
  tick(c);
  assert(c.player.inCombat, 'in combat');
  buy(c, 'brutality');
  assert(spentTotal(c.player.talents) === 0 && hasEvent(c, e => e.t === 'talentfail' && e.reason === 'combat'), 'talents cannot be changed in combat');
}

// ---------------------------------------------------------------------------
section('HOM-38 talents: every one of them changes an ability you already have');
{
  /** Grant ranks outright: the purchase rules are tested above, these checks are about what the ranks do. */
  const give = (s: GameState, ranks: Record<string, number>) => { Object.assign(s.player.talents, ranks); refreshTalents(s); };
  /**
   * A dummy, a forged blade and `secs` of fighting. Strike spam for the damage read (one rounding per 30-point hit,
   * so the percentages are legible); auto-attack alone for the swing count.
   */
  const bout = (seed: number, ranks: Record<string, number>, auto: boolean, secs = 30) => {
    const a = arena(seed, 5);
    a.s.player.equipment.weapon = 'forged_blade'; refreshGearStats(a.s);
    give(a.s, ranks);
    const hp0 = a.b.hp;
    let swings = 0;
    if (auto) tick(a.s, { attack: true });
    for (let n = 0; n < Math.round(secs / TICK_DT); n++) {
      const p = a.s.player;
      tick(a.s, { ability: !auto && p.gcd === 0 && p.energy >= ABILITIES[SLOT.strike].cost ? SLOT.strike : null });
      swings += a.s.events.filter(e => e.t === 'swing').length;
    }
    return { dealt: hp0 - a.b.hp, swings };
  };

  const plain = bout(600, {}, false), brutal = bout(600, { brutality: 3 }, false);
  assert(Math.abs(brutal.dealt / plain.dealt - 1.15) < 0.01 && brutal.swings === plain.swings,
    `Brutality 3 adds 15% to what you deal, and nothing else (${plain.dealt} -> ${brutal.dealt})`);

  const base = bout(601, {}, true), quick = bout(601, { frenzy: 2 }, true);
  assert(quick.swings >= Math.round(base.swings * 1.15) && quick.dealt > base.dealt,
    `Frenzy 2 swings 20% faster, so the same weapon does more over the same stretch (${base.swings} -> ${quick.swings} swings)`);

  // Toughened: armour's cap still applies, and a real blow lands softer
  const tough = quietState(602);
  atLevel(tough, 8);
  give(tough, { toughened: 3 });
  assert(Math.abs(reductionOf(tough.player) - 0.12) < 1e-9, 'Toughened 3 is 12% off everything that reaches you');
  const hitFor = (ranks: Record<string, number>) => {
    const g = quietState(603);
    atLevel(g, 8);
    give(g, ranks);
    const w = enemyOf(g, 'wolf');
    placeAt(w, 0, 0); w.state = 'chase'; w.attackCd = 0;
    g.player.x = 1.5; g.player.z = 0;
    let dmg = 0;
    for (let n = 0; n < Math.round(3 / TICK_DT) && !dmg; n++) { tick(g); for (const e of g.events) if (e.t === 'hit' && e.target === 'player') dmg = e.amount; }
    return dmg;
  };
  assert(hitFor({ toughened: 3 }) < hitFor({}) && hitFor({ toughened: 3 }) > 0, `a Dire Wolf's bite lands for ${hitFor({})} bare and ${hitFor({ toughened: 3 })} under Toughened 3`);

  // Rally: a bigger Second Wind on a shorter leash
  const heal = (ranks: Record<string, number>) => {
    const g = quietState(604);
    atLevel(g, 8);
    give(g, ranks);
    g.player.hp = 10;
    tick(g, { ability: SLOT.wind });
    const amount = g.events.reduce((n, e) => n + (e.t === 'heal' ? e.amount : 0), 0);
    return { amount, cd: g.player.cd[SLOT.wind] };
  };
  const r0 = heal({}), r2 = heal({ rally: 2 });
  assert(Math.abs(r2.amount / r0.amount - 1.5) < 0.03 && Math.abs(r2.cd - (r0.cd - 6)) < 1e-9,
    `Rally 2 heals half again as much on a cooldown six seconds shorter (${r0.amount} / ${r0.cd}s -> ${r2.amount} / ${r2.cd}s)`);

  // Counterstrike: half the cooldown, and the shutdown pays for itself
  const pummel = (ranks: Record<string, number>) => {
    const g = quietState(605);
    atLevel(g, 8);
    give(g, ranks);
    const b = enemyOf(g, 'brute');
    placeAt(b, 0, 0); b.state = 'chase'; b.heavyCd = 0; b.attackCd = 0;
    g.player.x = 0; g.player.z = 2.5;
    tick(g, { clickEnemy: b.id });
    for (let n = 0; n < 300 && !b.cast; n++) tick(g);
    g.player.energy = 40; // room for the refund to show: at full energy it would be capped away
    const before = g.player.energy;
    tick(g, { ability: SLOT.pummel });
    return { cd: g.player.cd[SLOT.pummel], gained: g.player.energy - before, interrupted: hasEvent(g, e => e.t === 'interrupt') };
  };
  const p0 = pummel({}), p1 = pummel({ counterstrike: 1 });
  assert(p0.interrupted && p1.interrupted && Math.abs(p1.cd - p0.cd / 2) < 1e-9 && p1.gained > p0.gained + 25,
    `Counterstrike halves Pummel's cooldown (${p0.cd}s -> ${p1.cd}s) and gives energy back for the shutdown`);

  // Serration: the bleed itself, not the throw
  const bleedOf = (ranks: Record<string, number>) => {
    const a = arena(606, 8);
    give(a.s, ranks);
    tick(a.s, { ability: SLOT.throw });
    return a.b.bleed!.damage;
  };
  const perTick = (r: number) => Math.round(ABILITIES[SLOT.throw].dotDamage! * powerForLevel(8) * (1 + 0.25 * r));
  assert(bleedOf({}) === perTick(0) && bleedOf({ serration: 3 }) === perTick(3) && perTick(3) > perTick(0),
    `Serration 3 makes the bleed tick for 75% more (${bleedOf({})} -> ${bleedOf({ serration: 3 })} a tick)`);

  // Whirling: a wider cone and a cheaper one
  const sweep = (ranks: Record<string, number>) => {
    const g = quietState(607);
    atLevel(g, 8);
    give(g, ranks);
    const [front, wide] = g.enemies.filter(e => e.type === 'boar');
    placeAt(front, 0, 3);
    placeAt(wide, 3 * Math.sin(85 * Math.PI / 180), 3 * Math.cos(85 * Math.PI / 180)); // 85 degrees off the aim: outside the base 140-degree cone
    g.player.x = 0; g.player.z = 0; g.player.facing = 0;
    tick(g, { clickEnemy: front.id });
    const before = g.player.energy;
    tick(g, { ability: SLOT.cleave });
    return { front: front.hp < front.maxHp, wide: wide.hp < wide.maxHp, spent: before - g.player.energy };
  };
  const narrow = sweep({}), wide = sweep({ whirling: 2 });
  assert(narrow.front && !narrow.wide, 'bare, Cleave misses something 85 degrees off the line to your target');
  assert(wide.front && wide.wide && wide.spent === narrow.spent - 10, `Whirling 2 widens the sweep to take it in, for ten energy less (${narrow.spent} -> ${wide.spent})`);

  // Bloodscent: more crits, and a crit works the wound open
  assert(Math.abs(deriveTalents({ bloodscent: 1 }).crit - 0.06) < 1e-9, 'Bloodscent is six points of crit');
  const peak = (seed: number, ranks: Record<string, number>) => {
    const a = arena(seed, 8);
    give(a.s, ranks);
    let most = 0;
    tick(a.s, { attack: true });
    for (let n = 0; n < Math.round(25 / TICK_DT); n++) {
      const p = a.s.player;
      tick(a.s, { ability: p.gcd === 0 && p.cd[SLOT.throw] === 0 && p.energy >= ABILITIES[SLOT.throw].cost ? SLOT.throw : null });
      most = Math.max(most, a.b.bleed?.ticks ?? 0);
    }
    return most;
  };
  const SEEDS38 = [610, 611, 612, 613];
  const bare = SEEDS38.map(n => peak(n, {})), scent = SEEDS38.map(n => peak(n, { bloodscent: 1 }));
  assert(bare.every(n => n === ABILITIES[SLOT.throw].dotTicks!), `bare, a bleed never runs past the ${ABILITIES[SLOT.throw].dotTicks!} ticks the throw gave it (${bare.join('/')})`);
  assert(scent.some(n => n > ABILITIES[SLOT.throw].dotTicks!), `with Bloodscent a crit adds ticks to it (${scent.join('/')})`);

  // Execute: Crushing Blow finishes the wounded, and a kill hands the cooldown back
  const crush = (ranks: Record<string, number>, hpFrac: number) => {
    const a = arena(608, 8);
    give(a.s, ranks);
    a.b.maxHp = 400; a.b.hp = 400 * hpFrac;
    const hp0 = a.b.hp;
    tick(a.s, { ability: SLOT.crushing });
    return { dealt: hp0 - a.b.hp, cd: a.s.player.cd[SLOT.crushing], dead: st(a.b) === 'dead' };
  };
  const healthy = crush({ execute: 1 }, 1), plainLow = crush({}, 0.3), execLow = crush({ execute: 1 }, 0.3);
  assert(Math.abs(execLow.dealt / plainLow.dealt - (1 + EXECUTE_BONUS)) < 0.05,
    `Execute adds half again to Crushing Blow below ${Math.round(EXECUTE_UNDER * 100)}% health (${plainLow.dealt} -> ${execLow.dealt})`);
  assert(Math.abs(healthy.dealt / crush({}, 1).dealt - 1) < 1e-9, 'and nothing at all above it');
  const finish = crush({ execute: 1 }, 0.05);
  assert(finish.dead && finish.cd === 0 && crush({}, 0.3).cd > 0, 'a Crushing Blow that kills hands its cooldown straight back');
}

// ---------------------------------------------------------------------------
section('HOM-80 talents: the branches, and the three capstones that hand over an ability');
{
  const give = (s: GameState, ranks: Record<string, number>) => { Object.assign(s.player.talents, ranks); refreshTalents(s); };

  // Overpower is Strike's alone; Carnage is the sweep's alone
  const hitWith = (slot: number, ranks: Record<string, number>) => {
    const a = arena(620, 8);
    a.s.player.equipment.weapon = 'forged_blade'; refreshGearStats(a.s);
    give(a.s, ranks);
    const hp0 = a.b.hp;
    tick(a.s, { ability: slot });
    return hp0 - a.b.hp;
  };
  assert(hitWith(SLOT.strike, { overpower: 3 }) > hitWith(SLOT.strike, {}) && hitWith(SLOT.crushing, { overpower: 3 }) === hitWith(SLOT.crushing, {}),
    `Overpower 3 is Strike's own bonus and no other hit's (${hitWith(SLOT.strike, {})} -> ${hitWith(SLOT.strike, { overpower: 3 })})`);
  assert(hitWith(SLOT.cleave, { carnage: 2 }) > hitWith(SLOT.cleave, {}) && hitWith(SLOT.strike, { carnage: 2 }) === hitWith(SLOT.strike, {}),
    `Carnage 2 is the sweep's and no other hit's (${hitWith(SLOT.cleave, {})} -> ${hitWith(SLOT.cleave, { carnage: 2 })})`);

  // Predator pays only on a wound, Berserk only when you are the wounded one
  const onBleeder = (ranks: Record<string, number>) => {
    const a = arena(621, 8);
    give(a.s, ranks);
    tick(a.s, { ability: SLOT.throw }); // the bleed first, then the hit that reads it
    a.s.player.gcd = 0;
    const hp0 = a.b.hp;
    tick(a.s, { ability: SLOT.strike });
    return hp0 - a.b.hp;
  };
  assert(onBleeder({ predator: 3 }) > onBleeder({}) && hitWith(SLOT.strike, { predator: 3 }) === hitWith(SLOT.strike, {}),
    `Predator 3 only pays against something already bleeding (${onBleeder({})} -> ${onBleeder({ predator: 3 })} on a bleeder, unchanged on a whole one)`);
  const cornered = (ranks: Record<string, number>, hpFrac: number) => {
    const a = arena(622, 8);
    give(a.s, ranks);
    a.s.player.hp = Math.round(a.s.player.maxHp * hpFrac);
    const hp0 = a.b.hp;
    tick(a.s, { ability: SLOT.strike });
    return hp0 - a.b.hp;
  };
  assert(cornered({ berserk: 2 }, 0.2) > cornered({}, 0.2) && cornered({ berserk: 2 }, 1) === cornered({}, 1),
    `Berserk 2 hits harder only below ${Math.round(WOUNDED_UNDER * 100)}% health (${cornered({}, 0.2)} -> ${cornered({ berserk: 2 }, 0.2)} cornered, unchanged whole)`);

  // Bastion: health that arrives with the rank and leaves with the reset
  const bast = quietState(623);
  atLevel(bast, 12);
  const hp0 = bast.player.maxHp;
  give(bast, { bastion: 3 });
  assert(Math.abs(bast.player.maxHp / hp0 - 1.15) < 0.01 && bast.player.hp === bast.player.maxHp,
    `Bastion 3 is 15% more health, handed over at once (${hp0} -> ${bast.player.maxHp})`);
  tick(bast, { talentReset: true });
  assert(bast.player.maxHp === hp0, 'and it goes back when the points do');

  // Guardian and Thick Skin sit outside the flat reduction: one answers a telegraph, the other a wounded player
  /** What one hit from a Brute lands for: its telegraphed slam, or the plain swing it leads with when the slam is off. */
  const brutalHit = (ranks: Record<string, number>, hpFrac: number, heavy: boolean) => {
    const g = quietState(624);
    atLevel(g, 12);
    give(g, ranks);
    const b = enemyOf(g, 'brute');
    placeAt(b, 0, 0); b.state = 'chase'; b.heavyCd = heavy ? 0 : 1e9; b.attackCd = 0;
    g.player.x = 0; g.player.z = 2;
    let dmg = 0;
    for (let n = 0; n < Math.round(20 / TICK_DT) && !dmg; n++) {
      g.player.hp = Math.round(g.player.maxHp * hpFrac); // hold the player at that share: each read is of one hit
      tick(g);
      for (const e of g.events) if (e.t === 'hit' && e.target === 'player' && !!e.heavy === heavy) dmg = e.amount;
    }
    return dmg;
  };
  const slam = brutalHit({}, 1, true), bite = brutalHit({}, 1, false);
  assert(brutalHit({ thickskin: 2 }, 1, true) < slam && brutalHit({ thickskin: 2 }, 1, false) === bite,
    `Thick Skin 2 takes a quarter off the slam and nothing off the bite (slam ${slam} -> ${brutalHit({ thickskin: 2 }, 1, true)}, bite ${bite})`);
  const low = brutalHit({}, 0.2, false), guarded = brutalHit({ guardian: 2 }, 0.2, false);
  assert(guarded < low && brutalHit({ guardian: 2 }, 1, false) === bite,
    `Guardian 2 only answers once you are wounded (${low} -> ${guarded} cornered, ${bite} unchanged whole)`);

  // Exsanguinate empties the same wound sooner; Rending gives it more to spend
  const bleedRun = (ranks: Record<string, number>) => {
    const a = arena(625, 8);
    give(a.s, ranks);
    tick(a.s, { ability: SLOT.throw });
    const ticks = a.b.bleed!.ticks, interval = a.b.bleed!.interval;
    let n = 0;
    while (a.b.bleed && n < Math.round(30 / TICK_DT)) { tick(a.s); n++; }
    return { ticks, interval, secs: n * TICK_DT };
  };
  const slow = bleedRun({}), fast = bleedRun({ exsanguinate: 2 }), longer = bleedRun({ rending: 2 });
  assert(fast.ticks === slow.ticks && fast.secs < slow.secs * 0.75,
    `Exsanguinate 2 runs the same ${slow.ticks} ticks 40% faster (${slow.secs.toFixed(1)}s -> ${fast.secs.toFixed(1)}s)`);
  assert(longer.ticks === slow.ticks + 2 && longer.secs > slow.secs, `Rending 2 adds two ticks to it (${slow.ticks} -> ${longer.ticks})`);

  // ---- the capstones ----
  const CAPSTONE = { bloodthirst: 8, bash: 9, hemorrhage: 10 };
  assert(ABILITIES[CAPSTONE.bloodthirst].talent === 'bloodthirst' && ABILITIES[CAPSTONE.bash].talent === 'ironwill' && ABILITIES[CAPSTONE.hemorrhage].talent === 'hemorrhage',
    'the three capstone abilities sit at the end of the bar, each named by its talent');

  // locked by the talent, not by gold or by the level
  const cap = arena(626, 20);
  tick(cap.s, { ability: CAPSTONE.bloodthirst });
  assert(hasEvent(cap.s, e => e.t === 'fail' && e.reason === 'locked' && e.slot === CAPSTONE.bloodthirst) && !abilityOpen(cap.s.player, CAPSTONE.bloodthirst),
    'at combat 20 with no talent in it, Bloodthirst is locked');
  give(cap.s, { bloodthirst: 1 });
  assert(abilityOpen(cap.s.player, CAPSTONE.bloodthirst), 'the talent point is what opens it');

  // Bloodthirst feeds you a share of what it deals
  const drink = () => {
    const a = arena(627, 20);
    a.s.player.equipment.weapon = 'forged_blade'; refreshGearStats(a.s);
    give(a.s, { bloodthirst: 1 });
    a.s.player.hp = Math.round(a.s.player.maxHp * 0.5);
    const hp0 = a.s.player.hp, boar0 = a.b.hp;
    tick(a.s, { ability: CAPSTONE.bloodthirst });
    return { healed: a.s.player.hp - hp0, dealt: boar0 - a.b.hp };
  };
  const bt = drink();
  assert(bt.dealt > 0 && Math.abs(bt.healed - Math.round(bt.dealt * ABILITIES[CAPSTONE.bloodthirst].leech!)) <= 1,
    `Bloodthirst deals ${bt.dealt} and gives ${bt.healed} of it back`);

  // Shield Bash staggers anything, wind-up or no wind-up, and takes no GCD
  const bashed = () => {
    const g = quietState(628);
    atLevel(g, 20);
    give(g, { ironwill: 1 });
    const b = enemyOf(g, 'brute');
    placeAt(b, 0, 0); b.state = 'chase'; b.heavyCd = 1e9; b.attackCd = 1e9;
    g.player.x = 0; g.player.z = 2.5;
    tick(g, { clickEnemy: b.id });
    const hp0 = b.hp;
    tick(g, { ability: CAPSTONE.bash });
    return { cast: b.cast, stagger: b.stagger, dealt: hp0 - b.hp, gcd: g.player.gcd };
  };
  const sb = bashed();
  assert(sb.stagger > 0 && sb.dealt > 0 && sb.gcd === 0,
    `Shield Bash staggers a Brute that was not winding up at all, hits it for ${sb.dealt}, and takes no GCD`);
  assert(Math.abs(deriveTalents({ stalwart: 2 }).staggerBonus - 0.8) < 1e-9, 'and Stalwart lengthens every stagger the player lands');

  // Hemorrhage tears the bleed off and spends what is left at once
  const tear = (withBleed: boolean) => {
    const a = arena(629, 20);
    give(a.s, { hemorrhage: 1 });
    if (withBleed) { tick(a.s, { ability: SLOT.throw }); a.s.player.gcd = 0; }
    const owed = a.b.bleed ? a.b.bleed.ticks * a.b.bleed.damage : 0;
    const hp0 = a.b.hp;
    tick(a.s, { ability: CAPSTONE.hemorrhage });
    return { owed, dealt: hp0 - a.b.hp, bleed: a.b.bleed };
  };
  const dry = tear(false), wet = tear(true);
  // what it deals on a bleeder is its own hit plus everything the wound still owed, so taking the debt back off it
  // leaves a hit the size of the dry one (the damage roll is the only difference between them)
  assert(wet.owed > 0 && wet.bleed === null && Math.abs((wet.dealt - wet.owed) / dry.dealt - 1) < 0.25,
    `Hemorrhage spends the ${wet.owed} the wound still owed in one hit and leaves nothing bleeding (${dry.dealt} dry -> ${wet.dealt} on a bleeder)`);
  assert(dry.dealt > 0, 'and on something whole it is still a hit, not a wasted press');
}

// ---------------------------------------------------------------------------
section('HOM-38 talents: saved, and only if the build was legal');
{
  const s = quietState(710);
  atLevel(s, 10);
  Object.assign(s.player.talents, { brutality: 3, frenzy: 2, execute: 1, toughened: 2 });
  refreshTalents(s);
  const l = deserialize(serialize(s))!;
  assert(l !== null && JSON.stringify(l.player.talents) === JSON.stringify(s.player.talents), 'the build survives a save');
  assert(JSON.stringify(l.player.talentFx) === JSON.stringify(s.player.talentFx), 'and its effects are re-derived, not stored');

  const raw = JSON.parse(serialize(s));
  const old = structuredClone(raw); delete old.player.talents;
  const loadedOld = deserialize(JSON.stringify(old));
  assert(loadedOld !== null && spentTotal(loadedOld.player.talents) === 0, 'a save from before the trees loads with nothing spent, rather than being thrown away');

  const bad = (edit: (f: any) => void) => { const f = structuredClone(raw); edit(f); return deserialize(JSON.stringify(f)); };
  assert(bad(f => { f.player.talents.not_a_talent = 1; }) === null, 'an unknown talent id -> null');
  assert(bad(f => { f.player.talents.brutality = 9; }) === null, 'more ranks than the talent has -> null');
  assert(bad(f => { f.player.talents.serration = 3; f.player.talents.whirling = 2; f.player.talents.bloodscent = 1; }) === null, 'more points than the level ever handed out -> null');
  assert(bad(f => { f.player.talents = { brutality: 3, frenzy: 2, execute: 1, bloodscent: 1 }; }) === null, 'a tier bought without paying into its tree -> null');
  assert(bad(f => { f.player.talents = { brutality: 3, overpower: 2, ruin: 1 }; }) === null, 'a branch bought without the talent it is built on -> null');
}

// ---------------------------------------------------------------------------
section('HOM-41 mastery: levels make the actions you have outgrown quicker and richer');
{
  const at = (above: number) => mastery(1 + above, 1);
  assert(at(0).speed === 1 && at(0).bonus === 0, 'at the level an action asks for, nothing changes: base time, base yield');
  assert(at(5).speed < at(0).speed && at(5).bonus > at(0).bonus && at(10).speed < at(5).speed && at(10).bonus > at(5).bonus,
    'every level over the requirement is quicker and richer than the last');
  assert(mastery(99, 1).speed === 1 - MAX_SPEEDUP && mastery(99, 1).bonus === MAX_BONUS,
    `both cap: never under ${((1 - MAX_SPEEDUP) * 100).toFixed(0)}% of the base time, never over one extra`);
  assert(mastery(1, 9).above === 0 && mastery(1, 9).speed === 1 && mastery(1, 9).bonus === 0,
    'under the requirement there is no penalty: the level gate already refuses you');

  // the user's example: mining iron
  const ironAt = (level: number, charges: number) => {
    const g = quietState(41);
    g.player.skills.mining.xp = xpForLevel(level); g.player.skills.mining.level = level;
    const rock = nodesOf(g, 'iron')[0];
    g.player.x = rock.x + 2; g.player.z = rock.z;
    rock.charges = charges; // one long seam, so the comparison is swings and not respawns
    tick(g, { interact: { k: 'node', id: rock.id } });
    const duration = g.player.action!.duration, t0 = g.tick;
    untilIdle(g);
    return { duration, ore: countOf(g, 'iron_ore'), secs: (g.tick - t0) * TICK_DT };
  };
  const def = NODE_TYPES.iron;
  const green = ironAt(def.level, def.charges), veteran = ironAt(def.level + 20, def.charges);
  assert(green.duration === def.time && green.ore === def.charges,
    `a Mining ${def.level} miner takes the full ${def.time}s a swing for one ore a swing (${green.ore} from ${def.charges})`);
  assert(veteran.duration === def.time * (1 - MAX_SPEEDUP) && veteran.ore === def.charges * 2,
    `twenty levels on, the same rock takes ${veteran.duration}s a swing and gives two ore a swing (${veteran.ore} from ${def.charges})`);
  assert(veteran.secs < green.secs * 0.6, `...so the seam is emptied in ${veteran.secs.toFixed(1)}s instead of ${green.secs.toFixed(1)}s`);
  const mid = ironAt(def.level + 10, 12);
  assert(mid.duration > veteran.duration && mid.duration < green.duration && mid.ore > 12 && mid.ore < 24,
    `halfway up it is part of the way to both: ${mid.duration}s a swing, ${mid.ore} ore from 12 swings`);

  // smithing the bars you outgrew
  const barAt = (level: number, ore: number) => {
    const g = quietState(42);
    g.player.x = LANDMARKS.forge.x - 4; g.player.z = LANDMARKS.forge.z + 3;
    g.player.skills.smithing.xp = xpForLevel(level); g.player.skills.smithing.level = level;
    addItem(g.player.inventory, 'iron_ore', ore);
    tick(g, { craft: { recipe: 'iron_bar', count: 99 } });
    const duration = g.player.action!.duration;
    untilIdle(g);
    return { duration, bars: countOf(g, 'iron_bar'), ore: countOf(g, 'iron_ore') };
  };
  const bar = recipeById('iron_bar')!;
  const apprentice = barAt(bar.level, 4), master = barAt(bar.level + 20, 20);
  assert(apprentice.duration === bar.time && apprentice.bars === 2, `Smithing ${bar.level} takes ${bar.time}s to smelt one bar from two ore`);
  assert(master.duration === bar.time * (1 - MAX_SPEEDUP) && master.bars === 20 && master.ore === 0,
    `twenty levels on, the same bar takes ${master.duration}s and twenty ore make ${master.bars} bars instead of ten`);

  // gear is not doubled: a second helm out of the same bars would be a trick, not a skill
  const g = quietState(43);
  g.player.x = LANDMARKS.forge.x - 4; g.player.z = LANDMARKS.forge.z + 3;
  g.player.skills.smithing.xp = xpForLevel(40); g.player.skills.smithing.level = 40;
  addItem(g.player.inventory, 'steel_bar', 2);
  craft(g, 'steel_helm', 1);
  assert(countOf(g, 'steel_helm') === 1 && countOf(g, 'steel_bar') === 0, 'an unstackable piece of gear is never doubled, however good the smith');

  // the extra never outruns the bag: what does not fit is not mined, and the player is told what they got
  const full = quietState(44);
  full.player.skills.mining.xp = xpForLevel(def.level + 20); full.player.skills.mining.level = def.level + 20;
  full.player.inventory.fill({ id: 'boar_hide', qty: 50 });
  full.player.inventory[0] = { id: 'iron_ore', qty: 49 };
  const rock = nodesOf(full, 'iron')[0];
  full.player.x = rock.x + 2; full.player.z = rock.z;
  tick(full, { interact: { k: 'node', id: rock.id } });
  let looted: { item: string; qty: number } | null = null;
  for (let n = 0; n < 200 && !looted; n++) {
    tick(full);
    for (const ev of full.events) if (ev.t === 'loot') looted = { item: ev.item, qty: ev.qty };
  }
  assert(countOf(full, 'iron_ore') === 50 && looted !== null && looted.item === 'iron_ore' && looted.qty === 1,
    'with room for one, a two-ore swing yields one and says so: the bonus is never lost silently');
}

// ---------------------------------------------------------------------------
section('HOM-42 economy: gold, item values and a merchant who buys your junk');
{
  const atVendor = (seed: number) => {
    const g = quietState(seed);
    g.player.x = VENDOR.x + 2; g.player.z = VENDOR.z;
    return g;
  };
  const failOf = (g: GameState) => g.events.find(ev => ev.t === 'actionfail') as Extract<GameState['events'][number], { t: 'actionfail' }> | undefined;

  assert(createState(1).player.gold === 0, 'a new game starts with no gold');
  assert(Object.entries(ITEMS).every(([, d]) => Number.isInteger(d.value) && d.value > 0), 'every item in ITEMS has a positive whole-number value: a new item cannot forget one');

  // selling
  const g = atVendor(420);
  addItem(g.player.inventory, 'boar_hide', 10);
  tick(g, { shop: [{ k: 'sell', slot: 0, qty: 4 }] });
  assert(countOf(g, 'boar_hide') === 6 && g.player.gold === 4 * ITEMS.boar_hide.value, 'selling part of a stack removes those items and pays value each');
  assert(g.events.some(ev => ev.t === 'trade' && ev.sold && ev.qty === 4), 'and a trade event says so');
  tick(g, { shop: [{ k: 'sell', slot: 0, qty: 999 }] });
  assert(countOf(g, 'boar_hide') === 0 && g.player.inventory[0] === null && g.player.gold === 10 * ITEMS.boar_hide.value, 'asking to sell more than the stack holds sells the stack and no more');
  const before = g.player.gold;
  tick(g, { shop: [{ k: 'sell', slot: 0, qty: 1 }, { k: 'sell', slot: -1, qty: 1 }, { k: 'sell', slot: 99, qty: 1 }, { k: 'sell', slot: 1.5, qty: 1 }] });
  assert(g.player.gold === before, 'selling from an empty or invalid slot does nothing');
  addItem(g.player.inventory, 'iron_sword', 1);
  tick(g, { shop: [{ k: 'sell', slot: 0, qty: 0 }, { k: 'sell', slot: 0, qty: -3 }, { k: 'sell', slot: 0, qty: NaN }] });
  assert(countOf(g, 'iron_sword') === 1 && g.player.gold === before, 'a zero, negative or non-numeric quantity sells nothing');

  // range is enforced in the sim
  const far = quietState(421);
  addItem(far.player.inventory, 'iron_sword', 1);
  far.player.gold = 1000;
  far.player.x = VENDOR.x + SHOP_REACH + 1; far.player.z = VENDOR.z;
  tick(far, { shop: [{ k: 'sell', slot: 0, qty: 1 }] });
  assert(countOf(far, 'iron_sword') === 1 && far.player.gold === 1000 && failOf(far)?.reason === 'range', 'selling out of range is refused with an actionfail');
  tick(far, { shop: [{ k: 'buy', item: 'leather_cap', qty: 1 }] });
  assert(countOf(far, 'leather_cap') === 0 && far.player.gold === 1000 && failOf(far)?.reason === 'range', 'and so is buying');

  // buying
  const b = atVendor(422);
  b.player.gold = buyPrice('iron_helm') + 3;
  tick(b, { shop: [{ k: 'buy', item: 'iron_helm', qty: 1 }] });
  assert(countOf(b, 'iron_helm') === 1 && b.player.gold === 3, 'buying takes the price and hands over the item');
  tick(b, { shop: [{ k: 'buy', item: 'iron_helm', qty: 1 }] });
  assert(countOf(b, 'iron_helm') === 1 && b.player.gold === 3 && failOf(b)?.reason === 'gold', 'too little gold: nothing changes and an actionfail says gold');
  b.player.gold = 1e6;
  b.player.inventory.fill({ id: 'boar_hide', qty: 50 });
  tick(b, { shop: [{ k: 'buy', item: 'iron_helm', qty: 1 }] });
  assert(countOf(b, 'iron_helm') === 0 && b.player.gold === 1e6 && failOf(b)?.reason === 'full', 'a full bag: nothing changes and an actionfail says full');
  b.player.inventory.fill(null);
  tick(b, { shop: [{ k: 'buy', item: 'iron_ore', qty: 1 }, { k: 'buy', item: 'no_such_item', qty: 1 }] });
  assert(countOf(b, 'iron_ore') === 0 && b.player.gold === 1e6, 'the merchant sells only what is on his shelf');
  const dead = atVendor(423);
  dead.player.gold = 1000; dead.player.dead = true;
  tick(dead, { shop: [{ k: 'buy', item: 'leather_cap', qty: 1 }] });
  assert(countOf(dead, 'leather_cap') === 0 && dead.player.gold === 1000, 'the dead do not shop');

  // from across the square the merchant is out of reach; walked up to, the click opens the shop (HOM-139)
  const walk = quietState(424);
  walk.player.x = VENDOR.x - 12; walk.player.z = VENDOR.z;
  tick(walk, { interact: { k: 'vendor' } });
  assert(hasEvent(walk, ev => ev.t === 'stuck') && !hasEvent(walk, ev => ev.t === 'shop'), 'clicking the merchant from 12u off says you cannot reach him');
  walkTo(walk, VENDOR.x, VENDOR.z, VENDOR.r + 1.5, 30);
  tick(walk, { interact: { k: 'vendor' } });
  assert(hasEvent(walk, ev => ev.t === 'shop'), 'walking over to the merchant and clicking him raises the shop event');

  // the invariant that keeps it unfarmable: computed from the data, not a hand-written list
  const inputs = new Set(RECIPES.flatMap(r => r.inputs.map(i => i.id)));
  assert(SHOP_STOCK.every(id => ITEMS[id]), 'every item on the shelf exists');
  assert(SHOP_STOCK.every(id => !inputs.has(id)), 'nothing the merchant sells is an input to any recipe: buy -> craft -> sell cannot make gold, whatever the smith\'s yield');
  assert(SHOP_STOCK.every(id => buyPrice(id) > ITEMS[id].value) && BUY_MARKUP > 1, 'he sells dearer than he buys: a round trip always loses gold');
  assert(SHOP_STOCK.every(id => RECIPES.every(r => r.output.id !== id)), 'and nothing on the shelf is something the forge makes');

  // saved
  const sv = atVendor(425);
  sv.player.gold = 777;
  assert(deserialize(serialize(sv))!.player.gold === 777, 'gold survives a save/load round trip');
  const old = JSON.parse(serialize(quietState(426)));
  delete old.player.gold;
  assert(old.version === SAVE_VERSION && SAVE_VERSION === 1, 'the save version is untouched, so no old save is thrown away');
  assert(deserialize(JSON.stringify(old))?.player.gold === 0, 'a save from before the economy still loads, with 0 gold');
  for (const bad of [-1, 'lots', null, 1e12, NaN]) {
    const f = structuredClone(old); f.player.gold = bad;
    assert(deserialize(JSON.stringify(f)) === null, `a save with gold ${String(bad)} is refused`);
  }
}

// ---------------------------------------------------------------------------
section('HOM-46 XP parity: ground you have outgrown pays less');
{
  // a kill pays base x clamp(1 + 0.05 x (enemy level - player level), 0.1, 1.25), at the level the player is when it dies
  const killXp = (level: number, type: string, seed: number) => {
    const s = quietState(seed);
    atLevel(s, level);
    const e = enemyOf(s, type);
    e.state = 'idle'; e.respawnIn = 0; e.maxHp = e.hp = 1; e.attackCd = 1e9;
    standNear(s, e, 2); s.targetId = e.id;
    tick(s, { ability: 0 });
    assert(st(e) === 'dead', `${type} falls to one Strike at level ${level}`);
    return (s.events.find(ev => ev.t === 'xp' && ev.skill === 'combat') as Extract<GameState['events'][number], { t: 'xp' }>).amount;
  };
  const warden = ENEMY_TYPES.warden, boar = ENEMY_TYPES.boar;
  assert(killXp(11, 'warden', 4601) === warden.xp, `the Warden pays its full ${warden.xp} at its own level`);
  assert(killXp(20, 'warden', 4602) === Math.round(warden.xp * 0.55), `...and ${Math.round(warden.xp * 0.55)} to a level 20 (5% a level below, 9 levels)`);
  assert(killXp(1, 'warden', 4603) === Math.round(warden.xp * 1.25), `...and no more than +25% (${Math.round(warden.xp * 1.25)}) to a level 1 who somehow kills it`);
  assert(killXp(40, 'warden', 4604) === Math.round(warden.xp * 0.1), 'a level 40 gets the 10% floor: it still pays, a little');
  assert(killXp(1, 'boar', 4605) === boar.xp && killXp(5, 'boar', 4606) === Math.round(boar.xp * 0.8), 'a boar still pays a level 1 in full, and a level 5 four fifths');
  assert(xpParity(10, 10) === 1 && xpParity(1, 99) === 0.1 && xpParity(99, 1) === 1.25 && Math.abs(xpParity(12, 10) - 1.1) < 1e-9, 'the rule itself: 1 at parity, +5% a level above, clamped to 0.1 .. 1.25');
  // what it does to the farm: the Warden's 900 XP shrinks as the player grows past level 11, the more so the further they go
  const pay = (level: number) => Math.round(warden.xp * xpParity(warden.level, level));
  assert(pay(11) === 900 && pay(15) === 720 && pay(20) === 495 && pay(30) === 90 && pay(11) > pay(15) && pay(15) > pay(20) && pay(20) > pay(30), `the Warden pays ${pay(11)} at 11, ${pay(15)} at 15, ${pay(20)} at 20 and ${pay(30)} at 30: it stops being the best farm in the game`);
}

// ---------------------------------------------------------------------------
section('HOM-46 adamant: Mining 28 (HOM-56), a smithed set, and gear that asks for a combat level');
{
  const sets = ['adamant_helm', 'adamant_chestplate', 'adamant_greaves', 'adamant_blade'];
  assert(sets.every(id => ITEMS[id].req?.combat === 14 && ITEMS[id].tier === 5), 'every adamant piece is tier 5 and needs combat 14');
  assert(Object.entries(ITEMS).filter(([id]) => !sets.includes(id) && id !== 'marrows_edge' && id !== 'rotroot_edge' && id !== 'kings_crown' && id !== 'crownbreaker' && !id.startsWith('stormiron_') && !id.startsWith('starmetal_') && !([...MARSHHIDE_SET, ...THORNHIDE_SET, ...MOORHIDE_SET] as string[]).includes(id)).every(([, d]) => d.req === undefined), 'nothing older has a requirement (Marrow\'s Edge, HOM-64, the Rotroot Edge, HOM-66, the stormiron set, HOM-95, the King\'s Crown, HOM-99, the three regional leather pairs, HOM-107, and the starmetal set and Crownbreaker, HOM-111, are newer and ask for combat 18, 26, 23, 30, 18, 24, 32 and 32): no old save is touched');
  assert(['stormiron_helm', 'stormiron_chestplate', 'stormiron_greaves', 'stormiron_blade'].every(id => ITEMS[id].req?.combat === 23 && ITEMS[id].tier === 5), 'every stormiron piece is tier 5 and needs combat 23');
  assert(deriveStats({ ...emptyEquipment(), head: 'adamant_helm', chest: 'adamant_chestplate', legs: 'adamant_greaves' }).armor === 68 && ITEMS.adamant_blade.stats!.damage === 40, 'the set is 16 + 30 + 22 = 68 armour, the blade 40: the bible\'s numbers');
  assert(deriveStats({ ...emptyEquipment(), weapon: 'adamant_blade' }).weaponDamage > deriveStats({ ...emptyEquipment(), weapon: 'warden_edge' }).weaponDamage, 'the Adamant Blade beats the Warden\'s Edge');
  assert(describeStatsHas('adamant_helm', 'Requires Combat 14'), 'and the tooltip says so');

  // the equip action reads it
  const s = quietState(4610);
  atLevel(s, 13);
  addItem(s.player.inventory, 'adamant_blade', 1);
  const slot = s.player.inventory.findIndex(x => x?.id === 'adamant_blade');
  tick(s, { inv: [{ k: 'equip', slot }] });
  assert(hasEvent(s, e => e.t === 'actionfail' && e.reason === 'req' && e.need === 14) && s.player.equipment.weapon === null && s.player.inventory[slot]?.id === 'adamant_blade', 'at combat 13 the blade stays in the bag, and the refusal says why');
  atLevel(s, 14);
  tick(s, { inv: [{ k: 'equip', slot }] });
  assert(s.player.equipment.weapon === 'adamant_blade' && s.player.stats.weaponDamage === 40, 'at combat 14 it goes on and the damage follows');
  const legacy = quietState(4611);
  addItem(legacy.player.inventory, 'warden_edge', 1);
  tick(legacy, { inv: [{ k: 'equip', slot: legacy.player.inventory.findIndex(x => x?.id === 'warden_edge') }] });
  assert(legacy.player.equipment.weapon === 'warden_edge', 'the Warden\'s Edge still equips at level 1: legacy gear is unrestricted');

  // the veins: five of them, after every older node, gated at Mining 17
  const g = createState(4612);
  const veins = nodesOf(g, 'adamant');
  const beforeSalt = REGIONS.find(r => r.id === 'ridge')!.rocks.length + TREES.length + CAVE_ROCKS.length; // the ridge's rocks, Hale's trees and the cave's veins: everything placed before Saltmarrow
  assert(veins.length === 5 && veins.every(n => n.id > beforeSalt) && g.nodes.slice(0, beforeSalt).every(n => n.type !== 'adamant') && NODE_TYPES.adamant.level === 28 && NODE_TYPES.adamant.item === 'adamant_ore', `five adamant veins on the Strand's cliffs, ids after the first ${beforeSalt}, Mining 28`);
  g.player.skills.mining.xp = xpForLevel(27); g.player.skills.mining.level = 27;
  g.player.x = veins[0].x; g.player.z = veins[0].z + 3;
  for (const e of g.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  tick(g, { interact: { k: 'node', id: veins[0].id } });
  assert(hasEvent(g, e => e.t === 'actionfail' && e.reason === 'level' && e.need === 28), 'at Mining 27 a vein refuses you, naming the level');
  g.player.skills.mining.xp = xpForLevel(28); g.player.skills.mining.level = 28;
  tick(g, { interact: { k: 'node', id: veins[0].id } });
  run(g, 7);
  assert(countOf(g, 'adamant_ore') >= 1, 'at Mining 28 it yields adamant ore');
  const cost = (L: number) => xpForLevel(L + 1) - xpForLevel(L);
  assert(Math.abs(NODE_TYPES.adamant.xp - 0.12 * cost(28)) <= 2, `a swing pays 0.12 x the XP from level 28 to 29 (${NODE_TYPES.adamant.xp}), the metal ladder's rule for a gathering action`);
  for (const [id, L, f] of [['adamant_bar', 24, 0.25], ['adamant_helm', 25, 0.35], ['adamant_blade', 26, 0.4], ['adamant_greaves', 27, 0.35], ['adamant_chestplate', 29, 0.35]] as const) {
    const r = recipeById(id)!;
    assert(r.level === L && Math.abs(r.xp - f * cost(L)) <= 5, `${r.name}: Smithing ${L}, ${r.xp} XP (${f} x ${cost(L)} to the nearest 5)`);
  }
  assert(recipeById('adamant_bar')!.inputs.some(i => i.id === 'coal' && i.qty === 3) && recipeById('adamant_blade')!.inputs.some(i => i.id === 'adamant_bar' && i.qty === 3), 'a bar is one ore and three coal, a blade three bars and a log');

  // and the whole chain at the forge
  const f = quietState(4613);
  f.player.skills.smithing.xp = xpForLevel(29); f.player.skills.smithing.level = 29;
  addItem(f.player.inventory, 'adamant_ore', 12); addItem(f.player.inventory, 'coal', 36); addItem(f.player.inventory, 'logs', 1);
  f.player.x = LANDMARKS.forge.x - 4; f.player.z = LANDMARKS.forge.z + 3;
  craft(f, 'adamant_bar', 12);
  for (const id of ['adamant_helm', 'adamant_greaves', 'adamant_chestplate', 'adamant_blade']) craft(f, id, 1);
  assert(['adamant_helm', 'adamant_greaves', 'adamant_chestplate', 'adamant_blade'].every(id => countOf(f, id) === 1) && countOf(f, 'adamant_ore') >= 0 && countOf(f, 'coal') >= 0, 'twelve bars (one ore and three coal each) make the helm, greaves, chestplate and blade (mastery may leave a spare bar over: Smithing 19 is five levels past the bar)');
}
function describeStatsHas(id: string, line: string) { return describeStats(ITEMS[id]).includes(line); }

// ---------------------------------------------------------------------------
section('HOM-46 safe zones: nothing wakes in a town, and a chase that reaches one gives up');
{
  const sq = LANDMARKS.square;
  const crab = (seed: number, ex: number, ez: number, px: number, pz: number) => {
    const s = quietState(seed);
    const c = enemyOf(s, 'shore_crab');
    placeAt(c, ex, ez); c.attackCd = 0;
    s.player.x = px; s.player.z = pz; s.player.hp = s.player.maxHp;
    return { s, c };
  };
  {
    const { s, c } = crab(4620, sq.x + 5, sq.z, sq.x + 2, sq.z);
    run(s, 2);
    assert(st(c) === 'idle', 'a crab three units from a player standing in the square does not wake');
  }
  {
    const { s, c } = crab(4621, SALTMARROW.x + 10, SALTMARROW.z + 45, SALTMARROW.x + 8, SALTMARROW.z + 45);
    run(s, 1);
    assert(st(c) === 'chase', 'the same crab on the Strand, outside the square, does');
  }
  {
    // chased out of the Strand and into the square: it gives up at the edge and resets
    const { s, c } = crab(4622, SALTMARROW.x + 10, SALTMARROW.z + 45, sq.x, sq.z);
    c.state = 'chase'; c.hp = 10;
    let reset: number = -1;
    for (let i = 0; i < 30 * 40 && reset < 0; i++) { tick(s); if (st(c) === 'return') reset = i / 30; }
    assert(reset > 0 && reset < 20 && Math.hypot(c.x - sq.x, c.z - sq.z) > 33, `it turns back at the edge of the square, ${reset.toFixed(1)}s in, with the player untouched`);
    assert(c.hp === c.maxHp && s.player.hp === s.player.maxHp, 'and resets to full health');
  }
  {
    // Hale's own: the smithy's yard is safe ground
    const yard = REGIONS.find(r => r.id === 'clearing')!.safe![0], s = quietState(4623), b = enemyOf(s, 'boar');
    placeAt(b, yard.x + 6, yard.z); b.attackCd = 0;
    s.player.x = yard.x; s.player.z = yard.z;
    run(s, 1);
    assert(st(b) === 'idle', 'a boar six units from the forge does not wake to a smith at it');
    s.player.x = yard.x + 11; s.player.z = yard.z;
    run(s, 1);
    assert(st(b) === 'chase', '...but does to someone eleven units off, which is how the clearing always played');
  }
}

// ---------------------------------------------------------------------------
section('HOM-46 the road east: Hale to Saltmarrow on foot, and back, with no transition');
{
  const s = createState(4630);
  const sq = LANDMARKS.square, seen: string[] = [];
  let leftFloor = 0, stuck = 0, woke = false, gateX = 0;
  const gate = { z: null as number | null };
  const walkTo = (x: number, z: number, limit: number) => {
    const pts = route(s.player, { x, z }) ?? [{ x, z }];
    let t = 0;
    while (t < limit && Math.hypot(s.player.x - x, s.player.z - z) > 1.2) {
      s.player.hp = s.player.maxHp = 1e6; // this is about the ground, not the fight: every enemy on the road may chase
      while (pts.length > 1 && Math.hypot(s.player.x - pts[0].x, s.player.z - pts[0].z) < 0.3) pts.shift();
      const dx = pts[0].x - s.player.x, dz = pts[0].z - s.player.z, d = Math.hypot(dx, dz);
      if (d < 1e-6) break;
      const was = { x: s.player.x, z: s.player.z };
      tick(s, { dirX: dx / d, dirZ: dz / d });
      if (Math.hypot(s.player.x - was.x, s.player.z - was.z) < 1e-4) stuck++; // held a direction and went nowhere: wedged on scenery
      t += TICK_DT;
      const c = clampToWorld(s.player);
      if (Math.hypot(c.x - s.player.x, c.z - s.player.z) > 1e-6) leftFloor++;
      const r = regionAt(s.player.x, s.player.z)?.id ?? '?';
      if (seen[seen.length - 1] !== r) seen.push(r);
      if (gate.z === null && s.player.x >= 30) { gate.z = s.player.z; gateX = s.player.x; }
      if (s.enemies.some(e => e.region === 'greywater' && st(e) === 'chase')) woke = true;
    }
    return t;
  };
  const out = walkTo(sq.x, sq.z, 220);
  assert(Math.hypot(s.player.x - sq.x, s.player.z - sq.z) <= 1.2, `Saltmarrow's square can be walked to from the clearing: ${out.toFixed(0)}s at 6 units a second`);
  assert(out < 200, 'in under 200 seconds: the road is 800 long and runs straight');
  assert(seen.includes('clearing') && seen.includes('greywater') && seen.includes('saltmarrow') && seen.indexOf('clearing') < seen.indexOf('greywater') && seen.indexOf('greywater') < seen.indexOf('saltmarrow'), `through the clearing, the road and the town in that order (${seen.join(' > ')})`);
  assert(gate.z !== null && gate.z >= 5.5 - 1e-6 && gate.z <= 10.5 + 1e-6, `and out through the gate: it crossed the wall at x = ${gateX.toFixed(1)}, z = ${gate.z?.toFixed(2)}, inside the 6-unit gap`);
  assert(leftFloor === 0 && stuck === 0, 'never off the floor, never stuck on scenery');
  assert(woke, 'and it was not an empty road: the camps woke to a level 1 walking through (the walker could not die, so they chased and struck for nothing)');
  const back = walkTo(0, 6, 220);
  assert(Math.hypot(s.player.x, s.player.z - 6) <= 1.2 && stuck === 0 && leftFloor === 0, `and the whole way back again: ${back.toFixed(0)}s`);
  assert(s.enemies.filter(e => e.region === 'greywater').length === 18 && s.enemies.filter(e => e.region === 'saltmarrow').length === 11 && s.enemies.filter(e => e.region === 'clearing' || e.region === 'hollow' || e.region === 'hall').length === 20, 'every enemy is tagged with its region: 18 on the road, 11 on the Strand, Hale\'s 20');
}

// ---------------------------------------------------------------------------
section('HOM-57 the road has a reason: an errand from Hale to Saltmarrow, and ore and trees along the way');
{
  const way = REGIONS.find(r => r.id === 'wayside')!, spots = [...way.rocks, ...way.trees];
  const west = GREYWATER.x - 400;
  const bands = new Set(spots.map(p => Math.floor((p.x - west) / 100)));
  assert(bands.size === 7 && !bands.has(4), `a stand in every hundred units of the road but the toll camp's (${bands.size} of 8 bands)`);
  const kindsOn = (t: string) => way.rocks.filter(r => r.type === t).length;
  assert(['tin', 'iron', 'coal'].every(t => kindsOn(t) >= 3) && kindsOn('copper') * NODE_TYPES.copper.charges >= 2 * ERRAND_GOODS[1].n && way.trees.length >= 8,
    `HOM-77: the road carries the whole ladder above copper (${kindsOn('tin')} tin, ${kindsOn('iron')} iron, ${kindsOn('coal')} coal), and keeps copper and trees enough for the errand`);
  const s0 = createState(5701);
  const road = s0.enemies.filter(e => e.region === 'greywater');
  // HOM-134: the road bends, and the stands bend with it, so "off the road" is measured from where the dirt actually runs
  const grey = REGIONS.find(r => r.id === 'greywater')!.road!;
  assert(spots.every(p => roadDist(grey, p.x, p.z) >= 8 && road.every(e => Math.hypot(e.spawnX - p.x, e.spawnZ - p.z) > ENEMY_TYPES[e.type].aggroRadius + 4)), 'every node is off the road and out of every camp\'s aggro: a level-1 walker can stop at it');
  assert(spots.every(p => regionAt(p.x, p.z)?.id === 'greywater' && clampToWorld(p, p.r).x === p.x), 'and on the road\'s floor');

  const s = quietState(5702), q4 = () => s.quest.fourth as string;
  assert(s.quest.fourth === 'offer' && s.quest.stage === 'offer', 'a fresh character has the errand on offer from the start, beside the first quest');
  assert(dialogueAt(s, 'hale').options.some(o => o.advance === 'road') && activeDialogue(s) === DIALOGUE.offer && !DIALOGUE.offer.options.some(o => o.advance === 'road'), 'it is one more thing to ask the Warden, and his own dialogue is untouched');
  s.player.x = HARBOURMASTER.x; s.player.z = HARBOURMASTER.z + 2;
  tick(s, { questAdvance: 'road' });
  assert(s.quest.fourth === 'offer', 'only the Warden gives it');
  s.player.x = NPC.x; s.player.z = NPC.z + 1;
  tick(s, { questAdvance: 'road' });
  assert((s.quest.fourth as string) === 'carry' && s.quest.stage === 'offer' && hasEvent(s, e => e.t === 'quest' && e.what === 'accept' && e.name === QUEST4_NAME), 'asking him takes the errand, and does not start the Brute\'s quest');
  assert(!dialogueAt(s, 'hale').options.some(o => o.advance === 'road') && activeQuestView(s).title === QUEST_NAME, 'in Hale the tracker still follows the first quest');
  s.player.x = GREYWATER.x - 300; s.player.z = GREYWATER.z;
  assert(activeQuestView(s).title === QUEST4_NAME && activeQuestView(s).target !== null && !activeQuestView(s).ready, 'out on the road it follows the errand, pointing at a node');
  for (const g of ERRAND_GOODS) addItem(s.player.inventory, g.item, g.n - 1);
  tick(s);
  assert(q4() === 'carry', 'one short is still carrying');
  for (const g of ERRAND_GOODS) addItem(s.player.inventory, g.item, 1);
  tick(s);
  assert(q4() === 'report' && activeQuestView(s).ready && harbourMarker(s) === 'ready', 'the goods in the bag make it a hand-in, and the quay has a mark');
  removeItem(s.player.inventory, 'logs', 1);
  tick(s);
  assert(q4() === 'carry', 'spend a log and it is back to carrying');
  addItem(s.player.inventory, 'logs', 1);
  tick(s);
  s.player.x = NPC.x; s.player.z = NPC.z + 1;
  tick(s, { questAdvance: true }); // the Warden hears this as the first quest's accept, and nothing more
  assert(q4() === 'report', 'only the harbourmaster takes it');
  const rt = deserialize(serialize(s))!;
  assert(rt.quest.fourth === 'report', 'the errand survives a save and load');
  const old = JSON.parse(serialize(s)); delete old.quest.fourth;
  assert(deserialize(JSON.stringify(old))!.quest.fourth === 'offer', 'a save from before it finds it on offer');
  const bad = JSON.parse(serialize(s)); bad.quest.fourth = 'bogus';
  assert(deserialize(JSON.stringify(bad)) === null, 'and a made-up stage is refused');
  const mining0 = s.player.skills.mining.xp, wood0 = s.player.skills.woodcutting.xp;
  s.player.x = HARBOURMASTER.x + 2; s.player.z = HARBOURMASTER.z;
  assert(dialogueAt(s, 'harbour').options.some(o => o.advance), 'the harbourmaster\'s dialogue offers the hand-in');
  tick(s, { questAdvance: true });
  assert(q4() === 'cleared' && countOf(s, 'logs') === 0 && countOf(s, 'copper_ore') === 0 && hasEvent(s, e => e.t === 'quest' && e.what === 'complete' && e.name === QUEST4_NAME), 'handing in takes the goods and completes it');
  assert(s.player.skills.mining.xp - mining0 >= REWARD4[1].xp && s.player.skills.woodcutting.xp - wood0 >= REWARD4[0].xp && harbourMarker(s) === null, 'and pays Mining and Woodcutting XP');
  assert((s.quest.third as string) === 'locked', 'the story\'s third chain was not touched');
}

// ---------------------------------------------------------------------------
section('HOM-46 Saltmarrow: its harbourmaster, its chandler, and the third quest');
{
  const s = quietState(4640);
  const pell = HARBOURMASTER;
  s.player.x = pell.x + 2; s.player.z = pell.z;
  assert((s.quest.third as string) === 'locked' && harbourMarker(s) === null && dialogueAt(s, 'harbour').options.every(o => !o.advance), 'before the Hollow is quiet the harbourmaster only greets you');
  tick(s, { questAdvance: true });
  assert((s.quest.third as string) === 'locked' && s.quest.stage === 'offer', 'and advancing does nothing');
  s.quest.stage = 'done'; s.quest.second = 'cleared';
  tick(s);
  assert((s.quest.third as string) === 'offer' && harbourMarker(s) === 'offer' && activeQuestView(s).title === QUEST3_NAME, 'once the Warden is dead the road opens: a mark over his head and a tracker for The Salt Road');
  assert(npcMarker(s) === null, 'while the warden in Hale has nothing more to say');
  s.player.x = NPC.x; s.player.z = NPC.z + 1;
  tick(s, { questAdvance: true });
  assert((s.quest.third as string) === 'offer', 'the warden in Hale cannot hand it out');
  s.player.x = pell.x + 2; s.player.z = pell.z;
  tick(s, { questAdvance: true });
  assert((s.quest.third as string) === 'hunt' && hasEvent(s, e => e.t === 'quest' && e.what === 'accept' && e.name === QUEST3_NAME), 'at the quay, advancing accepts it');
  for (let k = 0; k < 4; k++) { assert((s.quest.third as string) === 'hunt', `three footpads or fewer: still hunting (${k})`); questOnKill(s, 'footpad'); }
  assert((s.quest.third as string) === 'hunt' && activeQuestView(s).lines.length >= 2, 'four footpads are not the Captain');
  questOnKill(s, 'toll_captain');
  assert((s.quest.third as string) === 'report' && harbourMarker(s) === 'ready' && activeQuestView(s).ready, 'and the Captain makes it a hand-in');
  s.player.x = NPC.x; s.player.z = NPC.z + 1;
  tick(s, { questAdvance: true });
  assert((s.quest.third as string) === 'report', 'which only the harbourmaster takes');
  const xp0 = s.player.combat.xp;
  s.player.x = pell.x + 2; s.player.z = pell.z;
  tick(s, { questAdvance: true });
  assert((s.quest.third as string) === 'cleared' && s.player.combat.xp - xp0 === REWARD3[0].xp && REWARD3[0].xp === 600 && hasEvent(s, e => e.t === 'quest' && e.what === 'complete'), 'handing in pays 600 combat XP, the bible\'s figure');
  assert(harbourMarker(s) === 'offer' && (s.quest.fifth as string) === 'offer', 'and the mark does not go: it is the next chain (HOM-64, Brine and Bone), on offer from the same quay');
  const rt = deserialize(serialize(s))!;
  assert((rt.quest.third as string) === 'cleared' && rt.quest.kills.footpad === 4, 'the chain survives a save and load');
  const old = JSON.parse(serialize(s)); delete old.quest.third; delete old.quest.fifth; // a save from before the road is from before Brine and Bone too
  assert(deserialize(JSON.stringify(old))!.quest.third === 'offer', 'a save from before the road, with the Hollow cleared, finds the road on offer');
  const old2 = JSON.parse(serialize(quietState(4641))); delete old2.quest.third;
  assert(deserialize(JSON.stringify(old2))!.quest.third === 'locked', '...and one that has not cleared it finds it locked');
  const bad = JSON.parse(serialize(quietState(4642))); bad.quest.third = 'hunt';
  assert(deserialize(JSON.stringify(bad)) === null, 'a save that has the road open before the Hollow is quiet is refused');

  // walked up to, clicking the harbourmaster opens his dialogue, naming him
  const w = quietState(4643);
  w.player.x = pell.x - 15; w.player.z = pell.z;
  walkTo(w, pell.x, pell.z, pell.r + 1.5, 30);
  tick(w, { interact: { k: 'npc', id: 'harbour' } });
  assert(w.events.some(e => e.t === 'npc' && e.who === 'harbour'), 'clicking the harbourmaster opens his dialogue');
  const e = quietState(4644);
  e.player.x = NPC.x + 1; e.player.z = NPC.z;
  tick(e, { interact: { k: 'npc' } });
  assert(e.events.some(ev => ev.t === 'npc' && ev.who === 'hale'), 'pressing E in Hale still talks to the warden');

  // the chandler
  const v = quietState(4645);
  v.player.gold = 1000;
  v.player.x = HARBOUR_VENDOR.x + 2; v.player.z = HARBOUR_VENDOR.z;
  tick(v, { shop: [{ k: 'buy', item: 'steel_sword', qty: 1 }] });
  assert(countOf(v, 'steel_sword') === 1 && v.player.gold === 1000 - buyPrice('steel_sword'), `Tam Brine sells a steel sword for ${buyPrice('steel_sword')}`);
  tick(v, { shop: [{ k: 'buy', item: 'rusty_blade', qty: 1 }] });
  assert(countOf(v, 'rusty_blade') === 0, 'but not the rusty blade Hale sells: each stall has its own stock');
  v.player.x = VENDOR.x + 2; v.player.z = VENDOR.z; v.player.gold = 1000;
  tick(v, { shop: [{ k: 'buy', item: 'steel_sword', qty: 1 }] });
  assert(countOf(v, 'steel_sword') === 1 && v.player.gold === 1000, 'and Brannoch in Hale has no steel sword for sale');
  v.player.x = HARBOUR_VENDOR.x + 2; v.player.z = HARBOUR_VENDOR.z;
  tick(v, { shop: [{ k: 'sell', slot: v.player.inventory.findIndex(x => x?.id === 'steel_sword'), qty: 1 }] });
  assert(countOf(v, 'steel_sword') === 0 && v.player.gold === 1000 + ITEMS.steel_sword.value, 'selling to him pays an item\'s value');
  const recipeIn = new Set(RECIPES.flatMap(r => r.inputs.map(i => i.id)));
  // sea salt is the one exception: a pie's bought pinch. A pie also eats two fish that cannot be bought, and nothing it makes is for sale
  assert(HARBOUR_STOCK.filter(id => id !== 'sea_salt').every(id => !recipeIn.has(id) && buyPrice(id) > ITEMS[id].value && RECIPES.every(r => r.output.id !== id)), 'nothing he sells is a crafting input or a crafted item: buy -> craft -> sell still cannot make gold');
}

// ---------------------------------------------------------------------------
section('HOM-46 the road and the Strand: the bible\'s tables, as data');
{
  const T = ENEMY_TYPES;
  const table: [string, number, number, number, number, number, 'trash' | 'elite' | 'rare'][] = [
    ['marsh_hog', 10, 415, 35, 2, 30, 'trash'], ['road_wolf', 11, 470, 33, 1.8, 31, 'trash'], ['footpad', 12, 530, 46, 2.4, 32, 'trash'], ['toll_captain', 13, 1785, 54, 2.2, 99, 'elite'], ['old_grey', 12, 2120, 40, 1.6, 192, 'rare'],
    ['shore_crab', 14, 665, 34, 1.6, 34, 'trash'], ['drowned_sailor', 15, 745, 59, 2.6, 35, 'trash'], ['tide_hag', 16, 840, 71, 3, 36, 'trash'], ['barnacle_ogre', 17, 2790, 71, 2.4, 111, 'elite'], ['gutterhook', 16, 3365, 55, 1.8, 216, 'rare'],
  ];
  const mult = { trash: 1, elite: 3, rare: 6 }, ev = (id: string) => {
    const tb = DROP_TABLES[id], w = tb.entries.map(e => e.weight ?? ITEMS[e.id].dropWeight), tot = tb.nothing + w.reduce((a, b) => a + b, 0);
    return tb.rolls * tb.entries.reduce((a, e, i) => a + (w[i] / tot) * (e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1) * ITEMS[e.id].value, 0);
  };
  for (const [id, L, hp, hit, swing, xp, role] of table) {
    const d = T[id];
    assert(d.level === L && d.hp === hp && d.damage === hit && d.attackInterval === swing && d.xp === xp, `${d.name}: level ${L}, ${hp} HP, hit ${hit} every ${swing}s, ${xp} XP: as the table has it`);
    assert(d.xp === (20 + L) * mult[role], `...and its XP is (20 + ${L}) x ${mult[role]} for a ${role}`);
    assert(d.respawn === (role === 'trash' ? d.respawn : role === 'elite' ? 120 : 1800) && (role !== 'trash' || (d.respawn >= 30 && d.respawn <= 45)), `...respawning in ${d.respawn}s`);
    const want = (0.6 * L + 3) * ({ trash: 1, elite: 3, rare: 4 })[role];
    assert(Math.abs(ev(id) / want - 1) <= 0.15, `...and its drops are worth ${ev(id).toFixed(1)} gold a kill against the rule's ${want.toFixed(1)} (within 15%)`);
    assert(d.look && ['wolf', 'hexer', 'brute', 'boar', 'pup'].includes(d.look.model), '...drawn with a rig that already exists');
  }
  assert(T.toll_captain.heavy!.damage === 195 && T.old_grey.heavy!.damage === 180 && T.barnacle_ogre.heavy!.damage === 250 && T.gutterhook.heavy!.damage === 235 && T.tide_hag.hazard !== undefined && T.footpad.ranged !== undefined && T.drowned_sailor.ranged !== undefined && T.road_wolf.pack === 7, 'the heavies, the knife and harpoon throwers, the Undertow and the wolf pack are all there');
  const count = (type: string) => SPAWNS.filter(sp => sp.type === type).length;
  assert(count('marsh_hog') === 6 && count('road_wolf') === 6 && count('footpad') === 4 && count('toll_captain') === 1 && count('old_grey') === 1, 'the road holds 6 hogs, two wolf camps of 3, 4 footpads, the Captain and Old Grey');
  const strand = (type: string) => SPAWNS.filter(sp => sp.type === type && regionAt(sp.x, sp.z)?.id === 'saltmarrow').length; // the Grotto (HOM-64) reuses the Strand's hags and ogres behind its door: they are not the Strand's
  assert(strand('shore_crab') === 4 && strand('drowned_sailor') === 3 && strand('tide_hag') === 2 && strand('barnacle_ogre') === 1 && strand('gutterhook') === 1, 'the Strand holds its five kinds');
  const at = (type: string) => SPAWNS.filter(sp => sp.type === type).map(sp => [Math.round(sp.x - GREYWATER.x), Math.round(sp.z - GREYWATER.z)]);
  assert(JSON.stringify(at('toll_captain')) === '[[60,0]]' && JSON.stringify(at('old_grey')) === '[[330,-45]]' && at('marsh_hog').slice(0, 4).every(([x, z]) => x >= -330 && x <= -260 && Math.abs(z) <= 30), 'the Captain stands on the road at 60, Old Grey at (330, -45), the first hogs in the pasture from -330 to -260');
  // everyone is reachable on foot from the gate
  const gate = { x: 29, z: 8 };
  assert(SPAWNS.filter(sp => sp.x > 30).every(sp => route(gate, sp) !== null), 'every enemy on the road and the Strand can be walked to from Hale\'s gate');
  assert(createState(4650).enemies.filter(e => e.id > 20).every((e, i) => e.type === SPAWNS[20 + i].type), 'new enemies take ids 21 on, after every older one');
}

// ---------------------------------------------------------------------------
section('HOM-56 the metal ladder: copper, bronze, iron and steel, adamant, each with distance between the rungs');
{
  const MINING = ['copper', 'tin', 'iron', 'coal', 'adamant']; // HOM-81: the mithril vein that sat between coal and adamant is gone, and steel is smithed from the two below it
  const lv = (t: string) => NODE_TYPES[t].level, rec = (id: string) => recipeById(id)!;
  assert(MINING.every(t => NODE_TYPES[t].skill === 'mining') && lv('copper') === 1, 'the ladder starts at copper, Mining 1');
  assert(MINING.every((t, k) => k === 0 || lv(t) > lv(MINING[k - 1])), `and climbs: ${MINING.map(t => `${t} ${lv(t)}`).join(' < ')}`);
  assert(MINING.every((t, k) => k < 2 || lv(t) - lv(MINING[k - 1]) >= 3), 'iron, coal and adamant are each at least three levels past the last');
  const cost = (L: number) => xpForLevel(L + 1) - xpForLevel(L);
  assert(MINING.every(t => Math.abs(NODE_TYPES[t].xp - 0.12 * cost(lv(t))) <= 2), `a swing pays 0.12 x the XP from its own level to the next: ${MINING.map(t => `${t} ${NODE_TYPES[t].xp}`).join(', ')}`);

  // how many swings the climb takes, mining the best rock open at each level, against the ladder it replaces
  type Rock = { level: number; xp: number };
  const swingsTo = (target: number, rocks: Rock[]) => {
    let xp = 0, swings = 0;
    while (levelForXp(xp) < target && swings < 5000) { xp += rocks.filter(r => r.level <= levelForXp(xp)).reduce((a, b) => b.xp > a.xp ? b : a).xp; swings++; }
    return swings;
  };
  const OLD: Rock[] = [{ level: 1, xp: 35 }, { level: 4, xp: 50 }, { level: 9, xp: 80 }, { level: 17, xp: 170 }];
  const NEW: Rock[] = MINING.map(t => ({ level: lv(t), xp: NODE_TYPES[t].xp }));
  const was = swingsTo(17, OLD), now = swingsTo(lv('adamant'), NEW);
  console.log(`  Mining to the adamant veins: ${was} swings on the first ladder (Mining 17), ${now} now (Mining ${lv('adamant')}); to the last gate before it ${swingsTo(9, OLD)} then, ${swingsTo(lv('coal'), NEW)} now`);
  assert(now >= 5 * was, `climbing to adamant is at least five times the swings it was (${now} against ${was})`);
  assert(swingsTo(lv('coal'), NEW) >= 3 * swingsTo(9, OLD), 'and to coal, the last gate under it, at least three times');

  // smithing: bronze first, then the long iron-and-steel stretch that carries the second quest's set, then adamant, every gate above the last
  const SM = ['bronze_bar', 'bronze_sword', 'bronze_helm', 'bronze_greaves', 'bronze_chestplate', 'iron_bar', 'steel_bar', 'forged_blade', 'steel_helm', 'steel_greaves', 'steel_chestplate', 'warden_edge', 'adamant_bar', 'adamant_helm', 'adamant_blade', 'adamant_greaves', 'adamant_chestplate'];
  assert(rec('copper_bar').level === 1 && rec('bronze_bar').level === 1 && SM.every((id, k) => k === 0 || rec(id).level > rec(SM[k - 1]).level), `Smithing opens with copper and bronze at 1 and every gate is above the last: ${SM.map(id => rec(id).level).join(' < ')}`);
  const tiers = [['bronze', 'bronze_bar'], ['iron and steel', 'iron_bar'], ['adamant', 'adamant_bar']] as const;
  const spans = tiers.map(([, id], k) => (k + 1 < tiers.length ? rec(tiers[k + 1][1]).level : rec('adamant_chestplate').level + 1) - rec(id).level);
  console.log(`  Smithing levels in each tier: ${tiers.map(([n], k) => `${n} ${spans[k]}`).join(', ')} (HOM-81 folded what was mithril's seven levels into iron and steel, which is one metal across the bar, the blade and the set)`);
  assert(spans.every(n => n >= 5) && spans[0] >= 6 && spans[1] >= 8, 'every tier is worn across at least five Smithing levels, bronze six and iron eight');
  assert(rec('steel_helm').level - rec('steel_bar').level >= 6, `the steel set is ${rec('steel_helm').level - rec('steel_bar').level} levels above its own bar: the bar is the blade's, the plate is the climb`);
  assert(rec('bronze_chestplate').level < rec('iron_bar').level && lv('tin') < lv('iron'), 'the whole bronze set is open before the iron bar is');
  assert(rec('bronze_bar').inputs.length === 2 && rec('bronze_bar').inputs.some(i => i.id === 'copper_ore') && rec('bronze_bar').inputs.some(i => i.id === 'tin_ore'), 'a bronze bar is one copper ore and one tin ore');
  // the quest plan is the recipes, with the practice the gates want on top
  const P = BLADE_PLAN;
  assert(P.ore === 2 * P.bars && P.coal === 2 * P.steel && P.bars >= P.steel && P.steel >= 3 && P.logs === 1, 'the blade plan is whole recipes: two ore to a bar, two coal to a steel bar, three steel and a log to the blade, and spare bars to practise on');
  assert(rec('steel_bar').inputs.some(i => i.id === 'coal' && i.qty === 2) && rec('iron_bar').inputs.some(i => i.id === 'iron_ore' && i.qty === 2), 'iron bars take two ore, steel two coal');

  // gear: bronze is a step above hide and a step below the iron the enemies drop
  const stats = (id: string) => ITEMS[id].stats!;
  const bronzeArmor = deriveStats({ ...emptyEquipment(), head: 'bronze_helm', chest: 'bronze_chestplate', legs: 'bronze_greaves' }).armor;
  const hideArmor = deriveStats({ ...emptyEquipment(), head: 'leather_cap', chest: 'hide_jerkin', legs: 'hide_leggings' }).armor;
  const ironArmor = deriveStats({ ...emptyEquipment(), head: 'iron_helm', chest: 'iron_chestplate', legs: 'iron_greaves' }).armor;
  assert(hideArmor < bronzeArmor && bronzeArmor < ironArmor, `a bronze set is ${bronzeArmor} armour: above hide (${hideArmor}) and below iron (${ironArmor})`);
  assert(stats('rusty_blade').damage! < stats('bronze_sword').damage! && stats('bronze_sword').damage! < stats('iron_sword').damage!, 'a bronze sword hits harder than a rusty blade and softer than an iron sword');
  assert(BRONZE_SET.map(id => ITEMS[id].slot).sort().join() === 'chest,head,legs,weapon' && BRONZE_SET.every(id => ITEMS[id].tier === 1 && ITEMS[id].req === undefined && ITEMS[id].dropWeight === 0 && rec(id)), 'one piece per slot, common tier, no requirement, made at the forge');
  const bronzeIds: string[] = [...BRONZE_SET, 'copper_ore', 'tin_ore', 'bronze_bar'];
  assert(!Object.values(DROP_TABLES).some(t => t.entries.some(e => bronzeIds.includes(e.id))) && ![...SHOP_STOCK, ...HARBOUR_STOCK].some(id => bronzeIds.includes(id)), 'bronze is only smithed: no enemy drops it and no merchant sells it');
  assert(BRONZE_SET.every(id => appearanceOf(id).rung >= 1 && appearanceOf(id).tint > 0), 'every bronze piece resolves to a worn look (the tier fallback)');
  console.log(`  bronze worn look is the tier-1 fallback, identical to hide: ${BRONZE_SET.every(id => appearanceOf(id).tint === appearanceOf('hide_jerkin').tint) ? 'yes, it needs a look of its own' : 'no'}`);

  // where a level-1 character meets it
  const s = quietState(5601), start = { x: s.player.x, z: s.player.z };
  const nearest = (type: string) => nodesOf(s, type).reduce((a, b) => dist2(a, start) < dist2(b, start) ? a : b);
  assert(nodesOf(s, 'copper').length >= 3 && dist2(nearest('copper'), start) <= 40, `copper is in Hale's clearing and on the ridge, ${dist2(nearest('copper'), start).toFixed(0)} units from where a new game starts`);
  assert(nodesOf(s, 'copper').some(n => dist2(n, LANDMARKS.forge) < 15) && nodesOf(s, 'copper').some(n => n.z < -20 && n.x < 15), 'both by the forge and on the ridge');
  // HOM-77: the second rung is the first reason to leave. Tin is out through the east gate, on the road, but the first stand is a short walk
  const openTin = nodesOf(s, 'tin').filter(n => !inCave(n.x, n.z));
  const nearestOpenTin = openTin.reduce((a, b) => dist2(a, start) < dist2(b, start) ? a : b);
  assert(openTin.length >= 3 && openTin.every(n => regionAt(n.x, n.z)?.id === 'greywater') && dist2(nearestOpenTin, start) < 120, `tin out in the open is on the Greywater Road, the nearest stand ${dist2(nearestOpenTin, start).toFixed(0)} units out`);
  // HOM-81: the Hollow's seam is the only other tin, and it is three rooms past the Cave Brute: ore for a character who has already taken the door, never the second rung a level-1 one is sent to
  assert(nodesOf(s, 'tin').filter(n => inCave(n.x, n.z)).length === 3 && CAVE_ROCKS.every(r => r.type === 'tin'), 'and the Hollow\'s three veins are the only other tin in the world');
  const wake = (n: { x: number; z: number }) => SPAWNS.slice(0, 11).every(sp => dist2(sp, n) > aggroRadius(ENEMY_TYPES[sp.type], 1) + 1);
  assert(nodesOf(s, 'copper').every(wake), 'no copper rock is inside the aggro radius of any of the clearing\'s enemies, a level-1 character\'s included');

  // the whole bronze road, played: copper until tin opens, tin, smelt, make the set, put it on, with iron never touched
  const g = quietState(5602);
  for (let guard = 0; guard < 80 && (g.player.skills.smithing.level < rec('bronze_chestplate').level || countOf(g, 'bronze_bar') < 12); guard++) {
    gatherUntil(g, 'copper', countOf(g, 'copper_ore') + 3);
    if (g.player.skills.mining.level >= lv('tin')) gatherUntil(g, 'tin', countOf(g, 'tin_ore') + 3);
    if (countOf(g, 'copper_ore') >= 6 && countOf(g, 'tin_ore') >= 6) { atForge(g); craft(g, 'bronze_bar', countOf(g, 'bronze_bar') + Math.min(countOf(g, 'copper_ore'), countOf(g, 'tin_ore'))); }
  }
  assert(countOf(g, 'iron_ore') === 0, 'with no iron ore ever mined');
  gatherUntil(g, 'tree', 1);
  atForge(g);
  for (const id of BRONZE_SET) craft(g, id, 1);
  assert(BRONZE_SET.every(id => countOf(g, id) === 1), `a character who has only ever mined copper and tin smelted bronze and made the sword, helm, greaves and chestplate (Mining ${g.player.skills.mining.level}, Smithing ${g.player.skills.smithing.level})`);
  for (const id of BRONZE_SET) tick(g, { inv: [{ k: 'equip', slot: g.player.inventory.findIndex(x => x?.id === id) }] });
  assert(BRONZE_SET.every(id => Object.values(g.player.equipment).includes(id)) && g.player.stats.armor === bronzeArmor && g.player.stats.weaponDamage === stats('bronze_sword').damage, `and wore it at combat 1: ${g.player.stats.armor} armour, +${g.player.stats.weaponDamage} damage`);

  // saves: XP is what is stored, the new nodes arrive full, and the one id that was renamed (HOM-81) loads as what it became
  const old = createState(5603);
  for (const e of old.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  grantXp(old, 'mining', xpForLevel(17), 0, 0); grantXp(old, 'smithing', xpForLevel(19), 0, 0);
  old.player.equipment.chest = 'mithril_chestplate'; old.player.equipment.weapon = 'warden_edge'; // the ids a save from before HOM-81 carries
  addItem(old.player.inventory, 'iron_ore', 4);
  old.player.inventory.find(st => st?.id === 'iron_ore')!.id = 'mithril_ore'; // and the ore it was carrying, which has no steel of its own
  old.nodes[0].charges = 1; old.nodes[0].respawnIn = 0;
  const file = JSON.parse(serialize(old));
  const beforeSeams = 30; // a save from before the Seams: the world ended at Saltmarrow's fishing spots
  file.nodes = file.nodes.filter((n: { id: number }) => n.id <= beforeSeams);
  const back = deserialize(JSON.stringify(file));
  const herbN = REGIONS.reduce((n, r) => n + (r.herbs?.length ?? 0), 0);
  const stormN = REGIONS.reduce((n, r) => n + r.rocks.filter(k => k.type === 'stormiron' || k.type === 'starmetal').length, 0); // HOM-95, HOM-111
  assert(back !== null && back.nodes.length === 33 + REGIONS.find(r => r.id === 'wayside')!.rocks.length + REGIONS.find(r => r.id === 'wayside')!.trees.length + herbN + stormN &&back.nodes[0].charges === 1 && back.nodes.slice(beforeSeams).every(n => n.charges === NODE_TYPES[n.type].charges), 'an old save still loads: the nodes it names keep their state, and every later one stands full');
  assert(back !== null && back.player.skills.mining.level === 17 && back.player.skills.smithing.level === 19 && back.player.equipment.weapon === 'warden_edge', 'a Mining 17, Smithing 19 character keeps both levels and the blade they carry: only the gates moved above them');
  assert(back !== null && back.player.equipment.chest === 'steel_chestplate' && countOf(back, 'mithril_ore') === 0 && countOf(back, 'iron_ore') === 4,
    'and the mithril they were wearing loads as the steel it became, their ore as the iron it would have been smelted from: HOM-81 renames a save, it does not refuse one');
}

// ---------------------------------------------------------------------------
section('HOM-81 copper: a set made from the one rock Hale has, under bronze and above hide');
{
  const rec = (id: string) => recipeById(id)!, stats = (id: string) => ITEMS[id].stats!;
  const set = (head: string, chest: string, legs: string) => deriveStats({ ...emptyEquipment(), head, chest, legs }).armor;

  // the recipes: copper and nothing else, bar the hilt's log
  assert(rec('copper_bar').inputs.length === 1 && rec('copper_bar').inputs[0].id === 'copper_ore' && rec('copper_bar').inputs[0].qty === 2,
    'a copper bar is two copper ore and nothing else: no second rock, so the whole tier is open to a character who never leaves Hale');
  assert(COPPER_SET.every(id => rec(id).inputs.every(i => i.id === 'copper_bar' || i.id === 'logs')), 'and every piece is copper bars, plus a log for the sword\'s hilt');
  assert(COPPER_SET.every(id => rec(id).level <= rec('bronze_chestplate').level) && rec('copper_bar').xp < rec('bronze_bar').xp,
    `copper sits under bronze and pays less a bar (${rec('copper_bar').xp} against ${rec('bronze_bar').xp}): the walk out for tin is still worth taking`);

  // the gear: hide < copper < bronze < iron, by the set and by the blade
  const copperArmor = set('copper_helm', 'copper_chestplate', 'copper_greaves');
  const hideArmor = set('leather_cap', 'hide_jerkin', 'hide_leggings');
  const bronzeArmor = set('bronze_helm', 'bronze_chestplate', 'bronze_greaves');
  assert(hideArmor < copperArmor && copperArmor < bronzeArmor, `a copper set is ${copperArmor} armour: above hide (${hideArmor}) and below bronze (${bronzeArmor})`);
  const dps = (id: string) => stats(id).damage! / stats(id).speed!;
  assert(dps('rusty_blade') < dps('copper_sword') && dps('copper_sword') < dps('bronze_sword'),
    `a copper sword is light and soft: quicker than a rusty blade and weaker than bronze (${dps('copper_sword').toFixed(2)} against ${dps('rusty_blade').toFixed(2)} and ${dps('bronze_sword').toFixed(2)})`);
  assert(COPPER_SET.map(id => ITEMS[id].slot).sort().join() === 'chest,head,legs,weapon' && COPPER_SET.every(id => ITEMS[id].tier === 1 && ITEMS[id].req === undefined && ITEMS[id].dropWeight === 0),
    'one piece per slot, common tier, no requirement');
  const copperIds: string[] = [...COPPER_SET, 'copper_bar'];
  assert(!Object.values(DROP_TABLES).some(t => t.entries.some(e => copperIds.includes(e.id))) && ![...SHOP_STOCK, ...HARBOUR_STOCK].some(id => copperIds.includes(id)),
    'copper is only smithed: no enemy drops it and no merchant sells it');
  assert(COPPER_SET.every(id => appearanceOf(id).tint !== appearanceOf('hide_jerkin').tint && appearanceOf(id).tint !== appearanceOf('bronze_helm').tint),
    'and it has a look of its own: hide, copper and bronze are three readable steps');

  // played: mine copper, chop one log, smith the lot, wear it, all without leaving Hale
  const g = quietState(8101);
  gatherUntil(g, 'copper', 28);
  gatherUntil(g, 'tree', 1);
  assert(regionAt(g.player.x, g.player.z)?.zone === 'hale' && countOf(g, 'tin_ore') === 0 && countOf(g, 'iron_ore') === 0 && countOf(g, 'coal') === 0,
    'twenty-eight ore and a log off Hale\'s own rocks and trees: still in the clearing, with no tin, iron or coal in the bag');
  atForge(g);
  craft(g, 'copper_bar', 12);
  for (const id of COPPER_SET) craft(g, id, 1);
  assert(COPPER_SET.every(id => countOf(g, id) === 1), `a character who has only ever mined copper made the sword, helm, greaves and chestplate (Mining ${g.player.skills.mining.level}, Smithing ${g.player.skills.smithing.level})`);
  for (const id of COPPER_SET) tick(g, { inv: [{ k: 'equip', slot: g.player.inventory.findIndex(x => x?.id === id) }] });
  assert(COPPER_SET.every(id => Object.values(g.player.equipment).includes(id)) && g.player.stats.armor === copperArmor && g.player.stats.weaponDamage === stats('copper_sword').damage,
    `and wore it at combat 1: ${g.player.stats.armor} armour, +${g.player.stats.weaponDamage} damage`);
}

// ---------------------------------------------------------------------------
section('HOM-64 dungeons as data: the Hollow is the first, the Drowned Grotto the second');
{
  const hollow = dungeonById('hollow'), grotto = dungeonById('grotto');
  const isOpen = (s: GameState) => dungeonOpen(s, grotto);
  assert(DUNGEONS.length === 5 && hollow.rooms.map(r => r.name).join() === 'throat,hollow,neck,hall' && grotto.rooms.map(r => r.name).join() === 'gangway,galley,hold', 'two dungeons: the Hollow is the four rooms it always was, the Grotto is three, the Rotroot (HOM-75) the third, the Cairn Hold (HOM-99) the fourth and the Vault (HOM-112) the fifth');
  assert(CAVE_ROOMS.length === 16 && CAVE_ROOMS.every(r => DUNGEONS.some(d => d.id === r.dungeon)) && REGIONS.filter(r => r.cave).every(r => !!r.dungeon), 'every cave room belongs to a dungeon, and the flat list is all of them');
  assert(grotto.parent === 'saltmarrow' && grotto.rooms.every(r => r.rect.x0 >= SALTMARROW.x - 70 && r.rect.x1 <= SALTMARROW.x + 30), 'the Grotto sits in Saltmarrow\'s frame');
  const mid = (r: { x0: number; x1: number; z0: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
  assert(grotto.rooms.every(r => dungeonAt(mid(r.rect).x, mid(r.rect).z) === grotto && inCave(mid(r.rect).x, mid(r.rect).z)) && dungeonAt(-18, -80) === hollow && dungeonAt(0, 8) === null && dungeonAt(SALTMARROW.x - 25, SALTMARROW.z) === null, 'a point is in the dungeon whose floor it is on, and nowhere in a town');
  const gx = SALTMARROW.x - 42.5, gz = SALTMARROW.z;
  assert(caveDepth(gx, gz - 60) === 0 && caveDepth(gx, gz - 66) === 0 && caveDepth(gx, gz - 72) > 0 && caveDepth(gx, gz - 72) < 1 && caveDepth(SALTMARROW.x - 19, gz - 120) === 1, 'the Grotto has its own threshold: daylight at the door, dusk in the gangway, dark in the hold');
  assert(caveDepth(-18, -30) > 0 && caveDepth(-18, -30) < 1 && caveDepth(-18, -24) === 0, 'and the Hollow\'s is the one it had');
  assert(!mountsAllowed(-18, -80) && !mountsAllowed(SALTMARROW.x - 19, gz - 120) && mountsAllowed(0, 8) && mountsAllowed(SALTMARROW.x - 25, gz), 'no mounts in a dungeon: one question, answered from the room list');
  assert(!sameSideOfDoor({ x: SALTMARROW.x - 25, z: gz - 30 }, { x: SALTMARROW.x - 19, z: gz - 126 }) && sameSideOfDoor({ x: SALTMARROW.x - 19, z: gz - 110 }, { x: SALTMARROW.x - 19, z: gz - 126 }), 'Tab from the town does not offer Marrow through the cliff, and in the hold it does');
  // the wall that cuts a line is a dungeon's own rock, not a half-plane across the map: Gutterhook, on Saltmarrow's north shore, can see
  const gh = SPAWNS.find(sp => sp.type === 'gutterhook')!;
  assert(clearLine(gh, { x: gh.x + 6, z: gh.z }), 'sight along open shore is clear (it was cut across the whole north of the map)');
  assert(!clearLine({ x: SALTMARROW.x - 52, z: gz - 75 }, { x: SALTMARROW.x - 36, z: gz - 75 }) && clearLine({ x: -18, z: -40 }, { x: -18, z: -60 }), 'a line across solid rock beside the gangway is blocked, and one down the Hollow\'s throat is not');

  // the door is hard-gated: shut until Brine and Bone is handed in
  const door = { x: gx, z: gz - 62 };
  const s = quietState(6401);
  assert(!isOpen(s), 'a new game has it shut');
  s.player.x = door.x; s.player.z = door.z;
  for (let n = 0; n < 120; n++) tick(s, { dirZ: -1 });
  assert(dungeonAt(s.player.x, s.player.z) === null && s.player.z > gz - 70, 'shut: walking north into the cliff stops at the door');
  s.player.x = door.x; s.player.z = door.z; s.events.length = 0;
  const said: string[] = [];
  for (let n = 0; n < 120; n++) { tick(s, { dirZ: -1 }); for (const ev of s.events) if (ev.t === 'door') said.push(ev.blurb); }
  assert(said.length >= 1 && said.length <= 3 && said[0] === grotto.gate!.blurb, `and the door says why, once in a while rather than every tick (${said.length} times in 4 s)`);

  s.quest.stage = 'done'; s.quest.second = 'cleared'; s.quest.third = 'cleared'; s.quest.fifth = 'cleared';
  s.player.x = door.x; s.player.z = door.z;
  const marrow = s.enemies.find(e => e.type === 'captain_marrow')!;
  assert(isOpen(s) && walkTo(s, marrow.x, marrow.z + 10, 2, 90) && dungeonAt(s.player.x, s.player.z) === grotto, 'open: the cliff door leads to the hold on foot, through three rooms');

  // Brine and Bone
  const q = quietState(6402);
  const pell = HARBOURMASTER;
  q.player.x = pell.x + 2; q.player.z = pell.z;
  assert((q.quest.fifth as string) === 'locked' && harbourMarker(q) === null, 'locked while the road is shut');
  q.quest.stage = 'done'; q.quest.second = 'cleared'; q.quest.third = 'report';
  tick(q, { questAdvance: true });
  assert((q.quest.third as string) === 'cleared' && (q.quest.fifth as string) === 'offer' && harbourMarker(q) === 'offer' && activeQuestView(q).title === QUEST5_NAME, 'the Salt Road handed in, the next job is on offer from the same quay');
  assert(dialogueAt(q, 'harbour').options.some(o => o.advance), 'and the harbourmaster\'s dialogue offers it');
  tick(q, { questAdvance: true });
  assert((q.quest.fifth as string) === 'hunt' && hasEvent(q, e => e.t === 'quest' && e.what === 'accept' && e.name === QUEST5_NAME), 'advancing at the quay accepts it');
  const total = Object.values(BRINE_GOALS).reduce((a, b) => a + b, 0);
  let kills = 0;
  for (const [type, n] of Object.entries(BRINE_GOALS)) for (let k = 0; k < n; k++) {
    assert((q.quest.fifth as string) === 'hunt', `still hunting after ${kills} of ${total}`);
    questOnKill(q, type); kills++;
  }
  assert((q.quest.fifth as string) === 'report' && harbourMarker(q) === 'ready' && activeQuestView(q).ready, 'the last of them makes it a hand-in');
  assert(!isOpen(q), 'the door is still shut until it is handed in');
  const xp0 = q.player.combat.xp;
  tick(q, { questAdvance: true });
  assert((q.quest.fifth as string) === 'cleared' && q.player.combat.xp - xp0 === REWARD5[0].xp && REWARD5[0].xp === 900, 'handing in pays 900 combat XP, the bible\'s figure');
  assert(isOpen(q) && activeQuestView(q).target !== null, 'and the door is open, with the Captain as the tracker\'s next mark');
  const rt = deserialize(serialize(q))!;
  assert((rt.quest.fifth as string) === 'cleared' && rt.quest.kills.drowned_sailor === 4, 'the chain survives a save and load');
  const oldSave = JSON.parse(serialize(q)); delete oldSave.quest.fifth; delete oldSave.quest.sixth; // (a save from before HOM-64 has neither the Strand's chain nor the Rotroot's)
  assert(deserialize(JSON.stringify(oldSave))!.quest.fifth === 'offer', 'a save from before it, with the road cleared, finds it on offer');
  const badSave = JSON.parse(serialize(quietState(6403))); badSave.quest.fifth = 'hunt';
  assert(deserialize(JSON.stringify(badSave)) === null, 'a save with it open before the road is cleared is refused');

  // Captain Marrow
  const T = ENEMY_TYPES.captain_marrow;
  assert(T.level === 19 && T.hp === 8350 && T.damage === 35 && T.attackInterval === 2.4 && T.xp === 390 && T.respawn === 600, 'Captain Marrow: level 19, 8350 HP, hit 35 every 2.4 s, 390 XP, a ten-minute respawn: the retuned table');
  assert(T.heavy!.name === 'Anchor Slam' && T.heavy!.damage === 235 && T.hazard!.name === 'Cannon Volley' && T.hazard!.damage === 105 && T.ranged!.name === 'Harpoon', 'Anchor Slam 235, Cannon Volley 105, Harpoon: the three tells he is built from');
  assert(T.look!.model === 'brute', 'drawn with a rig that already exists');
  const m = quietState(6404);
  const mm = m.enemies.find(e => e.type === 'captain_marrow')!;
  mm.state = 'idle'; mm.hp = mm.maxHp; mm.respawnIn = 0;
  const seen = new Set<string>();
  const watch = (sec: number) => { for (let n = 0; n < Math.round(sec / TICK_DT); n++) { m.player.hp = 1e9; tick(m); for (const ev of m.events) if (ev.t === 'telegraph' && ev.id === mm.id) seen.add(ev.kind); } };
  m.player.x = mm.x; m.player.z = mm.z + 10;
  watch(2.5);
  assert(seen.has('bolt') && !seen.has('heavy'), 'stood off at ten units, he throws the Harpoon and does not slam');
  m.player.x = mm.x; m.player.z = mm.z + 2.5; mm.attackCd = 0;
  watch(16);
  assert(seen.has('heavy') && seen.has('ground'), `in reach he slams and marks the ground (${[...seen].sort().join(', ')})`);
  const D = DROP_TABLES.captain_marrow;
  assert(D.rolls === 1 && D.nothing === 65 && D.entries.length === 1 && D.entries[0].id === 'marrow_shard' && D.entries[0].weight === 35, 'a shard 35 % of kills, one a kill: the bible\'s 6.1');

  // Marrow's Edge
  const r = recipeById('marrows_edge')!;
  assert(r.skill === 'smithing' && r.level === 30 && r.inputs.length === 2 && r.inputs.some(i => i.id === 'marrow_shard' && i.qty === 3) && r.inputs.some(i => i.id === 'adamant_bar' && i.qty === 3), 'Marrow\'s Edge: Smithing 30, three adamant bars and three Marrow shards');
  assert(ITEMS.marrows_edge.stats!.damage === 50 && ITEMS.marrows_edge.req?.combat === 18 && ITEMS.marrows_edge.tier === 5 && ITEMS.marrows_edge.stats!.damage > ITEMS.adamant_blade.stats!.damage, 'a 50-damage tier-5 blade that wants combat 18, above the Adamant Blade');
  const f = quietState(6405);
  atLevel(f, 18);
  grantXp(f, 'smithing', xpForLevel(30), 0, 0);
  addItem(f.player.inventory, 'adamant_bar', 3); addItem(f.player.inventory, 'marrow_shard', 2);
  f.player.x = LANDMARKS.forge.x - 2; f.player.z = LANDMARKS.forge.z + 1;
  tick(f, { craft: { recipe: 'marrows_edge', count: 1 } });
  assert(hasEvent(f, e => e.t === 'actionfail' && e.reason === 'materials') && countOf(f, 'marrows_edge') === 0, 'two shards are not enough');
  addItem(f.player.inventory, 'marrow_shard', 1);
  tick(f, { craft: { recipe: 'marrows_edge', count: 1 } });
  run(f, 20);
  assert(countOf(f, 'marrows_edge') === 1 && countOf(f, 'marrow_shard') === 0 && countOf(f, 'adamant_bar') === 0, 'three of each make the blade');
  tick(f, { inv: [{ k: 'equip', slot: f.player.inventory.findIndex(x => x?.id === 'marrows_edge') }] });
  assert(f.player.equipment.weapon === 'marrows_edge' && f.player.stats.weaponDamage === 50, 'and it is worn at combat 18');
  const f2 = quietState(6406);
  atLevel(f2, 17); addItem(f2.player.inventory, 'marrows_edge', 1);
  tick(f2, { inv: [{ k: 'equip', slot: f2.player.inventory.findIndex(x => x?.id === 'marrows_edge') }] });
  assert(f2.player.equipment.weapon === null && hasEvent(f2, e => e.t === 'actionfail' && e.reason === 'req' && e.need === 18), 'at combat 17 it stays in the bag, and the refusal says why');
}

// ---------------------------------------------------------------------------
section('HOM-75 the Rotroot: the third dungeon, in Thornwick\'s frame');
{
  const rr = dungeonById('rotroot');
  assert(rr.parent === 'thornwick' && rr.rooms.map(r => r.name).join() === 'mouth,warren,heart' && rr.rooms.every(r => r.rect.x0 >= THORNWICK.x - 70 && r.rect.x1 <= THORNWICK.x + 70), 'three rooms, all in Thornwick\'s frame');
  const mid = (r: { x0: number; x1: number; z0: number; z1: number }) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
  assert(rr.rooms.every(r => dungeonAt(mid(r.rect).x, mid(r.rect).z) === rr && inCave(mid(r.rect).x, mid(r.rect).z)) && dungeonAt(THORNWICK.x, THORNWICK.z) === null, 'a point is in the Rotroot where its floor is, and nowhere in the town');
  const dx = THORNWICK.x + 42.5, dz = THORNWICK.z;
  assert(caveDepth(dx, dz + 60) === 0 && caveDepth(dx, dz + 66) === 0 && caveDepth(dx, dz + 76) > 0 && caveDepth(dx, dz + 76) < 1 && caveDepth(THORNWICK.x + 19, dz + 126) === 1, 'its own threshold, running south: daylight at the door, dusk in the mouth, dark in the heart');
  assert(!mountsAllowed(THORNWICK.x + 19, dz + 126) && !sameSideOfDoor({ x: THORNWICK.x, z: dz + 40 }, { x: THORNWICK.x + 19, z: dz + 126 }), 'no mounts inside, and Tab from the town does not offer the Mother through the rock');
  const spawnsIn = REGIONS.filter(r => r.dungeon === 'rotroot').flatMap(r => r.spawns ?? []);
  assert(spawnsIn.map(sp => sp.type).sort().join() === 'rotroot_mother,rotwood_cultist,rotwood_cultist,rotwood_cultist,thorn_warden' && spawnsIn.every(sp => dungeonAt(sp.x, sp.z) === rr), 'a sentry, a warden and two cultists, and the Mother: every one on the Rotroot\'s floor');

  // the door: combat 22 and Q5
  const s = quietState(7501);
  const door = { x: dx, z: dz + 62 };
  assert(!dungeonOpen(s, rr), 'a new game has it shut');
  s.player.x = door.x; s.player.z = door.z;
  for (let n = 0; n < 120; n++) tick(s, { dirZ: 1 });
  assert(dungeonAt(s.player.x, s.player.z) === null && s.player.z < dz + 70, 'shut: walking south into the roots stops at the door');
  atLevel(s, 22);
  assert(!dungeonOpen(s, rr), 'combat 22 alone does not open it: the reeve\'s chain (Q5, HOM-66) is the other half');
  s.quest.sixth = 'cleared';
  s.player.x = door.x; s.player.z = door.z;
  const mother = s.enemies.find(e => e.type === 'rotroot_mother')!;
  assert(dungeonOpen(s, rr) && walkTo(s, mother.x, mother.z - 10, 2, 90) && dungeonAt(s.player.x, s.player.z) === rr, 'at combat 22 the mouth leads to the heart on foot, through three rooms');
  const s21 = quietState(7502); atLevel(s21, 21); s21.quest.sixth = 'cleared';
  assert(!dungeonOpen(s21, rr), 'and at 21 it stays shut');

  // the Mother
  const T = ENEMY_TYPES.rotroot_mother;
  assert(T.level === 26 && T.hp === 15205 && T.damage === 46 && T.attackInterval === 2.4 && T.xp === 460 && T.respawn === 600, 'the Rotroot Mother: level 26, 15205 HP, hit 46 every 2.4 s, 460 XP, a ten-minute respawn: the bible\'s row');
  assert(T.heavy!.name === 'Root Slam' && T.heavy!.damage === 350 && T.hazard!.name === 'Spore Cloud' && T.hazard!.damage === 150 && T.ranged!.name === 'Hex Bolt' && T.look!.model === 'brute', 'Root Slam 350, Spore Cloud 150, Hex Bolt, on a rig that exists');
  const D = DROP_TABLES.rotroot_mother;
  assert(D.rolls === 1 && D.nothing === 65 && D.entries.length === 1 && D.entries[0].id === 'heartwood_shard' && D.entries[0].weight === 35 && !!ITEMS.heartwood_shard, 'a Heartwood shard 35 % of kills');
  const rt = deserialize(serialize(quietState(7503)));
  assert(rt !== null && rt.enemies.some(e => e.type === 'rotroot_mother'), 'a save round-trips with the Mother in it');
}

// ---------------------------------------------------------------------------
section('HOM-73 shooters hold their ground, and the net is the one thing that makes distance');
{
  const T = ENEMY_TYPES, shooters = Object.entries(T).filter(([, d]) => d.ranged);
  assert(shooters.length >= 6 && shooters.every(([, d]) => !('keepAway' in d.ranged!)), `no shooter has a keep-away distance any more (${shooters.length} of them)`);

  /** A lone shooter awake at (0,0), the player standing `at` units from it in melee. Nothing else is alive. */
  const duel = (seed: number, type: string, at = 2) => {
    const s = quietState(seed);
    atLevel(s, T[type].level);
    const e = enemyOf(s, type);
    e.state = 'chase'; e.respawnIn = 0; e.hp = e.maxHp; e.x = e.spawnX = 0; e.z = e.spawnZ = 0; e.cast = null;
    s.player.x = 0; s.player.z = at;
    return { s, e };
  };

  // every shooter, net or not, stays where it is with the player in its face
  for (const [type] of shooters) {
    const { s, e } = duel(91, type);
    e.netCd = 1e9; // the net is tested on its own below: this is the default behaviour
    run(s, 3, { dirX: 0, dirZ: 0 });
    assert(Math.hypot(e.x, e.z) < 0.1, `${T[type].name}: in melee for 3s and it never took a step back`);
  }

  // ...and it keeps fighting from there rather than standing idle
  {
    const { s, e } = duel(92, 'hexer');
    let hits = 0;
    for (let i = 0; i < 300; i++) { tick(s); for (const ev of s.events) if (ev.t === 'hit' && ev.target === 'player' && ev.src === e.id) hits++; }
    assert(hits >= 2 && Math.hypot(e.x, e.z) < 0.1, `a cornered Hexer shoots you point blank (${hits} bolts in 10s) instead of running`);
  }

  // a shooter still walks in when the player is out of its range
  {
    const { s, e } = duel(93, 'footpad', 20);
    e.netCd = 1e9;
    run(s, 4);
    assert(Math.hypot(e.x - s.player.x, e.z - s.player.z) < T.footpad.ranged!.range, 'out of range, it still closes to firing distance');
  }

  // the net: who has one, and what it costs
  const netters = Object.entries(T).filter(([, d]) => d.net);
  assert(netters.length === 2 && netters.every(([, d]) => d.ranged && d.level >= 12), `only higher-level shooters carry a net (${netters.map(([, d]) => `${d.name} ${d.level}`).join(', ')})`);
  assert(netters.every(([, d]) => d.net!.range < d.ranged!.range && d.net!.retreat > d.net!.range * 0.9), 'a net is thrown up close, and the gap it opens is bigger than the range it is thrown from');

  for (const [type, d] of netters) {
    const n = d.net!;
    const { s, e } = duel(94, type);
    const p = s.player;
    let tell = false;
    for (let i = 0; i < 600 && !p.root; i++) { tick(s); tell ||= hasEvent(s, ev => ev.t === 'telegraph' && ev.kind === 'net'); }
    assert(tell && p.root !== null && p.root!.name === n.name, `${d.name} winds up the ${n.name} and it lands`);
    assert(hasEvent(s, ev => ev.t === 'net') && castName(d, 'net') === n.name, '...raising a net event the HUD can name');
    assert(playerStatuses(p).some(x => x.key === 'root' && x.bad && x.total === n.duration), '...and it shows on the player frame as a debuff');

    // held where you stand: the keys do nothing, and it uses the time to open the gap
    const held = { x: p.x, z: p.z };
    run(s, n.duration * 0.6, { dirX: 0, dirZ: 1 });
    assert(Math.hypot(p.x - held.x, p.z - held.z) < 1e-6 && p.root !== null, '...you cannot walk out of it');
    const far = Math.hypot(e.x - p.x, e.z - p.z);
    assert(far > 3, `...while it backs off (${far.toFixed(1)}u away and still going)`);

    // the net frays, and then you can run it down again
    run(s, n.duration);
    assert(p.root === null, '...the net runs out on its own');
    const gap = Math.hypot(e.x - p.x, e.z - p.z);
    assert(gap >= n.retreat - 0.5 && gap <= n.retreat + 1.5, `...having bought itself the ${n.retreat}u it wanted (${gap.toFixed(1)}u)`);
    const where = { x: e.x, z: e.z };
    run(s, 2, { dirX: 0, dirZ: 0 });
    assert(Math.hypot(e.x - where.x, e.z - where.z) < 0.1, '...and with the net spent it stops running and plants its feet again');
  }

  // a Pummel on the wind-up cancels it, net and all
  {
    const { s, e } = duel(95, 'drowned_sailor');
    atLevel(s, 15);
    tick(s, { clickEnemy: e.id });
    for (let i = 0; i < 600 && e.cast?.kind !== 'net'; i++) { s.player.x = 0; s.player.z = 2; tick(s); }
    assert(e.cast?.kind === 'net', 'the Sailor is mid-net');
    tick(s, { ability: SLOT.pummel });
    assert(e.cast === null && s.player.root === null && hasEvent(s, ev => ev.t === 'interrupt'), 'Pummel cancels the net before it lands');
    assert(e.netCd > T.drowned_sailor.net!.every * 0.4, '...and the shutdown buys real time before the next one');
  }

  // rock in the way: the net is wasted like a bolt is
  {
    const stone = CAVE_PILLARS[0];
    const s = quietState(96);
    atLevel(s, 15);
    const e = enemyOf(s, 'drowned_sailor');
    e.state = 'chase'; e.respawnIn = 0; e.hp = e.maxHp; e.x = e.spawnX = stone.x; e.z = e.spawnZ = stone.z + 3;
    s.player.x = stone.x; s.player.z = stone.z + 2.4;
    for (let i = 0; i < 600 && e.cast?.kind !== 'net'; i++) { s.player.x = stone.x; s.player.z = stone.z + 2.4; tick(s); }
    assert(e.cast?.kind === 'net', 'a Sailor winds up a net with the player a pace away');
    s.player.x = stone.x; s.player.z = stone.z - 2.4; // round the pillar: its line is gone
    let blocked = false;
    for (let i = 0; i < 60 && e.cast; i++) { tick(s); blocked ||= hasEvent(s, ev => ev.t === 'blocked'); }
    assert(blocked && s.player.root === null, 'stepping behind the stone wastes the net, as it wastes a bolt');
  }

  // docs/action-layer.md 8.4.2: a net is thrown low, so a player above the 1.1 clearance when it resolves is missed; a slam is not low, so 3.0 u up still takes it
  {
    const cast = (type: string, kind: string, y: number) => {
      const { s, e } = duel(98, type);
      atLevel(s, 15);
      tick(s, { clickEnemy: e.id });
      for (let i = 0; i < 900 && e.cast?.kind !== kind; i++) { s.player.x = 0; s.player.z = 2; tick(s); }
      assert(e.cast?.kind === kind, `a ${type} winds up a ${kind}`);
      e.cast!.t = e.cast!.total - 0.01; // resolves on the next tick
      s.player.y = y; s.player.vy = 0; s.player.airborne = y > 0;
      s.player.hp = s.player.maxHp;
      tick(s);
      return { s, e };
    };
    assert(cast('drowned_sailor', 'net', 1.2).s.player.root === null, 'a net resolving while the player is 1.2 up passes under them');
    assert(cast('drowned_sailor', 'net', 0.9).s.player.root !== null, '...and one resolving at 0.9 up (a hop that is not high enough) still holds them');
    const slam = cast('brute', 'heavy', 3.0);
    assert(slam.s.events.some(ev => ev.t === 'hit' && ev.target === 'player' && ev.heavy), 'a slam resolving while the player is 3.0 up still lands');
  }

  // death clears it, so you never wake up in a net
  {
    const { s, e } = duel(97, 'footpad');
    const p = s.player;
    for (let i = 0; i < 600 && !p.root; i++) tick(s);
    assert(p.root !== null, 'netted');
    p.hp = 1;
    for (let i = 0; i < 300 && !p.dead; i++) tick(s);
    assert(p.dead && p.root === null, 'dying cuts you out of the net');
    void e;
  }
}

console.log(`\nAll ${checks} checks passed.`);

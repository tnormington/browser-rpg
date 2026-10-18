// Combat rules: targeting, abilities, damage, enemy AI, death and respawn. Pure sim, no DOM/Three.
import type { GameState, Enemy, EnemyState } from '../sim';
import { grantXp } from './skills';
import { rollDrops } from './loot';
import { questOnKill } from './quest';
import { nextRandom } from './rng';
import { resolveCollisions, sameSideOfDoor } from './world';
import {
  ABILITIES, ENEMY_TYPES, GCD, QUEUE_WINDOW, CRIT_CHANCE, CRIT_MULT, ENERGY_MAX, ENERGY_REGEN,
  RESPAWN_DELAY, OOC_DELAY, OOC_REGEN_FRAC, TAB_RANGE, PLAYER_SPAWN, maxHpForLevel, powerForLevel,
  STAGGER_TIME, STAGGER_HEAVY_KEEP, ACQUIRE_RANGE, ACQUIRE_BEHIND_RANGE, FRONT_HALF_ARC,
  AUTO_RANGE, AUTO_BASE, AUTO_WEAPON_SHARE, AUTO_SLOT, BARE_SWING, RECAP_WINDOW, RECAP_MAX, TICK_DT,
} from './data';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const rand = (s: GameState) => nextRandom(s);

export const enemyById = (s: GameState, id: number | null): Enemy | undefined =>
  id === null ? undefined : s.enemies.find(e => e.id === id);

const targetable = (e: Enemy) => e.state !== 'dead' && e.state !== 'return';
/** Can the player single this one out from where they stand? Not through the cave wall: see sameSideOfDoor. */
const pickable = (s: GameState, e: Enemy) => targetable(e) && sameSideOfDoor(s.player, e);

// ---------- player stats ----------

export function refreshPlayerStats(s: GameState, fillHp: boolean) {
  const p = s.player;
  p.maxHp = maxHpForLevel(p.combat.level);
  p.maxEnergy = ENERGY_MAX;
  if (fillHp) p.hp = p.maxHp;
}

// ---------- targeting ----------

/** The player's own Escape: deliberate, so it raises nothing. */
export function clearTarget(s: GameState) { s.targetId = null; }

/**
 * The sim took the target away (it died, or evaded home): clear it and say which, so the HUD never has to guess.
 * Every involuntary loss goes through here; the player's own Escape and retargeting do not.
 */
function dropTarget(s: GameState, id: number, reason: 'dead' | 'evade') {
  if (s.targetId !== id) return;
  s.targetId = null;
  s.events.push({ t: 'untarget', id, reason });
}

/** Click an enemy. Clicking one that cannot be targeted (a corpse, one walking home) leaves the current target alone. */
export function setTarget(s: GameState, id: number | null) {
  if (id === null) { s.targetId = null; return; }
  const e = enemyById(s, id);
  if (e && targetable(e)) s.targetId = e.id;
}

/** Is the enemy inside the cone in front of the player? (An enemy standing on top of the player counts: facing is meaningless there.) */
function inFront(s: GameState, e: Enemy): boolean {
  const p = s.player;
  if (dist(e, p) < 0.3) return true;
  const d = Math.atan2(e.x - p.x, e.z - p.z) - p.facing;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) <= FRONT_HALF_ARC * Math.PI / 180;
}

const byDistance = (s: GameState) => (a: Enemy, b: Enemy) => dist(a, s.player) - dist(b, s.player);

/** The Tab order right now: everything in front, nearest first, then everything behind, nearest first. */
function tabOrder(s: GameState): number[] {
  const cands = s.enemies.filter(e => pickable(s, e) && dist(e, s.player) <= TAB_RANGE).sort(byDistance(s));
  return [...cands.filter(e => inFront(s, e)), ...cands.filter(e => !inFront(s, e))].map(e => e.id);
}

/**
 * Tab. The first press starts a cycle: the order is computed once and frozen, so while the player holds a target from it
 * (and walks, turns, or kites) each further press steps to the next entry instead of reshuffling under their fingers.
 * Entries that died or left range are skipped. Past the end it starts a fresh cycle, which is when newcomers appear.
 * With nothing to pick it changes nothing: it never takes a target away.
 */
export function tabTarget(s: GameState) {
  const p = s.player, cycle = s.tab;
  if (cycle && s.targetId !== null && cycle.order[cycle.at] === s.targetId) {
    for (let i = cycle.at + 1; i < cycle.order.length; i++) {
      const e = enemyById(s, cycle.order[i]);
      if (e && targetable(e) && dist(e, p) <= TAB_RANGE) { s.tab = { order: cycle.order, at: i }; s.targetId = e.id; return; }
    }
  }
  const order = tabOrder(s);
  if (!order.length) return;
  const at = order.length > 1 && order[0] === s.targetId ? 1 : 0; // Tab always moves off what you hold when it can
  s.tab = { order, at };
  s.targetId = order[at];
}

/**
 * Target the nearest hostile in front of the player, within ACQUIRE_RANGE; failing that, the nearest anything within
 * ACQUIRE_BEHIND_RANGE even if behind (something biting your back should not be unreachable). Returns whether it found one.
 * This is the entry point for a forgiving click and for an attack key pressed with nothing targeted.
 */
export function acquireFront(s: GameState): boolean {
  const alive = s.enemies.filter(e => pickable(s, e)).sort(byDistance(s));
  const pick = alive.find(e => dist(e, s.player) <= ACQUIRE_RANGE && inFront(s, e))
    ?? alive.find(e => dist(e, s.player) <= ACQUIRE_BEHIND_RANGE);
  if (!pick) { s.events.push({ t: 'fail', reason: 'target', slot: AUTO_SLOT }); return false; }
  s.targetId = pick.id;
  return true;
}

// ---------- auto-attack ----------

function setAutoAttack(s: GameState, on: boolean) {
  if (s.player.autoAttack === on) return;
  s.player.autoAttack = on;
  s.events.push({ t: 'auto', on });
}

/**
 * The attack key: disarm if swinging; otherwise make sure there is a target (acquiring one in front if there is none) and arm.
 * Arming needs no prior combat: it is the declaration of intent, and the swings that follow are what start the fight.
 */
export function toggleAutoAttack(s: GameState) {
  const p = s.player;
  if (p.dead) return;
  if (p.autoAttack) return setAutoAttack(s, false);
  const t = enemyById(s, s.targetId);
  if (!(t && targetable(t)) && !acquireFront(s)) return;
  setAutoAttack(s, true);
}

/**
 * The swing timer ticks whether or not auto-attack is armed (toggling cannot reset it), clamped to the weapon's interval so
 * swapping to a quicker weapon takes effect at once. Armed, with a live target in reach and the timer up, the player swings:
 * no GCD, no energy, and moving does not stop it. Out of reach the timer waits at zero and the swing lands the moment the
 * target is in reach. With no live target auto-attack disarms (it never carries on to the next thing you tab to).
 */
function updateAutoAttack(s: GameState, dt: number) {
  const p = s.player;
  p.swing = Math.min(Math.max(0, p.swing - dt), p.stats.swingInterval);
  if (!p.autoAttack) return;
  const t = enemyById(s, s.targetId);
  if (!t || !targetable(t)) return setAutoAttack(s, false);
  if (p.swing > 0 || dist(p, t) > AUTO_RANGE) return;
  p.swing = p.stats.swingInterval;
  p.action = null;
  p.facing = Math.atan2(t.x - p.x, t.z - p.z);
  s.events.push({ t: 'swing', target: t.id, x: t.x, z: t.z });
  // speed sets the rhythm, not the damage per second: a quicker weapon hits proportionally lighter
  const power = powerForLevel(p.combat.level) * p.stats.swingInterval / BARE_SWING;
  const { amount, crit } = rollDamage(s, AUTO_BASE, power, p.stats.weaponDamage * AUTO_WEAPON_SHARE);
  damageEnemy(s, t, amount, crit, AUTO_SLOT);
}

// ---------- damage ----------

function rollDamage(s: GameState, base: number, power: number, bonus: number) {
  const crit = rand(s) < CRIT_CHANCE;
  const amount = Math.max(1, Math.round((base + bonus) * power * (0.9 + 0.2 * rand(s)) * (crit ? CRIT_MULT : 1)));
  return { amount, crit };
}

function damageEnemy(s: GameState, e: Enemy, amount: number, crit: boolean, slot: number, dot = false) {
  if (!targetable(e)) return;
  e.hp = Math.max(0, e.hp - amount);
  e.hitFlash = 0.12;
  s.player.outOfCombat = 0;
  s.events.push({ t: 'hit', target: e.id, x: e.x, z: e.z, amount, crit, slot, dot });
  aggro(s, e);
  if (e.hp <= 0) killEnemy(s, e);
}

function killEnemy(s: GameState, e: Enemy) {
  const def = ENEMY_TYPES[e.type];
  e.state = 'dead';
  e.deadFor = 0;
  e.respawnIn = def.respawn;
  e.bleed = null;
  e.cast = null;
  e.stagger = 0;
  dropTarget(s, e.id, 'dead');
  s.events.push({ t: 'kill', id: e.id, x: e.x, z: e.z });
  rollDrops(s, e.type, e.x, e.z);
  questOnKill(s, e.type);
  if (grantXp(s, 'combat', def.xp, e.x, e.z) > 0) refreshPlayerStats(s, true); // levelling restores health: a punchy reward
}

// ---------- abilities ----------

type Fail = 'range' | 'cooldown' | 'gcd' | 'energy' | 'target' | 'locked' | 'nocast';

function fail(s: GameState, reason: Fail, slot: number) {
  s.events.push({ t: 'fail', reason, slot });
}

/** Press an ability slot. Honors GCD, cooldown, energy and range; queues presses just before the ability is ready. */
export function pressAbility(s: GameState, slot: number) {
  const p = s.player;
  if (p.dead || !ABILITIES[slot]) return;
  const a = ABILITIES[slot];
  if (p.combat.level < a.unlockLevel) return fail(s, 'locked', slot);
  // a press this close to ready (its own cooldown or the GCD, whichever is later) is held and fires the moment it is
  const gcdWait = a.offGcd ? 0 : p.gcd;
  if (p.cd[slot] > QUEUE_WINDOW) return fail(s, 'cooldown', slot);
  if (gcdWait > QUEUE_WINDOW) return fail(s, 'gcd', slot);
  if (gcdWait > 0 || p.cd[slot] > 0) { p.queued = slot; return; }
  tryUse(s, slot);
}

function tryUse(s: GameState, slot: number) {
  const p = s.player, a = ABILITIES[slot];
  if (p.cd[slot] > 0) return fail(s, 'cooldown', slot);
  let target: Enemy | undefined;
  if (a.kind !== 'heal') {
    target = enemyById(s, s.targetId);
    if (!target || !targetable(target)) return fail(s, 'target', slot);
    if (dist(p, target) > a.range) return fail(s, 'range', slot);
    if (a.kind === 'interrupt' && !target.cast) return fail(s, 'nocast', slot); // costs nothing and does nothing
  }
  if (p.energy < a.cost) return fail(s, 'energy', slot);

  p.energy -= a.cost;
  p.action = null; // fighting interrupts gathering/crafting
  if (!a.offGcd) p.gcd = GCD;
  p.cd[slot] = a.cooldown;
  p.cast = 0.12;
  s.events.push({ t: 'cast', slot });
  const power = powerForLevel(p.combat.level);

  if (target) p.facing = Math.atan2(target.x - p.x, target.z - p.z);
  if (target && (a.kind === 'strike' || a.kind === 'cleave')) setAutoAttack(s, true); // a melee ability on a target starts the swings, as in WoW

  if (a.kind === 'heal') {
    const amount = Math.min(p.maxHp - p.hp, Math.round(a.damage * power));
    p.hp += amount;
    s.events.push({ t: 'heal', x: p.x, z: p.z, amount });
  } else if (target && a.kind === 'interrupt') {
    const def = ENEMY_TYPES[target.type];
    target.cast = null;
    target.stagger = STAGGER_TIME;
    target.attackCd = Math.max(target.attackCd, 1);
    if (def.heavy) target.heavyCd = Math.max(target.heavyCd, def.heavy.every * STAGGER_HEAVY_KEEP);
    if (def.hazard) target.hazardCd = Math.max(target.hazardCd, def.hazard.every * STAGGER_HEAVY_KEEP);
    p.outOfCombat = 0;
    s.events.push({ t: 'interrupt', id: target.id, x: target.x, z: target.z });
  } else if (target && a.kind === 'cleave') {
    // everything in front of the player, within reach and inside the arc centred on the line to the target (the target always qualifies)
    const aim = Math.atan2(target.x - p.x, target.z - p.z), half = ((a.arc ?? 120) / 2) * Math.PI / 180;
    const angleTo = (e: Enemy) => {
      const d = Math.atan2(e.x - p.x, e.z - p.z) - aim;
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    };
    const hit = s.enemies.filter(e => targetable(e) && dist(p, e) <= a.range && (e === target || angleTo(e) <= half))
      .sort((m, n) => dist(p, m) - dist(p, n));
    for (const e of hit) {
      const { amount, crit } = rollDamage(s, a.damage, power, p.stats.weaponDamage);
      damageEnemy(s, e, amount, crit, slot);
    }
  } else if (target) {
    const { amount, crit } = rollDamage(s, a.damage, power, p.stats.weaponDamage);
    if (a.kind === 'dot') target.bleed = { ticks: a.dotTicks!, timer: 1, damage: Math.round(a.dotDamage! * power) };
    damageEnemy(s, target, amount, crit, slot);
  }
}

// ---------- per-tick updates ----------

export function updatePlayerCombat(s: GameState, dt: number) {
  const p = s.player;
  p.energy = Math.min(p.maxEnergy, p.energy + ENERGY_REGEN * dt);
  p.cast = Math.max(0, p.cast - dt);
  p.outOfCombat += dt;
  setInCombat(s, p.outOfCombat <= OOC_DELAY || s.enemies.some(e => e.state === 'chase'));
  if (!p.inCombat) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * OOC_REGEN_FRAC * dt);
  for (let i = 0; i < p.cd.length; i++) p.cd[i] = Math.max(0, p.cd[i] - dt);
  p.gcd = Math.max(0, p.gcd - dt);
  announceUnlocks(s);
  if (p.queued !== null && (ABILITIES[p.queued].offGcd || p.gcd === 0) && p.cd[p.queued] === 0) {
    const slot = p.queued;
    p.queued = null;
    tryUse(s, slot);
  }
  updateAutoAttack(s, dt);
}

/** In combat: recent damage either way, or something hostile is chasing you. Out of it, health comes back. */
function setInCombat(s: GameState, on: boolean) {
  if (s.player.inCombat === on) return;
  s.player.inCombat = on;
  s.events.push({ t: 'combat', on });
}

/** Hand over abilities as combat levels are crossed. `p.unlocked` is the level already announced, so each unlock fires exactly once, even across a multi-level jump. */
function announceUnlocks(s: GameState) {
  const p = s.player;
  if (p.combat.level <= p.unlocked) return;
  ABILITIES.forEach((a, slot) => {
    if (a.unlockLevel > p.unlocked && a.unlockLevel <= p.combat.level) s.events.push({ t: 'unlock', slot, level: a.unlockLevel });
  });
  p.unlocked = p.combat.level;
}

function killPlayer(s: GameState) {
  const p = s.player;
  const now = s.tick * TICK_DT, last = p.recap[p.recap.length - 1];
  const recap = p.recap.map(h => ({ src: h.src, what: h.what, amount: h.amount, heavy: h.heavy, ago: now - h.at }));
  p.recap = [];
  setAutoAttack(s, false);
  setInCombat(s, false);
  p.y = 0; p.vy = 0; p.airborne = false;
  p.hp = 0;
  p.dead = true;
  p.action = null;
  s.interact = null;
  p.respawnIn = RESPAWN_DELAY;
  p.queued = null;
  s.targetId = null;
  s.moveTarget = null;
  s.events.push({ t: 'death', killer: last ? `${ENEMY_TYPES[last.src].name}: ${last.what}` : '', recap });
}

export function updatePlayerDeath(s: GameState, dt: number) {
  const p = s.player;
  p.respawnIn -= dt;
  if (p.respawnIn > 0) return;
  p.dead = false;
  p.x = PLAYER_SPAWN.x; p.z = PLAYER_SPAWN.z; p.facing = Math.PI; p.moving = false;
  refreshPlayerStats(s, true);
  p.energy = p.maxEnergy;
  p.cd.fill(0);
  p.gcd = 0;
  p.outOfCombat = OOC_DELAY;
  s.events.push({ t: 'respawn' });
}

function startReturn(e: Enemy) {
  e.state = 'return';
  e.evadeFor = 0;
  e.hp = e.maxHp; // evade: resets fully
  e.bleed = null;
  e.cast = null;
  e.stagger = 0;
}

/** Wake an idle enemy (and its pack-mates). */
function aggro(s: GameState, e: Enemy) {
  if (e.state !== 'idle') return;
  const def = ENEMY_TYPES[e.type];
  e.state = 'chase';
  e.attackCd = Math.max(e.attackCd, 0.6);
  if (def.heavy) e.heavyCd = Math.max(e.heavyCd, def.heavy.first);
  if (def.hazard) e.hazardCd = Math.max(e.hazardCd, def.hazard.first);
  if (def.pack) for (const o of s.enemies) if (o !== e && o.type === e.type && o.state === 'idle' && dist(o, e) <= def.pack) aggro(s, o);
}

function hurtPlayer(s: GameState, e: Enemy, amount: number, what: string, heavy = false) {
  const p = s.player;
  p.hp = Math.max(0, p.hp - amount);
  p.outOfCombat = 0;
  p.action = null; // getting hit breaks concentration
  const now = s.tick * TICK_DT;
  p.recap = [...p.recap.filter(h => now - h.at <= RECAP_WINDOW), { src: e.type, what, amount, heavy, at: now }].slice(-RECAP_MAX);
  s.events.push({ t: 'hit', target: 'player', x: p.x, z: p.z, amount, crit: false, slot: -1, dot: false, heavy, src: e.id });
  if (p.hp <= 0) killPlayer(s);
}

/** Begin a wind-up: the enemy plants its feet and the clock the player reads starts. */
function startCast(s: GameState, e: Enemy, kind: 'heavy' | 'bolt', windup: number) {
  e.cast = { kind, t: 0, total: windup };
  s.events.push({ t: 'telegraph', id: e.id, kind, windup });
}

/** Mark the ground under the player: the circle is fixed here, and lands where they were, not where they are. */
function startGroundCast(s: GameState, e: Enemy) {
  const h = ENEMY_TYPES[e.type].hazard!, p = s.player;
  e.cast = { kind: 'ground', t: 0, total: h.windup, x: p.x, z: p.z, radius: h.radius };
  s.events.push({ t: 'telegraph', id: e.id, kind: 'ground', windup: h.windup, x: p.x, z: p.z, radius: h.radius });
}

/** Tick a wind-up. The enemy stands still and watches the player; when it completes, the attack lands only if the player is still in reach. */
function updateCast(s: GameState, e: Enemy, dt: number) {
  const p = s.player, def = ENEMY_TYPES[e.type], c = e.cast!;
  e.facing = Math.atan2(p.x - e.x, p.z - e.z);
  c.t += dt;
  if (c.t < c.total) return;
  e.cast = null;
  e.attackCd = def.attackInterval;
  e.swing = 0.15;
  if (c.kind === 'ground') {
    const h = def.hazard!;
    e.hazardCd = h.every;
    s.events.push({ t: 'slam', id: e.id, x: c.x!, z: c.z!, radius: h.radius });
    if (!p.dead && dist({ x: c.x!, z: c.z! }, p) <= h.radius) hurtPlayer(s, e, Math.max(1, Math.round(h.damage * (1 - p.stats.reduction))), h.name, true);
  } else if (c.kind === 'heavy') {
    const h = def.heavy!;
    e.heavyCd = h.every;
    s.events.push({ t: 'slam', id: e.id, x: e.x, z: e.z, radius: h.radius });
    if (!p.dead && dist(e, p) <= h.radius) hurtPlayer(s, e, Math.max(1, Math.round(h.damage * (1 - p.stats.reduction))), h.name, true);
  } else if (!p.dead && dist(e, p) <= def.ranged!.range + 2) { // a little slack: a pace back mid-cast does not dodge a bolt, leaving its reach does
    hurtPlayer(s, e, Math.max(1, Math.round(def.damage * (0.85 + 0.3 * rand(s)) * (1 - p.stats.reduction))), def.ranged!.name);
  }
}

/** Ranged AI: close to firing range, back away from melee, shoot on cooldown. */
function updateRanged(s: GameState, e: Enemy, dt: number) {
  const p = s.player, def = ENEMY_TYPES[e.type], r = def.ranged!, d = dist(e, p);
  e.facing = Math.atan2(p.x - e.x, p.z - e.z);
  if (d > r.range * 0.9) stepToward(e, p.x, p.z, def.speed, dt, r.range * 0.8);
  else if (d < r.keepAway && dist(e, { x: e.spawnX, z: e.spawnZ }) < def.leash * 0.8) {
    // back off along the line away from the player; cornered or at the end of its leash it stands and shoots
    stepToward(e, e.x + (e.x - p.x), e.z + (e.z - p.z), def.speed, dt, 0);
    e.facing = Math.atan2(p.x - e.x, p.z - e.z);
  }
  if (d <= r.range && e.attackCd <= 0) startCast(s, e, 'bolt', r.windup);
}

function stepToward(e: Enemy, tx: number, tz: number, speed: number, dt: number, stopAt: number) {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d > 1e-6) e.facing = Math.atan2(dx, dz);
  const move = Math.min(Math.max(0, d - stopAt), speed * dt);
  if (move <= 0) return;
  e.x += (dx / d) * move;
  e.z += (dz / d) * move;
  resolveCollisions(e, ENEMY_TYPES[e.type].radius);
}

export function updateEnemies(s: GameState, dt: number) {
  const p = s.player;
  for (const e of s.enemies) {
    const def = ENEMY_TYPES[e.type];
    if (e.state === 'dead') {
      e.deadFor += dt;
      e.respawnIn -= dt;
      if (e.respawnIn <= 0) {
        e.hp = e.maxHp; e.x = e.spawnX; e.z = e.spawnZ; e.state = 'idle'; e.attackCd = 0;
      }
      continue;
    }
    if (e.bleed && e.state !== 'return') {
      e.bleed.timer -= dt;
      if (e.bleed.timer <= 0) {
        e.bleed.timer += 1;
        const dmg = e.bleed.damage;
        if (--e.bleed.ticks <= 0) e.bleed = null;
        damageEnemy(s, e, dmg, false, 2, true);
        if ((e.state as EnemyState) === 'dead') continue;
      }
    }
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.heavyCd = Math.max(0, e.heavyCd - dt);
    e.hazardCd = Math.max(0, e.hazardCd - dt);
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.swing = Math.max(0, e.swing - dt);
    const dp = dist(e, p);

    if (e.state === 'idle') {
      if (!p.dead && dp <= def.aggroRadius) aggro(s, e);
    } else if (e.state === 'chase') {
      if (p.dead || dist(e, { x: e.spawnX, z: e.spawnZ }) > def.leash) {
        startReturn(e);
        dropTarget(s, e.id, 'evade');
      } else if (e.stagger > 0) {
        e.stagger = Math.max(0, e.stagger - dt); // stunned by a Pummel
      } else if (e.cast) {
        updateCast(s, e, dt);
      } else if (def.hazard && e.hazardCd <= 0 && dp <= def.hazard.range) {
        startGroundCast(s, e);
      } else if (def.ranged) {
        updateRanged(s, e, dt);
      } else {
        stepToward(e, p.x, p.z, def.speed, dt, def.attackRange * 0.9);
        if (dist(e, p) <= def.attackRange && e.attackCd <= 0) {
          if (def.heavy && e.heavyCd <= 0) startCast(s, e, 'heavy', def.heavy.windup);
          else {
            e.attackCd = def.attackInterval;
            e.swing = 0.15;
            hurtPlayer(s, e, Math.max(1, Math.round(def.damage * (0.85 + 0.3 * rand(s)) * (1 - p.stats.reduction))), 'Melee');
          }
        }
      }
    } else if (e.state === 'return') {
      stepToward(e, e.spawnX, e.spawnZ, def.speed * 1.8, dt, 0);
      e.evadeFor += dt;
      // walking home takes dist / speed; a walk that takes three times that is stuck behind scenery, and an evading enemy
      // cannot be targeted, so it is put home rather than left untouchable
      const home = dist(e, { x: e.spawnX, z: e.spawnZ });
      if (home >= 0.3 && e.evadeFor > 2 + 3 * home / (def.speed * 1.8)) { e.x = e.spawnX; e.z = e.spawnZ; }
      if (dist(e, { x: e.spawnX, z: e.spawnZ }) < 0.3) e.state = 'idle';
    }
  }
}

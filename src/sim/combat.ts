// Combat rules: targeting, abilities, damage, enemy AI, death and respawn. Pure sim, no DOM/Three.
import type { GameState, Enemy, EnemyState } from '../sim';
import { grantXp } from './skills';
import { rollDrops } from './loot';
import { nextRandom } from './rng';
import { resolveCollisions } from './world';
import {
  ABILITIES, ENEMY_TYPES, GCD, QUEUE_WINDOW, CRIT_CHANCE, CRIT_MULT, ENERGY_MAX, ENERGY_REGEN,
  RESPAWN_DELAY, OOC_DELAY, OOC_REGEN_FRAC, TAB_RANGE, PLAYER_SPAWN, maxHpForLevel, powerForLevel,
} from './data';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const rand = (s: GameState) => nextRandom(s);

export const enemyById = (s: GameState, id: number | null): Enemy | undefined =>
  id === null ? undefined : s.enemies.find(e => e.id === id);

const targetable = (e: Enemy) => e.state !== 'dead' && e.state !== 'return';

// ---------- player stats ----------

export function refreshPlayerStats(s: GameState, fillHp: boolean) {
  const p = s.player;
  p.maxHp = maxHpForLevel(p.combat.level);
  p.maxEnergy = ENERGY_MAX;
  if (fillHp) p.hp = p.maxHp;
}

// ---------- targeting ----------

export function clearTarget(s: GameState) { s.targetId = null; }

export function setTarget(s: GameState, id: number | null) {
  const e = enemyById(s, id);
  s.targetId = e && targetable(e) ? e.id : null;
}

/** Cycle to the next-nearest valid enemy. Wraps around; starts at the nearest. */
export function tabTarget(s: GameState) {
  const p = s.player;
  const cands = s.enemies.filter(e => targetable(e) && dist(e, p) <= TAB_RANGE)
    .sort((a, b) => dist(a, p) - dist(b, p));
  if (!cands.length) { s.targetId = null; return; }
  const i = cands.findIndex(e => e.id === s.targetId);
  s.targetId = cands[(i + 1) % cands.length].id;
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
  if (e.state === 'idle') { e.state = 'chase'; e.attackCd = Math.max(e.attackCd, 0.6); }
  if (e.hp <= 0) killEnemy(s, e);
}

function killEnemy(s: GameState, e: Enemy) {
  const def = ENEMY_TYPES[e.type];
  e.state = 'dead';
  e.deadFor = 0;
  e.respawnIn = def.respawn;
  e.bleed = null;
  if (s.targetId === e.id) s.targetId = null;
  s.events.push({ t: 'kill', id: e.id, x: e.x, z: e.z });
  rollDrops(s, e.type, e.x, e.z);
  if (grantXp(s, 'combat', def.xp, e.x, e.z) > 0) refreshPlayerStats(s, true); // levelling restores health: a punchy reward
}

// ---------- abilities ----------

type Fail = 'range' | 'cooldown' | 'gcd' | 'energy' | 'target';

function fail(s: GameState, reason: Fail, slot: number) {
  s.events.push({ t: 'fail', reason, slot });
}

/** Press an ability slot. Honors GCD, cooldown, energy and range; queues presses just before GCD end. */
export function pressAbility(s: GameState, slot: number) {
  const p = s.player;
  if (p.dead || !ABILITIES[slot]) return;
  if (p.cd[slot] > 0) return fail(s, 'cooldown', slot);
  if (p.gcd > 0) {
    if (p.gcd <= QUEUE_WINDOW) { p.queued = slot; return; }
    return fail(s, 'gcd', slot);
  }
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
  }
  if (p.energy < a.cost) return fail(s, 'energy', slot);

  p.energy -= a.cost;
  p.action = null; // fighting interrupts gathering/crafting
  p.gcd = GCD;
  p.cd[slot] = a.cooldown;
  p.cast = 0.12;
  s.events.push({ t: 'cast', slot });
  const power = powerForLevel(p.combat.level);

  if (target) p.facing = Math.atan2(target.x - p.x, target.z - p.z);

  if (a.kind === 'heal') {
    const amount = Math.min(p.maxHp - p.hp, Math.round(a.damage * power));
    p.hp += amount;
    s.events.push({ t: 'heal', x: p.x, z: p.z, amount });
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
  if (p.outOfCombat > OOC_DELAY) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * OOC_REGEN_FRAC * dt);
  for (let i = 0; i < p.cd.length; i++) p.cd[i] = Math.max(0, p.cd[i] - dt);
  p.gcd = Math.max(0, p.gcd - dt);
  if (p.gcd === 0 && p.queued !== null) {
    const slot = p.queued;
    p.queued = null;
    tryUse(s, slot);
  }
}

function killPlayer(s: GameState) {
  const p = s.player;
  p.hp = 0;
  p.dead = true;
  p.action = null;
  s.interact = null;
  p.respawnIn = RESPAWN_DELAY;
  p.queued = null;
  s.targetId = null;
  s.moveTarget = null;
  s.events.push({ t: 'death' });
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
  e.hp = e.maxHp; // evade: resets fully
  e.bleed = null;
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
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.swing = Math.max(0, e.swing - dt);
    const dp = dist(e, p);

    if (e.state === 'idle') {
      if (!p.dead && dp <= def.aggroRadius) { e.state = 'chase'; e.attackCd = Math.max(e.attackCd, 0.6); }
    } else if (e.state === 'chase') {
      if (p.dead || dist(e, { x: e.spawnX, z: e.spawnZ }) > def.leash) {
        startReturn(e);
        if (s.targetId === e.id) s.targetId = null;
      } else {
        stepToward(e, p.x, p.z, def.speed, dt, def.attackRange * 0.9);
        if (dist(e, p) <= def.attackRange && e.attackCd <= 0) {
          e.attackCd = def.attackInterval;
          e.swing = 0.15;
          const amount = Math.max(1, Math.round(def.damage * (0.85 + 0.3 * rand(s)) * (1 - p.stats.reduction)));
          p.hp = Math.max(0, p.hp - amount);
          p.outOfCombat = 0;
          p.action = null; // getting hit breaks concentration
          s.events.push({ t: 'hit', target: 'player', x: p.x, z: p.z, amount, crit: false, slot: -1, dot: false });
          if (p.hp <= 0) killPlayer(s);
        }
      }
    } else if (e.state === 'return') {
      stepToward(e, e.spawnX, e.spawnZ, def.speed * 1.8, dt, 0);
      if (dist(e, { x: e.spawnX, z: e.spawnZ }) < 0.3) e.state = 'idle';
    }
  }
}

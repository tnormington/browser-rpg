// A player policy that fights one enemy (and the mate that came with it) to the death on the real sim and reports what it cost (HOM-174). It is the bench's balance bot
// (bench/combat.mjs --mode ttk, HOM-53) without the browser: the same rotation (auto-attack, Pummel on a wind-up, Crushing Blow > Serrated Throw > Strike, queued inside the
// GCD window), the same stand-off 7 units off, the same line gear (docs/world-design.md 3.4), the same reading of a slam (Pummel it, else step out) - driven through `step()`
// at one decision a tick, which is the bench's `--fast 1`. Nothing here is in the game; it is what src/echo.test.ts measures a row with.
import { Enemy, GameState, Input, NO_INPUT, TICK_DT, createState, step } from './sim';
import { ABILITIES, defOf } from './sim/data';
import { refreshPlayerStats } from './sim/combat';
import { xpForLevel } from './sim/xp';
import { clearLine } from './sim/sight';
import { inSafeZone, regionAt } from './sim/world';
import { PROCS } from './sim/procs';

/** What the player answers. A bot that answers nothing pays what the pace model says (3.6); the reference player of 3.4a Pummels a wind-up and steps out of slams and off marked ground. */
export interface Policy { pummel: boolean; dodge: 'none' | 'all' }
export const ANSWERS_NOTHING: Policy = { pummel: false, dodge: 'none' };
export const REFERENCE: Policy = { pummel: true, dodge: 'all' };

/** `ttk` is first swing to last kill in seconds; `lossPct` is gross damage taken as a share of max health (no heals: the bot has none). */
export interface Fight { ttk: number | null; lossPct: number; died: boolean; kills: number }

const SLOT = { strike: 0, crushing: 1, throw: 2, pummel: 5 };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** `fn` with the proc layer off: the model is what the kit deals on its own cooldowns, and a window opening inside a measurement would hide a drift in it (golden-path's retune figures do the same). */
export function withoutProcs<T>(fn: () => T): T {
  const defs = Object.values(PROCS), was = defs.map(d => d.chance);
  for (const d of defs) d.chance = 0;
  try { return fn(); } finally { defs.forEach((d, i) => { d.chance = was[i]; }); }
}

/**
 * A quiet world at `level` with the first spawn of `type` alone in it, the player on the line gear for it (weapon `weapon`, armour `armour`) stood 7 units off on open ground of the
 * same floor. `prepare` dresses the enemy (an Echo, a template row, or nothing) before anything wakes; one tick is run after it so a mate it called has stood up.
 */
export function arena(seed: number, type: string, level: number, weapon: number, armour: number, prepare: (s: GameState, e: Enemy) => void) {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level; p.unlocked = level;
  p.learned = ABILITIES.filter(a => a.trainer).map(a => a.name);
  refreshPlayerStats(s, true);
  p.energy = p.maxEnergy;
  Object.assign(p.stats, { weaponDamage: weapon, armor: armour, reduction: Math.min(0.8, armour / (armour + 40)), swingInterval: 2.4 });
  const enemy = s.enemies.find(x => x.type === type)!;
  // netCd is the one cooldown a wake does not set (it runs down while the enemy stands idle, so a shooter that has stood a while has its net ready): a fresh state has it at its `first`
  Object.assign(enemy, { state: 'idle', respawnIn: 0, deadFor: 0, x: enemy.spawnX, z: enemy.spawnZ, attackCd: 0, cast: null, bleed: null, netCd: 0 });
  prepare(s, enemy);
  enemy.hp = enemy.maxHp;
  // the stand-off: 7 units from the post, the first of eight directions that is on the enemy's own floor with a clear line to it and out of any town
  const floor = regionAt(enemy.spawnX, enemy.spawnZ);
  const spot = [0, 1, 2, 3, 4, 5, 6, 7].map(k => ({ x: enemy.spawnX + Math.cos(k * Math.PI / 4) * 7, z: enemy.spawnZ + Math.sin(k * Math.PI / 4) * 7 }))
    .find(c => regionAt(c.x, c.z) === floor && clearLine(c, { x: enemy.spawnX, z: enemy.spawnZ }) && !inSafeZone(c.x, c.z));
  if (!spot) throw new Error(`no stand-off point beside ${type}`);
  p.x = spot.x; p.z = spot.z; p.facing = Math.atan2(enemy.spawnX - p.x, enemy.spawnZ - p.z);
  step(s, NO_INPUT); // a mate that was called stands up on this tick
  return { s, enemy };
}

/** Fight until everything that came with `enemy` is dead, the player is, or `cap` seconds have gone. */
export function fight({ s, enemy }: ReturnType<typeof arena>, policy: Policy, cap = 300): Fight {
  const p = s.player;
  const group = s.enemies.filter(e => e === enemy || (e.mateOf === enemy.id && e.state !== 'dead'));
  let firstSwing: number | null = null, lastKill: number | null = null, kills = 0, taken = 0, lastSelect = -99, lastAttack = -99;
  const start = s.tick, plans = new Map<number, { x: number; z: number } | null>(); // the answer to each wind-up in progress, by enemy id
  const ready = (slot: number, dd: number, range: number, t: Enemy) => {
    const w = p.gcd, en = Math.min(p.maxEnergy, p.energy + 8 * w);
    return p.cd[slot] <= w + 0.02 && en >= ABILITIES[slot].cost && dd <= range && (slot !== SLOT.throw || !t.bleed);
  };
  while (s.tick - start < cap / TICK_DT && !p.dead && !group.every(e => e.state === 'dead')) {
    const alive = group.filter(e => e.state !== 'dead' && e.state !== 'return');
    const chasers = alive.filter(e => e.state === 'chase').sort((a, b) => dist(a, p) - dist(b, p));
    const t = s.enemies.find(e => e.id === s.targetId);
    const input: Partial<Input> = {};
    if (!t || t.state === 'dead' || t.state === 'return') {
      const c = chasers[0] ?? alive[0];
      if (c && s.tick - lastSelect >= 6) { lastSelect = s.tick; input.clickEnemy = c.id; }
      const d = c ? dist(c, p) || 1 : 0;
      if (c && d > 2.2) { input.dirX = (c.x - p.x) / d; input.dirZ = (c.z - p.z) / d; }
    } else {
      const dd = dist(t, p), d = dd || 1;
      const wantsPummel = policy.pummel && !!t.cast && t.cast.t >= 0.25 && p.cd[SLOT.pummel] <= 0.02 && p.energy >= ABILITIES[SLOT.pummel].cost && dd <= 3.5;
      // a wind-up is answered once, on the tick it is first seen (docs/world-design.md 3.4a): Pummel it if that will be ready, else step out of it, straight away from the slam's
      // centre or the marked circle's to a little past its edge, and stay out until it has landed. A wind-up first seen late is not dodged
      for (const m of alive) {
        if (!m.cast) { plans.delete(m.id); continue; }
        if (plans.has(m.id)) continue;
        const c = m.cast, canPummel = policy.pummel && m === t && p.cd[SLOT.pummel] <= 0.3 && p.energy >= ABILITIES[SLOT.pummel].cost && dd <= 3.5;
        const [cx, cz, R] = c.kind === 'heavy' ? [m.x, m.z, defOf(m).heavy!.radius + 0.9] : c.kind === 'ground' ? [c.x!, c.z!, c.radius! + 0.6] : [0, 0, 0];
        const away = Math.atan2(p.z - cz, p.x - cx);
        plans.set(m.id, policy.dodge === 'all' && !canPummel && c.t <= 0.9 && R > 0 && dist({ x: cx, z: cz }, p) < R ? { x: cx + Math.cos(away) * R, z: cz + Math.sin(away) * R } : null);
      }
      const goal = [...plans.values()].find(g => g !== null) ?? null;
      if (goal) { const g = dist(goal, p); if (g > 0.4) { input.dirX = (goal.x - p.x) / g; input.dirZ = (goal.z - p.z) / g; } }
      else if (dd > 2.2) { input.dirX = (t.x - p.x) / d; input.dirZ = (t.z - p.z) / d; }
      if (!p.autoAttack && dd <= 3 && s.tick - lastAttack >= 6) { lastAttack = s.tick; input.attack = true; }
      if (wantsPummel) input.ability = SLOT.pummel;
      else if (p.queued === null && p.gcd <= 0.4) {
        if (ready(SLOT.crushing, dd, 3, t)) input.ability = SLOT.crushing;
        else if (ready(SLOT.throw, dd, 9, t)) input.ability = SLOT.throw;
        else if (ready(SLOT.strike, dd, 3, t)) input.ability = SLOT.strike;
      }
    }
    step(s, { ...NO_INPUT, ...input });
    for (const ev of s.events) {
      if (ev.t === 'swing' || (ev.t === 'cast' && ev.slot <= SLOT.throw)) firstSwing ??= s.tick;
      else if (ev.t === 'hit' && ev.target === 'player') taken += ev.amount;
      else if (ev.t === 'kill' && group.some(e => e.id === ev.id)) { kills++; lastKill = s.tick; }
    }
  }
  return { ttk: lastKill !== null && firstSwing !== null ? (lastKill - firstSwing) * TICK_DT : null, lossPct: 100 * taken / p.maxHp, died: p.dead, kills };
}

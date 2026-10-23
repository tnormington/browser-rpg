// A player policy that fights one enemy (and the mate that came with it) to the death on the real sim and reports what it cost (HOM-174). It is the bench's balance bot
// (bench/combat.mjs --mode ttk, HOM-53) without the browser: the same rotation (auto-attack, Pummel on a wind-up, Crushing Blow > Serrated Throw > Strike, queued inside the
// GCD window), the same stand-off 7 units off, the same line gear (docs/world-design.md 3.4), the same reading of a slam (Pummel it, else step out) - driven through `step()`
// at one decision a tick, which is the bench's `--fast 1`. Nothing here is in the game; it is what src/echo.test.ts measures a row with.
import { Enemy, GameState, Input, NO_INPUT, TICK_DT, createState, step } from './sim';
import { ABILITIES, ENEMY_TYPES, defOf, powerForLevel } from './sim/data';
import { abilityOpen, refreshPlayerStats } from './sim/combat';
import { CAPSTONE_TIER, TALENTS, TreeId, learnTalent, resetTalents } from './sim/talents';
import { ECHO_ROLE_TALENTS, ECHO_TALENTS, dress, echoArmour, weaponLine } from './sim/echo';
import { regear } from './sim/inventory';
import { ECHOHIDE_SET, ECHO_BLADE_COUNT, echoBladeId, echoBladeLevel } from './sim/items';
import { xpForLevel } from './sim/xp';
import { clearLine } from './sim/sight';
import { inSafeZone, regionAt } from './sim/world';
import { PROCS } from './sim/procs';

/** What the player answers. A bot that answers nothing pays what the pace model says (3.6); the reference player of 3.4a Pummels a wind-up and steps out of slams and off marked ground. */
export interface Policy { pummel: boolean; dodge: 'none' | 'all'; kit?: boolean; heal?: boolean; cleave?: boolean; saveHeal?: boolean }
export const ANSWERS_NOTHING: Policy = { pummel: false, dodge: 'none' };
export const REFERENCE: Policy = { pummel: true, dodge: 'all' };
/** HOM-192: the reference player with the whole kit a player of the level has (`dressKit`): the six abilities past 48 on the bench's rules, and Second Wind when none of it would be wasted. */
export const WITH_KIT: Policy = { ...REFERENCE, kit: true, heal: true };

/** `ttk` is first swing to last kill in seconds; `lossPct` is gross damage taken as a share of max health, `netPct` that less what was healed (the bot heals only when `Policy.heal` is on). */
export interface Fight { ttk: number | null; lossPct: number; netPct: number; died: boolean; kills: number }

const SLOT = { strike: 0, crushing: 1, throw: 2, wind: 3, cleave: 4, pummel: 5 };
/** The six past level 48 by their place in the book (data.ts), which is the slot the sim takes. */
const KIT = { rampart: 16, reaping: 17, shockwave: 18, surge: 19, bloodbath: 20, final: 21 };
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

/**
 * HOM-192: what a player of `level` is carrying past the bare line. `talents` spends every point `talentPoints(level)` gives, greedily in the order of `build`, tier by tier and each talent to full rank
 * (the bench's own rule: bench/combat.mjs spendTalents); `gear` swaps the line weapon and armour of `arena` for the real Echo blades and Echohide above 48 (below it the line stands). The abilities need
 * nothing: `arena` has bought the whole book, and `abilityOpen` gates each by its level. Call it on an arena before the fight.
 */
export interface Kit { talents: boolean; gear: boolean; build?: TreeId[]; maxTier?: number }
export const BARE: Kit = { talents: false, gear: false };
export const FULL_KIT: Kit = { talents: true, gear: true };
export function dressKit(s: GameState, kit: Kit) {
  const p = s.player, level = p.combat.level;
  if (kit.gear && level > 48) {
    const n = Math.min(ECHO_BLADE_COUNT, Math.floor((level - 48) / 8) + 1);
    Object.assign(p.equipment, { weapon: echoBladeId(n), head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves', hands: ECHOHIDE_SET[0], feet: ECHOHIDE_SET[1] });
    regear(s);
  }
  if (kit.talents) {
    resetTalents(s);
    for (const tree of kit.build ?? ECHO_TALENTS.build) {
      for (const t of TALENTS.filter(x => x.tree === tree && x.tier <= (kit.maxTier ?? CAPSTONE_TIER + 1)).sort((a, b) => a.tier - b.tier)) {
        for (let r = p.talents[t.id] ?? 0; r < t.ranks; r++) { learnTalent(s, t.id); if ((p.talents[t.id] ?? 0) <= r) break; }
      }
    }
  }
  refreshPlayerStats(s, true);
  p.energy = p.maxEnergy;
}

/** Fight until everything that came with `enemy` is dead, the player is, or `cap` seconds have gone. */
export function fight({ s, enemy }: ReturnType<typeof arena>, policy: Policy, cap = 300): Fight {
  const p = s.player;
  const group = s.enemies.filter(e => e === enemy || (e.mateOf === enemy.id && e.state !== 'dead'));
  let firstSwing: number | null = null, lastKill: number | null = null, kills = 0, taken = 0, healed = 0, lastSelect = -99, lastAttack = -99;
  const start = s.tick, plans = new Map<number, { x: number; z: number } | null>(), pummelled = new Set<number>(); // the answer to each wind-up in progress, by enemy id; and the ones Pummel took
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
        if (!m.cast) { plans.delete(m.id); pummelled.delete(m.id); continue; }
        if (plans.has(m.id)) continue;
        const c = m.cast, canPummel = policy.pummel && m === t && p.cd[SLOT.pummel] <= 0.3 && p.energy >= ABILITIES[SLOT.pummel].cost && dd <= 3.5;
        const [cx, cz, R] = c.kind === 'heavy' ? [m.x, m.z, defOf(m).heavy!.radius + 0.9] : c.kind === 'ground' ? [c.x!, c.z!, c.radius! + 0.6] : [0, 0, 0];
        const away = Math.atan2(p.z - cz, p.x - cx);
        if (canPummel) pummelled.add(m.id);
        plans.set(m.id, policy.dodge === 'all' && !canPummel && c.t <= 0.9 && R > 0 && dist({ x: cx, z: cz }, p) < R ? { x: cx + Math.cos(away) * R, z: cz + Math.sin(away) * R } : null);
      }
      const goal = [...plans.values()].find(g => g !== null) ?? null;
      if (goal) { const g = dist(goal, p); if (g > 0.4) { input.dirX = (goal.x - p.x) / g; input.dirZ = (goal.z - p.z) / g; } }
      else if (dd > 2.2) { input.dirX = (t.x - p.x) / d; input.dirZ = (t.z - p.z) / d; }
      if (!p.autoAttack && dd <= 3 && s.tick - lastAttack >= 6) { lastAttack = s.tick; input.attack = true; }
      const surge = p.buffs.find(b => b.id === 'echo_surge'), hpFrac = t.hp / t.maxHp;
      // HOM-192, the bench's rules for the two off-GCD buttons (bench/combat.mjs fightStep): Rampart for a slam or mark that nothing else answers, inside the last 2.2 s of its wind-up, or below 40 % health;
      // Echo Surge at the start of a fight, on a target still above 60 % and in reach, never into the end of one.
      const left = t.cast ? t.cast.total - t.cast.t : 99, unanswered = (t.cast?.kind === 'heavy' || t.cast?.kind === 'ground') && plans.get(t.id) === null && !pummelled.has(t.id);
      if (policy.kit && abilityOpen(p, KIT.rampart) && p.cd[KIT.rampart] <= 0.02 && p.energy >= ABILITIES[KIT.rampart].cost && !p.buffs.some(b => b.id === 'rampart')
        && ((unanswered && left <= 2.2 && left >= 0.3) || p.hp < 0.4 * p.maxHp)) input.ability = KIT.rampart;
      else if (policy.kit && abilityOpen(p, KIT.surge) && p.cd[KIT.surge] <= 0.02 && p.energy >= ABILITIES[KIT.surge].cost && !surge && dd <= 3.5 && hpFrac >= 0.6) input.ability = KIT.surge;
      else if (wantsPummel) input.ability = SLOT.pummel;
      else if (p.queued === null && p.gcd <= 0.4) {
        const w = p.gcd, en = Math.min(p.maxEnergy, p.energy + 8 * w);
        const ok = (slot: number, range: number) => abilityOpen(p, slot) && p.cd[slot] <= w + 0.02 && en >= ABILITIES[slot].cost && dd <= range;
        const around = chasers.filter(e => dist(e, p) <= 4.5).length;
        // Final Reckoning is held for a Surge: while one is up or coming nothing else spends the energy below 90 (heals excepted), so it lands inside the window; with none up it goes as soon as the energy is there. Never on a target under 40 %.
        const final = !!policy.kit && hpFrac >= 0.4 && abilityOpen(p, KIT.final) && p.cd[KIT.final] <= w + 0.02, reserve = final && en < 90 && !!surge && surge.left >= 4;
        const windHeal = 45 * powerForLevel(p.combat.level);
        const windOwed = !!policy.heal && p.maxHp - p.hp >= windHeal && abilityOpen(p, SLOT.wind) && p.cd[SLOT.wind] <= w + 0.02;
        if (windOwed && ok(SLOT.wind, 99)) input.ability = SLOT.wind;
        else if (windOwed && policy.saveHeal) { /* the energy is Second Wind's: a Strike a global cooldown never lets 25 build up */ }
        else if (policy.cleave && around >= 2 && ok(SLOT.cleave, 3.5)) input.ability = SLOT.cleave;
        else if (final && ok(KIT.final, 3.5)) input.ability = KIT.final;
        else if (reserve) { /* the energy is Final Reckoning's */ }
        else if (policy.kit && hpFrac >= 0.2 && ok(KIT.reaping, 3)) input.ability = KIT.reaping;
        else if (policy.kit && ((t.cast && p.cd[SLOT.pummel] > 0.3) || around >= 2) && ok(KIT.shockwave, 4.5)) input.ability = KIT.shockwave;
        else if (policy.kit && (around >= 2 || p.hp < 0.6 * p.maxHp) && ok(KIT.bloodbath, 4)) input.ability = KIT.bloodbath;
        else if (ready(SLOT.crushing, dd, 3, t)) input.ability = SLOT.crushing;
        else if (ready(SLOT.throw, dd, 9, t)) input.ability = SLOT.throw;
        else if (ready(SLOT.strike, dd, 3, t)) input.ability = SLOT.strike;
      }
    }
    step(s, { ...NO_INPUT, ...input });
    for (const ev of s.events) {
      if (ev.t === 'swing' || (ev.t === 'cast' && ['strike', 'dot', 'cleave'].includes(ABILITIES[ev.slot].kind))) firstSwing ??= s.tick;
      else if (ev.t === 'hit' && ev.target === 'player') taken += ev.amount;
      else if (ev.t === 'heal') healed += ev.amount;
      else if (ev.t === 'kill' && group.some(e => e.id === ev.id)) { kills++; lastKill = s.tick; }
    }
  }
  return { ttk: lastKill !== null && firstSwing !== null ? (lastKill - firstSwing) * TICK_DT : null, lossPct: 100 * taken / p.maxHp, netPct: 100 * (taken - healed) / p.maxHp, died: p.dead, kills };
}

/**
 * The characters the benches fight as, by name. `bare` is the bible's line with nothing spent (what an Echo was priced against until HOM-192); `talents` is the character it is priced against now;
 * `full` adds the six abilities. The rest are the same three answering less: `none` / `tnone` / `fullnone` answer nothing, `tdodge` / `fulldodge` only step, `tpummel` / `fullpummel` only press Pummel.
 */
export function characters(gear: boolean, build: TreeId[] = [...ECHO_TALENTS.build]): Record<string, { kit: Kit; policy: Policy }> {
  const talents: Kit = { talents: true, gear, build }, bare: Kit = { talents: false, gear };
  const full: Policy = WITH_KIT, none = { pummel: false, dodge: 'none' as const };
  return {
    bare: { kit: bare, policy: REFERENCE }, talents: { kit: talents, policy: REFERENCE }, full: { kit: talents, policy: full },
    none: { kit: bare, policy: ANSWERS_NOTHING }, tnone: { kit: talents, policy: ANSWERS_NOTHING },
    tdodge: { kit: talents, policy: { pummel: false, dodge: 'all' } }, tpummel: { kit: talents, policy: { pummel: true, dodge: 'none' } },
    fulldodge: { kit: talents, policy: { ...full, pummel: false } }, fullpummel: { kit: talents, policy: { ...full, dodge: 'none' } }, fullnone: { kit: talents, policy: { ...full, ...none } },
  };
}

/** For a bench that wants an Echo as it was before HOM-192: the line's health, with no talent in the price. Call it before any row is built (rows are memoised), and never from the game. */
export function linePrice() {
  for (const c of ECHO_TALENTS.curve) (c as unknown as number[])[1] = 1;
  for (const k of Object.keys(ECHO_ROLE_TALENTS)) (ECHO_ROLE_TALENTS as Record<string, number>)[k] = 1;
}

/** Put the enemy (and its mate) back at its post as a fresh spawn, and the player back at the stand-off with full health: the rest between pulls. */
function rest(s: GameState, e: Enemy, spot: { x: number; z: number; facing: number }) {
  for (const x of s.enemies) {
    if (x !== e && x.mateOf !== e.id) continue;
    Object.assign(x, { state: 'idle', hp: x.maxHp, respawnIn: 0, deadFor: 0, x: x.spawnX, z: x.spawnZ, attackCd: 0, heavyCd: 0, hazardCd: 0, evadeFor: 0, swing: 0, cast: null, bleed: null, stagger: 0, netCd: 0 });
  }
  const p = s.player;
  Object.assign(p, { x: spot.x, z: spot.z, facing: spot.facing, hp: p.maxHp });
  s.targetId = null; p.autoAttack = false;
}

/** HOM-194: a row as authored rather than an Echo of it, fought in this weapon and armour (the gear the row was priced against, docs/world-design.md 3.3). */
export interface Base { weapon: number; armour: number }

/** HOM-194: a pack row is a camp, so the spawns of its type within its `pack` radius of the first stand up beside it as its mates (the fight counts them in: `mateOf`), as many as the camp has (three, or the Fens' two). */
function camp(s: GameState, leader: Enemy) {
  const def = ENEMY_TYPES[leader.type];
  if (!def.pack) return;
  for (const m of s.enemies) {
    if (m === leader || m.type !== leader.type || Math.hypot(m.spawnX - leader.spawnX, m.spawnZ - leader.spawnZ) > def.pack) continue;
    Object.assign(m, { state: 'idle', respawnIn: 0, deadFor: 0, x: m.spawnX, z: m.spawnZ, attackCd: 0, cast: null, bleed: null, netCd: 0, mateOf: leader.id });
    m.hp = m.maxHp;
  }
}

/**
 * HOM-192: `n` pulls of the same Echo in a row, the loop a player is in and not one fight from a cold start: cooldowns, energy and buffs run on through the rest between pulls (the 5 s delay,
 * then 3 % of health a second to full, which is how docs/combat-99.md 3.10 counts a kill's loop, plus `walk` seconds to the next one). The first pull has every cooldown ready; the rest are the steady state.
 */
export function pulls(type: string, E: number, who: { kit: Kit; policy: Policy }, seed: number, n: number, { setting = 0, walk = 0, base }: { setting?: -3 | 0 | 3; walk?: number; base?: Base } = {}) {
  const a = base ? arena(seed, type, E, base.weapon, base.armour, (s, e) => camp(s, e))
    : arena(seed, type, E, weaponLine(E), echoArmour(E), (s, e) => { s.quest.eighth = 'done'; s.player.echo = setting; dress(s, e); });
  dressKit(a.s, who.kit);
  const p = a.s.player, spot = { x: p.x, z: p.z, facing: p.facing };
  const out: { ttk: number; loss: number; net: number; gap: number; died: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    if (i) rest(a.s, a.enemy, spot);
    const f = fight(a, who.policy);
    const gap = 5 + f.lossPct / 3 + walk;
    out.push({ ttk: f.ttk ?? NaN, loss: f.lossPct, net: f.netPct, gap, died: f.died });
    if (f.died) break;
    for (let t = 0; t < gap / TICK_DT; t++) step(a.s, NO_INPUT);
  }
  return out;
}
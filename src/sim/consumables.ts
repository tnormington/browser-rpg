// Consumables: food, a heal over time that a hit breaks, and timed buffs (docs/world-design.md 2.2). Pure sim.
// Potions are wave 3: they will be items whose `use` names a buff and no food, and need nothing here beyond a BUFFS row.
import type { GameState, Player } from '../sim';
import { ITEMS } from './items';
import { maxHpForLevel } from './data';

export const FOOD_TIME = 5;       // seconds a meal takes to heal in full
export const FOOD_COOLDOWN = 20;  // one shared clock for every food, from the moment you start eating

/** `damageTaken` multiplies every hit that lands on the player while the buff is on (Guard halves it). `desc` is the line the log says when it goes on, `icon` the face it wears on the unit frame. */
export interface BuffDef { name: string; desc: string; icon: string; duration: number; maxHp?: number; damageTaken?: number }
export interface Buff { id: string; left: number }

export const BUFFS: Record<string, BuffDef> = {
  well_fed: { name: 'Well Fed', desc: '+10% max health.', icon: '🍗', duration: 20 * 60, maxHp: 0.10 },
  guard: { name: 'Guard', desc: 'damage taken halved.', icon: '🛡', duration: 4, damageTaken: 0.5 },
};

/** What a hit that has already been through armour is worth once every buff has had its say. */
export const buffedDamage = (p: Player, amount: number) =>
  Math.max(1, Math.round(p.buffs.reduce((n, b) => n * (BUFFS[b.id]?.damageTaken ?? 1), amount)));

/** Max health at the player's level with every buff, Bastion and Vitality enchant on it: the one place that is worked out (combat's stat refresh reads it too). */
export const maxHpOf = (p: Player) =>
  Math.round(maxHpForLevel(p.combat.level) * p.talentFx.maxHp * (1 + p.stats.hpFrac + p.buffs.reduce((n, b) => n + (BUFFS[b.id]?.maxHp ?? 0), 0)));

/** A buff or a talent rank changed: max health follows, and what it adds arrives (and leaves) with it. */
export function resizeHp(p: Player) {
  const before = p.maxHp;
  p.maxHp = maxHpOf(p);
  p.hp = Math.min(p.maxHp, Math.max(1, p.hp + Math.max(0, p.maxHp - before)));
}

export function applyBuff(s: GameState, id: string) {
  const p = s.player, def = BUFFS[id], have = p.buffs.find(b => b.id === id);
  if (!def) return;
  if (have) have.left = def.duration; else p.buffs.push({ id, left: def.duration });
  resizeHp(p);
  s.events.push({ t: 'buff', id, on: true });
}

/** Death takes every buff and any meal in the mouth. */
export function clearBuffs(s: GameState) {
  const p = s.player;
  p.food = null;
  for (const b of p.buffs) s.events.push({ t: 'buff', id: b.id, on: false });
  p.buffs = [];
  p.maxHp = maxHpOf(p);
}

/** A hit spoils the meal: whatever has not healed yet is lost. */
export function breakFood(s: GameState) {
  if (!s.player.food) return;
  s.player.food = null;
  s.events.push({ t: 'eatbreak' });
}

/** Whether using this item is allowed right now, or the reason it is not. A meal wants a quiet moment, because its buff would be too good in a fight. */
function blocker(p: Player, id: string): 'cooldown' | 'combat' | null {
  const use = ITEMS[id].use!;
  if (use.food && p.foodCd > 0) return 'cooldown';
  if (use.buff && p.inCombat) return 'combat';
  return null;
}

/** Use one item from a bag slot: eat it, drink it. Refusals say why and leave the bag alone. */
export function useItem(s: GameState, slot: number) {
  const p = s.player, st = Number.isInteger(slot) ? p.inventory[slot] : null, use = st ? ITEMS[st.id].use : undefined;
  if (p.dead || !st || !use) return;
  const why = blocker(p, st.id);
  if (why) return void s.events.push({ t: 'actionfail', reason: why, need: 0, what: ITEMS[st.id].name });
  const id = st.id;
  if (--st.qty <= 0) p.inventory[slot] = null;
  if (use.food) {
    p.foodCd = FOOD_COOLDOWN;
    p.food = { left: FOOD_TIME, rate: (use.heal ?? 0) * p.maxHp / FOOD_TIME, pending: 0 };
  }
  if (use.buff) applyBuff(s, use.buff);
  s.events.push({ t: 'use', item: id });
}

/** The bag slot to eat from when the player just says "eat": the biggest heal they may eat now, a meal ahead of a plain dish of the same size. -1 for none. */
export function bestFoodSlot(p: Player): number {
  let best = -1, score = 0;
  p.inventory.forEach((st, i) => {
    const use = st ? ITEMS[st.id].use : undefined;
    if (!st || !use?.food || blocker(p, st.id) === 'combat') return;
    const sc = (use.heal ?? 0) + (use.buff ? 0.001 : 0);
    if (sc > score) { best = i; score = sc; }
  });
  return best;
}

export function updateConsumables(s: GameState, dt: number) {
  const p = s.player;
  p.foodCd = Math.max(0, p.foodCd - dt);
  const f = p.food;
  if (f) {
    const step = Math.min(dt, f.left), healed = Math.min(p.maxHp - p.hp, f.rate * step);
    p.hp += healed; f.pending += healed;
    const whole = Math.ceil(f.left - 1e-9) > Math.ceil(f.left - step - 1e-9); // a second of the meal has passed: say what it healed
    f.left -= step;
    if ((whole || f.left <= 0) && f.pending >= 1) { s.events.push({ t: 'heal', x: p.x, z: p.z, amount: Math.round(f.pending) }); f.pending = 0; }
    if (f.left <= 0) p.food = null;
  }
  for (const b of p.buffs) b.left -= dt;
  const over = p.buffs.filter(b => b.left <= 0);
  if (over.length) {
    p.buffs = p.buffs.filter(b => b.left > 0);
    for (const b of over) s.events.push({ t: 'buff', id: b.id, on: false });
    p.maxHp = maxHpOf(p);
    p.hp = Math.min(p.hp, p.maxHp);
  }
}

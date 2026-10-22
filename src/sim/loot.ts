// Loot: drop-table rolls, ground drops, pickup. Pure sim.
import type { GameState } from '../sim';
import { nextRandom } from './rng';
import { DROP_TABLES, ITEMS } from './items';
import { addItem } from './inventory';

export const PICKUP_RADIUS = 1.4;
export const DROP_LIFETIME = 120; // seconds on the ground before it despawns

export interface GroundDrop {
  id: number; item: string; qty: number; x: number; z: number;
  age: number;
  blocked: boolean; // inventory was full (or it was just dropped): don't retry until the player steps away
}

/** Roll an enemy type's drop table and put the results on the ground around (x, z). */
export function rollDrops(s: GameState, enemyType: string, x: number, z: number) {
  const table = DROP_TABLES[enemyType];
  if (!table) return;
  for (let r = 0; r < table.rolls; r++) {
    const weights = table.entries.map(e => e.weight ?? ITEMS[e.id].dropWeight);
    let roll = nextRandom(s) * (table.nothing + weights.reduce((a, b) => a + b, 0));
    const hit = table.entries.findIndex((_, i) => (roll -= weights[i]) < 0);
    if (hit < 0) continue; // landed in the "nothing" band, which sits after all entries
    const e = table.entries[hit];
    const [lo, hi] = e.qty ?? [1, 1];
    dropAt(s, e.id, lo + Math.floor(nextRandom(s) * (hi - lo + 1)), x, z);
  }
}

/** Put `qty` of an item on the ground a pace from (x, z), in a direction the state's own dice choose. */
export function dropAt(s: GameState, item: string, qty: number, x: number, z: number) {
  const ang = nextRandom(s) * Math.PI * 2;
  const drop: GroundDrop = {
    id: s.nextDropId++, item, qty, age: 0, blocked: false,
    x: x + Math.sin(ang) * 1.1, z: z + Math.cos(ang) * 1.1,
  };
  s.drops.push(drop);
  s.events.push({ t: 'drop', id: drop.id, item: drop.item, x: drop.x, z: drop.z });
}

export function updateDrops(s: GameState, dt: number) {
  const p = s.player;
  s.drops = s.drops.filter(d => {
    d.age += dt;
    if (d.age > DROP_LIFETIME) return false;
    if (p.dead) return true;
    if (Math.hypot(d.x - p.x, d.z - p.z) > PICKUP_RADIUS) { d.blocked = false; return true; }
    if (d.blocked) return true;
    const left = addItem(p.inventory, d.item, d.qty);
    if (left === d.qty) { d.blocked = true; s.events.push({ t: 'invfull' }); return true; }
    s.events.push({ t: 'loot', item: d.item, qty: d.qty - left });
    if (left > 0) { d.qty = left; d.blocked = true; s.events.push({ t: 'invfull' }); return true; }
    return false;
  });
}

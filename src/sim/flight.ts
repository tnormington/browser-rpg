// The flight network (docs/world-design.md section 5): a master in every town, a price and a ride time for every pair, and the ride itself as a
// timed `flight` action. You can fly only to a master you have walked to (`s.found`), and only from one you are standing at. Pure sim.
import type { GameState } from '../sim';
import { LANDMARKS, PLAYER_RADIUS, TOWNS, resolveCollisions } from './world';

export interface FlightMaster { id: string; name: string; x: number; z: number; r: number }
/** One per town, by town id: just inside the gate, so arriving is the unlock. */
export const FLIGHT_MASTERS: FlightMaster[] = [
  { id: 'hale', name: 'Fenna Skywright', ...LANDMARKS.flightHale },
  { id: 'saltmarrow', name: 'Orrin Gullwing', ...LANDMARKS.flightSalt },
  { id: 'thornwick', name: 'Hesper Rookwing', ...LANDMARKS.flightThorn },
];
export const masterById = (id: string) => FLIGHT_MASTERS.find(m => m.id === id);

export const FLIGHT_REACH = 6;    // centre to centre, like the merchants
export const DISCOVER_RADIUS = 14; // coming this close to a town's master puts it on the network
export const START_TOWN = 'hale'; // home: found from the start

const round5 = (n: number) => Math.round(n / 5) * 5;
const townById = (id: string) => TOWNS.find(t => t.id === id)!;

/** Straight-line world-map distance between two towns (design 1.2): the one number price and ride time come from. */
export const mapDistance = (a: string, b: string) => Math.hypot(townById(a).map.x - townById(b).map.x, townById(a).map.z - townById(b).map.z);
export const flightPrice = (a: string, b: string) => round5(25 + mapDistance(a, b) / 6);
export const flightSeconds = (a: string, b: string) => 6 + mapDistance(a, b) / 75;

export const isFlying = (p: { action: GameState['player']['action'] }) => p.action?.k === 'flight';

/** The master the player is standing at, if any. */
export const masterNear = (s: GameState): FlightMaster | undefined => {
  const d = (m: FlightMaster) => Math.hypot(s.player.x - m.x, s.player.z - m.z);
  return FLIGHT_MASTERS.filter(m => d(m) <= FLIGHT_REACH).sort((a, b) => d(a) - d(b))[0];
};

/** Every other town whose master you have found, with what the flight costs and how long it takes. */
export const destinationsFrom = (s: GameState, from: string) =>
  TOWNS.filter(t => t.id !== from && s.found.includes(t.id) && masterById(t.id))
    .map(t => ({ to: t.id, name: t.name, price: flightPrice(from, t.id), seconds: flightSeconds(from, t.id) }));

/** Each tick: a master the player has come near joins the network. */
export function discoverMasters(s: GameState) {
  const p = s.player;
  for (const m of FLIGHT_MASTERS) {
    if (s.found.includes(m.id) || Math.hypot(p.x - m.x, p.z - m.z) > DISCOVER_RADIUS) continue;
    s.found.push(m.id);
    s.events.push({ t: 'discover', town: townById(m.id).name });
  }
}

/** Pay for and begin a ride from the master you are at. Refusals say why through `actionfail`; nothing is charged for one. */
export function startFlight(s: GameState, to: string) {
  const p = s.player, here = masterNear(s), dest = TOWNS.find(t => t.id === to);
  if (p.dead || isFlying(p) || !dest) return;
  const what = `a flight to ${dest.name}`;
  if (!here) return void s.events.push({ t: 'actionfail', reason: 'range', need: 0, what, station: 'flight master' });
  if (!destinationsFrom(s, here.id).some(d => d.to === to)) return;
  if (p.inCombat) return void s.events.push({ t: 'actionfail', reason: 'combat', need: 0, what }); // (and, once there are mounts, not mounted either)
  const price = flightPrice(here.id, to);
  if (p.gold < price) return void s.events.push({ t: 'actionfail', reason: 'gold', need: price, what });
  p.gold -= price;
  s.interact = null; s.moveTarget = null; s.targetId = null; s.tab = null;
  p.moving = false;
  if (p.autoAttack) { p.autoAttack = false; s.events.push({ t: 'auto', on: false }); }
  p.action = { k: 'flight', from: here.id, to, t: 0, duration: flightSeconds(here.id, to) };
  s.events.push({ t: 'flight', phase: 'start', from: here.id, to, price });
}

/** Where a flight to this town puts you: a couple of paces from its master, on the town's side of them (also where a save made mid-ride resumes). */
export function landingSpot(to: string) {
  const m = masterById(to)!, town = townById(to);
  const dx = town.wake.x - m.x, dz = town.wake.z - m.z, d = Math.hypot(dx, dz) || 1;
  const at = { x: m.x + (dx / d) * 2.5, z: m.z + (dz / d) * 2.5 };
  resolveCollisions(at, PLAYER_RADIUS);
  return at;
}

/** The ride: nothing else the player does counts until it lands. It cannot be cut short — the fare buys the whole ride. */
export function updateFlight(s: GameState, dt: number) {
  const p = s.player, a = p.action;
  if (a?.k !== 'flight') return;
  a.t += dt;
  if (a.t < a.duration) return;
  const m = masterById(a.to)!;
  const at = landingSpot(a.to);
  p.x = at.x; p.z = at.z;
  p.facing = Math.atan2(m.x - p.x, m.z - p.z);
  p.action = null;
  s.events.push({ t: 'flight', phase: 'land', from: a.from, to: a.to, price: 0 });
}

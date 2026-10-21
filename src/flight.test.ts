// HOM-49: flight masters, the price table, the ride and what it does to the player. Run with `npm run verify` (after the golden path).
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { TOWNS, SALTMARROW } from './sim/world';
import { FLIGHT_MASTERS, destinationsFrom, flightPrice, flightSeconds, landingSpot, masterById } from './sim/flight';
import { deserialize, serialize } from './sim/save';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => { for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i); };
const kindOf = (s: GameState) => s.player.action?.k;
const failOf = (s: GameState) => s.events.find(e => e.t === 'actionfail') as Extract<GameState['events'][number], { t: 'actionfail' }> | undefined;
const sawFlight = (s: GameState, phase: 'start' | 'land') => s.events.some(e => e.t === 'flight' && e.phase === phase);

/** A state with every enemy laid low for good, standing at a town's flight master with money in hand. */
function atMaster(id: string, gold = 1000): GameState {
  const s = createState(7);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const m = masterById(id)!;
  s.player.x = m.x - 2; s.player.z = m.z;
  s.player.gold = gold;
  return s;
}

// ---------------------------------------------------------------------------
section('HOM-49 the table is the formula on the world-map positions');
{
  assert(flightPrice('hale', 'saltmarrow') === 175 && flightPrice('saltmarrow', 'hale') === 175, 'Hale <-> Saltmarrow is 175, both ways');
  assert(flightSeconds('hale', 'saltmarrow') === 18, 'the first hop is an 18 second ride');
  // the design's other rows (5.2), through the same formula on the positions of the later towns (1.2)
  const pos = { hale: [0, 0], saltmarrow: [900, 0], thornwick: [900, 1000], highmoor: [1900, 1000], spire: [1900, 0] } as const;
  const price = (a: keyof typeof pos, b: keyof typeof pos) => Math.round((25 + Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]) / 6) / 5) * 5;
  assert(price('saltmarrow', 'thornwick') === 190 && price('hale', 'thornwick') === 250 && price('saltmarrow', 'highmoor') === 260 && price('hale', 'spire') === 340 && price('hale', 'highmoor') === 385, 'the formula reproduces the design table (190, 250, 260, 340, 385)');
  assert(TOWNS.every(t => FLIGHT_MASTERS.some(m => m.id === t.id)), 'every town has a flight master');
}

// ---------------------------------------------------------------------------
section('HOM-49 you can fly only to a master you have walked to');
{
  const s = atMaster('hale');
  assert(s.found.join() === 'hale', 'a new game has found Hale and nothing else');
  assert(destinationsFrom(s, 'hale').length === 0, 'so there is nowhere to fly yet');
  tick(s, { flight: 'saltmarrow' });
  assert(kindOf(s) !== 'flight' && s.player.gold === 1000, 'asking for an unfound town does nothing and costs nothing');

  const w = atMaster('saltmarrow');
  w.player.x = SALTMARROW.x - 80; w.player.z = SALTMARROW.z; // out on the road, beyond the master's welcome
  tick(w);
  assert(!w.found.includes('saltmarrow'), 'the road outside the gate does not find it');
  const m = masterById('saltmarrow')!;
  w.player.x = m.x - 10; w.player.z = m.z;
  tick(w);
  assert(w.found.includes('saltmarrow') && w.events.some(e => e.t === 'discover'), 'walking up to the master puts Saltmarrow on the network, once');
  tick(w);
  assert(!w.events.some(e => e.t === 'discover'), '...and it is not announced again');
}

// ---------------------------------------------------------------------------
section('HOM-49 the ride: paid, run in full, and nothing touches you');
{
  const s = atMaster('hale', 500);
  s.found.push('saltmarrow');
  assert(destinationsFrom(s, 'hale')[0].price === 175, 'the destination list quotes 175');

  s.player.x = 0; s.player.z = 0; // nowhere near the master
  tick(s, { flight: 'saltmarrow' });
  assert(failOf(s)?.reason === 'range' && s.player.gold === 500, 'away from the master the answer is "move closer", and nothing is charged');
  const m = masterById('hale')!;
  s.player.x = m.x - 2; s.player.z = m.z;

  s.player.outOfCombat = 0; // just struck
  tick(s, { flight: 'saltmarrow' });
  assert(failOf(s)?.reason === 'combat' && s.player.gold === 500, 'no flying in combat');
  s.player.outOfCombat = 99;

  s.player.gold = 100;
  tick(s, { flight: 'saltmarrow' });
  assert(failOf(s)?.reason === 'gold' && s.player.gold === 100 && kindOf(s) !== 'flight', 'short of 175, it is refused');
  s.player.gold = 500;

  tick(s, { flight: 'saltmarrow' });
  assert(kindOf(s) === 'flight' && s.player.gold === 325 && sawFlight(s, 'start'), 'paying 175 starts the ride');
  const a = s.player.action as Extract<NonNullable<GameState['player']['action']>, { k: 'flight' }>;
  assert(a.duration === 18 && a.from === 'hale' && a.to === 'saltmarrow', 'an 18 second ride, Hale to Saltmarrow');

  // enemies: stand one right on top of the player, awake and angry
  const e = s.enemies[0];
  e.state = 'idle'; e.hp = e.maxHp; e.x = s.player.x + 1; e.z = s.player.z; e.spawnX = e.x; e.spawnZ = e.z;
  const hp = s.player.hp;
  run(s, 1, { dirX: 1, ability: 0, interact: { k: 'npc' } });
  assert(s.player.hp === hp && e.state === 'idle', 'during the ride nothing aggroes and nothing hurts');
  assert(Math.abs(s.player.x - (m.x - 2)) < 0.01, 'movement keys and clicks do nothing on the ride');

  run(s, 16);
  assert(kindOf(s) === 'flight', 'the ride cannot be cut short: at 17 seconds you are still in the air');
  run(s, 1.5);
  assert(kindOf(s) !== 'flight', 'and it lands you at 18');
  const end = landingSpot('saltmarrow'), mm = masterById('saltmarrow')!;
  assert(Math.hypot(s.player.x - end.x, s.player.z - end.z) < 0.01 && Math.hypot(s.player.x - mm.x, s.player.z - mm.z) < 4, 'you arrive beside the Saltmarrow flight master');
  assert(s.found.includes('saltmarrow') && destinationsFrom(s, 'saltmarrow').some(d => d.to === 'hale' && d.price === 175), 'and can fly straight back for 175');

  // the ride home
  s.player.gold = 500;
  tick(s, { flight: 'hale' });
  run(s, 17.5);
  assert(kindOf(s) === 'flight', 'a ride runs its full 18 seconds');
  run(s, 1);
  assert(kindOf(s) !== 'flight' && s.player.x < 100, 'and ends in Hale');
}

// ---------------------------------------------------------------------------
section('HOM-49 saving: the found set is kept, and a save mid-ride resumes at the landing');
{
  const s = atMaster('hale', 400);
  s.found.push('saltmarrow');
  tick(s, { flight: 'saltmarrow' });
  run(s, 2);
  const back = deserialize(serialize(s))!;
  assert(back.found.includes('saltmarrow') && back.found.includes('hale'), 'both masters survive a save');
  const end = landingSpot('saltmarrow');
  assert(Math.hypot(back.player.x - end.x, back.player.z - end.z) < 0.5 && back.player.gold === 225 && back.player.action === null, 'a save made mid-ride loads at the landing with the fare paid, not back at the start');
  const old = JSON.parse(serialize(createState(1))); delete old.found;
  assert(deserialize(JSON.stringify(old))!.found.join() === 'hale', 'a save from before flights has found only home');
  old.found = ['atlantis'];
  assert(deserialize(JSON.stringify(old)) === null, 'a save naming a master that does not exist is refused');
}

console.log(`\nAll ${checks} flight checks passed.`);

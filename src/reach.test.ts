// HOM-160: the reach checker (docs/action-layer.md 5.5, 8.4 check 5). The rule is a property of the data, so this holds the checker to fixtures it must accept and
// refuse, and then holds every standable prop and every chest in the world to it: no top in the dead zone, no two a hop apart with a rise in between, and each
// chest's declared tier the tier its cheapest route needs. Run with `npm run verify`.
import { COLLIDERS, PLAYER_RADIUS } from './sim/world';
import { CHESTS, TIERS, openChest, type ChestTier } from './sim/chests';
import { PERCHES, type Perch } from './sim/perches';
import { HOP_GAP, ROOF_MAX, ROOF_MIN, STEP_MAX, need, reachErrors, rimGap, routeNeed, type Top } from './sim/reach';
import { DOUBLE_JUMP_APEX, DOUBLE_JUMP_LEVEL, jumpVelocity, maxStamina } from './sim/agility';
import { jumpHeight } from './sim/data';
import { createState, step, NO_INPUT, type Input } from './sim';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const top = (x: number, z: number, h: number, r = h <= STEP_MAX ? 1.3 : 2.2): Top => ({ x, z, r, top: h });
const errs = (...t: Top[]) => reachErrors(t);

console.log('the checker, on fixtures');
{
  assert(need(0.6) === 'hop' && need(1.0) === 'hop' && need(2.6) === 'double' && need(2.8) === 'double' && need(2.5) === 'double', 'a rise of 1.0 or less is a hop, one of 2.5 to 2.8 is a double jump');
  assert(need(1.2) === null && need(1.6) === null && need(2.0) === null && need(2.49) === null && need(2.9) === null && need(3.2) === null, 'the dead zone (1.0 to 2.5) and everything over 2.8 is nothing a player can do');
  assert(need(-2.6) === 'double' && need(-1.6) === null, 'a drop is judged as a pair, like a rise: falling is free but a rooftop beside a ledge is still the "almost" through a side door');

  assert(errs(top(0, 0, 0.6)).length === 0 && errs(top(0, 0, 1.0)).length === 0 && errs(top(0, 0, 2.6)).length === 0 && errs(top(0, 0, 2.8)).length === 0, 'the four authored heights are fine on their own');
  assert(errs(top(0, 0, 1.2)).length === 1 && errs(top(0, 0, 1.8)).length === 1 && errs(top(0, 0, 2.4)).length === 1 && errs(top(0, 0, 3.0, 2.2)).length === 1 && errs(top(0, 0, 0.2)).length === 1, 'a top at 0.2, 1.2, 1.8, 2.4 or 3.0 is refused');
  assert(errs(top(0, 0, 0.6, 1.0)).length === 1 && errs(top(0, 0, 2.6, 1.8)).length === 1 && errs(top(0, 0, 0.6, 1.2)).length === 0 && errs(top(0, 0, 2.6, 2.0)).length === 0, 'a step narrower than 1.2 or a rooftop narrower than 2.0 is a lottery to land on, and refused');

  const near = top(0, 0, 1.0), roof = top(5.5, 0, 2.6), far = top(20, 0, 2.6);
  assert(rimGap(near, roof) === 5.5 - 1.3 - 2.2, 'the gap is rim to rim');
  assert(rimGap(near, roof) <= HOP_GAP && errs(near, roof).length === 1, 'a rooftop a hop from a ledge is a 1.6 rise in the dead zone: refused');
  assert(errs(near, far).length === 0, '...and the same two, a run apart, are two separate climbs');
  assert(errs(top(0, 0, 0.6), top(3.8, 0, 1.0), top(7.6, 0, 0.6)).length === 0, 'a staircase of steps is fine, with no upper bound');
  assert(errs(top(0, 0, 2.6), top(6.4, 0, 2.8)).length === 0 && errs(top(0, 0, 0.6), top(0, 0, 1.0)).length === 0, 'two rooftops, or two steps, a hop apart are fine');
  assert(errs(top(0, 0, 0.6), top(7, 0, 2.6)).length === 0 && rimGap(top(0, 0, 0.6), top(7, 0, 2.6)) > HOP_GAP, 'a gap wider than 2.5 is no edge: the pair is not judged');
  assert(errs(top(0, 0, 0.6), top(5.4, 0, 3.4)).length === 1 && errs(top(0, 0, 2.6), top(6, 0, 2.6, 2.2), top(13, 0, 0.6)).length === 0, 'a top at 3.4 (a rooftop on a step) is over the apex, refused; a step beyond a hop of a rooftop is not judged against it');

  // the route up
  const step = top(0, 0, 0.6), ledge = top(4, 0, 1.0), roofA = top(40, 0, 2.6), roofB = top(46.4, 0, 2.8), dead = top(80, 0, 1.6);
  assert(routeNeed([step], step) === 'hop' && routeNeed([step, ledge], ledge) === 'hop', 'a step, or a run of steps, needs the hop everyone has');
  assert(routeNeed([roofA], roofA) === 'double' && routeNeed([roofA, roofB], roofB) === 'double', 'a rooftop needs the double jump, and so does the one beside it');
  assert(routeNeed([step, ledge, dead], dead) === null, 'a top in the dead zone has no route at all');
  const bridged = [top(0, 0, 0.6), top(3.8, 0, 1.0), top(7.6, 0, 1.0)];
  assert(routeNeed(bridged, bridged[2]) === 'hop', 'the cheapest route is the easiest hardest leg: a hop from ledge to ledge does not need the jump the ground to a rooftop does');
  const roofAndStep = [top(0, 0, 2.6), top(6.4, 0, 2.6, 2.2), top(12.8, 0, 2.6)]; // flat rooftops side by side: each reachable from the ground by a double jump, or a hop from the next
  assert(routeNeed(roofAndStep, roofAndStep[2]) === 'double', 'a roof reached by hopping between roofs still needs the double jump to get on the first');
  assert(routeNeed([step], top(0, 0, 0.6)) === null, 'a top that is not in the list is not on its graph');
}

console.log('\nthe apex and the bands agree with the jump itself');
{
  // the numbers in reach.ts are the doc's; they stand on the hop and the apex the sim actually has, so a retune of either one fails here and not in a player's hands
  const p = createState(1).player, hop = (level: number) => { p.skills.agility.level = level; return jumpHeight(jumpVelocity(p)); };
  const worst = hop(1), best = hop(99);
  assert(Math.abs(worst - 1.35) < 0.02 && Math.abs(best - 2.109) < 0.02, `the hop is ${worst.toFixed(2)} u at Agility 1 and ${best.toFixed(3)} u at 99 (the doc's 1.35 and 2.109)`);
  assert(STEP_MAX < worst && worst - STEP_MAX >= 0.34, `a step tops out ${(worst - STEP_MAX).toFixed(2)} u under the worst hop`);
  assert(ROOF_MIN > best && ROOF_MIN - best >= 0.38, `a rooftop starts ${(ROOF_MIN - best).toFixed(2)} u over the best single hop`);
  assert(DOUBLE_JUMP_APEX - ROOF_MAX >= 0.39 && DOUBLE_JUMP_LEVEL === 25, `and ends ${(DOUBLE_JUMP_APEX - ROOF_MAX).toFixed(2)} u under the second jump's fixed ${DOUBLE_JUMP_APEX} apex, which opens at Agility ${DOUBLE_JUMP_LEVEL}`);
}

console.log('\nthe world');
{
  const tops: Top[] = COLLIDERS.filter(o => o.top !== undefined).map(o => ({ x: o.x, z: o.z, r: o.r, top: o.top! }));
  assert(tops.length === PERCHES.length && PERCHES.every(p => tops.some(t => t.x === p.x && t.z === p.z && t.top === p.top && t.r === p.r)), `every perch is a standable prop in the world, and nothing else is (${tops.length})`);
  const bad = reachErrors(tops);
  assert(bad.length === 0, bad.length ? bad.join('; ') : 'no top is in the dead zone or over the apex, none is too narrow to land on, and no two a hop apart have a rise between 1.0 and 2.5');
  assert(tops.every(t => t.top === 0.6 || t.top === 1.0 || t.top === 2.6 || t.top === 2.8), 'every top is at one of the four authored heights');
  assert(COLLIDERS.filter(o => o.top !== undefined).every(o => o.kind === 'rock'), 'every standable prop is a rock, which world-view.ts cuts flat under a pale cap: a standable thing looks like one (5.1)');
  assert(tops.every((a, i) => tops.every((b, j) => i === j || rimGap(a, b) > HOP_GAP)), 'every perch is its own island: each chest above the ground is a climb of its own, so a chest never borrows the route of another');

  const at = (c: { x: number; z: number; floor: number }) => tops.find(t => t.top === c.floor && Math.hypot(t.x - c.x, t.z - c.z) < 0.3);
  const declared: Record<ChestTier, ReturnType<typeof need> | 'ground'> = { stash: 'ground', cache: 'hop', hoard: 'double' };
  for (const c of CHESTS) {
    const t = at(c), route = c.floor === 0 ? 'ground' : t ? routeNeed(tops, t) : undefined;
    assert(route === declared[c.tier], `${c.id} declares ${c.tier} and its cheapest route needs ${route === 'ground' ? 'nothing' : route === undefined ? 'a top it is not standing on' : route === null ? 'a jump no one has' : route}`);
  }
  assert(TIERS.cache.needs.includes('hop') && TIERS.hoard.needs.includes(String(DOUBLE_JUMP_LEVEL)), 'and the words the journal says match: a hop for a cache, Agility 25 for a hoard');
  const ids = new Set(CHESTS.map(c => c.id));
  assert(PERCHES.every(p => ids.has(p.chest)) && CHESTS.filter(c => c.floor > 0).length === PERCHES.length, 'each perch is one chest, and each chest above the ground is one perch');
  assert(CHESTS.filter(c => c.tier === 'hoard').every(c => c.floor >= ROOF_MIN && c.floor <= ROOF_MAX) && CHESTS.filter(c => c.tier === 'cache').every(c => c.floor <= STEP_MAX), 'every hoard is on a rooftop and every cache on a step');
}

console.log('\nthe jump itself, on the world\'s own props');
{
  // The graph says what a route needs; this plays it. One player, put back at the foot of each perch for each attempt: a hop from a standing start, an optional second press 9 ticks in
  // (the apex), and a run at the perch held for `run` ticks and then let go. An attempt lands when the player ends the 90 ticks standing on the top. A perch is climbable by a player
  // with that Agility when some run lands, and it is not when none of the 33 does.
  const s = createState(1601);
  for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  const tickOf = (i: Partial<Input>) => step(s, { ...NO_INPUT, ...i });
  const lands = (p: Perch, level: number, second: boolean, run: number) => {
    const pl = s.player;
    pl.skills.agility.level = level; pl.stamina = maxStamina(pl);
    pl.x = p.x - (p.r + PLAYER_RADIUS); pl.z = p.z; pl.y = 0; pl.vy = 0; pl.airborne = false; pl.airJumped = false;
    for (let n = 0; n < 90; n++) tickOf({ jump: n === 0 || (second && n === 9), dirX: n >= 1 && n <= run ? 1 : 0 });
    return pl.y === p.top && !pl.airborne && Math.hypot(pl.x - p.x, pl.z - p.z) < p.r + 0.3;
  };
  const climbs = (p: Perch, level: number, second: boolean) => { for (let run = 8; run <= 40; run++) if (lands(p, level, second, run)) return true; return false; };
  const caches = PERCHES.filter(p => p.tier === 'cache'), hoards = PERCHES.filter(p => p.tier === 'hoard');
  assert(caches.every(p => climbs(p, 1, false)), `every one of the ${caches.length} caches is a hop at Agility 1: a standing start, the worst jump there is, and no second press`);
  assert(hoards.every(p => !climbs(p, 1, true) && !climbs(p, DOUBLE_JUMP_LEVEL - 1, true)), `no one under Agility ${DOUBLE_JUMP_LEVEL} gets onto any of the ${hoards.length} hoards, however they press`);
  assert(hoards.every(p => !climbs(p, 99, false)), 'and Agility 99, the best hop there is, does not either on one jump: the second one is what a rooftop asks for');
  assert(hoards.every(p => climbs(p, DOUBLE_JUMP_LEVEL, true)), `at Agility ${DOUBLE_JUMP_LEVEL} with a second press every hoard is reachable: ${hoards.length} of ${hoards.length}`);
  const g = createState(1602), pl = g.player;
  for (const e of g.enemies) { e.state = 'dead'; e.respawnIn = 1e9; }
  const roof = hoards[0];
  pl.x = roof.x - (roof.r + 0.1); pl.z = roof.z; pl.y = roof.top; // on the roof, at its rim
  assert(openChest(g, roof.chest).ok, 'and a player on the roof opens the chest that is standing on it');
}

console.log(`\n${checks} checks passed`);

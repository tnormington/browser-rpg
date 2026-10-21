// HOM-134: the roads between the towns. That they bend, that they still meet every gate and seam head-on, that their forks
// lead somewhere a traveller can actually stand, and that the villagers at the far end of each one can be walked to and asked.
import {
  BRANCHES, COLLIDERS, LANDMARKS, PLAYER_RADIUS, Pt, REGIONS, SALTMARROW, WITHERING,
  branchById, branchesOf, clampToWorld, forkPost, regionAt, roadOf, wayKeeper,
} from './sim/world';
import { Road, branchDist, branchTrack, roadAt, roadDist, roadHalfWidth, roadPoint } from './sim/road';
import { heading, journeyTo, regionRoute } from './sim/journey';
import { VILLAGERS, villagerById } from './sim/villagers';
import { NPCS, TALK_RANGE, activeQuestView, dialogueAt, npcName, speakerById, speakerNear } from './sim/quest';
import { ENEMY_TYPES } from './sim/data';
import { GameState, Input, NO_INPUT, createState, step } from './sim';
import { route } from './sim/path';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  console.log('  ok  ' + msg);
}
const section = (name: string) => console.log(`\n# ${name}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);
const ROAD_REGIONS = ['greywater', 'dunmere', 'barrowdowns', 'cairnwaste'];
const roads = ROAD_REGIONS.map(id => ({ id, road: REGIONS.find(r => r.id === id)!.road! }));
/** Every pace along a road's run, so nothing is checked only where it happens to be convenient. */
const walk = (road: Road, step = 2) => {
  const out: number[] = [];
  for (let s = road.run[0]; s <= road.run[1]; s += step) out.push(s);
  return out;
};

section('every road bends, and comes back onto its line at both ends');
{
  assert(roads.length === 4 && roads.every(r => r.road.run[1] > r.road.run[0]), 'the four long roads each carry a run and a seed');
  for (const { id, road } of roads) {
    const steps = walk(road), offs = steps.map(s => roadAt(road, s) - road.at);
    const swing = Math.max(...offs) - Math.min(...offs);
    assert(swing > 8 && Math.max(...offs.map(Math.abs)) <= 6.4, `${id} wanders ${swing.toFixed(1)} units across its length and is never more than 6.4 off its line: a bend, not a new road`);
    assert(roadAt(road, road.run[0]) === road.at && roadAt(road, road.run[1]) === road.at, `${id} is exactly on its line at both ends: a gate's corridor and a town's way in are met head-on`);
    // the turn is gentle: over any two units it moves less than one across, so the bend is a curve and never a corner
    assert(steps.slice(1).every((s, i) => Math.abs(roadAt(road, s) - roadAt(road, steps[i])) < 1), `${id} turns gently: no step of two units moves it a whole unit across`);
    const widths = steps.map(s => roadHalfWidth(road, s));
    assert(Math.min(...widths) >= 2.6 && Math.max(...widths) <= 5.8 && Math.max(...widths) - Math.min(...widths) > 2, `${id} pinches and opens out, between ${Math.min(...widths).toFixed(1)} and ${Math.max(...widths).toFixed(1)} of half-width`);
  }
  const seeds = new Set(roads.map(r => r.road.seed));
  assert(seeds.size === 4, 'and no two roads wander the same way');
}

section('what belongs to a road moved with it, and what does not is still clear of it');
{
  for (const { id, road } of roads) {
    const r = REGIONS.find(x => x.id === id)!;
    // the toll camp was always meant to hold the road: it is the one camp placed on the line, and the bend does not change that
    const off = (r.spawns ?? []).filter(sp => Math.abs((road.axis === 'x' ? sp.z : sp.x) - road.at) >= 12);
    const worst = off.map(sp => ({ sp, slack: roadDist(road, sp.x, sp.z) - ENEMY_TYPES[sp.type].aggroRadius })).sort((a, c) => a.slack - c.slack)[0];
    assert(worst.slack > 4, `${id}: every camp off the road is still out of its own reach — the tightest, a ${ENEMY_TYPES[worst.sp.type].name}, by ${worst.slack.toFixed(0)}`);
  }
  const grey = roads[0].road, way = REGIONS.find(r => r.id === 'wayside')!;
  const spots = [...way.rocks, ...way.trees];
  assert(spots.length >= 24 && spots.every(p => roadDist(grey, p.x, p.z) >= 8 && roadDist(grey, p.x, p.z) <= 14), 'the waysides bent with the road: every stand is still 8 to 14 off the dirt');
  assert(spots.every(p => regionAt(p.x, p.z)?.id === 'greywater' && clampToWorld(p, p.r).x === p.x), 'and still on the road\'s own floor');
  const fenRoad = roads[1].road, herbs = REGIONS.find(r => r.id === 'dunmere')!.herbs!;
  assert(herbs.every(h => roadDist(fenRoad, h.x, h.z) > roadHalfWidth(fenRoad, fenRoad.axis === 'z' ? h.z : h.x) + 1), 'no fenbloom is left growing in the fen road\'s dirt');
  assert(WITHERING.filter(h => regionAt(h.x, h.z)?.id === 'dunmere').every(h => roadDist(fenRoad, h.x, h.z) - h.r >= 8), 'and no patch of Withering Ground is within eight of it: the road is still the safe way through');
}

section('the forks: a signpost beside the road and a track to somewhere with a name');
{
  assert(BRANCHES.length === 6 && new Set(BRANCHES.map(b => b.id)).size === 6, 'six forks, each with an id of its own');
  assert(ROAD_REGIONS.every(id => branchesOf(id).length >= 1), 'and every long road has at least one, so no stretch of it is a single unbroken choice');
  for (const b of BRANCHES) {
    const road = roadOf(b), fork = roadPoint(road, b.at), post = forkPost(b), track = branchTrack(road, b);
    const along = road.axis === 'x' ? post.x : post.z;
    assert(roadDist(road, post.x, post.z) > roadHalfWidth(road, along) + 1, `${b.id}: its signpost stands clear of the dirt, not in it`);
    assert(dist(fork, b.to) > 30 && dist(fork, b.to) < 90, `${b.id}: the track is ${dist(fork, b.to).toFixed(0)} long — far enough to be a journey, near enough to be a choice`);
    assert(dist(track[0], fork) < 1e-9 && dist(track[track.length - 1], b.to) < 1e-9 && track.every(p => branchDist(road, b, p.x, p.z) < 1e-9), `${b.id}: the track runs from the fork to the waystation, and every point on it is on it`);
    // bowed, not ruled: the middle of the track stands well off the straight line between its ends
    const mid = track[Math.floor(track.length / 2)], straight = { x: (fork.x + b.to.x) / 2, z: (fork.z + b.to.z) / 2 };
    assert(dist(mid, straight) > dist(fork, b.to) * 0.07, `${b.id}: the track is bowed, not ruled straight at the waystation`);
    assert(regionAt(b.to.x, b.to.z)?.id === b.region && track.every(p => regionAt(p.x, p.z)?.id === b.region), `${b.id}: the whole track and the waystation are on its own region's floor`);
  }
}

section('a waystation is somewhere a traveller can stand: clear of camps, hazards and everything standing');
{
  for (const b of BRANCHES) {
    const r = REGIONS.find(x => x.id === b.region)!, keeper = wayKeeper(b);
    const near = (r.spawns ?? []).map(sp => ({ sp, gap: dist(sp, b.to) })).sort((a, c) => a.gap - c.gap)[0];
    assert(!near || near.gap > ENEMY_TYPES[near.sp.type].aggroRadius + 10, `${b.id}: no camp within reach of it (the nearest, a ${ENEMY_TYPES[near.sp.type].name}, is ${near.gap.toFixed(0)} off)`);
    assert(WITHERING.every(h => dist(h, b.to) > h.r + 8), `${b.id}: no Withering Ground on it`);
    // nothing but its own three colliders is standing on the shrine, the keeper or the ground between them
    const own = [b.to, keeper, forkPost(b)], others = COLLIDERS.filter(o => !own.some(p => p.x === o.x && p.z === o.z));
    assert(others.every(o => dist(o, b.to) > o.r + 2.5 && dist(o, keeper) > o.r + PLAYER_RADIUS + 0.5), `${b.id}: nothing is standing on its mark or its keeper`);
    assert(route({ ...forkPost(b) }, { ...keeper }) !== null, `${b.id}: and you can walk from its signpost to its keeper`);
  }
}

section('the villagers: somebody at every waystation, with lore and a direction');
{
  assert(VILLAGERS.length === BRANCHES.length, 'a villager keeps every waystation');
  for (const v of VILLAGERS) {
    const b = branchById(v.id)!;
    assert(v.x === wayKeeper(b).x && v.z === wayKeeper(b).z, `${v.name} stands at ${b.name}`);
    assert(v.lines.length === 3 && v.lines.every(l => l.length > 40), `${v.name} has three things to say and none of them is a stub`);
    assert(COLLIDERS.some(o => o.kind === 'person' && o.x === v.x && o.z === v.z), `${v.name} is somebody you cannot walk through`);
    const d = dialogueAt(createState(1), v.id);
    assert(d.lines === v.lines && d.options.length === 2 && d.options.every(o => !o.advance), `${v.name}'s dialogue is lore and a question, and moves no quest chain`);
    assert(d.options[0].reply === v.answer && npcName(v.id) === v.name, 'the question has its answer, and the panel knows whose name to put on it');
  }
  assert(VILLAGERS.every(v => !NPCS.some(n => n.id === v.id)), 'and none of them is a quest giver');
  // the last line of every villager names the town the road goes on to: this is what stops a player getting lost
  for (const v of VILLAGERS) {
    const b = branchById(v.id)!, town = b.onward.replace(/^the /, '');
    assert(v.lines[2].includes(town), `${v.name} ends by naming ${town}, which is the way on`);
  }
}

section('talking to one: walk up, open the panel, and nothing else moves');
{
  const b = BRANCHES[0], v = villagerById(b.id)!;
  const s = createState(1341);
  s.player.hp = s.player.maxHp = 1e6;
  s.player.x = v.x - 10; s.player.z = v.z;
  assert(speakerNear(s) === null, 'ten paces off, nobody is in earshot');
  tick(s, { interact: { k: 'npc', id: v.id } });
  let who = '';
  for (let n = 0; n < 600 && !who; n++) { tick(s); const ev = s.events.find(e => e.t === 'npc'); if (ev && ev.t === 'npc') who = ev.who; }
  assert(who === v.id, `clicking ${v.name} walks the player over and opens their words`);
  assert(speakerNear(s) === v.id && Math.hypot(s.player.x - v.x, s.player.z - v.z) <= TALK_RANGE, 'and they are the one in earshot once you are there');
  assert(speakerById(v.id)!.name === v.name && speakerById('hale')!.name === NPCS[0].name, 'a villager and a giver are both found by id');
  const before = JSON.stringify(s.quest);
  tick(s, { questAdvance: true });
  assert(JSON.stringify(s.quest) === before, 'and the advance key at a villager moves no chain: they have nothing to give');
}

section('the breadcrumb: the tracker always says which way the next town is');
{
  assert(heading(1, 0) === 'east' && heading(-1, 0) === 'west' && heading(0, 1) === 'south' && heading(0, -1) === 'north' && heading(1, 1) === 'south-east',
    'the compass reads the world as it is laid out: +x east, +z south');
  assert(regionRoute('clearing', 'clearing')!.join() === 'clearing' && regionRoute('clearing', 'saltmarrow')!.join() === 'clearing,greywater,saltmarrow',
    'the region route is the chain of regions between two places, by the seams they already name');
  assert(regionRoute('clearing', 'spire')!.length === 9 && regionRoute('highmoor', 'sanctum')!.join().includes('cairnwaste,spire,sealstair'),
    'and it runs the length of the world, into a dungeon if that is where the thing is');
  assert(regionRoute('clearing', 'nowhere') === null, 'and is null for somewhere that is not there');
  assert(journeyTo({ x: 0, z: 8 }, { x: 5, z: 2 }) === null && journeyTo(LANDMARKS.square, { x: SALTMARROW.x + 60, z: SALTMARROW.z }) === null,
    'nothing is said about a place in the same country, or near: the arrow is answer enough');

  // the four legs of the golden path, each taken from the town before it: the tracker names the way and the town at the end of it
  const legs: [string, Pt, Pt, string, string][] = [
    ['Hale to Saltmarrow', { x: 0, z: 8 }, LANDMARKS.harbourmaster, 'east', 'Saltmarrow'],
    ['Saltmarrow to Thornwick', LANDMARKS.square, LANDMARKS.thornReeve, 'south', 'Thornwick'],
    ['Thornwick to Highmoor', LANDMARKS.thornSquare, LANDMARKS.highSteward, 'east', 'Highmoor'],
    // Corvin's gate is in the north wall but over to the east of the square, and that is the way you actually walk first
    ['Highmoor to the Spire', LANDMARKS.highSquare, LANDMARKS.spireKeeper, 'north-east', 'The Sundered Spire'],
  ];
  for (const [label, from, to, dir, town] of legs) {
    const said = journeyTo(from, to);
    assert(said !== null && said.startsWith(`Travel ${dir} `) && said.endsWith(town), `${label}: "${said}"`);
  }
}

section('and the chain hands the breadcrumb over at every town');
{
  const stand = (p: Pt, q: Partial<GameState['quest']>) => {
    const s = createState(1342);
    s.player.hp = s.player.maxHp = 1e6;
    s.player.x = p.x; s.player.z = p.z;
    Object.assign(s.quest, { stage: 'done', second: 'cleared' }, q);
    tick(s); // updateQuest opens the next chain the moment the last one is handed in
    return s;
  };
  const cases: [string, Pt, Partial<GameState['quest']>, string][] = [
    ['the Hollow quiet, in Hale', { x: 0, z: 8 }, {}, 'Saltmarrow'],
    ['the Strand quiet, in Saltmarrow', LANDMARKS.square, { third: 'cleared', fifth: 'cleared' }, 'Thornwick'],
    ['the Rotroot quiet, in Thornwick', LANDMARKS.thornSquare, { third: 'cleared', fifth: 'cleared', sixth: 'cleared' }, 'Highmoor'],
    ['the writ signed, in Highmoor', LANDMARKS.highSquare, { third: 'cleared', fifth: 'cleared', sixth: 'cleared', seventh: 'cleared' }, 'The Sundered Spire'],
  ];
  for (const [label, p, q, town] of cases) {
    const v = activeQuestView(stand(p, q));
    assert(v.target !== null && v.journey !== null && v.journey.endsWith(town), `${label}: the tracker says "${v.journey}"`);
  }
  // and inside the town you were sent to, it stops nagging: the arrow has it from there
  const there = stand(LANDMARKS.harbourVendor, {});
  assert(activeQuestView(there).target !== null && activeQuestView(there).journey === null, 'once you are in the town the line goes: the arrow has it from there');
}

console.log(`\nAll ${checks} road, fork and villager checks passed.`);

// HOM-87: the first mount. Bought from Thornwick's stablemaster, ridden, and thrown by anything that hurts or fights.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ABILITIES } from './sim/data';
import { LANDMARKS, dungeonById } from './sim/world';
import { THORN_STABLE, SHOP_REACH } from './sim/shop';
import { FOOT_SPEED, MOUNTS, MOUNT_CAST, moveSpeed } from './sim/mounts';
import { harmPlayer, refreshPlayerStats } from './sim/combat';
import { deserialize, serialize } from './sim/save';
import { xpForLevel } from './sim/xp';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => { for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i); };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const failed = (s: GameState) => s.events.find(e => e.t === 'actionfail') as Extract<GameState['events'][number], { t: 'actionfail' }> | undefined;
const roomCentre = (id: string) => { const r = dungeonById(id).rooms[0].rect; return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }; };

/** A new game with every enemy laid low for good, the player at combat `level` standing by Thornwick's stablemaster with `gold`. */
function quiet(level = 20, gold = 0, seed = 8700): GameState {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  p.gold = gold;
  p.x = THORN_STABLE.x + 2.5; p.z = THORN_STABLE.z;
  return s;
}
/** Combat 20 with the first mount owned. */
function owner(): GameState { const s = quiet(20); s.player.mounts.push('courser'); return s; }
/** ...and up on it. */
function riding(): GameState { const s = owner(); tick(s, { mount: true }); run(s, MOUNT_CAST + 0.1); return s; }

section('The stablemaster: one thing to sell, a level and a price');
{
  const m = MOUNTS[0];
  assert(m.speed === 10 && m.level === 20 && m.price === 1000 && m.vendor === 'thorn_stable' && FOOT_SPEED === 6, 'the first mount: combat 20, 1,000 gold, 10 u/s against 6 (bible 4)');
  assert(dist(THORN_STABLE, LANDMARKS.thornStable) === 0 && dist(THORN_STABLE, LANDMARKS.thornSquare) < 35, 'the stablemaster stands in Thornwick\'s square');
  const s = quiet(20, 999);
  tick(s, { shop: [{ k: 'mount', id: 'courser' }] });
  assert(s.player.mounts.length === 0 && s.player.gold === 999 && failed(s)?.reason === 'gold', '999 gold buys nothing');
  s.player.gold = 1000; s.player.x = THORN_STABLE.x + SHOP_REACH + 3;
  tick(s, { shop: [{ k: 'mount', id: 'courser' }] });
  assert(s.player.mounts.length === 0 && failed(s)?.reason === 'range', 'out of the stablemaster\'s reach it is refused');
  s.player.x = THORN_STABLE.x + 2.5;
  const low = quiet(19, 5000);
  tick(low, { shop: [{ k: 'mount', id: 'courser' }] });
  assert(low.player.mounts.length === 0 && failed(low)?.reason === 'mount' && low.player.gold === 5000, 'combat 19 is turned away with the level it needs, and keeps its gold');
  tick(s, { shop: [{ k: 'mount', id: 'courser' }] });
  assert(s.player.mounts.join() === 'courser' && s.player.gold === 0 && s.events.some(e => e.t === 'stable'), 'at 20 with 1,000 in reach, it is bought and paid for');
  s.player.gold = 1000;
  tick(s, { shop: [{ k: 'mount', id: 'courser' }] });
  assert((s.player.mounts as string[]).length === 1 && s.player.gold === 1000, 'and paid for once');
}

section('Mounting: a one second cast, stationary, and nowhere it should not be');
{
  const s = owner();
  tick(s, { mount: true });
  assert(s.player.action?.k === 'mount' && !s.player.mounted, 'the key starts a cast');
  run(s, MOUNT_CAST / 2);
  assert(!s.player.mounted, 'half way, still on foot');
  run(s, MOUNT_CAST / 2 + 0.1);
  assert(s.player.mounted && s.player.action === null && moveSpeed(s.player) === 10, 'after a second, mounted and moving at 10');
  tick(s, { mount: true });
  assert(!s.player.mounted && moveSpeed(s.player) === 6, 'the key again is a free dismount');

  const walk = owner();
  tick(walk, { mount: true }); run(walk, 0.4, { dirX: 1 }); run(walk, 1.5);
  assert(!walk.player.mounted, 'a step mid-cast breaks it');
  const hit = owner();
  tick(hit, { mount: true }); run(hit, 0.4); harmPlayer(hit, 'thornback', undefined, 1, 'Bite'); run(hit, 1.5);
  assert(!hit.player.mounted, 'a hit mid-cast breaks it');
  const jump = owner();
  tick(jump, { mount: true }); run(jump, 0.3, { jump: true }); run(jump, 1.5);
  assert(!jump.player.mounted, 'a jump mid-cast breaks it');

  const none = quiet(20);
  tick(none, { mount: true });
  assert(!none.player.action && failed(none)?.reason === 'mount', 'with no mount owned it says so');
  const fight = owner(); fight.player.inCombat = true; fight.player.outOfCombat = 0;
  tick(fight, { mount: true });
  assert(!fight.player.action && failed(fight)?.reason === 'mount', 'not in combat');
  const work = owner(); work.player.action = { k: 'craft', recipe: 'x', t: 0, duration: 5, left: 1 };
  tick(work, { mount: true });
  assert(work.player.action?.k === 'craft' && failed(work)?.reason === 'mount', 'not while gathering or crafting');
  for (const id of ['rotroot', 'grotto']) {
    const g = owner(); Object.assign(g.player, roomCentre(id));
    tick(g, { mount: true });
    assert(!g.player.action && !g.player.mounted && failed(g)?.reason === 'mount', `refused in ${dungeonById(id).name}`);
  }
}

section('Riding, and what throws you');
{
  const pace = (s: GameState) => { const x0 = s.player.x; run(s, 2, { dirX: 1 }); return (s.player.x - x0) / 2; };
  assert(Math.abs(pace(riding()) - 10) < 0.2 && Math.abs(pace(quiet(20)) - 6) < 0.2, 'two seconds of running covers 10 u/s mounted, 6 on foot');

  const bolt = riding();
  harmPlayer(bolt, 'thorn_warden', 1, 3, 'Bolt');
  assert(!bolt.player.mounted && bolt.player.hp > 0, 'a bolt dismounts you');

  const press = riding(); press.player.energy = press.player.maxEnergy;
  const foe = press.enemies[0]; foe.state = 'idle'; foe.hp = foe.maxHp = 1e9; foe.x = foe.spawnX = press.player.x + 1.5; foe.z = foe.spawnZ = press.player.z; foe.respawnIn = 0; foe.attackCd = 1e9;
  press.targetId = foe.id;
  tick(press, { ability: 0 });
  assert(ABILITIES[0].range >= 1.5, 'the foe is in reach of the first ability');
  assert(!press.player.mounted && press.events.some(e => e.t === 'cast' && e.slot === 0), 'an ability key dismounts and the ability fires on the same tick');

  const swing = riding(); swing.player.autoAttack = true;
  tick(swing);
  assert(!swing.player.autoAttack, 'auto-attack does not run from the saddle');

  const spot = riding(); spot.player.x = LANDMARKS.forge.x + 4; spot.player.z = LANDMARKS.forge.z;
  tick(spot, { interact: { k: 'forge' } });
  assert(!spot.player.mounted, 'using the forge from the saddle puts you down off the horse');

  const cave = riding(); Object.assign(cave.player, roomCentre('rotroot'));
  tick(cave);
  assert(!cave.player.mounted, 'a dungeon room takes you off the horse');
}

section('A held key carries the rider at 10 u/s');
{
  const s = riding(), from = { x: s.player.x, z: s.player.z };
  let ticks = 0;
  while (dist(s.player, from) < 40 && ticks++ < 600) tick(s, { dirX: 1 });
  assert(Math.abs(ticks * TICK_DT - 4) < 0.3, `40 units took ${(ticks * TICK_DT).toFixed(2)} s: 10 u/s`);
  tick(s); tick(s);
  assert(!s.player.moving, 'and letting go stops the rider dead: nothing carries them on');
}

section('Saved and reloaded');
{
  const s = riding();
  const back = deserialize(serialize(s))!;
  assert(back.player.mounts.join() === 'courser' && back.player.mounted && moveSpeed(back.player) === 10, 'the mount and the saddle survive a save');
  const old = JSON.parse(serialize(s)); delete old.player.mounts; delete old.player.mounted;
  const o = deserialize(JSON.stringify(old))!;
  assert(o.player.mounts.length === 0 && !o.player.mounted, 'a save from before the stablemaster loads on foot, owning nothing');
  const bad = JSON.parse(serialize(s)); bad.player.mounts = ['unicorn'];
  assert(deserialize(JSON.stringify(bad)) === null, 'an unknown mount refuses the save');
  const lone = JSON.parse(serialize(quiet(20))); lone.player.mounted = true;
  assert(!deserialize(JSON.stringify(lone))!.player.mounted, 'a saddle with no horse in it is empty');
  const inside = JSON.parse(serialize(s)); Object.assign(inside.player, roomCentre('rotroot'));
  const d = deserialize(JSON.stringify(inside))!;
  assert(d.player.mounts.length === 1 && !d.player.mounted, 'loaded inside a dungeon room, the horse is kept and the saddle is empty');
}

console.log(`\n${checks} checks passed`);

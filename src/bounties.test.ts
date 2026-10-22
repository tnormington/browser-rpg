// HOM-163: the boards. The table's integrity (every row names real enemies in real regions, nothing is unfinishable), the lifecycle (accept, count, hand in,
// accept again), the scaling shapes, and the save. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { COLLIDERS, TOWNS, SAFE_ZONES, regionAt, REGIONS } from './sim/world';
import { ENEMY_TYPES, SPAWNS, aggroRadius } from './sim/data';
import { ITEMS } from './sim/items';
import {
  BOARDS, BOUNTIES, BountyDef, MAX_ACTIVE, MAX_GOAL, acceptBounty, abandonBounty, boardById, boardNear, bountyById, bountyOnKill, counts, finishable,
  offers, resolveBounty, scaled, targetSig, turnInBounty,
} from './sim/bounties';
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
const kills = (s: GameState, i = 0) => s.bounties.active[i].kills as number;
const count = (s: GameState) => s.bounties.active.length as number;
const bountyEvents = (s: GameState) => s.events.filter((e): e is Extract<GameState['events'][number], { t: 'bounty' }> => e.t === 'bounty');

/** A calm world, the player standing a pace from a town's board. */
function atBoard(town: string, level = 1): GameState {
  const s = createState(7);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const b = boardById(town)!;
  s.player.x = b.x; s.player.z = b.z + b.r + 1.2;
  if (level > 1) { s.player.skills.combat.xp = xpForLevel(level); s.player.skills.combat.level = level; }
  return s;
}
/** What the board's own test needs of a def: a bounty by id, which must exist. */
const def = (id: string): BountyDef => bountyById(id)!;

// ---------------------------------------------------------------------------
section('HOM-163 the table: every row is real and can be finished');
{
  assert(new Set(BOUNTIES.map(b => b.id)).size === BOUNTIES.length, 'ids are unique');
  assert(BOARDS.length === 5 && TOWNS.every(t => boardById(t.id)), 'a board in each of the five towns');
  assert(TOWNS.every(t => BOUNTIES.some(b => b.board === t.id)), 'and every board has something on it');
  for (const b of BOUNTIES) {
    assert(!!boardById(b.board), `${b.id}: its board exists`);
    assert((b.target.types ?? []).every(t => ENEMY_TYPES[t]), `${b.id}: every enemy it names exists`);
    assert((b.target.regions ?? []).every(r => REGIONS.some(x => x.id === r)), `${b.id}: every region it names exists`);
    assert(SPAWNS.some(sp => counts(b, sp.type, regionAt(sp.x, sp.z)?.id ?? '', b.target.levelBand === undefined ? 1 : ENEMY_TYPES[sp.type].level)), `${b.id}: something in the world counts for it`);
    // a fixed target is as easy to finish at 99 as at 1: only a level-following one may run out of enemies (the board then declines to offer it)
    if (b.target.levelBand === undefined) assert(finishable(b, 1) && finishable(b, 99), `${b.id}: finishable at any level`);
    for (const level of [1, 10, 25, 42, 60, 99]) {
      const r = resolveBounty(b, level);
      assert(Number.isInteger(r.goal) && r.goal >= 1 && r.goal <= MAX_GOAL && r.gold >= 0 && r.xp >= 0, `${b.id}: a sane goal and reward at level ${level}`);
    }
    assert((b.reward.items ?? []).every(i => ITEMS[i.id] && i.qty >= 1), `${b.id}: its item rewards exist`);
  }
}

// ---------------------------------------------------------------------------
section('HOM-163 the boards stand where you can read them');
{
  for (const b of BOARDS) {
    const t = TOWNS.find(x => x.id === b.id)!;
    const safe = SAFE_ZONES.find(z => Math.hypot(z.x - t.wake.x, z.z - t.wake.z) <= z.r);
    if (b.id === 'hale') { // the clearing has no town circle: its board only has to be outside every spawn's notice radius for a level 1 player, with a margin
      const margin = Math.min(...SPAWNS.filter(sp => regionAt(sp.x, sp.z)?.id === 'clearing').map(sp => Math.hypot(sp.x - b.x, sp.z - b.z) - aggroRadius(ENEMY_TYPES[sp.type], 1)));
      assert(margin >= 1.5, `hale: ${margin.toFixed(1)} clear of the nearest enemy's notice`);
    } else assert(!!safe && Math.hypot(safe.x - b.x, safe.z - b.z) <= safe.r, `${b.id}: inside the town's safe circle`);
    assert(Math.hypot(t.wake.x - b.x, t.wake.z - b.z) < 20, `${b.id}: within a few steps of where you arrive`);
    const clash = COLLIDERS.filter(o => !(o.x === b.x && o.z === b.z) && Math.hypot(o.x - b.x, o.z - b.z) < o.r + b.r + 1.2);
    assert(clash.length === 0, `${b.id}: nothing crowds it (a player can stand all round it)`);
    assert(COLLIDERS.some(o => o.kind === 'board' && o.x === b.x && o.z === b.z), `${b.id}: it is a collider, something you stand beside`);
  }
  assert(regionAt(boardById('hale')!.x, boardById('hale')!.z)?.id === 'clearing', "Hale's is in the clearing");
  const s = atBoard('saltmarrow');
  assert(boardNear(s)?.id === 'saltmarrow', 'standing beside one is near it');
  s.player.x += 30;
  assert(boardNear(s) === undefined, 'and thirty paces off is not');
}

// ---------------------------------------------------------------------------
section('HOM-163 accept, count, hand in, accept again');
{
  const s = atBoard('hale');
  const id = 'hale-boars', d = def(id), goal = resolveBounty(d, 1).goal;
  assert(!offers(s, 'hale').find(o => o.def.id === id)!.active, 'on offer to begin with');
  assert(acceptBounty(s, id).ok && s.bounties.active.length === 1, 'taken at its board');
  assert(bountyEvents(s)[0]?.what === 'accept' && bountyEvents(s)[0].goal === goal, 'and it says so, with its goal');
  assert(!acceptBounty(s, id).ok && s.bounties.active.length === 1, 'it cannot be taken twice at once');

  // kills: the right enemy in the right region counts; a wolf, a boar of another region, and a boar anywhere else do not
  s.events.length = 0;
  bountyOnKill(s, 'wolf', 'clearing');
  bountyOnKill(s, 'boar', 'greywater');
  assert(kills(s) === 0 && bountyEvents(s).length === 0, 'the wrong enemy, or the right one in the wrong place, is not counted');
  bountyOnKill(s, 'boar', 'clearing');
  assert(kills(s) === 1 && bountyEvents(s)[0].what === 'progress', 'a boar in the clearing is');
  assert(!turnInBounty(s, id).ok && s.bounties.done[id] === undefined, 'it cannot be handed in unfinished');
  for (let i = 1; i < goal; i++) bountyOnKill(s, 'boar', 'clearing');
  assert(bountyEvents(s).at(-1)!.what === 'ready' && kills(s) === goal, 'the last one says it is done');
  bountyOnKill(s, 'boar', 'clearing');
  assert(kills(s) === goal, 'and nothing counts past the goal');

  // handing in pays what it said it would at accept, once
  const gold = s.player.gold, xp = s.player.skills.combat.xp, a = s.bounties.active[0];
  s.player.x += 40;
  assert(!turnInBounty(s, id).ok && s.bounties.active.length === 1, 'away from the board it cannot be handed in');
  s.player.x -= 40;
  assert(turnInBounty(s, id).ok, 'at the board it can');
  assert(s.player.gold === gold + a.gold && s.player.skills.combat.xp === xp + a.xp, `it pays ${a.gold} gold and ${a.xp} XP`);
  assert(count(s) === 0 && s.bounties.done[id] === 1, 'it leaves the page and is counted');
  assert(bountyEvents(s).some(e => e.what === 'turnin'), 'and says so');
  assert(acceptBounty(s, id).ok && kills(s) === 0, 'and it is on offer again, from nothing');
  assert(offers(s, 'hale').find(o => o.def.id === id)!.done === 1, 'the board remembers it was done once');
}

// ---------------------------------------------------------------------------
section('HOM-163 the rules around it');
{
  const s = atBoard('hale');
  assert(!acceptBounty(s, 'salt-crabs').ok && !acceptBounty(s, 'nope').ok, "a bounty from another town's board, or one that does not exist, is refused");
  s.player.x += 30;
  assert(!acceptBounty(s, 'hale-boars').ok && s.bounties.active.length === 0, 'from out of reach is refused');
  s.player.x -= 30;
  assert(acceptBounty(s, 'hale-boars').ok && acceptBounty(s, 'hale-pack').ok && count(s) === 2, 'two can be carried at once');
  const t = atBoard('hale');
  for (let i = 0; i < MAX_ACTIVE; i++) t.bounties.active.push({ id: `filler-${i}`, sig: '', kills: 0, goal: 1, gold: 0, xp: 0 });
  const r = acceptBounty(t, 'hale-boars');
  assert(!r.ok && r.why === 'slots', `with ${MAX_ACTIVE} carried, another is refused for want of room`);
  const u = atBoard('hale');
  acceptBounty(u, 'hale-boars');
  u.events.length = 0;
  assert(abandonBounty(u, 'hale-boars').ok && u.bounties.active.length === 0 && bountyEvents(u)[0].what === 'abandon', 'a bounty can be dropped');
  assert(u.bounties.done['hale-boars'] === undefined && acceptBounty(u, 'hale-boars').ok, 'dropping is not finishing, and it is on offer again');

  const v = atBoard('hale');
  v.player.dead = true;
  assert(!acceptBounty(v, 'hale-boars').ok, 'the dead take nothing from a board');

  // a full bag blocks an item reward and loses nothing
  const w = atBoard('hale');
  const item = Object.keys(ITEMS)[0];
  const patched: BountyDef = { ...def('hale-boars'), id: 'hale-boars', reward: { gold: 1, xp: 1, items: [{ id: item, qty: 1 }] } };
  const idx = BOUNTIES.findIndex(b => b.id === 'hale-boars'), original = BOUNTIES[idx];
  BOUNTIES[idx] = patched;
  try {
    acceptBounty(w, 'hale-boars');
    for (let i = 0; i < w.bounties.active[0].goal; i++) bountyOnKill(w, 'boar', 'clearing');
    for (let i = 0; i < w.player.inventory.length; i++) w.player.inventory[i] = { id: i % 2 ? 'rusty_blade' : 'hide_jerkin', qty: 1 };
    const full = turnInBounty(w, 'hale-boars');
    assert(!full.ok && full.why === 'full' && w.bounties.active.length === 1, 'a full bag refuses an item reward and keeps the bounty');
    w.player.inventory[0] = null;
    assert(turnInBounty(w, 'hale-boars').ok, 'and hands it over once there is room');
  } finally { BOUNTIES[idx] = original; }
}

// ---------------------------------------------------------------------------
section('HOM-163 scaling is data');
{
  assert(scaled(8, 50) === 8 && scaled({ base: 8, perLevel: 0.25 }, 1) === 8 && scaled({ base: 8, perLevel: 0.25 }, 41) === 18, 'a Scale is a number, or base plus per-level, rounded');
  const peace = def('spire-peace');
  assert(resolveBounty(peace, 1).goal < resolveBounty(peace, 40).goal, 'a scaled count asks for more of a stronger player');
  const s = atBoard('spire', 30);
  assert(acceptBounty(s, 'spire-peace').ok, 'a level-following bounty is offered while enemies are in the band');
  const a = s.bounties.active[0], goalThen = a.goal;
  bountyOnKill(s, 'wolf', 'clearing');
  assert(a.kills === 0, 'a level 3 wolf is no match for a level 30 player, and does not count');
  bountyOnKill(s, 'rune_golem', 'spire'); // level 38: eight above, out of the band
  bountyOnKill(s, 'ridge_ogre', 'highmoor'); // level 30
  bountyOnKill(s, 'moor_ram', 'highmoor'); // level 28
  assert(kills(s) === 2, 'a level 30 and a level 28 do, wherever they are, and a level 38 does not');
  BOUNTIES[BOUNTIES.indexOf(peace)] = { ...peace, count: 999 };
  assert(a.goal === goalThen, 'the table moving does not move a bounty already taken');
  BOUNTIES[BOUNTIES.findIndex(b => b.id === 'spire-peace')] = peace;
  const top = atBoard('spire', 60);
  const r = acceptBounty(top, 'spire-peace');
  assert(!r.ok && r.why === 'level' && !offers(top, 'spire').find(o => o.def.id === 'spire-peace')!.active, 'past the strongest enemy there is nothing in the band, so the board declines to offer it');
  assert(offers(top, 'spire').find(o => o.def.id === 'spire-peace')!.why === 'level', 'and says why');
  const maxLevel = Math.max(...Object.values(ENEMY_TYPES).map(e => e.level));
  assert(finishable(peace, maxLevel) && !finishable(peace, maxLevel + peace.target.levelBand! + 1), `it is offered up to level ${maxLevel + peace.target.levelBand!} and no further`);
}

// ---------------------------------------------------------------------------
section('HOM-163 through the real step: the click, the panel event, the kill');
{
  const s = atBoard('hale');
  tick(s, { interact: { k: 'board', id: 'hale' } });
  assert(s.events.some(e => e.t === 'board' && e.town === 'hale'), 'a click on the board opens it');
  tick(s, { bounty: [{ k: 'accept', id: 'hale-boars' }] });
  assert(s.bounties.active.some(a => a.id === 'hale-boars'), 'a request from the panel takes the bounty');
  // a real kill: a boar laid on the player, one hit from death
  const boar = s.enemies.find(e => e.type === 'boar' && e.region === 'clearing')!;
  boar.state = 'idle'; boar.hp = 1; boar.respawnIn = 0; boar.deadFor = 0;
  boar.x = s.player.x + 1.5; boar.z = s.player.z; boar.spawnX = boar.x; boar.spawnZ = boar.z;
  s.targetId = boar.id;
  run(s, 3, { ability: 0 });
  assert((boar.state as string) === 'dead' && kills(s) === 1, 'killing a boar in the clearing moves the bounty');
  const far = atBoard('hale');
  far.player.x += 30;
  tick(far, { bounty: [{ k: 'accept', id: 'hale-boars' }] });
  assert(far.bounties.active.length === 0 && far.events.some(e => e.t === 'actionfail'), 'a request from out of reach is refused, and says so');
}

// ---------------------------------------------------------------------------
section('HOM-163 the save keeps it, and a changed table cannot corrupt it');
{
  const s = atBoard('hale');
  acceptBounty(s, 'hale-boars');
  bountyOnKill(s, 'boar', 'clearing'); bountyOnKill(s, 'boar', 'clearing');
  acceptBounty(s, 'hale-pack');
  s.bounties.done['hale-pack'] = 3;
  const back = deserialize(serialize(s))!;
  assert(!!back && back.bounties.active.length === 2, 'both come back');
  const boars = back.bounties.active.find(a => a.id === 'hale-boars')!;
  assert(boars.kills === 2 && boars.goal === s.bounties.active[0].goal && boars.gold === s.bounties.active[0].gold && boars.xp === s.bounties.active[0].xp, 'with their progress, their goal and their pay');
  assert(back.bounties.done['hale-pack'] === 3, 'and the count of times done');

  const raw = JSON.parse(serialize(s));
  const mutate = (f: (b: any) => void) => { const r = JSON.parse(JSON.stringify(raw)); f(r.bounties); return deserialize(JSON.stringify(r)); };
  const gone = mutate(b => { b.active[0].id = 'retired-bounty'; b.done['retired-bounty'] = 4; });
  assert(!!gone && gone.bounties.active.length === 1 && gone.bounties.done['retired-bounty'] === undefined, 'a bounty the table no longer has is ignored, and the rest of the save loads');
  const reaimed = mutate(b => { b.active[0].sig = 'wolf|clearing|'; });
  assert(!!reaimed && !reaimed.bounties.active.some(a => a.id === 'hale-boars') && reaimed.bounties.active.length === 1, 'a bounty whose target changed since is ignored, not given progress it did not earn');
  assert(targetSig(def('hale-boars')) === boars.sig, 'the signature is the target and nothing else (a changed reward does not drop it)');
  const over = mutate(b => { b.active[0].kills = 9999; });
  assert(over === null, 'an impossible count refuses the save, like any other corrupt number');
  const bigger = mutate(b => { b.active[0].kills = 40; b.active[0].goal = 8; });
  assert(!!bigger && bigger.bounties.active[0].kills === 8, 'progress past the goal is clamped to it, so it is finishable');
  const old = JSON.parse(serialize(s)); delete old.bounties;
  const loaded = deserialize(JSON.stringify(old));
  assert(!!loaded && loaded.bounties.active.length === 0 && Object.keys(loaded.bounties.done).length === 0, 'a save from before the boards loads with none carried');
  const crowd = mutate(b => { for (let i = 0; i < 10; i++) b.active.push({ ...b.active[0] }); });
  assert(!!crowd && crowd.bounties.active.length === 2, 'a doubled-up save keeps one of each and no more than the page holds');
}

console.log(`\n${checks} checks passed`);

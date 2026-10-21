// HOM-66: the Rotroot (three rooms behind a hard-gated mouth), Q5 which opens it, the Rotroot Mother and her Edge, and Guard: the first off-GCD defensive.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { ABILITIES, GCD, QUEUE_WINDOW } from './sim/data';
import { ITEMS } from './sim/items';
import { addItem, countItem } from './sim/inventory';
import { RECIPES } from './sim/crafting';
import { THORNWICK, LANDMARKS, dungeonAt, dungeonById, regionAt } from './sim/world';
import { ROTROOT_COMBAT, dungeonOpen } from './sim/dungeon';
import { route } from './sim/path';
import { REWARD6, ROT_GOALS, QUEST6_NAME, activeQuestView, dialogueAt, reeveMarker } from './sim/quest';
import { harmPlayer, pressAbility, abilityOpen, refreshPlayerStats } from './sim/combat';
import { THORN_TRAINER, SHOP_REACH, taughtBy } from './sim/shop';
import { BUFFS } from './sim/consumables';
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

/** A new game with every enemy laid low for good (this is about the ground and the buttons, not a fight), the player at combat `level`. */
function quiet(level = 1, seed = 6600): GameState {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  return s;
}
const GUARD = ABILITIES.findIndex(a => a.kind === 'guard'), STRIKE = 0, CRUSH = 1;
const hasEvent = (s: GameState, f: (e: GameState['events'][number]) => boolean) => s.events.some(f);
const MOUTH = { x: THORNWICK.x + 42.5, z: THORNWICK.z + 66 };
const rotroot = dungeonById('rotroot');
/** A game with a live enemy of `type` posted next to the player and targeted, the player learned in Guard. */
function withFoe(type = 'thornback'): GameState {
  const s = quiet(24, 6601);
  const p = s.player;
  p.learned.push('Guard');
  const e = s.enemies.find(x => x.type === type)!;
  p.x = e.spawnX; p.z = e.spawnZ + 2.5; p.facing = Math.PI;
  e.state = 'idle'; e.hp = e.maxHp = 1e9; e.x = e.spawnX; e.z = e.spawnZ; e.respawnIn = 0; e.attackCd = 1e9;
  s.targetId = e.id;
  p.energy = p.maxEnergy;
  return s;
}

// ---------------------------------------------------------------------------
section('Guard: the ability, and the trainer who sells it');
{
  const g = ABILITIES[GUARD];
  assert(g.name === 'Guard' && g.kind === 'guard' && g.offGcd === true && g.cost === 20 && g.cooldown === 30 && g.unlockLevel === 20, 'Guard: off the GCD, 20 energy, a 30 s cooldown, combat 20 (bible 3.5)');
  assert(g.trainer?.price === 350 && g.trainer.vendor === 'thorn_trainer' && taughtBy('thorn_trainer').join() === String(GUARD), 'bought from the Thornwick trainer for 350 gold, and she teaches nothing else');
  assert(BUFFS[g.buff!].duration === 4 && BUFFS[g.buff!].damageTaken === 0.5, 'it puts on a four-second buff that halves the damage taken');
  const s = quiet(20);
  const p = s.player;
  p.x = THORN_TRAINER.x + 1; p.z = THORN_TRAINER.z; p.gold = 349;
  assert(!abilityOpen(p, GUARD), 'at combat 20 with the gold it is still locked: it has to be bought');
  tick(s, { ability: GUARD });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'locked') && p.energy >= p.maxEnergy - 1 && p.cd[GUARD] === 0, 'pressing it before learning it does nothing and says it is locked');
  tick(s, { shop: [{ k: 'learn', slot: GUARD }] });
  assert(!p.learned.includes('Guard') && p.gold === 349 && hasEvent(s, e => e.t === 'actionfail' && e.reason === 'gold'), '349 gold is a refusal, and keeps the gold');
  p.gold = 350; p.x = THORN_TRAINER.x + SHOP_REACH + 3;
  tick(s, { shop: [{ k: 'learn', slot: GUARD }] });
  assert(!p.learned.includes('Guard') && hasEvent(s, e => e.t === 'actionfail' && e.reason === 'range'), 'out of reach of the trainer it is refused too');
  p.x = THORN_TRAINER.x + 1;
  const low = quiet(19); low.player.gold = 999; low.player.x = THORN_TRAINER.x; low.player.z = THORN_TRAINER.z;
  tick(low, { shop: [{ k: 'learn', slot: GUARD }] });
  assert(!low.player.learned.includes('Guard') && low.player.gold === 999, 'under combat 20 it is refused whatever you carry');
  tick(s, { shop: [{ k: 'learn', slot: GUARD }] });
  assert(p.learned.includes('Guard') && p.gold === 0 && hasEvent(s, e => e.t === 'learn' && e.slot === GUARD && e.gold === 350) && abilityOpen(p, GUARD), 'at combat 20, 350 gold and in reach: learned, paid once');
  const back = deserialize(serialize(s))!;
  assert(back.player.learned.includes('Guard') && abilityOpen(back.player, GUARD), 'the learned ability survives a save and load');
  assert(dist(THORN_TRAINER, LANDMARKS.thornTrainer) === 0 && regionAt(THORN_TRAINER.x, THORN_TRAINER.z)?.id === 'thornwick' && dist(THORN_TRAINER, LANDMARKS.thornSquare) < 35, 'the trainer stands in Thornwick\'s square');
}

// ---------------------------------------------------------------------------
section('Guard: halves what lands, for four seconds');
{
  const s = withFoe();
  const p = s.player;
  /** What a hit of `n` actually takes from a full bar. */
  const lose = (n: number, heavy = false) => { p.hp = p.maxHp; harmPlayer(s, 'thornback', undefined, n, heavy ? 'Root Slam' : 'Melee', heavy); return p.maxHp - p.hp; };
  assert(lose(100) === 100, 'without it a hit of 100 costs 100');
  p.energy = 50;
  tick(s, { ability: GUARD });
  assert(p.buffs.some(b => b.id === 'guard') && p.cd[GUARD] > 29.9 && hasEvent(s, e => e.t === 'buff' && e.id === 'guard' && e.on), 'Guard goes on, and its 30 s cooldown starts');
  assert(p.energy < 31 && p.energy > 29, 'and costs 20 energy');
  assert(lose(100) === 50, 'a hit of 100 costs 50 while it is up');
  assert(lose(351, true) === 176 && p.recap[p.recap.length - 1].amount === 176, 'a heavy slam of 351 costs 176 (and the death recap says 176): it halves every hit, not only melee');
  assert(lose(1) === 1, 'and no hit is ever worth less than 1');
  run(s, 3.4);
  assert(lose(100) === 50, 'still up at 3.5 s');
  run(s, 0.7);
  assert(!p.buffs.some(b => b.id === 'guard') && lose(100) === 100, 'gone after 4 s, and the next hit lands whole');
  tick(s, { ability: GUARD });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'cooldown') && !p.buffs.some(b => b.id === 'guard'), 'it cannot be raised again inside its cooldown');
  run(s, 27);
  p.energy = p.maxEnergy;
  tick(s, { ability: GUARD });
  assert(p.buffs.some(b => b.id === 'guard'), 'thirty seconds on, it can');
  p.hp = 1; harmPlayer(s, 'thornback', undefined, 1000, 'Root Slam', true);
  assert(p.dead && !p.buffs.some(b => b.id === 'guard'), 'death takes the buff with everything else');
}

// ---------------------------------------------------------------------------
section('Guard: off the global cooldown, and it never eats the next action');
{
  // pressed with no GCD running: it takes none
  let s = withFoe();
  let p = s.player;
  tick(s, { ability: GUARD });
  assert(p.gcd === 0 && p.buffs.some(b => b.id === 'guard'), 'Guard on its own starts no GCD');
  tick(s, { ability: STRIKE });
  assert(p.gcd > GCD - 0.2 && p.cd[STRIKE] >= 0, 'and Strike straight after it still gets its GCD, with nothing waited on');

  // pressed in the middle of a GCD: it fires at once, and leaves the GCD where it was
  s = withFoe(); p = s.player;
  tick(s, { ability: STRIKE });
  run(s, 0.3);
  const gcdBefore = p.gcd;
  assert(gcdBefore > 1, 'a Strike is a second off ready');
  tick(s, { ability: GUARD });
  assert(p.buffs.some(b => b.id === 'guard') && p.gcd <= gcdBefore && p.gcd >= gcdBefore - 2 * TICK_DT - 1e-9, 'Guard pressed mid-GCD goes up that tick and does not move the GCD');
  assert(!hasEvent(s, e => e.t === 'fail'), 'with no refusal in the log');

  // a GCD ability is held (inside the queue window): Guard must not replace it
  s = withFoe(); p = s.player;
  tick(s, { ability: STRIKE });
  run(s, GCD - QUEUE_WINDOW / 2 - 0.05);
  tick(s, { ability: CRUSH });
  assert(p.queued === CRUSH, 'Crushing Blow is pressed just before the GCD ends and held');
  tick(s, { ability: GUARD });
  assert(p.queued === CRUSH && p.buffs.some(b => b.id === 'guard'), 'Guard goes up and the held Crushing Blow is still held');
  run(s, 0.5);
  assert(p.queued === null && p.cd[CRUSH] > 0, 'and it fires when the GCD ends');

  // the other way round: a Guard held on its cooldown is not thrown out by a GCD press, nor does it throw one out
  s = withFoe(); p = s.player;
  tick(s, { ability: STRIKE });
  run(s, GCD - QUEUE_WINDOW / 2 - 0.05);
  p.cd[GUARD] = QUEUE_WINDOW / 2; // as if it were nearly ready again
  tick(s, { ability: CRUSH });
  tick(s, { ability: GUARD });
  assert(p.queuedOff === GUARD && p.queued === CRUSH, 'Guard held on its cooldown and Crushing Blow held on the GCD sit in separate places');
  run(s, 0.5);
  assert(p.queuedOff === null && p.queued === null && p.buffs.some(b => b.id === 'guard') && p.cd[CRUSH] > 0, 'both fire: the guard when its cooldown ends, the blow when the GCD does');

  // a refused Guard (no energy) eats nothing either
  s = withFoe(); p = s.player;
  tick(s, { ability: STRIKE });
  run(s, GCD - QUEUE_WINDOW / 2 - 0.05);
  tick(s, { ability: CRUSH });
  p.energy = 5;
  tick(s, { ability: GUARD });
  assert(hasEvent(s, e => e.t === 'fail' && e.reason === 'energy') && p.queued === CRUSH && p.cd[GUARD] === 0, 'with no energy Guard is refused, costs and cools nothing, and the held blow stays held');

  // pressing it mid-swing / mid-gather does not cancel the work
  s = withFoe(); p = s.player;
  p.action = { k: 'gather', node: 0, left: 5, total: 5 } as unknown as typeof p.action;
  pressAbility(s, GUARD);
  assert(p.action !== null && p.buffs.some(b => b.id === 'guard'), 'raising a guard does not break off what you were doing');
  pressAbility(s, STRIKE);
  assert(p.action === null, 'where a Strike does');
}

// ---------------------------------------------------------------------------
section('the Rotroot Mother and her Edge');
{
  const edge = ITEMS.rotroot_edge, r = RECIPES.find(x => x.id === 'rotroot_edge')!;
  assert(edge.stats!.damage === 72 && edge.req!.combat === 26 && edge.slot === 'weapon' && edge.tier === 5, 'the Rotroot Edge: damage 72, equip combat 26 (the bible 3.3)');
  assert(r.skill === 'smithing' && r.level === 42 && r.inputs.some(i => i.id === 'heartwood_shard' && i.qty === 3) && r.output.id === 'rotroot_edge', 'smithed at Smithing 42 from three Heartwood shards');
  assert(r.inputs.length === 2 && r.inputs.some(i => i.id === 'stormiron_bar' && i.qty === 3), 'with three stormiron bars (HOM-99: they were adamant while stormiron was unbuilt), and nothing else');
  const forge = quiet(26, 6602), fp = forge.player;
  fp.x = LANDMARKS.forge.x - 2; fp.z = LANDMARKS.forge.z; fp.skills.smithing.level = 42; fp.skills.smithing.xp = xpForLevel(42);
  for (const [id, qty] of [['adamant_bar', 3], ['heartwood_shard', 3]] as const) addItem(fp.inventory, id, qty);
  tick(forge, { craft: { recipe: 'rotroot_edge', count: 1 } });
  assert(!forge.player.inventory.some(st => st?.id === 'rotroot_edge') && forge.player.action === null, 'three adamant bars and three shards no longer make it');
  addItem(fp.inventory, 'stormiron_bar', 3);
  tick(forge, { craft: { recipe: 'rotroot_edge', count: 1 } });
  run(forge, 16);
  assert(countItem(fp.inventory, 'rotroot_edge') === 1 && countItem(fp.inventory, 'stormiron_bar') === 0 && countItem(fp.inventory, 'heartwood_shard') === 0 && countItem(fp.inventory, 'adamant_bar') === 3, 'three stormiron bars and three shards do, and the adamant is left in the bag');
  assert(ITEMS.heartwood_shard.stack === 50, 'shards stack');
  // she does all three tells: the Hex Bolt at a player who stands off, the Root Slam and the Spore Cloud on one who stays in reach
  const m = quiet(26, 6603), mm = m.enemies.find(e => e.type === 'rotroot_mother')!;
  mm.state = 'idle'; mm.hp = mm.maxHp; mm.respawnIn = 0;
  const seen = new Set<string>();
  const watch = (sec: number) => { for (let n = 0; n < Math.round(sec / TICK_DT); n++) { m.player.hp = 1e9; tick(m); for (const ev of m.events) if (ev.t === 'telegraph' && ev.id === mm.id) seen.add(ev.kind); } };
  m.player.x = mm.x; m.player.z = mm.z - 10;
  watch(2.5);
  assert(seen.has('bolt') && !seen.has('heavy'), 'stood off at ten units, she throws the Hex Bolt and does not slam');
  m.player.x = mm.x; m.player.z = mm.z - 2.5; mm.attackCd = 0;
  watch(16);
  assert(seen.has('heavy') && seen.has('ground'), `in reach she slams and marks the ground (${[...seen].sort().join(', ')})`);
}

// ---------------------------------------------------------------------------
section('the mouth is hard-gated on Q5 and combat 22');
{
  let told = 0;
  const walkIn = (s: GameState) => {
    const p = s.player;
    p.x = MOUTH.x; p.z = THORNWICK.z + 62; p.hp = p.maxHp = 1e6;
    for (let n = 0; n < Math.round(4 / TICK_DT); n++) { tick(s, { dirZ: 1 }); if (hasEvent(s, e => e.t === 'door' && e.dungeon === 'rotroot')) told++; }
    return dungeonAt(p.x, p.z) === rotroot;
  };
  let s = quiet(26);
  assert(!dungeonOpen(s, rotroot) && !walkIn(s), 'a combat 26 player with no Q5 is turned back at the mouth');
  assert(told >= 1 && told <= 3, `and the door says why, once in a while rather than every tick (${told} times in 4 s)`);
  s = quiet(21);
  s.quest.stage = 'done'; s.quest.second = 'cleared'; s.quest.third = 'cleared'; s.quest.fifth = 'cleared'; s.quest.sixth = 'cleared';
  assert(!dungeonOpen(s, rotroot) && !walkIn(s), 'Q5 done at combat 21 is not enough');
  s = quiet(ROTROOT_COMBAT);
  s.quest.stage = 'done'; s.quest.second = 'cleared'; s.quest.third = 'cleared'; s.quest.fifth = 'cleared'; s.quest.sixth = 'report';
  assert(!dungeonOpen(s, rotroot), 'Q5 not yet handed in is not enough at combat 22');
  s.quest.sixth = 'cleared';
  assert(dungeonOpen(s, rotroot) && walkIn(s), 'Q5 handed in at combat 22: the mouth lets you in');
  // the town's edge leads to the Mother on foot, through all three rooms
  s = quiet(26); s.quest.stage = 'done'; s.quest.second = 'cleared'; s.quest.third = 'cleared'; s.quest.fifth = 'cleared'; s.quest.sixth = 'cleared';
  const mother = s.enemies.find(e => e.type === 'rotroot_mother')!;
  s.player.x = MOUTH.x; s.player.z = THORNWICK.z + 60; s.player.hp = s.player.maxHp = 1e6;
  const goal = { x: mother.x, z: mother.z - 8 };
  const pts = route(s.player, goal) ?? [goal];
  const rooms: string[] = [];
  for (let t = 0; t < 90 && dist(s.player, goal) > 2; t += TICK_DT) {
    while (pts.length > 1 && dist(s.player, pts[0]) < 0.3) pts.shift();
    const dx = pts[0].x - s.player.x, dz = pts[0].z - s.player.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) break;
    tick(s, { dirX: dx / d, dirZ: dz / d });
    const id = regionAt(s.player.x, s.player.z)?.id ?? '?';
    if (rooms[rooms.length - 1] !== id) rooms.push(id);
  }
  assert(dist(s.player, goal) <= 2 && rooms.join() === 'thornwick,mouth,warren,heart', `the walk crosses the three rooms (${rooms.join(' > ')})`);
}

// ---------------------------------------------------------------------------
section('Q5, The Rotroot: the reeve, the cult, the hand-in');
{
  const reeve = LANDMARKS.thornReeve;
  const s = quiet(22);
  s.player.x = reeve.x + 2; s.player.z = reeve.z; s.player.hp = s.player.maxHp = 1e6;
  assert((s.quest.sixth as string) === 'locked' && reeveMarker(s) === null && dialogueAt(s, 'thorn').options.every(o => !o.advance), 'locked until Brine and Bone is handed in: the reeve only greets you');
  s.quest.stage = 'done'; s.quest.second = 'cleared'; s.quest.third = 'cleared'; s.quest.fifth = 'cleared';
  tick(s);
  assert((s.quest.sixth as string) === 'offer' && reeveMarker(s) === 'offer' && activeQuestView(s).title === QUEST6_NAME && dialogueAt(s, 'thorn').options.some(o => o.advance), 'Brine and Bone handed in: a mark over the reeve, a tracker, and an offer');
  tick(s, { questAdvance: true });
  assert((s.quest.sixth as string) === 'hunt' && reeveMarker(s) === 'wait', 'taken');
  for (const [type, n] of Object.entries(ROT_GOALS)) for (let i = 0; i < n; i++) {
    const e = s.enemies.find(x => x.type === type)!;
    e.state = 'idle'; e.hp = 1; e.respawnIn = 0; e.x = s.player.x; e.z = s.player.z + 1; e.spawnX = e.x; e.spawnZ = e.z; e.attackCd = 1e9;
    s.targetId = e.id; s.player.energy = s.player.maxEnergy; s.player.cd.fill(0); s.player.gcd = 0; s.player.facing = 0;
    for (let k = 0; k < 40 && (e.state as string) !== 'dead'; k++) { tick(s, { ability: STRIKE }); }
    e.respawnIn = 1e9;
  }
  assert((s.quest.sixth as string) === 'report' && reeveMarker(s) === 'ready' && activeQuestView(s).ready, 'the last of them makes it a hand-in');
  assert(!dungeonOpen(s, rotroot), 'the mouth is shut until it is handed in');
  const xp0 = s.player.combat.xp;
  tick(s, { questAdvance: true });
  assert((s.quest.sixth as string) === 'cleared' && s.player.combat.xp - xp0 === REWARD6[0].xp && REWARD6[0].xp === 1200, 'handing in pays 1,200 combat XP, the bible\'s figure');
  assert(dungeonOpen(s, rotroot) && activeQuestView(s).target !== null, 'and the mouth is open, with the Mother as the tracker\'s next mark');
  const rt = deserialize(serialize(s))!;
  assert((rt.quest.sixth as string) === 'cleared' && rt.quest.kills.rotwood_cultist === ROT_GOALS.rotwood_cultist, 'the chain survives a save and load');
  const old = JSON.parse(serialize(s)); delete old.quest.sixth; delete old.quest.seventh; // (a save from before Q5 has no Q6 either)
  assert(deserialize(JSON.stringify(old))!.quest.sixth === 'offer', 'a save from before it, with the Strand cleared, finds it on offer');
  const bad = JSON.parse(serialize(quiet(3))); bad.quest.sixth = 'hunt';
  assert(deserialize(JSON.stringify(bad)) === null, 'a save with it open before the Strand is cleared is refused');
}

console.log(`\n${checks} checks passed`);

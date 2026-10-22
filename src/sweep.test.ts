// HOM-165: the sweep (docs/action-layer.md 2, 8.3 step 2, 8.4): a low swing that goes under a jump, on 23 enemies from level 10.
// What it proves: the 23 rows are the document's, the cast is the one it describes (a ring of attackRange + 5.5, 0.9 s, a pair 0.9 s apart),
// the hop and the roll answer it and walking does not, a pair cannot be rolled twice, and eating every sweep costs what the swings it
// displaces cost, so no tuned table moves. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState, Enemy } from './sim';
import { ABILITIES, ENEMY_TYPES, SPAWNS, STAGGER_HEAVY_KEEP, castName, SWEEP_REACH, SWEEP_WINDUP, SWEEP_GAP } from './sim/data';
import { SWEEP_CLEAR, refreshPlayerStats } from './sim/combat';
import { ROLL_CD, ROLL_TIME, SPRINT_SPEED } from './sim/agility';
import { deriveStats, emptyEquipment } from './sim/items';
import { PERCHES } from './sim/perches';
import { xpForLevel } from './sim/xp';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const T = ENEMY_TYPES;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const near = (a: number, b: number, slack: number) => Math.abs(a - b) <= slack;
const ticks = (seconds: number) => Math.round(seconds / TICK_DT);
const playerHits = (s: GameState) => s.events.filter((e): e is Extract<typeof e, { t: 'hit' }> => e.t === 'hit' && e.target === 'player');

/** The 23 rows of docs/action-layer.md 2.5: [type, tier, the sweep's damage (x 2 for a pair)]. */
const ROWS: [string, 'trash' | 'elite' | 'rare', number][] = [
  ['marsh_hog', 'trash', 51], ['shore_crab', 'trash', 53], ['mire_troll', 'trash', 92], ['thornback', 'trash', 75], ['blight_stag', 'trash', 81],
  ['cairn_brute', 'trash', 120], ['moor_ram', 'trash', 91], ['ridge_ogre', 'trash', 138], ['sand_ogre', 'trash', 164], ['rune_golem', 'trash', 165],
  ['toll_captain', 'elite', 49], ['barnacle_ogre', 'elite', 62], ['bogfather', 'elite', 71], ['thorn_warden', 'elite', 80], ['barrow_lord', 'elite', 102],
  ['stonehorn', 'elite', 96], ['ashen_colossus', 'elite', 119], ['spire_warden', 'elite', 123],
  ['old_grey', 'rare', 43], ['gutterhook', 'rare', 55], ['mother_mire', 'rare', 65], ['elder_thornback', 'rare', 76], ['hollow_knight', 'rare', 84],
];
const RING = [7.7, 7.2, 8.1, 7.8, 7.6, 8.2, 7.9, 8.4, 8.4, 8.4, 8.3, 8.4, 8.5, 8.5, 8.6, 8.9, 9.0, 9.0, 7.7, 8.1, 8.9, 8.7, 8.7];

function atLevel(s: GameState, level: number) {
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level;
  refreshPlayerStats(s, true);
  p.unlocked = level;
  p.energy = p.maxEnergy;
}
/** The enemy at the origin and the player a pace off it, in reach; nothing else alive, nothing but the sweep ready. */
function duel(seed: number, type: string, at = T[type].attackRange * 0.9, agility = 1) {
  const s = createState(seed);
  for (const o of s.enemies) { o.state = 'dead'; o.respawnIn = 1e9; }
  atLevel(s, T[type].level);
  s.player.skills.agility.level = agility; s.player.skills.agility.xp = xpForLevel(agility);
  s.player.stamina = 1e6;
  const e = s.enemies.find(x => x.type === type)!;
  Object.assign(e, { state: 'chase', respawnIn: 0, hp: e.maxHp, x: 0, z: 0, spawnX: 0, spawnZ: 0, cast: null, attackCd: 0, sweepCd: 0, heavyCd: 1e9, hazardCd: 1e9 });
  s.player.x = 0; s.player.z = at; s.player.hp = s.player.maxHp = 1e9;
  return { s, e };
}
/** Tick until the enemy is winding up a sweep (the player held where they stand). Returns the ticks it took. */
function toSweep(s: GameState, e: Enemy, at: number) {
  for (let n = 0; n < 600; n++) {
    if (e.cast?.kind === 'sweep') return n;
    s.player.x = 0; s.player.z = at; tick(s);
  }
  throw new Error(`${e.type} never started a sweep`);
}
const armoured = (raw: number) => Math.max(1, Math.round(raw * (1 - deriveStats(emptyEquipment()).reduction)));

section('The 23 rows are the document\'s, derived from each enemy\'s own swing');
{
  const swept = Object.entries(T).filter(([, d]) => d.sweep).map(([id]) => id);
  assert(swept.length === 23 && ROWS.every(([id]) => swept.includes(id)), 'exactly the 23 enemies of 2.5 carry a sweep');
  for (const [i, [id, tier, dmg]] of ROWS.entries()) {
    const d = T[id], w = d.sweep!, pair = tier !== 'trash';
    assert(w.windup === 0.9 && near(w.radius, d.attackRange + 5.5, 1e-9) && near(w.radius, RING[i], 0.005) && w.damage === dmg && (w.gap ?? 0) === (pair ? 0.9 : 0)
      && w.first === (tier === 'trash' ? 5 : tier === 'elite' ? 4 : 3) && w.every === (tier === 'rare' ? 8 : tier === 'elite' ? 8 : 10),
      `${d.name}: ${pair ? 'a pair of ' + w.damage : 'a single of ' + w.damage}, ring ${w.radius.toFixed(1)}, first ${w.first} every ${w.every} (${w.name})`);
  }
  // the whole point of deriving it: the cast costs the swings it displaces, and no more
  for (const [id, tier] of ROWS.map(r => [r[0], r[1]] as const)) {
    const d = T[id], I = d.attackInterval, w = d.sweep!, rings = tier === 'trash' ? 1 : 2;
    const displaced = (SWEEP_WINDUP + (rings === 2 ? SWEEP_GAP : 0) + I) / I;
    assert(near(w.damage * rings / d.damage, displaced, 0.04 * rings), `${d.name}'s sweep is worth ${(w.damage * rings / d.damage).toFixed(2)} swings and displaces ${displaced.toFixed(2)}`);
  }
  assert(SWEEP_WINDUP === 0.9 && SWEEP_GAP === 0.9 && SWEEP_REACH === 5.5, 'wind-up 0.9 s, a pair 0.9 s apart, a ring 5.5 u past reach');
  const none = Object.entries(T).filter(([id, d]) => !d.sweep && (d.pack || d.ranged || d.level < 10));
  assert(none.length > 0 && none.every(([, d]) => !d.sweep), 'no pack, no caster or archer and nothing under level 10 carries one');
  for (const id of ['captain_marrow', 'rotroot_mother', 'cairn_king', 'archmage_vael', 'warden', 'brute', 'ogre']) assert(!T[id].sweep, `${T[id].name} (a dungeon enemy) does not carry one`);
  assert(swept.every(id => T[id].level >= 10 && !T[id].pack && !T[id].ranged), 'every sweeper is a solo melee fighter of level 10 or more');
  const stood = SPAWNS.filter(sp => T[sp.type].sweep);
  assert(ROWS.every(([id]) => stood.some(sp => sp.type === id)), `and each of the 23 stands somewhere in the world ( of  spawns: the document's 126 of 353 counted a world twice the size of this one)`);
  assert(castName(T.marsh_hog, 'sweep') === 'Tusk Sweep' && castName(T.barnacle_ogre, 'sweep') === 'Anchor Sweep' && castName(T.boar, 'sweep') === 'Wild Boar', 'castName names a sweep, and falls back to the enemy for one that has none');
}

section('The cast: a ring of its own, 0.9 s, and a pair is one cast with two rings');
{
  const { s, e } = duel(1650, 'marsh_hog');
  const w = T.marsh_hog.sweep!;
  tick(s);
  let tele: Extract<GameState['events'][number], { t: 'telegraph' }> | undefined, n = 0;
  for (; n < 600 && !tele; n++) { tick(s); tele = s.events.find((ev): ev is Extract<typeof ev, { t: 'telegraph' }> => ev.t === 'telegraph'); }
  assert(!!tele && tele.kind === 'sweep' && tele.id === e.id && tele.windup === 0.9 && tele.radius === w.radius && tele.x === e.x && tele.z === e.z && tele.gap === undefined,
    'a hog raises a sweep telegraph that carries the ring (radius and centre), so the renderer need not look it up');
  assert(e.cast!.kind === 'sweep' && e.cast!.total === 0.9 && e.cast!.radius === w.radius, '...and the cast on the enemy is 0.9 s of that ring');
  let slams = 0, ticksTo = 0;
  for (let k = 1; k < 100 && !slams; k++) { tick(s); ticksTo = k; slams += s.events.filter(ev => ev.t === 'slam').length; }
  assert(slams === 1 && near(ticksTo * TICK_DT, 0.9, 2 * TICK_DT), `it lands once, ${(ticksTo * TICK_DT).toFixed(2)} s later`);
  assert(e.cast === null && near(e.sweepCd, w.every, 0.1) && e.attackCd > 1.5, '...and then it waits its cooldown, and a full swing interval, as after a slam');

  const pair = duel(1651, 'toll_captain');
  const pw = T.toll_captain.sweep!;
  toSweep(pair.s, pair.e, 2.5);
  assert(pair.e.cast!.total === 1.8 && pair.e.cast!.gap === 0.9, 'a pair is one cast of 1.8 s, with its gap on it');
  const at: number[] = [], dmg: number[] = [];
  for (let k = 1; k < 90; k++) { pair.s.player.x = 0; pair.s.player.z = 2.5; tick(pair.s); if (pair.s.events.some(ev => ev.t === 'slam')) at.push(k); dmg.push(...playerHits(pair.s).map(h => h.amount)); }
  assert(at.length === 2 && near((at[1] - at[0]) * TICK_DT, 0.9, 2 * TICK_DT), `two rings, ${((at[1] - at[0]) * TICK_DT).toFixed(2)} s apart`);
  assert(dmg.length === 2 && dmg.every(a => a === armoured(pw.damage)), `a player who stands there takes both, ${dmg.join(' and ')} each (the swing is ${armoured(T.toll_captain.damage)})`);
}

section('What answers it: the hop, the roll, not the legs');
{
  /** Resolve the cast on the next tick with the player at height `y` over a floor, and say whether it landed. */
  const lands = (type: string, y: number, extra: (s: GameState, e: Enemy) => void = () => {}) => {
    const { s, e } = duel(1660, type);
    toSweep(s, e, T[type].attackRange * 0.9);
    e.cast!.t = e.cast!.total - 0.01;
    s.player.y = y; s.player.vy = 0; s.player.airborne = y > 0;
    extra(s, e);
    tick(s);
    return playerHits(s).length > 0;
  };
  assert(lands('marsh_hog', 0), 'a player standing on the ground is hit');
  assert(!lands('marsh_hog', 1.2), 'a player 1.2 u up when it resolves is not: it passes under');
  assert(lands('marsh_hog', 1.0), '...and one 1.0 up (a hop that is not high enough) is');
  assert(!lands('marsh_hog', 3.0), 'a double jump clears it too');
  assert(!lands('marsh_hog', 0, (s) => { s.player.rolling = ROLL_TIME; }), 'a roll goes through it');
  assert(!lands('marsh_hog', 0, (s) => { s.player.z = T.marsh_hog.sweep!.radius + 0.2; }) && lands('marsh_hog', 0, (s) => { s.player.z = T.marsh_hog.sweep!.radius - 0.2; }), 'outside the ring is a miss, inside it a hit');
  // the clearance is above the floor under the player, not above zero: a step does not make them immune
  const step = PERCHES.find(p => p.top === 1.0)!;
  const onStep = (y: number) => {
    const { s, e } = duel(1661, 'marsh_hog');
    Object.assign(e, { x: step.x, z: step.z + 3, spawnX: step.x, spawnZ: step.z + 3 });
    Object.assign(s.player, { x: step.x, z: step.z, y: step.top, vy: 0, airborne: false });
    for (let n = 0; n < 600 && e.cast?.kind !== 'sweep'; n++) tick(s);
    assert(e.cast?.kind === 'sweep', 'a hog winds up a sweep against a player on a step');
    e.cast!.t = e.cast!.total - 0.01;
    Object.assign(s.player, { x: step.x, z: step.z, y, vy: 0, airborne: y > step.top });
    tick(s);
    return playerHits(s).length > 0;
  };
  assert(onStep(step.top), 'a player standing on a 1.0 step is hit by it');
  assert(onStep(step.top + 0.8), '...and one hopping 0.8 above the step is too: 1.8 up in the world, but 0.8 off the floor they are over');
  assert(!onStep(step.top + 1.2), '...and one 1.2 above the step is not');

  // walking does not answer it, sprinting does not either, and a roll or a timed hop does
  const play = (type: string, agility: number, plan: (k: number) => Partial<Input>) => {
    const { s, e } = duel(1670, type, T[type].attackRange * 0.9, agility);
    const n0 = toSweep(s, e, T[type].attackRange * 0.9);
    const hits: number[] = [];
    let rolls = 0;
    for (let k = 0; e.cast; k++) {
      tick(s, plan(k));
      hits.push(...playerHits(s).map(h => h.amount));
      rolls += s.events.filter(ev => ev.t === 'roll').length;
    }
    return { s, e, hits, rolls, n0 };
  };
  const away = (sprint: boolean) => (k: number): Partial<Input> => k >= 9 ? { dirZ: 1, sprint } : {}; // sees it, then goes: 0.3 s of reaction
  assert(play('marsh_hog', 1, away(false)).hits.length === 1, 'walking away after a 0.3 s reaction still takes it');
  assert(play('marsh_hog', 1, away(true)).hits.length === 1 && SPRINT_SPEED * 0.6 < 5.7, `...and so does sprinting (${(SPRINT_SPEED * 0.6).toFixed(1)} u in the 0.6 s left, 5.7 u to leave)`);
  const rolled = play('marsh_hog', 1, (k) => k === 22 ? { roll: true } : {});
  assert(rolled.rolls === 1 && rolled.hits.length === 0, 'a roll pressed 0.15 s before it lands takes nothing');
  const hop = (before: number, agility = 1) => play('marsh_hog', agility, (k) => k === Math.round((0.9 - before) / TICK_DT) ? { jump: true } : {});
  assert(hop(0.29).hits.length === 0, 'at Agility 1 a hop pressed 0.29 s before the hit clears it (the middle of the 0.171 to 0.409 s window)');
  assert(hop(0.6).hits.length === 1, '...one pressed 0.6 s before has landed already and is hit');
  assert(hop(0.1).hits.length === 1, '...and one pressed 0.1 s before has not got off the ground and is hit');
  assert(hop(0.35, 99).hits.length === 0 && hop(0.5, 99).hits.length === 0 && hop(0.05, 99).hits.length === 1, 'at Agility 99 the window is wider (0.35 and 0.5 s before clear it), and still has an end');
}

section('A pair: one roll, one hop, but never two rolls');
{
  const type = 'toll_captain', at = T[type].attackRange * 0.9, amt = armoured(T[type].sweep!.damage);
  const play = (plan: (t: number) => Partial<Input>, agility = 1) => {
    const { s, e } = duel(1680, type, at, agility);
    toSweep(s, e, at);
    const hits: number[] = [];
    let rolls = 0;
    while (e.cast) { const c = e.cast; tick(s, plan(c.t)); hits.push(...playerHits(s).map(h => h.amount)); rolls += s.events.filter(ev => ev.t === 'roll').length; }
    return { hits, rolls, s };
  };
  const roll = (...times: number[]) => (t: number): Partial<Input> => times.some(x => Math.abs(t - x) < TICK_DT / 2) ? { roll: true } : {};
  const jump = (...times: number[]) => (t: number): Partial<Input> => times.some(x => Math.abs(t - x) < TICK_DT / 2) ? { jump: true } : {};
  const rolledTwice = play(roll(0.7, 1.6));
  assert(rolledTwice.rolls === 1 && rolledTwice.hits.length === 1 && rolledTwice.hits[0] === amt, `a roll on the first ring and another on the second: the second is locked out (${ROLL_TIME + ROLL_CD} s) and lands for ${amt}`);
  const one = play(roll(0.7));
  assert(one.hits.length === 1, 'a roll on the first ring alone leaves the second to land');
  assert(play(jump(0.61, 1.5)).hits.length === 0, 'two timed hops answer a pair, even at Agility 1');
  const mixed = (t: number): Partial<Input> => Math.abs(t - 0.7) < TICK_DT / 2 ? { roll: true } : Math.abs(t - 1.5) < TICK_DT / 2 ? { jump: true } : {};
  assert(play(mixed).hits.length === 0, 'a roll and a hop answer it too');
  assert(play(() => ({})).hits.length === 2, 'and a player who does nothing takes both');
}

section('An interrupt takes the cast, and holds the next one back');
{
  const { s, e } = duel(1690, 'marsh_hog');
  atLevel(s, 12); // Pummel is on the bar
  toSweep(s, e, T.marsh_hog.attackRange * 0.9);
  tick(s, { clickEnemy: e.id });
  e.cast!.t = 0.3;
  tick(s, { ability: ABILITIES.findIndex(a => a.kind === 'interrupt') });
  assert(e.cast === null && s.events.some(ev => ev.t === 'interrupt'), 'a Pummel cancels a sweep like any wind-up');
  assert(e.sweepCd >= T.marsh_hog.sweep!.every * STAGGER_HEAVY_KEEP - 0.1, `...and the next is held back (${e.sweepCd.toFixed(1)} s)`);
  for (let k = 0; k < ticks(2); k++) tick(s);
  assert(playerHits(s).length === 0 && s.player.hp === s.player.maxHp, 'nothing landed');
}

section('The slam goes first when both are ready; a sweep is not a slam');
{
  const { s, e } = duel(1695, 'barnacle_ogre');
  e.heavyCd = 0; e.sweepCd = 0;
  for (let k = 0; k < 90 && !e.cast; k++) { s.player.x = 0; s.player.z = 2.6; tick(s); }
  assert(e.cast?.kind === 'heavy', 'an elite with both ready starts the slam');
  const { s: g, e: o } = duel(1696, 'barnacle_ogre');
  o.heavyCd = 1e9;
  toSweep(g, o, 2.6);
  assert(o.cast!.kind === 'sweep' && !g.events.some(ev => ev.t === 'telegraph' && ev.kind === 'heavy'), 'with the slam on cooldown it sweeps');
  const q = createState(1697);
  for (const x of q.enemies) { x.state = 'dead'; x.respawnIn = 1e9; }
  assert(q.enemies.filter(x => T[x.type].sweep).every(x => x.sweepCd === T[x.type].sweep!.first) && q.enemies.every(x => T[x.type].sweep || x.sweepCd === 0), 'a spawn starts with its first sweep a few seconds out, and one with none has nothing to wait for');
}

section('The sweep is neutral: eating every one costs what the swings it displaces cost');
{
  const SECONDS = 600;
  /** Damage taken by a player who stands there for SECONDS, under a policy for each sweep ring. */
  const fight = (type: string, mode: 'none' | 'eat' | 'hop' | 'mash', agility = 1) => {
    const def = T[type], saved = def.sweep;
    if (mode === 'none') delete def.sweep;
    try {
      const { s, e } = duel(1700 + type.length, type, def.attackRange * 0.9, agility);
      e.heavyCd = def.heavy ? def.heavy.first : 1e9; e.hazardCd = def.hazard ? def.hazard.first : 1e9; e.sweepCd = def.sweep?.first ?? 0;
      let taken = 0, seen = 0;
      for (let k = 0; k < ticks(SECONDS); k++) {
        s.player.hp = s.player.maxHp;
        const c = e.cast;
        if (mode === 'hop' && c?.kind === 'sweep') { // above the clearance on exactly the tick a ring lands
          const ring = c.gap && !c.struck ? def.sweep!.windup : c.total;
          if (c.t + TICK_DT >= ring - 1e-9) Object.assign(s.player, { y: SWEEP_CLEAR + 0.4, vy: 0, airborne: true });
        }
        tick(s, mode === 'mash' ? { jump: true } : {});
        if (mode === 'hop') Object.assign(s.player, { y: 0, vy: 0, airborne: false });
        taken += playerHits(s).reduce((a, h) => a + h.amount, 0);
        seen += s.events.filter(ev => ev.t === 'telegraph' && ev.kind === 'sweep').length;
      }
      return { taken, seen };
    } finally { if (saved) def.sweep = saved; }
  };
  const worst = { eat: 0, hopLo: 1, hopHi: 0 };
  const lines: string[] = [];
  for (const [id, tier] of ROWS.map(r => [r[0], r[1]] as const)) {
    const none = fight(id, 'none'), eat = fight(id, 'eat'), hop = fight(id, 'hop');
    const drift = eat.taken / none.taken - 1, saved = 1 - hop.taken / none.taken;
    worst.eat = Math.max(worst.eat, Math.abs(drift)); worst.hopLo = Math.min(worst.hopLo, saved); worst.hopHi = Math.max(worst.hopHi, saved);
    lines.push(`${T[id].name} (${tier}): ${eat.seen} sweeps in ${SECONDS} s, eaten ${(drift * 100).toFixed(1)}% on the old table, every one hopped ${(saved * 100).toFixed(0)}% off`);
    assert(Math.abs(drift) <= 0.05, lines[lines.length - 1]);
    assert(hop.taken < none.taken && saved > 0.1 && saved < 0.45, `  ...and hopping saves a fight's damage, not all of it`);
  }
  console.log(`  worst drift ${(worst.eat * 100).toFixed(1)}%; a hop on every ring saves ${(worst.hopLo * 100).toFixed(0)}% to ${(worst.hopHi * 100).toFixed(0)}%`);

  // 2.3: a player who just holds the key hops over a share of them by luck, about half what reading the tell is worth
  for (const [id, agility] of [['marsh_hog', 1], ['marsh_hog', 99], ['barnacle_ogre', 1], ['barnacle_ogre', 99]] as const) {
    const none = fight(id, 'none', agility), mash = fight(id, 'mash', agility), hop = fight(id, 'hop', agility);
    const mashed = 1 - mash.taken / none.taken, read = 1 - hop.taken / none.taken;
    assert(mashed > 0.04 && mashed < read, `${T[id].name} at Agility ${agility}: holding jump saves ${(mashed * 100).toFixed(0)}% of the damage against ${(read * 100).toFixed(0)}% for reading it`);
  }
}

console.log(`\nAll ${checks} checks passed.`);

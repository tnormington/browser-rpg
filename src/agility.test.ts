// HOM-147: Agility. Shift is sprint, the stamina meter pays for it, and the meter is the skill — levelling it is a longer run.
// Plus the three things the level buys besides: a shorter hold from a net, a higher hop, and the dodge-roll on the same meter.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { SKILLS, SKILL_IDS, grantXp } from './sim/skills';
import { FOOT_SPEED, moveSpeed } from './sim/mounts';
import {
  JUMP_LIFT, ROLL_CD, ROLL_COST, ROLL_SPEED, ROLL_TIME, ROOT_CUT,
  SPRINT_DRAIN, SPRINT_SPEED, SPRINT_XP_EVERY, SPRINT_XP_PER_UNIT, STAMINA_BASE, STAMINA_PER_LEVEL,
  STAMINA_REFILL, WINDED_UNTIL, jumpVelocity, maxStamina, netHold, startSprint, updateAgility,
} from './sim/agility';
import { ENEMY_TYPES, JUMP_VELOCITY, jumpAirtime, jumpHeight } from './sim/data';
import { deserialize, serialize } from './sim/save';
import { harmPlayer } from './sim/combat';
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
const near = (a: number, b: number, slack: number) => Math.abs(a - b) <= slack;

/** A new game with nothing alive to interrupt the running, standing where the player wakes. */
function quiet(seed = 1470): GameState {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  return s;
}
/** The player at an Agility level outright, with the meter that level buys. */
function atLevel(level: number, seed = 1470): GameState {
  const s = quiet(seed);
  s.player.skills.agility.xp = xpForLevel(level);
  s.player.skills.agility.level = level;
  s.player.stamina = maxStamina(s.player);
  return s;
}
/** Seconds of flat-out running the meter has left in it, driving the rule directly so no wall can get in the way. */
function sprintSeconds(s: GameState): number {
  let t = 0;
  for (let n = 0; n < 10000 && !s.player.winded; n++) {
    startSprint(s, true, true);
    if (!s.player.sprinting) break;
    updateAgility(s, SPRINT_SPEED * TICK_DT, TICK_DT);
    t += TICK_DT;
  }
  return t;
}

section('Agility is a skill like the others, and its meter is what it buys');
{
  assert(SKILL_IDS.includes('agility') && SKILLS.agility.name === 'Agility', 'Agility is a skill, on the shared XP curve');
  const s = quiet();
  assert(s.player.skills.agility.level === 1 && s.player.skills.agility.xp === 0, 'it starts at level 1 with no XP');
  assert(s.player.stamina === STAMINA_BASE && maxStamina(s.player) === STAMINA_BASE, 'a new character wakes with a full meter');
  assert(!s.player.sprinting && !s.player.winded, 'and is neither sprinting nor out of breath');
  assert(maxStamina(atLevel(20).player) === STAMINA_BASE + 19 * STAMINA_PER_LEVEL, 'every level adds to the meter');
  assert(maxStamina(atLevel(99).player) === STAMINA_BASE + 98 * STAMINA_PER_LEVEL, '...all the way to 99');
}

section('Shift is sprint: faster ground, and the meter pays for it');
{
  const walk = quiet(), at = { x: walk.player.x, z: walk.player.z };
  run(walk, 0.5, { dirX: 1 });
  assert(near(dist(walk.player, at), FOOT_SPEED * 0.5, 0.05), 'no shift is the old six units a second');
  assert(!walk.player.sprinting && walk.player.stamina === STAMINA_BASE, 'nothing is spent walking');

  const s = quiet(), from = { x: s.player.x, z: s.player.z };
  run(s, 0.5, { dirX: 1, sprint: true });
  assert(near(dist(s.player, from), SPRINT_SPEED * 0.5, 0.05), 'shift held is nine, half as much again');
  assert(s.player.sprinting && moveSpeed(s.player) === SPRINT_SPEED, 'the player is sprinting, and that is the speed the rules read');
  assert(near(s.player.stamina, STAMINA_BASE - SPRINT_DRAIN * 0.5, 0.5), 'half a second of it costs half a second of meter');
  run(s, 0.5, { dirX: 1 });
  assert(!s.player.sprinting && moveSpeed(s.player) === FOOT_SPEED, 'letting go of shift is a jog again');

  const still = quiet();
  run(still, 1, { sprint: true });
  assert(!still.player.sprinting && still.player.stamina === STAMINA_BASE, 'shift with nowhere to go spends nothing: the meter is charged by ground covered');

  const horse = quiet();
  horse.player.mounts.push('courser'); horse.player.mounted = true;
  const saddle = { x: horse.player.x, z: horse.player.z };
  run(horse, 0.5, { dirX: 1, sprint: true });
  assert(!horse.player.sprinting && near(dist(horse.player, saddle), 10 * 0.5, 0.05), 'in the saddle shift does nothing: the horse is already faster');
  assert(horse.player.stamina === STAMINA_BASE, 'and costs nothing');

  const held = quiet();
  held.player.root = { left: 3, total: 3, name: 'Net' };
  run(held, 0.5, { dirX: 1, sprint: true });
  assert(!held.player.sprinting && held.player.stamina === STAMINA_BASE, 'a net holds your feet, so there is no sprint to pay for');
}

section('Run it dry and you are winded until you have your breath back');
{
  const s = atLevel(1);
  assert(near(sprintSeconds(s), STAMINA_BASE / SPRINT_DRAIN, 0.1), 'five seconds flat out at Agility 1');
  assert(s.player.stamina === 0 && s.player.winded && !s.player.sprinting, 'empty, winded, and no longer running');
  startSprint(s, true, true);
  assert(!s.player.sprinting, 'shift is refused while winded');

  // the breath comes back whether you walk it off or stand still
  let t = 0;
  while (s.player.winded && t < 30) { updateAgility(s, 0, TICK_DT); t += TICK_DT; }
  assert(near(s.player.stamina, maxStamina(s.player) * WINDED_UNTIL, 2), 'sprint answers again at a third of a meter');
  assert(near(t, STAMINA_REFILL * WINDED_UNTIL, 0.1), '...which is about two seconds of standing');
  startSprint(s, true, true);
  assert(s.player.sprinting, 'and it answers');
  while (s.player.stamina < maxStamina(s.player)) { updateAgility(s, 0, TICK_DT); t += TICK_DT; }
  assert(near(t, STAMINA_REFILL, 0.1), 'six seconds from empty back to full');
}

section('Levelling Agility is a longer run, not a longer wait');
{
  const low = atLevel(1), high = atLevel(40);
  const lowRun = sprintSeconds(low), highRun = sprintSeconds(high);
  assert(highRun > lowRun * 2.9, `Agility 40 runs far longer than Agility 1 (${highRun.toFixed(1)}s against ${lowRun.toFixed(1)}s)`);
  assert(near(highRun, maxStamina(high.player) / SPRINT_DRAIN, 0.1), 'the meter over the drain is exactly how long it lasts');
  let t = 0;
  while (high.player.stamina < maxStamina(high.player) && t < 60) { updateAgility(high, 0, TICK_DT); t += TICK_DT; }
  assert(near(t, STAMINA_REFILL, 0.1), 'and the refill is the same six seconds it was at level 1: the bigger meter fills faster');
}

section('Sprinting is what trains it');
{
  const s = quiet(), from = { x: s.player.x, z: s.player.z };
  let paid: number[] = [];
  for (let n = 0; n < Math.round(4 / TICK_DT); n++) {
    tick(s, { dirX: 1, sprint: true });
    paid = paid.concat(s.events.filter(e => e.t === 'xp' && e.skill === 'agility').map(e => (e as { amount: number }).amount));
  }
  const ground = dist(s.player, from), earned = s.player.skills.agility.xp;
  assert(near(ground, SPRINT_SPEED * 4, 0.1), 'four seconds of sprinting covers thirty-six units of ground');
  assert(paid.length === 1 && paid[0] === SPRINT_XP_EVERY * SPRINT_XP_PER_UNIT, 'XP arrives in whole stretches, not a crumb a tick');
  assert(near(earned + s.player.sprinted * SPRINT_XP_PER_UNIT, ground * SPRINT_XP_PER_UNIT, 0.1), 'every unit of it is worth two XP, paid or still owed');

  const walk = quiet();
  run(walk, 4, { dirX: 1 });
  assert(walk.player.skills.agility.xp === 0 && walk.player.sprinted === 0, 'walking the same ground trains nothing: only a sprint counts');

  // the meter at Agility 1 is 45 units of ground, so a run and a half pays the 83 XP level 2 asks for: the first level
  // is under a minute of sprinting and getting your breath back, and the curve takes over from there
  const lvl = atLevel(1);
  for (let n = 0; n < 2; n++) {
    sprintSeconds(lvl);
    while (lvl.player.stamina < maxStamina(lvl.player)) updateAgility(lvl, 0, TICK_DT);
  }
  assert(lvl.player.skills.agility.level > 1, 'two meters run down is the first level up');
  assert(maxStamina(lvl.player) > STAMINA_BASE, '...and the meter is longer for it');
}

section('It survives a save, and a death gives it back');
{
  const s = quiet();
  grantXp(s, 'agility', 500, 0, 0);
  s.player.stamina = 42;
  const back = deserialize(serialize(s))!;
  assert(back !== null && back.player.skills.agility.xp === 500, 'the Agility XP survives a round trip');
  assert(back.player.stamina === 42, '...and so does what is left in the meter');

  const old = JSON.parse(serialize(s));
  delete old.player.xp.agility; delete old.player.stamina;
  const loaded = deserialize(JSON.stringify(old));
  assert(loaded !== null && loaded.player.skills.agility.xp === 0, 'a save from before Agility loads at 0');
  assert(loaded !== null && loaded.player.stamina === STAMINA_BASE, '...with a full meter');

  const over = JSON.parse(serialize(s)); over.player.stamina = 1e5;
  const clamped = deserialize(JSON.stringify(over));
  assert(clamped !== null && clamped.player.stamina === maxStamina(clamped.player), 'a hand-edited meter is clamped to the level that earned it');

  const died = quiet();
  died.player.stamina = 3; died.player.winded = true;
  harmPlayer(died, 'thornback', undefined, 1e6, 'Gore');
  assert(died.player.dead, 'the player is down');
  run(died, 12);
  assert(!died.player.dead && died.player.stamina === maxStamina(died.player) && !died.player.winded, 'you wake at the graveyard with your breath back, like your health');
}

section('Light on your feet: Agility is how much of a net you shrug off');
{
  const net = ENEMY_TYPES.footpad.net!;
  assert(netHold(atLevel(1).player, net.duration) === net.duration, 'at Agility 1 a net holds you for every second it is worth');
  assert(near(netHold(atLevel(99).player, net.duration), net.duration * (1 - ROOT_CUT), 1e-9), '...and at 99 for half of them');
  assert(near(netHold(atLevel(50).player, net.duration), net.duration * (1 - ROOT_CUT * 49 / 98), 1e-9), 'and the levels between it pay out in a straight line');

  // the rule where it is used: a footpad walked up to and left to throw its bola
  const thrown = (level: number) => {
    const s = atLevel(level), p = s.player, e = s.enemies[0];
    Object.assign(e, { type: 'footpad', hp: ENEMY_TYPES.footpad.hp, maxHp: ENEMY_TYPES.footpad.hp, state: 'chase', respawnIn: 0, deadFor: 0, netCd: 0, cast: null });
    e.x = p.x + 4; e.z = p.z; e.spawnX = e.x; e.spawnZ = e.z;
    for (let n = 0; n < Math.round(6 / TICK_DT); n++) {
      tick(s);
      const ev = s.events.find(x => x.t === 'net');
      if (ev) return { s, held: (ev as { duration: number }).duration };
    }
    return { s, held: -1 };
  };
  const slow = thrown(1), quick = thrown(99);
  assert(slow.held === ENEMY_TYPES.footpad.net!.duration, 'a bola thrown at Agility 1 lands for its full two and a half seconds');
  assert(slow.s.player.root !== null && slow.s.player.root.total === slow.held, 'and that is the hold the player (and the bar over their head) carries');
  assert(near(quick.held, slow.held / 2, 0.01), 'the same bola thrown at Agility 99 is shrugged off in half the time');
}

section('A higher hop: nothing reads y, so the whole reward is seeing it');
{
  assert(jumpVelocity(atLevel(1).player) === JUMP_VELOCITY, 'Agility 1 leaves the ground exactly as it always did');
  assert(near(jumpVelocity(atLevel(99).player), JUMP_VELOCITY * (1 + JUMP_LIFT), 1e-9), '...and 99 pushes off a quarter harder');

  const peak = (level: number) => {
    const s = atLevel(level);
    let top = 0, airtime = -1;
    for (let n = 0; n < Math.round(2 / TICK_DT); n++) {
      tick(s, { jump: n === 0 });
      const ev = s.events.find(x => x.t === 'jump');
      if (ev) airtime = (ev as { airtime: number }).airtime;
      top = Math.max(top, s.player.y);
    }
    return { top, airtime, landed: s.player.y === 0 };
  };
  const low = peak(1), high = peak(99);
  assert(near(low.top, jumpHeight(JUMP_VELOCITY), 0.25) && low.landed, 'the hop at Agility 1 is the 1.35u it has always been, and comes back down');
  assert(high.top > low.top * 1.5 && high.landed, `and at 99 it is over half again as high (${high.top.toFixed(2)}u against ${low.top.toFixed(2)}u): height goes as the square of the takeoff`);
  assert(near(low.airtime, jumpAirtime(JUMP_VELOCITY), 1e-9) && high.airtime > low.airtime,
    'each hop tells the renderer its own airtime, so the clip is stretched over the one actually taken rather than a constant');
}

section('B is a dodge-roll, and the sprint meter is what pays for it');
{
  const s = quiet(), from = { x: s.player.x, z: s.player.z };
  tick(s, { dirX: 1, roll: true });
  assert(s.player.rolling > 0 && s.events.some(e => e.t === 'roll'), 'the key starts a roll');
  assert(near(s.player.stamina, STAMINA_BASE - ROLL_COST, SPRINT_DRAIN), 'and it is charged to the stamina meter on the spot');
  run(s, ROLL_TIME, { dirX: 1 });
  assert(s.player.rolling === 0, 'it is over in a third of a second');
  // a tick's worth of slack either way: the countdown is settled after the step, as every other clock in the sim is
  assert(near(dist(s.player, from), ROLL_SPEED * ROLL_TIME, ROLL_SPEED * TICK_DT), `...having carried the player about five units (${dist(s.player, from).toFixed(1)}u)`);

  const hit = quiet();
  tick(hit, { dirX: 1, roll: true });
  const hp = hit.player.hp;
  harmPlayer(hit, 'thornback', undefined, 50, 'Gore');
  assert(hit.player.hp === hp && hit.player.rolling > 0, 'nothing can touch you while it lasts: that is what the breath bought');
  run(hit, ROLL_TIME + ROLL_CD + 0.1);
  harmPlayer(hit, 'thornback', undefined, 50, 'Gore');
  assert(hit.player.hp < hp, 'and the window shuts when the roll does');

  const again = quiet();
  tick(again, { dirX: 1, roll: true });
  run(again, ROLL_TIME + 0.1, { dirX: 1 });
  tick(again, { dirX: 1, roll: true });
  assert(again.player.rolling === 0, 'a second roll on the heels of the first is refused: the roll has a cooldown of its own');
  run(again, ROLL_CD, { dirX: 1 });
  tick(again, { dirX: 1, roll: true });
  assert(again.player.rolling > 0, '...and answers again once it is up');

  const facing = quiet();
  facing.player.facing = Math.PI / 2; // due +x
  tick(facing, { roll: true });
  assert(near(facing.player.rollX, 1, 1e-6) && near(facing.player.rollZ, 0, 1e-6), 'standing still, the roll goes the way you are looking');
  const walking = quiet();
  walking.player.facing = Math.PI / 2;
  tick(walking, { dirZ: -1, roll: true });
  assert(near(walking.player.rollZ, -1, 1e-6), '...and walking, the way the keys are pushing, whatever the camera has you facing');

  const broke = quiet();
  broke.player.stamina = ROLL_COST - 1;
  tick(broke, { dirX: 1, roll: true });
  assert(broke.player.rolling === 0 && broke.player.stamina >= ROLL_COST - 1, 'with less than a roll left in the meter there is no roll, and nothing is spent');

  const saddle = quiet();
  saddle.player.mounts.push('courser'); saddle.player.mounted = true;
  tick(saddle, { dirX: 1, roll: true });
  assert(saddle.player.rolling === 0 && saddle.player.stamina === STAMINA_BASE, 'and none from a horse');

  const tied = quiet();
  tied.player.root = { left: 3, total: 3, name: 'Bola' };
  tied.player.facing = Math.PI / 2;
  const stood = { x: tied.player.x, z: tied.player.z };
  tick(tied, { dirX: 1, roll: true });
  assert(tied.player.rolling === 0 && dist(tied.player, stood) < 1e-6, 'a net holds your feet, and a roll is all feet');

  const trained = quiet();
  for (let n = 0; n < 3; n++) { tick(trained, { dirX: 1, roll: true }); run(trained, ROLL_TIME + ROLL_CD, { dirX: 1 }); }
  assert(trained.player.skills.agility.xp === 0 && trained.player.sprinted === 0, 'rolling trains nothing: sprinting is still the only thing that does');

  // the one way Agility governs the roll: a longer meter is more rolls on the trot before the breath runs out
  const CAP = 20;
  const rollsAt = (level: number) => {
    const s = atLevel(level);
    let n = 0;
    while (n < CAP) {
      tick(s, { dirX: n % 2 ? 1 : -1, roll: true });
      if (s.player.rolling === 0) break;
      n++;
      run(s, ROLL_TIME + ROLL_CD, {});
    }
    return n;
  };
  const few = rollsAt(1), many = rollsAt(99);
  assert(few >= 2 && few < 6, `at Agility 1 a roll is near half the meter, so you get ${few} on the trot and then need your breath back`);
  assert(many === CAP, 'by 99 the meter is no longer what stops you: the roll\'s own cooldown is, and that is the same at every level');
  assert(rollsAt(20) > few, '...and the levels between buy more of them, one meter-length at a time');
}

console.log(`\n${checks} checks passed`);

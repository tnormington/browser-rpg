// HOM-147: Agility. Shift is sprint, the stamina meter pays for it, and the meter is the skill — levelling it is a longer run.
// Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState } from './sim';
import { SKILLS, SKILL_IDS, grantXp } from './sim/skills';
import { FOOT_SPEED, moveSpeed } from './sim/mounts';
import {
  SPRINT_DRAIN, SPRINT_SPEED, SPRINT_XP_EVERY, SPRINT_XP_PER_UNIT, STAMINA_BASE, STAMINA_PER_LEVEL,
  STAMINA_REFILL, WINDED_UNTIL, maxStamina, startSprint, updateAgility,
} from './sim/agility';
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

console.log(`\n${checks} checks passed`);

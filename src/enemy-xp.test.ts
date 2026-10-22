// HOM-169: the XP rule above level 40 (docs/combat-99.md sections 2 and 8.1, checks 1 and 2), and what it rules on the cave's two
// respawn-limited rows. What it proves: the rule is continuous with `20 + level` at 40 and monotone to 98, a level costs the kills
// section 1.3 says, the role multiples are 1 / 3 / 6 / 10 and the authored bosses already sit on them, and no respawn-limited cave row
// pays more an hour than the band it stands in. Run with `npm run verify`.
import { ENEMY_TYPES, SPAWNS, xpParity } from './sim/data';
import { K98, K40, MEAN_KILL, ROLE_XP, cost, enemyXp, kpl, trashXp } from './sim/enemy-xp';
import { xpForLevel } from './sim/xp';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);

section('check 1: the rule is continuous and monotone');
{
  assert(trashXp(40) === 60 && trashXp(10) === 30 && trashXp(1) === 21, 'to level 40 a trash kill is 20 + level, as every authored row has it');
  assert(Math.abs(trashXp(41) / 61 - 1) < 0.07, `trashXp(41) is ${trashXp(41).toFixed(1)}, within 7% of 20 + 41: the step at 40 is the price of continuity`);
  let rising = true;
  for (let e = 41; e <= 98; e++) if (!(trashXp(e) > trashXp(e - 1))) rising = false;
  assert(rising, 'it rises with the enemy level from 41 to 98');
  assert(enemyXp(99, 'trash') === enemyXp(98, 'trash') && enemyXp(99, 'boss') === enemyXp(98, 'boss') && trashXp(150) === trashXp(98), 'level 99 has no next level to pay toward: it pays what 98 does');
  assert(ROLE_XP.trash === 1 && ROLE_XP.elite === 3 && ROLE_XP.rare === 6 && ROLE_XP.boss === 10, 'the role multiples are 1 / 3 / 6 / 10');
  for (const e of [12, 41, 60, 80, 98]) {
    const t = trashXp(e);
    assert(enemyXp(e, 'elite') === Math.round(3 * t) && enemyXp(e, 'rare') === Math.round(6 * t) && enemyXp(e, 'boss') === Math.round(10 * t), `at ${e} an elite is 3x, a rare 6x and a boss 10x the trash kill`);
  }
  // the doc's section 2 table, to the XP
  const table: [number, number, number][] = [[45, 91, 906], [50, 138, 1381], [60, 325, 3253], [70, 779, 7788], [80, 1888, 18878], [90, 4622, 46221], [98, 9518, 95180]];
  for (const [e, trash, boss] of table) assert(enemyXp(e, 'trash') === trash && enemyXp(e, 'boss') === boss, `level ${e}: trash ${trash}, boss ${boss} (docs/combat-99.md section 2)`);
  // the authored rows already agree: the four dungeon bosses are 10x and the Warden now is, Vael is the one to drift (6% high at 41, the price of continuity)
  for (const id of ['captain_marrow', 'rotroot_mother', 'cairn_king', 'warden']) assert(ENEMY_TYPES[id].xp === 10 * trashXp(ENEMY_TYPES[id].level), `${ENEMY_TYPES[id].name} pays 10 x (20 + level)`);
  assert(Math.abs(ENEMY_TYPES.archmage_vael.xp / enemyXp(41, 'boss') - 1) < 0.07, `Vael's ${ENEMY_TYPES.archmage_vael.xp} is within 7% of the rule's ${enemyXp(41, 'boss')}`);
}

section('check 2: the pace is what section 1.3 says');
{
  assert(K98 === 90 && K40 === 46 && kpl(40) === 46 && kpl(98) === 90, 'K98 is the one coefficient: 46 mean kills a level at 40, 90 at 98');
  let sum = 0;
  for (let l = 41; l <= 98; l++) sum += kpl(l);
  assert(Math.abs(sum / 3966 - 1) < 0.01, `kills from 41 to 99 sum to ${sum.toFixed(0)}, within 1% of 3,966`);
  // the rule's own words, written out here from the curve and not from enemy-xp.ts: a level's cost over the kills it takes
  let worst = 0;
  for (let l = 41; l <= 98; l++) {
    const pays = (xpForLevel(l + 1) - xpForLevel(l)) / (1.4345 * (46 + (90 - 46) * (l - 40) / 58));
    worst = Math.max(worst, Math.abs(enemyXp(l, 'trash') - pays));
  }
  assert(worst <= 1, `a level-L trash kill pays cost(L) / (1.4345 x kpl(L)) to within ${worst.toFixed(2)} XP at every level from 41 to 98`);
  assert(MEAN_KILL === 1.4345 && cost(41) === 4358 && cost(98) === 1228825 && cost(99) === cost(98), 'a level costs 4,358 at 41 and 1,228,825 at 98');
  const minutes = (l: number) => kpl(l) * 40 / 60;
  assert(Math.abs(minutes(41) - 31) < 1 && Math.abs(minutes(98) - 60) < 0.5, `a level takes ${minutes(41).toFixed(0)} minutes at 41 and ${minutes(98).toFixed(0)} at 98 at a person's 40 s a mean kill`);
}

section('HOM-169: nothing on a respawn timer out-farms the band it stands in');
{
  // a band's mean-kill hour at level L: trash xp x the mean kill's 1.4345 x 3600 / 33.6 s (the bible's 3.7 bot clock, the one section 5 used)
  const band = (level: number) => trashXp(level) * MEAN_KILL * 3600 / 33.6;
  // the cave's repeatable rows that sit on a timer (the Brute retires with the second quest). Spawns are counted: two ogres are two timers.
  for (const id of ['warden', 'ogre'] as const) {
    const def = ENEMY_TYPES[id];
    const n = SPAWNS.filter(sp => sp.type === id).length;
    const hour = (level: number) => n * 3600 / def.respawn * def.xp * xpParity(def.level, level);
    const worst = Math.max(...Array.from({ length: 30 - def.level }, (_, i) => hour(def.level + 1 + i) / band(def.level + 1 + i)));
    assert(worst <= 1, `${def.name}: ${n} spawn${n === 1 ? '' : 's'} on ${def.respawn} s pay at most ${worst.toFixed(2)}x the band's hour from level ${def.level + 1} to 30, ${Math.round(hour(11))} XP an hour at 11`);
  }
  assert(ENEMY_TYPES.warden.respawn === 600 && ENEMY_TYPES.ogre.respawn === 360, 'the Warden is on a boss\'s 10 minutes and the Hollow Ogre on 6');
}

console.log(`\n${checks} checks passed`);

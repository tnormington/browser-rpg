// HOM-174: Echoes (docs/combat-99.md section 3 and 8.1, checks 3 to 6). What it proves: an Echo row is the bible's model at a new level (and reproduces the Rune Golem to the digit),
// a bot on the real sim at one decision a tick (the bench's `--fast 1`: `--fast 4` has bitten this project twice) takes the model's time and loses the template's share of health, the
// tell ladder takes its share out of the swings' budget and does not add to it, the respawn rule never rescales a fight, the setting is capped, saved and locked behind the Seal, and a
// character who has not broken it sees nothing. Run with `npm run verify`.
import { createState, step, NO_INPUT, TICK_DT, Input, GameState, Enemy } from './sim';
import { ENEMY_TYPES, SPAWNS, defOf, xpParity } from './sim/data';
import { ITEMS } from './sim/items';
import { countItem } from './sim/inventory';
import { SAFE_ZONES } from './sim/world';
import { PLAYER_SPAWN } from './sim/data';
import { deserialize, serialize } from './sim/save';
import { enemyXp, ROLE_XP } from './sim/enemy-xp';
import { xpForLevel } from './sim/xp';
import { refreshPlayerStats } from './sim/combat';
import {
  ECHO_LEAD, ECHO_MARK, ECHO_MARKS, ECHO_MARK_ITEM, ECHO_MAX_OFFSET, ECHO_MIN_LEVEL, ECHO_PAIR, ECHO_SLAM, ECHO_STEPS, ECHO_TTK, MODEL_FROM, ROLES,
  anchoredHp, armourLine, damageRatio, dps, dress, echoArmour, echoRow, echoSetting, expectedDropValue, hpRatio, isPaired, modelHit, modelHp, roleOf, setEcho, ttkTemplate, unansweredFight, weaponLine,
} from './sim/echo';
import { ANSWERS_NOTHING, Policy, REFERENCE, arena, fight, withoutProcs } from './echo-bot';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const T = ENEMY_TYPES;
const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => { for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i); };
const within = (a: number, b: number, rel: number) => Math.abs(a / b - 1) <= rel;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
/** Read state through a wide type so TS does not narrow across sim calls. */
const st = (e: Enemy): string => e.state;
const lv = (e: Enemy): number | null => e.echo;

/** Every chain done up to and including the Seal's: the order a save will accept, which is the order the story is told in. */
function breakSeal(s: GameState) {
  Object.assign(s.quest, { stage: 'done', second: 'cleared', third: 'cleared', fourth: 'cleared', fifth: 'cleared', sixth: 'cleared', seventh: 'cleared', eighth: 'done' });
}
/** A world with nothing alive in it, at a combat level, the Seal broken, and the Echo switch where `echo` says. The player stands in Hale, far from everything. */
function world(level: number, echo: -3 | 0 | 3 | null, sealed = true, seed = 7) {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level; p.unlocked = level;
  refreshPlayerStats(s, true);
  p.energy = p.maxEnergy;
  if (sealed) breakSeal(s);
  p.echo = echo;
  return s;
}
/** Stand an enemy up as if it were there and well (idle, full health), the way a respawn leaves it: dressed by the rule, then placed. */
function stand(s: GameState, type: string, k = 0): Enemy {
  const e = s.enemies.filter(x => x.type === type)[k];
  Object.assign(e, { state: 'idle', respawnIn: 0, deadFor: 0, x: e.spawnX, z: e.spawnZ, cast: null, bleed: null });
  dress(s, e);
  e.hp = e.maxHp;
  return e;
}
/** Kill it the way a player does: beside it, one Strike on a body with one hit left. Then walk away, so nothing wakes. Returns the events of the tick it died. */
function slay(s: GameState, e: Enemy) {
  const p = s.player, home = { x: p.x, z: p.z };
  p.x = e.x + 1.5; p.z = e.z; p.hp = p.maxHp; p.energy = p.maxEnergy; p.cd.fill(0); p.gcd = 0;
  e.hp = 1;
  tick(s, { clickEnemy: e.id });
  const seen: GameState['events'] = [];
  seen.push(...s.events);
  for (let n = 0; n < 60 && e.state !== 'dead'; n++) { tick(s, { ability: 0 }); seen.push(...s.events); }
  p.x = home.x; p.z = home.z;
  return seen;
}

// ---------------------------------------------------------------------------
section('check 5: the offset is capped, saved, and locked behind the Seal');
{
  assert(ECHO_MAX_OFFSET === 3 && ECHO_STEPS.join() === ',-3,0,3', 'ECHO_MAX_OFFSET is 3 and the menu has off, Easy, Standard, Hard');
  assert(echoSetting(5) === 3 && echoSetting(-5) === -3 && echoSetting(2) === 3 && echoSetting(1) === 0 && echoSetting(-1) === 0 && echoSetting(0) === 0 && echoSetting(3) === 3, 'a setting is held to the cap and snapped to a step: 5 is 3, 1 is 0');
  assert(echoSetting(null) === null && echoSetting(undefined) === null && echoSetting('3') === null && echoSetting(NaN) === null && echoSetting(Infinity) === null, 'anything that is not a number is off');
  assert(!Object.is(echoSetting(-0.4), -0), 'and a -0 is not a setting');

  const s = world(50, null, false);
  tick(s, { echo: 3 });
  assert(s.player.echo === null && s.events.some(e => e.t === 'echo' && !e.ok && e.to === null), 'before the Seal the switch is refused, and says so');
  breakSeal(s);
  tick(s, { echo: 3 });
  assert(s.player.echo === 3 && s.events.some(e => e.t === 'echo' && e.ok && e.to === 3), 'after it, the switch moves');
  tick(s, { echo: undefined });
  assert(s.player.echo === 3, 'and an input that does not mention it leaves it alone');
  tick(s, { echo: null });
  assert(s.player.echo === null, 'null turns it off');

  const saved = world(60, 3);
  const back = deserialize(serialize(saved))!;
  assert(back.player.echo === 3 && back.quest.eighth === 'done', 'a saved setting comes back');
  const hand = JSON.parse(serialize(saved)); hand.player.echo = 5;
  assert(deserialize(JSON.stringify(hand))!.player.echo === 3, 'a saved 5 loads as 3');
  hand.player.echo = -9; assert(deserialize(JSON.stringify(hand))!.player.echo === -3, 'and a saved -9 as -3');
  delete hand.player.echo; assert(deserialize(JSON.stringify(hand))!.player.echo === null, 'a save from before the switch has it off');
  const sealed = world(60, 3, false);
  assert(deserialize(serialize(sealed))!.player.echo === null, 'a save that says 3 for a character who has not broken the Seal loads as off');
}

// ---------------------------------------------------------------------------
section('the rows: every one has a role, and the model built the ones it says it built');
{
  const ids = Object.keys(T);
  assert(ids.every(id => ROLES[id]) && Object.keys(ROLES).every(id => T[id]), `all ${ids.length} rows have a role and every role is a row`);
  // from level 18 the bible's rows are the model's output: XP is (20 + L) x role on every one, and HP is the role's multiple of the template's (a camp's 0.75 and a pair's 0.85 on top)
  const multiple = { trash: 1, elite: 3, rare: 4, boss: 8 };
  const built = ids.filter(i => T[i].level > MODEL_FROM), off = built.filter(id => {
    const d = T[id], k = d.hp / modelHp(d.level, ttkTemplate(d.level)), want = multiple[ROLES[id]] * (d.pack ? (id === 'fen_stalker' ? 0.85 : 0.75) : 1);
    return d.xp !== (20 + d.level) * ROLE_XP[ROLES[id]] || !within(k, want, 0.01);
  });
  assert(built.length >= 30 && off.length === 0, `the ${built.length} rows from level 18 are the model's: XP (20 + L) x role, HP the role's multiple of the template (1, 3, 4, 8; a camp 0.75, the stalkers' pair 0.85)${off.length ? ` - not ${off.join(', ')}` : ''}`);
  // the rows under it were built before the model and are anchored to their role instead, so an Echo of a starter boar is not 2x a trash fight
  const early = ids.filter(i => T[i].level <= MODEL_FROM), drift = early.filter(id => !within(anchoredHp(T[id]) / modelHp(T[id].level, ttkTemplate(T[id].level)), multiple[ROLES[id]] * (T[id].pack ? 0.75 : 1), 1e-9));
  assert(early.length === 20 && drift.length === 0, `the ${early.length} rows from before the model (the cave, the road, the Strand) are anchored to their role's multiple of the template and not to their shipped HP (the Marsh Hog's 415 is 13.5 % over it)`);
}
// ---------------------------------------------------------------------------
section('check 3 (the rows): the model reproduces the Rune Golem to the digit, and the Echo rows are the document\'s table');
{
  const golem = T.rune_golem, b = golem.level;
  assert(Math.abs(Math.round(modelHp(b, ttkTemplate(b))) - golem.hp) <= 1, `HP: the model says ${Math.round(modelHp(b, ttkTemplate(b)))}, the row ${golem.hp}`);
  assert(Math.round(modelHit(b, ttkTemplate(b), golem.attackInterval, 0.28)) === golem.damage, `hit: 28 % of 655 health over a ${ttkTemplate(b).toFixed(1)} s fight at ${golem.attackInterval} s a swing is ${Math.round(modelHit(b, ttkTemplate(b), golem.attackInterval, 0.28))}, the row ${golem.damage}`);
  // 3.5's factors for the golem at E = 42, 48, 56, 64, 72, 80, 88, 96 and 99
  const levels = [42, 48, 56, 64, 72, 80, 88, 96, 99];
  const hpF = [1.23, 1.55, 2.03, 2.57, 3.18, 3.85, 4.59, 5.39, 5.71], hitF = [1.22, 1.59, 1.82, 2.06, 2.30, 2.53, 2.77, 3.01, 3.09];
  levels.forEach((E, i) => assert(Math.abs(hpRatio(b, E) - hpF[i]) < 0.006 && Math.abs(damageRatio(b, E) - hitF[i]) < 0.006, `golem at ${E}: HP x${hpRatio(b, E).toFixed(2)}, hit x${damageRatio(b, E).toFixed(2)} (the document's ${hpF[i]} and ${hitF[i]})`));
  assert(echoArmour(47) === 133 && echoArmour(48) === 160 && Math.abs(ttkTemplate(41) - ECHO_TTK) < 1e-9 && ECHO_TTK === 14.2, 'the armour is 133 to 47 and 160 from 48, and the Echo\'s time to kill is level 41\'s 14.2 s');

  // the rows the table lists: elites and bosses carry no ladder, so these are the ratios alone, to the point
  const row = (id: string, E: number) => echoRow(T[id], E);
  const cases: [string, number, number, number, number | null][] = [
    ['spire_warden', 70, 38255, 306, 1323], ['stonehorn', 99, 72170, 391, 1623], ['archmage_vael', 99, 192463, 234, 1881], ['spire_warden', 99, 72185, 423, null],
  ];
  for (const [id, E, hp, hit, heavy] of cases) {
    const r = row(id, E);
    assert(Math.abs(r.hp - hp) <= 2 && Math.abs(r.damage - hit) <= 1 && (heavy === null || Math.abs(r.heavy!.damage - heavy) <= 2), `${T[id].name} at ${E}: ${r.hp} HP, hit ${r.damage}${heavy ? `, heavy ${r.heavy!.damage}` : ''} (the table's ${hp}, ${hit}${heavy ? `, ${heavy}` : ''})`);
    assert(r.xp === enemyXp(E, ROLES[id]) && r.level === E && r.respawn === T[id].respawn && r.look === T[id].look, `...XP ${r.xp} by enemyXp, level ${E}, and the original's respawn and look`);
  }
  assert(Math.abs(row('rune_golem', 56).hp - 8559) <= 2, 'the golem at 56 is 8,559 HP (the table\'s)');
  assert(Math.abs(echoRow(T.archmage_vael, 99).heavy!.damage / T.archmage_vael.heavy!.damage / damageRatio(41, 99) - 1) < 0.01 && Math.abs(echoRow(T.archmage_vael, 99).hazard!.damage / T.archmage_vael.hazard!.damage / damageRatio(41, 99) - 1) < 0.01,
    'every hit scales alike: the nova and the Rune Storm keep their share of the player\'s health as the swing does');
  // the template's own HP, at every E and for the four rows of the check: (TTK + 1) x DPS x the row's role multiple, within 2 %
  for (const id of ['marsh_hog', 'rune_golem', 'spire_warden', 'archmage_vael']) {
    const mult = { trash: 1, elite: 3, rare: 4, boss: 8 }[ROLES[id]];
    for (const E of [42, 60, 80, 99]) {
      const want = (ECHO_TTK + 1) * dps(E, weaponLine(E)) * mult * (isPaired(T[id], E) ? ECHO_PAIR.hp : 1);
      assert(within(echoRow(T[id], E).hp, want, 0.02), `${T[id].name} at ${E}: ${echoRow(T[id], E).hp} HP is (14.2 + 1) x DPS ${dps(E, weaponLine(E)).toFixed(0)}${mult > 1 ? ` x ${mult}` : ''}${isPaired(T[id], E) ? ' x 0.85 (a pair)' : ''} within 2 %`);
    }
  }
  assert(echoRow(T.rune_golem, 60) === echoRow(T.rune_golem, 60) && echoRow(T.rune_golem, 60) !== T.rune_golem && T.rune_golem.hp === 4215 && !T.rune_golem.hazard, 'a row is built once, and the authored one is not touched');
}

// ---------------------------------------------------------------------------
section('the tell ladder, as data: a mark from 56, a slam on every melee row from 70, a pair from 84');
{
  const golem = (E: number) => echoRow(T.rune_golem, E);
  assert(!golem(55).hazard && !golem(55).heavy && !isPaired(T.rune_golem, 55), 'to 55 an Echo has nothing new: the numbers, the adjustment');
  assert(golem(56).hazard?.name === ECHO_MARK.name && golem(56).hazard!.radius === 3 && golem(56).hazard!.every === 8 && !golem(56).heavy, 'at 56 every trash row gains the Seer\'s mark: radius 3, every 8 s');
  assert(golem(69).hazard !== undefined && !golem(69).heavy && !isPaired(T.rune_golem, 69), 'and still no more at 69');
  assert(golem(70).heavy?.name === ECHO_SLAM.name && golem(70).heavy!.windup === 1.7 && golem(70).hazard !== undefined, 'at 70 it gains the Ogre\'s slam, 1.7 s wind-up, on top');
  assert(!isPaired(T.rune_golem, 83) && isPaired(T.rune_golem, 84) && isPaired(T.marsh_hog, 99), 'at 84 a trash row comes in twos');
  assert(golem(99).hp === Math.round(golem(99).hp) && golem(84).hp < 0.9 * (hpRatio(38, 84) * T.rune_golem.hp), 'and each of the pair has 0.85 of the health');
  const foot = (E: number) => echoRow(T.footpad, E);
  assert(foot(60).hazard?.name === ECHO_MARK.name && !foot(80).heavy && foot(80).ranged !== undefined, 'a shooter gains the mark and never the slam');
  assert(echoRow(T.tide_hag, 60).hazard!.name === 'Undertow' && echoRow(T.bog_witch, 99).hazard!.name === 'Withering Ground' && echoRow(T.bog_witch, 99).hazard!.every === 5, 'a caster that already marks the ground keeps its own mark');
  assert(!isPaired(T.road_wolf, 99) && !isPaired(T.dune_hound, 99) && !isPaired(T.fen_stalker, 99), 'a row that already comes in a group is its own pair');
  const named = Object.keys(T).filter(i => ROLES[i] !== 'trash');
  assert(named.every(id => !isPaired(T[id], 99) && !!echoRow(T[id], 99).heavy === !!T[id].heavy && !!echoRow(T[id], 99).hazard === !!T[id].hazard && echoRow(T[id], 99).hp === Math.round(anchoredHp(T[id]) * hpRatio(T[id].level, 99))),
    `the ${named.length} elites, rares and bosses gain nothing from the ladder: they already carry a slam and a mark, and come alone`);
  const melee = Object.keys(T).filter(i => ROLES[i] === 'trash' && !T[i].ranged);
  assert(melee.every(id => echoRow(T[id], 70).heavy?.name === ECHO_SLAM.name && echoRow(T[id], 69).heavy === undefined), `every one of the ${melee.length} melee trash rows slams from 70`);}

// ---------------------------------------------------------------------------
section('the tells take their share out of the swings: what a player who answers nothing pays does not move');
{
  // the cost counted by `unansweredFight` against what the row would cost with no ladder: the same, to the rounding, at every rung and for every kind of row
  const trash = Object.keys(T).filter(id => ROLES[id] === 'trash');
  let worst = 0, worstId = '';
  for (const id of trash) for (const E of [42, 56, 60, 70, 80]) {
    const base = echoRow(T[id], 42), r = echoRow(T[id], E), scaleBy = damageRatio(T[id].level, E) / damageRatio(T[id].level, 42);
    const was = unansweredFight(base).total * scaleBy, now = unansweredFight(r).total;
    if (Math.abs(now / was - 1) > worst) { worst = Math.abs(now / was - 1); worstId = `${id} at ${E}`; }
  }
  assert(worst < 0.02, `all ${trash.length} trash rows at 56, 60, 70 and 80 cost what they cost at 42 to within ${(100 * worst).toFixed(1)} % (${worstId}, by the enemy's own schedule)`);
  const r = echoRow(T.rune_golem, 80), whole = unansweredFight(r).total, landed = unansweredFight(r).landed;
  assert(Math.abs(r.hazard!.damage * landed.hazard / whole - ECHO_MARK.share * landed.hazard) < 0.01 && Math.abs(r.heavy!.damage * landed.heavy / whole - ECHO_SLAM.share * landed.heavy) < 0.01,
    `a landing is worth its share of the fight: the mark ${(100 * r.hazard!.damage / whole).toFixed(0)} % and the slam ${(100 * r.heavy!.damage / whole).toFixed(0)} %, ${landed.hazard} marks and ${landed.heavy} slam in a fight (the document's 15 and 30)`);
  // ...so the swings (and the row's own casts) take up the rest. A cast already displaces swings, so the document's "cut" is a cut only where the tells land more often than they displace:
  // a golem's swing is x1.07 of the model's at 80, a shooter's bolt x1.4, a quick crab's x0.7
  const ks = trash.flatMap(id => [56, 70, 80].map(E => echoRow(T[id], E).damage / Math.round(T[id].damage * damageRatio(T[id].level, E))));
  assert(Math.min(...ks) > 0.6 && Math.max(...ks) < 1.5, `the swing is the model's x${Math.min(...ks).toFixed(2)} to x${Math.max(...ks).toFixed(2)} across the ${trash.length} trash rows at 56, 70 and 80: the rest of the budget, not a second one`);
  assert(ECHO_LEAD === 0.5 && unansweredFight(T.rune_golem, 0).total === 0, 'the window the fight is counted over is the lead and the time to kill');
}

// ---------------------------------------------------------------------------
/** What a policy loses and takes, on the real sim at one decision a tick, over `n` seeds. `E` is an Echo of that level; null is the template at its own level (its HP the model's, its numbers the authored ones). */
function measure(type: string, E: number | null, policy: Policy, n: number) {
  const def = T[type], b = def.level, ttk: number[] = [], loss: number[] = [];
  let died = 0;
  for (let seed = 1; seed <= n; seed++) {
    const level = E ?? b;
    const a = arena(seed, type, level, weaponLine(level), E === null ? armourLine(b) : echoArmour(E), (s, e) => {
      if (E === null) { e.row = { ...def, hp: Math.round(anchoredHp(def)) }; e.maxHp = e.row.hp; } // the template: the row as the model would have built it
      else { s.quest.eighth = 'done'; s.player.echo = 0; dress(s, e); }
    });
    const f = fight(a, policy);
    if (f.died) died++;
    if (f.ttk !== null) ttk.push(f.ttk);
    loss.push(f.lossPct);
  }
  return { ttk: mean(ttk), loss: mean(loss), died };
}

section('check 3 (the bot): takes the model\'s time and loses the template\'s share, at --fast 1');
withoutProcs(() => {
  // A trash row answered with nothing pays what the pace model says; an elite or a boss is answered by the reference player of 3.4a (Pummel a wind-up, step out of slam and ground), because with
  // nothing answered the bible's own rows are dead. Trash takes 14.2 s; an elite or boss takes the template's own time scaled by the model (it is not 14.2: it is 3 and 8 of them, and a bot that
  // steps out of a slam spends time not hitting, in the template as in the Echo).
  const N = { trash: 16, other: 8 };
  for (const id of ['marsh_hog', 'rune_golem', 'spire_warden', 'archmage_vael']) {
    const role = ROLES[id], trash = role === 'trash', policy = trash ? ANSWERS_NOTHING : REFERENCE, n = trash ? N.trash : N.other, mult = { trash: 1, elite: 3, rare: 4, boss: 8 }[role];
    const base = measure(id, null, policy, n);
    assert(base.died === 0, `${T[id].name}: the template at level ${T[id].level} is a fight that is won (${base.ttk.toFixed(1)} s, ${base.loss.toFixed(0)} % of health)`);
    for (const E of [42, 60, 80, 99]) {
      const m = measure(id, E, policy, n), pair = isPaired(T[id], E);
      const bodies = pair ? 2 * ECHO_PAIR.hp : 1;
      const wantTtk = trash ? bodies * ECHO_TTK : base.ttk * (mult * (ECHO_TTK + 1) - 1) / (mult * (ttkTemplate(T[id].level) + 1) - 1);
      const wantLoss = base.loss * (pair ? 3 * ECHO_PAIR.hp * ECHO_PAIR.hit : 1);
      assert(m.died === 0 && within(m.ttk, wantTtk, 0.08), `${T[id].name} at ${E}${pair ? ' (a pair)' : ''}: ${m.ttk.toFixed(1)} s against ${wantTtk.toFixed(1)}${trash ? ` (${bodies > 1 ? `2 x 0.85 x ` : ''}14.2)` : ' (the template\'s, scaled by the model)'}, within 8 %`);
      assert(Math.abs(m.loss - wantLoss) <= 4, `...and it costs ${m.loss.toFixed(1)} % of health against the template's ${wantLoss.toFixed(1)}${pair ? ' (a pair is 3 x 0.85 x 0.7 of one body)' : ''}, within 4 points`);
    }
  }
  // the ladder pays the player who answers it: the same fight with a Pummel and a step out of every slam and mark costs less than the one with no answer, and by more as the rungs come
  const none = measure('rune_golem', 80, ANSWERS_NOTHING, 16), ref = measure('rune_golem', 80, REFERENCE, 16);
  assert(ref.loss < none.loss - 5, `a golem at 80 costs ${ref.loss.toFixed(0)} % to a player who answers it and ${none.loss.toFixed(0)} % to one who does not`);
  const ref42 = measure('rune_golem', 42, REFERENCE, 16), none42 = measure('rune_golem', 42, ANSWERS_NOTHING, 16);
  assert(none.loss - ref.loss > none42.loss - ref42.loss, `...and the ladder is what widens it: ${(none.loss - ref.loss).toFixed(0)} points at 80 against ${(none42.loss - ref42.loss).toFixed(0)} at 42, where the sweep is all there is to answer`);
  // a shooter, a camp member and a caster with a mark of their own: the rungs cost them nothing either
  for (const id of ['footpad', 'drowned_sailor', 'grave_hound', 'tide_hag']) {
    const lo = measure(id, 42, ANSWERS_NOTHING, 10), hi = measure(id, 80, ANSWERS_NOTHING, 10);
    assert(Math.abs(hi.loss - lo.loss) <= 4, `${T[id].name}: ${lo.loss.toFixed(1)} % at 42 and ${hi.loss.toFixed(1)} % at 80, with the rungs between`);
  }
});

// ---------------------------------------------------------------------------
section('the respawn rule: an enemy becomes an Echo when it comes back, and a fight is never rescaled');
{
  const s = world(60, 0);
  const e = stand(s, 'marsh_hog');
  assert(e.echo === 60 && e.row !== null && defOf(e) === echoRow(T.marsh_hog, 60) && e.maxHp === echoRow(T.marsh_hog, 60).hp && e.hp === e.maxHp, 'first load: a hog standing in the world with the switch on is an Echo at the player\'s level');
  assert(defOf(e).xp === enemyXp(60, 'trash') && defOf(e).level === 60, '...which pays enemyXp(60, trash) and says 60');

  // a fight in progress: the switch, and the player's level, move under it and it does not
  s.player.echo = 3; atLevelUp(s, 70);
  e.state = 'chase'; e.hp = e.maxHp * 0.5;
  const row = e.row, hp = e.hp, maxHp = e.maxHp;
  run(s, 1);
  assert(e.row === row && e.echo === 60 && e.maxHp === maxHp && Math.abs(e.hp - hp) < 5, 'a fight in progress is never rescaled: the switch and the level moved, the body in front of the player did not');
  // ...and when it comes back, it comes back as the rule says now: L 70 and d 3 is 73
  s.player.echo = 3; e.state = 'idle'; e.hp = e.maxHp;
  const killed = slay(s, e);
  assert(killed.some(ev => ev.t === 'kill' && ev.id === e.id) && st(e) === 'dead' && e.row === row, 'it is killed as an Echo of 60...');
  run(s, T.marsh_hog.respawn + 2);
  assert(st(e) === 'idle' && lv(e) === 73 && defOf(e).level === 73 && e.maxHp === echoRow(T.marsh_hog, 73).hp && e.hp === e.maxHp, '...and comes back at clamp(70 + 3) = 73, at its own next respawn');

  // switching off returns the authored row at the next respawn, not before
  s.player.echo = null;
  assert(lv(e) === 73 && defOf(e).level === 73, 'switched off, the one standing there is still the Echo');
  slay(s, e); run(s, T.marsh_hog.respawn + 2);
  assert(e.state === 'idle' && e.echo === null && e.row === null && defOf(e) === T.marsh_hog && e.maxHp === T.marsh_hog.hp, 'and the authored row is back at its next respawn: the same object the data file holds');

  // the clamp: 42 at the bottom, 99 at the top, and Easy and Hard in between
  for (const [L, d, E] of [[41, -3, 42], [45, -3, 42], [45, 0, 45], [60, -3, 57], [60, 3, 63], [97, 3, 99], [99, 3, 99]] as [number, -3 | 0 | 3, number][]) {
    const w = world(L, d), x = stand(w, 'marsh_hog');
    assert(x.echo === E, `level ${L}, offset ${d >= 0 ? '+' : ''}${d}: an Echo of ${E}`);
  }
  assert(ECHO_MIN_LEVEL === 42, 'and the first Echo level is 42, the first the authored rows do not reach');

  // not in a safe zone, and not before the Seal
  const town = world(60, 0), zone = SAFE_ZONES[0];
  const t = town.enemies.find(x => x.type === 'marsh_hog')!; t.spawnX = zone.x; t.spawnZ = zone.z; dress(town, t);
  assert(t.echo === null && t.row === null, 'an enemy whose post is in a safe zone is never an Echo');
  const early = world(60, 3, false), g = stand(early, 'marsh_hog');
  assert(g.echo === null && defOf(g) === T.marsh_hog, 'before the Seal a switch that somehow reads 3 does nothing');
  const retired = world(60, 0), br = retired.enemies.find(x => x.type === 'brute')!; dress(retired, br);
  assert(br.echo === null, 'and a row that has retired for good stays gone');
}
function atLevelUp(s: GameState, level: number) {
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level; p.unlocked = level;
  refreshPlayerStats(s, false);
}

// ---------------------------------------------------------------------------
section('a pair: each trash row from 84 arrives with a mate, who is called when wanted and stands down when not');
{
  const s = world(90, 0);
  const before = s.enemies.length, e = stand(s, 'cairn_brute');
  const mate = s.enemies.find(m => m.mateOf === e.id);
  assert(s.enemies.length === before + 1 && !!mate && mate.type === 'cairn_brute', 'the first Echo that is paired makes its mate, an enemy of its own species');
  tick(s);
  assert(mate!.state === 'idle' && mate!.echo === 90 && defOf(mate!) === defOf(e) && mate!.hp === mate!.maxHp && Math.hypot(mate!.x - e.x, mate!.z - e.z) > 1 && Math.hypot(mate!.x - e.x, mate!.z - e.z) < 3.5, 'it stands up beside the leader, in the same row');
  assert(mate!.id === Math.max(...s.enemies.map(o => o.id)) && s.enemies.filter(o => o.id === mate!.id).length === 1, 'with an id of its own, after every older one');
  assert(JSON.parse(serialize(s)).enemies.length === before, 'a mate is not in the save (the leader makes it again)');
  // they wake together
  s.player.x = e.x + 6; s.player.z = e.z;
  run(s, 1);
  assert(st(e) === 'chase' && st(mate!) === 'chase', 'one wakes and so does the other');
  // killed, it respawns on its own clock; a second leader's respawn does not make a second mate
  s.player.x = PLAYER_SPAWN.x; s.player.z = PLAYER_SPAWN.z; e.state = 'idle'; mate!.state = 'idle';
  slay(s, e); run(s, T.cairn_brute.respawn + 2);
  assert(e.state === 'idle' && s.enemies.filter(m => m.mateOf === e.id).length === 1, 'a leader that respawns again calls the mate it has, not another');
  // dropped to Standard at 70: the pair is gone at the next respawn
  s.player.echo = null; slay(s, e); slay(s, mate!); run(s, T.cairn_brute.respawn + 2);
  assert(e.echo === null && st(mate!) === 'dead' && mate!.respawnIn >= 1e8, 'with the switch off the leader is authored again and the mate stays down');
  s.player.echo = 0; slay(s, e); run(s, T.cairn_brute.respawn + 2);
  assert(e.echo === 90 && st(mate!) !== 'dead', 'and when it is back on, the leader calls the mate home');
  const w = world(80, 0), l = stand(w, 'cairn_brute');
  assert(!w.enemies.some(m => m.mateOf !== null) && l.echo === 80, 'below 84 there is no mate');
  const camp = world(90, 0); stand(camp, 'grave_hound');
  assert(!camp.enemies.some(m => m.mateOf !== null), 'a camp member does not get one');
  // a loaded game is dressed as a world that has just respawned
  const saved = world(90, 3), dead = saved.enemies.filter(x => x.type === 'rune_golem')[0], alive = saved.enemies.filter(x => x.type === 'rune_golem')[1];
  Object.assign(alive, { state: 'idle', respawnIn: 0, deadFor: 0 }); Object.assign(dead, { state: 'dead', respawnIn: 30, deadFor: 99 });
  const back = deserialize(serialize(saved))!, a2 = back.enemies.find(x => x.id === alive.id)!, d2 = back.enemies.find(x => x.id === dead.id)!;
  assert(a2.echo === 93 && a2.maxHp === echoRow(T.rune_golem, 93).hp && a2.hp === a2.maxHp && back.enemies.some(m => m.mateOf === a2.id), 'first load: what is standing is an Echo at L + d (93), mate and all');
  assert(d2.state === 'dead' && d2.echo === null, '...and what was down comes back as one at its own respawn');
  run(back, 32);
  assert(st(d2) === 'idle' && lv(d2) === 93, '...which it does');
}

// ---------------------------------------------------------------------------
section('loot: the original\'s table, the marks of its role, and the gold of its level');
{
  const s = world(80, 0);
  const trash = stand(s, 'rune_golem'), elite = stand(s, 'spire_warden'), boss = stand(s, 'archmage_vael'), rare = stand(s, 'old_grey');
  // the marks lie a pace from the body, and the player who killed it is standing in reach of them: they are in the bag by the time the kill is over
  const held = () => countItem(s.player.inventory, ECHO_MARK_ITEM) + s.drops.filter(d => d.item === ECHO_MARK_ITEM).reduce((a, d) => a + d.qty, 0);
  const dropped = (e: Enemy) => { s.drops = []; s.player.inventory.fill(null); const g0 = s.player.gold; const ev = slay(s, e); return { marks: held(), gold: s.player.gold - g0, kill: ev.find(x => x.t === 'kill') }; };
  const goldFor = (type: string, E: number) => Math.round({ trash: 1, elite: 3, rare: 4, boss: 8 }[ROLES[type]] * (0.6 * E + 3) - expectedDropValue(type));
  for (const [e, marks] of [[trash, 0], [elite, 1], [rare, 2], [boss, 3]] as [Enemy, number][]) {
    const d = dropped(e);
    assert(d.marks === marks && ECHO_MARKS[ROLES[e.type]] === marks, `${T[e.type].name} (${ROLES[e.type]}) at 80 drops ${marks} Echo mark${marks === 1 ? '' : 's'}`);
    assert(d.gold === goldFor(e.type, 80) && d.kill?.t === 'kill' && d.kill.gold === d.gold, `...and ${d.gold} gold on top of its table, the bible's 0.6 x 80 + 3 = 51 times its role, less what the original's table is worth (${expectedDropValue(e.type).toFixed(1)})`);
  }
  assert(ITEMS[ECHO_MARK_ITEM] !== undefined && ITEMS[ECHO_MARK_ITEM].stack >= 99, 'the mark is an item that stacks');
  // the same kill, authored: no marks, no gold on the event, and the table rolled as it always was
  const plain = world(80, null), p = stand(plain, 'spire_warden'), g0 = plain.player.gold, pe = slay(plain, p);
  assert(plain.drops.every(d => d.item !== ECHO_MARK_ITEM) && plain.player.gold === g0 && pe.every(x => x.t !== 'kill' || x.gold === undefined), 'an authored kill pays no marks and no gold');
  // gold, over many kills, lands the bible's rule: the table's expected value plus the top-up is 0.6 E + 3 (times the role)
  for (const [type, E] of [['rune_golem', 60], ['spire_warden', 99], ['archmage_vael', 99], ['marsh_hog', 42]] as [string, number][]) {
    const want = { trash: 1, elite: 3, rare: 4, boss: 8 }[ROLES[type]] * (0.6 * E + 3);
    assert(Math.abs(expectedDropValue(type) + goldFor(type, E) - want) <= 0.5 || goldFor(type, E) === 0, `${T[type].name} at ${E}: table ${expectedDropValue(type).toFixed(1)} + gold ${goldFor(type, E)} = ${(expectedDropValue(type) + goldFor(type, E)).toFixed(1)}, the rule's ${want.toFixed(1)}`);
  }
}

// ---------------------------------------------------------------------------
section('check 6: the ratios are held');
{
  // the XP of a kill, off the real kill path, as a share of Standard's, from level 50 to 90
  const pays = (L: number, d: -3 | 0 | 3) => {
    const s = world(L, d), e = stand(s, 'rune_golem');
    return slay(s, e).filter((x): x is Extract<typeof x, { t: 'xp' }> => x.t === 'xp').reduce((a, x) => a + x.amount, 0);
  };
  for (const L of [50, 60, 70, 80, 90]) {
    const std = pays(L, 0), hard = pays(L, 3), easy = pays(L, -3);
    assert(std === Math.round(enemyXp(L, 'trash') * xpParity(L, L)) && Math.abs(hard / std - 1.49) <= 0.03 && Math.abs(easy / std - 0.65) <= 0.03, `level ${L}: Standard pays ${std}, Hard ${(hard / std).toFixed(2)}x (1.49 ± 0.03), Easy ${(easy / std).toFixed(2)}x (0.65 ± 0.03)`);
  }
}

// ---------------------------------------------------------------------------
section('check 4: a character who has not broken the Seal sees nothing');
{
  // the same scripted hour (a pull, a respawn, a levelling save) with the switch at its default and with it forced to 3 on a character who has not earned it: the world, the dice and the player come out alike
  const script = (setting: -3 | 0 | 3 | null) => {
    const s = createState(11);
    s.player.echo = setting;
    atLevelUp(s, 20);
    const hog = s.enemies.find(e => e.type === 'marsh_hog')!;
    s.player.x = hog.x + 6; s.player.z = hog.z;
    for (let i = 0; i < 40 * 30; i++) tick(s, { dirX: i % 90 < 45 ? 1 : -1, dirZ: 0, attack: i === 3, ability: i % 50 === 0 ? 1 : null, clickEnemy: i === 1 ? hog.id : null });
    const back = deserialize(serialize(s))!;
    return JSON.stringify({ tick: s.tick, rng: s.rng, hp: s.player.hp, xp: s.player.combat.xp, gold: s.player.gold, drops: s.drops.length, enemies: s.enemies.map(e => [e.id, e.state, Math.round(e.hp), e.echo, e.row === null]), n: s.enemies.length, loaded: back.enemies.length });
  };
  const plain = script(null);
  assert(script(3) === plain && script(-3) === plain && script(0) === plain, 'with the Seal unbroken the world, the dice, the player and the save come out the same whatever the switch says');
  const s = createState(5);
  assert(s.player.echo === null && s.enemies.every(e => e.echo === null && e.row === null && e.mateOf === null) && s.enemies.length === SPAWNS.length, 'a new game has no Echo, no row and no mate');
  const roundTrip = deserialize(serialize(s))!;
  assert(roundTrip.enemies.every(e => e.echo === null && defOf(e) === T[e.type]) && JSON.parse(serialize(s)).player.echo === null, 'and a save with echo null loads authored, every one');
  // the golden path is the other half of this check: it runs on a fresh state, and `npm run verify` runs it first.
  assert(Object.keys(T).every(id => defOf({ type: id }) === T[id]), 'defOf of an enemy with no row is the species\' own row, by identity');
}

console.log(`\n${checks} checks passed`);

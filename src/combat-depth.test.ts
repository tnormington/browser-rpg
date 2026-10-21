// HOM-138: the three things that give a fight a shape beyond "press the cooldowns, then spam Strike".
//   1. an upkeep buff you pay for and must not let lapse (Battle Fury),
//   2. proc windows you did not choose and have to answer (sim/procs.ts),
//   3. two leaps that take you out of a slam without taking you out of the fight (Sidestep, Charge).
// The last section is the one that keeps the other two honest: whatever the windows are worth, they are worth a
// bounded amount, because the ladder's gear gates (golden-path's cave matrix) are tuned against the kit without them.
// Run with `npm run verify`.
import { GameState, Input, NO_INPUT, TICK_DT, createState, step } from './sim';
import { ABILITIES, ENEMY_TYPES, powerForLevel } from './sim/data';
import { PROCS, procOn } from './sim/procs';
import { BUFFS, buffedOutgoing } from './sim/consumables';
import { playerStatuses } from './sim/status';
import { refreshPlayerStats } from './sim/combat';
import { refreshGearStats } from './sim/inventory';
import { xpForLevel } from './sim/xp';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);

const tick = (s: GameState, i: Partial<Input> = {}) => step(s, { ...NO_INPUT, ...i });
const run = (s: GameState, seconds: number, i: Partial<Input> = {}) => {
  for (let n = 0; n < Math.round(seconds / TICK_DT); n++) tick(s, i);
};
const hasEvent = (s: GameState, pred: (e: GameState['events'][number]) => boolean) => s.events.some(pred);
/** Everything raised over a stretch of ticks: `s.events` is cleared every step, so a check that spans seconds has to collect. */
function collect(s: GameState, seconds: number, i: Partial<Input> = {}) {
  const out: GameState['events'][number][] = [];
  for (let n = 0; n < Math.round(seconds / TICK_DT); n++) { tick(s, i); out.push(...s.events); }
  return out;
}
const slotOf = (name: string) => ABILITIES.findIndex(a => a.name === name);
const SLOT = {
  strike: slotOf('Strike'), crushing: slotOf('Crushing Blow'), throw: slotOf('Serrated Throw'), cleave: slotOf('Cleave'),
  fury: slotOf('Battle Fury'), sidestep: slotOf('Sidestep'), charge: slotOf('Charge'),
};

/** A quiet world at a level, with one named enemy parked at the origin and the player a step off it. */
function arena(seed: number, level: number, type = 'boar', gap = 2.5) {
  const s = createState(seed);
  for (const e of s.enemies) { e.state = 'dead'; e.hp = 0; e.respawnIn = 1e9; e.deadFor = 99; }
  const p = s.player;
  p.combat.xp = xpForLevel(level); p.combat.level = level; p.unlocked = level;
  p.learned = ABILITIES.filter(a => a.trainer).map(a => a.name); // bought from every trainer: these checks are about what the abilities do
  refreshPlayerStats(s, true);
  p.energy = p.maxEnergy;
  const e = s.enemies.find(x => x.type === type)!;
  e.state = 'idle'; e.respawnIn = 0; e.hp = e.maxHp = 1e8; e.attackCd = 1e9; e.x = e.spawnX = 0; e.z = e.spawnZ = 0;
  p.x = 0; p.z = gap;
  tick(s, { clickEnemy: e.id });
  return { s, p, e };
}

/** Force a window open without waiting on the dice: the rules it then obeys are what these checks are about. */
const giveProc = (s: GameState, id: string) => { s.player.procs.push({ id, left: PROCS[id].duration }); };
/** Read through a call so an assert on the count does not narrow the next one to a literal. */
const openWindows = (s: GameState) => s.player.procs.length;

// ---------------------------------------------------------------------------
section('Every proc names a real ability, and opens only once its owner has it');
{
  for (const [id, def] of Object.entries(PROCS)) {
    assert(slotOf(def.ability) >= 0, `${def.name} opens ${def.ability}, which is an ability in sim/data.ts`);
    assert(def.chance > 0 && def.chance < 1 && def.duration > 0 && def.mult >= 1, `${id}: a real chance, a real window and a reward that is never a punishment`);
  }
  // a level-1 character has Strike and nothing else: a swing must not offer them a Crushing Blow they cannot press
  const { s } = arena(10, 1);
  tick(s, { attack: true }); // the key is a toggle: pressed once, the swings run on their own
  const quiet = collect(s, 60);
  assert(s.player.procs.length === 0 && !quiet.some(e => e.t === 'proc'), 'a minute of swinging at level 1 opens no window: every proc names an ability that is still locked');

  // ...and at a level that has them, the same swinging does. Bare-handed against a dummy is the thinnest case there is -
  // no weapon speed, no bleed ticking - so the stretch is long enough that the count is the rate and not one roll of the dice.
  const up = arena(11, 6);
  tick(up.s, { attack: true });
  const swung = collect(up.s, 300);
  const opened = swung.filter(e => e.t === 'proc' && e.on).length, swings = swung.filter(e => e.t === 'swing').length;
  assert(opened > 0, `at level 6, where the abilities they name are open, ${swings} bare-handed swings throw ${opened} window${opened === 1 ? '' : 's'}`);
}

// ---------------------------------------------------------------------------
section('A window answers the cooldown and the energy, and is gone once spent');
{
  const { s, p, e } = arena(20, 6);
  tick(s, { ability: SLOT.crushing });
  run(s, 1.6);
  const onCd = p.cd[SLOT.crushing];
  assert(onCd > 3, `Crushing Blow is well inside its cooldown (${onCd.toFixed(1)}s left)`);
  p.procs = []; // whatever the swings in those seconds threw: this half of the check is the rule without a window
  tick(s, { ability: SLOT.crushing });
  assert(hasEvent(s, x => x.t === 'fail' && x.reason === 'cooldown'), 'and pressing it there is refused, as it always was');

  giveProc(s, 'opening');
  assert(procOn(p, SLOT.crushing) === 'opening' && procOn(p, SLOT.strike) === null, 'the window sits on the ability it names and on no other');
  p.energy = 0; // the proc pays for it: no energy at all is enough
  const hp0 = e.hp;
  tick(s, { ability: SLOT.crushing });
  assert(hasEvent(s, x => x.t === 'cast' && x.slot === SLOT.crushing) && e.hp < hp0, 'inside the window it fires at once, with the cooldown still running and no energy in the bar');
  assert(p.energy < 1, 'and it costs nothing: the bar holds only the trickle the tick itself regenerated');
  assert(p.procs.length === 0 && hasEvent(s, x => x.t === 'proc' && x.id === 'opening' && !x.on), 'the window is spent by the cast that used it');
  assert(p.cd[SLOT.crushing] > 5, 'the cooldown it skipped starts again from the top: a window is one cast, not free rein');

  // what it is worth: the same blow, inside and outside a window, against the same target from the same seed
  const blow = (withProc: boolean) => {
    const a = arena(21, 6);
    a.p.energy = a.p.maxEnergy;
    if (withProc) giveProc(a.s, 'opening');
    const before = a.e.hp;
    tick(a.s, { ability: SLOT.crushing });
    return before - a.e.hp;
  };
  const plain = blow(false), procced = blow(true);
  assert(Math.abs(procced / plain - PROCS.opening.mult) < 0.12, `a procced Crushing Blow lands ${PROCS.opening.mult}x harder (${plain} -> ${procced})`);
}

// ---------------------------------------------------------------------------
section('A window runs out if it is not answered');
{
  const { s, p } = arena(30, 6);
  giveProc(s, 'opening');
  run(s, PROCS.opening.duration - 0.5);
  assert(openWindows(s) === 1, 'it is still open a moment before its time');
  const lapsed = collect(s, 1);
  assert(openWindows(s) === 0 && lapsed.some(x => x.t === 'proc' && x.id === 'opening' && !x.on), 'and gone a moment after: an offer not taken is an offer lost');

  giveProc(s, 'opening');
  const shown = playerStatuses(p);
  assert(shown.length === 1 && shown[0].key === 'proc:opening' && shown[0].proc === true && shown[0].total === PROCS.opening.duration,
    'the unit frame carries it, marked as a window rather than a buff, with its own clock');

  // dying closes every window, as it takes every buff
  p.hp = 1;
  p.recap = [];
  s.enemies.find(e => e.type === 'boar')!.attackCd = 0;
  for (let n = 0; n < 300 && !p.dead; n++) { p.hp = 1; tick(s); }
  assert(p.dead && p.procs.length === 0, 'death closes every window it finds open');
}

// ---------------------------------------------------------------------------
section('Battle Fury: an upkeep you pay for, not a cooldown you forget');
{
  const a = ABILITIES[SLOT.fury], def = BUFFS.battle_fury;
  assert(a.kind === 'guard' && a.range === 0 && a.cooldown === 0 && a.cost > 0 && a.unlockLevel === 5,
    'it takes no target, has no cooldown and does cost energy: the only thing stopping you is the energy and the global cooldown');
  assert(def && def.duration > 0 && (def.damageDealt ?? 1) > 1, `the buff it puts up is a damage buff with a clock (${def.duration}s, ${def.damageDealt}x)`);

  const { s, p, e } = arena(40, 6);
  const energy0 = p.energy;
  tick(s, { ability: SLOT.fury });
  assert(p.buffs.some(b => b.id === 'battle_fury') && p.energy === energy0 - a.cost && p.gcd > 0, 'pressing it puts the buff up, spends the energy and takes a global cooldown');
  assert(Math.abs(buffedOutgoing(p) - def.damageDealt!) < 1e-9, 'and everything the player deals is multiplied by it while it is up');

  // the same thirty seconds of Strike, with the buff held up and without it. The buff is placed rather than cast, so
  // the two runs press the same button on the same ticks and draw the same random numbers: the only difference is the buff.
  const bout = (fury: boolean) => {
    const k = arena(41, 6);
    if (fury) k.p.buffs = [{ id: 'battle_fury', left: 1e9 }];
    let dealt = 0;
    for (let n = 0; n < 30 / TICK_DT; n++) {
      k.p.energy = k.p.maxEnergy;
      const before = k.e.hp;
      tick(k.s, { ability: k.p.gcd > 0.05 ? null : SLOT.strike });
      dealt += before - k.e.hp;
    }
    return dealt;
  };
  const bare = bout(false), under = bout(true);
  assert(Math.abs(under / bare - def.damageDealt!) < 0.02, `thirty seconds of Strike under Battle Fury deals ${def.damageDealt}x as much (${bare} -> ${under})`);

  // it lapses, and nothing reminds you but the clock on your own frame
  const gone = collect(s, def.duration + 0.2);
  assert(!p.buffs.some(b => b.id === 'battle_fury') && buffedOutgoing(p) === 1 && gone.some(x => x.t === 'buff' && x.id === 'battle_fury' && !x.on),
    'left alone it runs out, and the damage goes back to what it was');
  // ...and it can be put straight back up: no cooldown is what makes it upkeep
  p.energy = p.maxEnergy;
  tick(s, { ability: SLOT.fury });
  assert(p.buffs.some(b => b.id === 'battle_fury'), 'and it can go straight back up');
  assert(e.hp > 0, 'the dummy survived the section');
}

// ---------------------------------------------------------------------------
section('Sidestep: out of the circle without leaving the fight');
{
  const a = ABILITIES[SLOT.sidestep];
  assert(a.kind === 'dash' && a.offGcd === true && a.dash?.away === true && a.damage > 0,
    'off the global cooldown, it leaps away from the target, and it hits on the way');

  const { s, p, e } = arena(50, 18, 'ogre', 3);
  const gap0 = Math.hypot(p.x - e.x, p.z - e.z), hp0 = e.hp, gcd0 = p.gcd;
  tick(s, { ability: SLOT.sidestep });
  const gap1 = Math.hypot(p.x - e.x, p.z - e.z);
  assert(gap1 > gap0 + a.dash!.gap * 0.4, `it puts real ground between you (${gap0.toFixed(1)} -> ${gap1.toFixed(1)} units)`);
  assert(e.hp < hp0, 'and the target is cut as you go: the leap is not a lost turn');
  assert(p.gcd <= gcd0 + 1e-9 && hasEvent(s, x => x.t === 'dash' && x.slot === SLOT.sidestep), 'it takes no global cooldown, and says where it moved you from and to');
  assert(p.autoAttack, 'the swings keep going: you leapt, you did not disengage');

  // what it is for: a slam is a circle round the enemy, and one Sidestep clears it
  const heavy = ENEMY_TYPES.ogre.heavy!;
  assert(gap0 < heavy.radius && gap1 > heavy.radius, `standing in the Boulder Slam's ${heavy.radius}-unit circle, one press is out of it (${gap1.toFixed(1)} units)`);

  // a net is the one thing it cannot answer: it holds your feet, which is the whole of a leap
  const held = arena(51, 18, 'ogre', 3);
  held.p.root = { left: 3, total: 3, name: 'Bola' };
  const where = { x: held.p.x, z: held.p.z };
  tick(held.s, { ability: SLOT.sidestep });
  assert(hasEvent(held.s, x => x.t === 'fail' && x.reason === 'rooted') && held.p.x === where.x && held.p.z === where.z,
    'netted, it refuses and says so, and you do not move');
  assert(held.p.cd[SLOT.sidestep] === 0 && held.p.energy === held.p.maxEnergy, 'and a refusal costs nothing');
}

// ---------------------------------------------------------------------------
section('Charge: the way back in');
{
  const a = ABILITIES[SLOT.charge];
  assert(a.kind === 'dash' && a.dash?.away === false && a.minRange !== undefined && a.minRange > 3,
    'it closes on the target, and refuses from inside melee: there would be nothing to cover');

  const { s, p, e } = arena(60, 20, 'ogre', 16);
  const hp0 = e.hp;
  tick(s, { ability: SLOT.charge });
  const gap = Math.hypot(p.x - e.x, p.z - e.z);
  assert(gap < a.dash!.gap + ENEMY_TYPES.ogre.radius + 1, `sixteen units become ${gap.toFixed(1)}: you are on it`);
  assert(e.hp < hp0 && p.autoAttack, 'and you open with a hit, swings armed');

  const close = arena(61, 20, 'ogre', 3);
  const at = { x: close.p.x, z: close.p.z };
  tick(close.s, { ability: SLOT.charge });
  assert(hasEvent(close.s, x => x.t === 'fail' && x.reason === 'range') && close.p.x === at.x && close.p.z === at.z,
    'pressed in their face it is refused, and you stay where you stand');

  // the pair is the point: out of the slam, then straight back on. The ogre is pinned where it stands, because what
  // is being measured is the player's two presses, not how far a chase closes between them.
  const pair = arena(62, 20, 'ogre', 3);
  tick(pair.s, { ability: SLOT.sidestep });
  const out = Math.hypot(pair.p.x - pair.e.x, pair.p.z - pair.e.z);
  for (let n = 0; n < 3; n++) { pair.e.x = 0; pair.e.z = 0; tick(pair.s); }
  pair.e.x = 0; pair.e.z = 0;
  tick(pair.s, { ability: SLOT.charge });
  const back = Math.hypot(pair.p.x - pair.e.x, pair.p.z - pair.e.z);
  assert(out > ENEMY_TYPES.ogre.heavy!.radius && back < 4, `Sidestep out to ${out.toFixed(1)} units, Charge back in to ${back.toFixed(1)}: the slam is dodged and the fight is not`);
}

// ---------------------------------------------------------------------------
section('What the windows are worth: enough to feel, not enough to move a gear gate');
{
  /**
   * The same bot and the same seed, with the proc layer on and off: priority rotation against a target that cannot
   * die, which is what golden-path's retune row measures and what the cave matrix's fights are tuned against.
   */
  const dps = (level: number, weapon: string | null, procs: boolean) => {
    const defs = Object.values(PROCS), was = defs.map(d => d.chance);
    if (!procs) for (const d of defs) d.chance = 0;
    try {
      const { s, p, e } = arena(70, level);
      if (weapon) { p.equipment.weapon = weapon; refreshGearStats(s); }
      const ready = (slot: number) => p.combat.level >= ABILITIES[slot].unlockLevel && (p.cd[slot] === 0 || procOn(p, slot)) && p.energy >= (procOn(p, slot) ? 0 : ABILITIES[slot].cost);
      let dealt = 0;
      for (let n = 0; n < 120 / TICK_DT; n++) {
        e.hp = 1e8; e.attackCd = 1e9; e.x = 0; e.z = 0; p.x = 0; p.z = 2.5; p.outOfCombat = 0;
        const ab = p.gcd > 0.05 ? null
          : ready(SLOT.crushing) ? SLOT.crushing
          : ready(SLOT.throw) && !e.bleed ? SLOT.throw
          : ready(SLOT.strike) ? SLOT.strike : null;
        tick(s, { ability: ab });
        dealt += 1e8 - e.hp;
      }
      return dealt / 120;
    } finally { defs.forEach((d, i) => { d.chance = was[i]; }); }
  };
  for (const [name, level, weapon] of [['level 6, Forgemaster\'s Blade', 6, 'forged_blade'], ['level 10, steel sword', 10, 'steel_sword']] as [string, number, string][]) {
    const off = dps(level, weapon, false), on = dps(level, weapon, true);
    const gain = on / off - 1;
    console.log(`  ${name}: ${off.toFixed(1)} -> ${on.toFixed(1)} damage/s with the windows taken (+${(gain * 100).toFixed(1)}%)`);
    assert(gain > 0.015, `${name}: answering every window is worth having (+${(gain * 100).toFixed(1)}%)`);
    assert(gain < 0.08, `${name}: ...and never worth so much that it stands in for the gear the ladder asks you to go and get (+${(gain * 100).toFixed(1)}%)`);
  }
}

console.log(`\nAll ${checks} proc, upkeep and leap checks passed.`);

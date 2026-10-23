// HOM-194: how far off the first 41 levels are priced from the character a level has. docs/combat-99.md 10.1's method on the rows as authored: src/echo-bot.ts on the real sim, one decision a tick,
// procs off, pull after pull with the cooldowns carried across the rest between them (steady state: the first pull of a run is dropped unless the character died in it), the player at the row's own level
// in the gear the row was priced against. `bare` is no talent (what the rows were priced for, and what bench/combat.mjs --rotation old fights as); a talented arm is a player of that level with every
// point talentPoints() has given spent greedily in the order of a build, tier by tier. The reference build is ECHO_TALENTS.build; `--builds all` runs the six orders and two capped at the capstones. The six abilities are
// not in it (they open at 50), and neither are the buttons below 41 (Colossus Blow, Battle Fury, Guard).
//   npx tsx bench/base-band.ts [--rows marsh_hog,rune_golem] [--gear priced|ladder] [--n 8] [--seeds 3] [--builds ref|all] [--dodge all|none] [--json out.json]
// trash: Pummel a wind-up, step out of a slam (--dodge all), Cleave a camp; elite, rare and boss: the same with Second Wind. --dodge none is the bench as it was (HOM-98), --dodge all the HOM-125 "perfect dodge" column.
import { writeFileSync } from 'node:fs';
import { Base, Kit, Policy, pulls, withoutProcs } from '../src/echo-bot';
import { ENEMY_TYPES } from '../src/sim/data';
import { ECHO_TALENTS, ROLES, armourLine, weaponLine } from '../src/sim/echo';
import { TREE_IDS, TreeId } from '../src/sim/talents';

const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const rows = arg('rows', Object.keys(ENEMY_TYPES).join(',')).split(','), n = Number(arg('n', '8')), seeds = Number(arg('seeds', '3')), ladder = arg('gear', 'priced') === 'ladder', dodge = arg('dodge', 'all') as 'all' | 'none';
const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
const median = (v: number[]) => { const s = v.filter(x => !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? (s[s.length >> 1] + s[(s.length - 1) >> 1]) / 2 : NaN; };

/**
 * The weapon and armour a row is priced against. From 17 it is the line (docs/world-design.md 3.3: 36 + 2.6 (L - 16), 60 + 2.2 (L - 16)); the rows through 16 "stand as shipped" and were measured in the
 * steel set (Warden's Edge 28, armour 50), the starter ground below the cave in the bronze one (3, 13). `ladder` is the gear a committed player is really wearing (3.3: 28/50 from 11, 40/68 from 16, 50/68
 * from 20, 58/86 from 24, 72/86 from 27, 80/100 from 32), which sits 12 % either side of the line.
 */
const STEPS: [number, number, number][] = [[32, 80, 100], [27, 72, 86], [24, 58, 86], [20, 50, 68], [16, 40, 68], [7, 28, 50], [1, 3, 13]];
export function gearFor(level: number, steps = ladder): Base {
  if (steps) { const s = STEPS.find(([from]) => level >= from)!; return { weapon: s[1], armour: s[2] }; }
  if (level >= 17) return { weapon: weaponLine(level), armour: armourLine(level) };
  return level >= 7 ? { weapon: 28, armour: 50 } : { weapon: 3, armour: 13 };
}

const policyFor = (type: string): Policy => ROLES[type] === 'trash' ? { pummel: true, dodge, cleave: !!ENEMY_TYPES[type].pack } : { pummel: true, dodge, heal: true, saveHeal: true };
const ORDERS: TreeId[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map(o => o.map(i => TREE_IDS[i]));
const REF = [...ECHO_TALENTS.build], tag = (o: readonly TreeId[], tiers = '') => o.map(t => t[0].toUpperCase()).join('') + tiers;
// the reference first, then (--builds all) the other five orders, then the two the greedy fill hides: two trees to their capstones and no further (tiers 0-4: 18 points a tree), which is what a player who stops short of
// "past the capstone" (tier 5, which a greedy fill takes before it touches the second tree) has, led by Fury and led by Bulwark
const builds: { name: string; kit: Kit }[] = [{ name: tag(REF), kit: { talents: true, gear: false, build: REF } }];
if (arg('builds', 'ref') === 'all') {
  for (const o of ORDERS.filter(o => o.join() !== REF.join())) builds.push({ name: tag(o), kit: { talents: true, gear: false, build: o } });
  for (const o of [ORDERS[0], ORDERS[2]]) builds.push({ name: tag(o, '/4'), kit: { talents: true, gear: false, build: o, maxTier: 4 } });
}
/** `ttk` and `loss` are the fights' means, `loop` is `ttk + 5 + loss / 3` (3.10's rest: the 5 s delay, then 3 % of health a second); `died` counts the runs that lost the character at least once. */
export interface Cell { ttk: number; loss: number; net: number; loop: number; died: number; fights: number }
function cell(type: string, kit: Kit): Cell {
  const level = ENEMY_TYPES[type].level, base = gearFor(level);
  const runs = Array.from({ length: seeds }, (_, i) => pulls(type, level, { kit, policy: policyFor(type) }, i + 1, n, { base }));
  const steady = runs.flatMap(r => r.slice(1)), used = steady.length >= seeds ? steady : runs.flat(); // a character that dies on its first pull has no steady state: its first pulls are what there is
  return { ttk: mean(used.map(x => x.ttk)), loss: mean(used.map(x => x.loss)), net: mean(used.map(x => x.net)), loop: mean(used.map(x => x.ttk + x.gap)), died: runs.filter(r => r.some(x => x.died)).length, fights: used.length };
}

const bands: [string, number, number][] = [['1-11', 1, 11], ['12-24', 12, 24], ['25-32', 25, 32], ['33-41', 33, 41]];
const kind = (type: string) => { const r = ROLES[type]; return r === 'trash' ? 'trash' : r === 'boss' ? 'boss' : 'elite'; }; // an elite and a rare are one column: 11 of the 15 rows the card asks about are both
interface Row { type: string; level: number; role: string; gear: Base; bare: Cell; talents: Record<string, Cell> }
const out: Row[] = [];
const f1 = (c: Cell) => `${c.ttk.toFixed(1)}/${c.loss.toFixed(0)}/${c.net.toFixed(0)}/${c.died}`;

withoutProcs(() => {
  console.log(`${seeds} seeds x ${n} pulls, steady state, gear ${ladder ? 'ladder' : 'priced'}, dodge ${dodge}, builds ${builds.map(b => b.name).join(' | ')}; cells are ttk s / gross loss % / net % / runs that died`);
  console.log('row'.padEnd(17), 'L'.padStart(3), 'role'.padEnd(6), 'gear'.padEnd(7), 'bare'.padEnd(19), builds[0].name.padEnd(19), 'ttk x'.padStart(6), 'loss x'.padStart(7), 'loop x'.padStart(7));
  for (const type of rows.filter(r => ENEMY_TYPES[r]).sort((a, b) => ENEMY_TYPES[a].level - ENEMY_TYPES[b].level)) {
    const level = ENEMY_TYPES[type].level, g = gearFor(level), bare = cell(type, { talents: false, gear: false }), talents = Object.fromEntries(builds.map(b => [b.name, cell(type, b.kit)]));
    out.push({ type, level, role: ROLES[type], gear: g, bare, talents });
    const t = talents[builds[0].name];
    console.log(type.padEnd(17), String(level).padStart(3), ROLES[type].padEnd(6), `${Math.round(g.weapon)}/${Math.round(g.armour)}`.padEnd(7), f1(bare).padEnd(19), f1(t).padEnd(19),
      (bare.ttk / t.ttk).toFixed(2).padStart(6), (bare.loss / t.loss).toFixed(2).padStart(7), (bare.loop / t.loop).toFixed(2).padStart(7));
  }
  console.log('\nband x kind, the reference build: median (min-max) of bare / talents on the row\'s ttk, gross loss and loop; mean net of each arm. Rows where the bare character died are in the median at their first pulls.');
  for (const [name, lo, hi] of bands) for (const k of ['trash', 'elite', 'boss']) {
    const r = out.filter(x => x.level >= lo && x.level <= hi && kind(x.type) === k);
    if (!r.length) continue;
    const t = (x: Row) => x.talents[builds[0].name], sp = (f: (x: Row) => number) => { const v = r.map(f).filter(Number.isFinite); return `${median(v).toFixed(2)} (${Math.min(...v).toFixed(2)}-${Math.max(...v).toFixed(2)})`; };
    console.log(name.padEnd(6), k.padEnd(6), String(r.length).padStart(2), 'rows | ttk x', sp(x => x.bare.ttk / t(x).ttk), '| loss x', sp(x => x.bare.loss / t(x).loss), '| loop x', sp(x => x.bare.loop / t(x).loop),
      '| net', mean(r.map(x => x.bare.net)).toFixed(0) + '% ->', mean(r.map(x => t(x).net)).toFixed(0) + '%', '| died', r.reduce((a, x) => a + x.bare.died, 0) + ' -> ' + r.reduce((a, x) => a + t(x).died, 0), `of ${r.length * seeds}`);
  }
  if (builds.length > 1) {
    console.log('\nband x kind x build order: median bare / talents ttk (loop in brackets)');
    for (const [name, lo, hi] of bands) for (const k of ['trash', 'elite', 'boss']) {
      const r = out.filter(x => x.level >= lo && x.level <= hi && kind(x.type) === k);
      if (r.length) console.log(name.padEnd(6), k.padEnd(6), builds.map(b => `${b.name} ${median(r.map(x => x.bare.ttk / x.talents[b.name].ttk)).toFixed(2)} (${median(r.map(x => x.bare.loop / x.talents[b.name].loop)).toFixed(2)})`).join('  '));
    }
  }
  const j = arg('json', '');
  if (j) writeFileSync(j, JSON.stringify(out, null, 1));
});

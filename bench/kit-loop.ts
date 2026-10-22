// HOM-192: what an Echo fight is to a player with the kit the level gives them, pull after pull, on the real sim (src/echo-bot.ts, one decision a tick, procs off).
// bench/combat.mjs starts every fight with every cooldown ready (its default --spacing 0), which is the first pull of a session and not the loop a player is in; this carries cooldowns, energy and
// buffs from one pull to the next across the rest between them (the 5 s delay, then 3 % of health a second, which is how docs/combat-99.md 3.10 counts a kill's loop).
//   npx tsx bench/kit-loop.ts [--types rune_golem] [--levels 50,60,75,90] [--arms bare,talents,full] [--n 16] [--seeds 3] [--echo 0] [--build bulwark,fury,hunt] [--gear line|echo] [--walk S] [--price new|old]
// arms: bare (no talent), talents (the character an Echo is priced against), full (talents and the six abilities); none/tnone/fullnone answer nothing, tdodge/tpummel/fulldodge/fullpummel one answer only.
import { characters, linePrice, pulls, withoutProcs } from '../src/echo-bot';
import { ECHO_TALENTS } from '../src/sim/echo';
import type { TreeId } from '../src/sim/talents';

const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
const types = arg('types', 'rune_golem').split(','), levels = arg('levels', '50,60,75,90').split(',').map(Number), n = Number(arg('n', '16')), seeds = Number(arg('seeds', '3'));
const setting = Number(arg('echo', '0')) as -3 | 0 | 3, build = arg('build', ECHO_TALENTS.build.join(',')).split(',') as TreeId[], walk = Number(arg('walk', '0')), gear = arg('gear', 'line') === 'echo'; // line: the model's weapon and armour; echo: the real blades and Echohide above 48
if (arg('price', 'new') === 'old') linePrice(); // an Echo as it was before HOM-192: the line's health
const who = characters(gear, build);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s[s.length >> 1] + s[(s.length - 1) >> 1]) / 2 : NaN; };

withoutProcs(() => {
  console.log(`echo ${setting >= 0 ? '+' : ''}${setting}, ${seeds} seeds x ${n} pulls, build ${build.join('>')}, walk ${walk}s; ttk = first swing to last kill, loop = ttk + the rest`);
  console.log('type'.padEnd(14), 'L'.padStart(3), 'arm'.padEnd(9), 'first'.padStart(6), 'steady'.padStart(7), 'med'.padStart(6), 'loss%'.padStart(6), 'loop'.padStart(6), 'died');
  for (const type of types) for (const E of levels) for (const name of arg('arms', 'bare,talents,full').split(',')) {
    const runs = Array.from({ length: seeds }, (_, i) => pulls(type, E, who[name], i + 1, n, { setting, walk }));
    const first = runs.map(r => r[0].ttk), steady = runs.flatMap(r => r.slice(1)), died = runs.filter(r => r.some(x => x.died)).length;
    console.log(type.padEnd(14), String(E).padStart(3), name.padEnd(9), mean(first).toFixed(1).padStart(6), mean(steady.map(x => x.ttk)).toFixed(1).padStart(7), median(steady.map(x => x.ttk)).toFixed(1).padStart(6),
      mean(steady.map(x => x.loss)).toFixed(1).padStart(6), mean(steady.map(x => x.ttk + x.gap)).toFixed(1).padStart(6), died);
  }
});
// HOM-192: the road to 99 in hours, from the fight and not from the 40 s the pace model assumed. For each character, the loop of a trash, an elite and a boss Echo (a golem, a Spire Warden, Vael: pull
// after pull, cooldowns carried, the rest to full health counted: bench/kit-loop.ts) at a ladder of levels, weighted by the pull mix (85 / 12 / 3, docs/world-design.md 3.1), then the kills a level
// takes (`kpl`, docs/combat-99.md 1.3) summed from 41 to 98. A pair pays 0.88 a body and is a loop per body. Nothing here is a person: `--person` is the bible's 1.3 on the fighting, which
// is the 40 s against the bot's 33.6 (3.7). The walk between pulls is `--walk` seconds a kill (0 by default: what the bible's 24 s loop already holds).
//   npx tsx bench/road-hours.ts --price new|old [--arms talents,full] [--walk 0] [--person 1.19] [--gear line|echo]
// `--price old` puts the HP back to the line's (what an Echo was before HOM-192), so the difference between the two runs is the whole of that change.
import { characters, linePrice, pulls, withoutProcs } from '../src/echo-bot';
import { kpl } from '../src/sim/enemy-xp';

const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
if (arg('price', 'new') === 'old') linePrice(); // the line's health: no talent in the price
const arms = arg('arms', 'talents,full').split(','), walk = Number(arg('walk', '0')), person = Number(arg('person', '1.19')), gear = arg('gear', 'echo') === 'echo';
const levels = [42, 48, 50, 56, 60, 64, 70, 75, 80, 86, 90, 96, 99];
const MIX = { trash: 0.85, elite: 0.12, boss: 0.03 }, XP = { trash: 1, elite: 3, boss: 10 }, PAIR_XP = 0.88, PAIR_FROM = 84, MEAN_XP = 1.51;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const who = characters(gear);

/** Mean seconds of one kill's loop: a pair is two bodies for one loop. */
function loop(type: string, E: number, arm: string, n: number, seeds: number, bodies: number) {
  const runs = Array.from({ length: seeds }, (_, i) => pulls(type, E, who[arm], i + 1, n, { walk: walk * bodies }));
  const steady = runs.flatMap(r => r.slice(1));
  return { t: mean(steady.map(x => x.ttk + x.gap)) / bodies, died: runs.filter(r => r.some(x => x.died)).length };
}

withoutProcs(() => {
  console.log(`price ${arg('price', 'new')}, gear ${gear ? 'echo' : 'line'}, walk ${walk}s, person x${person}; per level: trash / elite / boss loop (s), the mean kill, seconds per mean kill's XP`);
  for (const arm of arms) {
    const at: { L: number; sec: number }[] = [];
    let deaths = 0;
    console.log(`\n== ${arm}`);
    for (const L of levels) {
      const pair = L >= PAIR_FROM, t = loop('rune_golem', L, arm, 9, 2, pair ? 2 : 1), e = loop('spire_warden', L, arm, 5, 2, 1), b = loop('archmage_vael', L, arm, 4, 1, 1);
      deaths += t.died + e.died + b.died;
      const meanLoop = MIX.trash * t.t + MIX.elite * e.t + MIX.boss * b.t + walk, xp = MIX.trash * (pair ? PAIR_XP : 1) + MIX.elite * XP.elite + MIX.boss * XP.boss;
      const sec = meanLoop / xp * MEAN_XP; // seconds a mean kill's worth of XP takes
      at.push({ L, sec });
      console.log(`  ${String(L).padStart(3)}: ${t.t.toFixed(1).padStart(5)} ${e.t.toFixed(1).padStart(6)} ${b.t.toFixed(1).padStart(6)}   mean ${meanLoop.toFixed(1).padStart(5)}   ${sec.toFixed(1).padStart(5)} s a mean kill`);
    }
    const secAt = (L: number) => { const i = at.findIndex(a => a.L >= L); if (i <= 0) return at[Math.max(0, i)].sec; const a = at[i - 1], b = at[i]; return a.sec + (b.sec - a.sec) * (L - a.L) / (b.L - a.L); };
    const hours = (from: number, to: number) => { let h = 0; for (let L = from; L < to; L++) h += kpl(L) * secAt(L) * person / 3600; return h; };
    console.log(`  hours (a person at x${person}): 41-60 ${hours(41, 60).toFixed(1)}, 60-80 ${hours(60, 80).toFixed(1)}, 80-90 ${hours(80, 90).toFixed(1)}, 90-99 ${hours(90, 99).toFixed(1)}, **41-99 ${hours(41, 99).toFixed(1)}**${deaths ? `  (${deaths} cells with a death)` : ''}`);
  }
});

// Tier 6 and the top of the leather ladder, before the sim has them: starmetal and Crownbreaker beside stormiron and adamant (so the ladder reads as a ladder), the tier-6 fallback, then
// Marsh-hide, Thornhide and Moorhide gloves and boots. The items are injected at runtime, so this checks the looks alone. HUD hidden, daylight.
// Shots -> bench/shots/tier6/. Run `npx vite build` first.   node bench/tier6.mjs
import { spawnSync } from 'node:child_process';
const items = [
  ...['helm:head', 'chestplate:chest', 'greaves:legs', 'blade:weapon'].flatMap(p => { const [n, slot] = p.split(':'); return [['starmetal_' + n, slot, 6], ['adamant_' + n, slot, 5], ['stormiron_' + n, slot, 5], ['t6_' + n, slot, 6]]; }),
  ['crownbreaker', 'weapon', 6],
  ...['marshhide:3', 'thornhide:4', 'moorhide:5', 'hide:1', 'wolfskin:2'].flatMap(p => { const [n, t] = p.split(':'); return [[n + '_gloves', 'hands', +t], [n + '_boots', 'feet', +t]]; }),
];
const MK = `for (const [id, slot, tier] of ${JSON.stringify(items)}) __debug.items[id] = { name: id, slot, stack: 1, dropWeight: 0, value: 1, tier, desc: '', stats: {} };`;
const eq = o => `{ const e=__debug.sim.player.equipment; Object.assign(e, ${JSON.stringify({ weapon: null, head: null, chest: null, legs: null, hands: null, feet: null, ...o })}); } await wait(300);`;
const metal = n => eq({ weapon: n + '_blade', head: n + '_helm', chest: n + '_chestplate', legs: n + '_greaves' });
// camera relative to the player: r out along the facing, side across it, h up; looks at a point `ah` above the player
const cam = (r, side, h, ah) => `{ const p=__debug.sim.player, f=p.facing, y=p.y||0; cam([p.x+Math.sin(f)*${r}+Math.cos(f)*${side}, y+${h}, p.z+Math.cos(f)*${r}-Math.sin(f)*${side}], [p.x, y+${ah}, p.z]); } await wait(200);`;
const full = [cam(3.6, 0.5, 1.3, 1.0), cam(-3.6, 0.5, 1.3, 1.0), cam(1.4, 0.5, 1.9, 1.7), cam(-1.4, 0.4, 1.8, 1.5)];
const low = [cam(3.4, 0.3, 1.2, 0.95), cam(1.5, 0.9, 0.5, 0.2), cam(1.5, -0.8, 1.0, 0.9), cam(-3.4, 0.3, 1.2, 0.95)];
const setup = `look(0,0,0,0.1,4); __debug.sim.player.facing=0.6; const v=__debug.view; v.weather.set('clear',true); v.skyClock=0; const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st); ${MK} await wait(600);`;
const scripts = [];
const add = (set, views, first) => views.forEach((v, j) => scripts.push(`${first && j === 0 ? setup : ''} ${j === 0 ? set : ''} ${v}`));
add(metal('starmetal'), full, true);              // st-0..3 front, back, helm close, back close
add(metal('stormiron'), full.slice(0, 2));        // st-4..5 the metal below it
add(metal('adamant'), full.slice(0, 2));          // st-6..7
add(metal('t6'), full.slice(0, 2));               // st-8..9 the fallback
add(eq({ weapon: 'crownbreaker', head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves' }), full.slice(0, 2)); // st-10..11
for (const n of ['marshhide', 'thornhide', 'moorhide', 'hide', 'wolfskin']) add(eq({ hands: n + '_gloves', feet: n + '_boots', legs: 'iron_greaves' }), low); // st-12.. four views a set
const r = spawnSync('node', ['bench/look.mjs', 'st', ...scripts], { stdio: 'inherit', env: { ...process.env, SHOTS: 'tier6' } });
process.exit(r.status ?? 1);

// HOM-177: the seven Echo blades (tiers 7 and 8) and the level-48 leather, each in the character's hand, before the sim has the items. Starmetal's Crownbreaker stands first as the yardstick
// the blades have to be a step past. The items are injected at runtime, so this checks the looks alone. HUD hidden, daylight.
// Shots -> bench/shots/echo-blades/eb-<n>.png: per blade a full-body front, the hand close-up and the back; then the leather in four views. Run `npx vite build` first.   node bench/echo-blades.mjs
import { spawnSync } from 'node:child_process';
const blades = [1, 2, 3, 4, 5, 6, 7].map(n => ['echo_blade_' + n, 'weapon', n <= 3 ? 7 : 8]);
const items = [
  ...blades, ['crownbreaker', 'weapon', 6], ['t7_blade', 'weapon', 7], ['t8_blade', 'weapon', 8],
  ['echohide_gloves', 'hands', 5], ['echohide_boots', 'feet', 5], ['moorhide_gloves', 'hands', 5], ['moorhide_boots', 'feet', 5],
  ['starmetal_helm', 'head', 6], ['starmetal_chestplate', 'chest', 6], ['starmetal_greaves', 'legs', 6],
];
const MK = `for (const [id, slot, tier] of ${JSON.stringify(items)}) __debug.items[id] = { name: id, slot, stack: 1, dropWeight: 0, value: 1, tier, desc: '', stats: {} };`;
const eq = o => `{ const e=__debug.sim.player.equipment; Object.assign(e, ${JSON.stringify({ weapon: null, head: null, chest: null, legs: null, hands: null, feet: null, ...o })}); } await wait(300);`;
const cam = (r, side, h, ah) => `{ const p=__debug.sim.player, f=p.facing, y=p.y||0; cam([p.x+Math.sin(f)*${r}+Math.cos(f)*${side}, y+${h}, p.z+Math.cos(f)*${r}-Math.sin(f)*${side}], [p.x, y+${ah}, p.z]); } await wait(200);`;
const body = { head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves' };
const bladeViews = [cam(3.6, 0.5, 1.3, 1.0), cam(1.9, 1.5, 1.5, 1.35), cam(-3.6, 0.5, 1.3, 1.0)];
const low = [cam(3.4, 0.3, 1.2, 0.95), cam(1.5, 0.9, 0.5, 0.2), cam(1.5, -0.8, 1.0, 0.9), cam(-3.4, 0.3, 1.2, 0.95)];
const setup = `look(0,0,0,0.1,4); __debug.sim.player.facing=0.6; const v=__debug.view; v.weather.set('clear',true); v.skyClock=0; const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st); ${MK} await wait(600);`;
const scripts = [];
const add = (set, views, first) => views.forEach((v, j) => scripts.push(`${first && j === 0 ? setup : ''} ${j === 0 ? set : ''} ${v}`));
add(eq({ weapon: 'crownbreaker', ...body }), bladeViews, true);
for (const [id] of blades) add(eq({ weapon: id, ...body }), bladeViews);
add(eq({ weapon: 't7_blade', ...body }), bladeViews.slice(0, 2));
add(eq({ weapon: 't8_blade', ...body }), bladeViews.slice(0, 2));
add(eq({ hands: 'moorhide_gloves', feet: 'moorhide_boots', legs: 'starmetal_greaves' }), low);
add(eq({ hands: 'echohide_gloves', feet: 'echohide_boots', legs: 'starmetal_greaves' }), low);
const r = spawnSync('node', ['bench/look.mjs', 'eb', ...scripts], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SHOTS: 'echo-blades' } });
process.exit(r.status ?? 1);

// Hands and feet in daylight, HUD hidden, free camera: for each set a full-body front, a feet close-up, a hands close-up and the back.
// Shots -> bench/shots/leather/lt-<n>.png (4 views per set, sets in order: bare, hide, wolfskin, wolfskin + greaves, marsh-hide, thornhide, moorhide). Run `npm run build` first.   node bench/leather.mjs
import { spawnSync } from 'node:child_process';
const set = (h, f, l) => `{ const e=__debug.sim.player.equipment; e.hands=${h}; e.feet=${f}; e.legs=${l}; } await wait(250);`;
// camera relative to the player: r out along the facing, side across it, h up; looks at a point `ah` above the player
const cam = (r, side, h, ah) => `{ const p=__debug.sim.player, f=p.facing, y=p.y||0; cam([p.x+Math.sin(f)*${r}+Math.cos(f)*${side}, y+${h}, p.z+Math.cos(f)*${r}-Math.sin(f)*${side}], [p.x, y+${ah}, p.z]); } await wait(200);`;
const views = [cam(3.4, 0.3, 1.2, 0.95), cam(1.5, 0.9, 0.5, 0.2), cam(1.5, -0.8, 1.0, 0.9), cam(-3.4, 0.3, 1.2, 0.95)];
const sets = [set('null', 'null', 'null'), set("'hide_gloves'", "'hide_boots'", 'null'), set("'wolfskin_gloves'", "'wolfskin_boots'", 'null'), set("'wolfskin_gloves'", "'wolfskin_boots'", "'iron_greaves'"),
  // HOM-107: the regional pairs, each over the greaves of the metal it is worn with
  set("'marshhide_gloves'", "'marshhide_boots'", "'adamant_greaves'"), set("'thornhide_gloves'", "'thornhide_boots'", "'stormiron_greaves'"), set("'moorhide_gloves'", "'moorhide_boots'", "'stormiron_greaves'")];
const setup = `look(0,0,0,0.1,4); __debug.sim.player.facing=0.6; const v=__debug.view; v.weather.set('clear',true); v.skyClock=0; const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st); await wait(600);`;
const scripts = [];
sets.forEach((s, i) => views.forEach((v, j) => scripts.push(`${i === 0 && j === 0 ? setup : ''} ${j === 0 ? s : ''} ${v}`)));
const r = spawnSync('node', ['bench/look.mjs', 'lt', ...scripts], { stdio: 'inherit', env: { ...process.env, SHOTS: 'leather' } });
process.exit(r.status ?? 1);

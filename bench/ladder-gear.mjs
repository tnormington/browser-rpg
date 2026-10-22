// HOM-176: the ladder's gear as the sim now has it, on the character. bench/echo-blades.mjs checks the looks with items it injects; this one injects nothing, so it proves the real item ids
// (`echo_blade_1..7`, `echohide_gloves`, `echohide_boots`) are what the renderer finds, and that each is a weapon or a piece in the sim's own table. Each shot is preceded by what the sim says it is.
// Shots -> bench/shots/ladder-gear/lg-<n>.png: per blade a full-body front and the hand close-up; then the leather. Run `npx vite build` first.   node bench/ladder-gear.mjs
import { spawnSync } from 'node:child_process';
const eq = o => `{ const it=__debug.items, e=__debug.sim.player.equipment; Object.assign(e, ${JSON.stringify({ weapon: null, head: null, chest: null, legs: null, hands: null, feet: null, ...o })}); await wait(300);
  return Object.values(e).filter(Boolean).map(id => id + ' ' + (it[id].stats.damage ?? '') + (it[id].stats.armor ?? '') + ' t' + it[id].tier).join(', '); }`;
const cam = (r, side, h, ah) => `{ const p=__debug.sim.player, f=p.facing, y=p.y||0; cam([p.x+Math.sin(f)*${r}+Math.cos(f)*${side}, y+${h}, p.z+Math.cos(f)*${r}-Math.sin(f)*${side}], [p.x, y+${ah}, p.z]); } await wait(200);`;
const body = { head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves' };
const setup = `look(0,0,0,0.1,4); __debug.sim.player.facing=0.6; const v=__debug.view; v.weather.set('clear',true); v.skyClock=0; const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st); await wait(600);`;
const scripts = [];
const shot = (o, views, first) => views.forEach((v, j) => scripts.push(`${first && j === 0 ? setup : ''} const worn = await (async () => ${eq(o)})(); ${v} return worn;`));
shot({ weapon: 'crownbreaker', ...body }, [cam(3.6, 0.5, 1.3, 1.0)], true);
for (const n of [1, 4, 7]) shot({ weapon: `echo_blade_${n}`, ...body }, [cam(3.6, 0.5, 1.3, 1.0), cam(1.9, 1.5, 1.5, 1.35)]);
shot({ hands: 'echohide_gloves', feet: 'echohide_boots', legs: 'starmetal_greaves' }, [cam(3.4, 0.3, 1.2, 0.95), cam(1.5, 0.9, 0.5, 0.2)]);
const r = spawnSync('node', ['bench/look.mjs', 'lg', ...scripts], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SHOTS: 'ladder-gear' } });
process.exit(r.status ?? 1);

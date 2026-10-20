// A barrow mouth at play distance and close, front on. Shots -> bench/shots/barrow/. Run `npm run build` first.   node bench/barrow.mjs
import { spawnSync } from 'node:child_process';
const find = `const d=__debug, s=d.sim; const w=s.enemies.find(e=>e.type==='barrow_wight'); const reg=d.world.regionAt(w.x,w.z); const rz=(reg.footprint.reduce((a,f)=>a+f.z0,0)/reg.footprint.length+reg.footprint.reduce((a,f)=>a+f.z1,0)/reg.footprint.length)/2;
  const bs=reg.obstacles.filter(o=>o.kind==='barrow').sort((a,b)=>Math.hypot(a.x-w.x,a.z-w.z)-Math.hypot(b.x-w.x,b.z-w.z)); const o=bs[0]; const dir=o.z>rz?-1:1; window.__b={o,dir}; look(o.x, o.z+dir*14, 0, 0.1, 6); s.enemies.length=0; await wait(800);`;
const at = (back, h, aim = 1.2, side = 0) => `{ const {o,dir}=window.__b; cam([o.x+${side}, ${h}, o.z+dir*(o.r*0.8+${back})], [o.x, ${aim}, o.z]); } await wait(300);`;
const sky = `const v=__debug.view; v.weather.set('clear',true); const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st);`;
const scripts = [sky + find + at(9, 1.8), at(5, 1.5), at(14, 2.6, 1.5, 4), at(22, 4, 1.5, -5)];
const r = spawnSync('node', ['bench/look.mjs', 'bw', ...scripts], { stdio: 'inherit', env: { ...process.env, SHOTS: 'barrow' } });
process.exit(r.status ?? 1);

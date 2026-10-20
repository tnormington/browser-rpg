// The player riding at speed: the destrier's feet (and the rider's boots in the stirrups) mid-gallop, from the side. Shots -> bench/shots/ride/. Run `npm run build` first.   node bench/ride.mjs
import { spawnSync } from 'node:child_process';
// the game camera orbits the rider: yaw a quarter turn off the direction of travel gives a clean side view; enemies are cleared so nothing dismounts him
const setup = `look(0,0,0,0.1,4); const s=__debug.sim, p=s.player; s.enemies.length=0; p.hp=p.maxHp=99999; if(!p.mounts.includes('destrier')) p.mounts.push('destrier'); p.mounted=true; p.facing=0; const e=p.equipment; e.hands='wolfskin_gloves'; e.feet='wolfskin_boots'; e.legs='iron_greaves';
  const v=__debug.view; v.weather.set('clear',true); const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st);
  await wait(2500);`;
const shot = (yaw, pitch, dist, w = 70) => `{ const v=__debug.view; v.yaw=${yaw}; v.pitch=${pitch}; v.distance=${dist}; __debug.sim.enemies.length=0; } await wait(${w});`;
// standing in the saddle (free camera, so the horse is not chasing it): the stirrups from each side, close, then the rear three-quarter
const at = (x, y, z, ax, ay, az) => `{ const p=__debug.sim.player; cam([p.x+(${x}), p.y+(${y}), p.z+(${z})], [p.x+(${ax}), p.y+(${ay}), p.z+(${az})]); } await wait(200);`;
const scripts = [setup + at(3.2, 1.0, 0, 0, 1.0, 0), at(-3.2, 1.0, 0, 0, 1.0, 0), at(2.0, 0.9, 0.3, 0.5, 1.2, -0.1), at(-2.0, 0.9, 0.3, -0.5, 1.2, -0.1), at(2.6, 1.3, -2.6, 0, 1.2, 0), at(0, 1.2, 4, 0, 1.2, 0)];
const r = spawnSync('node', ['bench/look.mjs', 'ride', ...scripts], { stdio: 'inherit', env: { ...process.env, SHOTS: 'ride' } });
process.exit(r.status ?? 1);

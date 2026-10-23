// HOM-203: every weapon on the character, side by side, so silhouette can be judged rather than asserted. One shot per weapon in the sim's own table
// (a close three-quarter of the blade in hand, the same body each time), then all of them tiled into one contact sheet.
// Shots -> bench/shots/weapons/w-<n>.png, sheet -> bench/shots/weapons/sheet.png. Run `npx vite build` first.   node bench/weapon-ladder.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';
const IDS = ['copper_sword', 'bronze_sword', 'rusty_blade', 'iron_sword', 'steel_sword', 'forged_blade', 'warden_edge', 'adamant_blade', 'marrows_edge', 'stormiron_blade', 'rotroot_edge', 'starmetal_blade', 'crownbreaker',
  ...Array.from({ length: 7 }, (_, i) => `echo_blade_${i + 1}`)];
const body = { head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves' };
const eq = id => `{ const e=__debug.sim.player.equipment; Object.assign(e, ${JSON.stringify({ weapon: id, hands: null, feet: null, ...body })}); await wait(300); }`;
const cam = `{ const p=__debug.sim.player, f=p.facing, y=p.y||0; cam([p.x+Math.sin(f)*3.2+Math.cos(f)*1.0, y+1.5, p.z+Math.cos(f)*3.2-Math.sin(f)*1.0], [p.x, y+1.25, p.z]); } await wait(200);`;
const setup = `look(0,0,0,0.1,4); __debug.sim.player.facing=0.6; const v=__debug.view; v.weather.set('clear',true); v.skyClock=0; const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st); await wait(600);`;
const scripts = IDS.map((id, i) => `${i === 0 ? setup : ''} await (async () => ${eq(id)})(); ${cam}`);
const r = spawnSync('node', ['bench/look.mjs', 'w', ...scripts], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SHOTS: 'weapons' } });
if (r.status) process.exit(r.status);
const dir = new URL('./shots/weapons/', import.meta.url);
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1552 } });
const cells = IDS.map((id, i) => `<figure><img src="w-${i}.png"><figcaption>${id}</figcaption></figure>`).join('');
writeFileSync(new URL('sheet.html', dir), `<style>body{margin:0;background:#111;display:grid;grid-template-columns:repeat(5,320px);gap:0}figure{margin:0;position:relative;height:388px;overflow:hidden}img{width:853px;margin:-40px 0 0 -253px}figcaption{position:absolute;left:6px;top:4px;font:14px monospace;color:#ccd;text-shadow:0 0 3px #000}</style>${cells}`);
await page.goto(new URL('sheet.html', dir).href);
await page.waitForLoadState('load');
await page.screenshot({ path: fileURLToPath(new URL('sheet.png', dir)) });
await browser.close();
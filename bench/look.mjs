// Slot close-ups: serves the existing dist/ (run `npm run build` first) and screenshots one or more scripted views.
//   node bench/look.mjs <out-prefix> "<js run in the page>" [more "<js>" ...]
// A script that `return`s a value has it printed (used by quest2.sh to assert on the DOM).
// The page script sees window.__debug ({ view, sim, scene, step }). Helper: look(x, z, yaw, pitch, dist) frames the camera
// on a world point by teleporting the player there (the camera orbits the player); wait(ms) lets animation play.
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [prefix, ...scripts] = process.argv.slice(2);
const out = join(root, 'bench', 'shots', process.env.SHOTS ?? 'slots'); // SHOTS=cave -> bench/shots/cave
mkdirSync(out, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4174, open: false } });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error(m.text()); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.addScriptTag({ content: `
  window.wait = ms => new Promise(r => setTimeout(r, ms));
  window.look = (x, z, yaw = 0, pitch = 0.3, dist = 6) => {
    const d = window.__debug, p = d.sim.player;
    d.view.debugCam = null;
    p.x = x; p.z = z; d.view.yaw = yaw; d.view.pitch = pitch; d.view.distance = dist; d.step(); d.step();
  };
  // until(() => cond, ms): polls the real-time loop; false on timeout
  window.until = async (cond, ms = 15000) => { const t0 = performance.now(); while (!cond()) { if (performance.now() - t0 > ms) return false; await window.wait(30); } return true; };
  // near(type, dist, yaw, pitch, camDist): stand dist from the first live enemy of that type (on the side the camera yaw looks from), target it, orbit-look at it. Player cannot die.
  window.near = (type, dist = 6, yaw = 0, pitch = 0.25, camDist = 5, side = 0) => {
    const d = window.__debug, s = d.sim, e = s.enemies.find(x => x.type === type && x.state !== 'dead');
    s.player.hp = s.player.maxHp = 99999;
    window.look(e.x + Math.sin(yaw) * dist, e.z + Math.cos(yaw) * dist, yaw + side, pitch, camDist); // side swings the camera off the player-enemy line so the player does not hide the enemy
    s.targetId = e.id; return e;
  };
  // free camera: cam([x,y,z], [lookX,lookY,lookZ]); cam(null) returns to the orbit camera
  window.cam = (pos, at) => { window.__debug.view.debugCam = pos ? { pos, at } : null; };` });
for (let i = 0; i < scripts.length; i++) {
  const ret = await page.evaluate(`(async () => { ${scripts[i]} })()`);
  if (ret !== undefined) console.log(`[${i}]`, typeof ret === 'string' ? ret : JSON.stringify(ret)); // a script may `return` what it observed
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${prefix}-${i}.png`) });
}
await browser.close(); await server.close();

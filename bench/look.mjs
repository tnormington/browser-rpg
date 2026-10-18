// Slot close-ups: serves the existing dist/ (run `npm run build` first) and screenshots one or more scripted views.
//   node bench/look.mjs <out-prefix> "<js run in the page>" [more "<js>" ...]
// The page script sees window.__debug ({ view, sim, scene, step }). Helper: look(x, z, yaw, pitch, dist) frames the camera
// on a world point by teleporting the player there (the camera orbits the player); wait(ms) lets animation play.
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [prefix, ...scripts] = process.argv.slice(2);
const out = join(root, 'bench', 'shots', 'slots');
mkdirSync(out, { recursive: true });
const server = await preview({ root, logLevel: 'error', preview: { port: 4174, open: false } });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', String(e)));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error(m.text()); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.addScriptTag({ content: `
  window.wait = ms => new Promise(r => setTimeout(r, ms));
  window.look = (x, z, yaw = 0, pitch = 0.3, dist = 6) => {
    const d = window.__debug, p = d.sim.player;
    p.x = x; p.z = z; d.view.yaw = yaw; d.view.pitch = pitch; d.view.distance = dist; d.step(); d.step();
  };
  // free camera: cam([x,y,z], [lookX,lookY,lookZ]); cam(null) returns to the orbit camera
  window.cam = (pos, at) => { window.__debug.view.debugCam = pos ? { pos, at } : null; };` });
for (let i = 0; i < scripts.length; i++) {
  await page.evaluate(`(async () => { ${scripts[i]} })()`);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${prefix}-${i}.png`) });
}
await browser.close(); await server.close();

// HOM-190: the edge of the world, from inside each region looking out, in clear weather and in the murk of fog, and what it costs. The acceptance test is the
// board's own sentence: an edge must not read as "a uniform wall of stones".
//   node bench/edges-look.mjs      (COST_ONLY=1 skips the shots)  Shots -> bench/shots/edges/ (SHOTS=<dir> to put a before/after pair elsewhere); frame cost to stdout.
// The game has one night and no hour of day: "day and dusk" is here the clear night and the fog (weather.ts), the two views that most differ in how far an edge reads.
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', process.env.SHOTS ?? 'edges');
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 4189 } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
await page.goto('http://localhost:4189/?debug=1&weather=clear');
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.evaluate(() => { document.querySelectorAll('body > *:not(canvas)').forEach(n => { n.style.visibility = 'hidden'; }); });

const wait = ms => new Promise(r => setTimeout(r, ms));
async function shoot(name, x, z, yaw, pitch = 0.2, dist = 9) {
  await page.evaluate(([x, z, yaw, pitch, dist]) => {
    const d = window.__debug, p = d.sim.player;
    p.hp = p.maxHp = 99999; p.x = x; p.z = z;
    d.view.debugCam = null; d.view.yaw = yaw + Math.PI; d.view.pitch = pitch; d.view.distance = dist;
    for (let i = 0; i < 6; i++) d.step();
  }, [x, z, yaw, pitch, dist]);
  await wait(1500);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: join(out, `${name}.png`) });
}

// [name, x, z, yaw]: standing a few paces inside a face with the camera looking out at it. yaw 0 looks toward +z, out of the north face (the camera sits behind the player).
const PI = Math.PI;
const SPOTS = [
  ['hale-north', 0, 25, 0], ['hale-south', 8, -24, PI], ['hale-west', -25, 6, -PI / 2], ['hale-east', 25, -2, PI / 2],
  ['road-north', 300, 60, 0], ['road-south', 300, -45, PI],
  ['saltmarrow-shore', 925, 40, PI / 2], ['saltmarrow-west', 845, -40, -PI / 2],
  ['fen-west', 815, 400, -PI / 2], ['fen-east', 935, 400, PI / 2],
  ['wood-south', 880, 1070, 0], ['wood-west', 815, 1040, -PI / 2],
  ['barrow-north', 1400, 945, PI], ['barrow-south', 1400, 1070, 0],
  ['moor-east', 1972, 1010, PI / 2], ['moor-south', 1900, 1072, 0],
  ['waste-west', 1920, 485, -PI / 2], ['waste-east', 2042, 485, PI / 2],
  ['spire-west', 1920, 20, -PI / 2], ['spire-south', 1960, -55, PI],
];
for (const weather of process.env.COST_ONLY ? [] : ['clear', 'fog']) {
  await page.evaluate(w => window.__debug.view.weather.set(w, true), weather);
  for (const [name, x, z, yaw] of SPOTS) await shoot(`${name}-${weather}`, x, z, yaw);
}
await page.evaluate(() => window.__debug.view.weather.set('clear', true));

// frame cost: GPU ms, the median of 40 frames with gl.finish() each, edges drawn and hidden in alternating blocks (other work on the machine moves the
// absolute numbers around, so only the difference within a spot means anything), standing in Hale, on the Greywater Road and in the Thornwood
const cost = await page.evaluate(async () => {
  const d = window.__debug, v = d.view, gl = d.renderer.getContext(), p = d.sim.player;
  const time = async n => {
    const t = [];
    for (let i = 0; i < n; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const t0 = performance.now(); v.post.render(d.scene); gl.finish(); t.push(performance.now() - t0);
    }
    return t.sort((a, b) => a - b)[n >> 1];
  };
  const row = {};
  for (const [name, x, z, yaw] of [['hale', 0, 25, 0], ['road', 300, 60, 0], ['wood', 880, 1070, 0]]) {
    p.x = x; p.z = z; v.debugCam = null; v.yaw = yaw + Math.PI; v.pitch = 0.2; v.distance = 9;
    for (let i = 0; i < 6; i++) d.step();
    await time(30);
    const on = [], off = [];
    for (let r = 0; r < 4; r++) { v.edges.group.visible = true; on.push(await time(40)); v.edges.group.visible = false; off.push(await time(40)); }
    v.edges.group.visible = true;
    const t0 = performance.now(); for (let i = 0; i < 200; i++) { v.edges.at.x = NaN; v.edges.update(x, z); } // a refill, forced
    const med = a => a.sort((m, n) => m - n)[a.length >> 1];
    row[name] = { edges: +med(on).toFixed(2), none: +med(off).toFixed(2), cost: +(med(on) - med(off)).toFixed(2), refillMs: +((performance.now() - t0) / 200).toFixed(3) };
  }
  return row;
});console.log('gpu ms', JSON.stringify(cost));
console.log('edges', JSON.stringify(await page.evaluate(() => window.__debug.view.edges?.stats)));
await browser.close(); await server.close();

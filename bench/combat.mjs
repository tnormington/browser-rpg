// Combat frame trace: drives a real fight against the Cave Brute through the real game loop (keyboard in, rAF out) and records
// every frame's time, plus every GL program link and compile that happens, so a hitch can be matched to its cause.
//   node bench/combat.mjs [--tag before|after] [--secs 25] [--quality high|low] [--skip-build]
// Writes bench/shots/combat-<tag>.json and combat-<tag>.png; prints worst frames, link events and the frames they landed in.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const tag = opt('tag', 'run'), secs = Number(opt('secs', 25)), quality = opt('quality', 'high');
const shots = join(root, 'bench', 'shots'); mkdirSync(shots, { recursive: true });
if (!process.argv.includes('--skip-build')) await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'error', preview: { port: 4175, open: false } });
const browser = await chromium.launch({ args: ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', String(e)));
// Time every program link (the stall a fresh shader costs the render thread) before the game loads.
await page.addInitScript(() => {
  window.__links = [];
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const orig = C.prototype.linkProgram;
    C.prototype.linkProgram = function (p) { const t = performance.now(); orig.call(this, p); window.__links.push({ at: t, ms: performance.now() - t }); };
  }
});
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.evaluate(q => window.__debug.view.setQuality(q), quality);
const setup = await page.evaluate(() => {
  const d = window.__debug, s = d.sim, p = s.player, e = s.enemies.find(x => x.type === 'brute' && x.state !== 'dead');
  p.hp = p.maxHp = 99999; p.combat.level = 12; // every ability unlocked; the player cannot die during the trace
  p.x = e.x + 4; p.z = e.z + 4; d.view.yaw = 0.8; d.view.pitch = 0.45; d.view.distance = 9; d.step(); d.step();
  s.targetId = e.id;
  return { brute: [e.x, e.z] };
});
await page.evaluate(() => new Promise(res => { let n = 0; const f = () => (++n >= 60 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); })); // idle warm-up: nothing combat-related has rendered yet
await page.evaluate(() => { window.__links.length = 0; });
await page.evaluate(({ secs }) => {
  const d = window.__debug, frames = [], ev = [];
  window.__trace = { frames, ev, t0: performance.now() };
  let last = 0;
  const loop = now => {
    if (last) frames.push({ t: now - window.__trace.t0, dt: now - last, rings: d.scene.children.filter(c => c.geometry && c.geometry.type === 'TorusGeometry').length, programs: d.renderer.info.programs.length, events: d.sim.events.map(e => e.t + (e.slot ?? '')).join(',') });
    last = now;
    if (now - window.__trace.t0 < secs * 1000) requestAnimationFrame(loop); else window.__trace.done = true;
  };
  requestAnimationFrame(loop);
}, { secs });
const keys = ['Digit1', 'Digit2', 'Digit4', 'Digit3', 'Digit5', 'Digit6'];
const t0 = Date.now(); let i = 0;
while (Date.now() - t0 < secs * 1000) {
  await page.keyboard.press(i % 7 === 0 ? 'KeyR' : keys[i % keys.length]);
  if (i === 3) await page.screenshot({ path: join(shots, `combat-${tag}.png`) });
  i++; await page.waitForTimeout(350);
}
await page.waitForFunction(() => window.__trace.done);
const out = await page.evaluate(() => ({ frames: window.__trace.frames, t0: window.__trace.t0, links: window.__links }));
await browser.close(); await server.close();
const f = out.frames, dts = f.map(x => x.dt).sort((a, b) => a - b), q = p => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))];
const links = out.links.map(l => ({ t: l.at - out.t0, ms: l.ms }));
const stats = { setup, frames: f.length, mean: dts.reduce((a, b) => a + b, 0) / dts.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: dts.at(-1), over2x: f.filter(x => x.dt > 2 * q(0.5)).length, links: links.length, linkMs: links.reduce((a, b) => a + b.ms, 0) };
writeFileSync(join(shots, `combat-${tag}.json`), JSON.stringify({ stats, links, frames: f }));
console.log(JSON.stringify(stats));
const worst = [...f].sort((a, b) => b.dt - a.dt).slice(0, 12);
console.table(worst.map(x => ({ t: x.t.toFixed(0), dt: x.dt.toFixed(1), rings: x.rings, programs: x.programs, events: x.events.slice(0, 40), linkInFrame: links.filter(l => l.t > x.t - x.dt - 5 && l.t <= x.t).map(l => l.ms.toFixed(1)).join('/') })));
console.log('links:', links.map(l => `${l.t.toFixed(0)}ms:${l.ms.toFixed(1)}`).join(' '));

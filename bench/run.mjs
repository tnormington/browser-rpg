// Headless render harness: builds the game, serves it with `vite preview`, drives real Chromium and records
// screenshots, renderer.info and frame timing at each ?stress=N level.
//   npm run bench                       full sweep (1,5,20,100,500)
//   npm run bench -- --levels 1,5       choose levels
//   npm run shot                        one screenshot at 1x, no timing sweep
//   --headed  visible window     --frames N  timing window (default 300)     --skip-build
//   --at x,z,yaw   stand there before measuring, e.g. the cave's hollow: --at -20,-55,-0.8 --tag cave   (the player cannot die while it runs)
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const levels = opt('levels', '1,5,20,100,500').split(',').map(Number);
const frames = Number(opt('frames', 300));
const shotOnly = process.argv.includes('--shot-only');
const headed = process.argv.includes('--headed');
const WINDOW_CAP_MS = 20000; // timing window ends at `frames` frames or this wall time, whichever is first
const VIEW = { width: 1280, height: 720 };
const query = opt('query', ''); // extra URL params appended to the dev-server URL
const quality = opt('quality', 'high'); // high | low
const at = opt('at', '')?.split(',').map(Number); // x,z,yaw
const tag = opt('tag', '');     // suffix for output file names, e.g. --tag noshadow
const shots = join(root, 'bench', 'shots');
mkdirSync(shots, { recursive: true });

if (!process.argv.includes('--skip-build')) await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'error', preview: { port: 4173, open: false } });
const base = server.resolvedUrls.local[0];

// Real GPU if there is one; no frame-rate cap so frame time shows cost, not the 60 Hz vsync ceiling.
const args = ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'];
async function launch() {
  const o = { headless: !headed, args };
  try { return { browser: await chromium.launch(o), how: 'playwright chromium' }; }
  catch (e) {
    console.error(`bundled chromium unavailable (${String(e.message).split('\n')[0]}); falling back to installed Chrome`);
    return { browser: await chromium.launch({ ...o, channel: 'chrome' }), how: 'installed Chrome (channel chrome)' };
  }
}
const { browser, how } = await launch();

async function measure(level) {
  const page = await browser.newPage({ viewport: VIEW });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(`${base}?debug=1&stress=${level}${query ? '&' + query : ''}`);
  await page.waitForFunction(() => window.__debug, null, { timeout: 180000 });
  const loadMs = Date.now() - t0;
  await page.evaluate(() => window.__debug.view.modelsReady); // models stream in: wait for every slot to settle before measuring
  await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {}); // dismiss the controls overlay
  await page.evaluate(q => window.__debug.view.setQuality(q), quality);
  if (at) await page.evaluate(([x, z, yaw]) => {
    const d = window.__debug, p = d.sim.player;
    p.hp = p.maxHp = 99999; p.x = x; p.z = z; d.view.yaw = yaw; d.view.pitch = 0.45; d.view.distance = 9; d.step(); d.step();
  }, at);
  // warm-up: a stable run of frames (shader compile, first uploads) before measuring anything
  await page.evaluate(() => new Promise(res => { let n = 0; const f = () => (++n >= 60 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const label = `stress-${level}x${headed ? '-headed' : ''}${tag ? '-' + tag : ''}`;
  if (shotOnly) { await page.screenshot({ path: join(shots, `${label}.png`) }); await page.close(); return { label, level }; }

  const raw = await page.evaluate(({ frames, cap }) => new Promise(done => {
    const ts = [], start = performance.now();
    let last = 0;
    const loop = now => {
      if (last) ts.push(now - last);
      last = now;
      if (ts.length >= frames || performance.now() - start > cap) done(ts); else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }), { frames, cap: WINDOW_CAP_MS });
  const s = [...raw].sort((a, b) => a - b), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const stats = { n: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), worst: s[s.length - 1] };

  const info = await page.evaluate(() => {
    const d = window.__debug, r = d.renderer, i = r.info, sim = d.sim, gl = r.getContext();
    let objects = 0, meshes = 0;
    d.scene.traverse(o => { objects++; if (o.isMesh) meshes++; });
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const time = (n, fn) => { const t = performance.now(); for (let k = 0; k < n; k++) fn(); return (performance.now() - t) / n; };
    const render = () => d.view.post.render(d.scene); // the real frame path: composer on high, plain renderer on low
    render();
    // renderer.info resets before the main pass, so shadow-pass draws are not in `calls`; count the whole frame separately.
    i.autoReset = false; i.reset(); render();
    const total = { calls: i.render.calls, triangles: i.render.triangles };
    i.autoReset = true; render();
    const out = {
      total,
      entities: { enemies: sim.enemies.length, nodes: sim.nodes.length, objects, meshes },
      worldSide: 60 * Math.sqrt(d.stress),
      calls: i.render.calls, triangles: i.render.triangles,
      geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    };
    // Disambiguators on the unchanged scene: CPU cost of each stage in isolation.
    out.simStepMs = time(30, () => d.step());                      // one 30 Hz sim tick
    out.drawCpuMs = time(30, () => d.view.draw(d.sim, 0.5));       // interpolation + animation + render() CPU time
    out.renderCpuMs = time(30, render);                            // renderer.render() submit time only
    out.renderGpuMs = time(30, () => { render(); gl.finish(); });  // submit + wait for the GPU to finish
    // Per-pass cost on `high`: GPU time with one pass disabled, minus the full-stack time (renders are noisy: treat < 0.1 ms as zero).
    if (d.view.quality === 'high') {
      const passes = d.view.post.composer.passes, byName = { ao: d.view.post.ao, bloom: d.view.post.bloom };
      const gpu = () => time(30, () => { render(); gl.finish(); });
      out.passGpuMs = { full: gpu() };
      for (const [name, p] of Object.entries(byName)) { p.enabled = false; out.passGpuMs[`no_${name}`] = gpu(); p.enabled = true; }
      byName.ao.enabled = byName.bloom.enabled = false; out.passGpuMs.no_ao_bloom = gpu(); byName.ao.enabled = byName.bloom.enabled = true;
      d.view.setQuality('low'); out.passGpuMs.low = gpu(); d.view.setQuality('high');
    }
    // Upper bound with frustum culling off: every object submitted.
    const fc = new Map();
    d.scene.traverse(o => { fc.set(o, o.frustumCulled); o.frustumCulled = false; });
    render();
    out.unculled = { calls: i.render.calls, triangles: i.render.triangles, renderCpuMs: time(10, render), renderGpuMs: time(10, () => { render(); gl.finish(); }) };
    d.scene.traverse(o => { o.frustumCulled = fc.get(o); });
    return out;
  });
  await page.screenshot({ path: join(shots, `${label}.png`) });
  await page.close();
  return { label, level, loadMs, stats, ...info, errors };
}

const results = [];
try { for (const l of levels) { console.error(`measuring ${l}x ...`); results.push(await measure(l)); } }
finally { await browser.close(); await server.close(); }

if (!shotOnly) {
  const meta = { browser: how, headless: !headed, viewport: VIEW, frameWindow: `${frames} frames (cap ${WINDOW_CAP_MS / 1000}s)`, date: new Date().toISOString() };
  writeFileSync(join(shots, headed ? 'results-headed.json' : `results${tag ? '-' + tag : ''}.json`), JSON.stringify({ meta, results }, null, 2));
  console.log(JSON.stringify({ meta, results }));
  const f = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d));
  console.error(`\n${meta.browser}, ${meta.headless ? 'headless' : 'headed'}, GPU: ${results[0]?.gpu}`);
  console.error('frame times in ms; sim = one 30Hz tick; drawCpu = view.draw(); gpu = render()+gl.finish(); unc = frustum culling off\n');
  console.table(results.map(r => ({
    x: r.level, enemies: r.entities.enemies, nodes: r.entities.nodes, objs: r.entities.objects, world: `${f(r.worldSide, 0)}²`,
    calls: r.calls, tris: r.triangles, 'tot.calls': r.total.calls, 'tot.tris': r.total.triangles, geo: r.geometries, tex: r.textures, prog: r.programs,
    mean: f(r.stats.mean), p50: f(r.stats.p50), p95: f(r.stats.p95), worst: f(r.stats.worst),
    sim: f(r.simStepMs), drawCpu: f(r.drawCpuMs), gpu: f(r.renderGpuMs), 'unc.calls': r.unculled.calls, 'unc.gpu': f(r.unculled.renderGpuMs), heapMB: f(r.heapMB, 0),
  })));
}

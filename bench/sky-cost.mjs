// What the sky dome costs, at the framing where it is worst: the camera pointed up so the dome fills most of the view.
// Renders the same frame with the dome on and off and reports GPU ms for each, at both quality settings.
//   node bench/sky-cost.mjs            (run `npm run build` first)
import { preview } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await preview({ root, logLevel: 'error', preview: { port: 4175, open: false } });
const browser = await chromium.launch({ args: ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});

const out = await page.evaluate(async () => {
  const d = window.__debug, v = d.view, gl = d.renderer.getContext();
  v.debugCam = { pos: [0, 2, 20], at: [6, 34, 8] };          // pointed up: the dome is most of the frame
  const dome = d.scene.children.find(o => o.renderOrder === 1000);
  // median GPU ms over n frames, gl.finish() each so the number is the GPU's and not the queue's
  const time = async n => {
    const t = [];
    for (let i = 0; i < n; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const t0 = performance.now();
      v.post.render(d.scene); gl.finish();
      t.push(performance.now() - t0);
    }
    return t.sort((a, b) => a - b)[n >> 1].toFixed(2);
  };
  const row = {};
  for (const q of ['high', 'low']) {
    v.setQuality(q);
    await time(40); // warm up: this quality's programs compile on its first frame
    dome.visible = true; const on = await time(60);
    dome.visible = false; const off = await time(60);
    dome.visible = true;
    row[q] = { on: +on, off: +off, dome: +(on - off).toFixed(2) };
  }
  return row;
});
console.log(JSON.stringify(out));
await browser.close(); await server.close();

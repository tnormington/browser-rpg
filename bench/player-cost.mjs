// What the player's figure costs, measured as GPU ms with it drawn and with it hidden, at both quality settings, from
// a camera three units in front of it so the figure is most of the frame -- its worst case, not a play framing.
// Run `npm run build` first; run it once per candidate player.glb to get a number either side of decimation.
//   node bench/player-cost.mjs
//
// Measured for HOM-202 phase 5, four runs, decimated (7,970 triangles with gear) against not (17,622):
//
//   decimated    high on 4.8 off 4.1 -> 0.7 ms     low on 2.4 off 2.0 -> 0.4 ms
//   undecimated  high on 4.2 off 3.8 -> 0.4 ms     low on 3.6 off 3.5 -> 0.1 ms
//   undecimated  high on 6.0 off 5.6 -> 0.4 ms     low on 2.4 off 2.4 -> 0.0 ms
//   undecimated  high on 6.1 off 5.3 -> 0.8 ms     low on 3.8 off 2.3 -> 1.5 ms
//
// The figure costs between 0 and 1.5 ms whichever it is: the run-to-run spread is wider than the difference, so at
// this scale a 17,000-triangle player is not measurable against the frame and decimation buys no frame time. It is
// still what ships, for the 364 KB of file it saves and because one figure is not the case that worries -- a crowd
// of NPCs on the same rig would be.
import { preview } from 'vite';
import { UNCAPPED_ARGS, launchBrowser } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await preview({ root, logLevel: 'error', preview: { port: 4177, open: false } });
const browser = await launchBrowser({ args: UNCAPPED_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});

const out = await page.evaluate(async () => {
  const d = window.__debug, v = d.view, gl = d.renderer.getContext();
  const p = d.sim.player;
  v.debugCam = { pos: [p.x, 1.2, p.z + 3], at: [p.x, 1.1, p.z] };   // the figure filling the frame: its worst case
  let tris = 0;
  v.player.traverse(o => { if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3; });
  const time = async n => {
    const t = [];
    for (let i = 0; i < n; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const t0 = performance.now();
      v.post.render(d.scene); gl.finish();
      t.push(performance.now() - t0);
    }
    return +t.sort((a, b) => a - b)[n >> 1].toFixed(2);
  };
  const row = { tris };
  for (const q of ['high', 'low']) {
    v.setQuality(q);
    await time(40);
    v.player.visible = true; const on = await time(80);
    v.player.visible = false; const off = await time(80);
    v.player.visible = true;
    row[q] = { on, off, player: +(on - off).toFixed(2) };
  }
  return row;
});
console.log(JSON.stringify(out));
await browser.close(); await server.close();

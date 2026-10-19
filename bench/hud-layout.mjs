// HOM-60: the HUD panels must not print over each other at any window size the game is played at.
// Opens the Warden's dialogue with a long quest tracker up and checks the two never meet (a short or narrow
// window used to put the dialogue right on top of the tracker). Run `npm run build` first.
//   node bench/hud-layout.mjs        exits non-zero on the first overlap
import { preview } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [[1600, 900], [1280, 720], [1024, 640], [900, 600], [1000, 520], [800, 560]];
const server = await preview({ root, logLevel: 'error', preview: { port: 4176, open: false } });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const overlaps = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
let failed = 0;

for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
  await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
  await page.evaluate(() => window.__debug.view.modelsReady);
  await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
  const rects = await page.evaluate(async () => {
    const d = window.__debug, p = d.sim.player;
    d.sim.quest.stage = 'forge'; // the tallest tracker in the game: six objective lines and the arrow
    p.inventory[0] = { id: 'iron_bar', qty: 8 };
    p.inventory[1] = { id: 'steel_bar', qty: 2 };
    p.inventory[2] = { id: 'logs', qty: 9 };
    p.x = 5.5; p.z = 2; d.step(); d.step();
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })); // talk to the Warden
    await new Promise(r => setTimeout(r, 400));
    const at = sel => {
      const e = document.querySelector(sel);
      if (!e || e.offsetParent === null) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) };
    };
    return { tracker: at('.tracker'), dialogue: at('.dialogue'), frame: at('.frame.player'), bar: at('.actionbar') };
  });
  await page.close();
  const bad = [['tracker', 'dialogue'], ['dialogue', 'frame'], ['dialogue', 'bar']].filter(([a, b]) => overlaps(rects[a], rects[b]));
  if (!rects.tracker || !rects.dialogue) { console.error(`FAIL ${width}x${height}: tracker or dialogue missing`); failed++; continue; }
  if (bad.length) { console.error(`FAIL ${width}x${height}: ${bad.map(p => p.join('/')).join(', ')} overlap  ${JSON.stringify(rects)}`); failed++; }
  else console.log(`  ok  ${width}x${height}: tracker ${rects.tracker.l}-${rects.tracker.r}, dialogue ${rects.dialogue.l}-${rects.dialogue.r}, no overlap`);
}

await browser.close(); await server.close();
if (failed) { console.error(`\n${failed} of ${SIZES.length} window sizes overlap.`); process.exit(1); }
console.log(`\nAll ${SIZES.length} window sizes keep the tracker, the dialogue and the frames apart.`);

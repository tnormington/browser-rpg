// HOM-140: does the inventory open already drawn, or does it send for its thumbnails then?
//
// A shut panel is display:none, so the browser never fetches a picture painted into it. Before the preload
// in art.ts, opening the bag asked for all 28 slots at that moment (187 KB) and left them blank until the
// files landed. This fills the bag with one of everything, opens it, and counts every item picture the page
// sends for from that moment on: zero is the whole point, so it fails if anything is asked for on the open.
//   node bench/invart.mjs
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// hmr off: an agent editing the checkout mid-run would otherwise reload the page out from under the probe
const server = await createServer({ root, logLevel: 'error', server: { port: 4186, hmr: false, watch: { ignored: ['**'] } } });
await server.listen();
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
// An observer from the first line of the document, not getEntriesByType at the end: the dev server's module
// requests overflow the 250-entry resource buffer long before the first thumbnail is sent for.
await page.addInitScript(() => {
  window.__art = [];
  new PerformanceObserver(list => {
    // the picture itself, not the one-line JS module the dev server hands back for a `?url` import
    for (const e of list.getEntries()) if (/\/art\/items\/[^?]+\.webp$/.test(e.name)) window.__art.push(e);
  }).observe({ type: 'resource', buffered: true });
});
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});
await page.evaluate(() => new Promise(res => { let n = 0; const f = () => (++n >= 90 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));

// one of everything in the bag, drawn into the (still closed) panel
await page.evaluate(async () => {
  const d = window.__debug, inv = d.sim.player.inventory, ids = Object.keys(d.items);
  for (let i = 0; i < inv.length; i++) inv[i] = i < ids.length ? { id: ids[i], qty: 1 } : null;
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  window.__before = window.__art.length;
  window.__t0 = performance.now();
});
await page.keyboard.press('i');

const out = await page.evaluate(async () => {
  // wait until no new thumbnail has arrived for half a second
  let quiet = 0, last = window.__art.length;
  while (quiet < 500) {
    await new Promise(res => setTimeout(res, 50));
    const n = window.__art.length;
    if (n !== last) { last = n; quiet = 0; } else quiet += 50;
  }
  const fetched = window.__art.filter(e => e.startTime >= window.__t0);
  const painted = new Set([...document.querySelectorAll('.invpanel .cell')]
    .map(c => (c.style.backgroundImage.match(/items\/[^"')]+/) ?? [])[0]).filter(Boolean));
  return {
    open: document.querySelector('.invpanel').style.display,
    slotsWithArt: painted.size,
    loadedBeforeOpen: window.__before,
    fetchedOnOpen: fetched.length,
    lastArrivedMs: fetched.length ? Math.round(Math.max(...fetched.map(e => e.responseEnd)) - window.__t0) : 0,
    kbOnOpen: Math.round(fetched.reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0) / 1024),
    kbBeforeOpen: Math.round(window.__art.filter(e => e.startTime < window.__t0)
      .reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0) / 1024),
  };
});
console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: join(root, 'bench', 'shots', 'invart.png') });
await browser.close();
await server.close();
if (!out.slotsWithArt) throw new Error('FAIL: no slot is wearing a thumbnail - the probe never filled the bag');
if (out.fetchedOnOpen) {
  throw new Error(`FAIL: opening the bag sent for ${out.fetchedOnOpen} thumbnails (last one ${out.lastArrivedMs}ms later) - they are not preloaded`);
}
console.log(`The bag opened drawn: ${out.slotsWithArt} slots, ${out.loadedBeforeOpen} thumbnails already in hand, nothing sent for on the open.`);

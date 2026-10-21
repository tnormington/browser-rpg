// Prints each skinned rig's key bone positions in fitted rig units, un-yawed, feet at 0 (what creatures.ts is drawn in).  node bench/rigs.mjs
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, logLevel: 'error', server: { port: 4178 } });
await server.listen();
const browser = await launchBrowser();
const page = await browser.newPage();
await page.goto('http://localhost:4178/?debug=1');
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
const res = await page.evaluate(() => {
  const out = {};
  for (const slot of ['boar', 'wolf', 'brute', 'hexer', 'pup']) {
    const p = window.__debug.view.prepared.get(slot), root = p.scene;
    root.updateMatrixWorld(true);
    const bones = {}, s = p.fit.scale, o = p.fit.offset, yaw = p.def.yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw);
    root.traverse(b => {
      if (!b.isBone) return;
      const e = b.matrixWorld.elements, x = e[12] * s, y = e[13] * s, z = e[14] * s;
      const rx = x * c + z * sn + o.x, rz = -x * sn + z * c + o.z;
      bones[b.name] = [+rx.toFixed(2), +(y + o.y).toFixed(2), +rz.toFixed(2)];
    });
    const keep = Object.entries(bones).filter(([k]) => /^(Head|Neck|Torso|Abdomen|UpperArm[LR]|FistR|Hips|Tail|Jaw|Ear|FootL|Hat|Body)/i.test(k));
    out[slot] = { fit: +s.toFixed(4), yaw, bones: Object.fromEntries(keep.length ? keep : Object.entries(bones).slice(0, 14)) };
  }
  return out;
});
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
await browser.close(); await server.close();
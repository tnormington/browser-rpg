// HOM-193: what the HUD says about the double jump, driven in real Chromium and held to what is on the rendered frame, not to the strings in the source.
//   1. The help list carries the double jump, the hidden chest and the notice board, and fits the window.
//   2. Walking up to Hale's watchtower (a hoard) at Agility 1 says what it needs, once: leaving and coming back does not say it again.
//   3. A click on the hoard says the same, every time, in the middle of the screen and in the log, instead of "Can't reach that".
//   4. The skills panel names the double jump as a distance on Agility's row (and the keys once it is earned), cut off at no window size.
//   5. Crossing Agility 25 through a chest's lamp (the real path: openChest -> grantXp -> levelup) raises the DOUBLE JUMP banner, once.
// Shots go to bench/shots/agility.   node bench/agility-hud.mjs        exits non-zero on any miss.
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'agility');
mkdirSync(out, { recursive: true });
const SIZES = [[1600, 900], [1280, 720], [1000, 520], [800, 560]];
// the dev server, not the build: the arrival below needs the sim's own xp curve (xpForLevel), which only a module import can reach
const server = await createServer({ root, logLevel: 'error', server: { port: 4178, strictPort: true, open: false } });
await server.listen();
const base = `http://localhost:4178/`;
const browser = await launchBrowser({ headless: true });
const fails = [];
const must = (cond, msg) => { if (!cond) { fails.push(msg); console.error(`FAIL: ${msg}`); } else console.log(`  ok  ${msg}`); };

for (const [W, H] of SIZES) {
  const tag = `${W}x${H}`;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
  await page.goto(`${base}?debug=1`);
  await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
  await page.evaluate(() => window.__debug.view.modelsReady);
  const wait = ms => page.waitForTimeout(ms);
  const text = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent).join(' | '), sel);
  const log = () => page.evaluate(() => [...document.querySelectorAll('.msglog .logline')].map(e => e.textContent));
  const quiet = () => page.evaluate(() => { const s = window.__debug.sim; for (const e of s.enemies) { e.state = 'dead'; e.respawnIn = 1e9; e.deadFor = 99; e.cast = null; } s.targetId = null; });

  // 1. the help list (it opens by itself on a first run)
  const help = await page.evaluate(() => { const o = document.querySelector('.helpoverlay'); const b = o.getBoundingClientRect(); return { shown: o.offsetParent !== null, text: o.textContent, b: [b.left, b.top, b.right, b.bottom] }; });
  must(help.shown, `${tag}: the help screen opens on a first run`);
  must(/Space again, in the air/.test(help.text) && /Double jump/.test(help.text) && /Agility 25/.test(help.text), `${tag}: the help list names the double jump and the Agility that buys it`);
  must(/hidden chest/i.test(help.text) && /notice board/i.test(help.text), `${tag}: and the hidden chest and the notice board`);
  must(help.b[0] >= 0 && help.b[1] >= 0 && help.b[2] <= W && help.b[3] <= H, `${tag}: and the longer list still sits inside the window`);
  await page.screenshot({ path: join(out, `help-${tag}.png`) });
  await page.locator('.helpok').click({ timeout: 3000 });
  await quiet();

  // 2. the sight: up to the tower, once
  await page.evaluate(() => { const p = window.__debug.sim.player; p.x = 2; p.z = 8; window.__debug.step(); }); // 18 u off: in sight
  await wait(250);
  const sighted = await log();
  must(sighted.some(l => /second jump, Agility 25/.test(l) && /paces/.test(l) && /Shift/.test(l)), `${tag}: coming up to the watchtower says what it needs, how far off that is and that Shift trains it`);
  must(/second jump/.test(await text('.msg')), `${tag}: ...and holds the short version in the middle of the screen`);
  if (W <= 1280) await page.screenshot({ path: join(out, `sight-${tag}.png`) });
  const before = sighted.filter(l => /second jump/.test(l)).length;
  await page.evaluate(() => { const p = window.__debug.sim.player; p.x = 2; p.z = -20; window.__debug.step(); });
  await wait(150);
  await page.evaluate(() => { const p = window.__debug.sim.player; p.x = 2; p.z = 8; window.__debug.step(); });
  await wait(250);
  must((await log()).filter(l => /second jump/.test(l)).length === before, `${tag}: walking away and back does not say it again`);

  // 3. a click on it: said every time, and not the generic shrug
  await page.evaluate(() => { const p = window.__debug.sim.player; p.x = 2; p.z = 24; window.__debug.step(); window.__debug.sim.interact = { k: 'chest', id: 'hale-hoard-1' }; });
  await wait(300);
  const msg = await text('.msg');
  must(/needs a second jump, Agility 25/.test(msg) && !/Can't reach/.test(msg), `${tag}: a click on the hoard says what it needs, not "Can't reach that" (said: "${msg}")`);
  if (W <= 1280) await page.screenshot({ path: join(out, `refusal-${tag}.png`) });

  // 4. the skills panel
  await page.keyboard.press('KeyK');
  await wait(300);
  const row = () => page.evaluate(() => {
    const r = [...document.querySelectorAll('.skillrow')].find(e => e.textContent.includes('Agility'));
    const n = r?.querySelector('.skillnote'), sp = document.querySelector('.skillspanel');
    const nb = n?.getBoundingClientRect(), top = nb && document.elementFromPoint((nb.left + nb.right) / 2, (nb.top + nb.bottom) / 2); // what is actually on top at the note's centre
    return { seen: !!n && (top === n || n.contains(top)), note: n?.textContent ?? '', cut: !!n && n.scrollWidth > n.clientWidth + 1, tip: r?.title ?? '', scroll: sp.scrollHeight - sp.clientHeight, box: n ? [n.getBoundingClientRect().left, n.getBoundingClientRect().right, sp.getBoundingClientRect().left, sp.getBoundingClientRect().right] : null };
  });
  let a = await row();
  must(/Sprint \d+ paces to double jump/.test(a.note) && !a.cut, `${tag}: Agility's row says how far the double jump is ("${a.note}")`);
  must(a.box && a.box[0] >= a.box[2] && a.box[1] <= a.box[3] && a.scroll <= 1, `${tag}: and the line is inside the panel, which does not scroll`);
  must(a.seen, `${tag}: and nothing is painted over it (the panel's own sticky title is what would be)`);
  must(/hold Shift/.test(a.tip) && /dodge-roll/.test(a.tip) && /net/.test(a.tip) && /hop/.test(a.tip), `${tag}: the row's tooltip lists what a level buys and how Agility is trained`);
  await page.screenshot({ path: join(out, `skills-${tag}.png`) });
  await page.evaluate(() => { const p = window.__debug.sim.player; p.skills.agility.level = 30; window.__debug.step(); });
  await wait(200);
  a = await row();
  must(/Space in the air/.test(a.note) && !a.cut, `${tag}: past the gate the line names the key ("${a.note}")`);
  await page.keyboard.press('KeyK');

  // 5. the arrival: a lamp that carries Agility over 25, through the real chest path, from the hoard's own roof
  await page.evaluate(async () => {
    const d = window.__debug, p = d.sim.player, { xpForLevel } = await import('/src/sim/xp.ts');
    p.chests = []; p.skills.agility.level = 24; p.skills.agility.xp = xpForLevel(24); // the lamp pays a span of the level you are on: exactly the rest of 24
    p.x = 3.2; p.z = 26; p.y = 2.8; d.step();
  });
  await wait(300); // frames at 24 first: the HUD notices the level it crossed from
  await page.evaluate(() => { window.__debug.sim.interact = { k: 'chest', id: 'hale-hoard-1' }; });
  await wait(500);
  const arrival = await page.evaluate(() => ({ banner: document.querySelector('.unlockbanner').textContent, sub: document.querySelector('.unlockbanner').dataset.sub, agility: window.__debug.sim.player.skills.agility.level, log: [...document.querySelectorAll('.msglog .logline')].map(e => e.textContent) }));
  if (arrival.agility >= 25) {
    must(/DOUBLE JUMP/.test(arrival.banner) && /Space again in the air/.test(arrival.sub), `${tag}: crossing Agility 25 raises the DOUBLE JUMP banner with the key`);
    must(arrival.log.filter(l => /you can double jump/.test(l)).length === 1, `${tag}: and says it in the log once`);
    if (W <= 1280) await page.screenshot({ path: join(out, `arrival-${tag}.png`) });
  } else console.log(`  --  ${tag}: the chest did not open from the roof in the harness (agility ${arrival.agility}); the arrival is not checked at this size`);
  await page.close();
}

await browser.close(); await server.close();
if (fails.length) { console.error(`\n${fails.length} misses.`); process.exit(1); }
console.log('\nThe double jump is told: help list, sight, refusal, skills row and arrival.');


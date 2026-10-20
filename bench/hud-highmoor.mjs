// HOM-104: the HUD surfaces Highmoor added, looked at: the thirteen-key bar, the hands and feet rows, the total level line, the tanning rack,
// Isolde Marr's shop row and the gate lines. Screenshots go to bench/shots/hud/<tag>/<WxH>-<scene>.png; the numbers it prints are the ones the report quotes.
//   node bench/hud-highmoor.mjs [tag]       (needs a build: npx vite build)
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? 'highmoor';
const out = join(root, 'bench', 'shots', 'hud', tag);
mkdirSync(out, { recursive: true });
const SIZES = [[1600, 900], [800, 560]];
const server = await preview({ root, logLevel: 'error', preview: { port: 4178, open: false } });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] });

for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
  await page.waitForFunction(() => window.__debug, null, { timeout: 60000 });
  await page.evaluate(() => window.__debug.view.modelsReady);
  await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
  const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: join(out, `${width}x${height}-${name}.png`) }); console.log('  ' + width + 'x' + height + ' ' + name); };
  const key = code => page.evaluate(c => dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
  const closeAll = async () => { await key('Escape'); await page.waitForTimeout(80); await key('Escape'); await page.waitForTimeout(80); };
  // the world is made safe, and the player stands in Highmoor's square
  await page.evaluate(() => {
    const d = window.__debug, s = d.sim, p = s.player;
    for (const o of s.enemies) { o.state = 'dead'; o.respawnIn = 1e9; o.deadFor = 99; o.cast = null; }
    p.hp = p.maxHp = 99999; p.gold = 137;
    const r = d.world.LANDMARKS.rack; p.x = r.x - 3; p.z = r.z; d.step(); d.step();
  });

  // the bar: a slot's measured size and whether what is printed on it still fits inside it
  const bar = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('.actionbar .slot')];
    const b = slots[0].getBoundingClientRect();
    const spill = slots.flatMap((s, i) => {
      const sb = s.getBoundingClientRect(), bad = [];
      for (const part of ['.key', '.aname', '.icon']) {
        const e = s.querySelector(part); if (!e) continue;
        // an element's text can be wider than its box (clipped by the slot's overflow): measure the text, not the box
        const range = document.createRange(); range.selectNodeContents(e);
        const r = range.getBoundingClientRect();
        if (r.width && (r.left < sb.left - 0.5 || r.right > sb.right + 0.5)) bad.push(`${part} "${e.textContent}" ${Math.round(r.width)}px in a ${Math.round(sb.width)}px slot`);
      }
      return bad.map(m => `slot ${i}: ${m}`);
    });
    return { n: slots.length, slot: Math.round(b.width * 10) / 10, gap: Math.round((slots[1].getBoundingClientRect().left - b.right) * 10) / 10, spill };
  });
  console.log(`  ${width}x${height} bar: ${bar.n} slots of ${bar.slot}px, ${bar.gap}px apart` + (bar.spill.length ? '\n    ' + bar.spill.join('\n    ') : ', nothing spills'));
  await shot('bar-fresh');
  await page.evaluate(() => { const d = window.__debug, p = d.sim.player; p.combat.level = 40; p.unlocked = 40; p.energy = p.maxEnergy * 0.5; d.step(); });
  await shot('bar-level40');

  // character panel, with hands and feet worn
  await page.evaluate(() => { const p = window.__debug.sim.player; p.inventory[0] = { id: 'hide_gloves', qty: 1 }; p.inventory[1] = { id: 'wolfskin_boots', qty: 1 }; });
  await key('KeyI'); await key('KeyC'); await shot('bag-sheet'); await closeAll();

  // skills: a fresh character, then one well on the way
  await key('KeyK'); await shot('skills-fresh');
  await page.evaluate(() => { const p = window.__debug.sim.player; for (const k of ['mining', 'woodcutting', 'smithing', 'fishing']) p.skills[k].level = 30; window.__debug.step(); });
  await shot('skills-mid'); await closeAll();

  // the tanning rack
  await page.evaluate(() => { const d = window.__debug; d.sim.interact = { k: 'rack' }; });
  await shot('rack');
  const same = await page.evaluate(() => [...document.querySelectorAll('.forgepanel')].map(e => e.className + ' / ' + [...e.children].map(c => c.className).join(',')));
  console.log('  forge-family panels: ' + JSON.stringify(same));
  await closeAll();

  // Isolde Marr: first with neither requirement, then with the level and no gold, then with both
  const shop = async (name, setup) => {
    await page.evaluate(setup);
    await page.evaluate(() => { const d = window.__debug, p = d.sim.player, v = d.world.LANDMARKS.highStable; p.x = v.x - 2; p.z = v.z; d.step(); d.sim.interact = { k: 'vendor', id: 'high_stable' }; });
    await page.waitForSelector('.shoppanel', { state: 'visible', timeout: 6000 }).catch(() => console.error('stable did not open'));
    await page.waitForTimeout(400);
    console.log('  ' + name + ': ' + (await page.evaluate(() => document.querySelector('.shoppanel .recipe')?.innerText.replace(/\n/g, ' | '))));
    await shot('stable-' + name); await closeAll();
  };
  await shop('neither', () => { const p = window.__debug.sim.player; for (const k of Object.keys(p.skills)) p.skills[k].level = 1; p.gold = 137; });
  await shop('level-no-gold', () => { const p = window.__debug.sim.player; for (const k of Object.keys(p.skills)) p.skills[k].level = 28; p.gold = 137; });
  await shop('gold-no-level', () => { const p = window.__debug.sim.player; for (const k of Object.keys(p.skills)) p.skills[k].level = 5; p.gold = 4000; });
  await shop('both', () => { const p = window.__debug.sim.player; for (const k of Object.keys(p.skills)) p.skills[k].level = 28; p.gold = 4000; });
  // the three keepers, walked into at combat 17 (short of every level) and at 31 (past them all): the log line each one earns. The player really walks
  // (W held, the camera turned until the walk heads for the line), because the HUD only reads a gate's event on the frame loop's own step.
  for (const level of [17, 31]) {
    const lines = [];
    for (const id of ['barrowdowns', 'cairnhold', 'cairnwaste']) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const before = await page.evaluate(({ id, level, yaw }) => {
          const d = window.__debug, p = d.sim.player, g = d.world.GATES.find(x => x.id === id), across = (g.span[0] + g.span[1]) / 2;
          p.combat.level = level; p.unlocked = level; p.hp = p.maxHp; d.view.yaw = yaw;
          const near = g.at + g.from * 2.5;
          if (g.axis === 'x') { p.x = near; p.z = across; } else { p.z = near; p.x = across; }
          d.step();
          return document.querySelectorAll('.logline').length;
        }, { id, level, yaw });
        await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
        const got = await page.evaluate(n => { const l = [...document.querySelectorAll('.logline')]; return l.length > n ? l[l.length - 1].textContent : null; }, before);
        if (got) { lines.push(got); break; }
      }
    }
    console.log(`  gate lines at combat ${level}:\n    ` + lines.join('\n    '));
    await shot(`gates-${level}`);
  }  await page.close();
}
await browser.close(); await server.close();

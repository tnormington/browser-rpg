// HOM-141: does every crafting menu show you what you are making, and what it eats?
//
// The forge, the cooking range, the alembic, the tanning rack and the rune circle all list items by name only
// before this. Each row now carries the output's thumbnail beside its name and a small one on every material
// chip. This walks the player to all five, opens each, and checks three things per panel:
//   - every row that names an item wears that item's picture (a painted .rthumb, not an empty box)
//   - every material chip wears the small one
//   - the panel does not overflow sideways: a 34px picture in the head must not push a name off the row
// Shots -> bench/shots/craftart/<station>.png
//   node bench/craftart.mjs
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'bench', 'shots', 'craftart');
mkdirSync(out, { recursive: true });
// hmr off: an agent editing the checkout mid-run would otherwise reload the page out from under the probe
const server = await createServer({ root, logLevel: 'error', server: { port: 4187, hmr: false, watch: { ignored: ['**'] } } });
await server.listen();
const browser = await launchBrowser({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.error('pageerror', e.stack ?? String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 5000 }).catch(() => {});

// a crafter who can make everything, with the materials for it: every group of every list has rows to look at
await page.evaluate(() => {
  const d = window.__debug, p = d.sim.player;
  for (const id of Object.keys(p.skills)) p.skills[id].level = 60;
  p.combat.level = 40;
  Object.assign(p.equipment, { weapon: 'crownbreaker', head: 'steel_helm', hands: 'moorhide_gloves', feet: 'moorhide_boots' });
  p.enchants.weapon = 'keen';
  for (const o of d.sim.enemies) { o.state = 'dead'; o.respawnIn = 1e9; o.deadFor = 99; o.cast = null; }
});

const stations = ['forge', 'range', 'alembic', 'rack', 'circle'];
const fails = [];
for (const station of stations) {
  await page.evaluate(st => {
    const d = window.__debug, p = d.sim.player, inv = p.inventory, at = d.world.LANDMARKS[st];
    // the circle grinds gear rather than eating materials, so its bag is set by hand; a station's is filled below from what it asks for
    const bag = st === 'circle' ? ['arcane_dust', 'stormiron_blade', 'starmetal_blade', 'adamant_blade', 'thornhide_gloves'] : [];
    for (let i = 0; i < inv.length; i++) inv[i] = i < bag.length ? { id: bag[i], qty: 99 } : null;
    p.x = at.x - 3; p.z = at.z; d.step(); d.step();
    d.sim.interact = { k: st };
  }, station);
  await page.waitForTimeout(400);
  // stock the bag with the materials the open panel is asking for, so the list has rows in every group to look at.
  // Which ones they are is read off the chips themselves: the thumbnail a chip is wearing is the item's own id.
  await page.evaluate(() => {
    const panel = [...document.querySelectorAll('.forgepanel')].find(p => p.style.display !== 'none');
    if (!panel) return;
    const ids = [...new Set([...panel.querySelectorAll('.rin .rthumb')]
      .map(t => (t.style.backgroundImage.match(/\/art\/items\/([^."')]+)\.webp/) ?? [])[1]).filter(Boolean))];
    const inv = window.__debug.sim.player.inventory;
    ids.slice(0, inv.length).forEach((id, i) => { inv[i] = { id, qty: 99 }; });
    window.__debug.step();
  });
  await page.waitForTimeout(300);

  const seen = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('.forgepanel')].find(p => p.style.display !== 'none');
    if (!panel) return null;
    const painted = e => /\/art\/items\/[^"')]+/.test(e?.style.backgroundImage ?? '');
    const leads = [...panel.querySelectorAll('.rlead')], chips = [...panel.querySelectorAll('.rin')];
    return {
      title: panel.querySelector('.ptitle').textContent.replace('✕', '').trim(),
      rows: panel.querySelectorAll('.recipe').length,
      named: leads.length,
      namedDrawn: leads.filter(l => painted(l.querySelector('.rthumb'))).length,
      chips: chips.length,
      chipsDrawn: chips.filter(c => painted(c.querySelector('.rthumb.sm'))).length,
      overflow: panel.scrollWidth - panel.clientWidth,
    };
  });
  if (!seen) { fails.push(`${station}: no panel opened`); continue; }
  console.log(`${station.padEnd(8)} ${JSON.stringify(seen)}`);
  await page.screenshot({ path: join(out, `${station}.png`) });
  if (!seen.named) fails.push(`${station}: not one row names an item - the probe set the panel up wrong`);
  if (seen.namedDrawn !== seen.named) fails.push(`${station}: ${seen.named - seen.namedDrawn} of ${seen.named} rows show no thumbnail`);
  if (seen.chipsDrawn !== seen.chips) fails.push(`${station}: ${seen.chips - seen.chipsDrawn} of ${seen.chips} material chips show no thumbnail`);
  if (seen.overflow > 0) fails.push(`${station}: the panel overflows by ${seen.overflow}px - a row is wider than the panel`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
}
await browser.close();
await server.close();
if (fails.length) { for (const f of fails) console.error('FAIL ' + f); process.exit(1); }
console.log(`All ${stations.length} crafting menus draw what they make and what they eat.`);

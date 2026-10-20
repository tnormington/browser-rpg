// HOM-60 / HOM-82: the HUD panels must not print over each other, and must not run off the window, at any size the game is played at.
// 1. Opens the Warden's dialogue with a long quest tracker up and checks the two never meet (a short or narrow
//    window used to put the dialogue right on top of the tracker).
// 2. Opens every panel in turn (the forge's recipe list, the bag, the character sheet, skills, talents, spellbook, help) and
//    checks each one sits inside the window; the forge's must also stay clear of the minimap, the unit frame and the action bar.
// Run `npm run build` first.
//   node bench/hud-layout.mjs        exits non-zero on any overlap or any panel past the window's edge
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
  // the forge is opened the way a click on it opens it: the sim is told to interact, and the frame loop turns that into the panel
  await page.keyboard.press('Escape'); // the dialogue is done with
  await page.evaluate(() => {
    const d = window.__debug, p = d.sim.player, f = d.world.LANDMARKS.forge;
    p.x = f.x - 3; p.z = f.z; p.hp = p.maxHp; d.step(); d.step();
    d.sim.interact = { k: 'forge' };
  });  const panelFails = await page.evaluate(async () => {
    const d = window.__debug, W = innerWidth, H = innerHeight, fails = [];
    const key = code => dispatchEvent(new KeyboardEvent('keydown', { code }));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const box = e => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const shown = sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null);
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    // the forge is already open from the click; the rest are opened by the keys that toggle them
    const scenes = [['forge', () => {}], ['bag', () => key('KeyI')], ['bag+sheet', () => { key('KeyI'); key('KeyC'); }],
      ['skills', () => key('KeyK')], ['talents', () => key('KeyN')], ['spellbook', () => key('KeyP')], ['help', () => key('KeyH')]];
    for (const [name, open] of scenes) {
      open(); await wait(350);
      const panels = shown('.panel');
      if (!panels.length) fails.push(name + ': no panel opened');
      for (const e of panels) {
        const b = box(e), who = name + ' (' + e.className.replace('panel ', '') + ')';
        if (b.b > H || b.r > W || b.t < 0 || b.l < 0) fails.push(who + ' runs off the window: ' + JSON.stringify(b) + ' in ' + W + 'x' + H);
        if (name === 'forge') {
          for (const [what, sel] of [['minimap', '.minimap'], ['action bar', '.actionbar'], ['player frame', '.frame.player'], ['quest tracker', '.tracker']]) {
            const o = shown(sel)[0];
            if (o && hit(b, box(o))) fails.push(who + ' prints over the ' + what + ': ' + JSON.stringify(b) + ' vs ' + JSON.stringify(box(o)));
          }
        }
      }
      key('Escape'); await wait(100);
      if (shown('.panel').length) { key('Escape'); await wait(100); }
    }
    return fails;
  });
  await page.close();
  for (const m of panelFails) { console.error(`FAIL ${width}x${height}: ${m}`); failed++; }
  const bad = [['tracker', 'dialogue'], ['dialogue', 'frame'], ['dialogue', 'bar']].filter(([a, b]) => overlaps(rects[a], rects[b]));
  if (!rects.tracker || !rects.dialogue) { console.error(`FAIL ${width}x${height}: tracker or dialogue missing`); failed++; continue; }
  if (bad.length) { console.error(`FAIL ${width}x${height}: ${bad.map(p => p.join('/')).join(', ')} overlap  ${JSON.stringify(rects)}`); failed++; }
  else if (!panelFails.length) console.log(`  ok  ${width}x${height}: tracker ${rects.tracker.l}-${rects.tracker.r}, dialogue ${rects.dialogue.l}-${rects.dialogue.r}, no overlap, every panel inside the window`);
}

await browser.close(); await server.close();
if (failed) { console.error(`\n${failed} layout problems across ${SIZES.length} window sizes.`); process.exit(1); }
console.log(`\nAll ${SIZES.length} window sizes keep the tracker, the dialogue and the frames apart, and every panel inside the window.`);

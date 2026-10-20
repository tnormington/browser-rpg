// HOM-60 / HOM-82: the HUD panels must not print over each other, and must not run off the window, at any size the game is played at.
// 1. Opens the Warden's dialogue with a long quest tracker up and checks the two never meet (a short or narrow
//    window used to put the dialogue right on top of the tracker).
// 2. Opens every panel in turn (the forge's recipe list, the bag, the character sheet, skills, talents, spellbook, help, the shop) and
//    checks each one sits inside the window; the forge's, the spell book's and the shop's must also stay clear of the minimap, the unit
//    frame, the quest tracker and the action bar.
// 3. With a target held, checks the HUD that is always on (quest tracker, minimap, both unit frames, action bar, swing bar, XP bar, menu bar)
//    is clear of itself and sits inside the window.
// 4. (HOM-104) The action bar is one row, no slot under MIN_SLOT px, and nothing printed on a slot wider than the slot; the tanning rack and Isolde Marr's
//    shop are checked like the forge and the shop; a full message log sits clear of the bar, the frames and the swing bar.
// Run `npm run build` first.
//   node bench/hud-layout.mjs        exits non-zero on any overlap or any panel past the window's edge
import { preview } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [[1600, 900], [1280, 720], [1024, 640], [900, 600], [1000, 520], [800, 560]];
const MIN_SLOT = 44; // the smallest an action slot may be: the usual floor for a click target. 13 keys reach it at 692px wide, below the 800 the game is played down to.
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
      ['skills', () => key('KeyK')], ['talents', () => key('KeyN')], ['spellbook', () => key('KeyP')], ['help', () => key('KeyH')],
      ['admin', () => key('Backquote')], // the QA panel (HOM-114): only there with ?debug=1, which is how this bench loads the game
      ['shop', async () => { const p = d.sim.player; p.hp = p.maxHp = 99999; p.x = -7; p.z = 3; d.step(); d.sim.interact = { k: 'vendor' }; await wait(500); }],
      // Highmoor (HOM-104): the tanning rack is the forge's panel again, and Isolde Marr's row is the tallest a shop row gets (two requirements)
      ['rack', async () => { const p = d.sim.player, r = d.world.LANDMARKS.rack; p.x = r.x - 3; p.z = r.z; d.step(); d.sim.interact = { k: 'rack' }; await wait(300); }],
      ['stable', async () => { const p = d.sim.player, v = d.world.LANDMARKS.highStable; p.x = v.x - 2; p.z = v.z; d.step(); d.sim.interact = { k: 'vendor', id: 'high_stable' }; await wait(500); }]];
    // the panels that sit in the open middle of the screen and so must stay clear of what is always on. The talent tree (760 wide) and the
    // skills list do not yet at 800 wide: that is a layout call for the CEO (HOM-83 report), not something a restyle moves.
    const CLEAR = new Set(['forge', 'spellbook', 'shop', 'rack', 'stable']);
    for (const [name, open] of scenes) {
      await open(); await wait(350);
      const panels = shown('.panel');
      if (!panels.length) fails.push(name + ': no panel opened');
      for (const e of panels) {
        const b = box(e), who = name + ' (' + e.className.replace('panel ', '') + ')';
        if (b.b > H || b.r > W || b.t < 0 || b.l < 0) fails.push(who + ' runs off the window: ' + JSON.stringify(b) + ' in ' + W + 'x' + H);
        if (CLEAR.has(name)) {
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
  // the HUD that is always on, with a target held so both unit frames are up; the world is made safe so nothing it does changes the layout
  const restFails = await page.evaluate(async () => {
    const d = window.__debug, s = d.sim, p = s.player, W = innerWidth, H = innerHeight, fails = [];
    p.hp = p.maxHp = 99999;
    const e = s.enemies.find(o => o.state !== 'dead');
    for (const o of s.enemies) if (o !== e) { o.state = 'dead'; o.respawnIn = 1e9; o.deadFor = 99; o.cast = null; }
    p.dead = false; p.x = e.x + 4; p.z = e.z; s.targetId = e.id; p.autoAttack = true;
    d.step(); d.step();
    // a full message log: the keepers of Highmoor speak in four-line sentences, and the log lines are clickable, so it must not sit over a slot
    const log = document.querySelector('.msglog');
    for (let i = 0; i < 12; i++) { const l = document.createElement('div'); l.className = 'logline log-quest'; l.textContent = 'Cairnwarden Ysolt: "The Cairn Hold is not for anyone under combat level 29. What sleeps in it has waited this long."'; log.append(l); }
    await new Promise(r => setTimeout(r, 400));
    const parts = [['quest tracker', '.tracker'], ['minimap', '.minimap'], ['player frame', '.frame.player'], ['target frame', '.frame.target'],
      ['action bar', '.actionbar'], ['swing bar', '.swing'], ['XP bar', '.xp'], ['menu bar', '.menubar'], ['message log', '.msglog'],
      ['admin button', '.devbar']]; // HOM-114: dev builds only, and this bench loads the game as one
    const boxes = [];
    for (const [name, sel] of parts) {
      const x = document.querySelector(sel);
      if (!x || x.offsetParent === null) { fails.push(name + ' is not showing'); continue; }
      const b = x.getBoundingClientRect(), r = { name, l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) };
      if (r.b > H || r.r > W || r.t < 0 || r.l < 0) fails.push(name + ' runs off the window: ' + JSON.stringify(r) + ' in ' + W + 'x' + H);
      boxes.push(r);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) fails.push(a.name + ' prints over the ' + b.name + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
    }
    return fails;
  });
  // HOM-104: the bar is one row at any width, and a slot is still something to click: no smaller than MIN_SLOT, with what is printed on it inside it.
  // Level 40 puts every kind of lock label ("Lv 30", "Trainer", "Talent") on the bar at once, and "Trainer" is the widest word the bar prints.
  const barFails = await page.evaluate(async MIN_SLOT => {
    const d = window.__debug, p = d.sim.player, fails = [];
    p.combat.level = 40; p.unlocked = 40; d.step();
    await new Promise(r => setTimeout(r, 300));
    const slots = [...document.querySelectorAll('.actionbar .slot')];
    const rows = new Set(slots.map(s => Math.round(s.getBoundingClientRect().top)));
    if (rows.size > 1) fails.push('the action bar wraps onto ' + rows.size + ' rows');
    const w = slots[0].getBoundingClientRect().width;
    if (w < MIN_SLOT) fails.push('an action slot is ' + Math.round(w) + 'px, under the ' + MIN_SLOT + 'px click-target floor');
    slots.forEach((s, i) => {
      const sb = s.getBoundingClientRect();
      for (const part of ['.key', '.aname', '.locklvl']) {
        const e = s.querySelector(part);
        if (!e || e.offsetParent === null || !e.textContent) continue;
        const range = document.createRange(); range.selectNodeContents(e);
        const r = range.getBoundingClientRect(); // the text itself: a box can be narrower than what it holds, and the slot clips the rest
        if (r.left < sb.left - 0.5 || r.right > sb.right + 0.5) fails.push(`slot ${i + 1}: ${part} "${e.textContent}" is ${Math.round(r.width)}px wide in a ${Math.round(sb.width)}px slot`);
      }
    });
    return fails;
  }, MIN_SLOT);
  await page.close();
  for (const m of barFails) { console.error(`FAIL ${width}x${height}: ${m}`); failed++; }
  for (const m of restFails) { console.error(`FAIL ${width}x${height}: ${m}`); failed++; }
  for (const m of panelFails) { console.error(`FAIL ${width}x${height}: ${m}`); failed++; }
  const bad = [['tracker', 'dialogue'], ['dialogue', 'frame'], ['dialogue', 'bar']].filter(([a, b]) => overlaps(rects[a], rects[b]));
  if (!rects.tracker || !rects.dialogue) { console.error(`FAIL ${width}x${height}: tracker or dialogue missing`); failed++; continue; }
  if (bad.length) { console.error(`FAIL ${width}x${height}: ${bad.map(p => p.join('/')).join(', ')} overlap  ${JSON.stringify(rects)}`); failed++; }
  else if (!panelFails.length) console.log(`  ok  ${width}x${height}: tracker ${rects.tracker.l}-${rects.tracker.r}, dialogue ${rects.dialogue.l}-${rects.dialogue.r}, no overlap, every panel inside the window`);
}

await browser.close(); await server.close();
if (failed) { console.error(`\n${failed} layout problems across ${SIZES.length} window sizes.`); process.exit(1); }
console.log(`\nAll ${SIZES.length} window sizes keep the tracker, the dialogue and the frames apart, and every panel inside the window.`);

// HOM-60 / HOM-82 / HOM-108: the HUD panels must not print over each other, over the HUD that is always on, or off the window, at any size the game is played at.
// 1. Opens the Warden's dialogue with a long quest tracker up and checks the two never meet (a short or narrow
//    window used to put the dialogue right on top of the tracker).
// 2. Holds a target (both unit frames up, the player's with its buffs on), fills the message log, then opens every panel in turn (the forge's recipe list,
//    the bag, the character sheet, skills, talents, spellbook, help, the shop, the tanning rack, the stable) and checks each one sits inside the window
//    and clear of the minimap, both unit frames, the quest tracker, the message log, the swing and XP bars, the menu bar and the action bar.
//    The help screen is a modal veil over the whole game and is the one panel exempt from "clear of".
// 3. Every pair of panels that the player can open together (bag + sheet, bag then skills, forge then bag, a shop then the sheet, a dialogue then the bag ...)
//    is opened in both orders and must not print over each other. Below 1000px or 640px high the HUD docks: opening a panel shuts the others (the bag and
//    the sheet are the one pair that stay), so this is where "the window cannot hold both" is settled, not left to the player's eye.
// 4. The skills list (with a tenth skill added) must not scroll, and the message log is a readable width and height at every size.
// 5. With a target held, checks the HUD that is always on (quest tracker, minimap, both unit frames, action bar, swing bar, XP bar, menu bar, log)
//    is clear of itself and sits inside the window.
// 6. (HOM-104) The action bar is one row, no slot under MIN_SLOT px, and nothing printed on a slot wider than the slot.
// Run `npm run build` first.
//   node bench/hud-layout.mjs        exits non-zero on any overlap or any panel past the window's edge
import { preview } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [[1600, 900], [1280, 720], [1024, 640], [900, 600], [1000, 520], [800, 560]];
const MIN_SLOT = 44; // the smallest an action slot may be: the usual floor for a click target. 13 keys reach it at 692px wide, below the 800 the game is played down to.
const MIN_LOG = { w: 240, h: 120 }; // a message log that is narrower than this wraps a keeper's sentence into a column; shorter shows two lines (HOM-108: 120 wide was the stopgap)
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
  // the worst case the HUD has to hold: a target (so both unit frames are up), the player's frame with its buffs and the food wait, a log that is full
  // (the keepers of Highmoor speak in four-line sentences, and the log lines are clickable, so it must not sit over a slot), and the tallest tracker in the game
  await page.evaluate(() => {
    const d = window.__debug, s = d.sim, p = s.player;
    p.hp = p.maxHp = 99999; p.buffs = [{ id: 'well_fed', left: 600 }, { id: 'guard', left: 3 }]; p.foodCd = 30;
    s.quest.stage = 'forge';
    p.inventory[0] = { id: 'iron_bar', qty: 8 }; p.inventory[1] = { id: 'steel_bar', qty: 2 }; p.inventory[2] = { id: 'logs', qty: 9 };
    const log = document.querySelector('.msglog');
    for (let i = 0; i < 12; i++) { const l = document.createElement('div'); l.className = 'logline log-quest'; l.textContent = 'Cairnwarden Ysolt: "The Cairn Hold is not for anyone under combat level 29. What sleeps in it has waited this long."'; log.append(l); }
    log.scrollTop = log.scrollHeight;
  });
  const rects = await page.evaluate(async () => {
    const d = window.__debug, p = d.sim.player;
    p.x = 5.5; p.z = 2; d.step(); d.step();
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })); // talk to the Warden
    await new Promise(r => setTimeout(r, 400));
    const at = sel => {
      const e = document.querySelector(sel);
      if (!e || e.offsetParent === null) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) };
    };
    return { tracker: at('.tracker'), dialogue: at('.dialogue'), frame: at('.frame.player'), bar: at('.actionbar'), log: at('.msglog'), docked: document.querySelector('.hud').classList.contains('docked') };
  });
  // the forge is opened the way a click on it opens it: the sim is told to interact, and the frame loop turns that into the panel
  await page.keyboard.press('Escape'); // the dialogue is done with
  const panelFails = await page.evaluate(async ({ MIN_LOG }) => {
    const d = window.__debug, s = d.sim, p = s.player, W = innerWidth, H = innerHeight, fails = [];
    const key = code => dispatchEvent(new KeyboardEvent('keydown', { code }));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const box = e => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const shown = sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null);
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const enemy = s.enemies.find(o => o.state !== 'dead');
    // hold the target wherever the player has been moved to: the frame is part of what a panel must clear
    const hold = () => { p.hp = p.maxHp; p.dead = false; s.targetId = enemy.id; enemy.hp = enemy.maxHp; d.step(); };
    const go = (x, z) => { p.x = x; p.z = z; hold(); };
    const station = (name, k) => async () => { const r = d.world.LANDMARKS[name]; go(r.x - 3, r.z); s.interact = { k }; await wait(300); };
    const vendor = (x, z, id) => async () => { go(x, z); s.interact = id ? { k: 'vendor', id } : { k: 'vendor' }; await wait(500); };
    const talk = async () => { go(5.5, 2); key('KeyV'); await wait(300); };
    // what is always on, in the order the failure reads
    const PARTS = [['minimap', '.minimap'], ['action bar', '.actionbar'], ['player frame', '.frame.player'], ['target frame', '.frame.target'], ['quest tracker', '.tracker'],
      ['message log', '.msglog'], ['swing bar', '.swing'], ['XP bar', '.xp'], ['menu bar', '.menubar'], ['admin button', '.devbar']];
    const check = (who) => {
      const panels = shown('.panel').filter(e => !e.classList.contains('helpoverlay'));
      const boxes = panels.map(e => ({ e, b: box(e), n: e.className.replace('panel ', '') }));
      for (const { b, n } of boxes) {
        if (b.b > H || b.r > W || b.t < 0 || b.l < 0) fails.push(`${who} (${n}) runs off the window: ${JSON.stringify(b)} in ${W}x${H}`);
        for (const [what, sel] of PARTS) {
          const o = shown(sel)[0];
          if (o && hit(b, box(o))) fails.push(`${who} (${n}) prints over the ${what}: ${JSON.stringify(b)} vs ${JSON.stringify(box(o))}`);
        }
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
        if (hit(boxes[i].b, boxes[j].b)) fails.push(`${who}: ${boxes[i].n} prints over ${boxes[j].n}: ${JSON.stringify(boxes[i].b)} vs ${JSON.stringify(boxes[j].b)}`);
      if (!shown('.frame.target').length) fails.push(`${who}: the target frame is not up, so it was not checked`);
      return boxes.length;
    };
    const closeAll = async () => { for (let i = 0; i < 3; i++) { key('Escape'); await wait(60); if (!shown('.panel').length) break; } };
    // the single panels, each opened the way the player opens it. The help screen is a veil over everything, so it is only held to the window.
    const scenes = [['forge', station('forge', 'forge')], ['bag', () => key('KeyI')], ['sheet', () => key('KeyC')], ['bag+sheet', () => { key('KeyI'); key('KeyC'); }],
      ['skills', () => key('KeyK')], ['talents', () => key('KeyN')], ['spellbook', () => key('KeyP')],
      ['admin', () => key('Backquote')], // the QA panel (HOM-114): only there with ?debug=1, which is how this bench loads the game
      ['shop', async () => { await vendor(-7, 3)(); }],
      // Highmoor (HOM-104): the tanning rack is the forge's panel again, and Isolde Marr's row is the tallest a shop row gets (two requirements)
      ['rack', station('rack', 'rack')], ['stable', async () => { const v = d.world.LANDMARKS.highStable; await vendor(v.x - 2, v.z, 'high_stable')(); }],
      ['dialogue', talk]];
    for (const [name, open] of scenes) {
      go(5.5, 2); await open(); await wait(350); hold(); await wait(60);
      if (!check(name)) fails.push(name + ': no panel opened');
      await closeAll();
    }
    go(5.5, 2); key('KeyH'); await wait(300);
    for (const e of shown('.helpoverlay')) { const b = box(e); if (b.b > H || b.r > W || b.t < 0 || b.l < 0) fails.push(`help runs off the window: ${JSON.stringify(b)} in ${W}x${H}`); }
    await closeAll();
    // two at once: the player can open one while the other is up, in either order. A docked HUD answers by shutting the first; it must never print both over each other.
    const keys = { bag: 'KeyI', sheet: 'KeyC', skills: 'KeyK', talents: 'KeyN', spellbook: 'KeyP', admin: 'Backquote' };
    const firsts = { ...Object.fromEntries(Object.entries(keys).map(([n, k]) => [n, async () => { key(k); }])),
      forge: station('forge', 'forge'), shop: async () => { await vendor(-7, 3)(); }, dialogue: talk };
    for (const [a, openA] of Object.entries(firsts)) for (const [b, k] of Object.entries(keys)) {
      if (a === b) continue;
      go(5.5, 2); await openA(); await wait(a === 'forge' || a === 'shop' ? 350 : 120); hold(); key(k); await wait(250);
      check(`${a} then ${b}`);
      await closeAll();
    }
    // the skills list at ten skills (the tenth lands with enchanting): a list of skills does not scroll
    go(5.5, 2); key('KeyK'); await wait(300);
    const sp = shown('.skillspanel')[0];
    if (sp) {
      const grid = sp.querySelector('.skillgrid') ?? sp, rows = grid.querySelectorAll('.skillrow');
      if (rows.length && rows.length < 10) { for (let i = rows.length; i < 10; i++) grid.append(rows[rows.length - 1].cloneNode(true)); await wait(100); }
      if (sp.scrollHeight > sp.clientHeight + 1) fails.push(`skills: ${grid.querySelectorAll('.skillrow').length} skills scroll by ${sp.scrollHeight - sp.clientHeight}px in a ${sp.clientHeight}px panel`);
    } else fails.push('skills: the panel did not open');
    await closeAll();
    // the log: readable, and its home is clear of everything (checked above with the rest)
    const log = shown('.msglog')[0];
    if (!log) fails.push('message log is not showing');
    else { const b = box(log); if (b.r - b.l < MIN_LOG.w || b.b - b.t < MIN_LOG.h) fails.push(`message log is ${b.r - b.l}x${b.b - b.t}, under ${MIN_LOG.w}x${MIN_LOG.h}`); }
    return fails;
  }, { MIN_LOG });
  // the HUD that is always on, with a target held so both unit frames are up; the world is made safe so nothing it does changes the layout
  const restFails = await page.evaluate(async () => {
    const d = window.__debug, s = d.sim, p = s.player, W = innerWidth, H = innerHeight, fails = [];
    p.hp = p.maxHp = 99999;
    const e = s.enemies.find(o => o.state !== 'dead');
    for (const o of s.enemies) if (o !== e) { o.state = 'dead'; o.respawnIn = 1e9; o.deadFor = 99; o.cast = null; }
    p.dead = false; p.x = e.x + 4; p.z = e.z; s.targetId = e.id; p.autoAttack = true;
    d.step(); d.step();
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
  const bad = [['tracker', 'dialogue'], ['dialogue', 'frame'], ['dialogue', 'bar'], ['dialogue', 'log']].filter(([a, b]) => overlaps(rects[a], rects[b]));
  // a dialogue that needs the rail's room docks the HUD: the tracker steps aside (is not showing), which is the contract, not a miss
  if (!rects.dialogue) { console.error(`FAIL ${width}x${height}: the dialogue did not open`); failed++; continue; }
  if (!rects.tracker && !rects.docked) { console.error(`FAIL ${width}x${height}: the tracker is missing and the HUD is not docked`); failed++; continue; }
  if (bad.length) { console.error(`FAIL ${width}x${height}: ${bad.map(p => p.join('/')).join(', ')} overlap  ${JSON.stringify(rects)}`); failed++; }
  else if (!panelFails.length) console.log(`  ok  ${width}x${height}: ${rects.tracker ? `tracker ${rects.tracker.l}-${rects.tracker.r}` : 'HUD docked'}, dialogue ${rects.dialogue.l}-${rects.dialogue.r}, log ${rects.log ? `${rects.log.r - rects.log.l}px wide` : 'empty'}, no overlap, every panel inside the window`);
}

await browser.close(); await server.close();
if (failed) { console.error(`\n${failed} layout problems across ${SIZES.length} window sizes.`); process.exit(1); }
console.log(`\nAll ${SIZES.length} window sizes keep the tracker, the dialogue, the frames and the log apart, and every panel (and every pair of panels) clear and inside the window.`);

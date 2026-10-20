// Also presses T like a user would and saves the in-game trace as bench/shots/trace-<tag>.json; --inject adds a forced shader compile and a 60 ms
// main-thread stall mid-fight, to prove that trace catches spikes.
// Combat frame trace: drives a real fight against the Cave Brute through the real game loop (keyboard in, rAF out) and records
// every frame's time, plus every GL program link and compile that happens, so a hitch can be matched to its cause.
//   node bench/combat.mjs [--tag before|after] [--secs 25] [--quality high|low] [--skip-build] [--inject]
// Writes bench/shots/combat-<tag>.json and combat-<tag>.png; prints worst frames, link events and the frames they landed in.
//
// --mode ttk|loop turns it into a balance bot (HOM-53) instead: an in-page player that fights the road's and the Strand's enemies through the same
// loop (real KeyboardEvents and MouseEvents on the page, rAF out) and measures them in sim ticks, not wall time.
//   node bench/combat.mjs --mode ttk  --types marsh_hog,road_wolf --n 20 [--level N] [--gear base|adamant|marrow|line] [--no-heal] [--speed 3] [--port 4175] [--tactics] --skip-build
//   node bench/combat.mjs --mode loop --types marsh_hog --n 12 [--health 0.8]
// camp / ride / clusters (HOM-88): spawns within --link units (13) of each other form a camp; --size 3 keeps the camps of exactly three.
//   node bench/combat.mjs --mode clusters [--size 3 --link 13]   list the camps and their members without fighting
//   node bench/combat.mjs --mode camp --n 5 [--gearlo base --gearhi adamant,marrow --standoff 13 --tactics]   a whole camp at once from 13 u off: deaths, % HP taken, clear time
//   node bench/combat.mjs --mode ride --n 3   mounted 45 u short of a camp, W held to a point 45 past it, dead centre and 12 u off-line: HP lost, first hit, thrown, reached the far side
// Elites (toll_captain, barnacle_ogre, bogfather) and rares (old_grey, gutterhook, mother_mire) need no new mode: --mode ttk --types toll_captain,old_grey --n 10.
// Rotation: auto-attack, Pummel on a wind-up, Crushing Blow > Serrated Throw > Strike. --tactics adds Second Wind below 45 % HP and Cleave against two adjacent enemies.
// --gear line: weapon 36 + 2.6 (L - 16), armour 60 + 2.2 (L - 16) at the enemy's level (world-design 3.4's model). --mode ttk fires Second Wind on cooldown when none
// of it is wasted (the elite rows are 'with a heal'); --no-heal is the no-heal column; other modes opt in with --heal. ttk prints mean and median together.
// Not modelled: stepping out of a slam / ground circle, food, potions, talents.
// ttk: isolated 1v1 (everything else in the world pinned dead), player placed 7 units off; per fight: first swing -> kill, damage taken, % of max HP.
// loop: the type's camps in their natural layout (other types pinned dead), kill -> loot (real clicks) -> walk (real clicks) -> wait for --health of max HP
//   -> next fight; swing-to-swing time split into fight / loot / walk / regen-wait / engage. Writes bench/shots/bot-<mode>-<tag>.json.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const tag = opt('tag', 'run'), secs = Number(opt('secs', 25)), quality = opt('quality', 'high');
const mode = opt('mode', ''), speed = Number(opt('speed', 1)), port = Number(opt('port', 4175));
const shots = join(root, 'bench', 'shots'); mkdirSync(shots, { recursive: true });
// ---------- HOM-53 balance bot ----------
/** Runs in the page. Plays through KeyboardEvents / MouseEvents the game's own listeners read; the sim ticks at its fixed 30 Hz, so every time below is in ticks. */
async function botInPage(cfg) {
  const d = window.__debug, s = d.sim, p = s.player, view = d.view, canvas = d.renderer.domElement, ITEMS = d.items;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const cum = [0, 0]; for (let l = 1, pt = 0; l < 99; l++) { pt += Math.floor(l + 300 * Math.pow(2, l / 7)); cum[l + 1] = Math.floor(pt / 4); } // sim/xp.ts's curve: xp must match the level or the first kill resets it
  const GEAR = {
    base: { weapon: 'warden_edge', head: 'steel_helm', chest: 'steel_chestplate', legs: 'steel_greaves' },
    adamant: { weapon: 'adamant_blade', head: 'adamant_helm', chest: 'adamant_chestplate', legs: 'adamant_greaves' },
    marrow: { weapon: 'marrows_edge', head: 'adamant_helm', chest: 'adamant_chestplate', legs: 'adamant_greaves' },
  };
  const setup = (level, gear) => { // the shortcut the report discloses: level and gear set directly, bag emptied
    p.combat.level = level; p.combat.xp = cum[level]; p.maxHp = 100 + 15 * (level - 1);
    const line = gear === 'line'; // docs/world-design.md 3.4: the line gear for the enemy's own level, weapon 36 + 2.6 (L - 16), armour 60 + 2.2 (L - 16); looks like base, stats from the formula
    Object.assign(p.equipment, GEAR[line ? 'base' : gear]);
    let w = 0, a = 0, sw = 2.4;
    for (const id of Object.values(GEAR[line ? 'base' : gear])) { const st = ITEMS[id].stats; w += st.damage ?? 0; a += st.armor ?? 0; if (st.speed) sw = st.speed; }
    if (line) { w = 36 + 2.6 * (level - 16); a = 60 + 2.2 * (level - 16); }
    Object.assign(p.stats, { weaponDamage: w, armor: a, reduction: Math.min(0.75, a / (a + 40)), swingInterval: sw });
    p.hp = p.maxHp; p.energy = p.maxEnergy; p.cd.fill(0); p.gcd = 0; p.queued = null; p.autoAttack = false; p.swing = 0; p.buffs = [];
    p.dead = false; p.outOfCombat = 99; p.inCombat = false; s.targetId = null; s.moveTarget = null; s.interact = null; s.drops = [];
    p.inventory.fill(null);
  };
  const resetEnemy = e => { Object.assign(e, { hp: e.maxHp, state: 'idle', x: e.spawnX, z: e.spawnZ, cast: null, bleed: null, stagger: 0, attackCd: 0, heavyCd: 0, hazardCd: 0, evadeFor: 0, swing: 0 }); };
  const pin = keep => { for (const o of s.enemies) if (!keep(o)) { o.state = 'dead'; o.respawnIn = 1e9; o.deadFor = 99; o.cast = null; } };

  // input: the same events a keyboard and mouse make
  const held = new Set();
  const hold = (code, on) => { if (held.has(code) === on) return; on ? held.add(code) : held.delete(code); window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code })); };
  const tap = code => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); window.dispatchEvent(new KeyboardEvent('keyup', { code })); };
  const click = (x, y) => { canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true })); window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, button: 0, bubbles: true })); };
  const onScreen = sp => sp && sp.x > 40 && sp.x < innerWidth - 40 && sp.y > 40 && sp.y < innerHeight - 160;
  const faceYaw = (x, z) => { view.yaw = Math.atan2(-(x - p.x), -(z - p.z)); };

  // what happened, from every event of every tick (a frame can span several ticks, and the sim clears its event list each one)
  let rec = null;
  const newRec = () => (rec = { firstSwing: null, kills: [], taken: 0, heavies: 0, interrupts: 0, casts: [0, 0, 0, 0, 0, 0, 0], swings: 0, dealt: 0 });
  const push = s.events.push.bind(s.events);
  s.events.push = (...evs) => {
    for (const e of evs) if (rec) {
      if (e.t === 'swing') { rec.swings++; rec.firstSwing ??= s.tick; }
      else if (e.t === 'cast') { rec.casts[e.slot]++; if (e.slot <= 2) rec.firstSwing ??= s.tick; }
      else if (e.t === 'hit') { if (e.target === 'player') { rec.taken += e.amount; if (e.heavy) rec.heavies++; } else rec.dealt += e.amount; }
      else if (e.t === 'interrupt') rec.interrupts++;
      else if (e.t === 'kill') rec.kills.push({ id: e.id, tick: s.tick });
    }
    return push(...evs);
  };

  // the player's hands: auto-attack, then Pummel on a wind-up, else Crushing Blow > Serrated Throw > Strike (the bible's greedy loop), queued inside the GCD window
  let lastSelect = -99, lastAttackTap = -99;
  function fightStep(focus) {
    const chasers = s.enemies.filter(e => e.state === 'chase').sort((a, b) => dist(a, p) - dist(b, p));
    const t = s.enemies.find(e => e.id === s.targetId);
    if (!t || t.state === 'dead' || t.state === 'return') {
      const c = chasers[0] ?? (focus && focus.state !== 'dead' && focus.state !== 'return' ? focus : null);
      if (!c) { hold('KeyW', false); return null; }
      faceYaw(c.x, c.z);
      if (s.tick - lastSelect >= 6) {
        lastSelect = s.tick;
        const sp = view.project(c.x, 1, c.z);
        if (onScreen(sp)) click(sp.x, sp.y); else tap('Tab');
      }
      hold('KeyW', dist(c, p) > 2.2);
      return c;
    }
    faceYaw(t.x, t.z);
    const dd = dist(t, p);
    hold('KeyW', dd > 2.2);
    // KeyX is the attack key (KeyR is an ability-bar slot, so this used to cast whatever R holds and never arm anything). It is a toggle that the sim
    // only applies on its next tick, so assert the state wanted: tap only when disarmed, and not again until that tap has had ticks to land.
    if (!p.autoAttack && dd <= 3 && s.tick - lastAttackTap >= 6) { lastAttackTap = s.tick; tap('KeyX'); }
    const slotKey = i => tap('Digit' + (i + 1));
    if (t.cast && t.cast.t >= 0.25 && p.cd[5] <= 0.02 && p.energy >= 10 && dd <= 3.5) slotKey(5);
    else if (p.queued === null && p.gcd <= 0.4) {
      const w = p.gcd, en = Math.min(p.maxEnergy, p.energy + 8 * w);
      const ok = (slot, cost, range) => p.cd[slot] <= w + 0.02 && en >= cost && dd <= range;
      const adjacent = chasers.filter(e => dist(e, p) <= 3.5).length;
      const windHeal = 45 * (1 + 0.07 * (p.combat.level - 1)); // Second Wind's heal (sim/data.ts: 45 x powerForLevel, no talents)
      if (((cfg.heal && p.maxHp - p.hp >= windHeal) || (cfg.tactics && p.hp < 0.45 * p.maxHp)) && ok(3, 25, 99)) slotKey(3); // --heal: Second Wind on cooldown when none of it is wasted; --tactics: also when low, and Cleave on a crowd
      else if (cfg.tactics && adjacent >= 2 && ok(4, 25, 3.5)) slotKey(4);
      else if (ok(1, 30, 3)) slotKey(1);
      else if (ok(2, 20, 9) && !t.bleed) slotKey(2);
      else if (ok(0, 10, 3)) slotKey(0);
    }
    return t;
  }

  // ttk: one isolated fight, the player placed 7 units off
  const trial = async (e, level, gear) => {
    setup(level, gear);
    resetEnemy(e); pin(o => o === e);
    const toward = e.spawnX > 880 ? { x: 881 - e.spawnX, z: 8 - e.spawnZ } : { x: 0, z: Math.sign(8 - e.spawnZ) || 1 }; // toward the town, or the road's axis
    const base =Math.atan2(toward.z, toward.x);
    // Rotwood Cultist spawn 92 (HOM-85) took 63-92 s to kill and dealt 0: it sits in the Root Warren, whose floor is a 22-wide room, and 7 units "toward the road"
    // put the player in the Thornwood above it, a different region the cultist neither reaches nor sees across. So the stand-off point is the first of
    // the toward-direction and then every 45 degrees round it that is on the enemy's own floor and clear of the region's standing stones; none is a bench fault.
    const reg = d.world.regionAt(e.spawnX, e.spawnZ);
    const spot = [0, 1, -1, 2, -2, 3, -3, 4].map(k => ({ x: e.spawnX + Math.cos(base + k * Math.PI / 4) * 7, z: e.spawnZ + Math.sin(base + k * Math.PI / 4) * 7 }))
      .find(c => d.world.regionAt(c.x, c.z) === reg && !(reg.obstacles ?? []).some(o => Math.hypot(o.x - c.x, o.z - c.z) < o.r + 1.5));
    if (!spot) throw new Error(`ttk: no stand-off point on ${e.type} #${e.id}'s own floor (${reg?.id}) at (${e.spawnX.toFixed(1)}, ${e.spawnZ.toFixed(1)})`);
    p.x = spot.x; p.z = spot.z; p.facing = Math.atan2(e.spawnX - p.x, e.spawnZ - p.z);
    newRec(); const start = s.tick;
    while (!rec.kills.some(k => k.id === e.id) && !p.dead && s.tick - start < 120 * 30) { fightStep(e); await frame(); }
    hold('KeyW', false);
    const killed = rec.kills.find(k => k.id === e.id);
    const r = { type: e.type, id: e.id, level, gear, maxHp: p.maxHp, killed: !!killed, died: p.dead, ttk: killed && rec.firstSwing != null ? (killed.tick - rec.firstSwing) / 30 : null,
      lead: rec.firstSwing != null ? (rec.firstSwing - start) / 30 : null, taken: rec.taken, takenPct: 100 * rec.taken / p.maxHp, heavies: rec.heavies, interrupts: rec.interrupts, casts: rec.casts, swings: rec.swings, dealt: rec.dealt };
    for (let i = 0; i < 20; i++) await frame();
    return r;
  };

  // loop: the natural layout. fight -> loot -> walk to the next camp -> wait for health -> fight
  const loop = async (type, level, gear, count, thr) => {
    setup(level, gear);
    const camps = s.enemies.filter(e => e.type === type);
    pin(o => o.type === type); camps.forEach(resetEnemy);
    const standoff = (e, from) => { const dx = e.x - from.x, dz = e.z - from.z, n = Math.hypot(dx, dz) || 1; return { x: e.x - (dx / n) * 16, z: e.z - (dz / n) * 16 }; };
    const nearestCamp = () => camps.filter(e => e.state === 'idle').sort((a, b) => dist(a, p) - dist(b, p))[0];
    const first = camps[0], axis = first.spawnX > 880 ? { x: 881, z: 8 } : { x: first.spawnX, z: 8 };
    Object.assign(p, standoff(first, axis)); p.facing = Math.atan2(first.x - p.x, first.z - p.z);
    const fights = []; const t0 = s.tick, cap = () => s.tick - t0 < 1500 * 30; let prev = null;
    const chasing = () => s.enemies.some(e => e.state === 'chase');
    const walk = async goal => { // click-to-move legs the camera can see
      while (dist(p, goal) > 1.5 && !chasing() && cap()) {
        const dd = dist(p, goal); faceYaw(goal.x, goal.z);
        let leg = Math.min(dd, 12), sp = null;
        for (; leg >= 3; leg -= 3) { sp = view.project(p.x + ((goal.x - p.x) / dd) * leg, 0, p.z + ((goal.z - p.z) / dd) * leg); if (onScreen(sp)) break; sp = null; }
        if (!sp) return 'noclick';
        await frame(); click(sp.x, sp.y);
        const legEnd = s.tick + 4 * 30;
        while (s.moveTarget && !chasing() && s.tick < legEnd) await frame();
        await frame();
      }
      return 'ok';
    };
    while (fights.length < count && cap()) {
      const tw = s.tick; let target = nearestCamp();
      while (!target && cap()) { await frame(); target = nearestCamp(); }
      if (!target) break;
      const waitedRespawn = s.tick - tw, S = standoff(target, p), walkStart = s.tick;
      if (!chasing()) await walk(S);
      const arrive = s.tick;
      while (p.hp < thr * p.maxHp && !chasing() && cap()) await frame();
      const ready = s.tick, hpAtEngage = p.hp / p.maxHp;
      newRec(); const fs = s.tick;
      while (s.tick - fs < 120 * 30) { const c = fightStep(target); if (!c && !chasing()) break; await frame(); }
      hold('KeyW', false);
      const killTick = rec.kills.length ? Math.max(...rec.kills.map(k => k.tick)) : null;
      const { firstSwing, taken } = rec, kills = rec.kills.length, died = p.dead;
      const lootStart = s.tick; // click each drop near the fight, as the player would
      for (let guard = 0; guard < 6 && s.drops.length; guard++) {
        const dr = s.drops.filter(x => dist(x, p) < 10).sort((a, b) => dist(a, p) - dist(b, p))[0];
        if (!dr) break;
        faceYaw(dr.x, dr.z); await frame(); await frame();
        const sp = view.project(dr.x, 0.3, dr.z);
        if (onScreen(sp)) click(sp.x, sp.y); else { s.drops = s.drops.filter(x => x !== dr); continue; }
        const until = s.tick + 4 * 30;
        while (s.drops.includes(dr) && s.tick < until) await frame();
        if (s.drops.includes(dr)) s.drops = s.drops.filter(x => x !== dr);
      }
      const lootDone = s.tick;
      p.inventory.fill(null); p.combat.xp = cum[level];
      const f = { n: fights.length, kills, died, firstSwing, killTick, lootStart, lootDone, walkStart, arrive, ready, hpAtEngage, taken, takenPct: 100 * taken / p.maxHp, waitedRespawn };
      if (prev && firstSwing != null && prev.firstSwing != null) {
        prev.loop = (firstSwing - prev.firstSwing) / 30; // swing to next swing: the bible's 40 s
        prev.parts = { fight: (prev.killTick - prev.firstSwing) / 30, loot: (prev.lootDone - prev.killTick) / 30, respawnWait: f.waitedRespawn / 30, walk: (f.arrive - f.walkStart) / 30, regenWait: (f.ready - f.arrive) / 30, engage: (firstSwing - f.ready) / 30 };
      }
      fights.push(f); prev = f;
      if (died) break;
      if (camps.length === 1) resetEnemy(camps[0]); // a lone camp's respawn is a clock this bench does not wait out: the "walk" is back to its 16 u stand-off
    }
    return fights;
  };

  // HOM-88: camps of three, found by clustering the spawn list (link distance 25), fought together and ridden through
  const clusters = size => {
    const es = s.enemies, grp = es.map((_, i) => i), find = i => (grp[i] === i ? i : (grp[i] = find(grp[i])));
    es.forEach((a, i) => es.forEach((b, j) => { if (i < j && Math.hypot(a.spawnX - b.spawnX, a.spawnZ - b.spawnZ) <= cfg.link) grp[find(i)] = find(j); }));
    const by = {}; es.forEach((e, i) => (by[find(i)] ??= []).push(e));
    return Object.values(by).filter(g => g.length === size).map(g => ({ members: g, cx: g.reduce((a, e) => a + e.spawnX, 0) / g.length, cz: g.reduce((a, e) => a + e.spawnZ, 0) / g.length }));
  };
  const nameOf = c => c.members.map(e => e.type).join('+') + `@${c.cx.toFixed(0)},${c.cz.toFixed(0)}`;
  const clearSpot = (x, z, reg) => d.world.regionAt(x, z) === reg && !(reg.obstacles ?? []).some(o => Math.hypot(o.x - x, o.z - z) < o.r + 1.5);
  const clearLine = (a, b, reg) => { const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2); for (let i = 0; i <= n; i++) if (!clearSpot(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, reg)) return false; return true; };

  const campFight = async (c, level, gear) => {
    setup(level, gear); c.members.forEach(resetEnemy); pin(o => c.members.includes(o));
    const reg = d.world.regionAt(c.cx, c.cz), R = cfg.standoff;
    const spot = [0, 1, 2, 3, 4, 5, 6, 7].map(k => ({ x: c.cx + Math.cos(k * Math.PI / 4) * R, z: c.cz + Math.sin(k * Math.PI / 4) * R })).find(q => clearSpot(q.x, q.z, reg));
    if (!spot) return { name: nameOf(c), error: 'no stand-off point' };
    p.x = spot.x; p.z = spot.z; p.facing = Math.atan2(c.cx - p.x, c.cz - p.z);
    newRec(); const start = s.tick; let minHp = p.hp;
    const alive = () => c.members.filter(e => e.state !== 'dead');
    while (alive().length && !p.dead && s.tick - start < 150 * 30) {
      const near = alive().sort((a, b) => dist(a, p) - dist(b, p))[0]; fightStep(near); minHp = Math.min(minHp, p.hp); await frame();
    }
    hold('KeyW', false);
    const left = alive().length;
    const r = { name: nameOf(c), level, gear, tactics: !!cfg.tactics, died: p.dead, killed: c.members.length - left, clear: left ? null : (Math.max(...rec.kills.map(k => k.tick)) - start) / 30, secs: (s.tick - start) / 30, takenPct: 100 * rec.taken / p.maxHp, minHpPct: 100 * minHp / p.maxHp };
    for (let i = 0; i < 20; i++) await frame();
    return r;
  };

  // ride: mounted 45 units short of the camp, W held toward a point 45 past it (straight through the middle, or 12 to the side); keeps running on foot if thrown
  const rideTrial = async (c, level, gear, offset) => {
    setup(level, gear); c.members.forEach(resetEnemy); pin(o => c.members.includes(o));
    p.mounts = ['courser']; p.mounted = true;
    const reg = d.world.regionAt(c.cx, c.cz); let line = null;
    for (const L of [45, 35, 25]) for (let k = 0; k < 8 && !line; k++) {
      const ux = Math.cos(k * Math.PI / 4), uz = Math.sin(k * Math.PI / 4), px = -uz, pz = ux;
      const a = { x: c.cx - ux * L + px * offset, z: c.cz - uz * L + pz * offset }, b = { x: c.cx + ux * L + px * offset, z: c.cz + uz * L + pz * offset };
      if (clearLine(a, b, reg)) line = { a, b, L };
    }
    if (!line) return { name: nameOf(c), offset, error: 'no clear line through the region' };
    p.x = line.a.x; p.z = line.a.z; p.facing = Math.atan2(line.b.x - p.x, line.b.z - p.z);
    newRec(); const start = s.tick; let firstHit = null, thrown = null;
    while (!p.dead && dist(p, line.b) > 3 && s.tick - start < 90 * 30) {
      faceYaw(line.b.x, line.b.z); hold('KeyW', true);
      if (firstHit === null && rec.taken > 0) firstHit = { t: +((s.tick - start) / 30).toFixed(1), toGoal: +dist(p, line.b).toFixed(1), toCamp: +Math.hypot(p.x - c.cx, p.z - c.cz).toFixed(1) };
      if (thrown === null && !p.mounted) thrown = +((s.tick - start) / 30).toFixed(1);
      await frame();
    }
    hold('KeyW', false);
    const chasers = c.members.filter(e => e.state === 'chase');
    const r = { name: nameOf(c), level, gear, offset, line: line.L, reached: !p.dead && dist(p, line.b) <= 3, died: p.dead, secs: (s.tick - start) / 30, takenPct: 100 * rec.taken / p.maxHp, firstHit, thrownAt: thrown, stillMounted: p.mounted, chasersAtGoal: chasers.length, chaserGap: chasers.map(e => +dist(e, p).toFixed(1)) };
    for (let i = 0; i < 20; i++) await frame();
    return r;
  };

  const out = [];
  if (cfg.mode === 'camp' || cfg.mode === 'ride') {
    for (const c of clusters(cfg.size)) {
      const level = Math.max(...c.members.map(e => cfg.levels[e.type] ?? 1));
      for (const gear of level >= 18 ? cfg.gearHi : cfg.gearLo) for (let i = 0; i < cfg.n; i++) {
        if (cfg.mode === 'camp') out.push(await campFight(c, level, gear));
        else for (const off of [0, 12]) out.push(await rideTrial(c, level, gear, off));
      }
    }
  } else if (cfg.mode === 'clusters') {
    for (const c of clusters(cfg.size)) out.push({ name: nameOf(c), members: c.members.map(e => [e.id, e.type]) });
  } else if (cfg.mode === 'ttk') {
    for (const run of cfg.runs) {
      const spawns = s.enemies.filter(e => e.type === run.type);
      for (let i = 0; i < run.n; i++) out.push(await trial(spawns[i % spawns.length], run.level, run.gear));
    }
  } else {
    for (const run of cfg.runs) out.push({ type: run.type, level: run.level, gear: run.gear, thr: cfg.thr, fights: await loop(run.type, run.level, run.gear, run.n, cfg.thr) });
  }
  return out;
}

/** Node side of --mode: build the run list (an enemy's parity level is read from sim/data.ts, so it cannot drift) and print mean / spread. */
async function runBot(page) {
  const data = readFileSync(join(root, 'src', 'sim', 'data.ts'), 'utf8'), levels = {};
  for (const m of data.matchAll(/^ {2}(\w+): \{ name: '[^']*', level: (\d+),/gm)) levels[m[1]] = Number(m[2]);
  const types = opt('types', 'marsh_hog').split(','), n = Number(opt('n', 20)), gear = opt('gear', 'base'), thr = Number(opt('health', 0.8));
  const runs = types.map(type => ({ type, n, gear, level: opt('level', '') ? Number(opt('level', '')) : levels[type] }));
  page.on('console', m => { if (m.type() === 'error') console.error('page:', m.text()); });
  const t0 = Date.now();
  const res = await page.evaluate(botInPage, { mode, runs, thr, tactics: process.argv.includes('--tactics'), heal: mode === 'ttk' ? !process.argv.includes('--no-heal') : process.argv.includes('--heal'), n, levels, standoff: Number(opt('standoff', 13)), link: Number(opt('link', 13)), size: Number(opt('size', 3)), gearLo: opt('gearlo', 'base').split(','), gearHi: opt('gearhi', 'adamant,marrow').split(',') });
  const wall = ((Date.now() - t0) / 1000).toFixed(0);
  if (mode === 'camp' || mode === 'ride' || mode === 'clusters') {
    writeFileSync(join(shots, `bot-${mode}-${tag}.json`), JSON.stringify(res, null, 1));
    for (const r of res) console.log(JSON.stringify(r));
    console.log(`wall ${wall}s at speed ${speed}`);
    return;
  }
  writeFileSync(join(shots, `bot-${mode}-${tag}.json`), JSON.stringify({ mode, gear, thr, speed, n, tactics: process.argv.includes('--tactics'), heal: mode === 'ttk' ? !process.argv.includes('--no-heal') : process.argv.includes('--heal'), runs, res }, null, 1));
  const stat = a => { a = a.filter(x => x != null); if (!a.length) return { n: 0 }; const m = a.reduce((x, y) => x + y, 0) / a.length, sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); const sorted = [...a].sort((x, y) => x - y), h = sorted.length >> 1, med = sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
    return { n: a.length, mean: +m.toFixed(2), median: +med.toFixed(2), sd: +sd.toFixed(2), min: +Math.min(...a).toFixed(1), max: +Math.max(...a).toFixed(1) }; };
  if (mode === 'ttk') {
    console.table(runs.map(r => { const t = res.filter(x => x.type === r.type); return { type: r.type, level: r.level, gear, fights: t.length, died: t.filter(x => x.died).length, swings: JSON.stringify(stat(t.map(x => x.swings))), noSwing: t.filter(x => x.swings === 0).length, ttk: JSON.stringify(stat(t.map(x => x.ttk))), hpPct: JSON.stringify(stat(t.map(x => x.takenPct))) }; }));
  } else {
    console.table(res.map(r => { const f = r.fights.filter(x => x.loop != null); return { type: r.type, level: r.level, fights: r.fights.length, kills: r.fights.reduce((a, x) => a + x.kills, 0), loop: JSON.stringify(stat(f.map(x => x.loop))), fight: stat(f.map(x => x.parts.fight)).mean, loot: stat(f.map(x => x.parts.loot)).mean, walk: stat(f.map(x => x.parts.walk)).mean, regen: stat(f.map(x => x.parts.regenWait)).mean, engage: stat(f.map(x => x.parts.engage)).mean, respawn: stat(f.map(x => x.parts.respawnWait)).mean }; }));
  }
  console.log(`wall ${wall}s at speed ${speed}`);
}

if (!process.argv.includes('--skip-build')) await build({ root, logLevel: 'warn' });
const server = await preview({ root, logLevel: 'error', preview: { port, open: false } });
const browser = await chromium.launch({ args: ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('pageerror', String(e)));
if (mode && speed !== 1) await page.addInitScript(k => { // sim time runs k times faster than the wall clock: rAF timestamps are scaled, the sim still ticks at its fixed 30 Hz
  const raf = window.requestAnimationFrame.bind(window); let t0 = null;
  window.requestAnimationFrame = cb => raf(now => { if (t0 === null) t0 = now; cb(t0 + (now - t0) * k); });
}, speed);
// Program links come from the game's own ?debug=1 trace (src/trace.ts wraps linkProgram), so there is one copy of that wrapper.
await page.goto(`${server.resolvedUrls.local[0]}?debug=1`);
await page.waitForFunction(() => window.__debug, null, { timeout: 120000 });
await page.evaluate(() => window.__debug.view.modelsReady);
await page.locator('.helpok').click({ timeout: 3000 }).catch(() => {});
await page.evaluate(q => window.__debug.view.setQuality(q), quality);
if (mode) { await runBot(page); await browser.close(); await server.close(); process.exit(0); }
const setup = await page.evaluate(() => {
  const d = window.__debug, s = d.sim, p = s.player, e = s.enemies.find(x => x.type === 'brute' && x.state !== 'dead');
  p.hp = p.maxHp = 99999; p.combat.level = 12; // every ability unlocked; the player cannot die during the trace
  p.x = e.x + 4; p.z = e.z + 4; d.view.yaw = 0.8; d.view.pitch = 0.45; d.view.distance = 9; d.step(); d.step();
  s.targetId = e.id;
  return { brute: [e.x, e.z] };
});
await page.evaluate(() => new Promise(res => { let n = 0; const f = () => (++n >= 60 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); })); // idle warm-up: nothing combat-related has rendered yet
await page.evaluate(() => { window.__frameTrace.links.length = 0; });
await page.evaluate(({ secs }) => {
  const d = window.__debug, frames = [], ev = [];
  window.__trace = { frames, ev, t0: performance.now() };
  let last = 0;
  const loop = now => {
    if (last) frames.push({ t: now - window.__trace.t0, dt: now - last, rings: d.scene.children.filter(c => c.geometry && c.geometry.type === 'TorusGeometry').length, programs: d.renderer.info.programs.length, events: d.sim.events.map(e => e.t + (e.slot ?? '')).join(',') });
    last = now;
    if (now - window.__trace.t0 < secs * 1000) requestAnimationFrame(loop); else window.__trace.done = true;
  };
  requestAnimationFrame(loop);
}, { secs });
const inject = process.argv.includes('--inject');
const keys = ['Digit1', 'Digit2', 'Digit4', 'Digit3', 'Digit5', 'Digit6'];
const t0 = Date.now(); let i = 0;
while (Date.now() - t0 < secs * 1000) {
  await page.keyboard.press(i % 7 === 0 ? 'KeyR' : keys[i % keys.length]);
  if (i === 3) await page.screenshot({ path: join(shots, `combat-${tag}.png`) });
  if (inject && i === 20) await page.evaluate(() => { // a brand-new program: a real link the game never asked for
    const d = window.__debug; let m; d.scene.traverse(o => { if (!m && o.isMesh && o.material && o.material.isMeshStandardMaterial) m = o; });
    m.material = m.material.clone(); m.material.customProgramCacheKey = () => 'bench-inject'; m.material.needsUpdate = true;
  });
  if (inject && i === 40) await page.evaluate(() => requestAnimationFrame(() => { const t = performance.now(); while (performance.now() - t < 60); }));
  i++; await page.waitForTimeout(350);
}
await page.waitForFunction(() => window.__trace.done);
const dl = page.waitForEvent('download');
await page.keyboard.press('KeyT');
await (await dl).saveAs(join(shots, `trace-${tag}.json`));
const out = await page.evaluate(() => ({ frames: window.__trace.frames, t0: window.__trace.t0, links: window.__frameTrace.links.map(l => ({ at: l.at, ms: l.ms, key: l.key })) }));
await browser.close(); await server.close();
const f = out.frames, dts = f.map(x => x.dt).sort((a, b) => a - b), q = p => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))];
const links = out.links.map(l => ({ t: l.at - out.t0, ms: l.ms }));
const stats = { setup, frames: f.length, mean: dts.reduce((a, b) => a + b, 0) / dts.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: dts.at(-1), over2x: f.filter(x => x.dt > 2 * q(0.5)).length, links: links.length, linkMs: links.reduce((a, b) => a + b.ms, 0) };
writeFileSync(join(shots, `combat-${tag}.json`), JSON.stringify({ stats, links, frames: f }));
console.log(JSON.stringify(stats));
const worst = [...f].sort((a, b) => b.dt - a.dt).slice(0, 12);
console.table(worst.map(x => ({ t: x.t.toFixed(0), dt: x.dt.toFixed(1), rings: x.rings, programs: x.programs, events: x.events.slice(0, 40), linkInFrame: links.filter(l => l.t > x.t - x.dt - 5 && l.t <= x.t).map(l => l.ms.toFixed(1)).join('/') })));
console.log('links:', links.map(l => `${l.t.toFixed(0)}ms:${l.ms.toFixed(1)}`).join(' '));
const tr = JSON.parse((await import('node:fs')).readFileSync(join(shots, `trace-${tag}.json`), 'utf8'));
console.log('in-game trace:', tr.meta.frames, 'frames,', tr.meta.bufferSeconds, 's, gpuTimer:', tr.meta.gpuTimer, ', heap:', tr.meta.jsHeap, ',', tr.meta.renderer);
console.table(tr.spikes.slice(0, 6).map(x => ({ dt: x.dt, work: x.jsWorkMs, sim: x.simMs, draw: x.drawMs, gpu: x.gpuMs, link: x.linkMsInFrame, heapD: x.heapDeltaMB, progD: x.programsDelta, events: x.events.join(','), longTask: x.longTasks.map(k => k.ms).join('/') })));



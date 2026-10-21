// Draws every item thumbnail, every ability and talent icon, every NPC portrait and every enemy's face on the Forge image generator running on this PC (HOM-135, HOM-144).
//
//   npx tsx scripts/gen-art.ts                       everything that is not drawn yet
//   npx tsx scripts/gen-art.ts --force               redraw everything
//   npx tsx scripts/gen-art.ts --only steel_sword,hale
//   npx tsx scripts/gen-art.ts --seed 3 --force      the same subjects, a different roll of the dice
//
// Forge is started here if it is not already answering, and started the way a background service
// should be: no console window, no browser tab (webui-user.bat carries --api, and Forge's own
// auto_launch_browser setting is off), because the human is sitting at this machine.
// Two passes, because they want different machines:
//
//   1. generate   one 1024x1024 PNG per subject, cached in .art-cache/ so a reframe is free. Takes a
//      GPU slot from bench/browser.mjs for the whole pass, the same lock every bench queues on, so a
//      generation run and a bench never render at once on the human's card.
//   2. frame      every PNG is cropped to its subject's bounding box, squared about its centre, and
//      scaled onto one canvas size with one margin, so a boot and a greatsword end up the same size
//      in the same place. That is what makes the set look framed rather than merely drawn alike.
//      Pure 2D canvas in headless Chromium (like bench/sheet.mjs): no GPU slot, nothing rendered.
import { chromium } from 'playwright';
import { request, get } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { acquireGpuSlot } from '../bench/browser.mjs';
import { ITEMS } from '../src/sim/items';
import { ABILITIES, abilityArtId, ENEMY_TYPES } from '../src/sim/data';
import { TALENTS } from '../src/sim/talents';
import { NPCS } from '../src/sim/quest';
import { VENDORS } from '../src/sim/shop';
import { FLIGHT_MASTERS } from '../src/sim/flight';
import { ABILITY_STYLE, ABILITY_SUBJECTS, ENEMY_STYLE, ENEMY_SUBJECTS, ITEM_STYLE, ITEM_SUBJECTS, NEGATIVE, PORTRAIT_STYLE, PORTRAIT_SUBJECTS, REROLLS, TALENT_SUBJECTS } from './art-subjects';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.art-cache');
const OUT = join(ROOT, 'assets', 'art');

const API = process.env.FORGE_API ?? 'http://127.0.0.1:7860';
const FORGE_RUN = process.env.FORGE_RUN ?? 'C:\\Users\\timjn\\AI\\Forge\\run.bat';
// DreamShaperXL Turbo's own numbers: a handful of steps at a low guidance. Anything heavier burns it out.
const SAMPLER = { sampler_name: 'DPM++ SDE', scheduler: 'Karras', steps: 8, cfg_scale: 2 };
const GEN_SIZE = 1024;                                      // SDXL's native square
const BACK = [20, 20, 22];                                  // the one charcoal every finished piece sits on

/** The kinds of art, and the frame each one is cut to. `fill` is how much of the canvas the subject spans. */
const KINDS = {
  items: { subjects: ITEM_SUBJECTS as Record<string, string>, style: ITEM_STYLE, size: 192, fill: 0.84 },
  // An ability shares the item's frame exactly: the two sit in the same action bar slot, so a sword on the bar
  // must not be drawn to a different size than the Strike beside it.
  abilities: { subjects: ABILITY_SUBJECTS as Record<string, string>, style: ABILITY_STYLE, size: 192, fill: 0.84 },
  // A talent wears the ability's style and the ability's frame: it is the same kind of emblem, and the two are
  // read side by side when a capstone hands its ability over.
  talents: { subjects: TALENT_SUBJECTS as Record<string, string>, style: ABILITY_STYLE, size: 192, fill: 0.84 },
  portraits: { subjects: PORTRAIT_SUBJECTS as Record<string, string>, style: PORTRAIT_STYLE, size: 320, fill: 0.96 },
  // An enemy's face is framed like an NPC's and cut smaller: it is only ever seen in the 56px box of the target
  // frame, where 320 would be five times what the box can show and five times the weight of a set three times
  // the size of the portraits.
  enemies: { subjects: ENEMY_SUBJECTS as Record<string, string>, style: ENEMY_STYLE, size: 192, fill: 0.96 },
};
type Kind = keyof typeof KINDS;
const KIND_NAMES = Object.keys(KINDS) as Kind[];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1] ?? null; };
const force = flag('--force');
const only = value('--only')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
const seedOffset = Number(value('--seed') ?? 0);

/**
 * Same id, same picture, run after run: the seed is the id, nudged by that id's entry in REROLLS.
 * --seed rerolls the whole set together.
 */
const seedOf = (kind: Kind, id: string) => (([...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0)
  + seedOffset + (REROLLS[`${kind}/${id}`] ?? 0) * 7919) % 2_147_483_647;

/**
 * Every item, ability, talent and NPC has a subject, and every subject is a real one. Without this the
 * art silently drifts from sim/items.ts the first time someone adds a sword.
 */
function checkCoverage() {
  const abilityIds = ABILITIES.map(abilityArtId);
  const talentIds = TALENTS.map(t => t.id);
  const portraitIds = [
    ...NPCS.map(n => n.id),
    ...VENDORS.map(v => `vendor_${v.id}`),
    ...FLIGHT_MASTERS.map(m => `flight_${m.id}`),
  ];
  const problems = [
    ...Object.keys(ITEMS).filter(id => !ITEM_SUBJECTS[id as keyof typeof ITEM_SUBJECTS]).map(id => `item ${id} has no subject in scripts/art-subjects.ts`),
    ...Object.keys(ITEM_SUBJECTS).filter(id => !ITEMS[id]).map(id => `subject ${id} is not an item in src/sim/items.ts`),
    ...abilityIds.filter(id => !ABILITY_SUBJECTS[id as keyof typeof ABILITY_SUBJECTS]).map(id => `ability ${id} has no subject in scripts/art-subjects.ts`),
    ...Object.keys(ABILITY_SUBJECTS).filter(id => !abilityIds.includes(id)).map(id => `subject ${id} is not an ability in src/sim/data.ts`),
    ...talentIds.filter(id => !TALENT_SUBJECTS[id as keyof typeof TALENT_SUBJECTS]).map(id => `talent ${id} has no subject in scripts/art-subjects.ts`),
    ...Object.keys(TALENT_SUBJECTS).filter(id => !talentIds.includes(id)).map(id => `subject ${id} is not a talent in src/sim/talents.ts`),
    ...portraitIds.filter(id => !PORTRAIT_SUBJECTS[id as keyof typeof PORTRAIT_SUBJECTS]).map(id => `npc ${id} has no portrait subject`),
    ...Object.keys(PORTRAIT_SUBJECTS).filter(id => !portraitIds.includes(id)).map(id => `portrait ${id} is nobody in the game`),
    ...Object.keys(ENEMY_TYPES).filter(id => !ENEMY_SUBJECTS[id as keyof typeof ENEMY_SUBJECTS]).map(id => `enemy ${id} has no subject in scripts/art-subjects.ts`),
    ...Object.keys(ENEMY_SUBJECTS).filter(id => !ENEMY_TYPES[id]).map(id => `subject ${id} is not an enemy in src/sim/data.ts`),
    // A reroll key that matches no subject is a silent no-op: the picture it was meant to fix stays
    // on the roll that was wrong.
    ...Object.keys(REROLLS).filter(key => {
      const [kind, id] = key.split('/');
      return !KINDS[kind as Kind]?.subjects[id];
    }).map(key => `reroll ${key} is not a kind/id with a subject in scripts/art-subjects.ts`),
  ];
  if (problems.length) throw new Error(`gen-art: art and sim data disagree:\n  ${problems.join('\n  ')}`);
}

function post(path: string, body: unknown): Promise<any> {
  const url = new URL(API);
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    // node:http has no response deadline of its own, which is what this needs: the first image off a
    // cold checkpoint is a couple of minutes while the model moves onto the card.
    const req = request({ hostname: url.hostname, port: url.port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) return reject(new Error(`${path} -> ${res.statusCode}: ${text.slice(0, 300)}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`${path}: ${(e as Error).message}`)); }
      });
    });
    req.on('error', e => reject(new Error(`${API} stopped answering (${e.message})`)));
    req.end(data);
  });
}

/** Is Forge's API up? Nothing listening resolves false rather than throwing. */
const alive = () => new Promise<boolean>(done => {
  get(`${API}/sdapi/v1/options`, res => { res.resume(); done(res.statusCode === 200); })
    .on('error', () => done(false))
    .setTimeout(5000, function () { this.destroy(); done(false); });
});

/**
 * Forge answers, or it is started here and we wait for it: detached so it outlives this run (the
 * next one then costs nothing), and hidden, so nothing lands on the human's screen.
 */
async function ensureForge() {
  if (await alive()) return;
  console.log(`gen-art: Forge is not up; starting ${FORGE_RUN} hidden`);
  spawn('cmd.exe', ['/c', FORGE_RUN], { cwd: dirname(FORGE_RUN), detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  // A cold start installs nothing but does move a checkpoint onto the card: minutes, not seconds.
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (await alive()) return console.log(`gen-art: Forge is up after ${(i + 1) * 5}s`);
  }
  throw new Error(`gen-art: Forge never came up on ${API} (started ${FORGE_RUN})`);
}

/** One subject, one PNG in the cache. */
async function draw(kind: Kind, id: string, raw: string) {
  const k = KINDS[kind];
  const j = await post('/sdapi/v1/txt2img', {
    prompt: `${k.subjects[id]}, ${k.style}`, negative_prompt: NEGATIVE,
    width: GEN_SIZE, height: GEN_SIZE, batch_size: 1, seed: seedOf(kind, id), ...SAMPLER,
  });
  if (!j.images?.[0]) throw new Error(`gen-art: Forge returned no image for ${kind}/${id}`);
  writeFileSync(raw, Buffer.from(j.images[0], 'base64'));
}

/** The subjects still wanting a pass, in a stable order. */
const wanted = (kind: Kind) => Object.keys(KINDS[kind].subjects)
  .filter(id => !only || only.includes(id))
  .filter(id => force || !existsSync(join(CACHE, kind, `${id}.png`)));

async function generate() {
  const todo = KIND_NAMES.flatMap(kind => wanted(kind).map(id => ({ kind, id })));
  if (!todo.length) return console.log('gen-art: every subject is already drawn (--force to redraw)');
  console.log(`gen-art: drawing ${todo.length} subject${todo.length > 1 ? 's' : ''} on ${API}`);
  await ensureForge();
  const slot = await acquireGpuSlot();
  try {
    const t0 = Date.now();
    for (const [i, { kind, id }] of todo.entries()) {
      await draw(kind, id, join(CACHE, kind, `${id}.png`));
      const each = (Date.now() - t0) / (i + 1);
      console.log(`  ${String(i + 1).padStart(3)}/${todo.length}  ${kind}/${id}  (${(each / 1000).toFixed(1)}s each, ~${Math.round(each * (todo.length - i - 1) / 60000)}min left)`);
    }
  } finally { slot.release(); }
}

/**
 * Crop to the subject, square that about its centre, scale it to one size with one margin, and put
 * it on the one backdrop, so every icon comes out the same picture size in the same place on the
 * same charcoal.
 *
 * This runs in the page, so it must hold no nested named function: tsx wraps those in a `__name()`
 * that exists in node and not in the browser, and the ReferenceError lands inside an event handler
 * where nothing is waiting for it.
 */
const frameInPage = ([src, size, fill, back]: [string, number, number, number[]]) => new Promise<string>(done => {
  const img = new Image();
  img.onload = () => {
    const w = img.width, h = img.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, w, h).data;
    // Only pixels brighter than the backdrop count as subject, and the backdrop is read off the frame's
    // own border rather than assumed black: the model paints it near-black, not black, and a shade
    // darker on one run than the next. The upper quartile of the border, not its brightest pixel,
    // because a portrait's shoulders run off the bottom edge and are not backdrop.
    const edge: number[] = [];
    for (let x = 0; x < w; x++) for (const i of [x * 4, ((h - 1) * w + x) * 4]) edge.push(Math.max(px[i], px[i + 1], px[i + 2]));
    for (let y = 0; y < h; y++) for (const i of [y * w * 4, (y * w + w - 1) * 4]) edge.push(Math.max(px[i], px[i + 1], px[i + 2]));
    edge.sort((a, b) => a - b);
    // A stray speck must not count as subject either, so a row or column needs a few lit pixels
    // before the bounding box is allowed to reach it.
    // Never below the backdrop this is all being put on, or the flood that flattens it cannot leave
    // the border it starts from.
    const LIT = Math.min(140, Math.max(24, edge[Math.floor(edge.length * 0.75)] + 20)), MIN = 3;
    const rows = new Int32Array(h), cols = new Int32Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.max(px[i], px[i + 1], px[i + 2]) > LIT) { rows[y]++; cols[x]++; }
    }
    let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
    while (y0 < y1 && rows[y0] < MIN) y0++;
    while (y1 > y0 && rows[y1] < MIN) y1--;
    while (x0 < x1 && cols[x0] < MIN) x0++;
    while (x1 > x0 && cols[x1] < MIN) x1--;
    // A box that is nearly the whole frame, or nearly nothing, means the subject never separated from
    // the backdrop. Take the whole frame rather than blow up a crop of noise.
    const area = ((x1 - x0) * (y1 - y0)) / (w * h);
    if (!(area > 0.02 && area < 0.95)) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    const o = out.getContext('2d')!;
    o.fillStyle = `rgb(${back[0]},${back[1]},${back[2]})`;
    o.fillRect(0, 0, size, size);
    o.imageSmoothingQuality = 'high';
    const to = size * fill;
    o.drawImage(img, cx - side / 2, cy - side / 2, side, side, (size - to) / 2, (size - to) / 2, to, to);
    // One backdrop for the whole set, not one per picture. The model paints its charcoal a shade
    // lighter on one subject than the next, and tiled together in a bag that reads as a patchwork of
    // grey boxes. So the backdrop is flooded out from the margin and replaced: flooded, not simply
    // "every dark pixel", because a black blade has its own dark that is not backdrop.
    const frame = o.getImageData(0, 0, size, size), q = frame.data;
    const seen = new Uint8Array(size * size), stack: number[] = [];
    for (let i = 0; i < size; i++) stack.push(i, (size - 1) * size + i, i * size, i * size + size - 1);
    while (stack.length) {
      const p = stack.pop()!, i = p * 4;
      if (seen[p] || Math.max(q[i], q[i + 1], q[i + 2]) > LIT) continue;
      seen[p] = 1;
      const x = p % size;
      if (x > 0) stack.push(p - 1);
      if (x < size - 1) stack.push(p + 1);
      if (p >= size) stack.push(p - size);
      if (p < size * (size - 1)) stack.push(p + size);
    }
    for (let p = 0; p < seen.length; p++) {
      if (!seen[p]) continue;
      // The subject's antialiased edge sits just under the threshold, so fade into the backdrop
      // over the last stretch of it rather than cutting a hard line around everything.
      const i = p * 4, t = Math.max(0, Math.min(1, (Math.max(q[i], q[i + 1], q[i + 2]) - LIT + 20) / 20));
      for (let c = 0; c < 3; c++) q[i + c] = back[c] + (q[i + c] - back[c]) * t;
    }
    o.putImageData(frame, 0, 0);
    done(out.toDataURL('image/webp', 0.92));
  };
  img.src = src;
});

async function frame() {
  const jobs = KIND_NAMES.flatMap(kind =>
    readdirSync(join(CACHE, kind)).filter(f => f.endsWith('.png'))
      .map(f => ({ kind, id: f.slice(0, -4) }))
      .filter(j => !only || only.includes(j.id)));
  if (!jobs.length) return;
  const browser = await chromium.launch();   // 2D canvas only: no GPU slot, nothing is rendered
  try {
    const page = await browser.newPage();
    // frameInPage settles its promise from an image handler, so a throw in the page is not a
    // rejection here: without this the whole pass waits on it forever rather than saying what broke.
    const pageBroke = new Promise<never>((_, reject) =>
      page.on('pageerror', e => reject(new Error(`gen-art: framing threw in the page: ${e.message}`))));
    await page.setContent('<body></body>');
    for (const { kind, id } of jobs) {
      const k = KINDS[kind];
      const src = `data:image/png;base64,${readFileSync(join(CACHE, kind, `${id}.png`)).toString('base64')}`;
      const url = await Promise.race([page.evaluate(frameInPage, [src, k.size, k.fill, BACK] as [string, number, number, number[]]), pageBroke]);
      writeFileSync(join(OUT, kind, `${id}.webp`), Buffer.from(url.split(',')[1], 'base64'));
    }
  } finally { await browser.close(); }
  console.log(`gen-art: framed ${jobs.length} into assets/art`);
}

checkCoverage();
for (const kind of KIND_NAMES) {
  mkdirSync(join(CACHE, kind), { recursive: true });
  mkdirSync(join(OUT, kind), { recursive: true });
}
await generate();
await frame();

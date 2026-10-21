// The cursor art (HOM-142). Eleven emblems, one per thing a click can land on — src/cursor.ts says which one
// goes over what — built from game-icons.net rather than drawn by the Forge generator the rest of assets/art
// comes from. A cursor is the one piece of art where generating it is the wrong tool: it is read at 44 pixels
// over a world that is moving underneath it, so nothing survives but the silhouette, and a painted icon shrunk
// to 44 is mostly mud. game-icons.net is four thousand silhouettes, it is CC BY, and it ships vectors — so each
// one is painted at the size it is actually worn instead of being scaled down from something bigger.
//
//   npx tsx scripts/cursor-art.ts            rasterise the set, fetching any SVG not cached yet
//   npx tsx scripts/cursor-art.ts --force    fetch every SVG again first
//
// Two passes like gen-art.ts, and for the same reason: the SVGs are cached in .art-cache/cursors/, so changing
// the colours or the rim costs no network. Rasterising is vector painting in headless Chromium and a screenshot
// — no GPU slot, nothing rendered (see CLAUDE.md).
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CURSOR_HOTSPOTS, CURSOR_IDS, CURSOR_SIZE, CursorId } from '../src/cursor';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.art-cache', 'cursors');
const OUT = join(ROOT, 'assets', 'art', 'cursors');
const RAW = 'https://raw.githubusercontent.com/game-icons/icons/master';

/**
 * The icon behind each cursor, as `<author>/<icon>` — which is both the path under game-icons' repository and
 * the credit CC BY asks for, so LICENSES.md below is written straight out of this map and cannot drift from
 * what was actually used. Each is the thing the click under it would do, which is the whole point: the picture
 * answers "what happens if I press here" before the press.
 */
const SOURCES: Record<CursorId, string> = {
  point: 'delapouite/arrow-cursor',
  attack: 'lorc/crossed-swords',
  talk: 'lorc/scroll-unfurled',
  trade: 'delapouite/two-coins',
  flight: 'lorc/feather',
  gather: 'delapouite/war-pick',
  forge: 'lorc/anvil-impact',
  cook: 'delapouite/cooking-pot',
  brew: 'lorc/bubbling-flask',
  tan: 'delapouite/animal-hide',
  rune: 'lorc/rune-stone',
};

// Parchment lit from above, over a rim of near-black. Two tones and not one because a flat fill at this size
// reads as a sticker; the gradient is slight enough that it never becomes detail competing with the shape.
const FILL_TOP = '#fbf4e2', FILL_BOTTOM = '#bfa87e';
const RIM = '#15100a';
/**
 * The rim, in finished pixels, and the clear space left around everything. The rim is not decoration: a cursor
 * is worn over whatever the game is drawing, and a dark emblem on dark grass is nothing at all, so the shape is
 * outlined in near-black and filled in parchment — one of the two always contrasts with the ground. It is laid
 * under the fill (`paint-order: stroke`), so it thickens the silhouette outwards instead of eating into it.
 * The margin is what stops the outward half of that rim being clipped by the edge of the image.
 */
const RIM_PX = 2.4, MARGIN = 2;

/**
 * The arrow is hung by the corner of its box; every emblem is carried on its centre. Not a style choice:
 * CURSOR_HOTSPOTS says the arrow clicks with its tip, and `arrow-cursor` points up and to the left, so the tip
 * *is* the top-left corner of its box — put that corner on the hotspot and the thing the pointer aims with is
 * the thing under the hotspot. An emblem has no tip to aim with and is centred instead.
 */
const HUNG_BY_TIP: CursorId = 'point';

/** The black square every game-icons file is drawn on. Its exact text, because stripping it is how the cut-out happens. */
const BACKDROP = '<path d="M0 0h512v512H0z"/>';

const force = process.argv.slice(2).includes('--force');

/** Every cursor needs an icon and every icon needs a cursor, or something is drawn for nobody. */
function checkCoverage() {
  const problems = [
    ...CURSOR_IDS.filter(id => !SOURCES[id]).map(id => `cursor ${id} has no icon in SOURCES`),
    ...Object.keys(SOURCES).filter(id => !(CURSOR_IDS as readonly string[]).includes(id)).map(id => `icon for ${id}, which is not a cursor in src/cursor.ts`),
  ];
  if (problems.length) throw new Error(`cursor-art:\n  ${problems.join('\n  ')}`);
}

/** Cached under the icon's own name and not the cursor's, so swapping a cursor to a different icon fetches it. */
const cached = (id: CursorId) => join(CACHE, `${SOURCES[id].replace('/', '-')}.svg`);

async function fetchIcons() {
  mkdirSync(CACHE, { recursive: true });
  for (const id of CURSOR_IDS) {
    if (existsSync(cached(id)) && !force) continue;
    const url = `${RAW}/${SOURCES[id]}.svg`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`cursor-art: ${url} answered ${res.status}`);
    writeFileSync(cached(id), await res.text());
    console.log(`cursor-art: fetched ${SOURCES[id]}`);
  }
}

/**
 * The emblem out of a game-icons file. They are all one shape: a black square, then the subject in white on top
 * of it. Take the square away and the subject is already a cut-out; take the white away and it can be painted.
 * Both are checked rather than assumed, because a file that stopped being white-on-black would otherwise come
 * through as a black square with a 44-pixel hole in it and still write a perfectly valid PNG.
 */
function emblem(svg: string, id: CursorId): string {
  if (!svg.includes(BACKDROP)) throw new Error(`cursor-art: ${SOURCES[id]} is not a white-on-black game-icons file`);
  const inner = svg.replace(BACKDROP, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  if (!/fill="#f{3,6}"/i.test(inner)) throw new Error(`cursor-art: ${SOURCES[id]} has no white subject to paint`);
  return inner.replace(/\s*fill="#f{3,6}"/gi, '');
}

const page = (inner: string) => `<!doctype html><html><body style="margin:0">
  <svg id="c" xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" viewBox="0 0 512 512">
    <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${FILL_TOP}"/><stop offset="1" stop-color="${FILL_BOTTOM}"/>
    </linearGradient></defs>
    <g id="e" fill="url(#f)" stroke="${RIM}" stroke-linejoin="round" style="paint-order:stroke">${inner}</g>
  </svg></body></html>`;

/**
 * Fit the emblem to the canvas, in the page. The icons are not drawn to a common size — a feather is tall and
 * thin where crossed swords fill their box — so framing them by their own bounding box rather than by the
 * 512-unit square they are filed in is what makes the set look like a set.
 *
 * Runs inside Chromium: no closure over anything above, and plain JS only, for the reason gen-art.ts gives.
 */
const frameInPage = ([size, hx, hy, byTip, rimPx, margin]: [number, number, number, boolean, number, number]) => {
  const svg = document.getElementById('c') as unknown as SVGSVGElement;
  const g = document.getElementById('e') as unknown as SVGGElement;
  const b = g.getBBox();   // geometry only: the stroke is not in it, which is what `margin` is for
  // Pixels per user unit. Hung by the tip, the shape runs down and right from the hotspot and has that much
  // room; centred, it has the whole canvas less a margin on both sides.
  const k = byTip
    ? Math.min((size - hx - margin) / b.width, (size - hy - margin) / b.height)
    : (size - 2 * margin) / Math.max(b.width, b.height);
  const v = size / k;      // the viewBox side that puts k pixels on a user unit
  const x = byTip ? b.x - hx / k : b.x + b.width / 2 - v / 2;
  const y = byTip ? b.y - hy / k : b.y + b.height / 2 - v / 2;
  svg.setAttribute('viewBox', `${x} ${y} ${v} ${v}`);
  // In user units, so the rim comes out the same thickness on every icon however big its box was.
  g.setAttribute('stroke-width', String(rimPx / k));
};

async function rasterise() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: CURSOR_SIZE, height: CURSOR_SIZE } });
    for (const id of CURSOR_IDS) {
      await tab.setContent(page(emblem(readFileSync(cached(id), 'utf8'), id)));
      const [hx, hy] = CURSOR_HOTSPOTS[id];
      await tab.evaluate(frameInPage, [CURSOR_SIZE, hx, hy, id === HUNG_BY_TIP, RIM_PX, MARGIN] as [number, number, number, boolean, number, number]);
      await tab.screenshot({ path: join(OUT, `${id}.png`), omitBackground: true });
    }
  } finally { await browser.close(); }
  console.log(`cursor-art: wrote ${CURSOR_IDS.length} cursors to assets/art/cursors at ${CURSOR_SIZE}px`);
}

/** The credit CC BY asks for, written from the same map the pictures were built from so the two cannot disagree. */
function writeLicences() {
  const author = (src: string) => src.split('/')[0].replace(/^./, c => c.toUpperCase());
  const rows = CURSOR_IDS.map(id => {
    const [a, icon] = SOURCES[id].split('/');
    return `| ${id}.png | [${icon}](https://game-icons.net/1x1/${a}/${icon}.html) | ${author(SOURCES[id])} | CC BY 3.0 |`;
  });
  writeFileSync(join(OUT, 'LICENSES.md'), `# Cursor licences

Every PNG in this directory is built from an icon on **game-icons.net**, released under
**CC BY 3.0** (https://creativecommons.org/licenses/by/3.0/), which requires the credit below. The originals are
512x512 SVGs, white on a black square, fetched from https://github.com/game-icons/icons.

\`scripts/cursor-art.ts\` makes the PNGs and this file: it drops the black square, paints the remaining shape in
parchment over a near-black rim, frames it to its own bounding box and rasterises it at ${CURSOR_SIZE} px. No shape was
edited. The SVGs themselves are not in the repo.

| File | Icon | Author | Licence |
|---|---|---|---|
${rows.join('\n')}
`);
}

checkCoverage();
await fetchIcons();
await rasterise();
writeLicences();

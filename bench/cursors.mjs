// Contact sheet for the cursors (HOM-142). A cursor is the one piece of art no screenshot can show: Chromium does
// not draw the pointer into a capture, so the only way to see whether an anvil still reads as an anvil at 44 pixels
// over the game's ground is to lay the files out and look.
//
// Each cursor is shown at the size it is actually worn, and again at 3x so the cut-out's edge and the rim under it
// can be judged, over the three grounds it has to survive: the charcoal of a panel, the dark grass of the clearing
// at dusk, and the pale town paving, which is the brightest thing it is ever over.
//
//   node bench/cursors.mjs          -> bench/shots/cursors.png
//
// No GPU slot: 2D canvas and a screenshot, nothing rendered (see CLAUDE.md).
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDS = ['point', 'attack', 'talk', 'trade', 'flight', 'gather', 'forge', 'cook', 'brew', 'tan', 'rune'];
const GROUNDS = [['panel', '#141416'], ['grass', '#2f3a28'], ['paving', '#8a8578']];

const src = id => `data:image/png;base64,${readFileSync(join(ROOT, 'assets', 'art', 'cursors', `${id}.png`)).toString('base64')}`;
const row = id => `<div class="r"><span class="n">${id}</span>${GROUNDS.map(([, c]) =>
  `<span class="g" style="background:${c}"><img src="${src(id)}"><img class="big" src="${src(id)}"></span>`).join('')}</div>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 740, height: 40 + IDS.length * 148 } });
  await page.setContent(`<body style="margin:0;background:#000;font:13px sans-serif;color:#d6cdb4">
    <div style="padding:6px 12px">each cursor at 44px and at 3x, over panel charcoal / clearing grass / town paving</div>
    <style>
      .r{display:flex;align-items:center;gap:10px;padding:2px 12px}
      .n{width:70px;text-align:right}
      .g{display:flex;align-items:center;gap:10px;padding:4px 10px;border-radius:3px}
      .big{width:132px;height:132px;image-rendering:pixelated}
    </style>
    ${IDS.map(row).join('')}</body>`);
  mkdirSync(join(ROOT, 'bench', 'shots'), { recursive: true });
  await page.screenshot({ path: join(ROOT, 'bench', 'shots', 'cursors.png'), fullPage: true });
} finally { await browser.close(); }
console.log('cursors: bench/shots/cursors.png');

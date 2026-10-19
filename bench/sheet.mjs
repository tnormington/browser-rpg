// Contact sheet: crop each creature's shot around the centre and tile them.  node bench/sheet.mjs <suffix> -> bench/shots/creatures/sheet-<suffix>.png
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const dir = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'creatures'), suffix = process.argv[2] ?? 'close';
const files = readdirSync(dir).filter(f => f.endsWith(`-${suffix}.png`));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const imgs = files.map(f => `<div style="position:relative;width:400px;height:300px;overflow:hidden"><img src="data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}" style="position:absolute;left:-440px;top:-170px"><span style="position:absolute;left:4px;top:2px;color:#fff;font:12px sans-serif">${f.replace(`-${suffix}.png`, '')}</span></div>`);
await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(4,400px)">${imgs.join('')}</body>`);
await page.screenshot({ path: join(dir, `sheet-${suffix}.png`) });
await browser.close();
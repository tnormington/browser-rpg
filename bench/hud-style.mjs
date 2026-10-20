// HOM-83: the HUD is one style. Every colour and every type size below `:root` in index.html comes from a token, so a new panel that
// reaches for a hex or a `font-size:13px` of its own fails here instead of drifting.
//   node bench/hud-style.mjs        (static, no browser)   exits non-zero on a stray hex colour or a px font size
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const body = css.replace(/:root\{[^}]*\}/, '');

// Literals that are allowed to stay, and why: black is the HUD's hairline and shadow; the rest are the glows of the loud banners and the
// pulsing frames (light, not surface -- they carry the same meaning as the token they sit beside: gold/ember, quest blue, blood).
const GLOWS = new Set(['#000', '#b8601a', '#d08a1a', '#1a8fc0', '#a01010']);
const fails = [];
for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ');
  for (const hex of m[2].match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) if (!GLOWS.has(hex.toLowerCase())) fails.push(`${sel}: colour ${hex} is not a token (add one to :root, or reuse one)`);
  for (const px of m[2].match(/font-size:\s*\d+px/g) ?? []) fails.push(`${sel}: ${px} is not on the type scale (use var(--fs-*))`);
}
if (fails.length) { for (const f of fails) console.error('FAIL ' + f); console.error(`\n${fails.length} HUD style problems in index.html.`); process.exit(1); }
console.log('  ok  index.html: no hex colour or px font size below :root outside the allowed glows');

// Every worn set on the ladder, four views each: front three-quarter, back three-quarter, head close and a waist-up
// from below (the angle that reads as menacing). HUD hidden, daylight, clear sky.
// Shots -> bench/shots/armour/.   npx vite build && node bench/armour.mjs [setName ...]
import { spawnSync } from 'node:child_process';

const SETS = {
  hide: { weapon: 'rusty_blade', head: 'leather_cap', chest: 'hide_jerkin', legs: 'hide_leggings', hands: 'hide_gloves', feet: 'hide_boots' },
  copper: { weapon: 'copper_sword', head: 'copper_helm', chest: 'copper_chestplate', legs: 'copper_greaves', hands: 'hide_gloves', feet: 'hide_boots' },
  bronze: { weapon: 'bronze_sword', head: 'bronze_helm', chest: 'bronze_chestplate', legs: 'bronze_greaves', hands: 'hide_gloves', feet: 'hide_boots' },
  iron: { weapon: 'iron_sword', head: 'iron_helm', chest: 'iron_chestplate', legs: 'iron_greaves', hands: 'wolfskin_gloves', feet: 'wolfskin_boots' },
  steel: { weapon: 'warden_edge', head: 'steel_helm', chest: 'steel_chestplate', legs: 'steel_greaves', hands: 'thornhide_gloves', feet: 'thornhide_boots' },
  adamant: { weapon: 'adamant_blade', head: 'adamant_helm', chest: 'adamant_chestplate', legs: 'adamant_greaves', hands: 'marshhide_gloves', feet: 'marshhide_boots' },
  stormiron: { weapon: 'stormiron_blade', head: 'stormiron_helm', chest: 'stormiron_chestplate', legs: 'stormiron_greaves', hands: 'moorhide_gloves', feet: 'moorhide_boots' },
  starmetal: { weapon: 'crownbreaker', head: 'starmetal_helm', chest: 'starmetal_chestplate', legs: 'starmetal_greaves', hands: 'moorhide_gloves', feet: 'moorhide_boots' },
  named: { weapon: 'marrows_edge', head: 'gutterhooks_cap', chest: 'greywolf_hauberk', legs: 'steel_greaves', hands: 'thornhide_gloves', feet: 'thornhide_boots' },
  crown: { weapon: 'rotroot_edge', head: 'kings_crown', chest: 'stormiron_chestplate', legs: 'stormiron_greaves', hands: 'moorhide_gloves', feet: 'moorhide_boots' },
};

// Ids the sim may not carry yet (named pieces, the hauberk): injected so the look alone is what is under test.
const EXTRA = [['greywolf_hauberk', 'chest', 5], ['gutterhooks_cap', 'head', 5]];
const MK = `for (const [id, slot, tier] of ${JSON.stringify(EXTRA)}) __debug.items[id] ??= { name: id, slot, stack: 1, dropWeight: 0, value: 1, tier, desc: '', stats: {} };`;

const eq = o => `{ const e=__debug.sim.player.equipment; Object.assign(e, ${JSON.stringify({ weapon: null, head: null, chest: null, legs: null, hands: null, feet: null, ...o })}); } await wait(320);`;
// camera relative to the player: r out along the facing, side across it, h up; looks at a point `ah` above the player
const cam = (r, side, h, ah) => `{ const p=__debug.sim.player, f=p.facing, y=p.y||0; cam([p.x+Math.sin(f)*${r}+Math.cos(f)*${side}, y+${h}, p.z+Math.cos(f)*${r}-Math.sin(f)*${side}], [p.x, y+${ah}, p.z]); } await wait(200);`;
const VIEWS = [
  cam(2.7, 0.8, 1.35, 1.05),   // front three-quarter, whole figure
  cam(-2.7, 0.8, 1.35, 1.05),  // back three-quarter (the read the player actually has)
  cam(0.86, 0.34, 1.86, 1.74), // head close
  cam(1.7, 0.6, 0.3, 1.4),     // waist-up from below: does it look menacing
  cam(1.15, 0.45, 0.62, 0.42), // shins, boots and the knee cops
];
const setup = `look(0,0,0,0.1,4); __debug.sim.player.facing=0.6; const v=__debug.view; v.weather.set('clear',true); v.skyClock=0; const st=document.createElement('style'); st.textContent='body > *:not(canvas){visibility:hidden !important}'; document.head.append(st); ${MK} await wait(700);`;

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(SETS);
const scripts = [];
for (const [i, name] of names.entries()) {
  if (!SETS[name]) throw new Error(`no set "${name}"; have ${Object.keys(SETS).join(', ')}`);
  VIEWS.forEach((v, j) => scripts.push(`${i === 0 && j === 0 ? setup : ''} ${j === 0 ? eq(SETS[name]) : ''} ${v}`));
}
console.log(names.map((n, i) => `${n}: ar-${i * VIEWS.length}..${i * VIEWS.length + VIEWS.length - 1}`).join('  '));
const r = spawnSync('node', ['bench/look.mjs', 'ar', ...scripts], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SHOTS: 'armour' } });
process.exit(r.status ?? 1);

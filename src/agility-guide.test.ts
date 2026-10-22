// HOM-193: what the game says about the double jump. A hoard turns a player away with the true thing (what it needs, how far off that is), the skills panel names
// the next verb as a distance, the sight is for a player who cannot yet reach and the help list carries the key. Run with `npm run verify`.
import { createState, GameState } from './sim';
import { CHESTS, TIERS } from './sim/chests';
import { DOUBLE_JUMP_LEVEL, doubleJumpAway } from './sim/agility';
import { xpForLevel } from './sim/xp';
import { HOARD_SIGHT, agilityTip, chestRefusal, doubleJumpNote, hoardRefusal, hoardSight } from './agility-guide';

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const hoard = CHESTS.find(c => c.tier === 'hoard')!, cache = CHESTS.find(c => c.tier === 'cache')!, stash = CHESTS.find(c => c.tier === 'stash')!;
const at = (c: { x: number; z: number }, dx: number): GameState => { const s = createState(7); s.player.x = c.x + dx; s.player.z = c.z; return s; };
const setAgility = (s: GameState, level: number) => { s.player.skills.agility.level = level; s.player.skills.agility.xp = xpForLevel(level); };

// a new character: the refusal is the sim's own words for the tier plus the distance, and it says Shift
const fresh = at(hoard, 2);
const r = chestRefusal(fresh, 'floor')!;
assert(r.say.includes(TIERS.hoard.needs), 'a hoard turns a new player away with what it needs, in the sim\'s own words');
const away = doubleJumpAway(fresh.player)!;
assert(r.note!.includes(`${away.ground} paces`) && r.note!.includes('Shift'), 'and the log says how far off that is and how to train it');
assert(chestRefusal(at(hoard, 15), 'far')!.say === r.say, 'a click on a hoard from further off says the same thing: walking up would not help');
assert(chestRefusal(at(hoard, 15), 'dead') === null && chestRefusal(createState(7), 'far') === null, 'with no chest near, or a refusal that is not about reach, the generic shrug stands');

// with the gate: the same chest says how to get up there
const able = at(hoard, 2); setAgility(able, DOUBLE_JUMP_LEVEL);
assert(hoardRefusal(able.player).say.startsWith('Jump') && !chestRefusal(able, 'floor')!.say.includes(TIERS.hoard.needs), 'a player with the second jump is told to use it, not that they lack it');

// the other tiers do not borrow the hoard's words
assert(chestRefusal(at(cache, 2), 'floor')!.say.includes(TIERS.cache.needs), 'a cache on a step says it needs a hop');
assert(chestRefusal(at(stash, 2), 'far')!.say === 'Move closer to the chest', 'a stash out of reach says to come closer');
const opened = at(hoard, 2); opened.player.chests.push(hoard.id);
assert(chestRefusal(opened, 'opened')!.say.includes('already'), 'an opened chest says so');

// the sight: in view, below the gate, unopened, alive, and only for a hoard
assert(hoardSight(at(hoard, HOARD_SIGHT - 1))?.id === hoard.id, 'a hoard in view is sighted');
assert(hoardSight(at(hoard, HOARD_SIGHT + 1)) === null, 'out of view it is not');
assert(hoardSight(at(cache, 2)) === null && hoardSight(at(stash, 2)) === null, 'a cache or a stash is nothing to tell');
assert(hoardSight(able) === null, 'a player who has the second jump is not told they need it');
assert(hoardSight(opened) === null, 'an opened hoard is not sighted');

// the skills panel: a distance that falls as the player trains, then the keys
assert(doubleJumpNote(fresh.player).includes(`${away.ground} paces`), 'the skills panel names the distance to the double jump');
setAgility(fresh, DOUBLE_JUMP_LEVEL - 1);
assert(doubleJumpAway(fresh.player)!.ground < away.ground && doubleJumpNote(fresh.player).includes(`${doubleJumpAway(fresh.player)!.ground} paces`), 'and it falls as Agility rises');
assert(doubleJumpNote(able.player).includes('Space in the air'), 'once the gate is passed it names the keys instead');
const tip = agilityTip(fresh.player);
assert(['Shift', 'sprint', 'net', 'hop', 'dodge-roll', 'double jump'].every(w => tip.toLowerCase().includes(w.toLowerCase())), 'the Agility tooltip lists every perk and how the skill is trained');

console.log(`\n${checks} checks passed.`);

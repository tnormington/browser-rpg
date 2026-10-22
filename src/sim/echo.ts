// Echoes (docs/combat-99.md section 3, HOM-174): the enemies that already stand in the world, respawning as copies at the player's level once the Seal is
// broken. An Echo is the authored row run through the bible's 3.4 model at a new level (two ratios, `echoRow`), plus a rung of the tell ladder (3.6); the rig,
// the spawn point and the respawn time are the original's. Pure sim, no state of its own: the setting lives on the player and the row on the enemy it dresses.
import type { Enemy, GameState } from '../sim';
import { ENEMY_TYPES, EnemyDef, TICK_DT, TICK_RATE, maxHpForLevel, powerForLevel } from './data';
import { ARMOR_K, DROP_TABLES, ITEMS, MAX_REDUCTION } from './items';
import { MAX_LEVEL } from './xp';
import { EnemyRole, enemyXp } from './enemy-xp';
import { inSafeZone, resolveCollisions } from './world';
import { dropAt } from './loot';
import { MAX_GOLD } from './shop';

// ---------- the setting ----------

/** Off, Easy, Standard, Hard: how many levels above the player an Echo stands. It is a menu switch, not a place. */
export type EchoSetting = null | -3 | 0 | 3;
/** The settings as the menu lists them, in order. */
export const ECHO_STEPS: readonly EchoSetting[] = [null, -3, 0, 3];
/** +5 would be 1.93x the XP for +24 % health cost (section 3.4); +3 is 1.49x for 10 to 17 %. The one number that says how hard Hard is. */
export const ECHO_MAX_OFFSET = 3;
/** An Echo is never below this (the first level the authored rows do not reach: Vael is 41) and never above the cap. */
export const ECHO_MIN_LEVEL = 42;
export const ECHO_MAX_LEVEL = MAX_LEVEL;

/** Whatever a save says, as a setting: anything unrecognised is off, and a number is held to the cap and snapped to the nearest step (a saved 5 is 3). */
export function echoSetting(v: unknown): EchoSetting {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const held = Math.max(-ECHO_MAX_OFFSET, Math.min(ECHO_MAX_OFFSET, v));
  return (Math.round(held / ECHO_MAX_OFFSET) * ECHO_MAX_OFFSET || 0) as EchoSetting; // `|| 0`: a -0 is not a setting
}

/** The Seal is what held the dead regions down: the switch is there once Vael is slain and the Keeper has paid out. */
export const echoUnlocked = (s: GameState) => s.quest.eighth === 'done';
/** The offset in force, or null while it is off or not yet earned: nothing below this function can tell a sealed character from one who never saw the switch. */
export const echoOffset = (s: GameState): number | null => (echoUnlocked(s) ? s.player.echo : null);

/** Set it. Refused (and said so) before the Seal: a locked switch is a locked switch whoever presses it. Takes effect at each enemy's next respawn, never on a fight in progress. */
export function setEcho(s: GameState, to: EchoSetting): boolean {
  const ok = echoUnlocked(s);
  if (ok) s.player.echo = echoSetting(to);
  s.events.push({ t: 'echo', to: s.player.echo, ok });
  return ok;
}

// ---------- the model (docs/world-design.md 3.4, extended; section 3.5) ----------

/** Every Echo trash fight is this long (level 41's), instead of the bible's 0.2 s a level to 26 s at 99: the pace is kills, and a second on a kill is an hour on the road. */
export const ECHO_TTK = 14.2;
/** The bible's rows from this level up are the model's output (HOM-62 restated them); the rows under it are the ones it says "stand as shipped". */
export const MODEL_FROM = 17;

/** The weapon line (3.3), extended: what the player is carrying at level L. */
export const weaponLine = (level: number) => 36 + 2.6 * (level - 16);
/** The armour line the template rows were built against (3.3). */
export const armourLine = (level: number) => 60 + 2.2 * (level - 16);
/** The armour the player really wears at an Echo: the starmetal set and Moorhide's gloves and boots to 47, the cap from the last step at 48 (section 6.2). */
export const echoArmour = (level: number) => (level < 48 ? 133 : 160);
/** Damage removed by armour, the game's own rule (items.ts). */
export const reduction = (armour: number) => Math.min(MAX_REDUCTION, armour / (armour + ARMOR_K));
/** The template's time to kill at level b: 9.4 s at level 17, plus 0.2 s a level. */
export const ttkTemplate = (level: number) => 9.4 + 0.2 * (level - 17);

/** The player's damage a second at `level` with a weapon of `weapon`: a Crushing Blow and three Strikes a 6 s cycle, 5 % crits, plus the auto-attack (3.4, no efficiency factor). */
export const dps = (level: number, weapon: number) =>
  ((20 + weapon) + 3 * (8 + weapon)) * powerForLevel(level) / 6 * 1.05 + (4 + 0.15 * weapon) * powerForLevel(level) / 2.4;
/** HP of a trash row that dies in `ttk` seconds to the line weapon at `level`: the fight is `HP / DPS - 1.0 s` because the first blow lands the moment it is pressed. */
export const modelHp = (level: number, ttk: number) => (ttk + 1) * dps(level, weaponLine(level));
/** The hit that costs `share` of max health over a template fight of `ttk` seconds at swing interval `interval`, after the line armour (3.4's "Hit"). */
export const modelHit = (level: number, ttk: number, interval: number, share: number) =>
  share * maxHpForLevel(level) / ((ttk / interval) * (1 - reduction(armourLine(level))));

/** The two ratios. Both are of an Echo at `to` against its template at `from`. */
export const hpRatio = (from: number, to: number) => (ECHO_TTK + 1) * dps(to, weaponLine(to)) / ((ttkTemplate(from) + 1) * dps(from, weaponLine(from)));
export const damageRatio = (from: number, to: number) =>
  (maxHpForLevel(to) / (ECHO_TTK * (1 - reduction(echoArmour(to))))) / (maxHpForLevel(from) / (ttkTemplate(from) * (1 - reduction(armourLine(from)))));

// ---------- roles ----------

/**
 * What every row is. The role sets the XP (1 / 3 / 6 / 10), the gold and the marks, whether the ladder reaches it, and, for a row the model did not build, the multiple of the
 * template's health it is anchored to. From level 18 the XP is exactly `(20 + level) x role` on every row; the cave and the starter ground are off it and are listed by hand.
 */
export const ROLES: Record<string, EnemyRole> = {
  boar: 'trash', wolf: 'trash', pup: 'trash', hexer: 'trash', brute: 'elite',
  ravager: 'trash', archer: 'trash', seer: 'trash', ogre: 'elite', warden: 'boss',
  marsh_hog: 'trash', road_wolf: 'trash', footpad: 'trash', toll_captain: 'elite', old_grey: 'rare',
  shore_crab: 'trash', drowned_sailor: 'trash', tide_hag: 'trash', barnacle_ogre: 'elite', gutterhook: 'rare',
  fen_stalker: 'trash', bog_witch: 'trash', mire_troll: 'trash', bogfather: 'elite', mother_mire: 'rare',
  thornback: 'trash', blight_stag: 'trash', rotwood_cultist: 'trash', thorn_warden: 'elite', elder_thornback: 'rare',
  barrow_wight: 'trash', grave_hound: 'trash', cairn_brute: 'trash', barrow_lord: 'elite', hollow_knight: 'rare',
  moor_ram: 'trash', moor_raider: 'trash', ridge_ogre: 'trash', stonehorn: 'elite',
  captain_marrow: 'boss', rotroot_mother: 'boss', cairn_king: 'boss',
  waste_reaver: 'trash', dune_hound: 'trash', sand_ogre: 'trash', ashen_colossus: 'elite',
  spire_adept: 'trash', void_hound: 'trash', rune_golem: 'trash', spire_warden: 'elite', archmage_vael: 'boss',
};
const ROLE_OF = new Map<EnemyDef, EnemyRole>(Object.entries(ROLES).map(([id, role]) => [ENEMY_TYPES[id], role]));
/** An Echo has the role of its template. A row with no entry in ROLES is a row added without saying what it is: src/echo.test.ts fails on it. */
export function roleOf(def: EnemyDef): EnemyRole {
  const role = ROLE_OF.get(def);
  if (!role) throw new Error(`echo: ${def.name} has no role in ROLES`);
  return role;
}

/** How many times the template's health a role is (3.4: trash 1, elite 3, rare 4, boss 8) and how much of it a camp member keeps (a camp of three: 0.75). */
const ROLE_HP: Record<EnemyRole, number> = { trash: 1, elite: 3, rare: 4, boss: 8 };
const CAMP_HP = 0.75;
/** What gold a kill is worth, as a multiple of the trash kill's `0.6 L + 3` (3.4: elite 3, rare 4, boss 8). */
const ROLE_GOLD: Record<EnemyRole, number> = { trash: 1, elite: 3, rare: 4, boss: 8 };
/**
 * Echo marks a kill drops (3.3: 1 an elite, 3 a boss). A rare is 6 trash fights of work against an elite's 3 and a boss's 10, which is the same proportion: one mark in three fights, so 2.
 * The doc is silent on rares; this is the one number here that is mine, and the writ's mark (section 7) is the board's.
 */
export const ECHO_MARKS: Record<EnemyRole, number> = { trash: 0, elite: 1, rare: 2, boss: 3 };
export const ECHO_MARK_ITEM = 'echo_mark';
/**
 * Echo shards a kill drops (HOM-176): what a blade is folded round and what the Echo bar is tempered with, so what the Smithing line climbs on. One from an elite and one from a rare, two from a boss:
 * about two shards for every three marks, which is the 250 or so the ladder asks over 44 hours against the 840 marks that same time pays.
 */
export const ECHO_SHARDS: Record<EnemyRole, number> = { trash: 0, elite: 1, rare: 1, boss: 2 };
export const ECHO_SHARD_ITEM = 'echo_shard';

/**
 * The health a row is anchored to, at its own level: its authored HP where the model built it (level 18 up: 1.00 / 3.00 / 4.00 / 8.00 of the template on every row, and a camp's 0.75
 * and a pair's 0.85 kept by ratio), and the role's multiple of the template where it did not (the road and the Strand were built before the model and stand as shipped: the Marsh Hog is
 * 13.5 % over it, the Hollow's rows are up to 4 times off). Without this an Echo of a starter boar is 2x a trash kill's 14.2 s at every level.
 */
export function anchoredHp(def: EnemyDef): number {
  if (def.level > MODEL_FROM) return def.hp;
  return ROLE_HP[roleOf(def)] * (def.pack ? CAMP_HP : 1) * modelHp(def.level, ttkTemplate(def.level));
}

// ---------- the tell ladder (3.6) ----------

/**
 * Every Echo trash row gains a tell it did not have as its level climbs; no new engine rule, all three are things the game already does. The sizing rule is the part that matters:
 * a tell takes its share out of the auto-attack's budget and does not add to it. Each landing is worth `share` of what the fight costs a player who answers nothing (the model's 25 to
 * 30 %), and the swings are cut by the rest, so that player pays what the pace model says however many times a tell comes round; one who answers the tells pays less.
 * `unansweredFight` is how the cost of a fight is counted; `buildRow` is where the swings are cut to it.
 */
export interface Tell { name: string; windup: number; every: number; first: number; radius: number }
/** 56 to 69: the Seer's mark, a circle fixed under the player that a moving player is long gone from. */
export const ECHO_MARK: Tell & { from: number; share: number; range: number } = { from: 56, share: 0.15, name: 'Withering Ground', windup: 1.2, every: 8, first: 2.5, radius: 3, range: 14 };
/** 70 to 83, on every melee row: the Ogre's slam, read the telegraph (Pummel it, or step out). `first` keeps it off the sweep's 5 s, so the two do not land on one beat. */
export const ECHO_SLAM: Tell & { from: number; share: number } = { from: 70, share: 0.3, name: 'Boulder Slam', windup: 1.7, every: 12, first: 7, radius: 5 };
/** 84 to 99: each trash row arrives with a mate, at 3.4's pair discount. A row that already comes in a group (a camp, a pair) is its own pair, and does not get a second. */
export const ECHO_PAIR = { from: 84, hp: 0.85, hit: 0.7 };

/** Seconds from an enemy waking to the player's first blow (the bench's bot: it is walking at the enemy as the enemy comes at it). A fight's enemy-side window is this plus the time to kill. */
export const ECHO_LEAD = 0.5;

/**
 * What a player who stands in reach and answers nothing takes from this row in `window` seconds (raw damage, before armour), and how many of each kind of blow it landed. This is the
 * enemy half of `updateEnemies` (combat.ts) for a fighter in reach, in the same order and on the same ticks: cooldowns run down first; a wind-up in progress goes on and, when it ends,
 * lands and restarts the swing timer; otherwise the ground mark, then the net, then the shot or the swing (a slam, then a sweep, before a swing that is ready). A tell displaces the swings it
 * spans because of that last rule, which is the whole reason the tells can be sized against the fight and not added to it. src/echo.test.ts holds this to the real sim with a bot.
 */
export function unansweredFight(row: EnemyDef, window = ECHO_LEAD + ECHO_TTK) {
  const landed = { swing: 0, heavy: 0, hazard: 0, sweep: 0, bolt: 0 };
  let cd = { attack: 0.6, heavy: row.heavy?.first ?? 0, hazard: row.hazard?.first ?? 0, sweep: row.sweep?.first ?? 0, net: 0 };
  let cast: { kind: 'heavy' | 'hazard' | 'sweep' | 'bolt' | 'net'; t: number; total: number } | null = null;
  for (let tick = 0; tick < Math.round(window * TICK_RATE); tick++) {
    cd = { attack: Math.max(0, cd.attack - TICK_DT), heavy: Math.max(0, cd.heavy - TICK_DT), hazard: Math.max(0, cd.hazard - TICK_DT), sweep: Math.max(0, cd.sweep - TICK_DT), net: Math.max(0, cd.net - TICK_DT) };
    if (cast) {
      if ((cast.t += TICK_DT) < cast.total - 1e-9) continue;
      const { kind } = cast;
      cast = null;
      cd.attack = row.attackInterval;
      if (kind === 'heavy') { cd.heavy = row.heavy!.every; landed.heavy++; }
      else if (kind === 'hazard') { cd.hazard = row.hazard!.every; landed.hazard++; }
      else if (kind === 'sweep') { cd.sweep = row.sweep!.every; landed.sweep += row.sweep!.gap ? 2 : 1; }
      else if (kind === 'net') cd.net = row.net!.every;
      else landed.bolt++;
    } else if (row.hazard && cd.hazard <= 0) cast = { kind: 'hazard', t: 0, total: row.hazard.windup };
    else if (row.net && cd.net <= 0) cast = { kind: 'net', t: 0, total: row.net.windup };
    else if (row.ranged && (!row.heavy || row.ranged.holds)) { if (cd.attack <= 0) cast = { kind: 'bolt', t: 0, total: row.ranged.windup }; }
    else if (cd.attack <= 0) {
      if (row.heavy && cd.heavy <= 0) cast = { kind: 'heavy', t: 0, total: row.heavy.windup };
      else if (row.sweep && cd.sweep <= 0) cast = { kind: 'sweep', t: 0, total: row.sweep.windup + (row.sweep.gap ?? 0) };
      else { cd.attack = row.attackInterval; landed.swing++; }
    }
  }
  const total = (landed.swing + landed.bolt) * row.damage + landed.heavy * (row.heavy?.damage ?? 0) + landed.hazard * (row.hazard?.damage ?? 0) + landed.sweep * (row.sweep?.damage ?? 0);
  return { total, landed };
}

/** Does this row come in twos at this level? */
export const isPaired = (def: EnemyDef, level: number) => level >= ECHO_PAIR.from && roleOf(def) === 'trash' && !def.pack;

// ---------- the row ----------

const rows = new WeakMap<EnemyDef, Map<number, EnemyDef>>();

/**
 * The authored row as it stands at Echo level `level`: HP and hit by the two ratios (every hit alike: the swing, the heavy, the ground mark, the sweep and a ranged bolt keep their share of
 * the player's health), XP by `enemyXp`, and the tell ladder's rung laid on a trash row. Everything else (rig, speeds, leash, respawn) is the original's. Memoised: the row is read every tick.
 */
export function echoRow(def: EnemyDef, level: number): EnemyDef {
  const E = Math.max(ECHO_MIN_LEVEL, Math.min(ECHO_MAX_LEVEL, Math.round(level)));
  let byLevel = rows.get(def);
  if (!byLevel) rows.set(def, byLevel = new Map());
  let row = byLevel.get(E);
  if (!row) byLevel.set(E, row = buildRow(def, E));
  return row;
}

function buildRow(def: EnemyDef, E: number): EnemyDef {
  const role = roleOf(def), b = def.level;
  const row: EnemyDef = { ...def, level: E, hp: Math.round(anchoredHp(def) * hpRatio(b, E)), xp: enemyXp(E, role) };
  scaleHits(row, def, damageRatio(b, E));
  if (role === 'trash') addTells(row, E);
  if (isPaired(def, E)) { // after the tells are sized: the discount is on the whole of the member, so a tell stays worth the same share of it
    row.hp = Math.round(row.hp * ECHO_PAIR.hp);
    scaleHits(row, row, ECHO_PAIR.hit);
  }
  return row;
}

/** Set every hit `row` has (the swing or the bolt, the heavy, the mark, the sweep) to `from`'s, times `by`: each keeps its share of the player's health. */
function scaleHits(row: EnemyDef, from: EnemyDef, by: number) {
  const hit = (v: number) => Math.max(1, Math.round(v * by));
  row.damage = hit(from.damage);
  if (from.heavy) row.heavy = { ...from.heavy, damage: hit(from.heavy.damage) };
  if (from.hazard) row.hazard = { ...from.hazard, damage: hit(from.hazard.damage) };
  if (from.sweep) row.sweep = { ...from.sweep, damage: hit(from.sweep.damage) };
}

/**
 * The ladder's rung for a trash row at `E`. Each tell it did not have is worth its `share` of the fight a player who answers nothing pays for (`C`, counted by `unansweredFight`) every
 * time it lands, and the swings and the row's own casts are cut by the rest: the cost is linear in them, so one factor `k` solves it. Rows that have a mark of their own (the casters) keep it, and
 * a row that shoots does not slam.
 */
function addTells(row: EnemyDef, E: number) {
  const mark = E >= ECHO_MARK.from && !row.hazard, slam = E >= ECHO_SLAM.from && !row.heavy && !row.ranged;
  if (!mark && !slam) return;
  const C = unansweredFight(row).total;
  const add = (damage: number): EnemyDef => ({
    ...row,
    ...(mark ? { hazard: { name: ECHO_MARK.name, windup: ECHO_MARK.windup, every: ECHO_MARK.every, first: ECHO_MARK.first, radius: ECHO_MARK.radius, range: ECHO_MARK.range, damage: damage * ECHO_MARK.share } } : {}),
    ...(slam ? { heavy: { name: ECHO_SLAM.name, windup: ECHO_SLAM.windup, every: ECHO_SLAM.every, first: ECHO_SLAM.first, radius: ECHO_SLAM.radius, damage: damage * ECHO_SLAM.share } } : {}),
  });
  const without = unansweredFight(add(0)).total, withTells = unansweredFight(add(C)).total; // what the swings and old casts cost with the new ones landing for nothing, and for their shares
  const k = (C - (withTells - without)) / without;
  const tells = add(C);
  scaleHits(row, row, k);
  if (mark) row.hazard = { ...tells.hazard!, damage: Math.round(tells.hazard!.damage) };
  if (slam) row.heavy = { ...tells.heavy!, damage: Math.round(tells.heavy!.damage) };
}

// ---------- the respawn rule ----------

/** A mate whose pair is not wanted waits at this, and is revived by its leader (or never): a body that is not there costs a decrement a tick. */
const RETIRED = 1e9;
const isRetired = (e: Enemy) => e.respawnIn >= RETIRED / 2;

/**
 * The level an enemy would come back at right now, or null for the authored row: `clamp(L + d, 42, 99)` with `L` the player's combat level at this moment. Not in a safe
 * zone, and not a row that has retired for good.
 */
export function echoLevelFor(s: GameState, e: Enemy): number | null {
  const d = echoOffset(s);
  const def = ENEMY_TYPES[e.type];
  if (d === null || def.retiresAt || inSafeZone(e.spawnX, e.spawnZ)) return null;
  return Math.max(ECHO_MIN_LEVEL, Math.min(ECHO_MAX_LEVEL, s.player.combat.level + d));
}

/**
 * Put an enemy that is coming back (or is being loaded) into the row it will wear: the authored one, or an Echo at the level the setting asks. Never called on a fight in progress,
 * so a fight is never rescaled; switching Echoes on or off changes what a spawn point holds at its next respawn and not before. Returns false for a mate that has no pair to be
 * part of (its leader is not an Echo at a paired level), which then stays down.
 */
export function dress(s: GameState, e: Enemy): boolean {
  const base = ENEMY_TYPES[e.type], level = echoLevelFor(s, e);
  const mate = e.mateOf !== null;
  if (mate) {
    const leader = s.enemies.find(o => o.id === e.mateOf);
    if (!leader || leader.echo === null || level === null || !isPaired(base, level)) return false;
  }
  e.echo = level;
  e.row = level === null ? null : echoRow(base, level);
  e.maxHp = (e.row ?? base).hp;
  if (!mate && level !== null && isPaired(base, level)) callMate(s, e);
  return true;
}

/** The loader's half of the rule: every enemy standing in the world when a save comes back is dressed, as if it had just respawned. */
export function dressWorld(s: GameState) {
  for (const e of s.enemies.slice()) if (e.state !== 'dead' && e.mateOf === null && dress(s, e)) e.hp = e.maxHp;
}

/** A leader that is paired has a mate: the same spawn point's neighbour, made the first time it is wanted and revived whenever it had been stood down. */
function callMate(s: GameState, leader: Enemy) {
  const mate = s.enemies.find(o => o.mateOf === leader.id);
  if (mate) { if (isRetired(mate)) mate.respawnIn = 0; return; }
  const ang = leader.id * 2.399963, at = { x: leader.spawnX + Math.sin(ang) * 2.2, z: leader.spawnZ + Math.cos(ang) * 2.2, y: 0 };
  resolveCollisions(at, ENEMY_TYPES[leader.type].radius);
  s.enemies.push({
    ...leader, id: s.enemies.reduce((n, o) => Math.max(n, o.id), 0) + 1, mateOf: leader.id, x: at.x, z: at.z, spawnX: at.x, spawnZ: at.z,
    state: 'dead', hp: 0, respawnIn: 0, deadFor: 99, bleed: null, cast: null, stagger: 0, netRun: 0,
  });
}

/** A mate that is not wanted stays down: the leader (or the next level) calls it back. */
export const retireMate = (e: Enemy) => { e.respawnIn = RETIRED; };
/** The other half of a pair, alive or not: it wakes with this one. */
export const partnerOf = (s: GameState, e: Enemy) => s.enemies.find(o => (e.mateOf === null ? o.mateOf === e.id : o.id === e.mateOf));

// ---------- loot ----------

/** What the original's drop table is worth in gold a kill, on average: the number the bible's `0.6 L + 3` rule is solved against. */
export function expectedDropValue(type: string): number {
  const table = DROP_TABLES[type];
  if (!table) return 0;
  const w = table.entries.map(e => e.weight ?? ITEMS[e.id].dropWeight), total = table.nothing + w.reduce((a, b) => a + b, 0);
  return table.rolls * table.entries.reduce((sum, e, i) => sum + (w[i] / total) * (e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1) * ITEMS[e.id].value, 0);
}

/**
 * What an Echo kill pays beyond the original's table: gold to bring the kill up to the bible's `0.6 L + 3` (times the role) at the Echo's level, so the table's own drops (hides, a sword)
 * are still the loot and the purse is what the level adds; and the Echo marks and shards of the role. Returns the gold, for the kill event.
 */
export function echoLoot(s: GameState, e: Enemy): number {
  if (e.echo === null) return 0;
  const role = roleOf(ENEMY_TYPES[e.type]), p = s.player;
  const gold = Math.max(0, Math.round(ROLE_GOLD[role] * (0.6 * e.echo + 3) - expectedDropValue(e.type)));
  p.gold = Math.min(MAX_GOLD, p.gold + gold);
  if (ECHO_MARKS[role] > 0) dropAt(s, ECHO_MARK_ITEM, ECHO_MARKS[role], e.x, e.z);
  if (ECHO_SHARDS[role] > 0) dropAt(s, ECHO_SHARD_ITEM, ECHO_SHARDS[role], e.x, e.z);
  return gold;
}

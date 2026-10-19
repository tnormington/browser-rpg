// Authoritative simulation. No Three.js / DOM imports: this module must be able to run server-side.
// Rules live in src/sim/*; this file owns state shape and the fixed-step driver.

import { XpTrack } from './sim/xp';
import { DerivedStats, Durability, Equipment, deriveStats, emptyEquipment } from './sim/items';
import { Inventory, InvAction, applyInvAction, newInventory } from './sim/inventory';
import { GroundDrop, updateDrops } from './sim/loot';
import { SkillId, Skills, newSkills } from './sim/skills';
import { TalentEffects, TalentFail, Talents, deriveTalents, learnTalent, newTalents, resetTalents } from './sim/talents';
import { ResourceNode, createNodes, updateNodes } from './sim/gathering';
import { beginCraft } from './sim/crafting';
import { Buff, updateConsumables } from './sim/consumables';
import { ShopAction, applyShopAction } from './sim/shop';
import { Action, Interact, requestInteract, updateAction, updateInteract } from './sim/actions';
import { QuestState, advanceQuest, newQuest, updateQuest } from './sim/quest';
import { holdDoor } from './sim/dungeon';
import { START_TOWN, discoverMasters, startFlight, updateFlight } from './sim/flight';
import { holdAtGates } from './sim/gates';
import { updateWithering } from './sim/hazards';
import { PLAYER_RADIUS, clampToWorld, inCave, regionAt, resolveCollisions } from './sim/world';
import { Pt, route } from './sim/path';
import { ABILITIES, ENEMY_TYPES, SPAWNS, PLAYER_SPAWN, JUMP_VELOCITY, GRAVITY, FALL_GRAVITY, TICK_RATE, TICK_DT } from './sim/data';
import {
  acquireFront, clearTarget, pressAbility, refreshPlayerStats, setTarget, tabTarget, toggleAutoAttack,
  updateEnemies, updatePlayerCombat, updatePlayerDeath,
} from './sim/combat';

export * from './sim/world';
export type { GroundDrop } from './sim/loot';
export type { ResourceNode } from './sim/gathering';
export type { Action, Interact } from './sim/actions';
export type { QuestState } from './sim/quest';

export { TICK_RATE, TICK_DT };
const MOVE_SPEED = 6;
export const STRIDE_DIST = 2.7; // one footfall: 0.45s of running at MOVE_SPEED (the audio request's cadence; not checked against the run clip's footfalls)
const ARRIVE_DIST = 0.15;

export type EnemyState = 'idle' | 'chase' | 'return' | 'dead';

export interface Enemy {
  id: number;
  type: string;
  region: string;   // the region it stands in (by its spawn): which part of the world it belongs to, for whatever draws or counts per region
  x: number; z: number; facing: number;
  spawnX: number; spawnZ: number;
  hp: number; maxHp: number;
  state: EnemyState;
  attackCd: number;
  respawnIn: number;
  deadFor: number;
  hitFlash: number; // presentation timers kept in sim so they tick deterministically
  swing: number;
  bleed: { ticks: number; timer: number; damage: number } | null;
  /** A wind-up in progress: the tell the player reads. Cleared by a Pummel, by dying, or when it lands. */
  cast: { kind: 'heavy' | 'bolt' | 'ground'; t: number; total: number; x?: number; z?: number; radius?: number } | null;
  stagger: number;   // seconds left stunned after an interrupt: it does nothing
  heavyCd: number;   // seconds until the heavy attack may start again
  evadeFor: number;  // seconds spent walking home after giving up a chase: a walk that goes nowhere (rock in the way) ends in a reset
  hazardCd: number;  // seconds until the ground hazard may be marked again
}

/** One incoming hit remembered for the death recap. `at` is game seconds (tick * TICK_DT). */
export interface RecapEntry { src: string; what: string; amount: number; heavy: boolean; at: number }

export interface Player {
  x: number; z: number; facing: number; moving: boolean;
  /** Height above the (flat) ground, world units. 0 on the ground. Presentation only: no rule reads it. */
  y: number; vy: number;
  stride: number;          // ground distance walked since the last footfall; starts at half a stride so the first foot lands quickly
  airborne: boolean;       // y > 0 after this tick's integration: what the renderer reads
  autoAttack: boolean;     // armed: swings at the target whenever the swing timer is up and the target is in reach
  swing: number;           // seconds until the next swing may land; counts down to 0 and waits there for the target to be in reach. Interval is stats.swingInterval
  inCombat: boolean;       // recent damage either way, or something hostile is chasing you
  recap: RecapEntry[];     // the last few hits taken, newest last: why you died
  hp: number; maxHp: number;
  energy: number; maxEnergy: number;
  gcd: number;
  cd: number[];            // per-ability cooldown remaining
  learned: string[];       // names of the trainer abilities bought so far (see AbilityDef.trainer)
  unlocked: number;        // combat level up to which ability unlocks have been announced (so each fires exactly once)
  queued: number | null;   // ability pressed just before the GCD ended
  cast: number;            // short attack-animation timer
  dead: boolean;
  respawnIn: number;
  outOfCombat: number;
  skills: Skills;
  combat: XpTrack;         // the same object as skills.combat: combat code reads it directly
  action: Action | null;   // the one timed gather/craft/flight in progress
  inventory: Inventory;
  gold: number;            // currency: sold for, spent at the merchant. Not a bag item, so it never takes a slot
  equipment: Equipment;
  durability: Durability;  // points left on worn-down gear, by item id (sim/durability.ts); absent = whole
  stats: DerivedStats;     // always deriveStats(equipment, durability); combat reads this, never the items
  talents: Talents;        // ranks bought, by talent id
  talentFx: TalentEffects; // always deriveTalents(talents); combat reads this, never the ranks
  /** A meal being eaten: heals `rate` a second for `left` more seconds, and a hit ends it. `pending` is healing not yet reported as one number. */
  food: { left: number; rate: number; pending: number } | null;
  foodCd: number;          // seconds until any food may be eaten again
  buffs: Buff[];           // timed effects (Well Fed), by BUFFS id: max health reads them, death clears them
}

export type GameEvent =
  | { t: 'hit'; target: 'player' | number; x: number; z: number; amount: number; crit: boolean; slot: number; dot: boolean; heavy?: boolean; src?: number; species: string }
  | { t: 'heal'; x: number; z: number; amount: number }
  | { t: 'fail'; reason: 'range' | 'cooldown' | 'gcd' | 'energy' | 'target' | 'locked' | 'nocast'; slot: number }
  | { t: 'unlock'; slot: number; level: number }       // combat level handed over an ability: fires once per ability
  | { t: 'talent'; id: string; rank: number }          // a talent point was spent, and the rank it bought
  | { t: 'talentfail'; reason: TalentFail; id: string } // ...or could not be
  | { t: 'talentreset' }                               // every point handed back
  | { t: 'telegraph'; id: number; kind: 'heavy' | 'bolt' | 'ground'; windup: number; x?: number; z?: number; radius?: number }  // an enemy starts a wind-up; a 'ground' one carries the spot it will land on
  | { t: 'interrupt'; id: number; x: number; z: number }  // a Pummel landed on a wind-up
  | { t: 'blocked'; id: number; x: number; z: number }    // a ranged wind-up finished with rock in the way: the shot is wasted
  | { t: 'slam'; id: number; x: number; z: number; radius: number }  // a heavy attack resolved (hit or miss: the ground shakes either way)
  | { t: 'cast'; slot: number }
  | { t: 'swing'; target: number; x: number; z: number }   // an auto-attack swing left the player's hand (a 'hit' with slot AUTO_SLOT follows on the same tick)
  | { t: 'auto'; on: boolean }                              // auto-attack armed / disarmed: the HUD button and swing bar follow this
  | { t: 'untarget'; id: number; reason: 'dead' | 'evade' } // the target was taken from you, and why (the player's own Esc / retarget raise nothing)
  | { t: 'combat'; on: boolean }                            // the player entered / left combat
  | { t: 'stuck' }                                          // a click-to-move walk could not go anywhere: the HUD says so
  | { t: 'gate'; id: string; keeper: string; text: string; need: number } // a hard gate turned the player back: the keeper's line, and the combat level it asks for
  | { t: 'door'; dungeon: string; blurb: string }           // a shut dungeon door turned the player back: blurb says what opens it (at most one every two seconds)
  | { t: 'jump' }                                           // left the ground
  | { t: 'land'; x: number; z: number }                     // back on the ground
  | { t: 'step'; surface: 'grass' | 'cave' }                // a foot came down: once per STRIDE_DIST walked on the ground, not while airborne
  | { t: 'begin'; skill: SkillId; what: 'gather' | 'craft'; id: string } // an action was accepted and started (a cast of the line, a batch at the range): id is the node type or the recipe
  | { t: 'catch'; fish: string; node: number }          // a fishing cycle landed a fish (the 'loot' follows on the same tick)
  | { t: 'gather'; skill: SkillId; node: number }           // a strike of a gather in progress (pick, axe): every GATHER_STRIKE seconds, before the yield
  | { t: 'kill'; id: number; x: number; z: number; species: string }
  | { t: 'xp'; skill: SkillId; amount: number; x: number; z: number }
  | { t: 'levelup'; skill: SkillId; level: number }
  | { t: 'actionfail'; reason: 'level' | 'req' | 'depleted' | 'full' | 'materials' | 'range' | 'gold' | 'cooldown' | 'combat'; skill?: SkillId; need: number; what: string; station?: string } // skill: absent for a failed trade or a refused meal; station: what a 'range' failure was too far from
  | { t: 'npc'; who: string }                           // player reached a quest giver: open their dialogue
  | { t: 'quest'; what: 'accept' | 'progress' | 'stage' | 'complete'; name: string }  // name: the quest it is about (both chains sit at stage 'done' at once)
  | { t: 'forge' }                                      // player reached the forge: open the recipe list
  | { t: 'range' }                                      // ...or the cooking range
  | { t: 'crafted'; item: string; qty: number; skill: SkillId }
  | { t: 'use'; item: string }                          // an item was eaten or drunk (one is gone from the bag)
  | { t: 'eatbreak' }                                   // a hit spoiled the meal being eaten
  | { t: 'buff'; id: string; on: boolean }              // a timed effect began (or was renewed) or ended
  | { t: 'depleted'; id: number }
  | { t: 'respawned'; id: number }
  | { t: 'drop'; id: number; item: string; x: number; z: number }
  | { t: 'loot'; item: string; qty: number }
  | { t: 'invfull' }
  | { t: 'shop'; vendor: string }                       // player reached a merchant: open their shop
  | { t: 'learn'; slot: number; gold: number }               // an ability was bought from a trainer
  | { t: 'trade'; sold: boolean; item: string; qty: number; gold: number } // a sale (gold earned) or a purchase (gold spent) went through
  | { t: 'death'; killer: string; wear: { item: string; was: number; now: number }[]; grave: string; run: number; recap: { src: string; what: string; amount: number; heavy: boolean; ago: number }[] } // killer: "Cave Brute: Crushing Slam"; wear: every worn piece and its durability before and after; grave: the graveyard you wake at (its town's name); run: the straight-line walk from there back to where you fell; recap: last hits, oldest first, `ago` seconds before death
  | { t: 'respawn'; town: string }                      // woke at this town's graveyard
  | { t: 'repair'; gold: number; pieces: number }       // a vendor mended this many pieces of gear for this much gold
  | { t: 'flightmaster'; town: string }                 // player reached a flight master (a town id): open the destinations
  | { t: 'discover'; town: string }                     // a flight master was found for the first time (a town name)
  | { t: 'flight'; phase: 'start' | 'land'; from: string; to: string; price: number }; // a ride began (price paid) or ended; town ids

export interface GameState {
  tick: number;
  rng: number;
  player: Player;
  moveTarget: { x: number; z: number } | null;
  targetId: number | null;
  /** The Tab cycle in progress: the order frozen when it began and the index last handed out. Valid only while targetId is order[at]. Transient: not saved. */
  tab: { order: number[]; at: number } | null;
  enemies: Enemy[];
  drops: GroundDrop[];
  nextDropId: number;
  nodes: ResourceNode[];
  quest: QuestState;
  /** Town ids whose flight master has been found: the only places a flight can go (and, later, where a death wakes you). Hale is home. */
  found: string[];
  interact: Interact | null; // walking toward a node/forge to use it
  events: GameEvent[]; // cleared at the start of every step; presentation reads them after each step
}

/** One tick of player intent. dirX/dirZ is a world-space direction (length <= 1). */
export interface Input {
  dirX: number;
  dirZ: number;
  clickTarget: { x: number; z: number } | null; // set only on the tick a click happens
  clickEnemy: number | null;                    // enemy id clicked this tick
  tab: boolean;
  clearTarget: boolean;
  ability: number | null;                       // ability slot pressed this tick
  // Optional so a caller that predates them still compiles; NO_INPUT carries them all as false.
  attack?: boolean;                             // the attack key this tick: with no target, acquire the nearest hostile in front; then toggle auto-attack
  acquire?: boolean;                            // forgiving click: target the nearest hostile in front of the player (always, even with a target held)
  jump?: boolean;                               // jump if on the ground (held = bunny-hop on landing)
  pickup: number | null;                        // ground-drop id clicked this tick: walk to it
  inv: InvAction[];                             // inventory/equipment actions this tick
  shop?: ShopAction[];                          // sell/buy requests this tick (optional like the others added after the first callers)
  interact: Interact | null;                    // node or forge clicked this tick: walk there and use it
  craft: { recipe: string; count: number } | null; // forge recipe chosen this tick
  questAdvance: boolean | 'road';               // the advancing dialogue option was chosen this tick
  talent?: string | null;                       // talent id bought this tick
  talentReset?: boolean;                        // every talent point handed back this tick
  flight?: string | null;                       // town id to fly to this tick (from the master the player stands at)
  /** World angle the player is turned to this tick, whatever they are walking: the mouse steering the camera with the right button. */
  face?: number | null;
}

export const NO_INPUT: Input = { dirX: 0, dirZ: 0, clickTarget: null, clickEnemy: null, tab: false, clearTarget: false, ability: null, attack: false, acquire: false, jump: false, pickup: null, inv: [], interact: null, craft: null, questAdvance: false, talent: null, talentReset: false };

export function createState(seed = 1): GameState {
  const skills = newSkills();
  const s: GameState = {
    tick: 0,
    rng: seed,
    player: {
      x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, facing: Math.PI, moving: false,
      y: 0, vy: 0, stride: STRIDE_DIST / 2, airborne: false, autoAttack: false, swing: 0, inCombat: false, recap: [],
      hp: 0, maxHp: 0, energy: 0, maxEnergy: 0,
      gcd: 0, cd: ABILITIES.map(() => 0), learned: [], unlocked: 1, queued: null, cast: 0,
      dead: false, respawnIn: 0, outOfCombat: 99,
      skills, combat: skills.combat, action: null, inventory: newInventory(), gold: 0, equipment: emptyEquipment(), durability: {}, stats: deriveStats(emptyEquipment()),
      talents: newTalents(), talentFx: deriveTalents(newTalents()), food: null, foodCd: 0, buffs: [],
    },
    moveTarget: null,
    targetId: null,
    tab: null,
    enemies: SPAWNS.map((sp, i): Enemy => ({
      id: i + 1, type: sp.type, region: regionAt(sp.x, sp.z)?.id ?? '', x: sp.x, z: sp.z, facing: 0, spawnX: sp.x, spawnZ: sp.z,
      hp: ENEMY_TYPES[sp.type].hp, maxHp: ENEMY_TYPES[sp.type].hp, state: 'idle',
      attackCd: 0, respawnIn: 0, deadFor: 0, hitFlash: 0, swing: 0, bleed: null, cast: null, stagger: 0,
      heavyCd: ENEMY_TYPES[sp.type].heavy?.first ?? 0, hazardCd: ENEMY_TYPES[sp.type].hazard?.first ?? 0, evadeFor: 0,
    })),
    drops: [],
    nextDropId: 1,
    nodes: createNodes(),
    quest: newQuest(),
    found: [START_TOWN],
    interact: null,
    events: [],
  };
  refreshPlayerStats(s, true);
  s.player.energy = s.player.maxEnergy;
  return s;
}

export function step(s: GameState, input: Input, dt: number = TICK_DT): void {
  s.tick++;
  s.events.length = 0;
  const p = s.player;

  if (p.dead) {
    updatePlayerDeath(s, dt);
  } else if (p.action?.k === 'flight') {
    updateFlight(s, dt); // on the ride nothing else the player presses counts
  } else {
    // any movement intent abandons the current gather/craft and any walk-to-use
    if (input.dirX !== 0 || input.dirZ !== 0 || input.clickTarget || input.clickEnemy !== null || input.pickup !== null) {
      s.interact = null;
      p.action = null;
    }
    if (input.talent) learnTalent(s, input.talent);
    if (input.talentReset) resetTalents(s);
    if (input.clearTarget) clearTarget(s);
    if (input.clickEnemy !== null) setTarget(s, input.clickEnemy);
    else if (input.clickTarget) s.moveTarget = clampToWorld(input.clickTarget);
    for (const a of input.inv) applyInvAction(s, a);
    for (const a of input.shop ?? []) applyShopAction(s, a);
    if (input.pickup !== null) {
      const d = s.drops.find(x => x.id === input.pickup);
      if (d) s.moveTarget = clampToWorld(d);
    }
    if (input.interact) requestInteract(s, input.interact);
    if (input.questAdvance) advanceQuest(s, input.questAdvance);
    if (input.craft) beginCraft(s, input.craft.recipe, input.craft.count);
    if (input.tab) tabTarget(s);
    if (input.acquire) acquireFront(s);
    if (input.attack) toggleAutoAttack(s);
    movePlayer(s, input, dt);
    updateInteract(s);
    updateAction(s, dt);
    updateConsumables(s, dt);
    updatePlayerCombat(s, dt);
    if (input.ability !== null) pressAbility(s, input.ability);
    if (input.flight) startFlight(s, input.flight);
    discoverMasters(s);
  }
  updateWithering(s, dt);
  updateEnemies(s, dt);
  updateDrops(s, dt);
  updateNodes(s, dt);
  updateQuest(s);
}

/** The route for the current walk, planned once per click (moveTarget is a fresh object each time) and consumed as the player passes each waypoint. */
const routes = new WeakMap<GameState, { for: Pt; pts: Pt[] }>();
function routedAim(s: GameState, aim: Pt): Pt {
  const p = s.player;
  let r = routes.get(s);
  if (!r || r.for !== aim) { r = { for: aim, pts: route(p, aim) ?? [aim] }; routes.set(s, r); }
  while (r.pts.length > 1 && Math.hypot(r.pts[0].x - p.x, r.pts[0].z - p.z) < 0.3) r.pts.shift();
  return r.pts[0];
}

function movePlayer(s: GameState, input: Input, dt: number) {
  const p = s.player;
  let dx = input.dirX, dz = input.dirZ;
  if (dx !== 0 || dz !== 0) {
    s.moveTarget = null; // keyboard cancels click-to-move
  } else if (s.moveTarget) {
    // a walk that has to go round scenery or change room is aimed at the next waypoint; moveTarget itself is untouched
    const aim = routedAim(s, s.moveTarget);
    const via = aim !== s.moveTarget;
    const tx = aim.x - p.x, tz = aim.z - p.z;
    const d = Math.hypot(tx, tz);
    if (!via && d < ARRIVE_DIST) {
      s.moveTarget = null;
    } else if (d > 1e-6) {
      // don't overshoot the target within a single tick
      const k = Math.min(1, d / (MOVE_SPEED * dt)) / d;
      dx = tx * k; dz = tz * k;
    }
  }

  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  const px = p.x, pz = p.z;
  p.x += dx * MOVE_SPEED * dt;
  p.z += dz * MOVE_SPEED * dt;
  resolveCollisions(p, PLAYER_RADIUS);
  holdAtGates(s, px, pz);
  if (holdDoor(s, { x: px, z: pz })) s.moveTarget = null; // a click-to-move walk into a shut door ends there: the door has said why, "can't reach that" would say less

  const moved = Math.hypot(p.x - px, p.z - pz);
  p.moving = moved > 1e-4;
  if (len > 1e-4) p.facing = Math.atan2(dx, dz);
  if (input.face != null) p.facing = input.face; // steering beats the walk: strafing with the mouse keeps you facing the camera
  stepVertical(s, input.jump === true, dt);
  stepStride(s, moved);
  // click-to-move blocked by an obstacle: give up instead of pushing forever
  if (s.moveTarget && len > 1e-4 && moved < len * MOVE_SPEED * dt * 0.1) {
    s.moveTarget = null;
    s.events.push({ t: 'stuck' });
  }
}

/** Footfalls: one `step` per STRIDE_DIST of ground covered, so the cadence follows speed. Airborne or standing resets to mid-stride. */
function stepStride(s: GameState, moved: number) {
  const p = s.player;
  if (!p.moving || p.y > 0) { p.stride = STRIDE_DIST / 2; return; }
  p.stride += moved;
  if (p.stride < STRIDE_DIST) return;
  p.stride -= STRIDE_DIST;
  s.events.push({ t: 'step', surface: inCave(p.x, p.z) ? 'cave' : 'grass' });
}

/**
 * The jump. Vertical position and velocity only: the world is flat, nothing reads `y`, and horizontal movement above is
 * untouched by it, so a jump changes where the player is drawn and nothing about where they can go or what can hit them.
 * Gravity is semi-implicit Euler on the fixed step, so the arc is the same every run.
 */
function stepVertical(s: GameState, wantsJump: boolean, dt: number) {
  const p = s.player;
  if (wantsJump && p.y === 0 && p.vy === 0) {
    p.vy = JUMP_VELOCITY;
    p.action = null; // like moving, hopping breaks the concentration of a gather or craft
    s.events.push({ t: 'jump' });
  }
  if (p.y === 0 && p.vy === 0) { p.airborne = false; return; }
  p.vy -= (p.vy > 0 ? GRAVITY : FALL_GRAVITY) * dt; // the fall is the quicker half: see the note on GRAVITY
  p.y += p.vy * dt;
  if (p.y <= 0) {
    p.y = 0; p.vy = 0; p.airborne = false;
    s.events.push({ t: 'land', x: p.x, z: p.z });
  } else p.airborne = true;
}

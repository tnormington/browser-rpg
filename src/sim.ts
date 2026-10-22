// Authoritative simulation. No Three.js / DOM imports: this module must be able to run server-side.
// Rules live in src/sim/*; this file owns state shape and the fixed-step driver.

import { XpTrack } from './sim/xp';
import { DerivedStats, Durability, Equipment, EquipSlot, deriveStats, emptyEquipment } from './sim/items';
import type { Enchants } from './sim/enchants';
import { EnchantAction, applyEnchantAction } from './sim/enchanting';
import { Inventory, InvAction, applyInvAction, newInventory } from './sim/inventory';
import { GroundDrop, updateDrops } from './sim/loot';
import { SkillId, Skills, newSkills } from './sim/skills';
import { TalentEffects, TalentFail, Talents, deriveTalents, learnTalent, newTalents, resetTalents } from './sim/talents';
import { ResourceNode, createNodes, updateNodes } from './sim/gathering';
import { beginCraft } from './sim/crafting';
import { Buff, updateConsumables } from './sim/consumables';
import type { Proc } from './sim/procs';
import type { ChestTier } from './sim/chests';
import { ShopAction, applyShopAction } from './sim/shop';
import { BountyAction, BountyState, applyBountyAction, newBounties } from './sim/bounties';
import { AdminAction, applyAdminAction } from './sim/admin';
import { Action, Interact, requestInteract, updateAction, updateInteract } from './sim/actions';
import { QuestState, advanceQuest, newQuest, updateQuest } from './sim/quest';
import { holdDoor } from './sim/dungeon';
import { dismount, moveSpeed, toggleMount, updateMount } from './sim/mounts';
import { DOUBLE_JUMP_COST, ROLL_SPEED, canDoubleJump, doubleJumpVelocity, jumpVelocity, maxStamina, rolling, startRoll, startSprint, updateAgility } from './sim/agility';
import { START_TOWN, discoverMasters, startFlight, updateFlight } from './sim/flight';
import { holdAtGates } from './sim/gates';
import { updateWithering } from './sim/hazards';
import { PLAYER_RADIUS, inCave, perchAt, regionAt, resolveCollisions } from './sim/world';
import { ABILITIES, CastKind, ENEMY_TYPES, SPAWNS, PLAYER_SPAWN, GRAVITY, FALL_GRAVITY, TICK_RATE, TICK_DT, jumpAirtime } from './sim/data';
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
export const STRIDE_DIST = 2.7; // one footfall: 0.45s of running at foot speed (the audio request's cadence; not checked against the run clip's footfalls)

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
  /** `interval` is the seconds between ticks, fixed when the wound was opened (Exsanguinate empties it sooner). */
  bleed: { ticks: number; timer: number; damage: number; interval: number } | null;
  /** A wind-up in progress: the tell the player reads. Cleared by a Pummel, by dying, or when it lands. */
  cast: { kind: CastKind; t: number; total: number; x?: number; z?: number; radius?: number } | null;
  stagger: number;   // seconds left stunned after an interrupt: it does nothing
  heavyCd: number;   // seconds until the heavy attack may start again
  evadeFor: number;  // seconds spent walking home after giving up a chase: a walk that goes nowhere (rock in the way) ends in a reset
  hazardCd: number;  // seconds until the ground hazard may be marked again
  netCd: number;     // seconds until the net may be thrown again
  netRun: number;    // seconds left of the retreat a landed net bought it: the only time a shooter gives ground
}

/** One incoming hit remembered for the death recap. `at` is game seconds (tick * TICK_DT). */
export interface RecapEntry { src: string; what: string; amount: number; heavy: boolean; at: number }

export interface Player {
  x: number; z: number; facing: number; moving: boolean;
  /** Height in world units: 0 on the ground, a prop's `top` while standing on it (sim/world.ts). Landing, falling and a few attacks read it. */
  y: number; vy: number;
  stride: number;          // ground distance walked since the last footfall; starts at half a stride so the first foot lands quickly
  airborne: boolean;       // in flight: not standing on the ground or on a top. On a rock it is false at any height
  airJumped: boolean;      // the double jump is spent for this hop; landing gives it back
  jumpHeld: boolean;       // the jump key was down last tick: a double jump needs a fresh press, or holding the key would spend it at once
  autoAttack: boolean;     // armed: swings at the target whenever the swing timer is up and the target is in reach
  swing: number;           // seconds until the next swing may land; counts down to 0 and waits there for the target to be in reach. Interval is stats.swingInterval
  inCombat: boolean;       // recent damage either way, or something hostile is chasing you
  recap: RecapEntry[];     // the last few hits taken, newest last: why you died
  hp: number; maxHp: number;
  energy: number; maxEnergy: number;
  gcd: number;
  cd: number[];            // per-ability cooldown remaining
  learned: string[];       // names of the trainer abilities bought so far (see AbilityDef.trainer)
  mounts: string[];        // ids of the mounts owned (sim/mounts.ts); the fastest is the one ridden
  mounted: boolean;        // riding: faster on the ground, and no fighting until you get off
  unlocked: number;        // combat level up to which ability unlocks have been announced (so each fires exactly once)
  queued: number | null;   // ability pressed just before the GCD ended
  queuedOff: number | null; // an off-GCD ability pressed just before its own cooldown ended: held apart from `queued`, so neither can replace the other
  cast: number;            // short attack-animation timer
  dead: boolean;
  respawnIn: number;
  outOfCombat: number;
  skills: Skills;
  combat: XpTrack;         // the same object as skills.combat: combat code reads it directly
  action: Action | null;   // the one timed gather/craft/flight in progress
  inventory: Inventory;
  gold: number;            // currency: sold for, spent at the merchant. Not a bag item, so it never takes a slot
  chests: string[];        // ids of the chests opened (sim/chests.ts): none respawns, and the save keeps them
  equipment: Equipment;
  durability: Durability;  // points left on worn-down gear, by item id (sim/durability.ts); absent = whole
  enchants: Enchants;      // slot enchants (sim/enchants.ts): they belong to the slot, so they stay when the item changes
  stats: DerivedStats;     // always deriveStats(equipment, durability, enchants); combat reads this, never the items
  talents: Talents;        // ranks bought, by talent id
  talentFx: TalentEffects; // always deriveTalents(talents); combat reads this, never the ranks
  /** A meal being eaten: heals `rate` a second for `left` more seconds, and a hit ends it. `pending` is healing not yet reported as one number. */
  food: { left: number; rate: number; pending: number } | null;
  foodCd: number;          // seconds until any food may be eaten again
  buffs: Buff[];           // timed effects (Well Fed), by BUFFS id: max health reads them, death clears them
  /** Proc windows open right now (sim/procs.ts), by PROCS id. Transient like a cooldown, so a save never carries one. */
  procs: Proc[];
  /** Held where you stand by a net: no walking for `left` more seconds. Turning, swinging and casting are untouched. Transient, so a save never carries one. */
  root: { left: number; total: number; name: string } | null;
  /** Breath for sprinting (sim/agility.ts). The ceiling is maxStamina(p), which Agility raises; this is what is left of it. */
  stamina: number;
  sprinting: boolean;      // running flat out this tick: what moveSpeed and the run animation read. Transient
  winded: boolean;         // the meter was run dry: no sprinting until it is WINDED_UNTIL full again. Transient
  sprinted: number;        // ground covered at a sprint since the last XP was handed over. Transient
  /** Seconds left of a dodge-roll (sim/agility.ts). Above zero the player is carried along (rollX, rollZ) and nothing can touch them. Transient */
  rolling: number;
  rollCd: number;          // seconds until another roll may start. Transient
  rollX: number; rollZ: number; // the unit direction the roll is carrying them. Transient
}

export type GameEvent =
  | { t: 'hit'; target: 'player' | number; x: number; z: number; amount: number; crit: boolean; slot: number; dot: boolean; heavy?: boolean; src?: number; species: string }
  | { t: 'heal'; x: number; z: number; amount: number }
  | { t: 'fail'; reason: 'range' | 'cooldown' | 'gcd' | 'energy' | 'target' | 'locked' | 'nocast' | 'rooted' | 'noroom'; slot: number }
  | { t: 'proc'; id: string; on: boolean }                  // a proc window opened (or was spent / ran out): see sim/procs.ts
  | { t: 'dash'; slot: number; fromX: number; fromZ: number; x: number; z: number }  // a leap moved the player, in one tick, from there to here
  | { t: 'unlock'; slot: number; level: number }       // combat level handed over an ability: fires once per ability
  | { t: 'talent'; id: string; rank: number }          // a talent point was spent, and the rank it bought
  | { t: 'talentfail'; reason: TalentFail; id: string } // ...or could not be
  | { t: 'talentreset' }                               // every point handed back
  | { t: 'telegraph'; id: number; kind: CastKind; windup: number; x?: number; z?: number; radius?: number }  // an enemy starts a wind-up; a 'ground' one carries the spot it will land on
  | { t: 'net'; id: number; x: number; z: number; name: string; duration: number }  // a net landed: the player is held where they stand for `duration`
  | { t: 'interrupt'; id: number; x: number; z: number }  // a Pummel landed on a wind-up
  | { t: 'blocked'; id: number; x: number; z: number }    // a ranged wind-up finished with rock in the way: the shot is wasted
  | { t: 'slam'; id: number; x: number; z: number; radius: number }  // a heavy attack resolved (hit or miss: the ground shakes either way)
  | { t: 'cast'; slot: number }
  | { t: 'swing'; target: number; x: number; z: number }   // an auto-attack swing left the player's hand (a 'hit' with slot AUTO_SLOT follows on the same tick)
  | { t: 'attack'; id: number; species: string; ranged: boolean }  // the enemy's side of that: a blow or a bolt left it, whether or not it lands (a telegraphed heavy raises 'slam' instead)
  | { t: 'auto'; on: boolean }                              // auto-attack armed / disarmed: the HUD button and swing bar follow this
  | { t: 'untarget'; id: number; reason: 'dead' | 'evade' } // the target was taken from you, and why (the player's own Esc / retarget raise nothing)
  | { t: 'combat'; on: boolean }                            // the player entered / left combat
  | { t: 'stuck' }                                          // something was clicked from too far off to touch: the HUD says so
  | { t: 'gate'; id: string; keeper: string; text: string; need: number } // a hard gate turned the player back: the keeper's line, and the combat level it asks for
  | { t: 'door'; dungeon: string; blurb: string }           // a shut dungeon door turned the player back: blurb says what opens it (at most one every two seconds)
  | { t: 'jump'; airtime: number; double?: true }                        // left the ground, and for how long: Agility raises the takeoff, so the clip is stretched over the hop actually taken
  | { t: 'roll'; x: number; z: number; facing: number }     // a dodge-roll started here, going that way
  | { t: 'land'; x: number; z: number }                     // back on the ground
  | { t: 'step'; surface: 'grass' | 'cave' }                // a foot came down: once per STRIDE_DIST walked on the ground, not while airborne
  | { t: 'begin'; skill: SkillId; what: 'gather' | 'craft'; id: string } // an action was accepted and started (a cast of the line, a batch at the range): id is the node type or the recipe
  | { t: 'catch'; fish: string; node: number }          // a fishing cycle landed a fish (the 'loot' follows on the same tick)
  | { t: 'gather'; skill: SkillId; node: number }           // a strike of a gather in progress (pick, axe): every GATHER_STRIKE seconds, before the yield
  | { t: 'kill'; id: number; x: number; z: number; species: string }
  | { t: 'chest'; id: string; tier: ChestTier; place: string; x: number; z: number; gold: number; xp: number; opened: number; total: number } // a chest was opened (sim/chests.ts): what it paid, and the count of its place; the 'xp' for the Agility lamp follows on the same tick
  | { t: 'xp'; skill: SkillId; amount: number; x: number; z: number }
  | { t: 'levelup'; skill: SkillId; level: number }
  | { t: 'actionfail'; reason: 'level' | 'req' | 'depleted' | 'full' | 'materials' | 'range' | 'gold' | 'cooldown' | 'combat' | 'mount'; skill?: SkillId; need: number; what: string; station?: string } // skill: absent for a failed trade or a refused meal; station: what a 'range' failure was too far from
  | { t: 'npc'; who: string }                           // player reached a quest giver: open their dialogue
  | { t: 'quest'; what: 'accept' | 'progress' | 'stage' | 'complete'; name: string }  // name: the quest it is about (both chains sit at stage 'done' at once)
  | { t: 'forge' }                                      // player reached the forge: open the recipe list
  | { t: 'range' }                                      // ...or the cooking range
  | { t: 'alembic' }                                    // ...or Thornwick's alembic
  | { t: 'rack' }                                       // ...or Highmoor's tanning rack
  | { t: 'circle' }                                     // ...or the Spire's rune circle: open the enchanting panel
  | { t: 'enchanted'; slot: EquipSlot; id: string }     // a slot enchant was set (ENCHANTS id)
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
  | { t: 'stable'; mount: string; gold: number }          // a mount was bought from a stablemaster
  | { t: 'mount'; on: boolean }                            // the player climbed up (on) or came down (off)
  | { t: 'learn'; slot: number; gold: number }               // an ability was bought from a trainer
  | { t: 'trade'; sold: boolean; item: string; qty: number; gold: number } // a sale (gold earned) or a purchase (gold spent) went through
  | { t: 'death'; killer: string; wear: { item: string; was: number; now: number }[]; grave: string; run: number; recap: { src: string; what: string; amount: number; heavy: boolean; ago: number }[] } // killer: "Cave Brute: Crushing Slam"; wear: every worn piece and its durability before and after; grave: the graveyard you wake at (its town's name); run: the straight-line walk from there back to where you fell; recap: last hits, oldest first, `ago` seconds before death
  | { t: 'respawn'; town: string }                      // woke at this town's graveyard
  | { t: 'repair'; gold: number; pieces: number }       // a vendor mended this many pieces of gear for this much gold
  | { t: 'board'; town: string }                        // player reached a notice board (a town id): open its bounties
  | { t: 'bounty'; what: 'accept' | 'progress' | 'ready' | 'turnin' | 'abandon'; id: string; name: string; kills: number; goal: number; gold: number; xp: number } // a bounty moved (sim/bounties.ts): gold and xp are what it pays on turn-in
  | { t: 'flightmaster'; town: string }                 // player reached a flight master (a town id): open the destinations
  | { t: 'discover'; town: string }                     // a flight master was found for the first time (a town name)
  | { t: 'flight'; phase: 'start' | 'land'; from: string; to: string; price: number }; // a ride began (price paid) or ended; town ids

export interface GameState {
  tick: number;
  rng: number;
  player: Player;
  targetId: number | null;
  /** The Tab cycle in progress: the order frozen when it began and the index last handed out. Valid only while targetId is order[at]. Transient: not saved. */
  tab: { order: number[]; at: number } | null;
  enemies: Enemy[];
  drops: GroundDrop[];
  nextDropId: number;
  nodes: ResourceNode[];
  quest: QuestState;
  /** The repeatable objectives (sim/bounties.ts): the ones carried, and how many times each has been handed in. */
  bounties: BountyState;
  /** Town ids whose flight master has been found: the only places a flight can go (and, later, where a death wakes you). Hale is home. */
  found: string[];
  interact: Interact | null; // the node/forge being used this tick
  events: GameEvent[]; // cleared at the start of every step; presentation reads them after each step
}

/** One tick of player intent. dirX/dirZ is a world-space direction (length <= 1). */
export interface Input {
  dirX: number;
  dirZ: number;
  clickEnemy: number | null;                    // enemy id clicked this tick
  tab: boolean;
  clearTarget: boolean;
  ability: number | null;                       // ability slot pressed this tick
  // Optional so a caller that predates them still compiles; NO_INPUT carries them all as false.
  attack?: boolean;                             // the attack key this tick: with no target, acquire the nearest hostile in front; then toggle auto-attack
  acquire?: boolean;                            // forgiving click: target the nearest hostile in front of the player (always, even with a target held)
  jump?: boolean;                               // jump if on the ground (held = bunny-hop on landing)
  sprint?: boolean;                             // shift held this tick: run flat out while there is stamina for it (sim/agility.ts)
  roll?: boolean;                               // the roll key pressed this tick: a dodge-roll out of the same meter (sim/agility.ts)
  inv: InvAction[];                             // inventory/equipment actions this tick
  bounty?: BountyAction[];                      // accept / hand in / drop requests this tick, at the board the player stands at
  shop?: ShopAction[];                          // sell/buy requests this tick (optional like the others added after the first callers)
  enchant?: EnchantAction[];                    // disenchant / enchant requests this tick, at the rune circle
  interact: Interact | null;                    // node or forge clicked this tick: use it, if it is within reach
  craft: { recipe: string; count: number } | null; // forge recipe chosen this tick
  questAdvance: boolean | 'road';               // the advancing dialogue option was chosen this tick
  talent?: string | null;                       // talent id bought this tick
  talentReset?: boolean;                        // every talent point handed back this tick
  mount?: boolean;                              // the mount key this tick: climb up, or get off
  flight?: string | null;                       // town id to fly to this tick (from the master the player stands at)
  /** World angle the player is turned to this tick, whatever they are walking: the mouse steering the camera with the right button. */
  face?: number | null;
  /** QA actions this tick (sim/admin.ts). Only a build with the dev flag on can raise one: the game never puts anything here. */
  admin?: AdminAction[];
}

export const NO_INPUT: Input = { dirX: 0, dirZ: 0, clickEnemy: null, tab: false, clearTarget: false, ability: null, attack: false, acquire: false, jump: false, sprint: false, roll: false, inv: [], interact: null, craft: null, questAdvance: false, talent: null, talentReset: false };

export function createState(seed = 1): GameState {
  const skills = newSkills();
  const s: GameState = {
    tick: 0,
    rng: seed,
    player: {
      x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, facing: Math.PI, moving: false,
      y: 0, vy: 0, stride: STRIDE_DIST / 2, airborne: false, airJumped: false, jumpHeld: false, autoAttack: false, swing: 0, inCombat: false, recap: [],
      hp: 0, maxHp: 0, energy: 0, maxEnergy: 0,
      gcd: 0, cd: ABILITIES.map(() => 0), learned: [], mounts: [], mounted: false, unlocked: 1, queued: null, queuedOff: null, cast: 0,
      dead: false, respawnIn: 0, outOfCombat: 99,
      skills, combat: skills.combat, action: null, inventory: newInventory(), gold: 0, chests: [], equipment: emptyEquipment(), durability: {}, enchants: {}, stats: deriveStats(emptyEquipment()),
      talents: newTalents(), talentFx: deriveTalents(newTalents()), food: null, foodCd: 0, buffs: [], procs: [], root: null,
      stamina: 0, sprinting: false, winded: false, sprinted: 0, rolling: 0, rollCd: 0, rollX: 0, rollZ: 1,
    },
    targetId: null,
    tab: null,
    enemies: SPAWNS.map((sp, i): Enemy => ({
      id: i + 1, type: sp.type, region: regionAt(sp.x, sp.z)?.id ?? '', x: sp.x, z: sp.z, facing: 0, spawnX: sp.x, spawnZ: sp.z,
      hp: ENEMY_TYPES[sp.type].hp, maxHp: ENEMY_TYPES[sp.type].hp, state: 'idle',
      attackCd: 0, respawnIn: 0, deadFor: 0, hitFlash: 0, swing: 0, bleed: null, cast: null, stagger: 0,
      heavyCd: ENEMY_TYPES[sp.type].heavy?.first ?? 0, hazardCd: ENEMY_TYPES[sp.type].hazard?.first ?? 0, evadeFor: 0,
      netCd: ENEMY_TYPES[sp.type].net?.first ?? 0, netRun: 0,
    })),
    drops: [],
    nextDropId: 1,
    nodes: createNodes(),
    quest: newQuest(),
    bounties: newBounties(),
    found: [START_TOWN],
    interact: null,
    events: [],
  };
  refreshPlayerStats(s, true);
  s.player.energy = s.player.maxEnergy;
  s.player.stamina = maxStamina(s.player);
  return s;
}

export function step(s: GameState, input: Input, dt: number = TICK_DT): void {
  s.tick++;
  s.events.length = 0;
  const p = s.player;

  // the QA actions go first and are answered whatever the player is doing: being dead or on a flight is one of the states to test out of
  for (const a of input.admin ?? []) applyAdminAction(s, a);

  if (p.dead) {
    updatePlayerDeath(s, dt);
  } else if (p.action?.k === 'flight') {
    updateFlight(s, dt); // on the ride nothing else the player presses counts
  } else {
    // any movement intent abandons the current gather/craft
    if (input.dirX !== 0 || input.dirZ !== 0 || input.clickEnemy !== null) {
      s.interact = null;
      p.action = null;
    }
    if (input.talent) learnTalent(s, input.talent);
    if (input.talentReset) resetTalents(s);
    if (input.clearTarget) clearTarget(s);
    if (input.clickEnemy !== null) setTarget(s, input.clickEnemy);
    for (const a of input.inv) applyInvAction(s, a);
    for (const a of input.shop ?? []) applyShopAction(s, a);
    for (const a of input.enchant ?? []) applyEnchantAction(s, a);
    for (const a of input.bounty ?? []) applyBountyAction(s, a);
    if (input.interact) requestInteract(s, input.interact);
    if (input.questAdvance) advanceQuest(s, input.questAdvance);
    if (input.craft) beginCraft(s, input.craft.recipe, input.craft.count);
    if (input.tab) tabTarget(s);
    if (input.acquire) acquireFront(s);
    if (input.mount) toggleMount(s);
    if (input.attack) { dismount(s); toggleAutoAttack(s); } // the attack key is a fight: it gets you off the horse on the same tick
    movePlayer(s, input, dt);
    updateMount(s);
    updateInteract(s);
    updateAction(s, dt);
    updateConsumables(s, dt);
    updatePlayerCombat(s, dt);
    if (input.ability !== null) { dismount(s); pressAbility(s, input.ability); } // off the horse, and the ability fires on this same tick
    if (input.flight) startFlight(s, input.flight);
    discoverMasters(s);
  }
  updateWithering(s, dt);
  updateEnemies(s, dt);
  updateDrops(s, dt);
  updateNodes(s, dt);
  updateQuest(s);
}

function movePlayer(s: GameState, input: Input, dt: number) {
  const p = s.player;
  let dx = input.dirX, dz = input.dirZ;
  if (p.root) dx = dz = 0; // netted: your feet are the one thing the net holds, so the keys go nowhere
  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  // both before the speed is read, and the roll first because a roll is not a sprint: sprinting is what makes the speed 9
  // rather than 6, and a roll overrules both the keys and the speed for as long as it lasts.
  startRoll(s, input.roll === true, dx, dz);
  startSprint(s, input.sprint === true, len > 1e-4);
  if (rolling(p)) { dx = p.rollX; dz = p.rollZ; }
  const speed = rolling(p) ? ROLL_SPEED : moveSpeed(p);
  const px = p.x, pz = p.z;
  p.x += dx * speed * dt;
  p.z += dz * speed * dt;
  if (p.mounted) { const at = { x: p.x, z: p.z, y: 0 }; resolveCollisions(at, PLAYER_RADIUS); p.x = at.x; p.z = at.z; } // a horse does not climb: every top is a wall (action-layer 6 rule 5)
  else resolveCollisions(p, PLAYER_RADIUS);
  holdAtGates(s, px, pz);
  holdDoor(s, { x: px, z: pz });

  const moved = Math.hypot(p.x - px, p.z - pz);
  p.moving = moved > 1e-4;
  if (len > 1e-4 || rolling(p)) p.facing = Math.atan2(dx, dz);
  if (input.face != null) p.facing = input.face; // steering beats the walk: strafing with the mouse keeps you facing the camera
  updateAgility(s, moved, dt); // the ground actually covered is what the meter is charged for, and what the skill is paid for
  stepVertical(s, input.jump === true, dt);
  stepStride(s, moved);
}

/** Footfalls: one `step` per STRIDE_DIST of ground covered, so the cadence follows speed. Airborne or standing resets to mid-stride. */
function stepStride(s: GameState, moved: number) {
  const p = s.player;
  if (!p.moving || p.airborne) { p.stride = STRIDE_DIST / 2; return; }
  p.stride += moved;
  if (p.stride < STRIDE_DIST) return;
  p.stride -= STRIDE_DIST;
  s.events.push({ t: 'step', surface: inCave(p.x, p.z) ? 'cave' : 'grass' });
}

/**
 * The jump. The floor under the player is the ground (0) or the top of a prop they are over (see `perchAt`): a descent lands on
 * the highest top it crossed, a walk off an edge falls at FALL_GRAVITY, and a takeoff from a top is measured from the top.
 * Horizontal movement is untouched by it: the only thing `y` changes there is whether a footprint blocks (resolveCollisions).
 * Gravity is semi-implicit Euler on the fixed step, so the arc is the same every run.
 */
function stepVertical(s: GameState, wantsJump: boolean, dt: number) {
  const p = s.player;
  const press = wantsJump && !p.jumpHeld; // the edge of the key: a held key hops on landing, but only a press spends the double jump
  p.jumpHeld = wantsJump;
  const floor = p.mounted ? 0 : perchAt(p.x, p.z, p.y)?.top ?? 0;
  const grounded = p.vy === 0 && p.y <= floor;
  if (grounded) { p.y = floor; p.airJumped = false; }
  if (wantsJump && grounded) {
    p.vy = jumpVelocity(p); // Agility pushes off harder, and height goes as the square of it
    p.action = null; // like moving, hopping breaks the concentration of a gather or craft
    s.events.push({ t: 'jump', airtime: jumpAirtime(p.vy) });
  } else if (press && !grounded && !p.airJumped && !p.mounted && canDoubleJump(p, p.y - floor)) {
    p.airJumped = true;
    p.stamina -= DOUBLE_JUMP_COST;
    p.vy = doubleJumpVelocity(p.y - floor); // a fixed apex above the floor, whatever the Agility or the press time
    s.events.push({ t: 'jump', airtime: jumpAirtime(p.vy), double: true });
  } else if (grounded) { p.airborne = false; return; }
  const was = p.y;
  const g = p.vy > 0 ? GRAVITY : FALL_GRAVITY; // the fall is the quicker half: see the note on GRAVITY
  // The exact step for a constant g, not semi-implicit Euler: Euler on this step loses v dt / 2 off every rise (0.15 of a 1.35 hop, 0.23 of the
  // double jump's 3.2), which turned the 0.238 s window over a 1.1 sweep into 0.133 s. Now the arc is the parabola JUMP_HEIGHT says it is.
  p.y += p.vy * dt - 0.5 * g * dt * dt;
  p.vy -= g * dt;
  // a descent lands on the highest top at or below where it started this tick, so a fast fall cannot tunnel through one
  const land = p.vy <= 0 ? (p.mounted ? 0 : perchAt(p.x, p.z, was)?.top ?? 0) : -Infinity;
  if (p.y <= land) {
    p.y = land; p.vy = 0; p.airborne = false; p.airJumped = false;
    s.events.push({ t: 'land', x: p.x, z: p.z });
  } else p.airborne = true;
}

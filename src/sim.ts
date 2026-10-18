// Authoritative simulation. No Three.js / DOM imports: this module must be able to run server-side.
// Rules live in src/sim/*; this file owns state shape and the fixed-step driver.

import { XpTrack } from './sim/xp';
import { DerivedStats, Equipment, deriveStats, emptyEquipment } from './sim/items';
import { Inventory, InvAction, applyInvAction, newInventory } from './sim/inventory';
import { GroundDrop, updateDrops } from './sim/loot';
import { SkillId, Skills, newSkills } from './sim/skills';
import { ResourceNode, createNodes, updateNodes } from './sim/gathering';
import { beginCraft } from './sim/crafting';
import { Action, Interact, requestInteract, updateAction, updateInteract } from './sim/actions';
import { QuestState, advanceQuest, newQuest, updateQuest } from './sim/quest';
import { PLAYER_RADIUS, clampToWorld, resolveCollisions } from './sim/world';
import { ABILITIES, ENEMY_TYPES, SPAWNS, PLAYER_SPAWN } from './sim/data';
import {
  clearTarget, pressAbility, refreshPlayerStats, setTarget, tabTarget,
  updateEnemies, updatePlayerCombat, updatePlayerDeath,
} from './sim/combat';

export * from './sim/world';
export type { GroundDrop } from './sim/loot';
export type { ResourceNode } from './sim/gathering';
export type { Action, Interact } from './sim/actions';
export type { QuestState } from './sim/quest';

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
const MOVE_SPEED = 6;
const ARRIVE_DIST = 0.15;

export type EnemyState = 'idle' | 'chase' | 'return' | 'dead';

export interface Enemy {
  id: number;
  type: string;
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
  cast: { kind: 'heavy' | 'bolt'; t: number; total: number } | null;
  stagger: number;   // seconds left stunned after an interrupt: it does nothing
  heavyCd: number;   // seconds until the heavy attack may start again
}

export interface Player {
  x: number; z: number; facing: number; moving: boolean;
  hp: number; maxHp: number;
  energy: number; maxEnergy: number;
  gcd: number;
  cd: number[];            // per-ability cooldown remaining
  unlocked: number;        // combat level up to which ability unlocks have been announced (so each fires exactly once)
  queued: number | null;   // ability pressed just before the GCD ended
  cast: number;            // short attack-animation timer
  dead: boolean;
  respawnIn: number;
  outOfCombat: number;
  skills: Skills;
  combat: XpTrack;         // the same object as skills.combat: combat code reads it directly
  action: Action | null;   // the one timed gather/craft in progress
  inventory: Inventory;
  equipment: Equipment;
  stats: DerivedStats;     // always deriveStats(equipment); combat reads this, never the items
}

export type GameEvent =
  | { t: 'hit'; target: 'player' | number; x: number; z: number; amount: number; crit: boolean; slot: number; dot: boolean; heavy?: boolean; src?: number }
  | { t: 'heal'; x: number; z: number; amount: number }
  | { t: 'fail'; reason: 'range' | 'cooldown' | 'gcd' | 'energy' | 'target' | 'locked' | 'nocast'; slot: number }
  | { t: 'unlock'; slot: number; level: number }       // combat level handed over an ability: fires once per ability
  | { t: 'telegraph'; id: number; kind: 'heavy' | 'bolt'; windup: number }  // an enemy starts a wind-up
  | { t: 'interrupt'; id: number; x: number; z: number }  // a Pummel landed on a wind-up
  | { t: 'slam'; id: number; x: number; z: number; radius: number }  // a heavy attack resolved (hit or miss: the ground shakes either way)
  | { t: 'cast'; slot: number }
  | { t: 'kill'; id: number; x: number; z: number }
  | { t: 'xp'; skill: SkillId; amount: number; x: number; z: number }
  | { t: 'levelup'; skill: SkillId; level: number }
  | { t: 'actionfail'; reason: 'level' | 'depleted' | 'full' | 'materials' | 'range'; skill: SkillId; need: number; what: string }
  | { t: 'npc' }                                        // player reached the quest giver: open dialogue
  | { t: 'quest'; what: 'accept' | 'progress' | 'stage' | 'complete' }
  | { t: 'forge' }                                      // player reached the forge: open the recipe list
  | { t: 'crafted'; item: string; qty: number }
  | { t: 'depleted'; id: number }
  | { t: 'respawned'; id: number }
  | { t: 'drop'; id: number; item: string; x: number; z: number }
  | { t: 'loot'; item: string; qty: number }
  | { t: 'invfull' }
  | { t: 'death' }
  | { t: 'respawn' };

export interface GameState {
  tick: number;
  rng: number;
  player: Player;
  moveTarget: { x: number; z: number } | null;
  targetId: number | null;
  enemies: Enemy[];
  drops: GroundDrop[];
  nextDropId: number;
  nodes: ResourceNode[];
  quest: QuestState;
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
  pickup: number | null;                        // ground-drop id clicked this tick: walk to it
  inv: InvAction[];                             // inventory/equipment actions this tick
  interact: Interact | null;                    // node or forge clicked this tick: walk there and use it
  craft: { recipe: string; count: number } | null; // forge recipe chosen this tick
  questAdvance: boolean;                        // the advancing dialogue option was chosen this tick
}

export const NO_INPUT: Input = { dirX: 0, dirZ: 0, clickTarget: null, clickEnemy: null, tab: false, clearTarget: false, ability: null, pickup: null, inv: [], interact: null, craft: null, questAdvance: false };

export function createState(seed = 1): GameState {
  const skills = newSkills();
  const s: GameState = {
    tick: 0,
    rng: seed,
    player: {
      x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, facing: Math.PI, moving: false,
      hp: 0, maxHp: 0, energy: 0, maxEnergy: 0,
      gcd: 0, cd: ABILITIES.map(() => 0), unlocked: 1, queued: null, cast: 0,
      dead: false, respawnIn: 0, outOfCombat: 99,
      skills, combat: skills.combat, action: null, inventory: newInventory(), equipment: emptyEquipment(), stats: deriveStats(emptyEquipment()),
    },
    moveTarget: null,
    targetId: null,
    enemies: SPAWNS.map((sp, i): Enemy => ({
      id: i + 1, type: sp.type, x: sp.x, z: sp.z, facing: 0, spawnX: sp.x, spawnZ: sp.z,
      hp: ENEMY_TYPES[sp.type].hp, maxHp: ENEMY_TYPES[sp.type].hp, state: 'idle',
      attackCd: 0, respawnIn: 0, deadFor: 0, hitFlash: 0, swing: 0, bleed: null, cast: null, stagger: 0,
      heavyCd: ENEMY_TYPES[sp.type].heavy?.first ?? 0,
    })),
    drops: [],
    nextDropId: 1,
    nodes: createNodes(),
    quest: newQuest(),
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
  } else {
    // any movement intent abandons the current gather/craft and any walk-to-use
    if (input.dirX !== 0 || input.dirZ !== 0 || input.clickTarget || input.clickEnemy !== null || input.pickup !== null) {
      s.interact = null;
      p.action = null;
    }
    if (input.clearTarget) clearTarget(s);
    if (input.clickEnemy !== null) setTarget(s, input.clickEnemy);
    else if (input.clickTarget) s.moveTarget = clampToWorld(input.clickTarget);
    for (const a of input.inv) applyInvAction(s, a);
    if (input.pickup !== null) {
      const d = s.drops.find(x => x.id === input.pickup);
      if (d) s.moveTarget = clampToWorld(d);
    }
    if (input.interact) requestInteract(s, input.interact);
    if (input.questAdvance) advanceQuest(s);
    if (input.craft) beginCraft(s, input.craft.recipe, input.craft.count);
    if (input.tab) tabTarget(s);
    movePlayer(s, input, dt);
    updateInteract(s);
    updateAction(s, dt);
    updatePlayerCombat(s, dt);
    if (input.ability !== null) pressAbility(s, input.ability);
  }
  updateEnemies(s, dt);
  updateDrops(s, dt);
  updateNodes(s, dt);
  updateQuest(s);
}

function movePlayer(s: GameState, input: Input, dt: number) {
  const p = s.player;
  let dx = input.dirX, dz = input.dirZ;
  if (dx !== 0 || dz !== 0) {
    s.moveTarget = null; // keyboard cancels click-to-move
  } else if (s.moveTarget) {
    const tx = s.moveTarget.x - p.x, tz = s.moveTarget.z - p.z;
    const d = Math.hypot(tx, tz);
    if (d < ARRIVE_DIST) {
      s.moveTarget = null;
    } else {
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

  const moved = Math.hypot(p.x - px, p.z - pz);
  p.moving = moved > 1e-4;
  if (len > 1e-4) p.facing = Math.atan2(dx, dz);
  // click-to-move blocked by an obstacle: give up instead of pushing forever
  if (s.moveTarget && len > 1e-4 && moved < len * MOVE_SPEED * dt * 0.1) s.moveTarget = null;
}

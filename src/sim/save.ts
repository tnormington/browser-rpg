// Save format: a versioned JSON snapshot of the progress that matters. Pure sim (no DOM): storage lives in src/storage.ts.
// Transient state (aggro, cooldowns, current action, target) is deliberately not saved: a loaded game
// resumes calm. Anything unrecognised or malformed makes deserialize return null, and the caller starts a new game.
import { GameState, createState } from '../sim';
import { SKILL_IDS, SkillId } from './skills';
import { levelForXp } from './xp';
import { INVENTORY_SIZE, refreshGearStats } from './inventory';
import { EQUIP_SLOTS, EquipSlot, ITEMS } from './items';
import { enchantById } from './enchants';
import { refreshPlayerStats } from './combat';
import { BUFFS } from './consumables';
import { ABILITIES, MAX_DURABILITY, PLAYER_SPAWN } from './data';
import { QUEST2_STAGES, QUEST3_STAGES, QUEST4_STAGES, QUEST5_STAGES, QUEST6_STAGES, QUEST7_STAGES, QUEST8_STAGES, QUEST_STAGES, Quest2Stage, Quest3Stage, Quest4Stage, Quest5Stage, Quest6Stage, Quest7Stage, Quest8Stage, QuestStage } from './quest';
import { legalTalents, refreshTalents, talentById } from './talents';
import { nearestTown, resolveCollisions } from './world';
import { MAX_GOLD } from './shop';
import { landingSpot, masterById } from './flight';
import { mountById } from './mounts';
import { chestById } from './chests';
import { ActiveBounty, MAX_ACTIVE, MAX_GOAL, bountyById, targetSig } from './bounties';
import { maxStamina } from './agility';
import { mountsAllowed } from './world';

export const SAVE_VERSION = 1;
/** Nothing is further than this from the origin: the world is a few thousand units across at most (Saltmarrow ends near x = 970). */
const WORLD_LIMIT = 10000;
/** Skills added after the first save format: a save without them starts them at 0 xp. */
const LATE_SKILLS: SkillId[] = ['fishing', 'cooking', 'herbalism', 'alchemy', 'leatherworking', 'enchanting', 'agility'];
/**
 * Items that were renamed rather than retired, by their old id. The mithril rung became steel in HOM-81 at the same stats and the same
 * recipe shape, so a character who was wearing it keeps wearing it instead of having their save refused. Ore and bars have no steel
 * counterpart of the same worth: they load as the iron they would have been smelted from. Anything not listed is still a bad item.
 */
const RENAMED_ITEMS: Record<string, string> = {
  mithril_helm: 'steel_helm', mithril_greaves: 'steel_greaves', mithril_chestplate: 'steel_chestplate',
  mithril_bar: 'steel_bar', mithril_ore: 'iron_ore',
};
const itemId = (id: string) => RENAMED_ITEMS[id] ?? id;

interface SaveFile {
  version: number;
  savedAt: number;
  tick: number;
  rng: number;
  nextDropId: number;
  player: {
    x: number; z: number; facing: number; hp: number; energy: number;
    stamina?: number;                    // breath left for sprinting; absent in saves from before Agility: you wake with a full meter
    xp: Record<string, number>;
    inventory: ({ id: string; qty: number } | null)[];
    equipment: Record<string, string | null>;
    durability?: Record<string, number>; // points left on worn-down gear, by item id; absent in saves from before durability: everything loads whole
    enchants?: Record<string, string>;   // slot enchants, by slot; absent in saves from before the rune circle: nothing is enchanted
    talents?: Record<string, number>; // absent in saves from before the trees: nobody had spent a point
    learned?: string[];               // trainer abilities bought; absent in saves from before the trainer
    mounts?: string[];                // mounts owned, by id; absent in saves from before the stablemaster
    mounted?: boolean;                // riding when saved
    gold?: number;                    // absent in saves from before the economy: nobody had any
    buffs?: { id: string; left: number }[]; // absent in saves from before cooking: nobody was Well Fed
    chests?: string[];                // chests opened, by id (sim/chests.ts); absent in saves from before them: none were
  };
  bounties?: { active: { id: string; sig: string; kills: number; goal: number; gold: number; xp: number }[]; done: Record<string, number> }; // the boards' objectives (sim/bounties.ts); absent in saves from before them: none carried, none handed in
  found?: string[]; // flight masters found, by town id: absent in saves from before flights (only home is found)
  quest: { stage: QuestStage; kills: Record<string, number>; second?: Quest2Stage; third?: Quest3Stage; fourth?: Quest4Stage; fifth?: Quest5Stage; sixth?: Quest6Stage; seventh?: Quest7Stage; eighth?: Quest8Stage }; // `second` is absent in saves from before the cave, `third` in saves from before the road
  enemies: { id: number; type: string; deadIn: number }[]; // deadIn > 0: still respawning
  nodes: { id: number; type: string; charges: number; respawnIn: number }[];
  drops: { id: number; item: string; qty: number; x: number; z: number; age: number }[];
}

export function serialize(s: GameState): string {
  const p = s.player;
  // saving while dead stores the respawn: you wake at the nearest found town's graveyard, healed (the gear is already worn down); saving mid-ride stores the landing (the fare is already paid)
  const at = p.dead ? nearestTown(p.x, p.z, s.found).grave : p.action?.k === 'flight' ? landingSpot(p.action.to) : p;
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    tick: s.tick,
    rng: s.rng,
    nextDropId: s.nextDropId,
    player: {
      x: at.x, z: at.z, facing: p.facing,
      hp: p.dead ? p.maxHp : p.hp, energy: p.energy, stamina: p.stamina,
      xp: Object.fromEntries(SKILL_IDS.map(id => [id, p.skills[id].xp])),
      inventory: p.inventory.map(st => st && { id: st.id, qty: st.qty }),
      equipment: { ...p.equipment },
      durability: { ...p.durability },
      enchants: { ...p.enchants } as Record<string, string>,
      talents: { ...p.talents },
      gold: p.gold,
      buffs: p.buffs.map(b => ({ id: b.id, left: b.left })),
      learned: [...p.learned],
      mounts: [...p.mounts],
      mounted: p.mounted,
      chests: [...p.chests],
    },
    bounties: { active: s.bounties.active.map(a => ({ ...a })), done: { ...s.bounties.done } },
    found: [...s.found],
    quest: { stage: s.quest.stage, kills: { ...s.quest.kills }, second: s.quest.second, third: s.quest.third, fourth: s.quest.fourth, fifth: s.quest.fifth, sixth: s.quest.sixth, seventh: s.quest.seventh, eighth: s.quest.eighth },
    enemies: s.enemies.map(e => ({ id: e.id, type: e.type, deadIn: e.state === 'dead' ? Math.max(0, e.respawnIn) : 0 })),
    nodes: s.nodes.map(n => ({ id: n.id, type: n.type, charges: n.charges, respawnIn: n.respawnIn })),
    drops: s.drops.map(d => ({ id: d.id, item: d.item, qty: d.qty, x: d.x, z: d.z, age: d.age })),
  };
  return JSON.stringify(file);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, lo: number, hi: number, what: string): number => {
  if (!isNum(v) || v < lo || v > hi) throw new Error(`bad ${what}`);
  return v;
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rebuilds a state from a save string, or returns null for a wrong version, corrupt data, or anything unexpected. */
export function deserialize(raw: string): GameState | null {
  try {
    const f = JSON.parse(raw) as SaveFile;
    if (!isObj(f) || f.version !== SAVE_VERSION) return null;
    const s = createState(1);
    const p = s.player;

    s.tick = num(f.tick, 0, 1e12, 'tick');
    s.rng = num(f.rng, -2147483648, 4294967296, 'rng');
    s.nextDropId = num(f.nextDropId, 1, 1e9, 'nextDropId');

    const fp = f.player;
    if (!isObj(fp)) return null;
    for (const id of SKILL_IDS) {
      const raw = (fp.xp as Record<string, unknown>)[id];
      const xp = raw === undefined && LATE_SKILLS.includes(id) ? 0 : num(raw, 0, 1e10, `xp.${id}`); // saves from before these skills have none
      p.skills[id].xp = xp;
      p.skills[id].level = levelForXp(xp);
    }
    if (!Array.isArray(fp.inventory) || fp.inventory.length !== INVENTORY_SIZE) return null;
    fp.inventory.forEach((st, i) => {
      if (st === null) return;
      const id = isObj(st) && typeof st.id === 'string' ? itemId(st.id) : '';
      const def = ITEMS[id];
      if (!def) throw new Error('bad item');
      p.inventory[i] = { id, qty: num(st.qty, 1, def.stack, 'qty') };
    });
    for (const slot of EQUIP_SLOTS) {
      const raw = (fp.equipment as Record<string, unknown>)[slot];
      if (raw === null || raw === undefined) continue;
      const id = typeof raw === 'string' ? itemId(raw) : '';
      if (ITEMS[id]?.slot !== slot) throw new Error('bad equipment');
      p.equipment[slot] = id;
    }
    if (fp.durability !== undefined) {
      if (!isObj(fp.durability)) return null;
      for (const [raw, n] of Object.entries(fp.durability)) {
        const id = itemId(raw);
        if (!ITEMS[id]?.slot) throw new Error('bad durability');
        p.durability[id] = num(n, 0, MAX_DURABILITY, `durability.${id}`);
      }
    }
    // enchants: each must be a real one that goes on the slot it is saved against (it need not be worn: the enchant belongs to the slot)
    if (fp.enchants !== undefined) {
      if (!isObj(fp.enchants)) return null;
      for (const [slot, id] of Object.entries(fp.enchants)) {
        if (!EQUIP_SLOTS.includes(slot as EquipSlot) || typeof id !== 'string' || !enchantById(id)?.slots.includes(slot as EquipSlot)) throw new Error('bad enchant');
        p.enchants[slot as EquipSlot] = id;
      }
    }
    // talents: validated against the level, so a hand-edited save cannot buy a tier it never paid for
    if (fp.talents !== undefined) {
      if (!isObj(fp.talents)) return null;
      for (const [id, n] of Object.entries(fp.talents)) {
        const def = talentById(id);
        if (!def) throw new Error('bad talent');
        p.talents[id] = num(n, 1, def.ranks, `talent.${id}`);
      }
      if (!legalTalents(p.talents, levelForXp(p.combat.xp))) throw new Error('impossible talent build');
    }
    if (fp.learned !== undefined) {
      if (!Array.isArray(fp.learned)) return null;
      for (const n of fp.learned) {
        if (!ABILITIES.some(a => a.name === n && a.trainer)) throw new Error('bad learned ability');
        if (!p.learned.includes(n)) p.learned.push(n);
      }
    }
    if (fp.mounts !== undefined) {
      if (!Array.isArray(fp.mounts)) return null;
      for (const id of fp.mounts) {
        if (typeof id !== 'string' || !mountById(id)) throw new Error('bad mount');
        if (!p.mounts.includes(id)) p.mounts.push(id);
      }
    }
    if (fp.gold !== undefined) p.gold = num(fp.gold, 0, MAX_GOLD, 'gold');
    // chests: matched by id, so a chest the placements no longer have is ignored rather than refusing the save (the way enemies and nodes are)
    if (fp.chests !== undefined) {
      if (!Array.isArray(fp.chests)) return null;
      for (const id of fp.chests) {
        if (typeof id !== 'string') throw new Error('bad chest');
        if (chestById(id) && !p.chests.includes(id)) p.chests.push(id);
      }
    }
    if (fp.buffs !== undefined) {
      if (!Array.isArray(fp.buffs)) return null;
      for (const b of fp.buffs) {
        if (!isObj(b) || typeof b.id !== 'string' || !BUFFS[b.id]) throw new Error('bad buff');
        if (!p.buffs.some(x => x.id === b.id)) p.buffs.push({ id: b.id, left: num(b.left, 0.01, BUFFS[b.id].duration, 'buff time') });
      }
    }
    refreshTalents(s);
    refreshGearStats(s);
    refreshPlayerStats(s, false);
    p.unlocked = p.combat.level; // abilities already earned are not announced again
    p.x = num(fp.x, -WORLD_LIMIT, WORLD_LIMIT, 'x'); p.z = num(fp.z, -WORLD_LIMIT, WORLD_LIMIT, 'z'); p.facing = num(fp.facing, -100, 100, 'facing');
    resolveCollisions(p);
    p.mounted = fp.mounted === true && p.mounts.length > 0 && mountsAllowed(p.x, p.z); // a saddle that is no longer yours, or is in a dungeon room, is empty
    p.hp = Math.min(p.maxHp, Math.max(1, num(fp.hp, 0, 1e6, 'hp')));
    p.energy = Math.min(p.maxEnergy, num(fp.energy, 0, 1e6, 'energy'));
    // the ceiling follows the Agility level loaded above, so a save made at a lower level cannot carry a longer meter in
    p.stamina = fp.stamina === undefined ? maxStamina(p) : Math.min(maxStamina(p), num(fp.stamina, 0, 1e6, 'stamina'));

    // bounties: matched by id and by the signature of what counts as a kill, so a bounty the table dropped or re-aimed is ignored rather than mis-applied to a live character
    if (f.bounties !== undefined) {
      const fb = f.bounties;
      if (!isObj(fb) || !Array.isArray(fb.active) || !isObj(fb.done)) return null;
      for (const fa of fb.active) {
        if (!isObj(fa) || typeof fa.id !== 'string') throw new Error('bad bounty');
        const d = bountyById(fa.id);
        if (!d || fa.sig !== targetSig(d) || s.bounties.active.length >= MAX_ACTIVE || s.bounties.active.some(a => a.id === d.id)) continue;
        const goal = num(fa.goal, 1, MAX_GOAL, 'bounty goal');
        const a: ActiveBounty = { id: d.id, sig: targetSig(d), goal, kills: Math.min(goal, num(fa.kills, 0, MAX_GOAL, 'bounty kills')), gold: num(fa.gold, 0, MAX_GOLD, 'bounty gold'), xp: num(fa.xp, 0, 1e7, 'bounty xp') };
        s.bounties.active.push(a);
      }
      for (const [id, n] of Object.entries(fb.done)) if (bountyById(id)) s.bounties.done[id] = num(n, 0, 1e9, 'bounty count');
    }

    if (f.found !== undefined) {
      if (!Array.isArray(f.found)) return null;
      for (const id of f.found) {
        if (typeof id !== 'string' || !masterById(id)) throw new Error('bad flight master');
        if (!s.found.includes(id)) s.found.push(id);
      }
    }

    const fq = f.quest;
    if (!isObj(fq) || !QUEST_STAGES.includes(fq.stage as QuestStage) || !isObj(fq.kills)) return null;
    s.quest.stage = fq.stage as QuestStage;
    // an older save has no second chain: it is on offer if the first was handed in, locked otherwise
    if (fq.second !== undefined && !QUEST2_STAGES.includes(fq.second)) return null;
    s.quest.second = fq.second ?? (fq.stage === 'done' ? 'offer' : 'locked');
    if ((s.quest.second === 'locked') !== (s.quest.stage !== 'done')) return null; // the chains cannot disagree about whether the first is over
    // an older save has no third chain: it is on offer if the Hollow was cleared, locked otherwise
    if (fq.third !== undefined && !QUEST3_STAGES.includes(fq.third)) return null;
    s.quest.third = fq.third ?? (s.quest.second === 'cleared' ? 'offer' : 'locked');
    if (s.quest.third !== 'locked' && s.quest.second !== 'cleared') return null; // the road opens when the Hollow is quiet, and not before (a save made in the tick it opened still says locked, and the next tick opens it)
    // the errand is no part of the story: a save from before it has not been offered it yet
    if (fq.fourth !== undefined && !QUEST4_STAGES.includes(fq.fourth)) return null;
    s.quest.fourth = fq.fourth ?? 'offer';
    // an older save has no fifth chain (Brine and Bone): on offer if the road was cleared, locked otherwise
    if (fq.fifth !== undefined && !QUEST5_STAGES.includes(fq.fifth)) return null;
    s.quest.fifth = fq.fifth ?? (s.quest.third === 'cleared' ? 'offer' : 'locked');
    if (s.quest.fifth !== 'locked' && s.quest.third !== 'cleared') return null; // the Strand's work comes after the road's, never before
    // likewise the Rotroot's (the bible's Q5): on offer if the Strand was cleared, locked otherwise, and never open before it
    if (fq.sixth !== undefined && !QUEST6_STAGES.includes(fq.sixth)) return null;
    s.quest.sixth = fq.sixth ?? (s.quest.fifth === 'cleared' ? 'offer' : 'locked');
    if (s.quest.sixth !== 'locked' && s.quest.fifth !== 'cleared') return null;
    // and the writ's (the bible's Q6): on offer if the Rotroot's chain was handed in, locked otherwise, and never open before it
    if (fq.seventh !== undefined && !QUEST7_STAGES.includes(fq.seventh)) return null;
    s.quest.seventh = fq.seventh ?? (s.quest.sixth === 'cleared' ? 'offer' : 'locked');
    if (s.quest.seventh !== 'locked' && s.quest.sixth !== 'cleared') return null;
    // and the seal's (the bible's Q7): on offer if the writ was signed, locked otherwise, and never open before it
    if (fq.eighth !== undefined && !QUEST8_STAGES.includes(fq.eighth)) return null;
    s.quest.eighth = fq.eighth ?? (s.quest.seventh === 'cleared' ? 'offer' : 'locked');
    if (s.quest.eighth !== 'locked' && s.quest.seventh !== 'cleared') return null;
    for (const [type, n] of Object.entries(fq.kills)) s.quest.kills[type] = num(n, 0, 1000, 'kills');

    // enemies / nodes: matched by id and type, so a changed spawn table is ignored rather than mis-applied
    if (!Array.isArray(f.enemies) || !Array.isArray(f.nodes) || !Array.isArray(f.drops)) return null;
    for (const fe of f.enemies) {
      const e = s.enemies.find(x => x.id === fe?.id && x.type === fe?.type);
      if (!e || num(fe.deadIn, 0, 1e10, 'deadIn') <= 0) continue;
      e.state = 'dead'; e.hp = 0; e.respawnIn = fe.deadIn; e.deadFor = 99; // 99: already fallen, so it is drawn hidden
    }
    for (const fn of f.nodes) {
      const n = s.nodes.find(x => x.id === fn?.id && x.type === fn?.type);
      if (!n) continue;
      n.charges = num(fn.charges, 0, 100, 'charges');
      n.respawnIn = num(fn.respawnIn, 0, 1e6, 'respawnIn');
    }
    for (const fd of f.drops) {
      const item = typeof fd?.item === 'string' ? itemId(fd.item) : '';
      if (!ITEMS[item]) continue;
      s.drops.push({ id: num(fd.id, 1, 1e9, 'drop id'), item, qty: num(fd.qty, 1, 1e4, 'drop qty'),
        x: num(fd.x, -WORLD_LIMIT, WORLD_LIMIT, 'drop x'), z: num(fd.z, -WORLD_LIMIT, WORLD_LIMIT, 'drop z'), age: num(fd.age, 0, 1e6, 'drop age'), blocked: true });
    }
    s.events.length = 0;
    return s;
  } catch {
    return null;
  }
}

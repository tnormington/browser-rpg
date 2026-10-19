// Save format: a versioned JSON snapshot of the progress that matters. Pure sim (no DOM): storage lives in src/storage.ts.
// Transient state (aggro, cooldowns, current action, moveTarget, target) is deliberately not saved: a loaded game
// resumes calm. Anything unrecognised or malformed makes deserialize return null, and the caller starts a new game.
import { GameState, createState } from '../sim';
import { SKILL_IDS } from './skills';
import { levelForXp } from './xp';
import { INVENTORY_SIZE, refreshGearStats } from './inventory';
import { EQUIP_SLOTS, ITEMS } from './items';
import { refreshPlayerStats } from './combat';
import { PLAYER_SPAWN } from './data';
import { QUEST2_STAGES, QUEST_STAGES, Quest2Stage, QuestStage } from './quest';
import { legalTalents, refreshTalents, talentById } from './talents';
import { resolveCollisions } from './world';
import { MAX_GOLD } from './shop';

export const SAVE_VERSION = 1;

interface SaveFile {
  version: number;
  savedAt: number;
  tick: number;
  rng: number;
  nextDropId: number;
  player: {
    x: number; z: number; facing: number; hp: number; energy: number;
    xp: Record<string, number>;
    inventory: ({ id: string; qty: number } | null)[];
    equipment: Record<string, string | null>;
    talents?: Record<string, number>; // absent in saves from before the trees: nobody had spent a point
    gold?: number;                    // absent in saves from before the economy: nobody had any
  };
  quest: { stage: QuestStage; kills: Record<string, number>; second?: Quest2Stage }; // `second` is absent in saves from before the cave
  enemies: { id: number; type: string; deadIn: number }[]; // deadIn > 0: still respawning
  nodes: { id: number; type: string; charges: number; respawnIn: number }[];
  drops: { id: number; item: string; qty: number; x: number; z: number; age: number }[];
}

export function serialize(s: GameState): string {
  const p = s.player;
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    tick: s.tick,
    rng: s.rng,
    nextDropId: s.nextDropId,
    player: {
      // saving while dead stores the respawn: you wake at the clearing, healed
      x: p.dead ? PLAYER_SPAWN.x : p.x, z: p.dead ? PLAYER_SPAWN.z : p.z, facing: p.facing,
      hp: p.dead ? p.maxHp : p.hp, energy: p.energy,
      xp: Object.fromEntries(SKILL_IDS.map(id => [id, p.skills[id].xp])),
      inventory: p.inventory.map(st => st && { id: st.id, qty: st.qty }),
      equipment: { ...p.equipment },
      talents: { ...p.talents },
      gold: p.gold,
    },
    quest: { stage: s.quest.stage, kills: { ...s.quest.kills }, second: s.quest.second },
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
      const xp = num((fp.xp as Record<string, unknown>)[id], 0, 1e10, `xp.${id}`);
      p.skills[id].xp = xp;
      p.skills[id].level = levelForXp(xp);
    }
    if (!Array.isArray(fp.inventory) || fp.inventory.length !== INVENTORY_SIZE) return null;
    fp.inventory.forEach((st, i) => {
      if (st === null) return;
      const def = isObj(st) && typeof st.id === 'string' ? ITEMS[st.id] : undefined;
      if (!def) throw new Error('bad item');
      p.inventory[i] = { id: st.id as string, qty: num(st.qty, 1, def.stack, 'qty') };
    });
    for (const slot of EQUIP_SLOTS) {
      const id = (fp.equipment as Record<string, unknown>)[slot];
      if (id === null || id === undefined) continue;
      if (typeof id !== 'string' || ITEMS[id]?.slot !== slot) throw new Error('bad equipment');
      p.equipment[slot] = id;
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
    if (fp.gold !== undefined) p.gold = num(fp.gold, 0, MAX_GOLD, 'gold');
    refreshTalents(s);
    refreshGearStats(s);
    refreshPlayerStats(s, false);
    p.unlocked = p.combat.level; // abilities already earned are not announced again
    p.x = num(fp.x, -1000, 1000, 'x'); p.z = num(fp.z, -1000, 1000, 'z'); p.facing = num(fp.facing, -100, 100, 'facing');
    resolveCollisions(p);
    p.hp = Math.min(p.maxHp, Math.max(1, num(fp.hp, 0, 1e6, 'hp')));
    p.energy = Math.min(p.maxEnergy, num(fp.energy, 0, 1e6, 'energy'));

    const fq = f.quest;
    if (!isObj(fq) || !QUEST_STAGES.includes(fq.stage as QuestStage) || !isObj(fq.kills)) return null;
    s.quest.stage = fq.stage as QuestStage;
    // an older save has no second chain: it is on offer if the first was handed in, locked otherwise
    if (fq.second !== undefined && !QUEST2_STAGES.includes(fq.second)) return null;
    s.quest.second = fq.second ?? (fq.stage === 'done' ? 'offer' : 'locked');
    if ((s.quest.second === 'locked') !== (s.quest.stage !== 'done')) return null; // the chains cannot disagree about whether the first is over
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
      if (!ITEMS[fd?.item]) continue;
      s.drops.push({ id: num(fd.id, 1, 1e9, 'drop id'), item: fd.item, qty: num(fd.qty, 1, 1e4, 'drop qty'),
        x: num(fd.x, -1000, 1000, 'drop x'), z: num(fd.z, -1000, 1000, 'drop z'), age: num(fd.age, 0, 1e6, 'drop age'), blocked: true });
    }
    s.events.length = 0;
    return s;
  } catch {
    return null;
  }
}

// HUD: DOM overlay. Reads GameState and sim events; never mutates sim state.
import { GameState, GameEvent, ResourceNode, Enemy } from './sim';
import { ABILITIES, AbilityDef, defOf, GCD, abilityArtId, castName } from './sim/data';
import { levelProgress } from './sim/xp';
import { ITEMS } from './sim/items';
import { placeById } from './sim/chests';
import { InvAction, countItem } from './sim/inventory';
import { SKILLS, SkillId } from './sim/skills';
import { Status, enemyStatuses, playerStatuses } from './sim/status';
import { TALENTS, spentTotal, talentPoints, talentById } from './sim/talents';
import { NODE_TYPES } from './sim/gathering';
import { recipeById } from './sim/crafting';
import { nearestTown } from './sim/world';
import { BUFFS, FOOD_COOLDOWN } from './sim/consumables';
import { clearLine } from './sim/sight';
import { abilityOpen, cooldownOf, costOf, swingInterval } from './sim/combat';
import { PROCS, procOn } from './sim/procs';
import { VENDORS } from './sim/shop';
import { mountById } from './sim/mounts';
import { maxStamina } from './sim/agility';
import { InventoryUi } from './inventory-ui';
import { SkillsUi } from './skills-ui';
import { TalentsUi } from './talents-ui';
import { ForgeUi } from './forge-ui';
import { EnchantUi } from './enchant-ui';
import { enchantById } from './sim/enchants';
import type { EnchantAction } from './sim/enchanting';
import { ShopUi } from './shop-ui';
import { FlightUi, MapUi, MapView } from './flight-ui';
import { BoardUi } from './board-ui';
import { QuestUi } from './quest-ui';
import { MenuUi } from './menu-ui';
import { AdminUi } from './admin-ui';
import type { AdminAction } from './sim/admin';
import { SpellbookUi } from './spellbook-ui';
import { Minimap } from './minimap';
import { DockWindow, HudWindow, el, dragData, parseDrag } from './dom';
import { abilityArt, enemyArt, faceRow, itemArt, paintArt, preloadItemArt, setFaceArt } from './art';
import { Dock } from './dock';
import { loadBar, loadBarKeys, saveBar, saveBarKeys } from './storage';
import { BarEntry, DEFAULT_KEYS, barWorthy, bindKey, bindRefusal, keyLabel, sameEntry, sanitizeBar, sanitizeKeys } from './bar-layout';

const PUMMEL = ABILITIES.findIndex(a => a.kind === 'interrupt');

export interface HudActions {
  inv: (a: InvAction) => void;
  talent: (id: string) => void;
  talentReset: () => void;
  craft: (recipe: string, count: number) => void;
  enchant: (a: EnchantAction) => void;
  sell: (slot: number, qty: number) => void;
  buy: (item: string, qty: number) => void;
  fly: (to: string) => void;
  bounty: (a: import('./sim/bounties').BountyAction) => void;
  map: MapView;
  learn: (slot: number) => void;
  repair: () => void;
  buyMount: (id: string) => void;
  questAdvance: (what: boolean | 'road') => void;
  save: () => void;
  newGame: () => void;
  quality: (toggle: boolean) => import('./post').Quality;
  /** Dev tooling: present only when main.ts has the debug flag on, and the only thing that builds the QA panel. */
  admin?: (a: AdminAction) => void;
}

/** The player-facing message for a refused gather/craft. Level failures say exactly what is needed. */
function actionFailText(ev: Extract<GameEvent, { t: 'actionfail' }>): string {
  switch (ev.reason) {
    case 'level': return `You need ${SKILLS[ev.skill!].name} level ${ev.need} to ${SKILLS[ev.skill!].verb} ${ev.what}`; // a level failure always names its skill
    case 'req': return `You need Combat level ${ev.need} to wear ${ev.what}`;
    case 'depleted': return `${ev.what} is depleted: it will return shortly`;
    case 'full': return 'Inventory full';
    case 'materials': return `Missing materials for ${ev.what}`;
    case 'range': return `Move closer to the ${ev.station ?? 'merchant'}`;
    case 'cooldown': return `${ev.what}: you cannot eat again yet`;
    case 'combat': return `${ev.what} needs a quiet moment: not in combat`;
    case 'gold': return `Not enough gold for ${ev.what}`;
    case 'mount': return ev.what; // the sentence is the sim's: it knows which rule refused
  }
}

type Project = (x: number, y: number, z: number) => { x: number; y: number } | null;

/** Why a slot will not fire: the level it still wants, the trainer who sells it, or the talent that hands it over. */
function lockedWhy(a: AbilityDef, level: number): string {
  if (level < a.unlockLevel) return `${a.name} unlocks at combat level ${a.unlockLevel} (you are level ${level})`;
  if (a.trainer) return `${a.name} is taught by ${VENDORS.find(v => v.id === a.trainer!.vendor)!.name}: ${a.trainer.price} gold`;
  return `${a.name} comes with the ${talentById(a.talent!)!.name} talent (N)`;
}

const ICONS =['⚔', '🔨', '🗡', '❤', '🌀', '✊', '🌪', '🛡', '🫀', '🔰', '🩸', '💥', '🏰', '🔥', '💨', '⚡'];
/** The face a consumable with no thumbnail wears on the bar: the bag draws its food the same way. */
const ITEM_ICON = '🍖';
/** How many slots the bar has: one per key it ships with. */
const SLOT_COUNT = DEFAULT_KEYS.length;
const FAIL_TEXT = {
  range: 'Out of range', cooldown: 'Not ready yet', gcd: 'Not ready yet',
  energy: 'Not enough energy', target: 'No target', nocast: 'Nothing to interrupt',
  rooted: 'Held fast: you cannot leap', noroom: 'No room to leap',
} as const;
/** How long a freshly unlocked slot keeps glowing, and the gap between banners when one level hands over several abilities. */
const UNLOCK_GLOW_MS = 4000, UNLOCK_BANNER_GAP_MS = 1900;
/** Seconds the centre message holds at full strength before it fades out over the next two thirds of one. */
const MSG_HOLD = 0.4;

function bar(parent: HTMLElement, cls: string) {
  const outer = el(parent, `bar ${cls}`);
  const fill = el(outer, 'fill');
  const label = el(outer, 'label');
  return { fill, label };
}

/** A duration as the HUD prints it: seconds under a minute, m:ss above. */
const clock = (t: number) => {
  const n = Math.max(0, Math.ceil(t));
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

/** The row of buff / debuff icons under a unit frame. An icon is built once and kept while the effect lasts: only its clock and bar move. */
class StatusRow {
  private cells = new Map<string, { root: HTMLElement; clock: HTMLElement; fill: HTMLElement }>();

  constructor(private host: HTMLElement) {}

  update(list: Status[]) {
    for (const [key, cell] of this.cells) {
      if (list.some(s => s.key === key)) continue;
      cell.root.remove();
      this.cells.delete(key);
    }
    for (const s of list) {
      let cell = this.cells.get(s.key);
      if (!cell) {
        const root = el(this.host, `buff${s.bad ? ' bad' : ''}${s.proc ? ' proc' : ''}`);
        el(root, 'bicon', s.icon);
        cell = { root, clock: el(root, 'bclock'), fill: el(root, 'bfill') };
        this.cells.set(s.key, cell);
      }
      const left = clock(s.left);
      cell.root.title = `${s.name}  -  ${left} left`;
      cell.clock.textContent = left;
      cell.fill.style.width = `${Math.max(0, Math.min(1, s.left / s.total)) * 100}%`;
      cell.root.classList.toggle('soon', s.left <= 5);
    }
  }
}

/** Opaque HUD panels that world-space plates must not draw over. */
const PLATE_BLOCKERS = '.frame, .tracker, .panel, .actionbar, .msglog, .menubar, .xp, .minimap';
const PLATE_HALF_W = 45, PLATE_H = 28; // generous footprint of a nameplate around its anchor
const NODE_PLATE_W = 96, NODE_PLATE_H = 36; // two plates closer than this on screen overlap
const PLATE_W = 96, PLATE_STACK_H = 40; // enemy plate footprint; a clustered plate is lifted one step per plate beneath it
const FLOATER_HALF_W = 24, FLOATER_HALF_H = 14; // footprint of a floating number around its centre

interface Floater { el: HTMLElement; x: number; y: number; z: number; age: number; drift: number; pop: boolean }

export class Hud {
  private root = el(document.body, 'hud');
  private playerLvl: HTMLElement;
  private hp: ReturnType<typeof bar>;
  private energy: ReturnType<typeof bar>;
  private stamina: ReturnType<typeof bar>;
  private xp: ReturnType<typeof bar>;
  private targetFrame: HTMLElement;
  private targetFace: HTMLElement;
  private targetName: HTMLElement;
  private targetHp: ReturnType<typeof bar>;
  private targetCast: ReturnType<typeof bar>;
  private playerStatus: StatusRow;
  private targetStatus: StatusRow;
  /** Which track the XP bar shows: the skill that last earned XP, so the bar follows whatever is being levelled. */
  private xpSkill: SkillId = 'combat';
  /** One per bar slot: `entry` is what it currently fires, null when the slot is empty. */
  private slots: { root: HTMLElement; icon: HTMLElement; key: HTMLElement; aname: HTMLElement; qty: HTMLElement; sweep: HTMLElement; cdText: HTMLElement; lock: HTMLElement; lockText: HTMLElement; entry: BarEntry | null }[] = [];
  private bar = sanitizeBar(loadBar(), SLOT_COUNT, ABILITIES.length);
  /** The key each slot answers to, the player's own: `keys[i]` is a `KeyboardEvent.code`, or '' for an unbound slot. */
  private keys = sanitizeKeys(loadBarKeys(), SLOT_COUNT);
  /** The slot waiting for the key the player is about to press, or -1 when nothing is being rebound. */
  private binding = -1;
  private swingBar: ReturnType<typeof bar>;
  private msg: HTMLElement;
  private banner: HTMLElement;
  private deathOverlay: HTMLElement;
  private plates = new Map<number, { root: HTMLElement; fill: HTMLElement; cast: HTMLElement; castFill: HTMLElement }>();
  private floaters: Floater[] = [];
  private msgAge = 99;
  private msgHold = MSG_HOLD;
  private log: HTMLElement;
  private questUi: QuestUi;
  private menuUi: MenuUi;
  private questBanner: HTMLElement;
  private unlockBanner: HTMLElement;
  private warn: HTMLElement;
  private unlockQueue = 0;
  private hurt: HTMLElement;
  private invUi: InventoryUi;
  private skillsUi: SkillsUi;
  private talentsUi: TalentsUi;
  private forgeUi: ForgeUi;
  private rangeUi: ForgeUi;
  private alembicUi: ForgeUi;
  private rackUi: ForgeUi;
  private enchantUi: EnchantUi;
  private shopUi: ShopUi;
  private flightUi: FlightUi;
  private boardUi: BoardUi;
  private mapUi: MapUi;
  private bookUi: SpellbookUi;
  /** The QA panel, or null in a build without the debug flag. */
  private adminUi: AdminUi | null = null;
  private minimap: Minimap;
  /** Every panel Esc shuts, in the order they are built. */
  private windows: HudWindow[] = [];
  /** The windows that open in the dock (dock.ts), which settles them after anything opens or closes one. */
  private dockWindows: DockWindow[] = [];
  private dock: Dock;
  private goldEl: HTMLElement;
  private statusEl: HTMLElement;
  private castBar: ReturnType<typeof bar>;
  /** A gather/craft is running (or was just requested): a hit while true is what broke it. */
  private acting = false;
  /** What the last death cost, for the overlay while the player waits. */
  private cost = ''; // what the last death cost: the worn-down gear and the walk back, shown under the death overlay and in the log
  private nodePlates = new Map<number, { root: HTMLElement; sub: HTMLElement }>();

  constructor(private project: Project, private yaw: () => number, actions: HudActions) {
    const pf = el(this.root, 'chrome frame player');
    this.playerLvl = el(pf, 'name');
    this.goldEl = el(pf, 'gold');
    this.statusEl = el(pf, 'status');
    this.hp = bar(pf, 'hp');
    this.energy = bar(pf, 'energy');
    this.stamina = bar(pf, 'stamina');
    this.playerStatus = new StatusRow(el(pf, 'buffs'));

    this.targetFrame = el(this.root, 'chrome frame target');
    // the enemy's face left of its name and bars, in the row a panel wears a portrait in (HOM-144). The buffs
    // stay a child of the frame itself: they hang above it, clear of both columns.
    const tfr = faceRow(this.targetFrame);
    this.targetFace = tfr.face;
    this.targetName = el(tfr.body, 'name');
    this.targetHp = bar(tfr.body, 'enemyhp');
    this.targetCast = bar(tfr.body, 'enemycast');
    this.targetStatus = new StatusRow(el(this.targetFrame, 'buffs'));

    this.xp = bar(this.root, 'xp');
    this.minimap = new Minimap(this.root); // before the panels, so an open panel prints over it

    const ab = el(this.root, 'actionbar');
    ab.style.setProperty('--slots', String(SLOT_COUNT)); // the CSS sizes a slot so the whole bar fits one row of the window
    for (let i = 0; i < SLOT_COUNT; i++) {
      const root = el(ab, 'slot');
      const icon = el(root, 'icon');
      const key = el(root, 'key');
      const aname = el(root, 'aname');
      const qty = el(root, 'qty');
      const sweep = el(root, 'sweep');
      const cdText = el(root, 'cdtext');
      const lock = el(root, 'lock');
      el(lock, 'lockicon', '🔒');
      const lockText = el(lock, 'locklvl');
      this.slots.push({ root, icon, key, aname, qty, sweep, cdText, lock, lockText, entry: null });
      key.addEventListener('click', e => { e.stopPropagation(); this.startBinding(i); });
      root.addEventListener('dragstart', e => {
        if (this.bar[i] === null) return e.preventDefault();
        e.dataTransfer?.setData('text/plain', dragData({ k: 'bar', slot: i }));
      });
      root.addEventListener('dragover', e => e.preventDefault());
      root.addEventListener('drop', e => { e.preventDefault(); this.dropOnBar(i, e.dataTransfer?.getData('text/plain') ?? ''); });
      root.addEventListener('contextmenu', e => { e.preventDefault(); this.assign(i, null); });
    }

    this.swingBar = bar(this.root, 'swing');
    this.msg = el(this.root, 'msg');
    this.banner = el(this.root, 'banner');
    this.deathOverlay = el(this.root, 'death');
    this.questBanner = el(this.root, 'banner questbanner');
    this.unlockBanner = el(this.root, 'banner unlockbanner');
    this.warn = el(this.root, 'warn');
    this.hurt = el(this.root, 'hurt');
    // the rail is the left column: the quest tracker on top, the message log under it. They are flex items of one box, so they cannot print over each other.
    const rail = el(this.root, 'rail');
    this.log = el(rail, 'msglog');
    this.dock = new Dock(this.root);
    const dock = this.dock.el;
    this.invUi = new InventoryUi(dock, actions.inv, actions.sell);
    this.skillsUi = new SkillsUi(dock);
    this.talentsUi = new TalentsUi(dock, { learn: actions.talent, reset: actions.talentReset });
    this.shopUi = new ShopUi(dock, actions.buy, actions.learn, actions.repair, actions.buyMount);
    this.flightUi = new FlightUi(dock, actions.fly);
    this.boardUi = new BoardUi(dock, actions.bounty);
    this.mapUi = new MapUi(this.root, actions.map);
    const craft = (r: string, n: number) => { this.acting = true; actions.craft(r, n); };
    this.forgeUi = new ForgeUi(dock, 'forge', 'Forge', craft);
    this.rangeUi = new ForgeUi(dock, 'range', 'Cooking Range', craft);
    this.alembicUi = new ForgeUi(dock, 'alembic', 'Alembic', craft);
    this.rackUi = new ForgeUi(dock, 'rack', 'Tanning Rack', craft);
    this.enchantUi = new EnchantUi(dock, actions.enchant);
    this.castBar = bar(this.root, 'castbar');
    this.questUi = new QuestUi(rail, dock, actions.questAdvance);
    this.bookUi = new SpellbookUi(dock, () => this.bar, a => this.keyForAbility(a), a => this.assign(this.slotOfAbility(a), null));
    if (actions.admin) this.adminUi = new AdminUi(this.root, dock, actions.admin);
    this.menuUi = new MenuUi(this.root, actions);
    this.windows = [this.mapUi, this.menuUi, this.questUi, this.shopUi, this.flightUi, this.boardUi, this.forgeUi, this.rangeUi, this.alembicUi, this.rackUi, this.enchantUi,
      this.skillsUi, this.talentsUi, this.bookUi, this.invUi.panels.inv, this.invUi.panels.char,
      ...(this.adminUi ? [this.adminUi] : [])];
    // every window the dock lays out: all of them but the map (a screen of its own) and the help (a veil over everything)
    this.dockWindows = [this.questUi, this.shopUi, this.flightUi, this.boardUi, this.forgeUi, this.rangeUi, this.alembicUi, this.rackUi, this.enchantUi,
      this.skillsUi, this.talentsUi, this.bookUi, this.invUi.panels.inv, this.invUi.panels.char,
      ...(this.adminUi ? [this.adminUi] : [])];
    this.renderBar();
    preloadItemArt(); // every panel built above that draws an item is shut, so none of their thumbnails would be sent for until one opens
  }

  toggle(which: 'inv' | 'char' | 'skills' | 'talents' | 'book') {
    if (which === 'skills') this.skillsUi.toggle();
    else if (which === 'talents') this.talentsUi.toggle();
    else if (which === 'book') this.bookUi.toggle();
    else this.invUi.toggle(which);
    this.dock.settle(this.dockWindows);
  }

  toggleHelp() { this.menuUi.toggle(); }
  toggleMap() { this.mapUi.toggle(); }
  /** The QA panel, where there is one: a build without the debug flag has none and this does nothing. */
  toggleAdmin() { this.adminUi?.toggle(); }

  /** A dialogue, the help screen or the map has focus: game keys (jump) must not act under it. */
  get modalOpen(): boolean { return this.menuUi.isOpen || this.questUi.isOpen || this.mapUi.isOpen; }

  /** Esc: shuts every HUD window that is open, not just the topmost. Returns true if it closed something. */
  closeAll(): boolean {
    let closed = false;
    for (const w of this.windows) if (w.isOpen) { w.setOpen(false); closed = true; }
    return closed;
  }

  // ---------- action bar layout ----------

  /** What a bar slot fires, or null when it is empty. main.ts turns it into a cast or a swig. */
  entryAt(barSlot: number): BarEntry | null { return this.bar[barSlot] ?? null; }

  /** The slot a key press belongs to, or -1 when the bar does not want that key. */
  slotForKey(code: string): number { return code ? this.keys.indexOf(code) : -1; }

  /** Where an ability sits on the bar, as the key the player presses; null when it is not on the bar, or its slot has no key. */
  private keyForAbility(ability: number): string | null {
    const at = this.slotOfAbility(ability);
    return at < 0 || !this.keys[at] ? null : keyLabel(this.keys[at]);
  }

  private slotOfAbility(ability: number) { return this.bar.findIndex(e => e?.k === 'ability' && e.i === ability); }

  /** Put something in a slot (or empty it). It lives in one slot only, so its old one is cleared. */
  private assign(barSlot: number, entry: BarEntry | null) {
    if (barSlot < 0 || barSlot >= this.bar.length) return;
    if (entry) {
      const old = this.bar.findIndex(e => sameEntry(e, entry));
      if (old >= 0) this.bar[old] = null;
    }
    this.bar[barSlot] = entry;
    this.barChanged();
  }

  /** A drop on a bar slot: a spell from the book or a consumable from the bag lands there, another slot swaps with it. */
  private dropOnBar(barSlot: number, data: string) {
    const d = parseDrag(data);
    if (!d) return;
    if (d.k === 'spell') return this.assign(barSlot, d.i < ABILITIES.length ? { k: 'ability', i: d.i } : null);
    if (d.k === 'bag') {
      if (!barWorthy(d.id)) return this.say(`${ITEMS[d.id]?.name ?? 'That'} is not something you can use: only food and potions go on the bar`);
      return this.assign(barSlot, { k: 'item', id: d.id });
    }
    if (d.slot >= this.bar.length || d.slot === barSlot) return;
    [this.bar[barSlot], this.bar[d.slot]] = [this.bar[d.slot], this.bar[barSlot]];
    this.barChanged();
  }

  private barChanged() {
    saveBar(this.bar);
    this.renderBar();
    this.bookUi.invalidate();
  }

  // ---------- rebinding ----------

  /**
   * The player clicked a slot's key: the next key they press becomes that slot's, Esc leaves it alone and
   * Backspace unbinds it. The listener captures, so the key never reaches the game while the bar is waiting for it.
   */
  private startBinding(barSlot: number) {
    if (this.binding === barSlot) return this.stopBinding();
    this.stopBinding();
    this.binding = barSlot;
    this.slots[barSlot].root.classList.add('binding');
    this.slots[barSlot].key.textContent = '?';
    this.say('Press the key for this slot  -  Backspace clears it, Esc keeps the one it has');
    addEventListener('keydown', this.onBindKey, true);
  }

  private stopBinding() {
    if (this.binding < 0) return;
    removeEventListener('keydown', this.onBindKey, true);
    this.slots[this.binding].root.classList.remove('binding');
    this.binding = -1;
    this.renderBar();
  }

  /** Bound so it can be added and removed as the same listener; stays live only while a slot is waiting. */
  private onBindKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const barSlot = this.binding;
    if (e.code === 'Escape') return this.stopBinding();
    if (e.code === 'Backspace' || e.code === 'Delete') {
      this.keys[barSlot] = '';
      this.keysChanged();
      return this.say('That slot now has no key');
    }
    const refusal = bindRefusal(e.code);
    if (refusal) return this.say(`${refusal}: try another key, or Esc`); // still waiting: the player gets another go
    const taken = this.keys.indexOf(e.code);
    this.keys = bindKey(this.keys, barSlot, e.code);
    this.keysChanged();
    this.say(taken >= 0 && taken !== barSlot
      ? `${keyLabel(e.code)} moved here: the slot that had it now has no key`
      : `This slot is now ${keyLabel(e.code)}`);
  };

  private keysChanged() {
    saveBarKeys(this.keys);
    this.stopBinding(); // redraws the bar, and the book's "on the bar: 3" lines with it
    this.bookUi.invalidate();
  }

  /** The slot faces: key, icon, name and tooltip follow whatever each slot now holds. */
  private renderBar() {
    this.slots.forEach((slot, i) => {
      const entry = this.bar[i];
      slot.entry = entry;
      const ability = entry?.k === 'ability' ? entry.i : null;
      const a = ability === null ? null : ABILITIES[ability];
      const item = entry?.k === 'item' ? ITEMS[entry.id] : null;
      const art = entry?.k === 'item' ? itemArt(entry.id) : a ? abilityArt(abilityArtId(a)) : null;
      slot.key.textContent = keyLabel(this.keys[i]);
      slot.key.title = `Click to set the key for this slot (now: ${this.keys[i] ? keyLabel(this.keys[i]) : 'none'})`;
      paintArt(slot.root, art); // an ability and a consumable both wear their thumbnail, and fall back to the glyph without one
      slot.icon.textContent = art ? '' : ability !== null ? ICONS[ability] : item ? ITEM_ICON : '';
      slot.aname.textContent = a?.name ?? item?.name ?? '';
      slot.root.draggable = !!entry;
      slot.root.classList.toggle('empty', !entry);
      if (!item) slot.qty.textContent = ''; // only a consumable counts what is left; update() fills it in
      slot.root.title = a ? `${a.name}: ${a.desc}\nDrag to move it, right-click to clear the slot, click the key to rebind it.`
        : item ? `${item.name}: ${item.desc}\nDrag to move it, right-click to clear the slot, click the key to rebind it.`
        : 'Empty. Drag a spell here from the spell book (P), or a food or potion from your bag (I).';
    });
  }

  /**
   * A slot's cooldown ring and the number inside it. `remaining`/`total` darken the ring; `shown` is the clock
   * the player reads, which is not always the same thing (an ability's ring runs on the GCD, its number does not).
   */
  private setSweep(slot: { sweep: HTMLElement; cdText: HTMLElement }, remaining: number, total: number, shown = remaining) {
    const frac = remaining > 0 && total > 0 ? Math.min(1, remaining / total) : 0;
    slot.sweep.style.background = frac > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${frac * 360}deg, transparent 0)` : 'none';
    slot.cdText.textContent = shown > 0.05 ? (shown >= 10 ? String(Math.ceil(shown)) : shown.toFixed(1)) : '';
  }

  /** A line in the scrolling message log (and optionally the centre-screen message). */
  note(text: string, cls = 'log-info') {
    const line = el(this.log, `logline ${cls}`, text);
    while (this.log.childElementCount > 80) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
    return line;
  }

  /** The log's line for a bounty moving: taken, a kill counted, finished, handed in or dropped (sim/bounties.ts). */
  private noteBounty(ev: Extract<GameEvent, { t: 'bounty' }>) {
    const left = `${ev.kills}/${ev.goal}`;
    if (ev.what === 'accept') this.note(`Bounty taken: ${ev.name} (0/${ev.goal}).`, 'log-quest');
    else if (ev.what === 'progress') this.note(`${ev.name}: ${left}`, 'log-quest');
    else if (ev.what === 'ready') { this.say(`${ev.name}: done`); this.note(`${ev.name}: ${left}. Hand it in at the board.`, 'log-quest'); }
    else if (ev.what === 'turnin') this.note(`Bounty done: ${ev.name}. ${ev.gold} gold and ${ev.xp} XP.`, 'log-loot');
    else this.note(`Bounty dropped: ${ev.name}.`, 'log-info');
  }

  /** The centre-screen message: a refusal or a cue, gone in a second. `speech` is a person talking (a keeper): it is set as speech, not as an error, and held long enough to read. */
  say(text: string, speech = false) {
    this.msg.textContent = text;
    this.msg.classList.toggle('speech', speech);
    this.msgHold = speech ? Math.min(6, 1.5 + text.length / 30) : MSG_HOLD;
    this.msgAge = 0;
  }

  private popBanner(b: HTMLElement, text: string) {
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth; // restart the CSS animation
    b.classList.add('show');
  }

  onEvents(events: GameEvent[], s: GameState) {
    for (const ev of events) {
      if (ev.t === 'hit') {
        const toPlayer = ev.target === 'player';
        const cls = toPlayer ? 'dmg-in' : ev.dot ? 'dmg-dot' : ev.crit ? 'dmg-crit' : 'dmg-out';
        this.float(`${ev.amount}${ev.crit ? '!' : ''}`, cls, ev.x, toPlayer ? 2.6 : 2.4, ev.z, cls === 'dmg-crit');
        if (toPlayer) {
          this.hurtFlash(false);
          if (this.acting) { // the sim drops the action on any hit; say so instead of failing silently
            this.acting = false;
            this.say('Interrupted: you were hit');
            this.note('Interrupted: you were hit', 'log-info');
          }
        }
      } else if (ev.t === 'untarget') {
        this.say(ev.reason === 'dead' ? 'Target defeated' : 'Target evaded');
      } else if (ev.t === 'heal') {
        if (ev.amount > 0) this.float(`+${ev.amount}`, 'heal', ev.x, 2.6, ev.z);
      } else if (ev.t === 'xp') {
        this.xpSkill = ev.skill; // the bar follows whatever is earning right now
        this.float(`+${ev.amount} ${ev.skill === 'combat' ? '' : SKILLS[ev.skill].name + ' '}XP`, 'xpgain', ev.x, 3.2, ev.z);
        this.note(`+${ev.amount} ${SKILLS[ev.skill].name} XP`, 'log-xp');
      } else if (ev.t === 'fail') {
        if (ev.reason === 'gcd') continue; // too noisy while mashing; the sweep already shows it
        this.say(ev.reason === 'locked' ? lockedWhy(ABILITIES[ev.slot], s.player.combat.level) : FAIL_TEXT[ev.reason]);
      } else if (ev.t === 'loot') {
        const name = ITEMS[ev.item].name;
        this.float(`+${ev.qty > 1 ? ev.qty + 'x ' : ''}${name}`, 'loot', s.player.x, 3.0, s.player.z);
        this.note(`Looted ${ev.qty > 1 ? ev.qty + 'x ' : ''}${name}`, 'log-loot');
      } else if (ev.t === 'drop') {
        this.float(ITEMS[ev.item].name, 'dropname', ev.x, 1.6, ev.z);
        this.note(`Dropped: ${ITEMS[ev.item].name}`, 'log-drop');
      } else if (ev.t === 'actionfail') {
        this.say(actionFailText(ev));
      } else if (ev.t === 'shop') {
        this.shopUi.setOpen(true, ev.vendor);
        if (VENDORS.find(v => v.id === ev.vendor)!.stock.length > 0) this.invUi.show('inv'); // selling is done from the bag
      } else if (ev.t === 'flightmaster') {
        this.flightUi.setOpen(true, ev.town);
      } else if (ev.t === 'board') {
        this.boardUi.setOpen(true, ev.town);
      } else if (ev.t === 'bounty') {
        this.noteBounty(ev);
      } else if (ev.t === 'discover') {
        this.popBanner(this.unlockBanner, `FLIGHT PATH:  ${ev.town}`);
        this.unlockBanner.dataset.sub = 'You can now fly here from any flight master';
        this.note(`Flight path discovered: ${ev.town}. You can now fly here from any flight master.`, 'log-quest');
      } else if (ev.t === 'flight') {
        if (ev.phase === 'start') {
          this.float(`-${ev.price} gold`, 'loot', s.player.x, 3.0, s.player.z);
          this.note(`You pay ${ev.price} gold and take flight.`, 'log-loot');
        } else this.note('You land.', 'log-info');
      } else if (ev.t === 'stable') {
        this.float(`-${ev.gold} gold`, 'loot', s.player.x, 3.0, s.player.z);
        this.note(`You buy ${mountById(ev.mount)!.name}. Press Z to mount: not in combat, and any hit or ability throws you off.`, 'log-loot');
      } else if (ev.t === 'mount') {
        this.say(ev.on ? 'Mounted' : 'Dismounted');
      } else if (ev.t === 'learn') {
        this.float(`-${ev.gold} gold`, 'loot', s.player.x, 3.0, s.player.z);
        this.unlock(ev.slot);
      } else if (ev.t === 'trade') {
        const name = `${ITEMS[ev.item].name}`;
        this.float(ev.sold ? `+${ev.gold} gold` : `-${ev.gold} gold`, 'loot', s.player.x, 3.0, s.player.z);
        this.note(ev.sold ? `Sold ${name} for ${ev.gold} gold` : `Bought ${name} for ${ev.gold} gold`, 'log-loot');
      } else if (ev.t === 'chest') {
        // the count is the whole reward for looking: "Greywater Road 1 / 2". The Agility lamp announces itself as the xp event that follows
        this.float(`+${ev.gold} gold`, 'loot', ev.x, 1.2, ev.z);
        const place = placeById(ev.place)!.name, reward = `${ev.gold} gold${ev.xp ? `, ${ev.xp} Agility XP` : ''}`;
        if (ev.opened < ev.total) this.note(`You open a hidden chest: ${reward}. ${place}: ${ev.opened} of ${ev.total} found.`, 'log-loot');
        else { // the set completing is the payoff the count is for: the unlock banner and a quest-coloured line, where the third chest only gets the loot line
          this.note(`You open the last hidden chest in ${place}: ${reward}. All ${ev.total} found.`, 'log-quest');
          this.popBanner(this.unlockBanner, place.toUpperCase());
          this.unlockBanner.dataset.sub = `All ${ev.total} hidden chests found`;
        }
      } else if (ev.t === 'forge' || ev.t === 'range' || ev.t === 'alembic' || ev.t === 'rack') {
        ({ forge: this.forgeUi, range: this.rangeUi, alembic: this.alembicUi, rack: this.rackUi })[ev.t].setOpen(true);
      } else if (ev.t === 'circle') {
        this.enchantUi.setOpen(true);
      } else if (ev.t === 'enchanted') {
        const text = `${enchantById(ev.id)!.name} set on your ${ev.slot === 'weapon' ? 'weapon' : ev.slot}: ${enchantById(ev.id)!.desc}`;
        this.float(enchantById(ev.id)!.name, 'loot', s.player.x, 3.0, s.player.z);
        this.note(text, 'log-loot');
      } else if (ev.t === 'crafted') {
        const text =`${SKILLS[ev.skill].made} ${ev.qty > 1 ? ev.qty + 'x ' : ''}${ITEMS[ev.item].name}`;
        this.float(text, 'loot', s.player.x, 3.0, s.player.z);
        this.note(text, 'log-loot');
      } else if (ev.t === 'use') {
        this.note(`You eat the ${ITEMS[ev.item].name}.`, 'log-info');
      } else if (ev.t === 'eatbreak') {
        this.say('Your meal is spoiled: you were hit');
        this.note('You were hit and spat out your meal.', 'log-bad');
      } else if (ev.t === 'buff') {
        this.note(ev.on ? `${BUFFS[ev.id].name}: ${BUFFS[ev.id].desc}` : `${BUFFS[ev.id].name} has worn off.`, 'log-info');
      } else if (ev.t === 'proc' && ev.on) {
        // a window is something to answer, so it is said in the middle of the screen and names the key that answers it
        const def = PROCS[ev.id], key = this.keyForAbility(ABILITIES.findIndex(a => a.name === def.ability));
        this.say(`${def.name.toUpperCase()}!  ${key ? `${def.ability} (${key}) is free and ready` : def.desc}`);
        this.note(`${def.name}: ${def.desc}`, 'log-xp');
      } else if (ev.t === 'gate') {
        this.say(`${ev.keeper}: "${ev.text}"`, true);
        // the level is only held against a player who is short of it: a keeper who asks a quest, not a level, has need 0, and one who asks both
        // (the Cairn Hold) says "sealed" to a player who has the level, which "(combat 29 needed, you are 31)" would contradict
        const short = ev.need > s.player.combat.level;
        this.note(`${ev.keeper}: "${ev.text}"${short ? ` (combat ${ev.need} needed, you are ${s.player.combat.level})` : ''}`, 'log-quest');
      } else if (ev.t === 'door') {
        this.say(ev.blurb);
        this.note(ev.blurb, 'log-info');
      } else if (ev.t === 'stuck') {
        if (!events.some(x => x.t === 'gate' || x.t === 'door')) this.say("Can't reach that"); // a keeper turning you back has already said why
      } else if (ev.t === 'invfull') {
        this.say('Inventory full');
      } else if (ev.t === 'levelup') {
        this.popBanner(this.banner, `LEVEL UP!  ${SKILLS[ev.skill].name} ${ev.level}`);
        this.note(`Level up! ${SKILLS[ev.skill].name} is now level ${ev.level}`, 'log-lvl');
        if (ev.skill === 'combat') this.noteUnspentPoints(s);
      } else if (ev.t === 'talent') {
        const def = talentById(ev.id)!;
        this.say(`${def.name} rank ${ev.rank}`);
        this.note(`Talent learned: ${def.name} (rank ${ev.rank}) - ${def.desc(ev.rank)}`, 'log-lvl');
      } else if (ev.t === 'talentfail') {
        this.say(ev.reason === 'combat' ? 'You cannot change talents in combat'
          : ev.reason === 'points' ? 'No talent points left: gain a combat level'
          : ev.reason === 'tier' ? 'Spend more points in that tree first'
          : 'Already at full rank');
      } else if (ev.t === 'talentreset') {
        this.note('Every talent point handed back: spend them again (N).', 'log-lvl');
      } else if (ev.t === 'unlock') {
        this.unlock(ev.slot);
      } else if (ev.t === 'telegraph') {
        this.telegraph(ev, s);
      } else if (ev.t === 'interrupt') {
        const e = s.enemies.find(x => x.id === ev.id);
        this.float('INTERRUPTED', 'interrupt', ev.x, 3.4, ev.z);
        this.note(`${e ? defOf(e).name : 'Enemy'} interrupted`, 'log-xp');
        this.warn.classList.remove('show');
      } else if (ev.t === 'net') {
        const e = s.enemies.find(x => x.id === ev.id);
        this.float('CAUGHT', 'interrupt', ev.x, 3.4, ev.z);
        this.note(`${e ? defOf(e).name : 'Enemy'}'s ${ev.name} holds you: ${ev.duration}s before you can move`, 'log-xp');
        this.warn.classList.remove('show');
      } else if (ev.t === 'blocked') {
        const e = s.enemies.find(x => x.id === ev.id);
        this.float('BLOCKED', 'interrupt', ev.x, 3.4, ev.z);
        this.note(`${e ? defOf(e).name : 'Enemy'}'s shot hit the rock: you broke its line`, 'log-xp');
        this.warn.classList.remove('show');
      } else if (ev.t === 'kill') {
        const e = s.enemies.find(x => x.id === ev.id);
        if (e) this.note(`${defOf(e).name} slain`, 'log-kill');
      } else if (ev.t === 'npc') {
        this.questUi.setOpen(true, s, ev.who);
      } else if (ev.t === 'quest') {
        if (ev.what === 'accept') this.note(`Quest accepted: ${ev.name}`, 'log-quest');
        else if (ev.what === 'stage') this.note('Quest updated: see the tracker', 'log-quest');
        else if (ev.what === 'complete') {
          this.popBanner(this.questBanner, 'QUEST COMPLETE');
          this.note(`Quest complete: ${ev.name}`, 'log-quest');
        }
      } else if (ev.t === 'death') {
        const gear = ev.wear.map(w => `${ITEMS[w.item].name} ${w.now > 0 ? `${w.now}%` : 'broken'}`).join(', ');
        this.cost = `${gear ? `Gear worn down: ${gear}.` : 'You wore no gear, so none was worn down.'} The run back is about ${Math.round(ev.run)} paces.`;
        this.note(`You have died. ${this.cost}`, 'log-bad');
        this.hurtFlash(true);
      } else if (ev.t === 'respawn') {
        this.note(`You wake at ${ev.town}'s graveyard. Walk back to where you fell; repair your gear at a merchant.`, 'log-info');
      } else if (ev.t === 'repair') {
        this.note(`Repaired ${ev.pieces} ${ev.pieces === 1 ? 'piece' : 'pieces'} of gear for ${ev.gold} gold.`, 'log-info');
      }
    }
  }

  /**
   * A new ability: banner in the level-up family, a log line, and the slot glows until it has been seen for a while.
   * One level can hand over several abilities: banners queue one after another rather than overwriting each other.
   * A new ability takes the first free slot so it is never handed over with nowhere to press it.
   */
  private unlock(ability: number) {
    const a = ABILITIES[ability], at = this.unlockQueue++ * UNLOCK_BANNER_GAP_MS;
    if (this.slotOfAbility(ability) < 0) {
      const free = this.bar.findIndex((e, i) => e === null && !!this.keys[i]); // a slot with no key is no help: it could not be pressed
      if (free >= 0) this.assign(free, { k: 'ability', i: ability });
    }
    const key = this.keyForAbility(ability), where = key ? `press ${key}` : 'assign it in your spell book (P)';
    const barSlot = this.slotOfAbility(ability);
    setTimeout(() => {
      this.unlockQueue = Math.max(0, this.unlockQueue - 1);
      this.popBanner(this.unlockBanner, `NEW ABILITY:  ${a.name}`);
      this.unlockBanner.dataset.sub = `${key ? `Press ${key}` : 'Assign it in your spell book (P)'}  -  ${a.desc}`;
      if (barSlot < 0) return;
      this.slots[barSlot].root.classList.add('fresh');
      setTimeout(() => this.slots[barSlot].root.classList.remove('fresh'), UNLOCK_GLOW_MS);
    }, at);
    this.note(`New ability unlocked: ${a.name} (${where})`, 'log-lvl');
  }

  /** An enemy begins a wind-up: tell the player exactly what it is and what answers it. */
  private telegraph(ev: Extract<GameEvent, { t: 'telegraph' }>, s: GameState) {
    const e = s.enemies.find(x => x.id === ev.id), p = s.player;
    if (!e || Math.hypot(e.x - p.x, e.z - p.z) > 16) return;
    const def = defOf(e);
    const name = castName(def, ev.kind);
    // only offer the Pummel answer when it is both learned and sitting on the bar: there is no key to name otherwise
    const pk = p.combat.level >= ABILITIES[PUMMEL].unlockLevel ? this.keyForAbility(PUMMEL) : null;
    const answer = ev.kind === 'ground'
      ? (pk ? `Pummel it (${pk}), or keep moving: it lands where you stood.` : 'Keep moving: it lands where you stood.')
      : ev.kind === 'heavy'
      ? (pk ? `Pummel it (${pk}) or step out of the circle!` : 'Step out of the circle!')
      : ev.kind === 'net'
      ? (pk ? `Pummel it (${pk}) or it pins you where you stand!` : 'Break its line, or it pins you where you stand!')
      : (pk ? `Pummel it (${pk}) or break line of fire!` : 'Close in and strike it down!');
    this.warn.textContent = `${name.toUpperCase()}  -  ${answer}`;
    this.warn.style.animationDuration = `${ev.windup + 0.5}s`;
    this.warn.classList.remove('show');
    void this.warn.offsetWidth;
    this.warn.classList.add('show');
  }

  /** A combat level hands over a talent point: say so, or the panel is never found. */
  private noteUnspentPoints(s: GameState) {
    const left = talentPoints(s.player.combat.level) - spentTotal(s.player.talents);
    if (left > 0) this.note(`You have ${left} talent point${left > 1 ? 's' : ''} to spend: press N`, 'log-lvl');
  }

  /** Red screen-edge flash when the player is hit; a longer one on death. */
  private hurtFlash(heavy: boolean) {
    this.hurt.classList.toggle('heavy', heavy);
    this.hurt.classList.remove('show');
    void this.hurt.offsetWidth;
    this.hurt.classList.add('show');
  }

  private float(text: string, cls: string, x: number, y: number, z: number, pop = false) {
    const d = el(this.root, `floater ${cls}`, text);
    this.floaters.push({ el: d, x, y, z, age: 0, drift: (Math.random() - 0.5) * 40, pop });
  }

  update(s: GameState, dtSeconds: number) {
    const p = s.player;
    this.playerLvl.textContent = `Adventurer  Lv ${p.combat.level}`;
    this.goldEl.textContent = `Gold ${p.gold}`;
    // the buff row carries whatever is running; the line above it is left for the one thing that is a wait, not an effect
    this.statusEl.textContent = !p.food && p.foodCd > 0 ? `Food ready in ${Math.ceil(p.foodCd)}s` : '';
    this.playerStatus.update(playerStatuses(p));
    this.setBar(this.hp, p.hp / p.maxHp, `${Math.ceil(p.hp)} / ${p.maxHp}`);
    this.setBar(this.energy, p.energy / p.maxEnergy, `${Math.floor(p.energy)}`);
    // stamina: what is left to sprint on. Lit while running flat out, and greyed while you get your breath back
    const stam = maxStamina(p);
    this.setBar(this.stamina, p.stamina / stam, `${Math.floor(p.stamina)}`);
    const staminaBar = this.stamina.fill.parentElement!;
    staminaBar.classList.toggle('running', p.sprinting);
    staminaBar.classList.toggle('winded', p.winded);
    const track = p.skills[this.xpSkill], skill = SKILLS[this.xpSkill], prog = levelProgress(track);
    this.xp.fill.parentElement!.classList.toggle('skill', this.xpSkill !== 'combat');
    this.setBar(this.xp, prog.frac, `${skill.icon} ${skill.name} ${track.level}  -  ${prog.needed ? `${prog.into} / ${prog.needed} XP` : 'MAX'}`);

    const t = s.targetId === null ? undefined : s.enemies.find(e => e.id === s.targetId);
    this.targetFrame.style.display = t ? 'block' : 'none';
    if (t) {
      const def = defOf(t);
      setFaceArt(this.targetFace, enemyArt(t.type)); // by type: every Wild Boar wears the one boar's face
      this.targetName.textContent = `${def.name}  Lv ${def.level}`;
      this.targetName.className = `name ${def.level > p.combat.level + 2 ? 'hard' : ''}`;
      this.setBar(this.targetHp, t.hp / t.maxHp, `${Math.ceil(t.hp)} / ${t.maxHp}`);
      this.targetCast.fill.parentElement!.style.display = t.cast ? 'block' : 'none';
      if (t.cast) {
        this.setBar(this.targetCast, t.cast.t / t.cast.total, castName(def, t.cast.kind));
      }
    }
    this.targetStatus.update(t ? enemyStatuses(t) : []); // dropped with the target, so the next one never shows its predecessor's

    // swing timer: fills toward the next auto-attack; lit while armed, and full (waiting) when the target is out of reach
    const interval = swingInterval(p);
    const swung = interval > 0 ? 1 - p.swing / interval : 1;
    this.swingBar.fill.parentElement!.classList.toggle('on', p.autoAttack);
    this.swingBar.fill.parentElement!.classList.toggle('ready', p.autoAttack && p.swing <= 0);
    this.setBar(this.swingBar, swung, p.autoAttack ? (p.swing <= 0 ? 'AUTO-ATTACK  (waiting)' : 'AUTO-ATTACK') : 'Auto-attack off  [X]');

    // action bar: cooldown sweeps (GCD shows on every slot), energy and range tint
    for (const slot of this.slots) {
      const entry = slot.entry;
      if (entry === null) { // an empty slot shows nothing but its key
        this.setSweep(slot, 0, 0);
        slot.lock.style.display = 'none';
        slot.root.classList.remove('locked', 'noenergy', 'outrange', 'queued', 'gone', 'proc');
        continue;
      }
      if (entry.k === 'item') { // a consumable: how many are left in the bag, and the shared food clock
        const left = countItem(p.inventory, entry.id);
        const cd = ITEMS[entry.id].use!.food ? p.foodCd : 0;
        slot.qty.textContent = left ? String(left) : '0';
        this.setSweep(slot, cd, FOOD_COOLDOWN);
        slot.lock.style.display = 'none';
        slot.root.classList.remove('locked', 'noenergy', 'outrange', 'queued', 'proc');
        slot.root.classList.toggle('gone', left === 0);
        continue;
      }
      const i = entry.i;
      const a = ABILITIES[i];
      const proc = procOn(p, i);
      const cd = proc ? 0 : p.cd[i]; // a proc answers the cooldown, so the slot reads ready rather than dark
      const gcd = a.offGcd ? 0 : p.gcd; // an off-GCD button does not dim while the GCD runs: it is the one you can press
      const remaining = Math.max(cd, gcd);
      const total = cd > gcd ? cooldownOf(p, i) : GCD;
      this.setSweep(slot, remaining, total, cd); // the ring runs on the GCD too, but only the cooldown itself prints a number
      const locked = !abilityOpen(p, i);
      // level reached but locked: it is for sale, or it waits on the talent point that hands it over
      slot.lockText.textContent = p.combat.level < a.unlockLevel ? `Lv ${a.unlockLevel}` : a.talent ? 'Talent' : 'Trainer';
      slot.root.classList.toggle('locked', locked);
      slot.lock.style.display = locked ? 'flex' : 'none';
      const noEnergy = !locked && p.energy < costOf(p, i);
      const outOfRange = !locked && !!t && a.range > 0 && Math.hypot(t.x - p.x, t.z - p.z) > a.range;
      slot.root.classList.toggle('noenergy', noEnergy);
      slot.root.classList.toggle('outrange', outOfRange);
      slot.root.classList.toggle('queued', p.queued === i || p.queuedOff === i);
      slot.root.classList.toggle('proc', !!proc);
    }
    if (this.binding >= 0) this.slots[this.binding].key.textContent = '?'; // the waiting slot keeps asking, whatever else redrew

    // nameplates
    const blockers = this.visibleBlockers();
    const seen = new Set<number>();
    const cand: { e: Enemy; scr: { x: number; y: number }; d: number }[] = [];
    for (const e of s.enemies) {
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      const scr = e.state !== 'dead' && d < 28 && clearLine(p, e) ? this.project(e.x, defOf(e).radius * 2 + (e.type === 'brute' ? 1.6 : 0.9), e.z) : null;
      if (scr && !this.behindHud(blockers, scr)) cand.push({ e, scr, d });
    }
    // the target first, then nearest: a plate that would print over one already placed (a pack) is lifted above it, never overprinted
    cand.sort((a, b) => Number(b.e.id === s.targetId) - Number(a.e.id === s.targetId) || a.d - b.d);
    const placed: { x: number; y: number }[] = [];
    for (const { e, scr } of cand) {
      let y = scr.y;
      while (placed.some(o => Math.abs(o.x - scr.x) < PLATE_W && Math.abs(o.y - y) < PLATE_STACK_H)) y -= PLATE_STACK_H;
      placed.push({ x: scr.x, y });
      seen.add(e.id);
      let plate = this.plates.get(e.id);
      if (!plate) {
        const root = el(this.root, 'plate');
        const def = defOf(e);
        el(root, 'pname', `${def.name} ${def.level}`);
        const cast = el(root, 'bar thin pcast');
        plate = { root, fill: el(el(root, 'bar thin pbar'), 'fill'), cast, castFill: el(cast, 'fill') };
        this.plates.set(e.id, plate);
      }
      plate.root.style.display = 'block';
      plate.root.style.transform = `translate(${scr.x}px, ${y}px) translate(-50%, -100%)`;
      plate.fill.style.width = `${(e.hp / e.maxHp) * 100}%`;
      plate.cast.style.display = e.cast ? 'block' : 'none';
      if (e.cast) plate.castFill.style.width = `${(e.cast.t / e.cast.total) * 100}%`;
      plate.root.classList.toggle('sel', e.id === s.targetId);
    }
    for (const [id, plate] of this.plates) if (!seen.has(id)) plate.root.style.display = 'none';

    // floating numbers (kept off the HUD panels the same way plates are)
    this.floaters = this.floaters.filter(f => {
      f.age += dtSeconds;
      const scr = f.age < 1.1 ? this.project(f.x, f.y, f.z) : null;
      if (!scr) { f.el.remove(); return false; }
      const rise = f.age * 55, k = Math.min(1, f.age * 6), pop = f.pop ? 0.45 * Math.max(0, 1 - f.age * 5) : 0; // a crit lands oversize, then settles
      const fx = scr.x + f.drift * f.age, fy = this.clearOfHud(blockers, fx, scr.y - rise);
      f.el.style.transform = `translate(${fx}px, ${fy}px) translate(-50%, -50%) scale(${0.6 + 0.4 * k + pop})`;
      f.el.style.opacity = String(Math.min(1, (1.1 - f.age) * 3));
      return true;
    });

    this.minimap.update(s);
    this.invUi.update(s);
    this.skillsUi.update(s);
    this.talentsUi.update(s);
    this.bookUi.update(s);
    this.questUi.update(s, this.yaw());
    this.forgeUi.update(s);
    this.rangeUi.update(s);
    this.alembicUi.update(s);
    this.rackUi.update(s);
    this.enchantUi.update(s);
    this.shopUi.update(s);
    this.flightUi.update(s);
    this.boardUi.update(s);
    this.dock.settle(this.dockWindows);
    this.mapUi.update(s);
    this.adminUi?.update(s);
    this.updateCastBar(s);
    this.updateNodePlates(s, blockers);

    this.msgAge += dtSeconds;
    this.msg.style.opacity = String(Math.max(0, Math.min(1, 1 - (this.msgAge - this.msgHold) * 1.5)));

    this.deathOverlay.style.display = p.dead ? 'flex' : 'none';
    if (p.dead) this.deathOverlay.textContent = `You died.  Waking at ${nearestTown(p.x, p.z, s.found).name}'s graveyard in ${Math.ceil(p.respawnIn)}...  ${this.cost}`;
  }

  /** Progress bar for the current gather/craft. */
  private updateCastBar(s: GameState) {
    const a = s.player.action?.k === 'flight' ? null : s.player.action; // the ride has its own caption (MapUi)
    this.acting = !!a;
    this.castBar.fill.parentElement!.style.display = a ? 'block' : 'none';
    this.castBar.fill.parentElement!.classList.toggle('ride', a?.k === 'mount');
    if (!a) return;
    let label: string;
    if (a.k === 'mount') {
      label = 'Mounting';
    } else if (a.k === 'gather') {
      const d = NODE_TYPES[s.nodes.find(n => n.id === a.nodeId)!.type];
      label = `${SKILLS[d.skill].name}: ${d.name}`;
    } else {
      const r = recipeById(a.recipe)!;
      label = `${SKILLS[r.skill].name}: ${r.name}${a.left > 1 ? `  (${a.left} left)` : ''}`;
    }
    this.setBar(this.castBar, a.t / a.duration, label);
  }

  /** Floating labels over nearby nodes: name and the level it needs (red when you are too low). */
  private updateNodePlates(s: GameState, blockers: DOMRect[]) {
    const p = s.player;
    // nearest plate wins: a farther plate is hidden when it would print over one already placed (ore fields cluster)
    const cand: { n: ResourceNode; scr: { x: number; y: number }; d: number }[] = [];
    for (const n of s.nodes) {
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      const scr = d < 16 && clearLine(p, n) ? this.project(n.x, n.type === 'tree' ? 5 : 2.4, n.z) : null;
      if (scr && !this.behindHud(blockers, scr)) cand.push({ n, scr, d });
    }
    cand.sort((a, b) => a.d - b.d);
    const shown = new Map<number, { x: number; y: number }>(), placed: { x: number; y: number }[] = [];
    for (const c of cand) {
      if (placed.some(o => Math.abs(o.x - c.scr.x) < NODE_PLATE_W && Math.abs(o.y - c.scr.y) < NODE_PLATE_H)) continue;
      placed.push(c.scr);
      shown.set(c.n.id, c.scr);
    }
    for (const n of s.nodes) {
      const def = NODE_TYPES[n.type], scr = shown.get(n.id);
      let plate = this.nodePlates.get(n.id);
      if (!scr) { if (plate) plate.root.style.display = 'none'; continue; }
      if (!plate) {
        const root = el(this.root, 'plate nodeplate');
        el(root, 'pname', def.name);
        plate = { root, sub: el(root, 'psub') };
        this.nodePlates.set(n.id, plate);
      }
      const low = p.skills[def.skill].level < def.level;
      plate.sub.textContent = n.charges <= 0 ? 'depleted' : `${SKILLS[def.skill].name} ${def.level}`;
      plate.sub.className = `psub${n.charges > 0 && low ? ' bad' : ''}`;
      plate.root.style.display = 'block';
      plate.root.style.opacity = n.charges <= 0 ? '0.5' : '1';
      plate.root.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -100%)`;
    }
  }

  /** Pushes a floater centre out of any HUD panel it sits in, to whichever edge is nearer, so combat text never prints over the action bar. */
  private clearOfHud(blockers: DOMRect[], x: number, y: number): number {
    for (const r of blockers) {
      if (x < r.left - FLOATER_HALF_W || x > r.right + FLOATER_HALF_W || y < r.top - FLOATER_HALF_H || y > r.bottom + FLOATER_HALF_H) continue;
      y = y < (r.top + r.bottom) / 2 ? r.top - FLOATER_HALF_H : r.bottom + FLOATER_HALF_H;
    }
    return y;
  }

  private visibleBlockers(): DOMRect[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>(PLATE_BLOCKERS)).filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect());
  }

  /** True when a plate anchored (bottom-centre) at `at` would overlap a HUD panel. */
  private behindHud(blockers: DOMRect[], at: { x: number; y: number }): boolean {
    return blockers.some(r => at.x + PLATE_HALF_W > r.left && at.x - PLATE_HALF_W < r.right && at.y > r.top && at.y - PLATE_H < r.bottom);
  }

  private setBar(b: { fill: HTMLElement; label: HTMLElement }, frac: number, text: string) {
    b.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    b.label.textContent = text;
  }
}

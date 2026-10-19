// HUD: DOM overlay. Reads GameState and sim events; never mutates sim state.
import { GameState, GameEvent, ResourceNode, Enemy } from './sim';
import { ABILITIES, ENEMY_TYPES, GCD, castName } from './sim/data';
import { levelProgress } from './sim/xp';
import { ITEMS } from './sim/items';
import { InvAction } from './sim/inventory';
import { SKILLS } from './sim/skills';
import { TALENTS, spentTotal, talentPoints, talentById } from './sim/talents';
import { NODE_TYPES } from './sim/gathering';
import { recipeById } from './sim/crafting';
import { nearestTown } from './sim/world';
import { BUFFS } from './sim/consumables';
import { clearLine } from './sim/sight';
import { cooldownOf, costOf, swingInterval } from './sim/combat';
import { InventoryUi } from './inventory-ui';
import { SkillsUi } from './skills-ui';
import { TalentsUi } from './talents-ui';
import { ForgeUi } from './forge-ui';
import { ShopUi } from './shop-ui';
import { FlightUi, MapUi, MapView } from './flight-ui';
import { QuestUi } from './quest-ui';
import { MenuUi } from './menu-ui';

const PUMMEL = ABILITIES.findIndex(a => a.kind === 'interrupt');

export interface HudActions {
  inv: (a: InvAction) => void;
  talent: (id: string) => void;
  talentReset: () => void;
  craft: (recipe: string, count: number) => void;
  sell: (slot: number, qty: number) => void;
  buy: (item: string, qty: number) => void;
  fly: (to: string) => void;
  skipFlight: () => void;
  map: MapView;
  questAdvance: () => void;
  save: () => void;
  newGame: () => void;
  quality: (toggle: boolean) => import('./post').Quality;
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
  }
}

type Project = (x: number, y: number, z: number) => { x: number; y: number } | null;

const ICONS = ['⚔', '🔨', '🗡', '❤', '🌀', '✊'];
const FAIL_TEXT = {
  range: 'Out of range', cooldown: 'Not ready yet', gcd: 'Not ready yet',
  energy: 'Not enough energy', target: 'No target', nocast: 'Nothing to interrupt',
} as const;
/** How long a freshly unlocked slot keeps glowing, and the gap between banners when one level hands over several abilities. */
const UNLOCK_GLOW_MS = 4000, UNLOCK_BANNER_GAP_MS = 1900;

function el(parent: HTMLElement, cls: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  parent.appendChild(d);
  return d;
}

function bar(parent: HTMLElement, cls: string) {
  const outer = el(parent, `bar ${cls}`);
  const fill = el(outer, 'fill');
  const label = el(outer, 'label');
  return { fill, label };
}

/** Opaque HUD panels that world-space plates must not draw over. */
const PLATE_BLOCKERS = '.frame, .tracker, .panel, .actionbar, .msglog, .menubar, .xp';
const PLATE_HALF_W = 45, PLATE_H = 28; // generous footprint of a nameplate around its anchor
const NODE_PLATE_W = 96, NODE_PLATE_H = 36; // two plates closer than this on screen overlap
const PLATE_W = 96, PLATE_STACK_H = 40; // enemy plate footprint; a clustered plate is lifted one step per plate beneath it
const FLOATER_HALF_W = 24, FLOATER_HALF_H = 14; // footprint of a floating number around its centre

interface Floater { el: HTMLElement; x: number; y: number; z: number; age: number; drift: number }

export class Hud {
  private root = el(document.body, 'hud');
  private playerLvl: HTMLElement;
  private hp: ReturnType<typeof bar>;
  private energy: ReturnType<typeof bar>;
  private xp: ReturnType<typeof bar>;
  private targetFrame: HTMLElement;
  private targetName: HTMLElement;
  private targetHp: ReturnType<typeof bar>;
  private targetCast: ReturnType<typeof bar>;
  private slots: { root: HTMLElement; sweep: HTMLElement; cdText: HTMLElement; lock: HTMLElement }[] = [];
  private swingBar: ReturnType<typeof bar>;
  private msg: HTMLElement;
  private banner: HTMLElement;
  private deathOverlay: HTMLElement;
  private plates = new Map<number, { root: HTMLElement; fill: HTMLElement; cast: HTMLElement; castFill: HTMLElement }>();
  private floaters: Floater[] = [];
  private msgAge = 99;
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
  private shopUi: ShopUi;
  private flightUi: FlightUi;
  private mapUi: MapUi;
  private goldEl: HTMLElement;
  private statusEl: HTMLElement;
  private castBar: ReturnType<typeof bar>;
  /** A gather/craft is running (or was just requested): a hit while true is what broke it. */
  private acting = false;
  /** What the last death cost, for the overlay while the player waits. */
  private toll = 0;
  private nodePlates = new Map<number, { root: HTMLElement; sub: HTMLElement }>();

  constructor(private project: Project, private yaw: () => number, actions: HudActions) {
    const pf = el(this.root, 'frame player');
    this.playerLvl = el(pf, 'name');
    this.goldEl = el(pf, 'gold');
    this.statusEl = el(pf, 'status');
    this.hp = bar(pf, 'hp');
    this.energy = bar(pf, 'energy');

    this.targetFrame = el(this.root, 'frame target');
    this.targetName = el(this.targetFrame, 'name');
    this.targetHp = bar(this.targetFrame, 'enemyhp');
    this.targetCast = bar(this.targetFrame, 'enemycast');

    this.xp = bar(this.root, 'xp');

    const ab = el(this.root, 'actionbar');
    ABILITIES.forEach((a, i) => {
      const root = el(ab, 'slot');
      root.title = `${a.name}: ${a.desc}`;
      el(root, 'icon', ICONS[i]);
      el(root, 'key', String(i + 1));
      el(root, 'aname', a.name);
      const sweep = el(root, 'sweep');
      const cdText = el(root, 'cdtext');
      const lock = el(root, 'lock');
      el(lock, 'lockicon', '🔒');
      el(lock, 'locklvl', `Lv ${a.unlockLevel}`);
      this.slots.push({ root, sweep, cdText, lock });
    });

    this.swingBar = bar(this.root, 'swing');
    this.msg = el(this.root, 'msg');
    this.banner = el(this.root, 'banner');
    this.deathOverlay = el(this.root, 'death');
    this.questBanner = el(this.root, 'banner questbanner');
    this.unlockBanner = el(this.root, 'banner unlockbanner');
    this.warn = el(this.root, 'warn');
    this.hurt = el(this.root, 'hurt');
    this.log = el(this.root, 'msglog');
    this.invUi = new InventoryUi(this.root, actions.inv, actions.sell);
    this.skillsUi = new SkillsUi(this.root);
    this.talentsUi = new TalentsUi(this.root, { learn: actions.talent, reset: actions.talentReset });
    this.shopUi = new ShopUi(this.root, actions.buy);
    this.flightUi = new FlightUi(this.root, actions.fly);
    this.mapUi = new MapUi(this.root, actions.map, actions.skipFlight);
    const craft = (r: string, n: number) => { this.acting = true; actions.craft(r, n); };
    this.forgeUi = new ForgeUi(this.root, 'forge', 'Forge', craft);
    this.rangeUi = new ForgeUi(this.root, 'range', 'Cooking Range', craft);
    this.castBar = bar(this.root, 'castbar');
    this.questUi = new QuestUi(this.root, actions.questAdvance);
    this.menuUi = new MenuUi(this.root, actions);
  }

  toggle(which: 'inv' | 'char' | 'skills' | 'talents') {
    if (which === 'skills') this.skillsUi.toggle();
    else if (which === 'talents') this.talentsUi.toggle();
    else this.invUi.toggle(which);
  }

  toggleHelp() { this.menuUi.toggle(); }
  toggleMap() { this.mapUi.toggle(); }

  /** A dialogue, the help screen or the map has focus: game keys (jump) must not act under it. */
  get modalOpen(): boolean { return this.menuUi.isOpen || this.questUi.isOpen || this.mapUi.isOpen; }

  /** Esc: closes the topmost overlay (map, help, dialogue). Returns true if it closed something. */
  closeOverlay(): boolean {
    if (this.mapUi.isOpen) { this.mapUi.setOpen(false); return true; }
    if (this.menuUi.isOpen) { this.menuUi.setOpen(false); return true; }
    if (this.questUi.isOpen) { this.questUi.setOpen(false); return true; }
    return false;
  }

  /** A line in the scrolling message log (and optionally the centre-screen message). */
  note(text: string, cls = 'log-info') {
    const line = el(this.log, `logline ${cls}`, text);
    while (this.log.childElementCount > 80) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
    return line;
  }

  say(text: string) {
    this.msg.textContent = text;
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
        this.float(`${ev.amount}${ev.crit ? '!' : ''}`, cls, ev.x, toPlayer ? 2.6 : 2.4, ev.z);
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
        this.float(`+${ev.amount} ${ev.skill === 'combat' ? '' : SKILLS[ev.skill].name + ' '}XP`, 'xpgain', ev.x, 3.2, ev.z);
        this.note(`+${ev.amount} ${SKILLS[ev.skill].name} XP`, 'log-xp');
      } else if (ev.t === 'fail') {
        if (ev.reason === 'gcd') continue; // too noisy while mashing; the sweep already shows it
        this.say(ev.reason === 'locked'
          ? `${ABILITIES[ev.slot].name} unlocks at combat level ${ABILITIES[ev.slot].unlockLevel} (you are level ${s.player.combat.level})`
          : FAIL_TEXT[ev.reason]);
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
        this.invUi.show('inv'); // selling is done from the bag
      } else if (ev.t === 'flightmaster') {
        this.flightUi.setOpen(true, ev.town);
      } else if (ev.t === 'discover') {
        this.popBanner(this.unlockBanner, `FLIGHT PATH:  ${ev.town}`);
        this.unlockBanner.dataset.sub = 'You can now fly here from any flight master';
        this.note(`Flight path discovered: ${ev.town}. You can now fly here from any flight master.`, 'log-quest');
      } else if (ev.t === 'flight') {
        if (ev.phase === 'start') {
          this.float(`-${ev.price} gold`, 'loot', s.player.x, 3.0, s.player.z);
          this.note(`You pay ${ev.price} gold and take flight.`, 'log-loot');
        } else this.note(ev.skipped ? 'You cut the flight short and land.' : 'You land.', 'log-info');
      } else if (ev.t === 'trade') {
        const name = `${ITEMS[ev.item].name}`;
        this.float(ev.sold ? `+${ev.gold} gold` : `-${ev.gold} gold`, 'loot', s.player.x, 3.0, s.player.z);
        this.note(ev.sold ? `Sold ${name} for ${ev.gold} gold` : `Bought ${name} for ${ev.gold} gold`, 'log-loot');
      } else if (ev.t === 'forge' || ev.t === 'range') {
        (ev.t === 'forge' ? this.forgeUi : this.rangeUi).setOpen(true);
      } else if (ev.t === 'crafted') {
        const text = `${SKILLS[ev.skill].made} ${ev.qty > 1 ? ev.qty + 'x ' : ''}${ITEMS[ev.item].name}`;
        this.float(text, 'loot', s.player.x, 3.0, s.player.z);
        this.note(text, 'log-loot');
      } else if (ev.t === 'use') {
        this.note(`You eat the ${ITEMS[ev.item].name}.`, 'log-info');
      } else if (ev.t === 'eatbreak') {
        this.say('Your meal is spoiled: you were hit');
        this.note('You were hit and spat out your meal.', 'log-bad');
      } else if (ev.t === 'buff') {
        this.note(ev.on ? `${BUFFS[ev.id].name}: +${Math.round((BUFFS[ev.id].maxHp ?? 0) * 100)}% max health.` : `${BUFFS[ev.id].name} has worn off.`, 'log-info');
      } else if (ev.t === 'stuck') {
        this.say("Can't reach that");
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
        this.note(`${e ? ENEMY_TYPES[e.type].name : 'Enemy'} interrupted`, 'log-xp');
        this.warn.classList.remove('show');
      } else if (ev.t === 'blocked') {
        const e = s.enemies.find(x => x.id === ev.id);
        this.float('BLOCKED', 'interrupt', ev.x, 3.4, ev.z);
        this.note(`${e ? ENEMY_TYPES[e.type].name : 'Enemy'}'s shot hit the rock: you broke its line`, 'log-xp');
        this.warn.classList.remove('show');
      } else if (ev.t === 'kill') {
        const e = s.enemies.find(x => x.id === ev.id);
        if (e) this.note(`${ENEMY_TYPES[e.type].name} slain`, 'log-kill');
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
        this.note(ev.toll > 0 ? `You have died. The repair toll is ${ev.toll} gold.` : 'You have died.', 'log-bad');
        this.hurtFlash(true);
        this.toll = ev.toll;
      } else if (ev.t === 'respawn') {
        this.note(`You wake in ${ev.town}.`, 'log-info');
      }
    }
  }

  /**
   * A new ability: banner in the level-up family, a log line, and the slot glows until it has been seen for a while.
   * One level can hand over several abilities: banners queue one after another rather than overwriting each other.
   */
  private unlock(slot: number) {
    const a = ABILITIES[slot], at = this.unlockQueue++ * UNLOCK_BANNER_GAP_MS;
    setTimeout(() => {
      this.unlockQueue = Math.max(0, this.unlockQueue - 1);
      this.popBanner(this.unlockBanner, `NEW ABILITY:  ${a.name}`);
      this.unlockBanner.dataset.sub = `Press ${slot + 1}  -  ${a.desc}`;
      this.slots[slot].root.classList.add('fresh');
      setTimeout(() => this.slots[slot].root.classList.remove('fresh'), UNLOCK_GLOW_MS);
    }, at);
    this.note(`New ability unlocked: ${a.name} (press ${slot + 1})`, 'log-lvl');
  }

  /** An enemy begins a wind-up: tell the player exactly what it is and what answers it. */
  private telegraph(ev: Extract<GameEvent, { t: 'telegraph' }>, s: GameState) {
    const e = s.enemies.find(x => x.id === ev.id), p = s.player;
    if (!e || Math.hypot(e.x - p.x, e.z - p.z) > 16) return;
    const def = ENEMY_TYPES[e.type];
    const name = castName(def, ev.kind);
    const canPummel = p.combat.level >= ABILITIES[PUMMEL].unlockLevel;
    const answer = ev.kind === 'ground'
      ? (canPummel ? `Pummel it (${PUMMEL + 1}), or keep moving: it lands where you stood.` : 'Keep moving: it lands where you stood.')
      : ev.kind === 'heavy'
      ? (canPummel ? `Pummel it (${PUMMEL + 1}) or step out of the circle!` : 'Step out of the circle!')
      : (canPummel ? `Pummel it (${PUMMEL + 1}) or break line of fire!` : 'Close in and strike it down!');
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

  private float(text: string, cls: string, x: number, y: number, z: number) {
    const d = el(this.root, `floater ${cls}`, text);
    this.floaters.push({ el: d, x, y, z, age: 0, drift: (Math.random() - 0.5) * 40 });
  }

  update(s: GameState, dtSeconds: number) {
    const p = s.player;
    this.playerLvl.textContent = `Adventurer  Lv ${p.combat.level}`;
    this.goldEl.textContent = `Gold ${p.gold}`;
    const clock = (t: number) => `${Math.floor(Math.ceil(t) / 60)}:${String(Math.ceil(t) % 60).padStart(2, '0')}`;
    this.statusEl.textContent = [
      p.food ? `Eating ${Math.ceil(p.food.left)}s` : p.foodCd > 0 ? `Food ready in ${Math.ceil(p.foodCd)}s` : '',
      ...p.buffs.map(b => `${BUFFS[b.id].name} ${clock(b.left)}`),
    ].filter(Boolean).join('  ·  ');
    this.setBar(this.hp, p.hp / p.maxHp, `${Math.ceil(p.hp)} / ${p.maxHp}`);
    this.setBar(this.energy, p.energy / p.maxEnergy, `${Math.floor(p.energy)}`);
    const prog = levelProgress(p.combat);
    this.setBar(this.xp, prog.frac, `Combat ${p.combat.level}  -  ${prog.into} / ${prog.needed} XP`);

    const t = s.targetId === null ? undefined : s.enemies.find(e => e.id === s.targetId);
    this.targetFrame.style.display = t ? 'block' : 'none';
    if (t) {
      const def = ENEMY_TYPES[t.type];
      this.targetName.textContent = `${def.name}  Lv ${def.level}`;
      this.targetName.className = `name ${def.level > p.combat.level + 2 ? 'hard' : ''}`;
      this.setBar(this.targetHp, t.hp / t.maxHp, `${Math.ceil(t.hp)} / ${t.maxHp}`);
      this.targetCast.fill.parentElement!.style.display = t.cast ? 'block' : 'none';
      if (t.cast) {
        this.setBar(this.targetCast, t.cast.t / t.cast.total, castName(def, t.cast.kind));
      }
    }

    // swing timer: fills toward the next auto-attack; lit while armed, and full (waiting) when the target is out of reach
    const interval = swingInterval(p);
    const swung = interval > 0 ? 1 - p.swing / interval : 1;
    this.swingBar.fill.parentElement!.classList.toggle('on', p.autoAttack);
    this.swingBar.fill.parentElement!.classList.toggle('ready', p.autoAttack && p.swing <= 0);
    this.setBar(this.swingBar, swung, p.autoAttack ? (p.swing <= 0 ? 'AUTO-ATTACK  (waiting)' : 'AUTO-ATTACK') : 'Auto-attack off  [R]');

    // action bar: cooldown sweeps (GCD shows on every slot), energy and range tint
    ABILITIES.forEach((a, i) => {
      const slot = this.slots[i];
      const cd = p.cd[i];
      const remaining = Math.max(cd, p.gcd);
      const total = cd > p.gcd ? cooldownOf(p, i) : GCD;
      const frac = remaining > 0 ? remaining / total : 0;
      slot.sweep.style.background = frac > 0
        ? `conic-gradient(rgba(0,0,0,0.65) ${frac * 360}deg, transparent 0)` : 'none';
      slot.cdText.textContent = cd > 0.05 ? (cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1)) : '';
      const locked = p.combat.level < a.unlockLevel;
      slot.root.classList.toggle('locked', locked);
      slot.lock.style.display = locked ? 'flex' : 'none';
      const noEnergy = !locked && p.energy < costOf(p, i);
      const outOfRange = !locked && !!t && a.range > 0 && Math.hypot(t.x - p.x, t.z - p.z) > a.range;
      slot.root.classList.toggle('noenergy', noEnergy);
      slot.root.classList.toggle('outrange', outOfRange);
      slot.root.classList.toggle('queued', p.queued === i);
    });

    // nameplates
    const blockers = this.visibleBlockers();
    const seen = new Set<number>();
    const cand: { e: Enemy; scr: { x: number; y: number }; d: number }[] = [];
    for (const e of s.enemies) {
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      const scr = e.state !== 'dead' && d < 28 && clearLine(p, e) ? this.project(e.x, ENEMY_TYPES[e.type].radius * 2 + (e.type === 'brute' ? 1.6 : 0.9), e.z) : null;
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
        const def = ENEMY_TYPES[e.type];
        el(root, 'pname', `${def.name} ${def.level}`);
        const cast = el(root, 'pcast');
        plate = { root, fill: el(el(root, 'pbar'), 'fill'), cast, castFill: el(cast, 'fill') };
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
      const rise = f.age * 55, k = Math.min(1, f.age * 6);
      const fx = scr.x + f.drift * f.age, fy = this.clearOfHud(blockers, fx, scr.y - rise);
      f.el.style.transform = `translate(${fx}px, ${fy}px) translate(-50%, -50%) scale(${0.6 + 0.4 * k})`;
      f.el.style.opacity = String(Math.min(1, (1.1 - f.age) * 3));
      return true;
    });

    this.invUi.update(s);
    this.skillsUi.update(s);
    this.talentsUi.update(s);
    this.questUi.update(s, this.yaw());
    this.forgeUi.update(s);
    this.rangeUi.update(s);
    this.shopUi.update(s);
    this.flightUi.update(s);
    this.mapUi.update(s);
    this.updateCastBar(s);
    this.updateNodePlates(s, blockers);

    this.msgAge += dtSeconds;
    this.msg.style.opacity = String(Math.max(0, Math.min(1, 1.6 - this.msgAge * 1.5)));

    this.deathOverlay.style.display = p.dead ? 'flex' : 'none';
    if (p.dead) this.deathOverlay.textContent = `You died.  Waking in ${nearestTown(p.x, p.z, s.found).name} in ${Math.ceil(p.respawnIn)}...${this.toll > 0 ? `  (repair toll: ${this.toll} gold)` : ''}`;
  }

  /** Progress bar for the current gather/craft. */
  private updateCastBar(s: GameState) {
    const a = s.player.action?.k === 'flight' ? null : s.player.action; // the ride has its own caption (MapUi)
    this.acting = !!a;
    this.castBar.fill.parentElement!.style.display = a ? 'block' : 'none';
    if (!a) return;
    let label: string;
    if (a.k === 'gather') {
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

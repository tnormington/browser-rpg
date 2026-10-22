// The admin / QA panel (HOM-114): set any skill's level, jump anywhere on the map, put any item in the bag and gold in
// the purse (HOM-138: a trainer's ability has a price, and that price was the one thing the panel could not hand over).
// Dev tooling, not a game feature: the HUD only builds it when main.ts passes an `admin` callback, which it does on the
// dev server or with ?debug=1. Reads GameState; every change it makes leaves as an AdminAction, like any other panel.
import type { GameState } from './sim';
import { AdminAction, MAX_GRANT, destinations } from './sim/admin';
import { MAX_LEVEL } from './sim/xp';
import { SKILLS, SKILL_IDS, SkillId } from './sim/skills';
import { MAX_GOLD } from './sim/shop';
import { ITEMS } from './sim/items';
import { regionAt } from './sim/world';
import { el, titleRow } from './dom';

const DESTINATIONS = destinations();

const input = (parent: HTMLElement, type: string, value: string): HTMLInputElement => {
  const i = document.createElement('input');
  i.type = type;
  i.value = value;
  parent.appendChild(i);
  return i;
};
const numberBox = (parent: HTMLElement, value: number, max: number) => {
  const i = input(parent, 'number', String(value));
  i.min = '1';
  i.max = String(max);
  return i;
};
const button = (parent: HTMLElement, label: string, run: () => void, cls = 'btn pri sm') =>
  el(parent, cls, label).addEventListener('click', run);

export class AdminUi {
  private panel: HTMLElement;
  private now: HTMLElement;
  private skill: HTMLSelectElement;
  private level: HTMLInputElement;
  private where: HTMLSelectElement;
  private search: HTMLInputElement;
  private qty: HTMLInputElement;
  private list: HTMLElement;
  private open = false;
  /** The search the item list was last built for, so typing rebuilds it and nothing else does. */
  private shown: string | null = null;
  /** Set when the panel opens, and when another skill is picked: the level box takes the level that skill actually has, once. */
  private fresh = false;

  constructor(root: HTMLElement, dock: HTMLElement, private send: (a: AdminAction) => void) {
    // its own corner, opposite the game's menu bar: the menu bar has no room left before the XP bar, and this button is not the game's
    const open = el(el(root, 'devbar'), 'btn mbtn', 'Admin');
    open.title = 'QA tools: set your level, teleport, add items  (the ` key)';
    open.addEventListener('click', () => this.toggle());

    this.panel = el(dock, 'panel adminpanel');
    titleRow(this.panel, 'Admin  (`)', () => this.setOpen(false));
    this.now = el(this.panel, 'anow');

    el(this.panel, 'rgroup', 'Skill level');
    const lvl = el(this.panel, 'afield');
    this.skill = this.buildSkills(lvl);
    this.level = numberBox(lvl, 1, MAX_LEVEL);
    this.skill.addEventListener('change', () => { this.fresh = true; });
    button(lvl, 'Set level', () => this.send({ k: 'skill', id: this.skill.value as SkillId, level: Number(this.level.value) }));

    el(this.panel, 'rgroup', 'Teleport');
    const go = el(this.panel, 'afield');
    this.where = this.buildDestinations(go);
    button(go, 'Go', () => {
      const d = DESTINATIONS[Number(this.where.value)];
      if (d) this.send({ k: 'teleport', x: d.x, z: d.z });
    });

    el(this.panel, 'rgroup', 'Gold');
    const purse = el(this.panel, 'afield');
    const gold = numberBox(purse, 500, MAX_GOLD);
    button(purse, 'Add gold', () => this.send({ k: 'gold', amount: Number(gold.value) }));

    el(this.panel, 'rgroup', 'Items');
    const give = el(this.panel, 'afield');
    this.search = input(give, 'search', '');
    this.search.placeholder = 'Search items';
    this.qty = numberBox(give, 1, MAX_GRANT);
    this.search.addEventListener('input', () => this.renderItems());
    this.list = el(this.panel, 'alist');
    this.renderItems();

    this.panel.style.display = 'none';
  }

  get dockEl() { return this.panel; }
  get isOpen() { return this.open; }

  setOpen(on: boolean) {
    this.open = on;
    this.fresh = on;
    this.panel.style.display = on ? 'block' : 'none';
  }

  toggle() { this.setOpen(!this.open); }

  update(s: GameState) {
    if (!this.open) return;
    const p = s.player;
    if (this.fresh) { this.fresh = false; this.level.value = String(p.skills[this.skill.value as SkillId].level); }
    const id = this.skill.value as SkillId;
    const picked = id === 'combat' ? '' : `  -  ${SKILLS[id].name} ${p.skills[id].level}`;
    this.now.textContent = `Combat ${p.combat.level}${picked}  -  at ${Math.round(p.x)}, ${Math.round(p.z)} in ${regionAt(p.x, p.z)?.name ?? 'nowhere'}`;
  }

  /** Every skill the level box can be pointed at, Combat first because it is the one that was always there. */
  private buildSkills(parent: HTMLElement): HTMLSelectElement {
    const sel = document.createElement('select');
    for (const id of SKILL_IDS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${SKILLS[id].icon} ${SKILLS[id].name}`;
      sel.appendChild(opt);
    }
    parent.appendChild(sel);
    return sel;
  }

  /** Towns first, then every region and each dungeon's rooms, every option carrying its place in the list and what stands there. */
  private buildDestinations(parent: HTMLElement): HTMLSelectElement {
    const sel = document.createElement('select');
    const groups = new Map<string, HTMLOptGroupElement>();
    DESTINATIONS.forEach((d, i) => {
      let group = groups.get(d.group);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = d.group;
        sel.appendChild(group);
        groups.set(d.group, group);
      }
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${d.name}  -  ${d.detail}`;
      opt.title = opt.textContent; // the closed box is only 200px: the whole line is the hover
      group.appendChild(opt);
    });
    parent.appendChild(sel);
    return sel;
  }

  /** The items the search matches, by name or by id, with the quantity box's count behind every Add. */
  private renderItems() {
    const q = this.search.value.trim().toLowerCase();
    if (q === this.shown) return;
    this.shown = q;
    this.list.textContent = '';
    const ids = Object.keys(ITEMS)
      .filter(id => !q || id.includes(q) || ITEMS[id].name.toLowerCase().includes(q))
      .sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name));
    if (!ids.length) return void el(this.list, 'anow', 'No item by that name.');
    for (const id of ids) {
      const row = el(this.list, 'arow');
      el(row, 'aitem', ITEMS[id].name).title = `${id}: ${ITEMS[id].desc}`;
      button(row, 'Add', () => this.send({ k: 'give', id, qty: Number(this.qty.value) }), 'btn sm');
    }
  }
}

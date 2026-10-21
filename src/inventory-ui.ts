// Inventory + character panels (DOM). Reads GameState; changes go out as sim InvActions only.
import type { GameState } from './sim';
import { ABILITIES } from './sim/data';
import { MAX_DURABILITY, powerForLevel } from './sim/data';
import { durabilityOf, isBroken } from './sim/durability';
import { INVENTORY_SIZE, InvAction, ItemStack } from './sim/inventory';
import { EQUIP_SLOTS, EquipSlot, ITEMS, TIER_COLORS, describeStats } from './sim/items';
import { reductionOf, swingInterval } from './sim/combat';
import { nearVendor } from './sim/shop';
import { DockWindow, dragData, el, panelWindow, parseDrag } from './dom';
import { itemArt, paintArt } from './art';

/** What a slot draws for an item with no thumbnail of its own, and what an empty equipment slot always draws. */
const SLOT_ICON: Record<EquipSlot, string> = { weapon: '🗡', head: '⛑', chest: '🛡', legs: '👖', hands: '🧤', feet: '🥾' };
const SLOT_LABEL: Record<EquipSlot, string> = { weapon: 'Weapon', head: 'Head', chest: 'Chest', legs: 'Legs', hands: 'Hands', feet: 'Feet' };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

type MenuRow = [label: string, run: (() => void) | null, cls?: string];

export class InventoryUi {
  private invPanel: HTMLElement;
  private charPanel: HTMLElement;
  private gold: HTMLElement;
  private grid: HTMLElement;
  private eqEl: HTMLElement;
  private statsEl: HTMLElement;
  private tip: HTMLElement;
  private menu: HTMLElement;
  private sig = '';
  /** The two panels as HUD windows, so Esc can shut them like any other. */
  readonly panels: Record<'inv' | 'char', DockWindow>;

  constructor(root: HTMLElement, private send: (a: InvAction) => void, private sell: (slot: number, qty: number) => void) {
    this.invPanel = el(root, 'panel invpanel');
    const title = el(this.invPanel, 'ptitle', 'Inventory  (I)');
    el(title, 'btn sm psort', 'Sort').addEventListener('click', () => this.send({ k: 'sort' }));
    this.gold = el(this.invPanel, 'invgold');
    this.grid = el(this.invPanel, 'grid');
    this.charPanel = el(root, 'panel charpanel');
    el(this.charPanel, 'ptitle', 'Character  (C)');
    this.eqEl = el(this.charPanel, 'equip');
    this.statsEl = el(this.charPanel, 'stats');
    this.tip = el(root, 'pop tip');
    this.menu = el(root, 'pop ctxmenu');
    addEventListener('mousedown', e => { if (!this.menu.contains(e.target as Node)) this.menu.style.display = 'none'; });
    this.invPanel.style.display = this.charPanel.style.display = 'none';
    this.panels = { inv: panelWindow(this.invPanel), char: panelWindow(this.charPanel) };
  }

  show(which: 'inv' | 'char') {
    this.panels[which].setOpen(true);
  }

  toggle(which: 'inv' | 'char') {
    const p = this.panels[which];
    p.setOpen(!p.isOpen);
    this.hideTip();
  }

  update(s: GameState) {
    const p = s.player;
    this.gold.textContent = `${p.gold} gold`;
    // rebuild only when something changed so drag-and-drop and hover stay stable
    const sig = JSON.stringify([p.inventory, p.equipment, p.durability, p.combat.level, p.talents]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.hideTip();
    this.renderGrid(s);
    this.renderEquip(s);
    this.renderStats(s);
  }

  private renderGrid(s: GameState) {
    this.grid.textContent = '';
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const cell = el(this.grid, 'cell');
      cell.dataset.slot = String(i);
      const st = s.player.inventory[i];
      cell.addEventListener('dragover', e => e.preventDefault());
      cell.addEventListener('drop', e => {
        e.preventDefault();
        const d = parseDrag(e.dataTransfer?.getData('text/plain') ?? '');
        if (d?.k === 'bag') this.send({ k: 'move', from: d.slot, to: i });
      });
      if (!st) continue;
      const def = ITEMS[st.id];
      this.fillCell(cell, st.id, st.qty);
      cell.draggable = true;
      cell.addEventListener('dragstart', e => { e.dataTransfer?.setData('text/plain', dragData({ k: 'bag', slot: i, id: st.id })); this.hideTip(); });
      cell.addEventListener('click', e => {
        // quick sell: shift-click at a merchant sells the whole stack outright, no menu and no confirmation
        if (e.shiftKey && nearVendor(s)) return this.sell(i, st.qty);
        if (def.slot) this.send({ k: 'equip', slot: i }); else if (def.use) this.send({ k: 'use', slot: i });
      });
      cell.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.openItemMenu(e.clientX, e.clientY, i, st, s);
      });
      this.hover(cell, st.id, s);
    }
  }

  private renderEquip(s: GameState) {
    this.eqEl.textContent = '';
    for (const slot of EQUIP_SLOTS) {
      const cell = el(this.eqEl, 'cell eqcell');
      el(cell, 'eqlabel', SLOT_LABEL[slot]);
      const id = s.player.equipment[slot];
      if (!id) { el(cell, 'icon ghost', SLOT_ICON[slot]); continue; }
      this.fillCell(cell, id, 1);
      if (isBroken(s.player, id)) cell.style.opacity = '0.45'; // worn but giving nothing
      cell.addEventListener('click', () => this.send({ k: 'unequip', slot }));
      this.hover(cell, id, s, true);
    }
  }

  private renderStats(s: GameState) {
    const p = s.player, st = p.stats, power = powerForLevel(p.combat.level) * p.talentFx.damage;
    const strike = ABILITIES[0].damage + st.weaponDamage;
    const lines: [string, string][] = [
      ['Combat level', String(p.combat.level)],
      ['Max health', String(p.maxHp)],
      ['Weapon damage', `+${st.weaponDamage}`],
      ['Strike hits for', `${Math.round(strike * power * 0.9)}-${Math.round(strike * power * 1.1)}`],
      ['Swing every', `${swingInterval(p).toFixed(1)}s`],
      ['Armour', String(st.armor)],
      ['Damage reduction', `${Math.round(reductionOf(p) * 100)}%`],
    ];
    this.statsEl.textContent = '';
    for (const [k, v] of lines) { const r = el(this.statsEl, 'srow'); el(r, 'sk', k); el(r, 'sv', v); }
  }

  private fillCell(cell: HTMLElement, id: string, qty: number) {
    const def = ITEMS[id], art = itemArt(id);
    cell.style.borderColor = hex(TIER_COLORS[def.tier]);
    paintArt(cell, art); // the thumbnail is the slot's face; the emoji is what a slot draws when the item has none
    if (!art) el(cell, 'icon', def.slot ? SLOT_ICON[def.slot] : def.use ? '🍖' : '◆').style.color = hex(TIER_COLORS[def.tier]);
    el(cell, 'iname', def.name);
    if (qty > 1) el(cell, 'qty', String(qty));
  }

  private hover(cell: HTMLElement, id: string, s: GameState, worn = false) {
    cell.addEventListener('mouseenter', e => this.showTip(id, s, worn, e));
    cell.addEventListener('mousemove', e => this.moveTip(e));
    cell.addEventListener('mouseleave', () => this.hideTip());
  }

  private showTip(id: string, s: GameState, worn: boolean, e: MouseEvent) {
    const def = ITEMS[id];
    this.tip.textContent = '';
    el(this.tip, 'tname', def.name).style.color = hex(TIER_COLORS[def.tier]);
    if (def.slot) el(this.tip, 'tslot', SLOT_LABEL[def.slot]);
    for (const line of describeStats(def)) el(this.tip, 'tstat', line);
    if (def.slot && durabilityOf(s.player, id) < MAX_DURABILITY) {
      const left = durabilityOf(s.player, id);
      el(this.tip, 'tcmp bad', left > 0 ? `Worn down: ${left}% durability` : 'Broken: gives nothing until a merchant repairs it');
    }
    el(this.tip, 'tdesc', def.desc);
    el(this.tip, 'tval', `Sells for ${def.value} gold`);
    if (def.slot && !worn) {
      const cur = s.player.equipment[def.slot];
      const dd = (def.stats?.damage ?? 0) - (cur ? ITEMS[cur].stats?.damage ?? 0 : 0);
      const da = (def.stats?.armor ?? 0) - (cur ? ITEMS[cur].stats?.armor ?? 0 : 0);
      const diff = [dd && `${dd > 0 ? '+' : ''}${dd} damage`, da && `${da > 0 ? '+' : ''}${da} armour`].filter(Boolean);
      if (diff.length) {
        el(this.tip, `tcmp ${dd >= 0 && da >= 0 ? 'good' : 'bad'}`, `If equipped: ${diff.join(', ')}`);
      }
      el(this.tip, 'thint', 'Click to equip  ·  Right-click to drop or destroy');
    } else if (worn) el(this.tip, 'thint', 'Click to unequip');
    else if (def.use) el(this.tip, 'thint', 'Click to eat (G eats the best food)  ·  Drag onto the action bar for a key of its own  ·  Right-click to drop or destroy');
    else el(this.tip, 'thint', 'Right-click to drop or destroy');
    if (!worn && nearVendor(s)) el(this.tip, 'thint', `Shift-click to sell the stack (${def.value} gold each)`);
    this.tip.style.display = 'block';
    this.moveTip(e);
  }

  private moveTip(e: MouseEvent) {
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(e.clientX + 14, innerWidth - w - 4)}px`;
    this.tip.style.top = `${Math.min(e.clientY + 14, innerHeight - h - 4)}px`;
  }

  private hideTip() { this.tip.style.display = 'none'; }

  /** Right-click menu for a filled slot. Destroying or selling a stack asks first: neither can be undone. */
  private openItemMenu(x: number, y: number, slot: number, st: ItemStack, s: GameState) {
    const def = ITEMS[st.id], what = st.qty > 1 ? `${def.name} ×${st.qty}` : def.name;
    const rows: MenuRow[] = [];
    if (def.slot) rows.push(['Equip', () => this.send({ k: 'equip', slot })]);
    if (def.use) rows.push(['Eat', () => this.send({ k: 'use', slot })]);
    if (nearVendor(s)) {
      if (st.qty > 1) rows.push([`Sell 1 (${def.value} gold)`, () => this.sell(slot, 1)]);
      rows.push([`Sell ${what} (${def.value * st.qty} gold)`,
        this.confirmed(x, y, st.qty, 'Yes, sell them', `Sell all ${st.qty} for ${def.value * st.qty} gold?`, () => this.sell(slot, st.qty))]);
    }
    rows.push([`Drop ${what}`, () => this.send({ k: 'drop', slot })]);
    rows.push([`Destroy ${what}`,
      this.confirmed(x, y, st.qty, 'Yes, destroy them', `Destroy all ${st.qty}? This cannot be undone.`, () => this.send({ k: 'destroy', slot })), 'bad']);
    rows.push(['Cancel', null]);
    this.openMenu(x, y, rows);
  }

  /** A menu action that runs at once for a single item and asks first for a stack. */
  private confirmed(x: number, y: number, qty: number, yes: string, prompt: string, run: () => void): () => void {
    return qty > 1 ? () => this.openMenu(x, y, [[yes, run, 'bad'], ['Cancel', null]], prompt) : run;
  }
  private openMenu(x: number, y: number, rows: MenuRow[], head = '') {
    this.hideTip();
    this.menu.textContent = '';
    if (head) el(this.menu, 'mhead', head);
    for (const [label, run, cls] of rows) {
      const row = el(this.menu, `mrow${cls ? ` ${cls}` : ''}`, label);
      row.addEventListener('click', () => { this.menu.style.display = 'none'; run?.(); });
    }
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
    this.menu.style.display = 'block';
  }
}

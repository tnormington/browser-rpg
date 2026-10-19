// Inventory + character panels (DOM). Reads GameState; changes go out as sim InvActions only.
import type { GameState } from './sim';
import { ABILITIES } from './sim/data';
import { MAX_DURABILITY, powerForLevel } from './sim/data';
import { durabilityOf, isBroken } from './sim/durability';
import { INVENTORY_SIZE, InvAction, ItemStack } from './sim/inventory';
import { EQUIP_SLOTS, EquipSlot, ITEMS, TIER_COLORS, describeStats } from './sim/items';
import { reductionOf, swingInterval } from './sim/combat';
import { nearVendor } from './sim/shop';
import { HudWindow, panelWindow } from './dom';

const SLOT_ICON: Record<EquipSlot, string> = { weapon: '🗡', head: '⛑', chest: '🛡', legs: '👖' };
const SLOT_LABEL: Record<EquipSlot, string> = { weapon: 'Weapon', head: 'Head', chest: 'Chest', legs: 'Legs' };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

type MenuRow = [label: string, run: (() => void) | null, cls?: string];

function div(parent: HTMLElement, cls: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  parent.appendChild(d);
  return d;
}

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
  readonly panels: Record<'inv' | 'char', HudWindow>;

  constructor(root: HTMLElement, private send: (a: InvAction) => void, private sell: (slot: number, qty: number) => void) {
    this.invPanel = div(root, 'panel invpanel');
    const title = div(this.invPanel, 'ptitle', 'Inventory  (I)');
    div(title, 'psort', 'Sort').addEventListener('click', () => this.send({ k: 'sort' }));
    this.gold = div(this.invPanel, 'invgold');
    this.grid = div(this.invPanel, 'grid');
    this.charPanel = div(root, 'panel charpanel');
    div(this.charPanel, 'ptitle', 'Character  (C)');
    this.eqEl = div(this.charPanel, 'equip');
    this.statsEl = div(this.charPanel, 'stats');
    this.tip = div(root, 'tip');
    this.menu = div(root, 'ctxmenu');
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
      const cell = div(this.grid, 'cell');
      cell.dataset.slot = String(i);
      const st = s.player.inventory[i];
      cell.addEventListener('dragover', e => e.preventDefault());
      cell.addEventListener('drop', e => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData('text/plain'));
        if (Number.isInteger(from)) this.send({ k: 'move', from, to: i });
      });
      if (!st) continue;
      const def = ITEMS[st.id];
      this.fillCell(cell, st.id, st.qty);
      cell.draggable = true;
      cell.addEventListener('dragstart', e => { e.dataTransfer?.setData('text/plain', String(i)); this.hideTip(); });
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
      const cell = div(this.eqEl, 'cell eqcell');
      div(cell, 'eqlabel', SLOT_LABEL[slot]);
      const id = s.player.equipment[slot];
      if (!id) { div(cell, 'icon ghost', SLOT_ICON[slot]); continue; }
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
    for (const [k, v] of lines) { const r = div(this.statsEl, 'srow'); div(r, 'sk', k); div(r, 'sv', v); }
  }

  private fillCell(cell: HTMLElement, id: string, qty: number) {
    const def = ITEMS[id];
    cell.style.borderColor = hex(TIER_COLORS[def.tier]);
    div(cell, 'icon', def.slot ? SLOT_ICON[def.slot] : def.use ? '🍖' : '◆').style.color = hex(TIER_COLORS[def.tier]);
    div(cell, 'iname', def.name);
    if (qty > 1) div(cell, 'qty', String(qty));
  }

  private hover(cell: HTMLElement, id: string, s: GameState, worn = false) {
    cell.addEventListener('mouseenter', e => this.showTip(id, s, worn, e));
    cell.addEventListener('mousemove', e => this.moveTip(e));
    cell.addEventListener('mouseleave', () => this.hideTip());
  }

  private showTip(id: string, s: GameState, worn: boolean, e: MouseEvent) {
    const def = ITEMS[id];
    this.tip.textContent = '';
    div(this.tip, 'tname', def.name).style.color = hex(TIER_COLORS[def.tier]);
    if (def.slot) div(this.tip, 'tslot', SLOT_LABEL[def.slot]);
    for (const line of describeStats(def)) div(this.tip, 'tstat', line);
    if (def.slot && durabilityOf(s.player, id) < MAX_DURABILITY) {
      const left = durabilityOf(s.player, id);
      div(this.tip, 'tcmp', left > 0 ? `Worn down: ${left}% durability` : 'Broken: gives nothing until a merchant repairs it').style.color = '#e0604f';
    }
    div(this.tip, 'tdesc', def.desc);
    div(this.tip, 'tval', `Sells for ${def.value} gold`);
    if (def.slot && !worn) {
      const cur = s.player.equipment[def.slot];
      const dd = (def.stats?.damage ?? 0) - (cur ? ITEMS[cur].stats?.damage ?? 0 : 0);
      const da = (def.stats?.armor ?? 0) - (cur ? ITEMS[cur].stats?.armor ?? 0 : 0);
      const diff = [dd && `${dd > 0 ? '+' : ''}${dd} damage`, da && `${da > 0 ? '+' : ''}${da} armour`].filter(Boolean);
      if (diff.length) {
        const line = div(this.tip, 'tcmp', `If equipped: ${diff.join(', ')}`);
        line.style.color = (dd >= 0 && da >= 0) ? '#93b58c' : '#e0604f';
      }
      div(this.tip, 'thint', 'Click to equip  ·  Right-click to drop or destroy');
    } else if (worn) div(this.tip, 'thint', 'Click to unequip');
    else if (def.use) div(this.tip, 'thint', 'Click to eat (G eats the best food)  ·  Right-click to drop or destroy');
    else div(this.tip, 'thint', 'Right-click to drop or destroy');
    if (!worn && nearVendor(s)) div(this.tip, 'thint', `Shift-click to sell the stack (${def.value} gold each)`);
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
    if (head) div(this.menu, 'mhead', head);
    for (const [label, run, cls] of rows) {
      const row = div(this.menu, `mrow${cls ? ` ${cls}` : ''}`, label);
      row.addEventListener('click', () => { this.menu.style.display = 'none'; run?.(); });
    }
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
    this.menu.style.display = 'block';
  }
}

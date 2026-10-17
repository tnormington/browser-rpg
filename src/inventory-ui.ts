// Inventory + character panels (DOM). Reads GameState; changes go out as sim InvActions only.
import type { GameState } from './sim';
import { ABILITIES } from './sim/data';
import { powerForLevel } from './sim/data';
import { INVENTORY_SIZE, InvAction } from './sim/inventory';
import { EQUIP_SLOTS, EquipSlot, ITEMS, TIER_COLORS, describeStats } from './sim/items';

const SLOT_ICON: Record<EquipSlot, string> = { weapon: '🗡', head: '⛑', chest: '🛡', legs: '👖' };
const SLOT_LABEL: Record<EquipSlot, string> = { weapon: 'Weapon', head: 'Head', chest: 'Chest', legs: 'Legs' };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

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
  private grid: HTMLElement;
  private eqEl: HTMLElement;
  private statsEl: HTMLElement;
  private tip: HTMLElement;
  private menu: HTMLElement;
  private sig = '';

  constructor(root: HTMLElement, private send: (a: InvAction) => void) {
    this.invPanel = div(root, 'panel invpanel');
    div(this.invPanel, 'ptitle', 'Inventory  (I)');
    this.grid = div(this.invPanel, 'grid');
    this.charPanel = div(root, 'panel charpanel');
    div(this.charPanel, 'ptitle', 'Character  (C)');
    this.eqEl = div(this.charPanel, 'equip');
    this.statsEl = div(this.charPanel, 'stats');
    this.tip = div(root, 'tip');
    this.menu = div(root, 'ctxmenu');
    addEventListener('mousedown', e => { if (!this.menu.contains(e.target as Node)) this.menu.style.display = 'none'; });
    this.invPanel.style.display = this.charPanel.style.display = 'none';
  }

  toggle(which: 'inv' | 'char') {
    const p = which === 'inv' ? this.invPanel : this.charPanel;
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
    this.hideTip();
  }

  update(s: GameState) {
    const p = s.player;
    // rebuild only when something changed so drag-and-drop and hover stay stable
    const sig = JSON.stringify([p.inventory, p.equipment, p.combat.level]);
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
      cell.addEventListener('click', () => { if (def.slot) this.send({ k: 'equip', slot: i }); });
      cell.addEventListener('contextmenu', e => {
        e.preventDefault();
        const items: [string, InvAction | null][] = [];
        if (def.slot) items.push(['Equip', { k: 'equip', slot: i }]);
        items.push(['Drop', { k: 'drop', slot: i }], ['Destroy', { k: 'destroy', slot: i }], ['Cancel', null]);
        this.openMenu(e.clientX, e.clientY, items);
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
      cell.addEventListener('click', () => this.send({ k: 'unequip', slot }));
      this.hover(cell, id, s, true);
    }
  }

  private renderStats(s: GameState) {
    const p = s.player, st = p.stats, power = powerForLevel(p.combat.level);
    const strike = ABILITIES[0].damage + st.weaponDamage;
    const lines: [string, string][] = [
      ['Combat level', String(p.combat.level)],
      ['Max health', String(p.maxHp)],
      ['Weapon damage', `+${st.weaponDamage}`],
      ['Strike hits for', `${Math.round(strike * power * 0.9)}-${Math.round(strike * power * 1.1)}`],
      ['Armour', String(st.armor)],
      ['Damage reduction', `${Math.round(st.reduction * 100)}%`],
    ];
    this.statsEl.textContent = '';
    for (const [k, v] of lines) { const r = div(this.statsEl, 'srow'); div(r, 'sk', k); div(r, 'sv', v); }
  }

  private fillCell(cell: HTMLElement, id: string, qty: number) {
    const def = ITEMS[id];
    cell.style.borderColor = hex(TIER_COLORS[def.tier]);
    div(cell, 'icon', def.slot ? SLOT_ICON[def.slot] : '◆').style.color = hex(TIER_COLORS[def.tier]);
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
    div(this.tip, 'tdesc', def.desc);
    if (def.slot && !worn) {
      const cur = s.player.equipment[def.slot];
      const dd = (def.stats?.damage ?? 0) - (cur ? ITEMS[cur].stats?.damage ?? 0 : 0);
      const da = (def.stats?.armor ?? 0) - (cur ? ITEMS[cur].stats?.armor ?? 0 : 0);
      const diff = [dd && `${dd > 0 ? '+' : ''}${dd} damage`, da && `${da > 0 ? '+' : ''}${da} armour`].filter(Boolean);
      if (diff.length) {
        const line = div(this.tip, 'tcmp', `If equipped: ${diff.join(', ')}`);
        line.style.color = (dd >= 0 && da >= 0) ? '#6aff8a' : '#ff7a6a';
      }
      div(this.tip, 'thint', 'Click to equip  ·  Right-click for more');
    } else if (worn) div(this.tip, 'thint', 'Click to unequip');
    this.tip.style.display = 'block';
    this.moveTip(e);
  }

  private moveTip(e: MouseEvent) {
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(e.clientX + 14, innerWidth - w - 4)}px`;
    this.tip.style.top = `${Math.min(e.clientY + 14, innerHeight - h - 4)}px`;
  }

  private hideTip() { this.tip.style.display = 'none'; }

  private openMenu(x: number, y: number, items: [string, InvAction | null][]) {
    this.hideTip();
    this.menu.textContent = '';
    for (const [label, act] of items) {
      const row = div(this.menu, 'mrow', label);
      row.addEventListener('click', () => { if (act) this.send(act); this.menu.style.display = 'none'; });
    }
    this.menu.style.left = `${x}px`;
    this.menu.style.top = `${y}px`;
    this.menu.style.display = 'block';
  }
}

// Shop panel (DOM): the merchant's stock with prices. Selling happens from the bag's right-click menu (inventory-ui.ts).
// Reads GameState; trades go out as sim shop requests only. Opens when the merchant is clicked, closes when you walk off.
import type { GameState } from './sim';
import { SHOP_STOCK, SHOP_REACH, VENDOR, buyPrice, nearVendor } from './sim/shop';
import { ITEMS, TIER_COLORS, describeStats } from './sim/items';
import { hasRoom } from './sim/inventory';
import { el } from './dom';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class ShopUi {
  private panel: HTMLElement;
  private goldEl: HTMLElement;
  private list: HTMLElement;
  private open = false;
  private sig = '';

  constructor(root: HTMLElement, private buy: (item: string, qty: number) => void) {
    this.panel = el(root, 'panel shoppanel');
    const title = el(this.panel, 'ptitle', VENDOR.name);
    const close = el(title, 'pclose', '✕');
    close.addEventListener('click', () => this.setOpen(false));
    this.goldEl = el(this.panel, 'shopgold');
    el(this.panel, 'shophint', 'Right-click an item in your bag to sell it.');
    this.list = el(this.panel, 'recipes');
    this.panel.style.display = 'none';
  }

  get isOpen() { return this.open; }

  setOpen(on: boolean) {
    this.open = on;
    this.panel.style.display = on ? 'block' : 'none';
    this.sig = '';
  }

  update(s: GameState) {
    const p = s.player;
    // a little slack beyond selling reach so the panel does not flicker at the edge
    if (this.open && (p.dead || Math.hypot(p.x - VENDOR.x, p.z - VENDOR.z) > SHOP_REACH + 1.5)) this.setOpen(false);
    if (!this.open) return;
    const sig = JSON.stringify([p.gold, p.inventory.map(st => st && st.id + st.qty), nearVendor(s)]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.goldEl.textContent = `Your gold: ${p.gold}`;
    this.list.textContent = '';
    for (const id of SHOP_STOCK) {
      const def = ITEMS[id], price = buyPrice(id);
      const can = p.gold >= price && hasRoom(p.inventory, id) && nearVendor(s);
      const row = el(this.list, `recipe${can ? '' : ' locked'}`);
      row.title = def.desc;
      const head = el(row, 'rhead');
      el(head, 'rname', def.name).style.color = hex(TIER_COLORS[def.tier]);
      el(head, `rreq${p.gold >= price ? '' : ' bad'}`, `${price} gold`);
      for (const line of describeStats(def)) el(row, 'rstat', line);
      const b = el(el(row, 'rbtns'), `rbtn${can ? '' : ' off'}`, 'Buy');
      b.addEventListener('click', () => this.buy(id, 1));
    }
  }
}

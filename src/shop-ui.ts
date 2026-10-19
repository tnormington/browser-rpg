// Shop panel (DOM): the merchant's stock with prices. Selling happens from the bag's right-click menu (inventory-ui.ts).
// Reads GameState; trades go out as sim shop requests only. Opens when the merchant is clicked, closes when you walk off.
import type { GameState } from './sim';
import { SHOP_REACH, Vendor, buyPrice, taughtBy, vendorById, VENDORS } from './sim/shop';
import { ABILITIES } from './sim/data';
import { ITEMS, TIER_COLORS, describeStats } from './sim/items';
import { hasRoom } from './sim/inventory';
import { el } from './dom';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class ShopUi {
  private panel: HTMLElement;
  private titleEl: HTMLElement;
  private vendor: Vendor = VENDORS[0];
  private goldEl: HTMLElement;
  private hint: HTMLElement;
  private list: HTMLElement;
  private open = false;
  private sig = '';

  constructor(root: HTMLElement, private buy: (item: string, qty: number) => void, private learn: (slot: number) => void) {
    this.panel = el(root, 'panel shoppanel');
    const title = this.titleEl = el(this.panel, 'ptitle');
    const close = el(title, 'pclose', '✕');
    close.addEventListener('click', () => this.setOpen(false));
    this.goldEl = el(this.panel, 'shopgold');
    this.hint = el(this.panel, 'shophint');
    this.list = el(this.panel, 'recipes');
    this.panel.style.display = 'none';
  }

  get isOpen() { return this.open; }

  setOpen(on: boolean, vendor?: string) {
    this.open = on;
    if (on && vendor) this.vendor = vendorById(vendor) ?? this.vendor;
    this.titleEl.firstChild?.nodeType === Node.TEXT_NODE ? (this.titleEl.firstChild.textContent = this.vendor.name) : this.titleEl.prepend(this.vendor.name);
    this.hint.textContent = taughtBy(this.vendor.id).length ? 'Abilities are bought here with gold, once you have the level.' : 'Right-click an item in your bag to sell it.';
    this.panel.style.display = on ? 'block' : 'none';
    this.sig = '';
  }

  update(s: GameState) {
    const p = s.player;
    // a little slack beyond selling reach so the panel does not flicker at the edge
    if (this.open && (p.dead || Math.hypot(p.x - this.vendor.x, p.z - this.vendor.z) > SHOP_REACH + 1.5)) this.setOpen(false);
    if (!this.open) return;
    const sig = JSON.stringify([p.gold, p.inventory.map(st => st && st.id + st.qty), p.learned, p.combat.level, Math.hypot(p.x - this.vendor.x, p.z - this.vendor.z) <= SHOP_REACH]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.goldEl.textContent = `Your gold: ${p.gold}`;
    this.list.textContent = '';
    const near = Math.hypot(p.x - this.vendor.x, p.z - this.vendor.z) <= SHOP_REACH;
    for (const slot of taughtBy(this.vendor.id)) {
      const a = ABILITIES[slot], price = a.trainer!.price, known = p.learned.includes(a.name), ready = p.combat.level >= a.unlockLevel;
      const can = !known && ready && p.gold >= price && near;
      const row = el(this.list, `recipe${can ? '' : ' locked'}`);
      row.title = a.desc;
      const head = el(row, 'rhead');
      el(head, 'rname', a.name);
      el(head, `rreq${known || (ready && p.gold >= price) ? '' : ' bad'}`, known ? 'Learned' : ready ? `${price} gold` : `combat level ${a.unlockLevel}`);
      el(row, 'rstat', a.desc);
      if (known) continue;
      el(el(row, 'rbtns'), `rbtn${can ? '' : ' off'}`, 'Learn').addEventListener('click', () => this.learn(slot));
    }
    for (const id of this.vendor.stock) {
      const def = ITEMS[id], price = buyPrice(id);
      const can = p.gold >= price && hasRoom(p.inventory, id) && near;
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

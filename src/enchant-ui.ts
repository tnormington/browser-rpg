// Enchanting panel (DOM, the Spire's rune circle): the slots you wear with the enchants each can take, and the spare gear in the bag that can be ground into arcane dust.
// Reads GameState; everything goes out as a sim enchant request (sim/enchanting.ts). Opens when the circle is clicked, closes when you walk off.
import type { GameState } from './sim';
import { EQUIP_SLOTS, EquipSlot, ITEMS, TIER_COLORS } from './sim/items';
import { ENCHANTS, enchantById, enchantXp } from './sim/enchants';
import { DUST, canDisenchant, dustFor, disenchantXp, enchantBlocker } from './sim/enchanting';
import { STATION_REACH, nearStation, stationSites } from './sim/crafting';
import { countItem } from './sim/inventory';
import type { EnchantAction } from './sim/enchanting';
import { actionButton, el, titleRow } from './dom';
import { itemThumb, materialChip } from './art';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SLOT_NAMES: Record<EquipSlot, string> = { weapon: 'Weapon', head: 'Head', chest: 'Chest', legs: 'Legs', hands: 'Hands', feet: 'Feet' };
/** Gear of this tier or better asks twice before it is ground: a Crownbreaker is one click from dust otherwise. */
const CONFIRM_TIER = 4;

export class EnchantUi {
  private panel: HTMLElement;
  private dustEl: HTMLElement;
  private list: HTMLElement;
  private open = false;
  private sig = '';
  /** The bag slot whose Disenchant has been pressed once and is waiting for the second press, or -1. */
  private armed = -1;

  constructor(root: HTMLElement, private enchant: (a: EnchantAction) => void) {
    this.panel = el(root, 'panel forgepanel enchantpanel');
    titleRow(this.panel, 'Rune Circle', () => this.setOpen(false));
    this.dustEl = el(this.panel, 'shopgold');
    this.list = el(this.panel, 'recipes');
    this.panel.style.display = 'none';
  }

  get dockEl() { return this.panel; }
  get isOpen() { return this.open; }

  setOpen(on: boolean) {
    this.open = on;
    this.armed = -1;
    this.panel.style.display = on ? 'block' : 'none';
    this.sig = '';
  }

  update(s: GameState) {
    const p = s.player;
    if (this.open && (p.dead || !this.nearWithSlack(s))) this.setOpen(false);
    if (!this.open) return;
    const sig = JSON.stringify([p.inventory.map(st => st && st.id + st.qty), p.equipment, p.enchants, p.durability, p.skills.enchanting.level, nearStation(s, 'circle'), this.armed]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.dustEl.textContent = `Arcane dust: ${countItem(p.inventory, DUST)}   ·   Enchanting ${p.skills.enchanting.level}`;
    this.list.textContent = '';
    this.renderSlots(s);
    this.renderGrinding(s);
  }

  /** Each slot with something worn on it: what is set there now, and the enchants it could take. */
  private renderSlots(s: GameState) {
    const p = s.player;
    el(this.list, 'rgroup', 'Enchant what you wear');
    let any = false;
    for (const slot of EQUIP_SLOTS) {
      const worn = p.equipment[slot], options = ENCHANTS.filter(e => e.slots.includes(slot));
      if (!worn || !options.length) continue;
      any = true;
      const set = p.enchants[slot] ? enchantById(p.enchants[slot]!) : undefined;
      const head = el(this.list, 'recipe rhead rwrap');
      const lead = el(head, 'rlead');
      itemThumb(lead, worn);
      el(lead, 'rname', `${SLOT_NAMES[slot]}: ${ITEMS[worn].name}`).style.color = hex(TIER_COLORS[ITEMS[worn].tier]);
      el(head, 'rreq', set ? set.name : 'not enchanted');
      if (set) el(head, 'rstat', set.desc);
      for (const e of options) {
        const why = enchantBlocker(s, e.id, slot), can = why === null, here = p.enchants[slot] === e.id;
        const row = el(this.list, `recipe enchrow${can && !here ? '' : ' locked'}`);
        row.title = `${e.desc} Belongs to the slot, not the item: it stays when you change what you wear. Setting another on the slot replaces it.`;
        const h = el(row, 'rhead');
        el(h, 'rname', e.name);
        el(h, `rreq${why === 'level' ? ' bad' : ''}`, `Enchanting ${e.level}`);
        el(row, 'rstat', e.desc);
        const cost = el(row, 'rinputs');
        materialChip(cost, DUST, countItem(p.inventory, DUST), e.dust);
        el(cost, 'rmeta', `${enchantXp(e)} XP`);
        const b = actionButton(el(row, 'rbtns'), here ? 'Set' : set ? 'Replace' : 'Enchant', can && !here);
        b.addEventListener('click', () => { this.enchant({ k: 'enchant', id: e.id, slot }); });
      }
    }
    if (!any) el(this.list, 'rstat', 'Wear a weapon or armour to enchant it.');
  }

  /** The bag's gear worth grinding: what it leaves, and what it teaches. */
  private renderGrinding(s: GameState) {
    const p = s.player, near = nearStation(s, 'circle');
    el(this.list, 'rgroup', 'Grind down spare gear');
    let any = false;
    p.inventory.forEach((st, i) => {
      if (!st || !canDisenchant(st.id)) return;
      any = true;
      const def = ITEMS[st.id], armed = this.armed === i, ask = def.tier >= CONFIRM_TIER;
      const row = el(this.list, `recipe enchrow${near ? '' : ' locked'}`);
      row.title = `${def.desc}\nDestroyed at the circle: it cannot be got back.`;
      const head = el(row, 'rhead');
      const lead = el(head, 'rlead');
      itemThumb(lead, st.id);
      el(lead, 'rname', def.name).style.color = hex(TIER_COLORS[def.tier]);
      el(head, 'rreq', `${dustFor(st.id)} dust`);
      el(row, 'rmeta', `${disenchantXp(st.id)} Enchanting XP`);
      const b = actionButton(el(row, 'rbtns'), armed ? 'Really grind it?' : 'Disenchant', near);
      b.addEventListener('click', () => {
        if (ask && !armed) { this.armed = i; this.sig = ''; return; }
        this.armed = -1;
        this.enchant({ k: 'disenchant', slot: i });
      });
    });
    if (!any) el(this.list, 'rstat', 'Nothing in your bag is worth grinding: gear of tier 2 and above is.');
  }

  /** The panel stays open a little beyond the circle's reach so it does not flicker at the edge. */
  private nearWithSlack(s: GameState) {
    return nearStation(s, 'circle') || stationSites('circle').some(at => Math.hypot(s.player.x - at.x, s.player.z - at.z) <= STATION_REACH + 1.5);
  }
}

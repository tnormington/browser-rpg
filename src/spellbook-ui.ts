// Spell book (DOM): every ability the player has, where it sits on the action bar, and the drag source for re-assigning it.
// Reads GameState only. The bar layout itself lives in the HUD (hud.ts), which is what `bar` and `clear` reach into.
import type { GameState } from './sim';
import { ABILITIES } from './sim/data';
import { abilityOpen } from './sim/combat';
import { talentById } from './sim/talents';
import { HudWindow, dragData, el, panelWindow, titleRow } from './dom';
import type { BarEntry } from './bar-layout';

export class SpellbookUi implements HudWindow {
  private panel: HTMLElement;
  private list: HTMLElement;
  private win: HudWindow;
  private sig = '';

  /** `bar` is the live layout (what sits in each bar slot) and `keyOf` names the key a spell answers to; `clear` takes it off the bar. */
  constructor(root: HTMLElement, private bar: () => (BarEntry | null)[], private keyOf: (ability: number) => string | null, private clear: (ability: number) => void) {
    this.panel = el(root, 'panel bookpanel');
    titleRow(this.panel, 'Spell Book  (P)', () => this.setOpen(false));
    el(this.panel, 'shophint', 'Drag a spell onto the action bar to assign it. Right-click a bar slot (or ✕ here) to clear it. Click a slot\'s key to rebind it.');
    this.list = el(this.panel, 'recipes');
    this.win = panelWindow(this.panel);
    this.panel.style.display = 'none';
  }

  get isOpen() { return this.win.isOpen; }
  setOpen(on: boolean) { this.win.setOpen(on); this.sig = ''; }
  toggle() { this.setOpen(!this.isOpen); }

  /** The bar changed under us (a drop, an unlock): redraw on the next update. */
  invalidate() { this.sig = ''; }

  update(s: GameState) {
    if (!this.isOpen) return;
    const p = s.player;
    const sig = JSON.stringify([p.combat.level, p.learned, p.talents, this.bar()]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.list.textContent = '';
    for (let i = 0; i < ABILITIES.length; i++) {
      const a = ABILITIES[i], known = abilityOpen(p, i), key = this.keyOf(i);
      const row = el(this.list, `recipe${known ? '' : ' locked'}`);
      const head = el(row, 'rhead');
      el(head, 'rname', a.name);
      el(head, `rreq${known ? '' : ' bad'}`, known
        ? (key ? `on the bar: ${key}` : 'not on the bar')
        : p.combat.level < a.unlockLevel ? `combat level ${a.unlockLevel}`
          : a.trainer ? `taught for ${a.trainer.price} gold` : `the ${talentById(a.talent!)!.name} talent`);
      el(row, 'rstat', a.desc);
      if (!known) continue;
      row.draggable = true;
      row.addEventListener('dragstart', e => e.dataTransfer?.setData('text/plain', dragData({ k: 'spell', i })));
      if (key) el(el(row, 'rbtns'), 'btn rbtn', `✕ Remove from ${key}`).addEventListener('click', () => this.clear(i));
    }
  }
}

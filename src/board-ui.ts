// The notice board's panel (DOM): a town's bounties, each with what it asks, how far along it is and the one button it offers now.
// Reads GameState only; the one thing it asks of the sim is a BountyAction, through the callback main.ts gives it. Plain by design (HOM-163): the
// surface is the UI Designer's to dress, and the structure (rows, buttons, hint) is all it needs to keep.
import type { GameState } from './sim';
import { BountyAction, BountyFail, boardById, boardNear, offers } from './sim/bounties';
import { ITEMS } from './sim/items';
import { actionButton, el, titleRow } from './dom';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const WHY: Partial<Record<BountyFail, string>> = {
  slots: 'Your hands are full: hand one in or drop one first.',
  level: 'Nothing left in the world is a match for you.',
};

/** The board's panel. Opens when the board is clicked, closes when you walk off. */
export class BoardUi {
  private panel: HTMLElement;
  private titleEl: HTMLElement;
  private list: HTMLElement;
  private town = 'hale';
  private open = false;
  private sig = '';

  constructor(root: HTMLElement, private send: (a: BountyAction) => void) {
    this.panel = el(root, 'panel shoppanel');
    this.titleEl = titleRow(this.panel, '', () => this.setOpen(false));
    el(this.panel, 'shophint', 'Take a bounty, and come back to hand it in. It is on offer again after.');
    this.list = el(this.panel, 'recipes');
    this.panel.style.display = 'none';
  }

  get dockEl() { return this.panel; }
  get isOpen() { return this.open; }

  setOpen(on: boolean, town?: string) {
    this.open = on;
    if (on && town) this.town = town;
    const name = boardById(this.town)?.name ?? 'Notice Board';
    this.titleEl.firstChild?.nodeType === Node.TEXT_NODE ? (this.titleEl.firstChild.textContent = name) : this.titleEl.prepend(name);
    this.panel.style.display = on ? 'block' : 'none';
    this.sig = '';
  }

  update(s: GameState) {
    if (this.open && (s.player.dead || boardNear(s)?.id !== this.town)) this.setOpen(false);
    if (!this.open) return;
    const rows = offers(s, this.town);
    const sig = JSON.stringify([rows.map(r => [r.active?.kills, r.goal, r.gold, r.xp, r.done, r.why]), s.player.dead]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.list.textContent = '';
    for (const r of rows) {
      const row = el(this.list, `recipe${r.why && !r.active ? ' locked' : ''}`);
      const head = el(row, 'rhead');
      el(head, 'rname', r.def.name);
      if (r.done > 0) el(head, 'rreq', `done ${r.done}x`);
      el(row, 'rstat', r.def.text);
      const reward = [`${r.gold} gold`, `${r.xp} XP`, ...(r.def.reward.items ?? []).map(i => `${i.qty > 1 ? i.qty + 'x ' : ''}${ITEMS[i.id].name}`)].join(', ');
      el(row, 'rstat', `${r.active ? `${cap(r.def.target.label)}: ${Math.min(r.goal, r.active.kills)} / ${r.goal}` : `Slay ${r.goal} ${r.def.target.label}`}. Pays ${reward}.`);
      if (r.why && r.why !== 'active' && WHY[r.why]) el(row, 'rstat', WHY[r.why]!);
      const btns = el(row, 'rbtns');
      if (r.active) {
        if (r.active.kills >= r.active.goal) actionButton(btns, 'Hand in').addEventListener('click', () => this.send({ k: 'turnin', id: r.def.id }));
        actionButton(btns, 'Drop').addEventListener('click', () => this.send({ k: 'abandon', id: r.def.id }));
      } else actionButton(btns, 'Take', !r.why).addEventListener('click', () => this.send({ k: 'accept', id: r.def.id }));
    }
  }
}

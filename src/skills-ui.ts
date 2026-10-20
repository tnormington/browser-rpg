// Skills panel (DOM): every skill with its level and progress to the next. Reads GameState only.
import type { GameState } from './sim';
import { SKILL_IDS, SKILLS, SkillId, totalLevel } from './sim/skills';
import { mountById } from './sim/mounts';
import { levelProgress } from './sim/xp';
import { el } from './dom';

const MOUNT = mountById('destrier')!, GOAL = MOUNT.total!; // the one total level anything asks for: the second mount's
export class SkillsUi {
  private panel: HTMLElement;
  private total: { sum: HTMLElement; fill: HTMLElement; note: HTMLElement };
  private rows: { id: SkillId; lvl: HTMLElement; fill: HTMLElement; label: HTMLElement }[] = [];

  constructor(root: HTMLElement) {
    this.panel = el(root, 'panel skillspanel');
    el(this.panel, 'ptitle', 'Skills  (K)');
    // the total says what it is for: a number that nothing in the panel explains reads as a score, and it is a key
    const total = el(this.panel, 'skilltotal');
    total.title = `Total level is every skill's level added together. Highmoor's stablemaster asks ${GOAL} for the ${MOUNT.name}.`;
    const head = el(total, 'skillhead');
    el(head, 'skillname', 'Total level');
    this.total = { sum: el(head, 'skilllvl'), fill: el(el(total, 'bar thin skillbar'), 'fill'), note: el(total, 'skillnote') };
    const grid = el(this.panel, 'skillgrid'); // one column; two where the window is short, so a list of skills never scrolls
    for (const id of SKILL_IDS) {
      const row = el(grid, 'skillrow');
      const head = el(row, 'skillhead');
      el(head, 'skillname', `${SKILLS[id].icon} ${SKILLS[id].name}`);
      const lvl = el(head, 'skilllvl');
      const bar = el(row, 'bar skillbar');
      this.rows.push({ id, lvl, fill: el(bar, 'fill'), label: el(bar, 'label') });
    }
    this.panel.style.display = 'none';
  }

  get dockEl() { return this.panel; }
  get isOpen() { return this.panel.style.display !== 'none'; }
  setOpen(on: boolean) { this.panel.style.display = on ? 'block' : 'none'; }
  toggle() { this.setOpen(!this.isOpen); }

  update(s: GameState) {
    if (!this.isOpen) return;
    const sum = totalLevel(s.player.skills);
    this.total.sum.textContent = `${sum} / ${GOAL}`;
    this.total.sum.classList.toggle('done', sum >= GOAL);
    this.total.fill.style.width = `${Math.min(1, sum / GOAL) * 100}%`;
    this.total.note.textContent = sum >= GOAL ? `Enough for the ${MOUNT.name}` : `${GOAL - sum} more for the ${MOUNT.name}`;
    for (const r of this.rows) {
      const t = s.player.skills[r.id], prog = levelProgress(t);
      r.lvl.textContent = String(t.level);
      r.fill.style.width = `${prog.frac * 100}%`;
      r.label.textContent = prog.needed ? `${prog.into} / ${prog.needed} XP` : 'MAX';
    }
  }
}

// Skills panel (DOM): every skill with its level and progress to the next. Reads GameState only.
import type { GameState } from './sim';
import { SKILL_IDS, SKILLS, SkillId, totalLevel } from './sim/skills';
import { mountById } from './sim/mounts';
import { levelProgress } from './sim/xp';
import { el } from './dom';

const GOAL = mountById('destrier')!.total!; // the one total level anything asks for: the second mount's
export class SkillsUi {
  private panel: HTMLElement;
  private total: HTMLElement;
  private rows: { id: SkillId; lvl: HTMLElement; fill: HTMLElement; label: HTMLElement }[] = [];

  constructor(root: HTMLElement) {
    this.panel = el(root, 'panel skillspanel');
    el(this.panel, 'ptitle', 'Skills  (K)');
    this.total = el(this.panel, 'skilltotal');
    this.total.title = `Highmoor's stablemaster wants a total level of ${GOAL}`;
    for (const id of SKILL_IDS) {
      const row = el(this.panel, 'skillrow');
      const head = el(row, 'skillhead');
      el(head, 'skillname', `${SKILLS[id].icon} ${SKILLS[id].name}`);
      const lvl = el(head, 'skilllvl');
      const bar = el(row, 'bar skillbar');
      this.rows.push({ id, lvl, fill: el(bar, 'fill'), label: el(bar, 'label') });
    }
    this.panel.style.display = 'none';
  }

  get isOpen() { return this.panel.style.display !== 'none'; }
  setOpen(on: boolean) { this.panel.style.display = on ? 'block' : 'none'; }
  toggle() { this.setOpen(!this.isOpen); }

  update(s: GameState) {
    if (!this.isOpen) return;
    this.total.textContent = `Total level ${totalLevel(s.player.skills)} / ${GOAL}`;
    for (const r of this.rows) {
      const t = s.player.skills[r.id], prog = levelProgress(t);
      r.lvl.textContent = String(t.level);
      r.fill.style.width = `${prog.frac * 100}%`;
      r.label.textContent = prog.needed ? `${prog.into} / ${prog.needed} XP` : 'MAX';
    }
  }
}

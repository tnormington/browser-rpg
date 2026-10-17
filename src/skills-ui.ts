// Skills panel (DOM): every skill with its level and progress to the next. Reads GameState only.
import type { GameState } from './sim';
import { SKILL_IDS, SKILLS, SkillId } from './sim/skills';
import { levelProgress } from './sim/xp';
import { el } from './dom';

export class SkillsUi {
  private panel: HTMLElement;
  private rows: { id: SkillId; lvl: HTMLElement; fill: HTMLElement; label: HTMLElement }[] = [];

  constructor(root: HTMLElement) {
    this.panel = el(root, 'panel skillspanel');
    el(this.panel, 'ptitle', 'Skills  (K)');
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

  toggle() { this.panel.style.display = this.panel.style.display === 'none' ? 'block' : 'none'; }

  update(s: GameState) {
    if (this.panel.style.display === 'none') return;
    for (const r of this.rows) {
      const t = s.player.skills[r.id], prog = levelProgress(t);
      r.lvl.textContent = String(t.level);
      r.fill.style.width = `${prog.frac * 100}%`;
      r.label.textContent = prog.needed ? `${prog.into} / ${prog.needed} XP` : 'MAX';
    }
  }
}

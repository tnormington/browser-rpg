// Talents panel (DOM): three trees side by side, a point per combat level. Reads GameState; changes go out as sim input.
import type { GameState } from './sim';
import { TALENTS, TIER_COST, TREES, TREE_IDS, TalentDef, learnBlocked, spentIn, spentTotal, talentPoints } from './sim/talents';
import { el } from './dom';

/** Why a rank cannot be bought, in the player's words. 'unknown' can only come from a bad id, so it needs no line. */
const WHY: Record<string, string> = {
  maxrank: 'Already at full rank',
  points: 'No talent points left: gain a combat level',
  tier: 'Spend more points in this tree first',
  combat: 'Not while you are in combat',
};

export class TalentsUi {
  private panel: HTMLElement;
  private points: HTMLElement;
  private body: HTMLElement;
  private cells = new Map<string, { root: HTMLElement; rank: HTMLElement }>();
  private sig = '';

  constructor(root: HTMLElement, private actions: { learn: (id: string) => void; reset: () => void }) {
    this.panel = el(root, 'panel talentpanel');
    const title = el(this.panel, 'ptitle', 'Talents  (N)');
    this.points = el(title, 'tpoints');
    this.body = el(this.panel, 'ttrees');
    for (const tree of TREE_IDS) {
      const col = el(this.body, 'ttree');
      col.dataset.tree = tree;
      const head = el(col, 'tthead');
      el(head, 'ttname', `${TREES[tree].icon} ${TREES[tree].name}`);
      el(head, 'ttspent', '0');
      el(col, 'ttblurb', TREES[tree].blurb);
      for (const def of TALENTS.filter(t => t.tree === tree)) {
        const cell = el(col, 'talent');
        el(cell, 'tlname', def.name);
        const rank = el(cell, 'tlrank');
        cell.addEventListener('click', () => this.actions.learn(def.id));
        this.cells.set(def.id, { root: cell, rank });
      }
    }
    el(this.panel, 'dopt treset', '↺ Unlearn everything').addEventListener('click', () => this.actions.reset());
    this.panel.style.display = 'none';
  }

  get isOpen() { return this.panel.style.display !== 'none'; }
  toggle() { this.panel.style.display = this.isOpen ? 'none' : 'block'; this.sig = ''; }

  update(s: GameState) {
    if (!this.isOpen) return;
    const p = s.player;
    // rebuild only when something it shows changed, so hovering a talent stays stable
    const sig = JSON.stringify([p.talents, p.combat.level, p.inCombat]);
    if (sig === this.sig) return;
    this.sig = sig;

    const left = talentPoints(p.combat.level) - spentTotal(p.talents);
    this.points.textContent = left > 0 ? `${left} point${left > 1 ? 's' : ''} to spend` : 'no points left';
    this.points.className = `tpoints${left > 0 ? ' ready' : ''}`;
    for (const tree of TREE_IDS) {
      const col = this.body.querySelector<HTMLElement>(`[data-tree="${tree}"] .ttspent`)!;
      col.textContent = String(spentIn(p.talents, tree));
    }
    for (const def of TALENTS) {
      const cell = this.cells.get(def.id)!;
      const taken = p.talents[def.id] ?? 0;
      const why = p.inCombat ? 'combat' : learnBlocked(p.talents, p.combat.level, def.id);
      cell.rank.textContent = `${taken} / ${def.ranks}`;
      cell.root.classList.toggle('taken', taken > 0);
      cell.root.classList.toggle('shut', !!why);
      cell.root.title = this.tooltip(def, taken, why);
    }
  }

  /** What the talent does at the rank you hold and the rank you would buy, plus why you cannot buy it. */
  private tooltip(def: TalentDef, taken: number, why: string | null): string {
    const lines = [`${def.name}  (rank ${taken} of ${def.ranks})`];
    if (taken > 0) lines.push(def.desc(taken));
    if (taken < def.ranks) lines.push(`${taken > 0 ? 'Next rank' : 'Rank 1'}: ${def.desc(taken + 1)}`);
    if (TIER_COST[def.tier] > 0) lines.push(`Needs ${TIER_COST[def.tier]} points spent in ${TREES[def.tree].name}.`);
    lines.push(why ? WHY[why] ?? 'Unavailable' : 'Click to spend a point.');
    return lines.join('\n');
  }
}

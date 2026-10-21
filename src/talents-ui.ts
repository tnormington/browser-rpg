// Talents panel (DOM): three trees side by side, a point per combat level. Reads GameState; changes go out as sim input.
// A tree is a stack of tiers, two talents abreast, with the capstone alone at the bottom: the shape on screen is the
// shape of the choice, and a talent that is built on another says so on its face rather than only in its tooltip.
import type { GameState } from './sim';
import { TALENTS, TIER_COST, TREES, TREE_IDS, TalentDef, Talents, learnBlocked, prereqMet, spentIn, spentTotal, talentById, talentPoints } from './sim/talents';
import { el } from './dom';
import { paintArt, talentArt } from './art';

/** Why a rank cannot be bought, in the player's words. 'unknown' can only come from a bad id, so it needs no line. */
const WHY: Record<string, string> = {
  maxrank: 'Already at full rank',
  points: 'No talent points left: gain a combat level',
  tier: 'Spend more points in this tree first',
  prereq: 'Take the talent it is built on to full rank first',
  combat: 'Not while you are in combat',
};

export class TalentsUi {
  private panel: HTMLElement;
  private points: HTMLElement;
  private body: HTMLElement;
  private cells = new Map<string, { root: HTMLElement; rank: HTMLElement; req: HTMLElement | null }>();
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
      TIER_COST.forEach((cost, tier) => {
        const row = TALENTS.filter(t => t.tree === tree && t.tier === tier);
        if (!row.length) return;
        if (cost > 0) el(col, 'ttiermark', `${cost} points`);
        const rowEl = el(col, `ttier${row.length === 1 ? ' cap' : ''}`);
        for (const def of row) {
          const cell = el(rowEl, 'talent');
          // The node's picture, above its words rather than beside them: a node is 96px wide inside and
          // Counterstrike alone is 79px of that, so there is no icon size that shares the line. A talent
          // with no art drawn keeps the empty square rather than reflowing the row, so one missing file
          // does not shuffle the tree out of line.
          paintArt(el(cell, 'tlicon'), talentArt(def.id));
          el(cell, 'tlname', def.name);
          const rank = el(cell, 'tlrank');
          const req = def.prereq ? el(cell, 'tlreq', `needs ${talentById(def.prereq)!.name}`) : null;
          cell.addEventListener('click', () => this.actions.learn(def.id));
          this.cells.set(def.id, { root: cell, rank, req });
        }
      });
    }
    el(this.panel, 'btn block dopt treset', '↺ Unlearn everything').addEventListener('click', () => this.actions.reset());
    this.panel.style.display = 'none';
  }

  get dockEl() { return this.panel; }
  get isOpen() { return this.panel.style.display !== 'none'; }
  setOpen(on: boolean) { this.panel.style.display = on ? 'block' : 'none'; this.sig = ''; }
  toggle() { this.setOpen(!this.isOpen); }

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
      cell.req?.classList.toggle('bad', !prereqMet(p.talents, def));
      cell.root.title = this.tooltip(def, taken, why, p.talents);
    }
  }

  /** What the talent does at the rank you hold and the rank you would buy, what it is built on, plus why you cannot buy it. */
  private tooltip(def: TalentDef, taken: number, why: string | null, held: Talents): string {
    const lines = [`${def.name}  (rank ${taken} of ${def.ranks})`];
    if (taken > 0) lines.push(def.desc(taken));
    if (taken < def.ranks) lines.push(`${taken > 0 ? 'Next rank' : 'Rank 1'}: ${def.desc(taken + 1)}`);
    if (TIER_COST[def.tier] > 0) lines.push(`Needs ${TIER_COST[def.tier]} points spent in ${TREES[def.tree].name}.`);
    if (def.prereq) {
      const on = talentById(def.prereq)!;
      lines.push(`Needs ${on.name} at ${on.ranks} / ${on.ranks}${prereqMet(held, def) ? '' : ` (you have ${held[def.prereq] ?? 0})`}.`);
    }
    lines.push(why ? WHY[why] ?? 'Unavailable' : 'Click to spend a point.');
    return lines.join('\n');
  }
}

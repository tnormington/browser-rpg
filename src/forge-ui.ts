// Forge panel (DOM): recipe list with inputs, level requirement and output. Reads GameState;
// crafting goes out as a sim craft request only.
import type { GameState } from './sim';
import { RECIPES, hasInputs, nearForge, FORGE_REACH } from './sim/crafting';
import { SKILLS } from './sim/skills';
import { ITEMS, TIER_COLORS, describeStats } from './sim/items';
import { countItem } from './sim/inventory';
import { LANDMARKS } from './sim/world';
import { el } from './dom';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class ForgeUi {
  private panel: HTMLElement;
  private list: HTMLElement;
  private open = false;
  private sig = '';

  constructor(root: HTMLElement, private craft: (recipe: string, count: number) => void) {
    this.panel = el(root, 'panel forgepanel');
    const title = el(this.panel, 'ptitle', 'Forge');
    const close = el(title, 'pclose', '✕');
    close.addEventListener('click', () => this.setOpen(false));
    this.list = el(this.panel, 'recipes');
    this.panel.style.display = 'none';
  }

  setOpen(on: boolean) {
    this.open = on;
    this.panel.style.display = on ? 'block' : 'none';
    this.sig = '';
  }

  update(s: GameState) {
    if (this.open && (s.player.dead || !nearForgeWithSlack(s))) this.setOpen(false);
    if (!this.open) return;
    const p = s.player;
    const sig = JSON.stringify([RECIPES.map(r => r.inputs.map(i => countItem(p.inventory, i.id))), p.skills.smithing.level, p.action?.k]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.list.textContent = '';
    for (const r of RECIPES) {
      const out = ITEMS[r.output.id];
      const lvlOk = p.skills[r.skill].level >= r.level, matsOk = hasInputs(s, r), can = lvlOk && matsOk;
      const row = el(this.list, `recipe${can ? '' : ' locked'}`);
      row.title = [out.desc, ...describeStats(out)].join('\n');
      const head = el(row, 'rhead');
      const name = el(head, 'rname', `${r.output.qty > 1 ? r.output.qty + 'x ' : ''}${r.name}`);
      name.style.color = hex(TIER_COLORS[out.tier]);
      const req = el(head, `rreq${lvlOk ? '' : ' bad'}`, `${SKILLS[r.skill].name} ${r.level}`);
      req.title = lvlOk ? '' : `You need ${SKILLS[r.skill].name} level ${r.level}`;
      for (const line of describeStats(out)) el(row, 'rstat', line);
      const inputs = el(row, 'rinputs');
      for (const i of r.inputs) {
        const have = countItem(p.inventory, i.id);
        el(inputs, `rin${have >= i.qty ? '' : ' bad'}`, `${ITEMS[i.id].name} ${have}/${i.qty}`);
      }
      el(row, 'rmeta', `${r.time}s  ·  ${r.xp} ${SKILLS[r.skill].name} XP`);
      const btns = el(row, 'rbtns');
      for (const [label, count] of [['Make', 1], ['Make all', 99]] as const) {
        const b = el(btns, `rbtn${can ? '' : ' off'}`, label);
        b.addEventListener('click', () => this.craft(r.id, count));
      }
    }
  }
}

/** Panel stays open a little beyond crafting reach so it doesn't flicker at the edge. */
const nearForgeWithSlack = (s: GameState) => nearForge(s) || Math.hypot(s.player.x - LANDMARKS.forge.x, s.player.z - LANDMARKS.forge.z) <= FORGE_REACH + 1.5;

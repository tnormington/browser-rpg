// HUD: DOM overlay. Reads GameState and sim events; never mutates sim state.
import { GameState, GameEvent } from './sim';
import { ABILITIES, ENEMY_TYPES, GCD } from './sim/data';
import { levelProgress } from './sim/xp';

type Project = (x: number, y: number, z: number) => { x: number; y: number } | null;

const ICONS = ['⚔', '🔨', '🗡', '❤'];
const FAIL_TEXT = {
  range: 'Out of range', cooldown: 'Not ready yet', gcd: 'Not ready yet',
  energy: 'Not enough energy', target: 'No target',
} as const;

function el(parent: HTMLElement, cls: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  parent.appendChild(d);
  return d;
}

function bar(parent: HTMLElement, cls: string) {
  const outer = el(parent, `bar ${cls}`);
  const fill = el(outer, 'fill');
  const label = el(outer, 'label');
  return { fill, label };
}

interface Floater { el: HTMLElement; x: number; y: number; z: number; age: number; drift: number }

export class Hud {
  private root = el(document.body, 'hud');
  private playerLvl: HTMLElement;
  private hp: ReturnType<typeof bar>;
  private energy: ReturnType<typeof bar>;
  private xp: ReturnType<typeof bar>;
  private targetFrame: HTMLElement;
  private targetName: HTMLElement;
  private targetHp: ReturnType<typeof bar>;
  private slots: { root: HTMLElement; sweep: HTMLElement; cdText: HTMLElement }[] = [];
  private msg: HTMLElement;
  private banner: HTMLElement;
  private deathOverlay: HTMLElement;
  private plates = new Map<number, { root: HTMLElement; fill: HTMLElement }>();
  private floaters: Floater[] = [];
  private msgAge = 99;

  constructor(private project: Project) {
    const pf = el(this.root, 'frame player');
    this.playerLvl = el(pf, 'name');
    this.hp = bar(pf, 'hp');
    this.energy = bar(pf, 'energy');

    this.targetFrame = el(this.root, 'frame target');
    this.targetName = el(this.targetFrame, 'name');
    this.targetHp = bar(this.targetFrame, 'enemyhp');

    this.xp = bar(this.root, 'xp');

    const ab = el(this.root, 'actionbar');
    ABILITIES.forEach((a, i) => {
      const root = el(ab, 'slot');
      root.title = `${a.name}: ${a.desc}`;
      el(root, 'icon', ICONS[i]);
      el(root, 'key', String(i + 1));
      el(root, 'aname', a.name);
      const sweep = el(root, 'sweep');
      const cdText = el(root, 'cdtext');
      this.slots.push({ root, sweep, cdText });
    });

    this.msg = el(this.root, 'msg');
    this.banner = el(this.root, 'banner');
    this.deathOverlay = el(this.root, 'death');
  }

  onEvents(events: GameEvent[], s: GameState) {
    for (const ev of events) {
      if (ev.t === 'hit') {
        const toPlayer = ev.target === 'player';
        const cls = toPlayer ? 'dmg-in' : ev.dot ? 'dmg-dot' : ev.crit ? 'dmg-crit' : 'dmg-out';
        this.float(`${ev.amount}${ev.crit ? '!' : ''}`, cls, ev.x, toPlayer ? 2.6 : 2.4, ev.z);
      } else if (ev.t === 'heal') {
        if (ev.amount > 0) this.float(`+${ev.amount}`, 'heal', ev.x, 2.6, ev.z);
      } else if (ev.t === 'xp') {
        this.float(`+${ev.amount} XP`, 'xpgain', ev.x, 3.2, ev.z);
      } else if (ev.t === 'fail') {
        if (ev.reason === 'gcd') continue; // too noisy while mashing; the sweep already shows it
        this.say(FAIL_TEXT[ev.reason]);
      } else if (ev.t === 'levelup') {
        this.banner.textContent = `LEVEL UP!  Combat ${ev.level}`;
        this.banner.classList.remove('show');
        void this.banner.offsetWidth; // restart the CSS animation
        this.banner.classList.add('show');
      }
    }
    void s;
  }

  private say(text: string) {
    this.msg.textContent = text;
    this.msgAge = 0;
  }

  private float(text: string, cls: string, x: number, y: number, z: number) {
    const d = el(this.root, `floater ${cls}`, text);
    this.floaters.push({ el: d, x, y, z, age: 0, drift: (Math.random() - 0.5) * 40 });
  }

  update(s: GameState, dtSeconds: number) {
    const p = s.player;
    this.playerLvl.textContent = `Adventurer  Lv ${p.combat.level}`;
    this.setBar(this.hp, p.hp / p.maxHp, `${Math.ceil(p.hp)} / ${p.maxHp}`);
    this.setBar(this.energy, p.energy / p.maxEnergy, `${Math.floor(p.energy)}`);
    const prog = levelProgress(p.combat);
    this.setBar(this.xp, prog.frac, `Combat ${p.combat.level}  -  ${prog.into} / ${prog.needed} XP`);

    const t = s.targetId === null ? undefined : s.enemies.find(e => e.id === s.targetId);
    this.targetFrame.style.display = t ? 'block' : 'none';
    if (t) {
      const def = ENEMY_TYPES[t.type];
      this.targetName.textContent = `${def.name}  Lv ${def.level}`;
      this.targetName.className = `name ${def.level > p.combat.level + 2 ? 'hard' : ''}`;
      this.setBar(this.targetHp, t.hp / t.maxHp, `${Math.ceil(t.hp)} / ${t.maxHp}`);
    }

    // action bar: cooldown sweeps (GCD shows on every slot), energy and range tint
    ABILITIES.forEach((a, i) => {
      const slot = this.slots[i];
      const cd = p.cd[i];
      const remaining = Math.max(cd, p.gcd);
      const total = cd > p.gcd ? a.cooldown : GCD;
      const frac = remaining > 0 ? remaining / total : 0;
      slot.sweep.style.background = frac > 0
        ? `conic-gradient(rgba(0,0,0,0.65) ${frac * 360}deg, transparent 0)` : 'none';
      slot.cdText.textContent = cd > 0.05 ? (cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1)) : '';
      const noEnergy = p.energy < a.cost;
      const outOfRange = !!t && a.range > 0 && Math.hypot(t.x - p.x, t.z - p.z) > a.range;
      slot.root.classList.toggle('noenergy', noEnergy);
      slot.root.classList.toggle('outrange', outOfRange);
      slot.root.classList.toggle('queued', p.queued === i);
    });

    // nameplates
    const seen = new Set<number>();
    for (const e of s.enemies) {
      const visible = e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < 28;
      const scr = visible ? this.project(e.x, ENEMY_TYPES[e.type].radius * 2 + (e.type === 'brute' ? 1.6 : 0.9), e.z) : null;
      if (!scr) continue;
      seen.add(e.id);
      let plate = this.plates.get(e.id);
      if (!plate) {
        const root = el(this.root, 'plate');
        const def = ENEMY_TYPES[e.type];
        el(root, 'pname', `${def.name} ${def.level}`);
        plate = { root, fill: el(el(root, 'pbar'), 'fill') };
        this.plates.set(e.id, plate);
      }
      plate.root.style.display = 'block';
      plate.root.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -100%)`;
      plate.fill.style.width = `${(e.hp / e.maxHp) * 100}%`;
      plate.root.classList.toggle('sel', e.id === s.targetId);
    }
    for (const [id, plate] of this.plates) if (!seen.has(id)) plate.root.style.display = 'none';

    // floating numbers
    this.floaters = this.floaters.filter(f => {
      f.age += dtSeconds;
      const scr = f.age < 1.1 ? this.project(f.x, f.y, f.z) : null;
      if (!scr) { f.el.remove(); return false; }
      const rise = f.age * 55, k = Math.min(1, f.age * 6);
      f.el.style.transform = `translate(${scr.x + f.drift * f.age}px, ${scr.y - rise}px) translate(-50%, -50%) scale(${0.6 + 0.4 * k})`;
      f.el.style.opacity = String(Math.min(1, (1.1 - f.age) * 3));
      return true;
    });

    this.msgAge += dtSeconds;
    this.msg.style.opacity = String(Math.max(0, Math.min(1, 1.6 - this.msgAge * 1.5)));

    this.deathOverlay.style.display = p.dead ? 'flex' : 'none';
    if (p.dead) this.deathOverlay.textContent = `You died.  Waking at the clearing in ${Math.ceil(p.respawnIn)}...`;
  }

  private setBar(b: { fill: HTMLElement; label: HTMLElement }, frac: number, text: string) {
    b.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    b.label.textContent = text;
  }
}

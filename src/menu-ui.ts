// First-run controls overlay (re-openable with H) and the small menu: help, save now, new game (wipes the save).
import { el } from './dom';
import type { Quality } from './post';
import { helpSeen, markHelpSeen } from './storage';
import { ECHO_STEPS, echoUnlocked, type EchoSetting } from './sim/echo';
import type { GameState } from './sim';

/** What each setting is worth (docs/combat-99.md 3.4): the XP against Standard, and the health an Echo's fight costs against it. */
const ECHO_ROWS: { to: EchoSetting; label: string; mult?: string; tip: string }[] = [
  { to: null, label: 'Off', tip: 'The world as it was authored.' },
  { to: -3, label: 'Easy', mult: '0.66x', tip: 'Echoes stand 3 levels under you: 0.66x the XP of Standard, for 9 to 13 % less health cost.' },
  { to: 0, label: 'Standard', mult: '1x', tip: 'Echoes stand at your level: the XP the fight is balanced around.' },
  { to: 3, label: 'Hard', mult: '1.49x', tip: 'Echoes stand 3 levels over you: 1.49x the XP of Standard, for 10 to 17 % more health cost.' },
];

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move (relative to the camera). The keys are the only thing that moves you: clicking the ground never does'],
  ['Left-drag', 'Swing the camera round yourself; you keep facing where you were'],
  ['Right-drag', 'Swing the camera and turn to face it'],
  ['Both buttons', 'Steer with the camera and run the way it looks'],
  ['Wheel', 'Zoom in and out'],
  ['V or click NPC', 'Talk to a quest giver'],
  ['Tab / click enemy', 'Target an enemy (Esc clears)'],
  ['X', 'Auto-attack on / off (the bar above the action bar is your swing timer). Strike and Cleave start it too.'],
  ['Space', 'Jump (hold to keep hopping). Agility leaves the ground harder, so the hop grows with the skill.'],
  ['Shift', 'Sprint: run half as fast again while the stamina bar under your energy drains. Running flat out is what levels Agility, and Agility is how long the bar lasts.'],
  ['B', 'Dodge-roll: a short burst along the ground that nothing can touch you during, paid for out of the same stamina bar. Not in the saddle, and not while a net holds you.'],
  ['Z', 'Mount up or dismount: a 1 second cast standing still, not in combat. Any hit or ability throws you off. The stablemasters in Thornwick and Highmoor sell the horses.'],
  ['1 2 3 4 5 6 Q E R F T 7 8', 'Your action bar, as it starts out. Abilities unlock as you level, trainers sell some, and three come from the capstone talents; P re-arranges them.'],
  ['Click a slot\'s key', 'Rebind that slot: the next key you press becomes its own. Backspace leaves it with no key, Esc keeps the one it has.'],
  ['Drag a food onto a slot', 'A bar slot can hold a food or potion as well as a spell: it shows how many are left and eats one when you press its key.'],
  ['P', 'Spell book: every spell you know. Drag one onto the bar, right-click a slot to clear it.'],
  ['Pummel', 'Interrupts an enemy wind-up. Or step out of the red circle.'],
  ['Click rock / tree', 'Mine or chop it, once you are standing next to it'],
  ['Click a fishing shoal', 'Fish it (Saltmarrow, the quay and the Strand)'],
  ['Click an herb patch', 'Pick it: Marrowleaf by the alembic in Thornwick, Fenbloom in the Fens, Thornmint in the Thornwood'],
  ['Click the forge / range / alembic / rack', 'Smith bars and weapons / cook fish at the inn / brew a potion from a herb and a vial (the provisioner sells vials) / tan hides and make gloves and boots in Highmoor'],
  ['G', 'Eat the best food in your bag: heals over 5 seconds, a hit spoils it, one food every 20 s. Pies make you Well Fed out of combat.'],
  ['I   C   K', 'Inventory + equipment, Character, Skills'],
  ['J', 'World map: where the towns are, and which flight masters you have found'],
  ['Click a flight master', 'Fly to a town you have walked to, for gold (not in combat). Space skips the ride after 3 seconds.'],
  ['Right-click item', 'Drop it on the ground, destroy it, or sell it when at the merchant'],
  ['Click the merchant', 'Buy gear; shift-click a bag item to sell the stack on the spot'],
  ['N', 'Talents: a point per combat level, spent in three trees, changing what your abilities do. Out of combat only; unlearning is free.'],
  ['A drop on the ground', 'Walk over it and it goes in your bag'],
  ['Esc', 'Close every open window; with none open, drop your target'],
  ['H', 'This help'],
  ['M', 'Mute sound'],
];

export class MenuUi {
  private overlay: HTMLElement;
  private echoRow: HTMLElement;
  private echoBtns = new Map<EchoSetting, HTMLElement>();

  constructor(root: HTMLElement, actions: { save: () => void; newGame: () => void; quality: (toggle: boolean) => Quality; echo: (to: EchoSetting) => void }) {
    this.overlay = el(root, 'panel helpoverlay');
    el(this.overlay, 'helptitle', 'Welcome to the Clearing');
    el(this.overlay, 'helpgoal', 'Talk to Warden Hale, hunt, mine, forge a blade, and slay the Cave Brute. Your quest tracker (top left) always shows the next step and an arrow to follow.');
    const grid = el(this.overlay, 'helpgrid');
    for (const [k, v] of CONTROLS) { el(grid, 'hkey', k); el(grid, 'hdesc', v); }
    el(this.overlay, 'helpnote', 'Progress saves automatically. Use the buttons at the bottom right to save now or start over.');
    const ok = el(this.overlay, 'btn block dopt helpok', '▸ Got it (click, Esc or H)');
    ok.addEventListener('click', () => this.setOpen(false));
    this.overlay.style.display = 'none';

    const bar = el(root, 'menubar');
    for (const [label, fn] of [['? Help (H)', () => this.toggle()], ['Save', actions.save], ['New Game', actions.newGame]] as const) {
      el(bar, 'btn mbtn', label).addEventListener('click', fn);
    }
    this.echoRow = el(bar, 'echorow');
    this.echoRow.style.display = 'none'; // until the Seal is broken (quest.eighth done)
    const label = el(this.echoRow, 'echolabel', 'Echoes:');
    label.title = 'Enemies that respawn as copies of themselves at your level, from their next respawn on.';
    for (const { to, label: text, mult, tip } of ECHO_ROWS) {
      const b = el(this.echoRow, 'btn mbtn echoopt');
      el(b, 'echoname', text);
      if (mult) el(b, 'echomult', mult);
      b.title = tip;
      b.addEventListener('click', () => actions.echo(to));
      this.echoBtns.set(to, b);
    }
    // the XP bar ends where the menu bar begins, whatever the bar holds (the Echo row makes it twice as long)
    new ResizeObserver(() => root.style.setProperty('--menu-w', `${bar.offsetWidth}px`)).observe(bar);
    const quality = el(bar, 'btn mbtn', '');
    quality.title = 'Graphics quality: High has bloom, ambient occlusion and a colour grade; Low renders straight to the screen';
    const showQuality = (toggle: boolean) => { quality.textContent = `Graphics: ${actions.quality(toggle) === 'high' ? 'High' : 'Low'}`; };
    quality.addEventListener('click', () => showQuality(true));
    showQuality(false);

    if (!helpSeen()) this.setOpen(true);
  }

  get isOpen() { return this.overlay.style.display !== 'none'; }

  setOpen(on: boolean) {
    this.overlay.style.display = on ? 'block' : 'none';
    if (!on) markHelpSeen();
  }

  toggle() { this.setOpen(!this.isOpen); }

  /** The Echo row shows once the Seal is broken and marks the setting the sim holds. It only reads: a click sends the sim an input. */
  update(s: GameState) {
    const on = echoUnlocked(s);
    this.echoRow.style.display = on ? 'flex' : 'none';
    if (!on) return;
    for (const to of ECHO_STEPS) {
      const b = this.echoBtns.get(to)!, sel = to === s.player.echo;
      b.classList.toggle('sel', sel);
      b.setAttribute('aria-pressed', String(sel));
    }
  }
}

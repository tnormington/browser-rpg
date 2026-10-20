// First-run controls overlay (re-openable with H) and the small menu: help, save now, new game (wipes the save).
import { el } from './dom';
import type { Quality } from './post';
import { helpSeen, markHelpSeen } from './storage';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move (relative to the camera)'],
  ['Left-drag', 'Swing the camera round yourself; you keep facing where you were'],
  ['Right-drag', 'Swing the camera and turn to face it'],
  ['Both buttons', 'Steer with the camera and run the way it looks'],
  ['Wheel', 'Zoom in and out'],
  ['V or click NPC', 'Talk to a quest giver'],
  ['Tab / click enemy', 'Target an enemy (Esc clears)'],
  ['X', 'Auto-attack on / off (the bar above the action bar is your swing timer). Strike and Cleave start it too.'],
  ['Space', 'Jump (hold to keep hopping)'],
  ['Z', 'Mount up or dismount: a 1 second cast standing still, not in combat. Any hit or ability throws you off. The stablemasters in Thornwick and Highmoor sell the horses.'],
  ['1 2 3 4 5 6 Q E R F T 7 8', 'Your action bar. Abilities unlock as you level, trainers sell some, and three come from the capstone talents; P re-arranges them.'],
  ['P', 'Spell book: every spell you know. Drag one onto the bar, right-click a slot to clear it.'],
  ['Pummel', 'Interrupts an enemy wind-up. Or step out of the red circle.'],
  ['Click rock / tree', 'Mine or chop it (walks there first)'],
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
  ['Click a drop', 'Walk over and pick it up'],
  ['Esc', 'Close every open window; with none open, drop your target'],
  ['H', 'This help'],
  ['M', 'Mute sound'],
];

export class MenuUi {
  private overlay: HTMLElement;

  constructor(root: HTMLElement, actions: { save: () => void; newGame: () => void; quality: (toggle: boolean) => Quality }) {
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
}

// First-run controls overlay (re-openable with H) and the small menu: help, save now, new game (wipes the save).
import { el } from './dom';
import type { Quality } from './post';
import { helpSeen, markHelpSeen } from './storage';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move (relative to the camera)'],
  ['Click ground', 'Walk there'],
  ['Drag / wheel', 'Orbit and zoom the camera'],
  ['E or click NPC', 'Talk to a quest giver'],
  ['Tab / click enemy', 'Target an enemy (Esc clears)'],
  ['R', 'Auto-attack on / off (the bar above the action bar is your swing timer). Strike and Cleave start it too.'],
  ['Space', 'Jump (hold to keep hopping)'],
  ['1 - 6', 'Abilities: Strike, Crushing Blow, Serrated Throw, Second Wind, Cleave, Pummel. They unlock as you level.'],
  ['Pummel (6)', 'Interrupts an enemy wind-up. Or step out of the red circle.'],
  ['Click rock / tree', 'Mine or chop it (walks there first)'],
  ['Click a fishing shoal', 'Fish it (Saltmarrow, the quay and the Strand)'],
  ['Click the forge / range', 'Smith bars and weapons / cook fish at the inn'],
  ['F', 'Eat the best food in your bag: heals over 5 seconds, a hit spoils it, one food every 20 s. Pies make you Well Fed out of combat.'],
  ['I   C   K', 'Inventory + equipment, Character, Skills'],
  ['J', 'World map: where the towns are, and which flight masters you have found'],
  ['Click a flight master', 'Fly to a town you have walked to, for gold (not in combat). Space skips the ride after 3 seconds.'],
  ['Right-click item', 'Drop it on the ground, destroy it, or sell it when at the merchant'],
  ['Click the merchant', 'Buy gear; right-click bag items to sell'],
  ['N', 'Talents: a point per combat level, spent in three trees, changing what your six abilities do. Out of combat only; unlearning is free.'],
  ['Click a drop', 'Walk over and pick it up'],
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
    const ok = el(this.overlay, 'dopt helpok', '▸ Got it (click, Esc or H)');
    ok.addEventListener('click', () => this.setOpen(false));
    this.overlay.style.display = 'none';

    const bar = el(root, 'menubar');
    for (const [label, fn] of [['? Help (H)', () => this.toggle()], ['Save', actions.save], ['New Game', actions.newGame]] as const) {
      el(bar, 'mbtn', label).addEventListener('click', fn);
    }
    const quality = el(bar, 'mbtn', '');
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

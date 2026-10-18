// First-run controls overlay (re-openable with H) and the small menu: help, save now, new game (wipes the save).
import { el } from './dom';
import type { Quality } from './post';
import { helpSeen, markHelpSeen } from './storage';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move (relative to the camera)'],
  ['Click ground', 'Walk there'],
  ['Drag / wheel', 'Orbit and zoom the camera'],
  ['E or click NPC', 'Talk to Warden Hale'],
  ['Tab / click enemy', 'Target an enemy (Esc clears)'],
  ['1  2  3  4', 'Strike, Crushing Blow, Serrated Throw, Second Wind'],
  ['Click rock / tree', 'Mine or chop it (walks there first)'],
  ['Click the forge', 'Smith bars and weapons'],
  ['I   C   K', 'Inventory + equipment, Character, Skills'],
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

// The dock: the one area of the screen the HUD's windows (bag, sheet, skills, talents, spell book, the stations, shops, a dialogue) open in.
// It is the free rectangle between the rail (quest tracker + message log) and the minimap, and above the unit frames, so a window in it can print over
// none of them. Windows are flex items, laid side by side and bounded by the dock's height, so two of them cannot print over each other either.
// What the layout cannot do is make a narrow window wider: settle() answers that by docking the HUD (the rail steps aside while windows are open),
// and if the windows still do not fit, shutting the one that has been open longest. At 1600 wide nothing is ever shut; at 800 the bag and the sheet
// stay together and anything else replaces what was open. Geometry (where the rectangle is) is CSS: .dock and .hud.docked in index.html.
import { DockWindow, el } from './dom';

export class Dock {
  readonly el: HTMLElement;
  /** The open windows, oldest first: the front of the line is what shuts when they do not all fit. */
  private opened: DockWindow[] = [];
  private sig = '';

  constructor(private hud: HTMLElement) {
    this.el = el(hud, 'dock');
  }

  /** Call each frame (and after a key opens a window): lays the open windows out, doing real work only when they or the window's size changed. */
  settle(windows: readonly DockWindow[]) {
    const open = windows.filter(w => w.isOpen);
    const sig = `${open.map(w => windows.indexOf(w))}|${innerWidth}x${innerHeight}`;
    if (sig === this.sig) return;
    this.opened = this.opened.filter(w => open.includes(w)).concat(open.filter(w => !this.opened.includes(w)));
    for (;;) {
      this.hud.classList.remove('docked');
      if (this.fits()) break;
      this.hud.classList.add('docked');
      if (this.fits() || this.opened.length < 2) break; // a lone window wider than the dock is held to it by CSS (max-width) and scrolls
      this.opened.shift()!.setOpen(false);
    }
    this.sig = `${this.opened.map(w => windows.indexOf(w)).sort((a, b) => a - b)}|${innerWidth}x${innerHeight}`;
  }

  /** Whether the open windows fit across the dock at the widths they ask for (.measure lifts the CSS clamp, which would make any one of them look as if it fits). */
  private fits() {
    this.el.classList.add('measure');
    const gap = parseFloat(getComputedStyle(this.el).columnGap) || 0;
    const need = this.opened.reduce((n, w) => n + w.dockEl.offsetWidth, 0) + gap * Math.max(0, this.opened.length - 1);
    this.el.classList.remove('measure');
    return need <= this.el.clientWidth;
  }
}

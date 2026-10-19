// Tiny DOM helper shared by the M3 panels.

/** A HUD window Esc can shut. Every panel class exposes one (or, for the inventory, one per panel). */
export interface HudWindow {
  readonly isOpen: boolean;
  setOpen(on: boolean): void;
}

/** A HudWindow backed by nothing but a panel's display. */
export const panelWindow = (panel: HTMLElement): HudWindow => ({
  get isOpen() { return panel.style.display !== 'none'; },
  setOpen(on: boolean) { panel.style.display = on ? 'block' : 'none'; },
});

export function el(parent: HTMLElement, cls: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  parent.appendChild(d);
  return d;
}

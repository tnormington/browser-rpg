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

/** A panel's title row with the ✕ that shuts it. Returns the row, so a panel can add to it or retitle it. */
export function titleRow(panel: HTMLElement, text: string, close?: () => void): HTMLDivElement {
  const head = el(panel, 'ptitle', text);
  if (close) el(head, 'pclose', '✕').addEventListener('click', close);
  return head;
}

/** The button a list row offers (Make, Buy, Learn, Fly, Repair): `.btn.pri`, greyed out by `.off` when it cannot be used now. `.rbtn` is the hook the benches select on. */
export const actionButton = (parent: HTMLElement, label: string, can = true) => el(parent, `btn pri rbtn${can ? '' : ' off'}`, label);

// Tiny DOM helper shared by the M3 panels.

/** A HUD window Esc can shut. Every panel class exposes one (or, for the inventory, one per panel). */
export interface HudWindow {
  readonly isOpen: boolean;
  setOpen(on: boolean): void;
}

/** A HudWindow that lives in the dock (dock.ts): `dockEl` is the panel the dock measures and lays out. */
export interface DockWindow extends HudWindow {
  readonly dockEl: HTMLElement;
}

/** A DockWindow backed by nothing but a panel's display. */
export const panelWindow = (panel: HTMLElement): DockWindow => ({
  get isOpen() { return panel.style.display !== 'none'; },
  setOpen(on: boolean) { panel.style.display = on ? 'block' : 'none'; },
  dockEl: panel,
});

export function el(parent: HTMLElement, cls: string, text = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  parent.appendChild(d);
  return d;
}

/**
 * What a HUD drag carries, in one format every panel can read: a bag slot (with what is in it, so a drop
 * does not have to go back to the bag to find out), a spell from the book, or a slot of the action bar.
 */
export type DragPayload = { k: 'bag'; slot: number; id: string } | { k: 'spell'; i: number } | { k: 'bar'; slot: number };

export const dragData = (p: DragPayload) => p.k === 'bag' ? `bag:${p.slot}:${p.id}` : p.k === 'spell' ? `spell:${p.i}` : `bar:${p.slot}`;

export function parseDrag(raw: string): DragPayload | null {
  const [kind, n, id] = raw.split(':');
  const i = Number(n);
  if (!Number.isInteger(i) || i < 0) return null;
  if (kind === 'bag') return id ? { k: 'bag', slot: i, id } : null;
  if (kind === 'spell') return { k: 'spell', i };
  if (kind === 'bar') return { k: 'bar', slot: i };
  return null;
}

/** A panel's title row with the ✕ that shuts it. Returns the row, so a panel can add to it or retitle it. */
export function titleRow(panel: HTMLElement, text: string, close?: () => void): HTMLDivElement {
  const head = el(panel, 'ptitle', text);
  if (close) el(head, 'pclose', '✕').addEventListener('click', close);
  return head;
}

/** The button a list row offers (Make, Buy, Learn, Fly, Repair): `.btn.pri`, greyed out by `.off` when it cannot be used now. `.rbtn` is the hook the benches select on. */
export const actionButton = (parent: HTMLElement, label: string, can = true) => el(parent, `btn pri rbtn${can ? '' : ' off'}`, label);

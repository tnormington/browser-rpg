// Flight panels (DOM): the flight master's destination list, the world-map screen, and the ride's caption.
// Read GameState only; the one thing they ask of the sim is a flight, through the callbacks main.ts gives them.
import type { GameState } from './sim';
import { TOWNS } from './sim/world';
import { FLIGHT_REACH, destinationsFrom, masterById } from './sim/flight';
import { el } from './dom';

const secs = (n: number) => `${Math.round(n)} s`;

/** The flight master's panel: where you can go and what it costs. Opens when the master is clicked, closes when you walk off. */
export class FlightUi {
  private panel: HTMLElement;
  private titleEl: HTMLElement;
  private goldEl: HTMLElement;
  private list: HTMLElement;
  private town = 'hale';
  private open = false;
  private sig = '';

  constructor(root: HTMLElement, private fly: (to: string) => void) {
    this.panel = el(root, 'panel shoppanel');
    this.titleEl = el(this.panel, 'ptitle');
    el(this.titleEl, 'pclose', '✕').addEventListener('click', () => this.setOpen(false));
    this.goldEl = el(this.panel, 'shopgold');
    el(this.panel, 'shophint', 'You can only fly to a town you have walked to.');
    this.list = el(this.panel, 'recipes');
    this.panel.style.display = 'none';
  }

  get isOpen() { return this.open; }

  setOpen(on: boolean, town?: string) {
    this.open = on;
    if (on && town) this.town = town;
    const name = `${masterById(this.town)?.name ?? 'Flight master'} - Flights`;
    this.titleEl.firstChild?.nodeType === Node.TEXT_NODE ? (this.titleEl.firstChild.textContent = name) : this.titleEl.prepend(name);
    this.panel.style.display = on ? 'block' : 'none';
    this.sig = '';
  }

  update(s: GameState) {
    const p = s.player, m = masterById(this.town);
    if (this.open && (p.dead || p.action?.k === 'flight' || !m || Math.hypot(p.x - m.x, p.z - m.z) > FLIGHT_REACH + 1.5)) this.setOpen(false);
    if (!this.open) return;
    const sig = JSON.stringify([p.gold, p.inCombat, s.found]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.goldEl.textContent = `Your gold: ${p.gold}`;
    this.list.textContent = '';
    const going = destinationsFrom(s, this.town);
    for (const t of TOWNS) {
      if (t.id === this.town) continue;
      const d = going.find(g => g.to === t.id);
      const poor = !!d && p.gold < d.price, can = !!d && !poor && !p.inCombat;
      const row = el(this.list, `recipe${can ? '' : ' locked'}`);
      const head = el(row, 'rhead');
      el(head, 'rname', d ? t.name : '???');
      if (!d) { el(row, 'rstat', 'Not found yet: walk there and its flight master joins the network.'); continue; }
      el(head, `rreq${poor ? ' bad' : ''}`, `${d.price} gold`);
      el(row, 'rstat', `A ${secs(d.seconds)} ride${p.inCombat ? ' (not in combat)' : ''}`);
      el(el(row, 'rbtns'), `rbtn${can ? '' : ' off'}`, 'Fly').addEventListener('click', () => this.fly(t.id));
    }
  }
}

/** What the map UI needs from the renderer. */
export interface MapView {
  setScreen: (on: boolean) => void;
  project: (town: string) => { x: number; y: number } | null;
  projectYou: () => { x: number; y: number } | null;
}

/** The world-map screen (the beacons' names over the map scene) and, during a ride, its caption. */
export class MapUi {
  private screen: HTMLElement;
  private labels = new Map<string, HTMLElement>();
  private you: HTMLElement;
  private ride: HTMLElement;
  private rideTitle: HTMLElement;
  private rideFill: HTMLElement;
  private open = false;

  constructor(private root: HTMLElement, private view: MapView) {
    this.screen = el(root, 'maplayer');
    el(this.screen, 'maptitle', 'The Lands');
    el(this.screen, 'maphint', 'J or Esc to close');
    for (const t of TOWNS) this.labels.set(t.id, el(this.screen, 'maptown'));
    this.you = el(this.screen, 'maptown mapyou', 'You are here');
    this.screen.style.display = 'none';

    this.ride = el(root, 'ridelayer');
    this.rideTitle = el(this.ride, 'ridetitle');
    const bar = el(this.ride, 'ridebar');
    this.rideFill = el(bar, 'ridefill');
    this.ride.style.display = 'none';
  }

  get isOpen() { return this.open; }

  setOpen(on: boolean) {
    this.open = on;
    this.screen.style.display = on ? 'block' : 'none';
    this.view.setScreen(on);
    this.root.classList.toggle('mapmode', on);
  }

  toggle() { this.setOpen(!this.open); }

  update(s: GameState) {
    const p = s.player, a = p.action?.k === 'flight' ? p.action : null;
    if (this.open && (p.dead || p.inCombat || a)) this.setOpen(false); // the map is for quiet moments
    this.root.classList.toggle('mapmode', this.open || !!a);
    this.ride.style.display = a ? 'block' : 'none';
    if (a) {
      this.rideTitle.textContent = `Flying to ${TOWNS.find(t => t.id === a.to)?.name ?? a.to}`;
      this.rideFill.style.width = `${Math.min(100, (a.t / a.duration) * 100)}%`;
    }
    if (!this.open) return;
    for (const t of TOWNS) {
      const lab = this.labels.get(t.id)!, at = this.view.project(t.id), found = s.found.includes(t.id);
      lab.textContent = found ? t.name : '???';
      lab.classList.toggle('lost', !found);
      lab.style.display = at ? 'block' : 'none';
      if (at) lab.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
    }
    const me = this.view.projectYou();
    this.you.style.display = me ? 'block' : 'none';
    if (me) this.you.style.transform = `translate(${me.x}px, ${me.y}px) translate(-50%, 4px)`; // below the pin: the town's own name sits above its beacon
  }
}

// Quest tracker (objective, live progress, arrow to the next place to go) and the NPC dialogue panel. Reads GameState only;
// the one thing it can do is ask the sim to advance the quest.
import type { GameState } from './sim';
import { Dialogue, NPCS, TALK_RANGE, activeQuestView, dialogueAt, npcName } from './sim/quest';
import { el } from './dom';

export class QuestUi {
  private tracker: HTMLElement;
  private title: HTMLElement;
  private lines: HTMLElement;
  private nav: HTMLElement;
  private arrow: HTMLElement;
  private navText: HTMLElement;
  private panel: HTMLElement;
  private titleEl: HTMLElement;
  private who = 'hale';
  private text: HTMLElement;
  private opts: HTMLElement;
  private open = false;
  private reply: string | null = null; // showing an answer instead of the stage's lines
  private dialogue: Dialogue | null = null; // fixed when the panel opens, so a stage change mid-talk cannot swap the text
  private sig = '';
  private trackerSig = '';
  private replyCloses = false; // the reply followed an accepted quest step: Okay ends the conversation

  constructor(root: HTMLElement, private advance: (what: boolean | 'road') => void) {
    this.tracker = el(root, 'chrome tracker');
    this.title = el(this.tracker, 'qtitle');
    this.lines = el(this.tracker, 'qlines');
    this.nav = el(this.tracker, 'qnav');
    this.arrow = el(this.nav, 'qarrow', '▲');
    this.navText = el(this.nav, 'qnavtext');

    this.panel = el(root, 'panel dialogue');
    this.titleEl = el(this.panel, 'ptitle');
    el(this.titleEl, 'dhint', 'Esc to close');
    this.text = el(this.panel, 'dtext');
    this.opts = el(this.panel, 'dopts');
    this.panel.style.display = 'none';
  }

  get isOpen() { return this.open; }

  setOpen(on: boolean, s?: GameState, who = 'hale') {
    this.open = on;
    this.reply = null;
    this.sig = '';
    this.panel.style.display = on ? 'block' : 'none';
    if (on && s) {
      this.who = who;
      this.dialogue = dialogueAt(s, who);
      this.titleEl.firstChild?.nodeType === Node.TEXT_NODE ? (this.titleEl.firstChild.textContent = npcName(who)) : this.titleEl.prepend(npcName(who));
    }
  }

  update(s: GameState, yaw: number) {
    const v = activeQuestView(s), p = s.player;
    const trackerSig = JSON.stringify([v.title, v.lines, v.progress]);
    if (trackerSig !== this.trackerSig) { // rebuild only when the text changes
      this.trackerSig = trackerSig;
      this.title.textContent = `${v.title}  ${v.progress}`;
      this.lines.textContent = '';
      for (const l of v.lines) el(this.lines, `qline${l.done ? ' done' : ''}`, `${l.done ? '✔' : '•'} ${l.text}`);
    }
    this.tracker.classList.toggle('ready', v.ready);

    // arrow: angle of the target relative to where the camera looks (forward = (-sin yaw, -cos yaw))
    const t = v.target;
    this.nav.style.display = t ? 'flex' : 'none';
    if (t) {
      const dx = t.x - p.x, dz = t.z - p.z;
      const fwd = dx * -Math.sin(yaw) + dz * -Math.cos(yaw), right = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
      this.arrow.style.transform = `rotate(${Math.atan2(right, fwd)}rad)`;
      this.navText.textContent = `${t.label}  ${Math.round(Math.hypot(dx, dz))}m`;
    }

    if (this.open) {
      const n = NPCS.find(x => x.id === this.who)!;
      if (p.dead || Math.hypot(p.x - n.x, p.z - n.z) > TALK_RANGE + 2) return this.setOpen(false);
      this.renderDialogue();
    }
  }

  private renderDialogue() {
    const d = this.dialogue;
    if (!d) return;
    const sig = `${d.lines[0]}|${this.reply}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.text.textContent = '';
    this.opts.textContent = '';
    if (this.reply) {
      el(this.text, 'dline', this.reply);
      el(this.opts, 'btn block dopt', '▸ Okay').addEventListener('click', () => {
        if (this.replyCloses) this.setOpen(false); else { this.reply = null; this.sig = ''; }
      });
      return;
    }
    for (const line of d.lines) el(this.text, 'dline', line);
    d.options.forEach(o => {
      const b = el(this.opts, 'btn block dopt', `▸ ${o.label}`);
      b.addEventListener('click', () => {
        if (o.advance) this.advance(o.advance);
        if (o.reply) { this.reply = o.reply; this.replyCloses = !!o.advance; this.sig = ''; } else this.setOpen(false);
      });
    });
  }
}

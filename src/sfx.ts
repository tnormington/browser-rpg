// Tiny synthesised sound effects (WebAudio, no asset files). Reads sim events; silent until the first user gesture,
// and M mutes. Every sound is a handful of oscillator blips: enough feedback to feel like a game, nothing to ship.
import type { GameEvent } from './sim';

let ctx: AudioContext | null = null;
let muted = false;

/** Browsers only allow audio after a gesture: call from the first key/click. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
}

export const toggleMute = () => (muted = !muted);
export const isMuted = () => muted;

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo = freq, delay = 0) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const arpeggio = (notes: number[], step: number, type: OscillatorType, vol: number) =>
  notes.forEach((f, i) => tone(f, step * 2.2, type, vol, f, i * step));

export function playEvents(events: GameEvent[]) {
  for (const ev of events) {
    switch (ev.t) {
      case 'cast':
        if (ev.slot === 0) tone(260, 0.07, 'square', 0.05, 120);
        else if (ev.slot === 1) tone(160, 0.14, 'sawtooth', 0.07, 55);
        else if (ev.slot === 2) tone(500, 0.16, 'triangle', 0.06, 1000);
        else if (ev.slot === 4) tone(220, 0.18, 'sawtooth', 0.06, 90);
        else if (ev.slot === 5) { tone(900, 0.05, 'square', 0.07, 400); tone(140, 0.12, 'sawtooth', 0.07, 60, 0.03); }
        else arpeggio([392, 494, 587], 0.06, 'sine', 0.06);
        break;
      case 'hit':
        if (ev.dot) tone(300, 0.05, 'triangle', 0.03, 200);
        else if (ev.target === 'player') tone(130, 0.16, 'sawtooth', 0.08, 50);
        else { tone(ev.crit ? 240 : 190, 0.09, 'square', 0.06, 80); if (ev.crit) tone(900, 0.12, 'triangle', 0.04, 1500, 0.02); }
        break;
      case 'kill': arpeggio([330, 262, 196], 0.07, 'triangle', 0.07); break;
      case 'unlock': arpeggio([392, 523, 659, 784], 0.07, 'sine', 0.07); tone(1568, 0.5, 'triangle', 0.04, 1400, 0.28); break;
      case 'telegraph': tone(110, ev.windup, 'sawtooth', 0.05, 220); break;
      case 'interrupt': tone(1200, 0.08, 'square', 0.07, 300); break;
      case 'levelup': arpeggio([523, 659, 784, 1047], 0.09, 'triangle', 0.08); break;
      case 'quest':
        if (ev.what === 'complete') arpeggio([523, 659, 784, 1047, 784, 1047, 1319], 0.11, 'triangle', 0.09);
        else arpeggio([659, 880], 0.1, 'sine', 0.07);
        break;
      case 'loot': tone(880, 0.07, 'sine', 0.05, 1320); break;
      case 'crafted': tone(420, 0.06, 'square', 0.06, 380); tone(420, 0.06, 'square', 0.06, 380, 0.12); tone(1200, 0.4, 'sine', 0.05, 1100, 0.2); break;
      case 'death': tone(220, 0.8, 'sawtooth', 0.09, 40); break;
      case 'npc': tone(600, 0.08, 'sine', 0.04, 800); break;
    }
  }
}

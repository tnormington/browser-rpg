// Ambient music: a looping bed of tone for each place, under the ambience bed that sfx.ts already plays. Played through the same
// AudioContext and the same master gain, so M mutes it and a death ducks it with everything else.
//
// Why it is generated and not a file: a track long enough not to be heard looping is minutes of audio per region, and eight of
// those would weigh more than the rest of the game. A key, a mode and four chords per place cost nothing, never reach a seam,
// and are tuned here by ear the way the sound table in sfx.ts is. What loops is the chord round; what never repeats exactly is
// the line over it, so the ear does not learn a bar and start waiting for it.
//
// What a theme is: a slow chord pad, a drone two octaves under it, and a sparse line picked out of the same scale. Nothing has
// a beat - the pace is in how long a chord is held, not in a pulse - because the game is quiet and a rhythm would fight it.
import { REGIONS } from './sim/world';

const A4 = 440;
const hz = (semi: number) => A4 * 2 ** (semi / 12);

/** Modes, in semitones from the root. */
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10], HALF_DIM = [0, 2, 3, 5, 6, 8, 10], PENT_MINOR = [0, 3, 5, 7, 10], HOLLOW = [0, 2, 3, 7, 8];
/** The usual round: home, the relative major, the subdominant, back. Degrees into whatever scale the theme is in. */
const ROUND = [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]];

export interface Theme {
  /** The key, in semitones from A 440: the place's pitch, and how low it sits. */
  root: number;
  /** The mode the pad and the line are both drawn from. */
  scale: number[];
  /** Chords as degrees of `scale`; held in turn, for ever. */
  chords: number[][];
  pad: OscillatorType;
  lead: OscillatorType;
  /** The pad's lowpass corner, in Hz: how much of the place is lit. */
  cutoff: number;
  /** Seconds a chord is held, and the mean seconds between one line and the next. */
  hold: number; pace: number;
  /** How far above the pad the line sits, in scale degrees. */
  lift: number;
  /** The theme's level under the master gain. Every one of these sits below the ambience bed it plays under. */
  vol: number;
}

/**
 * One theme per place, keyed as the ambience beds are (region id, or a zone key that a region's districts fall through to).
 * Each is meant to be told from its neighbours in two chords: no two share both a root and a mode, and the pace differs
 * with them. Hale is the only one that resolves; everything east of it is a mode that does not.
 */
export const THEMES: Record<string, Theme> = {
  /** Hale: home, and the one place that sounds settled. D minor, the warmest and the only theme with a major chord in its round. */
  hale: { root: -7, scale: AEOLIAN, chords: ROUND, pad: 'sine', lead: 'triangle', cutoff: 950, hold: 13, pace: 9, lift: 7, vol: 0.5 },
  /** The Greywater Road: travelling music. E dorian, the brightest minor there is, and the quickest round in the game. */
  greywater: { root: -5, scale: DORIAN, chords: ROUND, pad: 'triangle', lead: 'triangle', cutoff: 1250, hold: 10, pace: 7, lift: 7, vol: 0.45 },
  /** Saltmarrow: open water and a lit town. G lydian, the one theme that lifts, with its raised fourth doing the lifting. */
  saltmarrow: { root: -2, scale: LYDIAN, chords: [[0, 2, 4], [3, 5, 0], [1, 3, 5], [4, 6, 1]], pad: 'triangle', lead: 'sine', cutoff: 1500, hold: 11, pace: 8, lift: 7, vol: 0.42 },
  /** The Dunmere Fens: C phrygian, whose flat second never settles. Dark, slow, and the pad is nearly closed. */
  dunmere: { root: -9, scale: PHRYGIAN, chords: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [6, 1, 3]], pad: 'sine', lead: 'triangle', cutoff: 700, hold: 14, pace: 11, lift: 7, vol: 0.45 },
  /** Thornwick and the Thornwood: A minor an octave down, closed and close. The lowest pad above ground. */
  thornwick: { root: -12, scale: AEOLIAN, chords: ROUND, pad: 'sine', lead: 'triangle', cutoff: 650, hold: 15, pace: 10, lift: 12, vol: 0.46 },
  /** The Barrowdowns: G, with the flat fifth of a half-diminished scale sitting in every chord. The sparsest line in the game. */
  barrowdowns: { root: -14, scale: HALF_DIM, chords: [[0, 2, 4], [6, 1, 3], [0, 2, 4], [3, 5, 0]], pad: 'sawtooth', lead: 'sine', cutoff: 520, hold: 17, pace: 14, lift: 14, vol: 0.4 },
  /** Highmoor: a bare heath wants a bare scale. E minor pentatonic, nothing between the notes, the pad wide open and cold. */
  highmoor: { root: -5, scale: PENT_MINOR, chords: [[0, 2, 4], [3, 0, 2], [1, 3, 0], [4, 1, 3]], pad: 'triangle', lead: 'sine', cutoff: 1150, hold: 12, pace: 9, lift: 10, vol: 0.42 },
  /** Underground, wherever it is: the lowest, slowest theme, five notes that barely move, and a line that comes once a minute. */
  cave: { root: -17, scale: HOLLOW, chords: [[0, 2, 4], [0, 1, 3], [0, 2, 4], [3, 0, 2]], pad: 'sawtooth', lead: 'sine', cutoff: 420, hold: 19, pace: 22, lift: 15, vol: 0.38 },
};

/**
 * A region's own entry in a table, else - if it is underground - the cave entry, else its zone's: so a district (the Waysides,
 * the Thornwood Seams) sounds like the land it sits in, and every cave room shares one bed. The rule the ambience beds and the
 * music are both looked up by.
 *
 * The last fallback catches the Grotto Ghostcap, which is `cave: false` (it wants no cave floor) in a zone that is a dungeon and
 * so has no entry of its own: anything that falls through both is underground, because every surface zone has an entry.
 */
export function byRegion<T>(table: Record<string, T>, cave: T | undefined, id: string | null): T | undefined {
  if (!id) return undefined;
  const r = REGIONS.find(x => x.id === id);
  if (!r) return undefined;
  return table[id] ?? (r.cave ? cave : table[r.zone]) ?? cave;
}

const THEME_IDS: Record<string, string> = Object.fromEntries(Object.keys(THEMES).map(k => [k, k]));
/** Which theme a region plays, by id, or null where it has none. */
export const themeFor = (region: string | null): string | null => byRegion(THEME_IDS, 'cave', region) ?? null;

/** The pitch of degree `i` of a theme's scale, climbing into higher octaves rather than wrapping back on itself. */
export function degree(t: Theme, i: number): number {
  const n = t.scale.length, oct = Math.floor(i / n);
  return hz(t.root + t.scale[i - oct * n] + 12 * oct);
}

const FADE = 3;            // seconds to cross from one place's theme to the next
const REVERB = 2.8;        // the tail every theme sits in: a stone room, not a hall
const DETUNE = 6;          // cents the pad's two oscillators sit either side of the note: what stops it being one thin tone
const TICK = 500;          // ms between looks at whether a chord or a line is due

/** A noise burst with an exponential tail, as the impulse for the shared reverb. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return buf;
}

interface Live { id: string; theme: Theme; gain: GainNode; drone: OscillatorNode[]; chord: number; nextChord: number; nextLine: number }

/**
 * The music, one theme at a time, crossfaded as the player changes region. Built once the AudioContext exists (sfx.ts owns it)
 * and told which region to play; everything after that runs off one timer.
 */
export class Music {
  private bus: GainNode;
  private verb: ConvolverNode;
  private live: Live | null = null;
  private want: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.connect(dest);
    this.verb = ctx.createConvolver();
    this.verb.buffer = impulse(ctx, REVERB);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.verb.connect(wet).connect(this.bus);
  }

  /** Play the theme of `region` (null for silence), crossfading from whatever was playing. Safe to call repeatedly: `sync` acts only on a change. */
  set(region: string | null) {
    this.want = themeFor(region);
    this.sync();
  }

  /** Start what was asked for, if it is not already playing. Called again whenever the context may have resumed, so a theme asked for before the first gesture is not lost. */
  sync() {
    if (this.ctx.state !== 'running') return;
    if (this.live?.id === this.want) return;
    if (this.live) this.fadeOut(this.live);
    this.live = null;
    if (!this.want) { this.idle(); return; }
    const theme = THEMES[this.want], t = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(theme.vol, t + FADE);
    gain.connect(this.bus);
    gain.connect(this.verb);
    // the drone: the root and its fifth, two octaves under the pad, running for as long as the place does
    const drone = [0, 7].map((semi, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = hz(theme.root + semi - 24);
      g.gain.value = i === 0 ? 0.06 : 0.035;
      o.connect(g).connect(gain);
      o.start(t);
      return o;
    });
    this.live = { id: this.want, theme, gain, drone, chord: 0, nextChord: 0, nextLine: t + theme.pace * 0.5 };
    if (this.timer === undefined) this.timer = setInterval(() => this.step(), TICK);
  }

  /** Stop everything and forget the theme (the page is going away, or audio is being torn down). */
  stop() {
    if (this.live) this.fadeOut(this.live);
    this.live = null;
    this.want = null;
    this.idle();
  }

  private idle() {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
  }

  private fadeOut(l: Live) {
    const t = this.ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setValueAtTime(l.gain.gain.value, t);
    l.gain.gain.linearRampToValueAtTime(0, t + FADE);
    for (const o of l.drone) o.stop(t + FADE + 0.1);
    // cut it loose once it is silent: a long session crosses a lot of regions, and a theme nobody can hear should not stay in the graph
    setTimeout(() => l.gain.disconnect(), (FADE + 1) * 1000);
  }

  /** Is a chord or a line due? Everything the music does, it does from here. */
  private step() {
    const l = this.live;
    if (!l || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    if (t >= l.nextChord) {
      this.pad(l, l.theme.chords[l.chord % l.theme.chords.length], t);
      l.chord++;
      l.nextChord = t + l.theme.hold;
    }
    if (t >= l.nextLine) {
      this.line(l, t);
      l.nextLine = t + l.theme.pace * (0.55 + Math.random() * 1.3);
    }
  }

  /** One chord of the pad: each note two oscillators a few cents apart, swelling in over a third of the hold and dying over the rest. */
  private pad(l: Live, chord: number[], t: number) {
    const { theme } = l, filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = theme.cutoff;
    filter.Q.value = 0.7;
    filter.connect(l.gain);
    const rise = theme.hold * 0.35, fall = theme.hold * 0.95;
    for (const d of chord) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + rise);
      g.gain.linearRampToValueAtTime(0, t + rise + fall);
      g.connect(filter);
      for (const cents of [-DETUNE, DETUNE]) {
        const o = this.ctx.createOscillator();
        o.type = theme.pad;
        o.frequency.value = degree(theme, d);
        o.detune.value = cents;
        o.connect(g);
        o.start(t);
        o.stop(t + rise + fall + 0.1);
      }
    }
    setTimeout(() => filter.disconnect(), (rise + fall + 1) * 1000);   // the chord is over: let the whole subtree go
  }

  /** The line over the pad: one to three notes of the scale, struck softly and left to ring out. Never the same shape twice. */
  private line(l: Live, t: number) {
    const { theme } = l, steps = 1 + Math.floor(Math.random() * 3);
    let d = theme.lift + Math.floor(Math.random() * theme.scale.length);
    for (let i = 0; i < steps; i++) {
      const at = t + i * (0.45 + Math.random() * 0.5), ring = 2.4 + Math.random() * 1.6;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = theme.lead;
      o.frequency.value = degree(theme, d);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.055, at + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0005, at + ring);
      o.connect(g).connect(l.gain);
      o.onended = () => g.disconnect();
      o.start(at);
      o.stop(at + ring + 0.05);
      d += [-2, -1, 1, 2][Math.floor(Math.random() * 4)];   // step about the scale rather than leaping
      d = Math.max(theme.lift - 2, Math.min(theme.lift + theme.scale.length + 2, d));
    }
  }
}

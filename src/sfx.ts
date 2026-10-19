// Sound effects: CC0 ogg samples (assets/audio, see LICENSES.md) played through one shared AudioContext, plus two
// synth blips kept on purpose (enemy telegraph, Second Wind). Reads sim events; silent until the first user gesture,
// and M mutes. Samples are fetched and decoded lazily after the context exists; until decoded a sound is skipped.
import type { GameEvent } from './sim';

// ---- tuning table: change numbers here, by ear ----
/** minGap ms between plays of a group, maxVoices simultaneously sounding in it. */
const GROUPS = {
  hitEnemy:  { minGap: 60,  maxVoices: 3 },
  hurt:      { minGap: 120, maxVoices: 2 },
  swing:     { minGap: 150, maxVoices: 2 },
  slam:      { minGap: 200, maxVoices: 2 },
  interrupt: { minGap: 100, maxVoices: 1 },
  stinger:   { minGap: 500, maxVoices: 1 },
  loot:      { minGap: 150, maxVoices: 2 },
  smith:     { minGap: 800, maxVoices: 3 },
  step:      { minGap: 250, maxVoices: 2 },   // footfalls land every ~450 ms running; the gap only guards a burst
  gather:    { minGap: 400, maxVoices: 2 },   // strikes land every 1.1 s
};
type Group = keyof typeof GROUPS;

/** files: variants (random, never the same twice in a row); rate: fixed pitch multiplier; delay: seconds. */
interface Layer { files: string[]; vol: number; jitter?: number; rate?: number; delay?: number }
const SOUNDS = {
  hitFlesh:  { files: ['hit-flesh-1', 'hit-flesh-2', 'hit-flesh-3'], vol: 0.55, jitter: 0.06 },
  hitCrit:   { files: ['hit-crit'], vol: 0.6, jitter: 0.04 },
  hurt:      { files: ['hurt-1', 'hurt-2'], vol: 0.6, jitter: 0.05 },
  hurtHeavy: { files: ['slam'], vol: 0.8 },
  swing:     { files: ['swing-1', 'swing-2'], vol: 0.4, jitter: 0.08 },
  cast1:     { files: ['swing-1'], vol: 0.5, jitter: 0.04, rate: 0.8 },
  cast2:     { files: ['swing-2'], vol: 0.45, jitter: 0.04, rate: 1.2 },
  cast4:     { files: ['swing-2'], vol: 0.5, jitter: 0.04, rate: 0.85 },
  slam:      { files: ['slam'], vol: 0.8, jitter: 0.03 },   // volume is scaled by radius, see slamVol
  interrupt: { files: ['interrupt'], vol: 0.7, jitter: 0.04 },
  levelup:   { files: ['levelup'], vol: 0.6 },
  unlock:    { files: ['levelup'], vol: 0.4, rate: 1.25 },
  accept:    { files: ['loot'], vol: 0.35 },
  complete:  { files: ['quest-complete'], vol: 0.6 },
  completeLv:{ files: ['levelup'], vol: 0.4 },
  loot:      { files: ['loot'], vol: 0.4, jitter: 0.05 },
  smith1:    { files: ['smith-1'], vol: 0.55, jitter: 0.04 },
  smith2:    { files: ['smith-2'], vol: 0.55, jitter: 0.04 },
  forge:     { files: ['smith-1'], vol: 0.4 },
  death:     { files: ['death'], vol: 0.8 },
  stepGrass: { files: ['step-grass-1', 'step-grass-2', 'step-grass-3'], vol: 0.3, jitter: 0.08 },
  stepCave:  { files: ['step-cave-1', 'step-cave-2'], vol: 0.3, jitter: 0.08 },
  mine:      { files: ['mine-1', 'mine-2', 'mine-3'], vol: 0.55, jitter: 0.05 },
  chop:      { files: ['chop'], vol: 0.55, jitter: 0.06 },
} satisfies Record<string, Layer>;
const slamVol = (radius: number) => Math.min(1, 0.5 + radius / 12);

/** Looping beds by region id (a region with no entry is silent), and the level each plays at. */
const AMBIENCE: Record<string, { file: string; vol: number }> = {
  greywater: { file: 'road-ambience', vol: 0.35 },
  saltmarrow: { file: 'coast-ambience', vol: 0.4 },
};
const AMBIENCE_FADE = 1.5;   // seconds to cross between beds

const MASTER_GAIN = 0.8;
const DUCK_GAIN = 0.35, DUCK_HOLD = 1;   // death: master to DUCK_GAIN, linear ramp back over DUCK_HOLD seconds
const GLOBAL_VOICES = 16, QUIET = 0.3;   // over the global cap, quiet sounds are dropped first
const SMITH_STEP = 0.35;

const FILES = import.meta.glob('../assets/audio/*.ogg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const URLS = new Map(Object.entries(FILES).map(([p, url]) => [p.split('/').pop()!.replace('.ogg', ''), url]));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
const buffers = new Map<string, AudioBuffer>();
const lastPick = new Map<string, string>();
const lastPlay = new Map<Group, number>();
interface Voice { group: Group; vol: number; src: AudioBufferSourceNode }
let voices: Voice[] = [];

function loadSamples() {
  const c = ctx;
  for (const [name, url] of URLS) {
    fetch(url).then(r => r.arrayBuffer()).then(b => c!.decodeAudioData(b)).then(buf => buffers.set(name, buf)).catch(() => {});
  }
}

/** Browsers only allow audio after a gesture: call from the first key/click. */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);
      setTimeout(loadSamples, 0);   // after the gesture handler returns, never in the initial load
    }
    if (ctx.state === 'suspended') void ctx.resume().then(syncAmbience);
    else syncAmbience();
  } catch { ctx = null; master = null; }
}

export function toggleMute() {
  muted = !muted;
  if (ctx && master) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime);   // also silences queued smith strikes
    if (muted) for (const v of voices) try { v.src.stop(); } catch { /* already ended */ }
  }
  return muted;
}
export const isMuted = () => muted;

function duck() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(DUCK_GAIN, t);
  master.gain.setValueAtTime(DUCK_GAIN, t + DUCK_HOLD);
  master.gain.linearRampToValueAtTime(MASTER_GAIN, t + DUCK_HOLD * 2);
}

// ---- ambience: one looping bed at a time, crossfaded as the player changes region ----
interface Bed { file: string; src: AudioBufferSourceNode; gain: GainNode }
let bed: Bed | null = null;
let wantBed: string | null = null;   // region id asked for; kept so a bed asked for before decode or unlock still starts

/** Call whenever the player's region changes (and once at start): fades the matching bed in and the old one out. */
export function setAmbience(region: string | null) {
  wantBed = region;
  syncAmbience();
}

function syncAmbience() {
  if (!ctx || !master || ctx.state !== 'running') return;
  const cfg = wantBed ? AMBIENCE[wantBed] : undefined;
  const buf = cfg && buffers.get(cfg.file);
  if (cfg && !buf) { setTimeout(syncAmbience, 500); return; }   // still decoding
  if (bed && bed.file === cfg?.file) return;
  const t = ctx.currentTime;
  if (bed) {
    const old = bed;
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t);
    old.gain.gain.linearRampToValueAtTime(0, t + AMBIENCE_FADE);
    old.src.stop(t + AMBIENCE_FADE + 0.05);
    bed = null;
  }
  if (!cfg || !buf) return;
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = buf; src.loop = true;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(cfg.vol, t + AMBIENCE_FADE);
  src.connect(gain).connect(master);
  src.start(t);
  bed = { file: cfg.file, src, gain };
}

const live = (g?: Group) => voices.filter(v => !g || v.group === g);

function pick(files: string[]): string {
  if (files.length === 1) return files[0];
  const key = files.join('|'), last = lastPick.get(key);
  const options = files.filter(f => f !== last);
  const f = options[Math.floor(Math.random() * options.length)];
  lastPick.set(key, f);
  return f;
}

interface PlayOpts { steal?: boolean; exempt?: boolean; noGap?: boolean }   // steal: drop the oldest voice instead of self; exempt: the voice caps never drop it; noGap: skip the group gap

/** Start one sound (all its layers) in a group, honouring the group gap, voice caps and mute. */
function play(group: Group, layers: (Layer & { vol: number })[], opts: PlayOpts = {}) {
  if (!ctx || !master || muted || ctx.state !== 'running') return;
  const now = performance.now(), cfg = GROUPS[group];
  if (!opts.noGap && now - (lastPlay.get(group) ?? -Infinity) < cfg.minGap) return;
  let started = false;
  for (const layer of layers) {
    const buf = buffers.get(pick(layer.files));
    if (!buf) continue;
    if (!opts.exempt) {
      if (live(group).length >= cfg.maxVoices) {
        if (!opts.steal) continue;
        stealOldest(group);
      }
    }
    if (live().length >= GLOBAL_VOICES) {
      const quiet = live().find(v => v.vol < QUIET);
      if (quiet) quiet.src.stop();
      else if (layer.vol < QUIET) continue;
      else if (!opts.exempt && !opts.steal) continue;
    }
    startVoice(group, buf, layer);
    started = true;
  }
  if (started) lastPlay.set(group, now);
}

function stealOldest(group: Group) {
  const old = live(group)[0];
  if (old) { try { old.src.stop(); } catch { /* ended */ } voices = voices.filter(v => v !== old); }
}

function startVoice(group: Group, buf: AudioBuffer, layer: Layer) {
  const c = ctx!;
  const src = c.createBufferSource(), g = c.createGain();
  const j = layer.jitter ?? 0;
  src.buffer = buf;
  src.playbackRate.value = (layer.rate ?? 1) * (1 + (Math.random() * 2 - 1) * j);
  g.gain.value = layer.vol;
  src.connect(g).connect(master!);
  const voice: Voice = { group, vol: layer.vol, src };
  voices.push(voice);
  src.onended = () => { voices = voices.filter(v => v !== voice); };
  src.start(c.currentTime + (layer.delay ?? 0));
}

// ---- the two synth blips we kept ----
function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo = freq, delay = 0) {
  if (!ctx || !master || muted || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const arpeggio = (notes: number[], step: number, type: OscillatorType, vol: number) =>
  notes.forEach((f, i) => tone(f, step * 2.2, type, vol, f, i * step));

export function playEvents(events: GameEvent[]) {
  for (const ev of events) {
    switch (ev.t) {
      case 'hit':
        if (ev.dot) break;
        if (ev.target === 'player') {
          play('hurt', ev.heavy ? [SOUNDS.hurt, SOUNDS.hurtHeavy] : [SOUNDS.hurt], { exempt: true });
        } else {
          play('hitEnemy', ev.crit ? [SOUNDS.hitFlesh, SOUNDS.hitCrit] : [SOUNDS.hitFlesh], { steal: ev.crit });
        }
        break;
      case 'swing': play('swing', [SOUNDS.swing]); break;
      case 'cast':
        if (ev.slot === 1) play('swing', [SOUNDS.cast1]);
        else if (ev.slot === 2) play('swing', [SOUNDS.cast2]);
        else if (ev.slot === 4) play('swing', [SOUNDS.cast4]);
        else if (ev.slot === 3) arpeggio([392, 494, 587], 0.06, 'sine', 0.06);   // Second Wind
        break;
      case 'slam': play('slam', [{ ...SOUNDS.slam, vol: slamVol(ev.radius) }], { exempt: true }); break;
      case 'interrupt': play('interrupt', [SOUNDS.interrupt], { exempt: true }); break;
      case 'telegraph': tone(110, ev.windup, 'sawtooth', 0.05, 220); break;
      case 'levelup': play('stinger', [SOUNDS.levelup]); break;
      case 'unlock': play('stinger', [SOUNDS.unlock]); break;
      case 'quest':
        if (ev.what === 'accept') play('stinger', [SOUNDS.accept]);
        else if (ev.what === 'complete') play('stinger', [SOUNDS.complete, SOUNDS.completeLv]);
        break;
      case 'loot': play('loot', [SOUNDS.loot]); break;
      case 'crafted':
        if (ev.skill === 'cooking') { play('loot', [SOUNDS.loot]); break; }
        play('smith', [SOUNDS.smith1, { ...SOUNDS.smith2, delay: SMITH_STEP }, { ...SOUNDS.smith1, delay: SMITH_STEP * 2 }]);
        break;
      case 'forge': play('smith', [SOUNDS.forge]); break;
      case 'step': play('step', [ev.surface === 'cave' ? SOUNDS.stepCave : SOUNDS.stepGrass]); break;
      case 'gather': if (ev.skill !== 'fishing') play('gather', [ev.skill === 'mining' ? SOUNDS.mine : SOUNDS.chop]); break; // no free splash yet: a shoal is quiet
      case 'death':
        play('stinger', [SOUNDS.death], { steal: true, noGap: true });
        duck();
        break;
    }
  }
}

// Sound effects: CC0 ogg samples (assets/audio, see LICENSES.md) played through one shared AudioContext, plus two
// synth blips kept on purpose (enemy telegraph, Second Wind). Reads sim events; silent until the first user gesture,
// and M mutes. Samples are fetched and decoded lazily after the context exists; until decoded a sound is skipped.
// The looping ambience bed and the place's music (music.ts) both hang off the same master, so M and the death duck
// take all three together.
import type { GameEvent } from './sim';
import { ABILITIES } from './sim/data';
import { WEATHER_BEDS, bedFor, type WeatherLayer } from './ambience';
import { VOICES, voiceOf } from './voices';
import { Music } from './music';

// ---- tuning table: change numbers here, by ear ----
/** minGap ms between plays of a group, maxVoices simultaneously sounding in it. */
const GROUPS = {
  hitEnemy:  { minGap: 60,  maxVoices: 3 },
  cry:       { minGap: 650, maxVoices: 2 },   // an enemy struck twice a second calls out once: the gap is the rate limit, not the swing's
  hurt:      { minGap: 120, maxVoices: 2 },
  swing:     { minGap: 150, maxVoices: 2 },
  foe:       { minGap: 90,  maxVoices: 3 },   // a pack of three all swinging is three blows; a fourth is the one you lose

  slam:      { minGap: 200, maxVoices: 2 },
  interrupt: { minGap: 100, maxVoices: 1 },
  stinger:   { minGap: 500, maxVoices: 1 },
  loot:      { minGap: 150, maxVoices: 2 },
  smith:     { minGap: 800, maxVoices: 3 },
  step:      { minGap: 250, maxVoices: 2 },   // footfalls land every ~450 ms running; the gap only guards a burst
  hoof:      { minGap: 150, maxVoices: 4 },   // a beat lands every ~270 ms at 10 u/s, each a clop pair
  leather:   { minGap: 300, maxVoices: 2 },
  mount:     { minGap: 300, maxVoices: 2 },
  gather:    { minGap: 400, maxVoices: 2 },   // strikes land every 1.1 s
  kill:      { minGap: 150, maxVoices: 2 },
  fish:      { minGap: 400, maxVoices: 1 },
  cook:      { minGap: 300, maxVoices: 2 },
  flight:    { minGap: 1000, maxVoices: 2 },
};
type Group = keyof typeof GROUPS;

/** files: variants (random, never the same twice in a row); rate: fixed pitch multiplier; delay: seconds. */
export interface Layer { files: string[]; vol: number; jitter?: number; rate?: number; delay?: number }
const SOUNDS = {
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
  hoof:      { files: ['hoof-1', 'hoof-2', 'hoof-3'], vol: 0.4, jitter: 0.06, rate: 0.8 },   // a hollow clop: the wood footstep, pitched down for weight
  hoofLead:  { files: ['hoof-1', 'hoof-2', 'hoof-3'], vol: 0.3, jitter: 0.06, rate: 0.95, delay: 0.11 },   // the fore-hoof half a beat behind: a canter, not a patter
  hoofHeavy: { files: ['hoof-1', 'hoof-2', 'hoof-3'], vol: 0.5, jitter: 0.05, rate: 0.62 },   // the destrier: the same wood footstep pitched much lower, a heavier animal and not the courser played faster
  hoofHeavyLead: { files: ['hoof-1', 'hoof-2', 'hoof-3'], vol: 0.35, jitter: 0.05, rate: 0.74, delay: 0.14 },
  barding:   { files: ['interrupt'], vol: 0.12, jitter: 0.1, rate: 1.9, delay: 0.05 },   // plate on the horse's chest, a faint chink with every beat
  saddle:    { files: ['thud'], vol: 0.5, jitter: 0.04, rate: 0.9 },   // leather taking weight
  tack:      { files: ['cook-start'], vol: 0.3, jitter: 0.04, rate: 1.3, delay: 0.08 },   // a buckle
  unsaddle:  { files: ['thud'], vol: 0.5, jitter: 0.04, rate: 0.75 },
  rackStart: { files: ['thud'], vol: 0.4, jitter: 0.05, rate: 1.15 },   // a hide slapped onto the rack
  rackDone:  { files: ['thud'], vol: 0.5, jitter: 0.04, rate: 0.95 },   // the finished piece laid down, then the buckle
  mine:      { files: ['mine-1', 'mine-2', 'mine-3'], vol: 0.55, jitter: 0.05 },
  chop:      { files: ['chop'], vol: 0.55, jitter: 0.06 },
  fishCast:  { files: ['swing-2'], vol: 0.3, jitter: 0.04, rate: 0.7 },   // a line whipping out
  fishCatch: { files: ['hit-flesh-2'], vol: 0.3, jitter: 0.05, rate: 1.8 },   // a wet flop; the loot chime follows on its own
  cookStart: { files: ['cook-start'], vol: 0.45, jitter: 0.04 },
  cookDone:  { files: ['cook-1', 'cook-2', 'cook-3'], vol: 0.5, jitter: 0.05 },
  takeoff:   { files: ['levelup'], vol: 0.45, rate: 0.8 },
  landing:   { files: ['thud'], vol: 0.6, jitter: 0.04 },
  // the enemy's side of a fight. Its blow, cry, hit and death are its voice's (voices.ts); these two are shared, because
  // every shooter in the game is robed or a boss and every net is the same rope.
  bolt:      { files: ['swing-2'], vol: 0.3, jitter: 0.1, rate: 1.3 },
  boltTail:  { files: ['interrupt'], vol: 0.12, jitter: 0.08, rate: 0.6, delay: 0.02 },   // a low ring under the shot: what makes it a hex and not a swing
  netThrow:  { files: ['swing-1'], vol: 0.35, jitter: 0.06, rate: 0.6 },   // weighted rope, thrown low
} satisfies Record<string, Layer>;
const slamVol =(radius: number) => Math.min(1, 0.5 + radius / 12);

const AMBIENCE_FADE = 1.5;   // seconds to cross between beds

const MASTER_GAIN = 0.8;
const DUCK_GAIN = 0.35, DUCK_HOLD = 1;   // death: master to DUCK_GAIN, linear ramp back over DUCK_HOLD seconds
const GLOBAL_VOICES = 16, QUIET = 0.3;   // over the global cap, quiet sounds are dropped first
const SMITH_STEP = 0.35;

const FILES = import.meta.glob('../assets/audio/*.ogg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const URLS = new Map(Object.entries(FILES).map(([p, url]) => [p.split('/').pop()!.replace('.ogg', ''), url]));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let music: Music | null = null;
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
      music = new Music(ctx, master);   // the music rides under the same master, so M mutes it and a death ducks it
      setTimeout(loadSamples, 0);   // after the gesture handler returns, never in the initial load
    }
    if (ctx.state === 'suspended') void ctx.resume().then(syncAmbience);
    else syncAmbience();
  } catch { ctx = null; master = null; music = null; }
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

// ---- ambience: one looping bed at a time, crossfaded as the player changes region, with the place's music under it ----
interface Bed { file: string; src: AudioBufferSourceNode; gain: GainNode }
let bed: Bed | null = null;
let wantBed: string | null = null;   // region id asked for; kept so a bed asked for before decode or unlock still starts

/** Call whenever the player's region changes (and once at start): fades the matching bed and music in and the old ones out. */
export function setAmbience(region: string | null) {
  wantBed = region;
  syncAmbience();
}

function syncAmbience() {
  music?.set(wantBed);   // a region asked for before the first gesture is held in wantBed and starts when the context runs
  if (!ctx || !master || ctx.state !== 'running') return;
  const cfg = bedFor(wantBed);
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

// ---- weather: the rain and the wind, looping over the bed, as loud as the weather the player is standing in ----
/** Each layer's loop, started the first time the weather asks for it and then left running: a loop stopped and restarted is a seam you can hear. */
const weatherGains = new Map<WeatherLayer, GainNode>();

/** Call every frame with how much of each layer the player can hear (0..1): render.ts eases it with the weather and takes it to nothing underground. */
export function setWeather(level: Record<WeatherLayer, number>) {
  if (!ctx || !master || ctx.state !== 'running') return;
  for (const key of Object.keys(WEATHER_BEDS) as WeatherLayer[]) {
    const cfg = WEATHER_BEDS[key];
    let gain = weatherGains.get(key);
    if (!gain) {
      const buf = buffers.get(cfg.file);
      if (level[key] < 0.01 || !buf) continue;   // nothing to hear yet, or the sample is still decoding: try again next frame
      const src = ctx.createBufferSource();
      gain = ctx.createGain();
      src.buffer = buf; src.loop = true;
      src.playbackRate.value = cfg.rate ?? 1;
      gain.gain.value = 0;
      src.connect(gain).connect(master);
      src.start(ctx.currentTime);
      weatherGains.set(key, gain);
    }
    gain.gain.value = cfg.vol * level[key];   // plain assignment, not a ramp: the weather already eases over seconds (weather.ts), so this never steps
  }
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

/** mount is the id of the mount being ridden, null on foot. Read from the state each tick, not from 'mount' events, so a save loaded mounted already sounds mounted. */
export function playEvents(events: GameEvent[], mount: string | null = null) {
  for (const ev of events) {
    switch (ev.t) {
      case 'hit':
        if (ev.dot) break;
        if (ev.target === 'player') {
          play('hurt', ev.heavy ? [SOUNDS.hurt, SOUNDS.hurtHeavy] : [SOUNDS.hurt], { exempt: true });
        } else {
          const voice = VOICES[voiceOf(ev.species)];
          play('hitEnemy', ev.crit ? [...voice.hit, SOUNDS.hitCrit] : voice.hit, { steal: ev.crit });
          play('cry', voice.cry);   // its own group, so a thing being struck twice a second is not screaming twice a second
        }
        break;
      case 'swing': play('swing', [SOUNDS.swing]); break;
      case 'attack': play('foe', ev.ranged ? [SOUNDS.bolt, SOUNDS.boltTail] : VOICES[voiceOf(ev.species)].attack); break;
      case 'net': play('foe', [SOUNDS.netThrow], { noGap: true }); break;
      case 'cast':
        if (ev.slot === 1) play('swing', [SOUNDS.cast1]);
        else if (ev.slot === 2) play('swing', [SOUNDS.cast2]);
        else if (ev.slot === 4) play('swing', [SOUNDS.cast4]);
        else if (ev.slot === 3) arpeggio([392, 494, 587], 0.06, 'sine', 0.06);   // Second Wind
        else if (ABILITIES[ev.slot].kind === 'guard') arpeggio([262, 330], 0.05, 'triangle', 0.07); // Guard goes up: two low notes
        break;
      case 'slam': play('slam', [{ ...SOUNDS.slam, vol: slamVol(ev.radius) }], { exempt: true }); break;
      case 'interrupt': play('interrupt', [SOUNDS.interrupt], { exempt: true }); break;
      case 'kill': play('kill', VOICES[voiceOf(ev.species)].kill); break;
      case 'begin':
        if (ev.skill === 'fishing') play('fish', [SOUNDS.fishCast]);
        else if (ev.skill === 'cooking') play('cook', [SOUNDS.cookStart]);
        else if (ev.skill === 'leatherworking') play('leather', [SOUNDS.rackStart]);
        break;
      case 'catch': play('fish', [SOUNDS.fishCatch], { noGap: true }); break;
      case 'flight': play('flight', [ev.phase === 'start' ? SOUNDS.takeoff : SOUNDS.landing], { noGap: true }); break;
      case 'telegraph': tone(110, ev.windup, 'sawtooth', 0.05, 220); break;
      case 'levelup': play('stinger', [SOUNDS.levelup]); break;
      case 'unlock': play('stinger', [SOUNDS.unlock]); break;
      case 'quest':
        if (ev.what === 'accept') play('stinger', [SOUNDS.accept]);
        else if (ev.what === 'complete') play('stinger', [SOUNDS.complete, SOUNDS.completeLv]);
        break;
      case 'loot': play('loot', [SOUNDS.loot]); break;
      case 'chest': play('stinger', [SOUNDS.unlock]); break; // no free creak yet: a found chest is the bright stinger, louder than a drop
      case 'crafted':
        if (ev.skill === 'cooking') { play('cook', [SOUNDS.cookDone]); break; }
        if (ev.skill === 'leatherworking') { play('leather', [SOUNDS.rackDone, SOUNDS.tack]); break; }
        if (ev.skill === 'alchemy') { play('loot', [SOUNDS.loot]); break; } // no free bubbling yet: a brew is the loot chime, not a smith's clang
        play('smith', [SOUNDS.smith1, { ...SOUNDS.smith2, delay: SMITH_STEP }, { ...SOUNDS.smith1, delay: SMITH_STEP * 2 }]);
        break;
      case 'forge': play('smith', [SOUNDS.forge]); break;
      case 'step':
        if (mount === 'destrier') play('hoof', [SOUNDS.hoofHeavy, SOUNDS.hoofHeavyLead, SOUNDS.barding]);
        else if (mount) play('hoof', [SOUNDS.hoof, SOUNDS.hoofLead]);
        else play('step', [ev.surface === 'cave' ? SOUNDS.stepCave : SOUNDS.stepGrass]);
        break;
      case 'mount': play('mount', ev.on ? [SOUNDS.saddle, SOUNDS.tack] : [SOUNDS.unsaddle], { noGap: true }); break;
      case 'gather': if (ev.skill === 'mining' || ev.skill === 'woodcutting') play('gather', [ev.skill === 'mining' ? SOUNDS.mine : SOUNDS.chop]); break; // no free splash yet: a shoal is quiet, and so is a patch of herb
      case 'death':
        play('stinger', [SOUNDS.death], { steal: true, noGap: true });
        duck();
        break;
    }
  }
}

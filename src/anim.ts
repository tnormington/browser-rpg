// Skeletal animation: one AnimationMixer per animated actor, driven by state the renderer already sees.
// Rendering only. Locomotion loops cross-fade; one-shots (attack, hit, death) layer over them and hand back to locomotion.
// Where a rig ships no clip for a job (hit, death, a lunge, a wind-up tell) a procedural pose layer stands in: see applyPose.
import * as THREE from 'three';

/**
 * Every bone this file and `gear.ts` reach for by name, written as the Quaternius human rig (the knight, the wizard,
 * the viking) ships them. A pack that calls them something else carries a `RigMap` saying so, and the names below stay
 * the ones the code is written in: they are the logical joints, not any one file's spelling of them.
 */
export const RIG_BONES = ['Abdomen', 'Torso', 'Head',
  'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'PalmL', 'PalmR', 'MiddleHandL', 'MiddleHandR',
  'FingersL_end', 'FingersR_end',
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'LowerLegL_end', 'LowerLegR_end',
  'FootL', 'FootR', 'FootL_end', 'FootR_end'] as const;

/**
 * What one rig calls those joints: a logical name from `RIG_BONES` to the node name in its file (as three sanitises
 * it, so the knight's `Foot.L` is `FootL`). Anything left out is spelled the same in both, so the human rig needs no
 * map at all. Two logical names may share one file name -- on a rig where the foot hangs off the shin, the shin's end
 * and the foot are the same joint.
 */
export type RigMap = Readonly<Record<string, string>>;

/** Which clip plays for which state. Clip names are the glTF names with the armature prefix stripped. */
export interface AnimDef {
  idle: string;
  move: string;
  /** Seconds of clip time per world unit/second of movement speed is baked into this: timeScale = speed / moveSpeed. */
  moveSpeed?: number;
  /** Attack clips: [0] is the normal swing, [1] (if present) the heavy one, used for the second ability slot. */
  attack?: string[];
  /** Attack clips that only drive the upper body, layered over locomotion so the legs keep idling or running. */
  upper?: string[];
  hit?: string;
  death?: string;
  /**
   * Seconds into each attack clip at which the blow visually lands. The sim applies damage on the tick the attack starts,
   * so the clip is started at (impact - LEAD): the strike pose arrives with the damage number instead of after it.
   */
  impact?: Record<string, number>;
  /** Full-body jump clip, stretched over the airtime. */
  jump?: string;
  /**
   * The airborne span of the jump clip, in clip seconds: the frame the feet leave the ground, and the frame they are
   * reaching for it again. A pack's jump clip crouches before the push and absorbs after the landing, but the sim's
   * takeoff and touchdown are instants, so playing the whole clip over the airtime runs the crouch while the body is
   * already rising. Only this span is stretched; the recovery under it is `touchdown`'s squash. Default: the whole clip.
   */
  jumpSpan?: [number, number];
  /** No death clip on this rig: it topples onto its side procedurally and lies this high off the ground (world units). */
  lie?: number;
  /** No walk clip: hop this high (world units) while moving. */
  hop?: number;
}

/** Directions for one or both arms, in the body's own frame (+x its left, +y up, +z forward): the arm is aimed there whatever the rig's bone axes are. */
export type ArmDirs = { L?: [number, number, number]; R?: [number, number, number] };

/**
 * A tell held for the length of a wind-up. `arms` are directions the arms point at full wind. Plus how far the body
 * leans back and sinks, how much it swells, and how hard it trembles.
 */
export interface TellPose {
  arms: ArmDirs; lean: number; sink: number; swell: number; shake: number;
  /** Fraction of its height the body is crushed down by at full wind (the others grow; a low blow is the one that shrinks). */
  squat?: number;
  /** Extra lean, for a rig with no arms to raise: a beast's whole tell is its body, so it rears further than a body that has fists over its head to say the rest. */
  rear?: number;
  /** Radians the body rolls onto its side: toward +z-roll is the left shoulder dropping. */
  roll?: number;
  /** The body drags grit along the ground as it winds: the renderer lays the dust, since it knows where the enemy stands. */
  scrape?: boolean;
  /**
   * The share of the wind-up the pose takes to draw (default 1: it builds all the way to the blow). A tell the player has to
   * answer by timing has to be readable inside a reaction, so it drops into the pose early and holds it, the scrape and the tremble carrying the rest.
   */
  snap?: number;
}
/**
 * Keyed by the sim's cast kind. Heavy: both fists high over the head. Bolt: the casting hand thrown up and back.
 * Ground: both hands raised and spread, calling the mark down. Net: both arms out wide, the mesh gathered to throw.
 * Sweep: the one tell that goes DOWN. Every other wind-up gets taller (arms up, chest back, a swell); this one folds the
 * body to half height, chest forward over the knees and one arm trailing out behind at shin level, so from the side the
 * silhouette is the lowest in the game, with nothing above the shoulders. That reads as "under the feet" before it reads as anything else.
 */
export const TELLS: Record<string, TellPose> = {
  heavy: { arms: { L: [0.35, 1, -0.45], R: [-0.35, 1, -0.45] }, lean: 0.3, sink: 0.12, swell: 0.12, shake: 0.03, rear: 0.25 },
  bolt: { arms: { R: [-0.3, 1, -0.5], L: [0.25, 0.3, 1] }, lean: 0.2, sink: 0.04, swell: 0.06, shake: 0.015 },
  ground: { arms: { R: [-0.3, 1, -0.5], L: [0.3, 1, -0.5] }, lean: 0.15, sink: 0.02, swell: 0.08, shake: 0.02 },
  net: { arms: { L: [0.85, 0.25, 0.5], R: [-0.85, 0.25, 0.5] }, lean: 0.25, sink: 0.1, swell: 0.05, shake: 0.02 },
  sweep: { arms: { R: [-1, -0.75, -0.75], L: [0.3, -0.9, 0.2] }, lean: -0.45, sink: 0.2, swell: 0.08, shake: 0.008, squat: 0.34, roll: 0.22, scrape: true, snap: 0.3 },
};

/**
 * A gathering job, held for as long as the action runs: the rig works the node on the sim's own beat (GATHER_STRIKE).
 * `up` is where the arms are at the top of the raise and `down` where they are when the blow lands; `stoop` and `squat`
 * are the posture the whole job is done in (a herb patch is picked bent over it), while `lean`, `sink` and `step` are
 * spent on the blow itself and unwound through the raise. `drive` is the share of the beat spent coming down on it.
 */
export interface GatherPose { up: ArmDirs; down: ArmDirs; stoop: number; squat: number; lean: number; sink: number; step: number; drive: number; twist?: number }
/**
 * Keyed by the sim's gathering skill. A pick and an axe are both swung off the right shoulder, the body turned into the
 * raise (`twist`) and unwinding through the blow, so the arc travels diagonally across the body instead of dropping
 * straight down it. Fishing only works the rod held out over the water, and a herb is picked from a stoop, close to the
 * ground: neither is a blow, so both ride the same machine with almost nothing in it.
 */
export const GATHERS: Record<string, GatherPose> = {
  mining: { up: { L: [-0.1, 0.72, -0.5], R: [-0.5, 0.78, -0.5] }, down: { L: [0.1, -0.44, 0.84], R: [-0.2, -0.46, 0.8] }, stoop: 0.12, squat: 0.05, lean: 0.24, sink: 0.1, step: 0.14, drive: 0.38, twist: 0.4 },
  woodcutting: { up: { L: [-0.4, 0.95, -0.2], R: [-0.6, 0.85, -0.18] }, down: { L: [0.45, -0.8, 0.6], R: [0.22, -0.9, 0.5] }, stoop: 0.08, squat: 0.04, lean: 0.35, sink: 0.12, step: 0.2, drive: 0.32, twist: 0.3 },
  fishing: { up: { L: [0.24, 0.3, 0.9], R: [-0.22, 0.38, 0.88] }, down: { L: [0.26, -0.12, 0.95], R: [-0.24, -0.04, 0.96] }, stoop: 0.06, squat: 0, lean: 0.07, sink: 0.02, step: 0, drive: 0.35 },
  herbalism: { up: { L: [0.3, -0.45, 0.85], R: [-0.25, -0.5, 0.82] }, down: { L: [0.28, -0.88, 0.45], R: [-0.22, -0.9, 0.42] }, stoop: 0.55, squat: 0.18, lean: 0.14, sink: 0.05, step: 0, drive: 0.4 },
};

/**
 * The hop's own arms, in the body's frame, mirrored for the right side. The knight's Jump clip throws both of them
 * straight over the head, which reads as a cheer rather than a hop, so the arms are flown by hand for the airtime:
 * swept down and back off the push, brought forward and out as the ground comes up. `aim` runs after the mixer, so
 * everything else in the hop is still the clip's.
 */
const JUMP_ARMS: Record<'up' | 'down', [number, number, number]> = { up: [0.26, -0.93, -0.26], down: [0.34, -0.88, 0.33] };
const JUMP_ELBOW = 0.45;    // how far forward of the upper arm the forearm hangs: the arm's own bend, so it is not one stiff stick
const JUMP_ARM_FADE = 0.11; // seconds the pose takes to take the arms over, and to hand them back after touchdown

/**
 * Where a rider sits, in the fit wrapper's frame (world units): the point the hips settle on, `y` up from the feet's standing plane and `z` forward.
 * The saddle's own height is the mount's business (mount.ts); the Animator only knows how to bend a standing rig into a seat.
 */
export interface Seat { y: number; z: number }
/** The seated pose: each limb's direction in the body's frame (+x its left, +y up, +z forward), mirrored for the right. Thighs straddle, shins hang back, hands rest forward on the reins. */
const SEATED: Record<string, [number, number, number]> = {
  UpperLeg: [0.85, -0.4, 0.6], LowerLeg: [0.4, -1, -0.2], Foot: [0.05, -0.3, 1],
  UpperArm: [0.3, -0.85, 0.4], LowerArm: [0.1, -0.35, 1],
};
const SEAT_LEAN = 0.09; // radians the spine tips forward over the pommel

const FADE = 0.18;
const TWIST_END = 0.85; // clip time at which the swing's hip turn has unwound
export const LEAD = 0.06;
const LAND_FADE = 0.08; // seconds the jump clip takes to give way to locomotion on touchdown (the usual FADE is 0.18)
const DOUBLE_TUMBLE = 0.46; // seconds the double jump's somersault takes at most (it is shortened to fit a low one)
const TUMBLE_LAND = 0.12; // seconds a somersault cut short by the ground takes to finish its turn
/** The somersault's tuck, in the body's frame: knees drawn up to the chest, heels to the seat. A straight body going end over end is a falling plank. */
const TUCKED: Record<'UpperLeg' | 'LowerLeg' | 'Foot', [number, number, number]> = { UpperLeg: [0.12, -0.35, 0.93], LowerLeg: [0.08, -0.85, -0.5], Foot: [0, -0.5, 1] };
const HOP_FALL = 9.5; // how fast a plain hop is falling when it lands (u/s): a touchdown at this speed is weight 1

const smooth = (a: number) => a * a * (3 - 2 * a);
/** 0 -> 1 at `peak` (a fraction of the pulse) -> 0, eased: the shape of a flinch or a lunge. */
const envelope = (k: number, peak: number) => k <= 0 || k >= 1 ? 0 : smooth(k < peak ? k / peak : 1 - (k - peak) / (1 - peak));
const easeOutBack = (k: number) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
/** A one-shot procedural motion: `t` runs 0..dur, `amp` scales it, `dir` is a sign for sideways choices. */
interface Pulse { t: number; dur: number; peak: number; amp: number; dir: number }
const idle = (dur: number, peak: number): Pulse => ({ t: dur, dur, peak, amp: 0, dir: 1 });
const level = (p: Pulse) => envelope(p.t / p.dur, p.peak) * p.amp;
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _id = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Animator {
  readonly mixer: THREE.AnimationMixer;
  readonly clips: Map<string, THREE.AnimationClip>;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private oneShot = false;
  private holding = false; // death pose: stays until respawn
  private moving = false;
  private layer: THREE.AnimationAction | null = null;
  // procedural layer
  /** Keyed by the logical name (RIG_BONES), whatever the file calls them. */
  private bones = new Map<string, THREE.Object3D>();
  /** The node names below the spine: which of a clip's tracks the attack overlay plays over locomotion. */
  private upper = new Set<string>();
  private hit = idle(0.32, 0.22);
  private lunge = idle(0.34, 0.2);
  private land = idle(0.3, 0.25);
  private twist: Pulse = { t: TWIST_END, dur: TWIST_END, peak: 0, amp: 0, dir: 1 };
  private air = 0;      // 0..1: vertical speed while airborne, stretches the body
  private climb = 0;    // -1..1: the same, signed -- which way the hop's arms are swept
  private fall = 0;     // the fastest this hop has dropped (world units/s): how hard the touchdown lands
  private tumble = { t: 0, dur: 0, rate: 1 }; // the double jump's somersault: runs 0..dur at `rate`, idle once t >= dur
  private hopping = false; // airborne on a jump: the arms are the hop's between takeoff and touchdown
  private hopArms = 0;  // 0..1: how much of them it actually has, eased toward `hopping` so neither handover snaps
  private deadT = 0;
  private slide = 0;
  private coil = LEAD;     // seconds the body spends drawing back before the strike (the wind-up the swing was started with)
  private flip = 1;     // alternates the side of a flinch or a fall
  private phase = Math.random() * 10;
  private time = 0;
  private primed = 0;
  private wind = 0;
  private windKind: string | null = null;
  private workKind: string | null = null;
  private workK = 0;
  private stall = 0;      // hit-stop: seconds the whole rig is held on the strike frame
  private stallShiver = 0; // how hard a held rig trembles (the one that took the blow)
  private pending: { after: number; dur: number } | null = null; // a stall waiting for the strike pose to arrive
  private clipIn = 0;      // seconds until the rig's own hit clip starts (the recoil is held back with the strike)
  /** Seconds until this rig's strike pose lands: effects keyed to the blow wait for it, so nothing bursts before the sword is there. */
  strikeIn = 0;
  private seat: Seat | null = null;
  private seatBob = 0;
  private hipY = 0; // standing hip height above the feet, taken at the bind pose
  private spine?: THREE.Quaternion; // the Abdomen's bind rotation: the seated lean is set from it, never stacked on the last frame's

  constructor(private root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>, private def: AnimDef, rig: RigMap = {}) {
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(root);
    const nodes = new Map<string, THREE.Object3D>();
    root.traverse(o => { if (!nodes.has(o.name)) nodes.set(o.name, o); });
    for (const logical of RIG_BONES) {
      const o = nodes.get(rig[logical] ?? logical);
      if (o) this.bones.set(logical, o);
    }
    // The upper body is the spine and everything hanging off it -- the arms and the head, never the legs, which are
    // the pelvis's children. Read off the skeleton rather than matched by name, so a rig that spells its bones
    // differently needs nothing said about it here.
    this.bones.get('Abdomen')?.traverse(o => this.upper.add(o.name));
    const names =[def.idle, def.move, ...(def.attack ?? []).filter(n => !def.upper?.includes(n)), def.hit, def.death, def.jump].filter((n): n is string => !!n);
    for (const n of names) {
      const c = clips.get(n);
      if (c) this.actions.set(n, this.mixer.clipAction(c));
    }
    this.mixer.addEventListener('finished', e => {
      if (e.action === this.current && !this.holding) { this.oneShot = false; this.loop(); }
    });
    this.spine = this.bones.get('Abdomen')?.quaternion.clone();
    this.hipY = this.hipHeight();
    this.loop();
  }

  /** Where the hips are above the feet right now, in the wrapper's own units (the clip's pose included). 0 for a rig with no legs. */
  private hipHeight(): number {
    const legs = [this.bones.get('UpperLegL'), this.bones.get('UpperLegR')];
    if (!legs[0] || !legs[1]) return 0;
    this.root.updateWorldMatrix(true, true);
    return (this.root.worldToLocal(legs[0].getWorldPosition(_a)).y + this.root.worldToLocal(legs[1].getWorldPosition(_b)).y) / 2;
  }

  /** Every rig attacks: with no attack clip it lunges into the blow procedurally. */
  get hasAttack() { return true; }
  get hasDeath() { return this.hasDeathClip || this.def.lie !== undefined; }
  private get hasDeathClip() { return !!this.def.death && this.actions.has(this.def.death); }
  private get hasHitClip() { return !!this.def.hit && this.actions.has(this.def.hit); }

  /** Put the rig in a saddle (or stand it back up with null). Seated, it idles whatever the speed: the mount is what moves. */
  ride(seat: Seat | null) { this.seat = seat; if (!seat) this.seatBob = 0; this.loop(); }
  /** How far the saddle has risen off its rest height this frame (the mount's gait), world units. */
  rideBob(dy: number) { this.seatBob = dy; }

  /** Locomotion state, called every frame. `speed` is world units per second. */
  locomotion(moving: boolean, speed = 0) {
    this.moving = moving;
    if (this.holding || this.oneShot) return;
    this.loop(speed);
  }

  /**
   * Start the attack so that its impact frame lands `ahead` seconds from now (default LEAD: the sim applies damage this
   * tick, so the strike pose must arrive with it). A repeating swing whose timer is known passes the time left on it, so
   * the wind-up is on screen before the blow and the strike is locked to the interval. The body also steps into the blow
   * (`step` world units); with no attack clip that step is the whole attack.
   */
  attack(heavy = false, step = 0.4, ahead = LEAD): boolean {
    if (this.holding) return false;
    this.primed = 0;
    this.strikeIn = ahead;
    this.coil = Math.max(ahead, LEAD);
    this.lunge = { t: -ahead, dur: 0.34, peak: 0.2, amp: step * (heavy ? 1.4 : 1), dir: 1 };
    const names = this.def.attack?.filter(n => this.clips.has(n));
    if (!names?.length) return true;
    const name = names[heavy ? Math.min(1, names.length - 1) : 0];
    const impact = this.def.impact?.[name] ?? 0, start = Math.max(0, impact - ahead);
    if (this.def.upper?.includes(name)) {
      this.playLayer(name, start);
      this.twist = { t: start, dur: TWIST_END, peak: impact, amp: heavy ? 1.3 : 1, dir: 1 };
    } else this.play(name, { once: true, start });
    return true;
  }

  /**
   * A swing is `left` seconds away (auto-attack's timer): raise the weapon now so the blow lands on the beat. Idempotent
   * across frames; `swung()` consumes it. Without this the strike pose could only arrive with the damage, with no wind-up.
   */
  anticipate(left: number, windup = 0.4) {
    // a clip's strike frame is `impact` seconds in: starting earlier than that would land the blow before the damage does
    const clip = this.def.attack?.find(n => this.clips.has(n)), impact = clip && this.def.impact?.[clip];
    if (impact) windup = Math.min(windup, impact);
    if (this.holding || this.primed > 0 || left > windup || left <= 0) return;
    this.attack(false, 0.4, left);
    this.primed = 1.5; // seconds to wait for the swing event before treating the raise as abandoned
  }

  /** The sim swung. If the wind-up already started this cycle, it is already on its way: do not restart it. */
  swung() { if (this.primed > 0) this.primed = 0; else this.attack(false); }

  /**
   * A blow landed on this actor: a recoil sized by `strength`, plus the rig's hit clip where it has one. `after` holds the
   * recoil back until the attacker's strike pose arrives: the sim applies damage 60 ms before the sword is there.
   */
  react(strength = 1, after = 0): boolean {
    if (this.holding) return false;
    this.flip = -this.flip;
    this.hit = { t: -after, dur: 0.18 + 0.14 * strength, peak: 0.2, amp: strength, dir: this.flip };
    if (this.hasHitClip) { if (after > 0) this.clipIn = after; else this.playHit(); }
    return true;
  }

  private playHit() { this.clipIn = 0; this.play(this.def.hit!, { once: true, fade: 0.06 }); }

  /**
   * Hit-stop: hold the whole rig still for `dur` seconds, `after` seconds from now (so it starts on the strike frame, not
   * before it). The attacker holds clean; the one that took the blow also trembles (`shiver`, world units).
   */
  freeze(dur: number, after = 0, shiver = 0) {
    if (this.holding) return;
    this.stallShiver = Math.max(this.stallShiver, shiver);
    if (after > 0.005) this.pending = { after, dur: Math.max(dur, this.pending?.dur ?? 0) };
    else this.stall = Math.max(this.stall, dur);
  }

  /** Takeoff: the clip's airborne span (`jumpSpan`) is stretched over the airtime so it ends as the sim lands. */
  jump(airtime = 0.7) {
    const c = this.def.jump && this.actions.get(this.def.jump);
    if (!c || this.holding) return;
    const [from, to] = this.def.jumpSpan ?? [0, c.getClip().duration];
    this.hopping = true;
    this.play(this.def.jump!, { once: true, start: from, fade: 0.06, speed: (to - from) / airtime });
  }

  /**
   * The second takeoff, in mid-air with nothing under the feet: a hard crouch into the push (the same squash a landing
   * has, run backwards), then a forward somersault about the hips over `dur` seconds, ending upright so the descent
   * and the touchdown are the ordinary ones. `left` is the air time still to come: the jump clip (which was stretched over
   * the first hop and would run out mid-air, dropping the rig into its idle) is picked up from its airborne half and
   * stretched over what is left, so it ends as the sim lands.
   */
  doubleJump(left: number) {
    if (this.holding) return;
    this.tumble = { t: 0, dur: Math.max(0.2, Math.min(DOUBLE_TUMBLE, left * 0.8)), rate: 1 };
    this.land = { t: 0, dur: 0.1, peak: 0.25, amp: 0.45, dir: 1 };
    const c = this.def.jump && this.actions.get(this.def.jump);
    if (c) this.play(this.def.jump!, { once: true, fade: 0.08, start: c.getClip().duration * 0.3, speed: c.getClip().duration * 0.7 / left });
  }

  /**
   * Touchdown: a squash that springs back, and the jump clip hands back to locomotion. Short and shallow on purpose --
   * the hop is only about half a second, and a long recovery under it is what made a quick jump still feel heavy.
   * How deep it goes is how fast the body was falling: a hop is the baseline, a drop off a rock lands harder, and a short
   * step down barely registers. Returns that weight (1 = a hop) so the dust and the camera can be sized to it.
   */
  touchdown(): number {
    const weight = Math.min(1.7, Math.max(0.35, this.fall / HOP_FALL));
    this.air = 0; this.climb = 0; this.fall = 0; this.hopping = false;
    // ground met mid-turn (a rock, a step): finish the somersault quickly rather than snapping upright in a frame
    this.tumble.rate = Math.max(1, (this.tumble.dur - this.tumble.t) / TUMBLE_LAND);
    this.land = { t: 0, dur: 0.12 + 0.05 * weight, peak: 0.3, amp: weight * 0.6, dir: 1 };
    // a quick hand-back: the jump clip ends arms-out, and at the default fade the leap's flung arms and the run's legs share the body for a fifth of a second
    if (this.def.jump && this.current === this.actions.get(this.def.jump) && !this.holding) { this.oneShot = false; this.loop(0, LAND_FADE); }
    return weight;
  }

  /** Per-frame airborne state: vertical speed stretches the body, and sweeps the hop's arms from the push to the landing. */
  airborne(vy: number) { // the sim reports 0 whenever it is on the ground
    this.climb = Math.max(-1, Math.min(1, vy / 8));
    this.air = Math.abs(this.climb);
    this.fall = vy === 0 ? 0 : Math.max(this.fall, -vy);
  }

  /** The wind-up tell, per frame: `kind` is the sim's cast kind (null = not winding up), `k` 0..1 through the wind-up. */
  telegraph(kind: string | null, k: number) { this.windKind = kind; this.wind = kind ? k : 0; }

  /**
   * Working a node, per frame: `skill` is the sim's gathering skill (null = not gathering), `k` 0..1 through the current
   * strike's beat, 1 as the blow lands. A skill with no pose of its own simply stands and idles, as it did before.
   */
  gather(skill: string | null, k = 0) { this.workKind = skill && GATHERS[skill] ? skill : null; this.workK = k; }

  /** Death plays once and holds its last frame; `revive()` returns to locomotion. `slide` is how far the killing blow throws the body back (world units). */
  die(slide = 0): boolean {
    if (!this.hasDeath) return false;
    if (this.holding) return true;
    this.slide = slide;
    if (this.hasDeathClip) {
      // sped up to land in about a second: enemies are gone (shrunk away) two seconds after dying
      this.play(this.def.death!, { once: true, hold: true, fade: 0.12, speed: Math.max(1, this.actions.get(this.def.death!)!.getClip().duration) });
    } else { this.holding = true; this.deadT = 0; this.flip = -this.flip; } // procedural topple: applyPose drives it
    return true;
  }

  revive() {
    if (!this.holding) return;
    this.holding = false; this.oneShot = false; this.deadT = 0;
    this.loop();
  }

  update(dt: number) {
    this.strikeIn = Math.max(0, this.strikeIn - dt);
    if (this.clipIn > 0 && (this.clipIn -= dt) <= 0) this.playHit();
    if (this.pending && (this.pending.after -= dt) <= 0) { this.stall = Math.max(this.stall, this.pending.dur); this.pending = null; }
    if (this.stall > 0) { this.stall -= dt; dt = 0; if (this.stall <= 0) this.stallShiver = 0; } // held: the clock stops, the pose stays
    this.mixer.update(dt);
    const l = this.layer;
    if (l && l.isRunning() && l.time >= l.getClip().duration - 0.12) { l.fadeOut(0.12); this.layer = null; }
    this.time += dt;
    this.primed = Math.max(0, this.primed - dt);
    for (const p of [this.hit, this.lunge, this.land, this.twist]) p.t = Math.min(p.dur, p.t + dt);
    this.tumble.t = Math.min(this.tumble.dur, this.tumble.t + dt * this.tumble.rate);
    // dying in the air leaves no touchdown, so the fall is what ends the hop there
    this.hopArms += ((this.hopping && !this.holding ? 1 : 0) - this.hopArms) * Math.min(1, dt / JUMP_ARM_FADE);
    if (this.holding) this.deadT += dt;
    this.applyPose();
  }

  /**
   * Procedural pose on the fit wrapper plus bone offsets, applied after the mixer has written its frame: bone offsets add
   * to the clip rather than fight it. Rotation x is a lean (positive = forward), z a roll; position z is a step forward.
   */
  private applyPose() {
    const r = this.root, d = this.def;
    const h = level(this.hit), lg = level(this.lunge), ld = level(this.land);
    const tell = this.windKind ? TELLS[this.windKind] : undefined, w = tell ? smooth(Math.min(1, this.wind / (tell.snap ?? 1))) : 0;
    // a beast has no arms to trail and no hips to fold: crushed to half height and rolled over it reads as dying, so it only ducks its head into the low tell
    const folds = this.bones.has('UpperArmL') ? 1 : 0;
    // the fallen (no death clip): roll onto one side with a little overshoot, hopping up as it goes
    const fk = d.lie !== undefined && !this.hasDeathClip && this.holding ? Math.min(1, this.deadT / 0.5) : 0;
    const fall = fk > 0 ? easeOutBack(fk) : 0, hop = fk > 0 ? 0.3 * Math.sin(Math.PI * Math.min(1, this.deadT / 0.4)) : 0;
    const bob = d.hop && this.moving && !this.holding ? d.hop * Math.abs(Math.sin(this.time * 14 + this.phase)) : 0;
    const squash = 0.2 * ld, stretch = 0.1 * this.air;
    // anticipation: before the strike the body draws back and sinks, so the lunge that follows has somewhere to come from
    const pre = this.lunge.t < 0 ? smooth(1 + this.lunge.t / this.coil) * this.lunge.amp / 0.4 : 0;
    const shiver = this.stall > 0 ? (Math.random() - 0.5) * this.stallShiver : 0;
    const slide = this.holding ? -this.slide * (1 - Math.exp(-this.deadT * 7)) : 0; // a killing blow carries the body away from it
    // the double jump's somersault: quick off the push, easing to upright; the roll is about the hips, so the body turns in place instead of swinging round the feet
    const tk = this.tumble.t < this.tumble.dur ? this.tumble.t / this.tumble.dur : 1;
    const flipA = tk < 1 ? 2 * Math.PI * (1 - (1 - tk) ** 2.2) : 0, tuck = tk < 1 ? Math.sin(Math.PI * tk) : 0;
    const sxz = 1 + squash * 0.6 - stretch * 0.4 + (tell ? tell.swell * w : 0);
    const sy = 1 - squash + stretch - 0.06 * h - 0.08 * pre + (tell ? tell.swell * w * 0.5 - (tell.squat ?? 0) * w * (0.35 + 0.65 * folds) : 0);
    // the pivot is where the hips are this frame, not where they stand at rest: the jump clip carries the body well above its bind height
    const pivot = flipA ? this.hipHeight() * sy : 0;
    r.position.set(
      (tell ? tell.shake * w * Math.sin(this.time * 70) : 0) + shiver,
      (fk > 0 ? d.lie! * smooth(fk) + hop : 0) + bob - (tell ? tell.sink * w : 0) + (this.seat ? this.seat.y - this.hipY + this.seatBob : 0) + pivot * (1 - Math.cos(flipA)),
      lg - 0.3 * pre - 0.3 * h + slide + (this.seat?.z ?? 0) - pivot * Math.sin(flipA));
    r.rotation.set(0.15 * lg - 0.2 * pre - 0.38 * h - (tell ? (tell.lean + (tell.rear ?? 0) * (1 - folds)) * w : 0) + flipA, 0, this.hit.dir * 0.16 * h + this.flip * fall * Math.PI / 2 + (tell?.roll ? tell.roll * w * folds : 0));
    r.scale.set(sxz, sy, sxz);
    if (this.twist.t < TWIST_END) { // the swing's hip turn: wound back while the weapon is up, then through the blow and unwinding
      const t = this.twist.t, hit = this.twist.peak;
      const spin = (t < hit ? -0.3 + 0.7 * smooth(Math.max(0, t - hit + 0.22) / 0.22) : 0.4 * (1 - smooth((t - hit) / (TWIST_END - hit)))) * this.twist.amp;
      this.turn('Abdomen', 0, spin * 0.6, 0); this.turn('Torso', 0, spin * 0.6, 0);
    }
    // the hop's arms, swept from the push to the landing by how fast the body is still climbing. Before sit(): in a saddle
    // the reins win, whatever the horse is doing under the rider
    if (this.hopArms > 0.01) {
      const k = smooth((1 - this.climb) / 2), up = JUMP_ARMS.up, dn = JUMP_ARMS.down;
      const dir: [number, number, number] = [up[0] + (dn[0] - up[0]) * k, up[1] + (dn[1] - up[1]) * k, up[2] + (dn[2] - up[2]) * k];
      for (const side of ['L', 'R'] as const) {
        const mx = side === 'L' ? 1 : -1;
        this.aim(`UpperArm${side}`, `LowerArm${side}`, [dir[0] * mx, dir[1], dir[2]], this.hopArms);
        this.aim(`LowerArm${side}`, `Palm${side}`, [dir[0] * mx, dir[1], dir[2] + JUMP_ELBOW], this.hopArms * 0.9);
      }
    }
    if (tuck > 0.01) this.legs(TUCKED, smooth(Math.min(1, tuck * 1.5)));
    if (this.seat) this.sit();
    if (this.workKind) this.work(GATHERS[this.workKind]);
    if (tell && w > 0) for (const side of ['L', 'R'] as const) if (tell.arms[side]) this.aim(`UpperArm${side}`, `LowerArm${side}`, tell.arms[side]!, w);
  }

  /** Add a rotation to a bone on top of whatever the clip wrote into it. */
  private turn(name: string, x: number, y: number, z: number) {
    const b = this.bones.get(name);
    if (b) b.quaternion.multiply(_q.setFromEuler(_e.set(x, y, z)));
  }

  /**
   * The gather, on top of whatever locomotion is playing: the arms travel between the raise and the blow, and the body
   * goes with them. The fold is put through the spine rather than the fit wrapper, so a deep stoop bends at the waist
   * instead of tipping the whole rig over its feet.
   */
  private work(g: GatherPose) {
    const rise = Math.max(0.05, 1 - g.drive);
    // 1 at the top of the raise, 0 as the blow lands: eased out of the follow-through, then thrown back down accelerating.
    // The raise is held off for the first quarter of its own time and the drive leaves the top already moving, so what rest
    // there is in the beat is spent in the bite, where the tool has just stopped dead, and not at the top of the swing,
    // where standing still reads as a pause rather than as a swing.
    const x = (this.workK - rise) / g.drive;
    const mix = this.workK < rise ? smooth(Math.max(0, this.workK / rise - 0.25) / 0.75) : 1 - (0.35 * x + 0.65 * x * x);
    const blow = 1 - mix, fold = g.stoop + g.lean * blow - 0.3 * g.lean * mix;
    this.root.position.y -= g.squat + g.sink * blow;
    this.root.position.z += g.step * blow;
    this.bend(fold * 0.6);
    // the idle animates the Torso, so this one is an offset the clip writes over. The turn is wound up with the raise and
    // spent on the blow, which is what carries the head of the tool across the body rather than straight down it
    this.turn('Torso', fold * 0.4, -(g.twist ?? 0) * mix, 0);
    for (const side of ['L', 'R'] as const) {
      const a = g.up[side], b = g.down[side];
      if (!a || !b) continue;
      const dir: [number, number, number] = [a[0] * mix + b[0] * blow, a[1] * mix + b[1] * blow, a[2] * mix + b[2] * blow];
      this.aim(`UpperArm${side}`, `LowerArm${side}`, dir, 1);
      this.aim(`LowerArm${side}`, `Palm${side}`, dir, 0.85); // the elbow keeps a little of the clip's own bend
    }
  }

  /** Bend the standing rig into the saddle: legs astride, hands forward, the spine tipped over the pommel. Runs after the clip, so it holds whatever the idle is doing. */
  private sit() {
    for (const side of ['L', 'R'] as const) {
      const mx = side === 'L' ? 1 : -1, mirror = ([x, y, z]: [number, number, number]): [number, number, number] => [x * mx, y, z];
      this.aim(`UpperArm${side}`, `LowerArm${side}`, mirror(SEATED.UpperArm), 1);
      this.aim(`LowerArm${side}`, `Palm${side}`, mirror(SEATED.LowerArm), 1);
    }
    this.legs(SEATED, 1);
    this.bend(SEAT_LEAN);
  }

  /** Both legs toward `pose` (thigh, shin and toe directions in the body's frame, mirrored for the right), `weight` of the way from the clip's. */
  private legs(pose: Record<'UpperLeg' | 'LowerLeg' | 'Foot', [number, number, number]>, weight: number) {
    for (const side of ['L', 'R'] as const) {
      const mx = side === 'L' ? 1 : -1, mirror = ([x, y, z]: [number, number, number]): [number, number, number] => [x * mx, y, z];
      this.aim(`UpperLeg${side}`, `LowerLeg${side}`, mirror(pose.UpperLeg), weight);
      this.aim(`LowerLeg${side}`, `LowerLeg${side}_end`, mirror(pose.LowerLeg), weight);
      // On the human rig the foot is its own bone, not a child of the shin, so swinging the shin leaves it behind:
      // carry it to the shin's end, then point the toes. A rig where the ankle IS the foot (the two logical names
      // resolve to one joint) has already carried it, and the copy would be its own position.
      const foot = this.bones.get(`Foot${side}`), end = this.bones.get(`LowerLeg${side}_end`);
      if (foot?.parent && end && foot !== end) {
        end.updateWorldMatrix(true, false);
        foot.parent.updateWorldMatrix(true, false);
        foot.position.copy(foot.parent.worldToLocal(end.getWorldPosition(_a)));
      }
      this.aim(`Foot${side}`, `Foot${side}_end`, mirror(pose.Foot), weight);
    }
  }

  /**
   * Tip the spine forward by `lean` radians. Set from the Abdomen's bind rotation rather than stacked on the last
   * frame's, so it holds whatever the clip is doing to the spine instead of winding up over it: that is what makes the
   * seated lean and the gather's stoop independent of which clips a pack ships with spine tracks in them.
   */
  private bend(lean: number) {
    const b = this.bones.get('Abdomen');
    if (b && this.spine) b.quaternion.copy(this.spine).multiply(_q.setFromEuler(_e.set(lean, 0, 0)));
  }

  /**
   * Swing a limb bone toward `dir` (in the body's frame), `weight` of the way from where the clip has it. The limb's own
   * direction is its child bone's offset, so this needs no knowledge of the rig's axes: it works out the rotation that takes
   * where the arm points now to where it should, and applies it in world space.
   */
  private aim(boneName: string, childName: string, dir: [number, number, number], weight: number) {
    const b = this.bones.get(boneName), c = this.bones.get(childName);
    if (!b || !c || !b.parent) return;
    b.updateWorldMatrix(true, false);
    b.getWorldQuaternion(_wq);
    const now = _a.copy(c.position).normalize().applyQuaternion(_wq);
    this.root.getWorldQuaternion(_rq);
    const want = _b.set(dir[0], dir[1], dir[2]).normalize().applyQuaternion(_rq);
    _dq.setFromUnitVectors(now, want);
    _dq.slerp(_id, 1 - weight).multiply(_wq);   // world rotation of the bone after the turn
    b.parent.getWorldQuaternion(_pq);
    b.quaternion.copy(_pq.invert().multiply(_dq));
  }

  /** Upper-body overlay: the clip's torso/arm tracks at full weight over whatever locomotion is playing. */
  private playLayer(name: string, start: number) {
    const key = `${name}:upper`;
    let act = this.actions.get(key);
    if (!act) {
      const full = this.clips.get(name)!;
      act = this.mixer.clipAction(new THREE.AnimationClip(key, full.duration, full.tracks.filter(t => this.upper.has(t.name.split('.')[0]))));
      this.actions.set(key, act);
    }
    this.layer?.fadeOut(0.05);
    act.reset().setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = false;
    act.time = start;
    act.fadeIn(0.04).play();
    this.layer = act;
  }

  private loop(speed = 0, fade?: number) {
    const name = this.moving && !this.seat ? this.def.move : this.def.idle;
    const scale = this.moving && this.def.moveSpeed && speed > 0 ? speed / this.def.moveSpeed : 1;
    this.play(name, { once: false, speed: scale, fade });
  }

  private play(name: string, o: { once: boolean; start?: number; hold?: boolean; fade?: number; speed?: number }) {
    const next = this.actions.get(name);
    if (!next) return;
    if (next === this.current && !o.once) { next.timeScale = o.speed ?? 1; return; }
    next.reset();
    next.enabled = true;
    next.setLoop(o.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!o.once;
    next.time = o.start ?? 0;
    next.timeScale = o.speed ?? 1;
    const prev = this.current;
    if (prev && prev !== next) next.crossFadeFrom(prev, o.fade ?? FADE, false); else next.fadeIn(o.fade ?? FADE);
    next.play();
    this.current = next;
    this.oneShot = o.once;
    this.holding = !!o.hold;
  }
}

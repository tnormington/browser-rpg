// Skeletal animation: one AnimationMixer per animated actor, driven by state the renderer already sees.
// Rendering only. Locomotion loops cross-fade; one-shots (attack, hit, death) layer over them and hand back to locomotion.
// Where a rig ships no clip for a job (hit, death, a lunge, a wind-up tell) a procedural pose layer stands in: see applyPose.
import * as THREE from 'three';

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
  /** No death clip on this rig: it topples onto its side procedurally and lies this high off the ground (world units). */
  lie?: number;
  /** No walk clip: hop this high (world units) while moving. */
  hop?: number;
}

/**
 * A tell held for the length of a wind-up. `arms` are directions the arms point at full wind, in the body's own frame
 * (+x its left, +y up, +z forward): the arm is aimed there whatever the rig's bone axes are. Plus how far the body
 * leans back and sinks, how much it swells, and how hard it trembles.
 */
export interface TellPose { arms: { L?: [number, number, number]; R?: [number, number, number] }; lean: number; sink: number; swell: number; shake: number }
/**
 * Keyed by the sim's cast kind. Heavy: both fists high over the head. Bolt: the casting hand thrown up and back.
 * Ground: both hands raised and spread, calling the mark down. Net: both arms out wide, the mesh gathered to throw.
 */
export const TELLS: Record<string, TellPose> = {
  heavy: { arms: { L: [0.35, 1, -0.45], R: [-0.35, 1, -0.45] }, lean: 0.3, sink: 0.12, swell: 0.12, shake: 0.03 },
  bolt: { arms: { R: [-0.3, 1, -0.5], L: [0.25, 0.3, 1] }, lean: 0.2, sink: 0.04, swell: 0.06, shake: 0.015 },
  ground: { arms: { R: [-0.3, 1, -0.5], L: [0.3, 1, -0.5] }, lean: 0.15, sink: 0.02, swell: 0.08, shake: 0.02 },
  net: { arms: { L: [0.85, 0.25, 0.5], R: [-0.85, 0.25, 0.5] }, lean: 0.25, sink: 0.1, swell: 0.05, shake: 0.02 },
};

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

const UPPER_BODY = /Abdomen|Torso|Neck|Head|Shoulder|Arm|Palm|Hand|Finger|Thumb/;
const FADE = 0.18;
const TWIST_END = 0.85; // clip time at which the swing's hip turn has unwound
const LEAD = 0.06;

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
  private bones = new Map<string, THREE.Object3D>();
  private hit = idle(0.32, 0.22);
  private lunge = idle(0.34, 0.2);
  private land = idle(0.3, 0.25);
  private twist: Pulse = { t: TWIST_END, dur: TWIST_END, peak: 0, amp: 0, dir: 1 };
  private air = 0;      // 0..1: vertical speed while airborne, stretches the body
  private deadT = 0;
  private flip = 1;     // alternates the side of a flinch or a fall
  private phase = Math.random() * 10;
  private time = 0;
  private primed = 0;
  private wind = 0;
  private windKind: string | null = null;
  private seat: Seat | null = null;
  private seatBob = 0;
  private hipY = 0; // standing hip height above the feet, taken at the bind pose
  private spine?: THREE.Quaternion; // the Abdomen's bind rotation: the seated lean is set from it, never stacked on the last frame's

  constructor(private root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>, private def: AnimDef) {
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(root);
    const wanted = new Set(['Abdomen', 'Torso', 'UpperArmL', 'LowerArmL', 'UpperArmR', 'LowerArmR', 'PalmL', 'PalmR',
      'UpperLegL', 'LowerLegL', 'LowerLegL_end', 'FootL', 'FootL_end', 'UpperLegR', 'LowerLegR', 'LowerLegR_end', 'FootR', 'FootR_end']);
    root.traverse(o => { if (wanted.has(o.name) && !this.bones.has(o.name)) this.bones.set(o.name, o); });
    const names = [def.idle, def.move, ...(def.attack ?? []).filter(n => !def.upper?.includes(n)), def.hit, def.death, def.jump].filter((n): n is string => !!n);
    for (const n of names) {
      const c = clips.get(n);
      if (c) this.actions.set(n, this.mixer.clipAction(c));
    }
    this.mixer.addEventListener('finished', e => {
      if (e.action === this.current && !this.holding) { this.oneShot = false; this.loop(); }
    });
    this.spine = this.bones.get('Abdomen')?.quaternion.clone();
    const legs = ['UpperLegL', 'UpperLegR'].map(n => this.bones.get(n));
    if (legs[0] && legs[1]) {
      root.updateWorldMatrix(true, true);
      this.hipY = (root.worldToLocal(legs[0].getWorldPosition(_a)).y + root.worldToLocal(legs[1].getWorldPosition(_b)).y) / 2;
    }
    this.loop();
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
    if (this.holding || this.primed > 0 || left > windup || left <= 0) return;
    this.attack(false, 0.4, left);
    this.primed = 1.5; // seconds to wait for the swing event before treating the raise as abandoned
  }

  /** The sim swung. If the wind-up already started this cycle, it is already on its way: do not restart it. */
  swung() { if (this.primed > 0) this.primed = 0; else this.attack(false); }

  /** A blow landed on this actor: a recoil sized by `strength`, plus the rig's hit clip where it has one. */
  react(strength = 1): boolean {
    if (this.holding) return false;
    this.flip = -this.flip;
    this.hit = { t: 0, dur: 0.18 + 0.14 * strength, peak: 0.2, amp: strength, dir: this.flip };
    if (this.hasHitClip) this.play(this.def.hit!, { once: true, fade: 0.06 });
    return true;
  }

  /** Takeoff: the jump clip is stretched over the airtime so it ends as the sim lands. */
  jump(airtime = 0.7) {
    const c = this.def.jump && this.actions.get(this.def.jump);
    if (c && !this.holding) this.play(this.def.jump!, { once: true, fade: 0.06, speed: c.getClip().duration / airtime });
  }

  /**
   * Touchdown: a squash that springs back, and the jump clip hands back to locomotion. Short and shallow on purpose --
   * the hop is only about half a second, and a long recovery under it is what made a quick jump still feel heavy.
   */
  touchdown(weight = 1) {
    this.air = 0;
    this.land = { t: 0, dur: 0.17, peak: 0.3, amp: weight * 0.6, dir: 1 };
    if (this.def.jump && this.current === this.actions.get(this.def.jump) && !this.holding) { this.oneShot = false; this.loop(); }
  }

  /** Per-frame airborne state: vertical speed stretches the body. */
  airborne(vy: number) { this.air = Math.min(1, Math.abs(vy) / 8); }

  /** The wind-up tell, per frame: `kind` is the sim's cast kind (null = not winding up), `k` 0..1 through the wind-up. */
  telegraph(kind: string | null, k: number) { this.windKind = kind; this.wind = kind ? k : 0; }

  /** Death plays once and holds its last frame; `revive()` returns to locomotion. */
  die(): boolean {
    if (!this.hasDeath) return false;
    if (this.holding) return true;
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
    this.mixer.update(dt);
    const l = this.layer;
    if (l && l.isRunning() && l.time >= l.getClip().duration - 0.12) { l.fadeOut(0.12); this.layer = null; }
    this.time += dt;
    this.primed = Math.max(0, this.primed - dt);
    for (const p of [this.hit, this.lunge, this.land, this.twist]) p.t = Math.min(p.dur, p.t + dt);
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
    const tell = this.windKind ? TELLS[this.windKind] : undefined, w = tell ? smooth(Math.min(1, this.wind)) : 0;
    // the fallen (no death clip): roll onto one side with a little overshoot, hopping up as it goes
    const fk = d.lie !== undefined && !this.hasDeathClip && this.holding ? Math.min(1, this.deadT / 0.5) : 0;
    const fall = fk > 0 ? easeOutBack(fk) : 0, hop = fk > 0 ? 0.3 * Math.sin(Math.PI * Math.min(1, this.deadT / 0.4)) : 0;
    const bob = d.hop && this.moving && !this.holding ? d.hop * Math.abs(Math.sin(this.time * 14 + this.phase)) : 0;
    const squash = 0.2 * ld, stretch = 0.1 * this.air;
    r.position.set(
      tell ? tell.shake * w * Math.sin(this.time * 70) : 0,
      (fk > 0 ? d.lie! * smooth(fk) + hop : 0) + bob - (tell ? tell.sink * w : 0) + (this.seat ? this.seat.y - this.hipY + this.seatBob : 0),
      lg - 0.3 * h + (this.seat?.z ?? 0));
    r.rotation.set(0.15 * lg - 0.38 * h - (tell ? tell.lean * w : 0), 0, this.hit.dir * 0.16 * h + this.flip * fall * Math.PI / 2);
    const sxz = 1 + squash * 0.6 - stretch * 0.4 + (tell ? tell.swell * w : 0);
    r.scale.set(sxz, 1 - squash + stretch - 0.06 * h + (tell ? tell.swell * w * 0.5 : 0), sxz);
    const bone = (name: string, x: number, y: number, z: number) => {
      const b = this.bones.get(name);
      if (b) b.quaternion.multiply(_q.setFromEuler(_e.set(x, y, z)));
    };
    if (this.twist.t < TWIST_END) { // the swing's hip turn: wound back while the weapon is up, then through the blow and unwinding
      const t = this.twist.t, hit = this.twist.peak;
      const spin = (t < hit ? -0.3 + 0.7 * smooth(Math.max(0, t - hit + 0.22) / 0.22) : 0.4 * (1 - smooth((t - hit) / (TWIST_END - hit)))) * this.twist.amp;
      bone('Abdomen', 0, spin * 0.6, 0); bone('Torso', 0, spin * 0.6, 0);
    }
    if (this.seat) this.sit();
    if (tell && w > 0) for (const side of ['L', 'R'] as const) if (tell.arms[side]) this.aim(`UpperArm${side}`, `LowerArm${side}`, tell.arms[side]!, w);
  }

  /** Bend the standing rig into the saddle: legs astride, hands forward, the spine tipped over the pommel. Runs after the clip, so it holds whatever the idle is doing. */
  private sit() {
    for (const side of ['L', 'R'] as const) {
      const mx = side === 'L' ? 1 : -1, mirror = ([x, y, z]: [number, number, number]): [number, number, number] => [x * mx, y, z];
      this.aim(`UpperLeg${side}`, `LowerLeg${side}`, mirror(SEATED.UpperLeg), 1);
      this.aim(`LowerLeg${side}`, `LowerLeg${side}_end`, mirror(SEATED.LowerLeg), 1);
      // the foot is its own bone, not a child of the shin: carry it to the shin's end, then point the toes
      const foot = this.bones.get(`Foot${side}`), end = this.bones.get(`LowerLeg${side}_end`);
      if (foot?.parent && end) {
        end.updateWorldMatrix(true, false);
        foot.parent.updateWorldMatrix(true, false);
        foot.position.copy(foot.parent.worldToLocal(end.getWorldPosition(_a)));
      }
      this.aim(`Foot${side}`, `Foot${side}_end`, mirror(SEATED.Foot), 1);
      this.aim(`UpperArm${side}`, `LowerArm${side}`, mirror(SEATED.UpperArm), 1);
      this.aim(`LowerArm${side}`, `Palm${side}`, mirror(SEATED.LowerArm), 1);
    }
    const b = this.bones.get('Abdomen');
    if (b && this.spine) b.quaternion.copy(this.spine).multiply(_q.setFromEuler(_e.set(SEAT_LEAN, 0, 0)));
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
      act = this.mixer.clipAction(new THREE.AnimationClip(key, full.duration, full.tracks.filter(t => UPPER_BODY.test(t.name))));
      this.actions.set(key, act);
    }
    this.layer?.fadeOut(0.05);
    act.reset().setLoop(THREE.LoopOnce, 1);
    act.clampWhenFinished = false;
    act.time = start;
    act.fadeIn(0.04).play();
    this.layer = act;
  }

  private loop(speed = 0) {
    const name = this.moving && !this.seat ? this.def.move : this.def.idle;
    const scale = this.moving && this.def.moveSpeed && speed > 0 ? speed / this.def.moveSpeed : 1;
    this.play(name, { once: false, speed: scale });
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

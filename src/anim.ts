// Skeletal animation: one AnimationMixer per animated actor, driven by state the renderer already sees.
// Rendering only. Locomotion loops cross-fade; one-shots (attack, hit, death) layer over them and hand back to locomotion.
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
}

const UPPER_BODY = /Abdomen|Torso|Neck|Head|Shoulder|Arm|Palm|Hand|Finger|Thumb/;
const FADE = 0.18;
const LEAD = 0.06;

export class Animator {
  readonly mixer: THREE.AnimationMixer;
  readonly clips: Map<string, THREE.AnimationClip>;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private oneShot = false;
  private holding = false; // death pose: stays until respawn
  private moving = false;
  private layer: THREE.AnimationAction | null = null;

  constructor(root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>, private def: AnimDef) {
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(root);
    const names = [def.idle, def.move, ...(def.attack ?? []).filter(n => !def.upper?.includes(n)), def.hit, def.death].filter((n): n is string => !!n);
    for (const n of names) {
      const c = clips.get(n);
      if (c) this.actions.set(n, this.mixer.clipAction(c));
    }
    this.mixer.addEventListener('finished', e => {
      if (e.action === this.current && !this.holding) { this.oneShot = false; this.loop(); }
    });
    this.loop();
  }

  get hasAttack() { return !!this.def.attack?.some(n => this.clips.has(n)); }
  get hasHit() { return !!this.def.hit && this.actions.has(this.def.hit); }
  get hasDeath() { return !!this.def.death && this.actions.has(this.def.death); }

  /** Locomotion state, called every frame. `speed` is world units per second. */
  locomotion(moving: boolean, speed = 0) {
    this.moving = moving;
    if (this.holding || this.oneShot) return;
    this.loop(speed);
  }

  /** Start the attack clip so that its impact frame lands now. Returns false when this actor has no attack clip. */
  attack(heavy = false): boolean {
    const names = this.def.attack?.filter(n => this.clips.has(n));
    if (!names?.length || this.holding) return false;
    const name = names[heavy ? Math.min(1, names.length - 1) : 0];
    const start = Math.max(0, (this.def.impact?.[name] ?? 0) - LEAD);
    if (this.def.upper?.includes(name)) this.playLayer(name, start); else this.play(name, { once: true, start });
    return true;
  }

  react(): boolean {
    if (!this.hasHit || this.holding) return false;
    this.play(this.def.hit!, { once: true, fade: 0.06 });
    return true;
  }

  /** Death plays once and holds its last frame; `revive()` returns to locomotion. */
  die(): boolean {
    if (!this.hasDeath) return false;
    // sped up to land in about a second: enemies are gone (shrunk away) two seconds after dying
    if (!this.holding) this.play(this.def.death!, { once: true, hold: true, fade: 0.12, speed: Math.max(1, this.actions.get(this.def.death!)!.getClip().duration) });
    return true;
  }

  revive() {
    if (!this.holding) return;
    this.holding = false; this.oneShot = false;
    this.loop();
  }

  update(dt: number) {
    this.mixer.update(dt);
    const l = this.layer;
    if (l && l.isRunning() && l.time >= l.getClip().duration - 0.12) { l.fadeOut(0.12); this.layer = null; }
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
    const name = this.moving ? this.def.move : this.def.idle;
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

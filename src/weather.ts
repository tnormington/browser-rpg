// Weather as a small random walk over four states, eased rather than cut. Render-side only: the sim never sees it, and it
// uses Math.random by default (the rules stay deterministic). No Three.js here, so it can be tested under tsx.

export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'fog';

/** What a weather looks like. Every field is a number so the whole set eases by plain interpolation. */
export interface WeatherLook {
  /** Cloud coverage, 0 (wisps) .. 1 (solid lid). */
  cover: number;
  /** Rain intensity, 0..1. */
  rain: number;
  /** How hard the air is moving, 0..1: nothing is drawn from it, it is what the weather sounds like (WEATHER_BEDS in ambience.ts). */
  wind: number;
  /** Multipliers on the daylight values (sun, hemisphere, sky environment). */
  sun: number; hemi: number; env: number;
  /** Fog distances; the fog colour lifts toward a pale cold grey by `lift` (0..1). */
  fogNear: number; fogFar: number; lift: number;
}

/** Sits at the clear-night values render.ts started from (FOG 6..42): `clear` changes nothing, the rest only take things away. */
export const WEATHER: Record<WeatherKind, WeatherLook> = {
  clear:    { cover: 0.38, rain: 0, wind: 0,    sun: 1,    hemi: 1,    env: 1,    fogNear: 6, fogFar: 42, lift: 0 },
  overcast: { cover: 0.82, rain: 0, wind: 0.45, sun: 0.6,  hemi: 0.9,  env: 0.85, fogNear: 6, fogFar: 36, lift: 0.15 },
  rain:     { cover: 0.97, rain: 1, wind: 0.75, sun: 0.4,  hemi: 0.8,  env: 0.75, fogNear: 4, fogFar: 28, lift: 0.22 },
  fog:      { cover: 0.62, rain: 0, wind: 0.08, sun: 0.45, hemi: 0.9,  env: 0.9,  fogNear: 2, fogFar: 18, lift: 0.5 },
};

/** Who can follow whom: the weather moves through overcast, it does not jump from a clear sky to a downpour. */
const NEXT: Record<WeatherKind, WeatherKind[]> = {
  clear: ['overcast', 'overcast', 'fog'],
  overcast: ['clear', 'rain', 'rain', 'fog'],
  rain: ['overcast', 'overcast', 'clear'],
  fog: ['clear', 'overcast'],
};

/** Seconds a weather holds before the next is picked, and the easing time constant (~3x it to settle). */
export const DWELL = { min: 70, max: 170 };
export const EASE_TAU = 7;

export class Weather {
  kind: WeatherKind;
  /** The eased, currently-visible look. */
  readonly look: WeatherLook;
  private hold: number;

  constructor(private rnd: () => number = Math.random, start?: WeatherKind) {
    this.kind = start ?? (['clear', 'clear', 'overcast', 'fog', 'rain'] as const)[Math.floor(rnd() * 5)];
    this.look = { ...WEATHER[this.kind] };
    this.hold = this.dwell();
  }

  private dwell() { return DWELL.min + this.rnd() * (DWELL.max - DWELL.min); }

  /** Pin to a weather now (debug, tests, the bench): `snap` skips the ease. */
  set(kind: WeatherKind, snap = false) {
    this.kind = kind;
    this.hold = this.dwell();
    if (snap) Object.assign(this.look, WEATHER[kind]);
  }

  update(dt: number) {
    this.hold -= dt;
    if (this.hold <= 0) {
      const options = NEXT[this.kind];
      this.set(options[Math.floor(this.rnd() * options.length)]);
    }
    const k = 1 - Math.exp(-dt / EASE_TAU), target = WEATHER[this.kind];
    for (const key of Object.keys(target) as (keyof WeatherLook)[]) this.look[key] += (target[key] - this.look[key]) * k;
  }
}

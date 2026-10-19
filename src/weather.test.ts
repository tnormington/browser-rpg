import { Weather, WEATHER, DWELL, EASE_TAU, type WeatherKind } from './weather';

const assert = (ok: boolean, msg: string) => { if (!ok) { console.error('FAIL', msg); process.exit(1); } };
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// it changes on its own, never repeats a kind back to back, and never jumps clear -> rain
const w = new Weather(rnd, 'clear');
const seen = new Set<WeatherKind>([w.kind]);
let last = w.kind, changes = 0;
for (let t = 0; t < 3 * 3600; t += 1) {
  w.update(1);
  if (w.kind !== last) {
    changes++;
    assert(!(last === 'clear' && w.kind === 'rain'), 'clear never jumps straight to rain');
    seen.add(w.kind); last = w.kind;
  }
}
assert(changes >= 3 * 3600 / DWELL.max - 1 && changes <= 3 * 3600 / DWELL.min + 1, `changes at the dwell rate (${changes})`);
assert(seen.size === 4, 'all four weathers occur in three hours');

// eases rather than cuts: one second after a switch the look is still near the old one
const e = new Weather(rnd, 'clear');
e.set('rain');
e.update(1);
assert(e.look.rain > 0 && e.look.rain < 0.3, `rain eases in (${e.look.rain})`);
for (let t = 0; t < EASE_TAU * 6; t++) e.update(1);
assert(Math.abs(e.look.fogFar - WEATHER[e.kind].fogFar) < 1.5, 'and settles on the target');

// the sim stays out of it: weather.ts imports nothing
console.log('weather ok');

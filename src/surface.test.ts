// surface.ts under tsx: the UV projection (the half that is plain geometry and testable without a canvas) and the guard
// that keeps the canvas work out of a headless run.
import * as THREE from 'three';
import { GROUND_CELL, bakeUV, groundDrift, hasSurface, surfaceFor } from './surface';

const assert = (ok: boolean, msg: string) => { if (!ok) { console.error('FAIL', msg); process.exit(1); } };

// no canvas in node: a material asks for maps and is told there are none, rather than throwing
assert(surfaceFor('ground') === null, 'no maps without a document');
assert(surfaceFor('glow') === null, 'and none for a class that has no surface');
assert(hasSurface('ground') && hasSurface('roof') && hasSurface('plaster'), 'the world classes have surfaces');
// HOM-117 follow-up: everything that is a thing has a surface, trees and mineral nodes included; only lights do not
assert(hasSurface('bark') && hasSurface('ore') && hasSurface('coal') && hasSurface('gem') && hasSurface('skin'), 'bark, ore, coal, gem and skin have surfaces too');
assert(!hasSurface('glow') && !hasSurface('beacon') && !hasSurface('dark'), 'emitters and the unlit ground marks stay clean');

// every material class the renderer knows is either dressed or deliberately bare: nothing falls through the gap
for (const cls of ['ground', 'dirt', 'foliage', 'wood', 'bark', 'rock', 'stone', 'plaster', 'roof', 'metal', 'ore', 'coal', 'cloth', 'skin', 'hide', 'gem'])
  assert(hasSurface(cls), `${cls} has a surface`);

// an empty geometry stood up only to carry a material is left alone
assert(!bakeUV(new THREE.BufferGeometry()).attributes.uv, 'an empty geometry gets no UVs');

/** The span of a geometry's UVs, in world units. */
function uvSpan(g: THREE.BufferGeometry) {
  const uv = g.attributes.uv;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i));
    v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i));
  }
  return [u1 - u0, v1 - v0];
}

// one UV unit is one world unit: a 2 x 2 x 2 box spans 2 both ways, a 6 x 6 x 6 box spans 6, whatever the mesh's own size
for (const side of [2, 6, 0.5]) {
  const [su, sv] = uvSpan(bakeUV(new THREE.BoxGeometry(side, side, side).toNonIndexed()));
  assert(Math.abs(su - side) < 1e-5 && Math.abs(sv - side) < 1e-5, `a ${side}-unit box spans ${side} in UV (${su}, ${sv})`);
}

// a model still in its file's units takes its fit scale, so a knight's texels are the size of the ground's
const [ku, kv] = uvSpan(bakeUV(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 2.5));
assert(Math.abs(ku - 2.5) < 1e-5 && Math.abs(kv - 2.5) < 1e-5, `a 1-unit box fitted to 2.5 spans 2.5 in UV (${ku}, ${kv})`);

// ...and a wall twice as wide as it is tall spans twice as far across as up: no stretching to fit
const [wu, wv] = uvSpan(bakeUV(new THREE.BoxGeometry(8, 4, 0.2).toNonIndexed()));
assert(Math.abs(wu - 8) < 1e-5 && Math.abs(wv - 4) < 1e-5, `an 8 x 4 wall spans 8 x 4 (${wu}, ${wv})`);

// the ground: an indexed plane laid flat projects off y, so UVs are its x and z and the grain does not stretch
const plane = bakeUV(new THREE.PlaneGeometry(20, 20, 4, 4).rotateX(-Math.PI / 2));
assert(!!plane.index, 'the ground plane stays indexed');
const [pu, pv] = uvSpan(plane);
assert(Math.abs(pu - 20) < 1e-5 && Math.abs(pv - 20) < 1e-5, `a 20-unit floor spans 20 (${pu}, ${pv})`);

// placement carries into the UVs rather than being normalised away, so a merged slab's parts each keep their own texels
const moved = bakeUV(new THREE.BoxGeometry(2, 2, 2).toNonIndexed().translate(100, 0, -40));
let far = false;
for (let i = 0; i < moved.attributes.uv.count; i++) far ||= Math.abs(moved.attributes.uv.getX(i)) > 39;
assert(far, 'a placed part carries its placement in its UVs');

// a facet of a lump leaning every which way still gets texels its own size: projecting off the *dominant* axis can
// shorten an edge, but never past 0.816 of it (the worst a face can lean is a normal down (1,1,1)) and never stretch it
const tri = bakeUV(new THREE.DodecahedronGeometry(1.6));
const uv = tri.attributes.uv, pos = tri.attributes.position;
for (let t = 0; t + 2 < pos.count; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
  const len = Math.hypot(pos.getX(t + b) - pos.getX(t + a), pos.getY(t + b) - pos.getY(t + a), pos.getZ(t + b) - pos.getZ(t + a));
  const flat = Math.hypot(uv.getX(t + b) - uv.getX(t + a), uv.getY(t + b) - uv.getY(t + a));
  assert(flat <= len + 1e-6 && flat >= len * 0.8, `edge ${t / 3}.${a} keeps its scale (${flat.toFixed(3)} of ${len.toFixed(3)})`);
}

// HOM-122: the ground's drift. The floors carry it in their vertex tint, so it has to behave like a tint — in range,
// the same every load, and actually varying over the thirty-odd units a player can see.
const SAMPLES: [number, number][] = [];
for (let x = -60; x < 2000; x += 7.3) for (let z = -60; z < 1100; z += 11.7) SAMPLES.push([x, z]);
let lo = 1, hi = 0, sum = 0;
for (const [x, z] of SAMPLES) { const v = groundDrift(x, z); lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
assert(lo >= 0 && hi <= 1, `the drift stays in 0..1 (${lo.toFixed(3)}..${hi.toFixed(3)})`);
assert(lo < 0.15 && hi > 0.85, `and uses the range a flat hash would (${lo.toFixed(3)}..${hi.toFixed(3)})`);
assert(Math.abs(sum / SAMPLES.length - 0.5) < 0.05, `without crowding the middle or either end (mean ${(sum / SAMPLES.length).toFixed(3)})`);
assert(groundDrift(123.5, 77.25) === groundDrift(123.5, 77.25), 'the same point drifts the same every time: no rng state, no reload flicker');
assert(groundDrift(123.5, 77.25) !== groundDrift(123.5, 77.25, 7), 'a seed picks an independent field, so worn turf and peat are not the same patch');

// the thing the card is about: within one screen the floor must change, and it must not come back to the same value on a
// grid. Both are measured down a line a camera's width long, sampled at the spacing the floors are actually cut at.
const line = Array.from({ length: 40 }, (_, i) => groundDrift(400 + i * GROUND_CELL, 300));
assert(Math.max(...line) - Math.min(...line) > 0.4, `one screen of floor spans a visible range (${(Math.max(...line) - Math.min(...line)).toFixed(3)})`);
for (const period of [3, 4, 6, 8, 12, 16, 20]) {   // every stride a tile could repeat at, in vertices
  let same = 0;
  for (let i = 0; i + period < line.length; i++) if (Math.abs(line[i] - line[i + period]) < 0.02) same++;
  assert(same < (line.length - period) * 0.5, `the floor does not repeat every ${period} vertices (${same} matches)`);
}
// and the mesh is cut fine enough to carry the finest scale in the field (3.5 units): two vertices to a feature, at least
assert(GROUND_CELL <= 3.5 / 2, `a floor's vertices (every ${GROUND_CELL}) can sample the drift's finest scale`);

console.log('surface ok');

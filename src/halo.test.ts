// halo.ts under tsx: the emissive budget a halo has to sit inside (glow.ts), and the billboard quads it builds.
import * as THREE from 'three';
import { BLOOM_THRESHOLD, EMISSIVE_CAP, linearPeak } from './glow';
import { HALOS, HaloId, HaloSpot, haloMesh } from './halo';

const assert = (ok: boolean, msg: string) => { if (!ok) { console.error('FAIL', msg); process.exit(1); } };

// The budget, from both sides. A halo's peak is its colour x strength at the brightest the flicker takes it:
//  - under the bloom threshold, so a halo over the dark ground is a glow and not a white disc;
//  - but enough that, over an emitter already at the cap, the two together cross it, which is what makes the core bloom.
for (const id of Object.keys(HALOS) as HaloId[]) {
  const k = HALOS[id], peak = linearPeak(k.color) * k.strength * (1 + k.flicker);
  assert(peak < BLOOM_THRESHOLD, `${id} halo alone stays under the bloom threshold (${peak.toFixed(2)})`);
  assert(EMISSIVE_CAP + peak > BLOOM_THRESHOLD, `${id} halo lifts a capped emitter over it (${(EMISSIVE_CAP + peak).toFixed(2)})`);
  assert(k.radius > 0 && k.flicker >= 0, `${id} has a size and a flicker`);
}

// nothing to draw: nothing added to the scene
assert(haloMesh([]) === null, 'an empty list builds no mesh');

const spots: HaloSpot[] = [{ id: 'torch', x: 4, y: 2.5, z: -7 }, { id: 'brazier', x: -16, y: 1.2, z: -38, scale: 0.8 }];
const m = haloMesh(spots)!;
const g = m.geometry, pos = g.attributes.position, corner = g.attributes.corner, radius = g.attributes.radius;
assert(pos.count === 8 && g.index!.count === 12, `two halos are two quads (${pos.count} verts, ${g.index!.count} indices)`);

// every vertex of a quad sits at its halo's centre: the corner offset is the shader's to apply, in view space
spots.forEach((s, i) => {
  for (let v = 0; v < 4; v++) {
    const j = i * 4 + v;
    assert(Math.hypot(pos.getX(j) - s.x, pos.getY(j) - s.y, pos.getZ(j) - s.z) < 1e-6, `halo ${i} vertex ${v} is at its centre`);
    assert(Math.abs(radius.getX(j) - HALOS[s.id].radius * (s.scale ?? 1)) < 1e-6, `halo ${i} vertex ${v} carries its scaled radius`);
  }
  const corners = new Set(Array.from({ length: 4 }, (_, v) => `${corner.getX(i * 4 + v)},${corner.getY(i * 4 + v)}`));
  assert(corners.size === 4, `halo ${i} has four distinct corners`);
});

// the quads reach a radius past their centres, so the bounding sphere has to as well or a halo pops out at the frame's edge
const bs = g.boundingSphere!;
for (const s of spots) {
  const r = HALOS[s.id].radius * (s.scale ?? 1);
  const d = Math.hypot(s.x - bs.center.x, s.y - bs.center.y, s.z - bs.center.z);
  assert(d + r <= bs.radius + 1e-5, `halo at ${s.x},${s.z} is inside the bounding sphere (${(d + r).toFixed(2)} of ${bs.radius.toFixed(2)})`);
}

// two halos in one mesh flicker out of step: a row of torches that pulsed together would read as one light
assert(g.attributes.flick.getY(0) !== g.attributes.flick.getY(4), 'neighbouring halos take different phases');

// additive, never written to depth, and not in the way of a click
const mat = m.material as THREE.Material;
assert(mat.blending === THREE.AdditiveBlending && !mat.depthWrite, 'halos are additive and depth-read only');
assert(m.renderOrder === 2, 'halos draw after the lamp pools on the ground');

console.log('halo ok');

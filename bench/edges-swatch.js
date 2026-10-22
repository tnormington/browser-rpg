// Served by vite to bench/edges.mjs: lays a recipe's pieces along a stretch of ground the way the real placer will, on the app's own three.
// Local +z (outward) maps to world -z, so a camera at +z looks out through the edge.
import * as THREE from 'three';
import { edgeRecipe } from '/src/edges.ts';
import { nextRandom } from '/src/sim/rng.ts';

const ROUGH = { ground: 0.95, foliage: 0.85, wood: 0.8, bark: 0.95, rock: 0.9, stone: 0.85, gem: 0.3 };

export function layEdge(scene, kind, seed, cx, z0, len) {
  const rc = edgeRecipe(kind), box = { rng: seed };
  const jobs = rc.pieces.map(() => []);
  for (let r = 0; r < rc.ranks; r++) {
    const zr = rc.ranks > 1 ? (r * rc.depth) / (rc.ranks - 1) : 0;
    for (let x = -len / 2; x < len / 2; x += rc.spacing[0] + nextRandom(box) * (rc.spacing[1] - rc.spacing[0])) {
      if (nextRandom(box) < rc.gap) continue;
      const v = Math.floor(nextRandom(box) * rc.pieces.length), s = rc.scale[0] + nextRandom(box) * (rc.scale[1] - rc.scale[0]);
      const yaw = rc.yaw === 'free' ? nextRandom(box) * Math.PI * 2 : (nextRandom(box) - 0.5) * 0.7;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx + x, -nextRandom(box) * rc.sink, z0 - zr - nextRandom(box) * 1.2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + yaw, 0)), new THREE.Vector3(s, s * (0.9 + nextRandom(box) * 0.25), s));
      jobs[v].push({ m, shade: (1 - rc.rankShade * r) * (1 + (nextRandom(box) - 0.5) * 2 * rc.colorJitter) });
    }
  }
  let draws = 0, tris = 0;
  jobs.forEach((list, v) => {
    if (!list.length) return;
    for (const l of rc.pieces[v].layers) {
      const mat = new THREE.MeshStandardMaterial({ color: l.color, roughness: ROUGH[l.cls] ?? 0.9, metalness: 0, flatShading: true });
      const im = new THREE.InstancedMesh(l.geometry, mat, list.length);
      list.forEach((j, i) => { im.setMatrixAt(i, j.m); im.setColorAt(i, new THREE.Color().setScalar(j.shade)); });
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      scene.add(im); draws++; tris += list.length * (l.geometry.attributes.position.count / 3);
    }
  });
  return { draws, tris };
}

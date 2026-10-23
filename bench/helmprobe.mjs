// Where the helm model and the skull land IN THE SPACE buildHead's overlay literals are written in (the `w` group,
// HEAD_FIT units), so the ladder's brow, crest, horns and nape plate are measured off the armet rather than guessed.
// gearprobe.mjs answers the same question in world units for every slot; this one answers it in the helm group's,
// which is the only space the numbers in buildHead can be read against.   node bench/helmprobe.mjs [headItem]
import { spawnSync } from 'node:child_process';
const item = process.argv[2] ?? 'iron_helm';
const js = `
look(0,0,0,0.1,4); const e=__debug.sim.player.equipment;
Object.assign(e, { head:${JSON.stringify(item)}, chest:null, legs:null, hands:null, feet:null });
await wait(800);
const S = __debug.view.scene, M = __debug.view.scene.matrixWorld.constructor;
const V = c => new c.position.constructor();
const mk = () => ({ min:[1e9,1e9,1e9], max:[-1e9,-1e9,-1e9] });
const grow = (b,v) => { for (let i=0;i<3;i++){ b.min[i]=Math.min(b.min[i],v[i]); b.max[i]=Math.max(b.max[i],v[i]); } };
const fin = b => b.min[0] > 1e8 ? null : ({ min:b.min.map(v=>+v.toFixed(3)), max:b.max.map(v=>+v.toFixed(3)),
  size:[0,1,2].map(i=>+(b.max[i]-b.min[i]).toFixed(3)), mid:[0,1,2].map(i=>+((b.max[i]+b.min[i])/2).toFixed(3)) });
const near = name => { let best=1e9, hit=null; S.traverse(o => { if (o.isBone && o.name===name) { const p=o.getWorldPosition(V(o)); const d=p.x*p.x+p.z*p.z; if (d<best){best=d;hit=o;} } }); return hit; };
const head = near('head') || near('Head');
head.updateWorldMatrix(true, true);

// g is the group gear.ts mounted on Head; w is its generated-geometry child -- the smaller-scaled of the two, and the
// space every literal in buildHead is written in.
const g = head.children.find(c => c.isGroup && c.children.some(k => k.isGroup || k.isMesh));
const w = [...g.children].filter(c => c.isGroup || c.isObject3D).sort((a,b) => a.scale.x - b.scale.x)[0];
const inv = new M().copy(w.matrixWorld).invert();
const into = (b, c) => { const m = new M().multiplyMatrices(inv, c.matrixWorld).elements, p = c.geometry.attributes.position;
  for (let i=0;i<p.count;i++){ const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    grow(b,[m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]]); } };

const model = mk(), gen = mk(), skull = mk();
head.traverse(c => {
  if (!c.isMesh || c.isSkinnedMesh) return;
  const mats = Array.isArray(c.material) ? c.material : [c.material];
  into(mats.some(m => m && m.name === 'Grey') ? model : gen, c);
});
// the skull, skinned into its pose, brought into the same space
S.traverse(c => {
  if (!c.isSkinnedMesh || !/Head/i.test(c.name)) return;
  const m = new M().multiplyMatrices(inv, c.matrixWorld), p = c.geometry.attributes.position;
  for (let i=0;i<p.count;i++) {
    const t = V(head).set(p.getX(i), p.getY(i), p.getZ(i));
    (c.applyBoneTransform ? c.applyBoneTransform(i, t) : c.boneTransform(i, t));
    t.applyMatrix4(m); grow(skull, [t.x, t.y, t.z]);
  }
});
// the shell's profile, not just its box: front, back and side reach in bands of y, so a slab or a bar laid on the
// visor can be put where the visor actually is rather than where the box says it ends
const bands = [];
for (let y = -0.45; y < 0.33; y += 0.1) bands.push({ y: +y.toFixed(2), zMax: -9, zMin: 9, xMax: -9 });
head.traverse(c => {
  if (!c.isMesh || c.isSkinnedMesh) return;
  const mats = Array.isArray(c.material) ? c.material : [c.material];
  if (!mats.some(m => m && m.name === 'Grey')) return;
  const m = new M().multiplyMatrices(inv, c.matrixWorld).elements, p = c.geometry.attributes.position;
  for (let i=0;i<p.count;i++){ const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const wy = m[1]*x+m[5]*y+m[9]*z+m[13], wz = m[2]*x+m[6]*y+m[10]*z+m[14], wx = m[0]*x+m[4]*y+m[8]*z+m[12];
    const b = bands[Math.floor((wy + 0.45) / 0.1)]; if (!b) continue;
    b.zMax = Math.max(b.zMax, wz); b.zMin = Math.min(b.zMin, wz); b.xMax = Math.max(b.xMax, Math.abs(wx)); }
});
const prof = bands.filter(b => b.zMax > -9).map(b => 'y' + b.y + ' z[' + b.zMin.toFixed(2) + ',' + b.zMax.toFixed(2) + '] |x|<=' + b.xMax.toFixed(2));
return [['wScale', w.scale.x], ['skull', fin(skull)], ['helmModel', fin(model)], ['overlays', fin(gen)], ['profile', prof]]
  .map(([k,v]) => k + ' ' + JSON.stringify(v)).join('\\n');
`;
const r = spawnSync('node', ['bench/look.mjs', 'helmprobe', js], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SHOTS: 'probe' } });
process.exit(r.status ?? 1);

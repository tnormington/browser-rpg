// Measurement, so the seating numbers in gear.ts are taken off the rig rather than guessed: where each mount bone sits
// in world units, and the box of the body each piece is built over.   node bench/gearprobe.mjs
import { spawnSync } from 'node:child_process';
const js = `
look(0,0,0,0.1,4); const e=__debug.sim.player.equipment;
Object.assign(e, { head:'steel_helm', chest:'steel_chestplate', legs:'steel_greaves', hands:'hide_gloves', feet:'hide_boots' });
await wait(700);
const S = __debug.view.scene;
const V = c => new c.position.constructor();
const mk = () => ({ min:[1e9,1e9,1e9], max:[-1e9,-1e9,-1e9] });
const grow = (b,v) => { for (let i=0;i<3;i++){ b.min[i]=Math.min(b.min[i],v[i]); b.max[i]=Math.max(b.max[i],v[i]); } };
const fin = b => ({ min:b.min.map(v=>+v.toFixed(3)), max:b.max.map(v=>+v.toFixed(3)) });
// the player's rig: the bone nearest the origin, where the player stands
const near = name => { let best=1e9, hit=null; S.traverse(o => { if (o.isBone && o.name===name) { const p=o.getWorldPosition(V(o)); const d=p.x*p.x+p.z*p.z; if (d<best){best=d;hit=o;} } }); return hit; };
const out = { bones: {} };
for (const n of ['Head','Torso','Neck','LowerLegL','PalmL','FootL']) { const b = near(n); if (b) { const p=b.getWorldPosition(V(b)); out.bones[n] = [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; } }
// the knight's own meshes, skinned into the bind pose
const torso = near('Torso');
let rig = torso; while (rig.parent && rig.parent.name !== 'RootNode') rig = rig.parent;
const boxes = {};
rig.parent.traverse(c => {
  if (!c.isSkinnedMesh) return;
  const g = c.geometry, p = g.attributes.position, b = boxes[c.material.name] ??= mk();
  for (let i=0;i<p.count;i++) {
    const t = new (torso.position.constructor)(p.getX(i), p.getY(i), p.getZ(i));
    (c.applyBoneTransform ? c.applyBoneTransform(i, t) : c.boneTransform(i, t));
    t.applyMatrix4(c.matrixWorld);
    grow(b, [t.x, t.y, t.z]);
  }
});
for (const k of Object.keys(boxes)) boxes[k] = fin(boxes[k]);
out.body = boxes;
// and the mounted gear, per bone, so a built part can be checked against the shell it sits on
const gearBox = bone => { const b = mk(); bone.updateWorldMatrix(true,true); bone.traverse(c => { if (!c.isMesh) return; const p=c.geometry.attributes.position, m=c.matrixWorld.elements;
  for (let i=0;i<p.count;i++){ const x=p.getX(i),y=p.getY(i),z=p.getZ(i); grow(b,[m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]]); } }); return fin(b); };
out.gear = { head: gearBox(near('Head')), torso: gearBox(near('Torso')), shin: gearBox(near('LowerLegL')) };
return JSON.stringify(out);
`;
const r = spawnSync('node', ['bench/look.mjs', 'gp', js], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SHOTS: 'probe' } });
process.exit(r.status ?? 1);

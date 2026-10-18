#!/bin/sh
# The two numbers behind every bloom blowout (see src/glow.ts). Run `npm run build` first. Zero offenders under each header = clean.
#   1. emissive materials whose peak linear channel (emissive x intensity) is over EMISSIVE_CAP (beacons are meant to be: marked)
#   2. meshes sitting so close to a point light that albedo x I / (pi d^2) passes LIT_CAP, i.e. they would bloom to white
# Lights are scaled by their current intensity, so audit with the player in the room that matters: LOOK="look(-18,-70,0,0.3,6); await wait(800);" sh bench/glow-audit.sh
cd "$(dirname "$0")/.."
node bench/look.mjs audit "
${LOOK:-await wait(300);}
const ecap = ${ECAP:-1.2}, lcap = ${LCAP:-1.5}, seen = new Set(), em = [], lit = [];
const T = __debug.scene; T.updateMatrixWorld(true);
const lights = [], meshes = [];
T.traverse(o => { if (o.isPointLight && o.intensity > 0) lights.push(o); if (o.isMesh && o.visible) meshes.push(o); });
for (const o of meshes) for (const m of [].concat(o.material)) {
  if (m.emissive && !seen.has(m)) { seen.add(m); const p = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
    if (p > ecap) em.push(p.toFixed(2) + '  ' + (o.name || o.type) + ' #' + m.emissive.getHexString() + ' x' + m.emissiveIntensity); } }
const v = __debug.scene.position.clone();
for (const L of lights) { const lp = L.getWorldPosition(v.clone());
  for (const o of meshes) {
    if (o.isInstancedMesh || o.isSkinnedMesh || !o.geometry.boundingBox && (o.geometry.computeBoundingBox(), false)) continue;
    const bb = o.geometry.boundingBox; if (!bb) continue;
    const inv = o.matrixWorld.clone().invert(), q = lp.clone().applyMatrix4(inv);
    const c = q.clone().clamp(bb.min, bb.max), d = c.applyMatrix4(o.matrixWorld).distanceTo(lp);
    const mat = [].concat(o.material)[0], col = mat.color; if (!col) continue;
    const albedo = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b, rad = albedo * L.intensity / (Math.PI * Math.max(d, 0.05) ** 2);
    if (rad > lcap && !mat.emissive?.getHex?.()) lit.push(rad.toFixed(1) + '  ' + (o.name || o.type) + ' albedo ' + albedo.toFixed(2) + ' d=' + d.toFixed(2) + ' light I=' + L.intensity.toFixed(0)); } }
return 'emissive over ' + ecap + ': ' + em.length + '\n' + em.join('\n') + '\nlit over ' + lcap + ': ' + lit.length + '\n' + lit.join('\n');"

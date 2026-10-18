#!/bin/sh
# The five cave enemies close up and in combat range (nameplate + target frame + cast bar), plus the Seer's and the Warden's ground marks mid wind-up.
# Shots -> bench/shots/enemies/. Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS=enemies
# at(type, yaw, side, pitch, camDist): stand 7 from the enemy on the side yaw points to (pick one that is open floor), camera swung 0.7 off that line.
# cast(type, kind, yaw): wait for that enemy to be mid wind-up of that kind; returns the HUD's warning line.
H="const S=__debug.sim; const at=(t,yaw,side=0.7,pitch=0.3,cam=6,dist=7)=>near(t,dist,yaw,pitch,cam,side); const cast=async(t,kind,yaw,...f)=>{ const e=at(t,yaw,...f); const ok=await until(()=>e.cast&&e.cast.kind===kind,40000); await wait(60); return {ok,warn:document.querySelector('.warn')?.innerText}; };"
node bench/look.mjs e \
 "$H at('ravager',1.57); await wait(900); at('ravager',1.57);" \
 "$H at('ogre',-1.57); await wait(900); at('ogre',-1.57);" \
 "$H at('archer',-1.57); await wait(900); at('archer',-1.57);" \
 "$H return await cast('archer','bolt',-1.57);" \
 "$H return await cast('seer','ground',-1.57);" \
 "$H return await cast('ogre','heavy',-1.57);" \
 "$H return await cast('warden','heavy',0,0.9,0.35,5.5,4.5);" \
 "$H return await cast('warden','ground',0,0.9,0.35,5.5,4.5);"

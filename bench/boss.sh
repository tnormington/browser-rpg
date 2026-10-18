#!/bin/sh
# The Hollow Warden in his hall, seen from the south the way the player comes in: the brazier stands between camera and boss.
# Shots -> bench/shots/$SHOTS (default boss). Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS=${SHOTS:-boss}
H="const S=__debug.sim; S.player.hp=S.player.maxHp=99999; const w=S.enemies.find(x=>x.type==='warden'); S.targetId=w.id;"
node bench/look.mjs boss \
 "$H look(-18,-72,0,0.3,6); await wait(2500);" \
 "$H look(-18,-69,0.5,0.3,7); await wait(2500);" \
 "$H look(-22,-74,-0.5,0.2,5); await wait(2500);" \
 "$H look(-18,-78,0.0,0.35,6); await wait(2500);"

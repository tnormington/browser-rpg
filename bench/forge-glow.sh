#!/bin/sh
# Tier-4 set beside the forge in one frame: if the helm makes the forge less striking, the glow is too strong. Shots -> bench/shots/$SHOTS. Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS=${SHOTS:-forge-glow}
EQ="{ const e=__debug.sim.player.equipment; e.weapon='warden_edge'; e.head='mithril_helm'; e.chest='mithril_chestplate'; e.legs='mithril_greaves'; }"
node bench/look.mjs set \
 "$EQ look(10.5,1.5,-1.2,0.25,6); await wait(600);" \
 "{ const e=__debug.sim.player.equipment; e.weapon=null; e.head=null; e.chest=null; e.legs=null; } look(10.5,1.5,-1.2,0.25,6); await wait(600);"

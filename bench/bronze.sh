#!/bin/sh
# HOM-56: the bronze set on the character, between hide and iron. Same camera, naked -> hide -> bronze -> iron. Run `npm run build` first.
cd "$(dirname "$0")/.."
POSE="look(0,0,${YAW:-0.3},0.12,4.2); await wait(300);"
set_() { echo "{ const e=__debug.sim.player.equipment; e.weapon=$1; e.head=$2; e.chest=$3; e.legs=$4; } await wait(250);"; }
SHOTS=bronze node bench/look.mjs bronze \
 "$POSE $(set_ null null null null)" \
 "$(set_ "'rusty_blade'" "'leather_cap'" "'hide_jerkin'" "'hide_leggings'")" \
 "$(set_ "'bronze_sword'" "'bronze_helm'" "'bronze_chestplate'" "'bronze_greaves'")" \
 "$(set_ "'iron_sword'" "'iron_helm'" "'iron_chestplate'" "'iron_greaves'")"

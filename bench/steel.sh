#!/bin/sh
# The tier-4 set on the player: iron set + forged blade for comparison, then the steel set with the forged blade, then with the Warden's Edge.
# Same camera as wardrobe.sh. Shots -> bench/shots/steel/. Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS=steel
POSE="look(0,0,${YAW:-2.6},0.12,4.2); await wait(300);"
set_() { echo "const e=__debug.sim.player.equipment; e.weapon=$1; e.head=$2; e.chest=$3; e.legs=$4; await wait(250);"; }
node bench/look.mjs set \
 "$POSE $(set_ "'forged_blade'" "'iron_helm'" "'iron_chestplate'" "'iron_greaves'")" \
 "$(set_ "'forged_blade'" "'steel_helm'" "'steel_chestplate'" "'steel_greaves'")" \
 "$(set_ "'warden_edge'" "'steel_helm'" "'steel_chestplate'" "'steel_greaves'")" \
 "look(0,0,$(echo "${YAW:-2.6} + 3.14" | bc -l 2>/dev/null || echo 5.7),0.12,4.2); await wait(300);"

#!/bin/sh
# Wardrobe set: same camera, naked -> tier-1 set -> tier-2 set -> each tier-3 weapon. Run `npm run build` first.
cd "$(dirname "$0")/.."
POSE="look(0,0,${YAW:-2.6},0.12,4.2); await wait(300);"
set_() { echo "const e=__debug.sim.player.equipment; e.weapon=$1; e.head=$2; e.chest=$3; e.legs=$4; await wait(250);"; }
node bench/look.mjs ward \
 "$POSE $(set_ null null null null)" \
 "$(set_ "'rusty_blade'" "'leather_cap'" "'hide_jerkin'" "'hide_leggings'")" \
 "$(set_ "'iron_sword'" "'iron_helm'" "'iron_chestplate'" "'iron_greaves'")" \
 "$(set_ "'steel_sword'" "'iron_helm'" "'iron_chestplate'" "'iron_greaves'")" \
 "$(set_ "'forged_blade'" "'iron_helm'" "'iron_chestplate'" "'iron_greaves'")"
# the top of the ladder on armour (no tier-3/4 armour exists yet): bump the tiers in place, as HOM-15's set will
T="const I=__debug.items; for (const k of ['iron_helm','iron_chestplate','iron_greaves']) I[k].tier="
node bench/look.mjs ladder \
 "look(0,0,${YAW:-2.6},0.12,4.2); await wait(300); const e=__debug.sim.player.equipment; e.weapon='steel_sword'; e.head='iron_helm'; e.chest='iron_chestplate'; e.legs='iron_greaves'; $T 3; await wait(300);" \
 "const e=__debug.sim.player.equipment; $T 4; e.weapon='forged_blade'; await wait(300);"

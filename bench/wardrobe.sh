#!/bin/sh
# Wardrobe set (camera behind the player, as in play; YAW=2.6 for a front three-quarter): same camera, naked -> tier-1 set -> tier-2 set -> tier 3 -> tier 4 (the real mithril set and the Warden's Edge). Run `npm run build` first.
# No tier-3 armour exists yet, so tier 3 bumps the iron set's tier in place, as a future set will arrive. Then the ladder pair for the weapons.
cd "$(dirname "$0")/.."
POSE="look(0,0,${YAW:-0.3},0.12,4.2); await wait(300);"
set_() { echo "{ const e=__debug.sim.player.equipment; e.weapon=$1; e.head=$2; e.chest=$3; e.legs=$4; } await wait(250);"; }
T="for (const k of ['iron_helm','iron_chestplate','iron_greaves']) __debug.items[k].tier="
node bench/look.mjs ward \
 "$POSE $(set_ null null null null)" \
 "$(set_ "'rusty_blade'" "'leather_cap'" "'hide_jerkin'" "'hide_leggings'")" \
 "$(set_ "'iron_sword'" "'iron_helm'" "'iron_chestplate'" "'iron_greaves'")" \
 "$(set_ null null null null) $T 3; $(set_ "'steel_sword'" "'iron_helm'" "'iron_chestplate'" "'iron_greaves'") $T 2;" \
 "$(set_ "'warden_edge'" "'mithril_helm'" "'mithril_chestplate'" "'mithril_greaves'")" \
 "$(set_ "'forged_blade'" "'mithril_helm'" "'mithril_chestplate'" "'mithril_greaves'")"

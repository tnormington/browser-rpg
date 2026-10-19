#!/bin/sh
# Tier 5: adamant vs stormiron vs the generic tier-5 fallback, then the two named pieces. The items are injected at runtime (the sim has no tier-5 rows yet),
# so this checks the looks alone. Front three-quarter, then from behind. Shots -> bench/shots/tier5/. Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS=tier5
POSE="look(0,0,${YAW:-2.6},0.12,4.2); await wait(300);"
MK="for (const [id,slot,n] of [['adamant_helm','head',1],['adamant_chestplate','chest',1],['adamant_greaves','legs',1],['adamant_blade','weapon',1],['stormiron_helm','head',1],['stormiron_chestplate','chest',1],['stormiron_greaves','legs',1],['stormiron_blade','weapon',1],['greywolf_hauberk','chest',1],['gutterhooks_cap','head',1],['t5_helm','head',1],['t5_chest','chest',1],['t5_legs','legs',1],['t5_blade','weapon',1]]) __debug.items[id] = { name: id, slot, stack: 1, dropWeight: 0, value: 1, tier: 5, desc: '', stats: {} };"
set_() { echo "{ const e=__debug.sim.player.equipment; e.weapon=$1; e.head=$2; e.chest=$3; e.legs=$4; } await wait(300);"; }
node bench/look.mjs t5 \
 "$MK $POSE $(set_ "'adamant_blade'" "'adamant_helm'" "'adamant_chestplate'" "'adamant_greaves'")" \
 "$(set_ "'stormiron_blade'" "'stormiron_helm'" "'stormiron_chestplate'" "'stormiron_greaves'")" \
 "$(set_ "'t5_blade'" "'t5_helm'" "'t5_chest'" "'t5_legs'")" \
 "$(set_ "'t5_blade'" "'gutterhooks_cap'" "'greywolf_hauberk'" "'t5_legs'")" \
 "look(0,0,$(echo "${YAW:-2.6} + 3.14" | bc -l 2>/dev/null || echo 5.7),0.12,4.2); await wait(300);" \
 "$(set_ "'stormiron_blade'" "'stormiron_helm'" "'stormiron_chestplate'" "'stormiron_greaves'")" \
 "$(set_ "'adamant_blade'" "'adamant_helm'" "'adamant_chestplate'" "'adamant_greaves'")"

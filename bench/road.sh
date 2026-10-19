#!/bin/sh
# The road's and the Strand's enemies close up at play distance (the nameplate and target frame on). Shots -> bench/shots/road/. Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS=road
H="const S=__debug.sim; const at=(t)=>{const e=near(t,5,1.57,0.35,7,0.4); e.cast=null; e.attackCd=1e9; return e;};"
node bench/look.mjs e \
 "$H at('marsh_hog'); await wait(1200); at('marsh_hog');" \
 "$H at('road_wolf'); await wait(1200); at('road_wolf');" \
 "$H at('footpad'); await wait(1200); at('footpad');" \
 "$H at('toll_captain'); await wait(1200); at('toll_captain');" \
 "$H at('old_grey'); await wait(1200); at('old_grey');" \
 "$H near('shore_crab',7,0.4,0.35,5,0.5); await wait(1200); near('shore_crab',7,0.4,0.35,5,0.5);" \
 "$H at('drowned_sailor'); await wait(1200); at('drowned_sailor');" \
 "$H at('tide_hag'); await wait(1200); at('tide_hag');" \
 "$H at('barnacle_ogre'); await wait(1200); at('barnacle_ogre');" \
 "$H at('gutterhook'); await wait(1200); at('gutterhook');"

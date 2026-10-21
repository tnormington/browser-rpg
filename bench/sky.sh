#!/bin/sh
# The sky in each weather, snapped, on the open road and at the cave mouth. Shots -> bench/shots/sky/. Run `npm run build` first.
# The last three look up with the free camera: the moon and its halo, the aurora in the sky opposite it, and the stars overhead.
cd "$(dirname "$0")/.."
export SHOTS=sky
W="const v=__debug.view; v.weather.set"
node bench/look.mjs w \
 "look(0,20,0.6,0.12,9); $W('clear',true); v.skyClock=0; await wait(600);" \
 "$W('overcast',true); await wait(600);" \
 "$W('rain',true); await wait(900);" \
 "$W('fog',true); await wait(600);" \
 "$W('rain',true); look(-20,-35,-0.8,0.3,9); await wait(900);" \
 "$W('clear',true); look(-20,-58,-0.8,0.45,9); await wait(600);" \
 "look(0,20,0.6,0.12,9); $W('clear',true); cam([0,2,20],[-38,36,46]); await wait(600);" \
 "cam([0,2,20],[38,30,-6]); await wait(600);" \
 "cam([0,2,20],[6,34,8]); await wait(600);"

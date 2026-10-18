#!/bin/sh
# Cave interior shots -> bench/shots/cave/. Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS=cave
node bench/look.mjs interior \
 "look(-18,-50,0.0,0.45,13); await wait(500);" \
 "look(-18,-30,0.0,0.18,5); await wait(500);" \
 "look(-18,-76,3.14,0.2,6); await wait(500);" \
 "cam([-18,12,-40],[-18,0,-56]); await wait(300);"
# camera in the tight spots: throat and neck facing north and south, the hall, and the hollow against its west wall (the camera pulls in rather than poking through rock)
SHOTS=cave-camera node bench/look.mjs cam \
 "look(-18,-38,0,0.3,6); await wait(400);" \
 "look(-18,-38,3.14,0.3,6); await wait(400);" \
 "look(-18,-68,0,0.3,6); await wait(400);" \
 "look(-18,-68,3.14,0.3,6); await wait(400);" \
 "look(-31.5,-52,-1.57,0.3,6); await wait(400);" \
 "look(-31.5,-52,1.57,0.3,6); await wait(400);" \
 "look(-9,-80,1.57,0.3,6); await wait(400);"

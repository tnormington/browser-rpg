#!/bin/sh
# Full slot shot set: node bench/look.mjs <prefix> ... (build first). Usage: sh bench/set.sh <prefix>
P=${1:-set}
node bench/look.mjs $P \
 "look(5,8,0.2,0.35,9)" \
 "look(14,-2,-0.9,0.3,8)" \
 "look(-13,0,0.3,0.45,9)" \
 "look(0,6,0,0.3,8)" \
 "look(5,8,0.2,0.2,4)"

#!/bin/sh
# Findability-at-range proof: line three enemies up on open grass 28 / 33 / 38 m from the camera and shoot down the line.
#   sh bench/range.sh <prefix>      (build first)
node bench/look.mjs ${1:-range} "
  const d = window.__debug, E = d.sim.enemies, put = (type, i, x, z) => { const e = E.filter(q => q.type === type)[i]; e.x = e.spawnX = x; e.z = e.spawnZ = z; e.state = 'idle'; };
  put('boar', 0, -15, 1); put('wolf', 0, -12, -4); put('boar', 1, -17, -9); put('wolf', 1, 14, -15); put('boar', 2, 16, 3); put('wolf', 2, -22, 12);
  look(-14, 22, 0, 0.3, 9); await wait(1500);"

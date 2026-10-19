#!/bin/sh
# Art-direction frames, one per reference in docs/art-reference/: the forge at night (skeletons/candlelight), the clearing (forest ruin),
# the cave hall (cave firelight) and the mithril knight hero (rune knight). Shots -> bench/shots/$TAG/ (default "art"). Run `npm run build` first.
cd "$(dirname "$0")/.."
export SHOTS="${TAG:-art}"
CLEAN="const s=__debug.sim; s.player.hp=s.player.maxHp=99999; [...document.body.children].forEach(c=>{ if(!c.querySelector(\"canvas\")&&c.tagName!==\"CANVAS\") c.style.display=\"none\"; });"
GEAR="const e=__debug.sim.player.equipment; e.weapon='warden_edge'; e.head='mithril_helm'; e.chest='mithril_chestplate'; e.legs='mithril_greaves';"
node bench/look.mjs frame \
 "$CLEAN look(15.5,-2,0.9,0.22,7); await wait(1200)" \
 "$CLEAN look(-14,-10,0.2,0.2,7); await wait(1200)" \
 "$CLEAN look(-26,-47,-0.8,0.4,7); await wait(1500)" \
 "$GEAR $CLEAN look(0,0,0.5,0.12,4.2); s.player.facing=-0.2; await wait(900)"

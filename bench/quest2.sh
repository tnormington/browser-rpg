#!/bin/sh
# Walks the second quest (The Hollow Below) through the real UI: tracker text, dialogue panel, toasts, the ground-mark cast bar.
# Rules are covered by `npm run verify`; this is the part only a browser shows. Shots -> bench/shots/quest2/. Run `npm run build` first.
# Any pageerror / console error prints to stderr by look.mjs: there should be none.
cd "$(dirname "$0")/.."
export SHOTS=quest2
# helpers prepended to every script: read the tracker and toasts, talk to the Warden through the DOM
H="const T=()=>document.querySelector('.tracker').innerText.replace(/\n/g,' | '); const L=()=>[...document.querySelectorAll('.log-quest')].map(e=>e.textContent).join(' || ');
const D=()=>document.querySelector('.dialogue').innerText.replace(/\n/g,' | '); const S=__debug.sim, P=S.player;
const give=(id,q)=>{ let n=q; for (let i=0;i<P.inventory.length&&n>0;i++){ const c=P.inventory[i]; if(c&&c.id===id){c.qty+=n;n=0;} } for (let i=0;i<P.inventory.length&&n>0;i++) if(!P.inventory[i]){P.inventory[i]={id,qty:q};n=0;} };
const talk=async()=>{ look(5.5,2,0.3,0.2,6); await wait(200); dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'})); await wait(300); };
const pick=async i=>{ document.querySelectorAll('.dopt')[i].click(); await wait(300); };"
node bench/look.mjs q \
 "$H S.quest.stage='report2'; P.combat.level=9; P.skills.mining.level=9; P.skills.smithing.level=11; await talk(); const a=D(); await pick(0); const b=D(); await pick(0); return {a,b,T:T(),L:L()};" \
 "$H await talk(); const d=D(); await pick(0); await pick(0); return {state:S.quest.second,d,T:T(),L:L()};" \
 "$H S.quest.kills.ravager=3; await wait(300); return {T:T()};" \
 "$H give('mithril_ore',9); await wait(300); return {second:S.quest.second,T:T()};" \
 "$H give('coal',18); give('mithril_helm',1); give('mithril_greaves',1); give('mithril_chestplate',1); await wait(300); return {second:S.quest.second,T:T()};" \
 "$H const e=P.equipment; e.head='mithril_helm'; e.legs='mithril_greaves'; e.chest='mithril_chestplate'; await wait(300); return {T:T()};" \
 "$H S.quest.second='report'; await wait(300); const a=T(); await talk(); const d=D(); await pick(0); return {a,d,after:D(),second:S.quest.second,T:T(),L:L()};"

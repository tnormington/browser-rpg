// HOM-171: the Echo bands cover 42-99 with no gap, each a different cold hue, and an authored enemy is never dressed as one.
import { ECHO_BANDS, echoBand, echoLevelOf } from './echo-look';

let failed = 0;
const check = (ok: boolean, what: string) => { if (!ok) { failed++; console.error('FAIL', what); } };

for (let l = 42; l <= 99; l++) check(echoBand(l) !== null && echoBand(l)!.from <= l && l <= echoBand(l)!.to, `level ${l} has a band`);
check(echoBand(41) === null && echoBand(0) === null && echoBand(NaN) === null, 'below 42 is no band');
check(echoBand(120) === ECHO_BANDS[3], 'past 99 keeps the top band');
check([42, 56, 70, 84].every((l, i) => echoBand(l) === ECHO_BANDS[i]) && [55, 69, 83, 99].every((l, i) => echoBand(l) === ECHO_BANDS[i]), 'band edges are 42-55, 56-69, 70-83, 84-99');
check(new Set(ECHO_BANDS.map(b => b.color)).size === 4, 'four distinct hues');
// cold only: the warm channel never leads, so no band can read as the forge's orange or a quest marker's gold
check(ECHO_BANDS.every(b => (b.color & 255) >= (b.color >> 16 & 255)), 'blue never trails red in a band');
check(echoLevelOf({}) === null && echoLevelOf({ echo: null }) === null && echoLevelOf({ echo: 30 }) === null, 'an authored enemy is not an Echo');
check(echoLevelOf({ echo: 70 }) === 70, 'an Echo reports its level');

if (failed) process.exit(1);
console.log('echo-look: ok');

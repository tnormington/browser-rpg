// HOM-105: the action bar's rules. What a slot may hold (a spell or a consumable), what a stored layout is
// allowed to be, and which keys a slot may take. The layout's own growth rule is checked in hud-ui.test.ts (HOM-104).
// Run with `npm run verify`.
import { BarEntry, DEFAULT_KEYS, RESERVED_KEYS, barWorthy, bindKey, bindRefusal, defaultBar, keyLabel, sameEntry, loadoutDiffers, sanitizeBar, sanitizeKeys } from './bar-layout';
import { ABILITIES } from './sim/data';
import { ITEMS } from './sim/items';

const SLOT_COUNT = DEFAULT_KEYS.length;
const bars = (raw: unknown) => sanitizeBar(raw, SLOT_COUNT, ABILITIES.length);
const keysOf = (raw: unknown) => sanitizeKeys(raw, SLOT_COUNT);

let checks = 0;
function assert(cond: unknown, msg: string): asserts cond {
  checks++;
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`  ok  ${msg}`);
}
const section = (n: string) => console.log(`\n# ${n}`);
const FOOD = Object.keys(ITEMS).find(id => ITEMS[id].use)!;
const ORE = Object.keys(ITEMS).find(id => !ITEMS[id].use && !ITEMS[id].slot)!;
const pad = (...entries: (BarEntry | null)[]) => [...entries, ...Array(SLOT_COUNT - entries.length).fill(null)];

section('What may sit in a slot');
{
  assert(barWorthy(FOOD), `${ITEMS[FOOD].name} can be used, so it can go on the bar`);
  assert(!barWorthy(ORE), `${ITEMS[ORE].name} cannot be used, so it cannot`);
  assert(!barWorthy('no_such_item'), 'an item id that does not exist cannot');
  assert(!barWorthy(Object.keys(ITEMS).find(id => ITEMS[id].slot)!), 'nor can a piece of gear: there is nothing to press on it');
}

section('A thing lives in one slot only');
{
  assert(sameEntry({ k: 'ability', i: 2 }, { k: 'ability', i: 2 }), 'the same spell twice is the same entry');
  assert(!sameEntry({ k: 'ability', i: 2 }, { k: 'ability', i: 3 }), 'two different spells are not');
  assert(sameEntry({ k: 'item', id: FOOD }, { k: 'item', id: FOOD }), 'the same food twice is the same entry');
  assert(!sameEntry({ k: 'item', id: FOOD }, { k: 'ability', i: 0 }), 'a food and a spell never collide');
  assert(!sameEntry(null, null), 'two empty slots do not collide: the bar may hold many');
}

section('A stored layout is believed only as far as it is legal');
{
  const fresh = defaultBar(SLOT_COUNT, ABILITIES.length);
  assert(bars(null).length === SLOT_COUNT, 'nothing stored gives the default bar');
  assert(JSON.stringify(bars(null)) === JSON.stringify(fresh), 'and that default is every ability in order');

  const ok = pad({ k: 'ability', i: 1 }, { k: 'item', id: FOOD });
  assert(JSON.stringify(bars(ok)) === JSON.stringify(ok), 'a legal spell-and-food layout comes back untouched');

  const dupes = bars(pad({ k: 'ability', i: 1 }, { k: 'ability', i: 1 }, { k: 'item', id: FOOD }, { k: 'item', id: FOOD }));
  assert(dupes[0] && !dupes[1], 'a repeated spell keeps the first slot and empties the second');
  assert(dupes[2] && !dupes[3], 'and so does a repeated food');

  const junk = bars([{ k: 'ability', i: ABILITIES.length } as BarEntry, { k: 'item', id: ORE }, { k: 'item', id: 'no_such_item' }, 'nonsense' as never]);
  assert(junk.slice(0, 4).every(e => e === null), 'a spell that does not exist, an item that cannot be used and plain rubbish all become empty slots');

  const legacy = bars(Array.from({ length: SLOT_COUNT }, (_, i) => (i < ABILITIES.length ? i : null)));
  assert(JSON.stringify(legacy) === JSON.stringify(fresh), 'a layout saved before slots could hold items still means those abilities');

  const mixed = bars([0, { k: 'item', id: FOOD }, 2]);
  assert(JSON.stringify(mixed.slice(0, 3)) === JSON.stringify([{ k: 'ability', i: 0 }, { k: 'item', id: FOOD }, { k: 'ability', i: 2 }]),
    'a layout part-rewritten by this build and part left from the last one reads either way round');
}

section('Which keys a slot may take');
{
  assert(DEFAULT_KEYS.length === SLOT_COUNT, 'every slot starts with a key');
  assert(new Set(DEFAULT_KEYS).size === SLOT_COUNT, 'and no two slots start on the same one');
  assert(DEFAULT_KEYS.every(k => !bindRefusal(k)), 'the keys the bar starts with are all keys it would accept');
  assert(!bindRefusal('KeyL') && !bindRefusal('Digit9') && !bindRefusal('Semicolon'), 'a free letter, digit or punctuation key is fine');
  for (const code of ['KeyW', 'Space', 'KeyI', 'Escape', 'KeyB']) assert(bindRefusal(code), `${keyLabel(code)} is refused: the game already owns it`);
  assert(RESERVED_KEYS.has('Tab') && bindRefusal('Tab'), 'Tab is refused too: it is how you target');
  assert(bindRefusal('F5') && bindRefusal('ShiftLeft') && bindRefusal(''), 'a function key, a modifier on its own and no key at all are all refused');
}

section('Binding a key takes it off wherever it was');
{
  const keys = bindKey([...DEFAULT_KEYS], 5, 'KeyL');
  assert(keys[5] === 'KeyL', 'the slot gets the key');
  assert(keys.filter(k => k === 'KeyL').length === 1, 'and it is the only slot with it');
  assert(keys[6] === DEFAULT_KEYS[6], 'a slot that had nothing to do with it is untouched');

  const moved = bindKey([...DEFAULT_KEYS], 0, DEFAULT_KEYS[6]);
  assert(moved[0] === DEFAULT_KEYS[6] && moved[6] === '', 'taking a key that another slot had leaves that slot with none');
  assert(bindKey([...DEFAULT_KEYS], 2, DEFAULT_KEYS[2])[2] === DEFAULT_KEYS[2], 'rebinding a slot to the key it already had changes nothing');
}

section('Stored keys are checked the same way');
{
  assert(JSON.stringify(keysOf(null)) === JSON.stringify(DEFAULT_KEYS), 'nothing stored gives the default keys');
  assert(JSON.stringify(keysOf(['KeyL'])) === JSON.stringify(DEFAULT_KEYS), 'a list of the wrong length is thrown away whole');

  const mixed = keysOf(Array.from({ length: SLOT_COUNT }, (_, i) => (i === 0 ? 'KeyW' : i === 1 ? 'KeyL' : i === 2 ? 'KeyL' : '')));
  assert(mixed[0] === '', 'a key the game now owns (an older build bound it) leaves that slot unbound');
  assert(mixed[1] === 'KeyL' && mixed[2] === '', 'a repeat keeps the first slot and unbinds the second');
  assert(mixed.length === SLOT_COUNT, 'and the list is still one entry per slot');
}

section('What the player reads on a slot');
{
  assert(keyLabel('Digit1') === '1' && keyLabel('KeyQ') === 'Q', 'a digit and a letter read as themselves');
  assert(keyLabel('Numpad7') === 'Num7' && keyLabel('Slash') === '/', 'the numpad says so, and punctuation shows the mark');
  assert(keyLabel('') === '-', 'a slot with no key shows a dash, not a blank corner');
}

console.log(`\nAll ${checks} action bar layout and keybinding checks passed.`);

section('A book of more abilities than slots (HOM-179)');
{
  assert(ABILITIES.length > SLOT_COUNT, `the book (${ABILITIES.length}) is longer than the bar (${SLOT_COUNT}): the bar is a loadout`);
  const fresh = defaultBar(SLOT_COUNT, ABILITIES.length);
  assert(fresh.every(e => e?.k === 'ability'), 'a fresh bar is full of abilities and the rest wait in the book');
  // a level-50 save: nine abilities arranged on a 16-slot bar, in a deliberate order with gaps
  const mine = pad({ k: 'ability', i: 8 }, null, { k: 'ability', i: 3 }, { k: 'ability', i: 0 }, null, { k: 'item', id: FOOD }, { k: 'ability', i: 5 });
  const back = bars(JSON.parse(JSON.stringify(mine)));
  assert(JSON.stringify(back) === JSON.stringify(mine), 'a saved arrangement of nine abilities loads at level 99 exactly as it was, gaps and all');
  assert(!back.some(e => e?.k === 'ability' && e.i >= 16), 'and the six new abilities are not pushed onto it: they wait in the book');
  const old = bars([{ k: 'ability', i: 2 }, { k: 'ability', i: 0 }]);
  assert(old[0]?.k === 'ability' && old[0].i === 2 && old[1]?.k === 'ability' && old[1].i === 0, 'a save from a shorter bar keeps the slots the player arranged');
}

section('The loadout is the abilities and where they sit (HOM-179)');
{
  const a = pad({ k: 'ability', i: 0 }, { k: 'ability', i: 1 }, null);
  const swapped = a.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  assert(!loadoutDiffers(a, a.slice()), 'the same bar is not a change');
  assert(loadoutDiffers(a, swapped), 'swapping two abilities is a change');
  assert(loadoutDiffers(a, pad({ k: 'ability', i: 0 }, null, null)), 'clearing an ability is a change');
  assert(loadoutDiffers(a, pad({ k: 'ability', i: 0 }, { k: 'ability', i: 1 }, { k: 'ability', i: 16 })), 'putting an ability from the book on the bar is a change');
  assert(!loadoutDiffers(a, pad({ k: 'ability', i: 0 }, { k: 'ability', i: 1 }, { k: 'item', id: FOOD })), 'a potion on a free slot is not');
  assert(!loadoutDiffers(pad({ k: 'item', id: FOOD }), pad(null, { k: 'item', id: FOOD })), 'moving food is not');
}
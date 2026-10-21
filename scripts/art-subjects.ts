// What the art generator draws, and the one style every piece of it shares (HOM-135).
//
// Two shared suffixes and one shared negative do the work of holding the set together: every item icon
// gets ITEM_STYLE, every face gets PORTRAIT_STYLE, and nothing else about the prompt changes between
// subjects. The metal and leather ladders are composed from a material table and a form table rather
// than written out piece by piece, so a copper helm and a starmetal helm are the same helmet in a
// different metal, which is what makes the set read as one wardrobe.
//
// The ids here must match ITEMS in src/sim/items.ts and the named NPCs in sim/quest, sim/shop and
// sim/flight; scripts/gen-art.mjs checks that and fails if the two ever drift apart.

/**
 * The one backdrop behind every piece. Described rather than forbidden: at this model's low guidance a
 * negative barely bites, and "no background" is read as an invitation to paint a scene, while a backdrop
 * spelled out this plainly comes back the same every time. Flat and near-black is also what lets the
 * framing pass find the subject's edge, which is what makes the set come out framed alike.
 */
const BACKDROP = 'isolated on a flat even near-black charcoal backdrop, unlit empty background, '
  + 'no vignette, no scenery, no horizon';

/** Appended to every item prompt. The frame itself is enforced after generation (gen-art.mjs). */
export const ITEM_STYLE = 'single RPG inventory item icon, hand-painted fantasy game art, thick painterly brushwork, '
  + 'muted earthy palette with cold highlights, strong warm rim light from the upper left, deep shadow on the lower right, '
  + 'crisp silhouette, three-quarter view, exactly one object floating dead centre, '
  + BACKDROP + ', nothing else in frame, no ground, no cast shadow, high detail, 2D game asset';

/**
 * Appended to every ability prompt. The same paint, palette and light as an item, because the two sit side by
 * side in the action bar and have to read as one set; only "inventory item" becomes "ability icon", and the
 * three-quarter view is dropped, since half of these are struck straight at the viewer.
 */
export const ABILITY_STYLE = 'single RPG ability icon, hand-painted fantasy game art, thick painterly brushwork, '
  + 'muted earthy palette with cold highlights, strong warm rim light from the upper left, deep shadow on the lower right, '
  + 'crisp silhouette, one emblem dead centre, '
  + BACKDROP + ', nothing else in frame, no ground, no cast shadow, high detail, 2D game asset';

/** Appended to every portrait prompt. */
export const PORTRAIT_STYLE = 'head and shoulders character portrait, hand-painted fantasy game art, thick painterly brushwork, '
  + 'muted earthy palette with cold highlights, strong warm rim light from the upper left, deep shadow on the lower right, '
  + 'facing the viewer, calm steady expression, weathered lived-in face, shoulders squared, '
  + BACKDROP + ', nothing else in frame, high detail, 2D game character portrait';

export const NEGATIVE = 'text, letters, numbers, watermark, signature, logo, frame, border, ui overlay, '
  + 'multiple objects, duplicate, two of the same object, pair of identical copies, collage, grid, sprite sheet, '
  + 'photograph, 3d render, plastic, blurry, lowres, jpeg artifacts, '
  + 'cluttered background, scenery, landscape, sky, table, floor, pedestal, hands holding the object, nsfw';

// --- the ladders ------------------------------------------------------------------------------
// The seven metals of the smithing ladder, worded from each bar's description in sim/items.ts.
const METALS = {
  copper: 'soft red-brown copper, warm and faintly tarnished',
  bronze: 'dull golden bronze, cast and unpolished',
  iron: 'grey pitted iron, dented and workmanlike',
  steel: 'bright keen steel with clean bevels',
  adamant: 'dense sea-dark green-black adamant',
  stormiron: 'pale slate stormiron veined with lilac',
  starmetal: 'indigo-black starmetal flecked with cold white light',
};

// The five regional leathers of the leatherworking ladder.
const LEATHERS = {
  hide: 'coarse tan boar leather, hand-stitched',
  wolfskin: 'thick grey wolf leather with the fur turned inward',
  marshhide: 'dark slick marsh leather, sealed at the seams',
  thornhide: 'stiff russet thorn leather with the barbs still turned outward',
  moorhide: 'heavy weathered grey-green moor leather, stiff as bark',
};

// The shapes the ladders are beaten into. Every piece of armour is empty and worn by no one.
const FORMS = {
  sword: 'a straight double-edged longsword standing upright, blade point up, plain crossguard, leather-wrapped grip',
  helm: 'an empty closed helmet, visor down, worn by nobody',
  chestplate: 'an empty breastplate cuirass standing upright, worn by nobody',
  greaves: 'a pair of empty armoured leg greaves standing side by side, worn by nobody',
  gloves: 'a pair of armoured gauntlet gloves laid flat side by side, empty',
  boots: 'a pair of boots standing upright side by side, empty',
};

const metalSet = (metal, pieces) => Object.fromEntries(pieces.map(([id, form, extra]) =>
  [id, `${FORMS[form]}, forged from ${METALS[metal]}${extra ? `, ${extra}` : ''}`]));

const leatherSet = (leather, gloves, boots) => ({
  [gloves]: `${FORMS.gloves}, cut and stitched from ${LEATHERS[leather]}`,
  [boots]: `${FORMS.boots}, cut and stitched from ${LEATHERS[leather]}`,
});

// A raw fish, its cooked dish and its pie, so the three rows of a fish look like one another.
const fishSet = (id, fish) => ({
  [id]: `a single whole raw fish lying on its side, ${fish}, wet and freshly caught`,
  [`${id}_cooked`]: `a single whole cooked fish, ${fish}, grilled and browned, crisp blistered skin, served on nothing`,
  [`${id}_pie`]: `a small round golden pie with a latticed crust, a fish tail of ${fish} standing out of the middle, baked`,
});

// A herb and the potion brewed from it: the potion is always the same corked vial, in the herb's colour.
const herbSet = (id, herb, potionId, liquid) => ({
  [id]: `a cut sprig of ${herb}, leaves and stem, freshly picked`,
  [potionId]: `a small corked glass vial of ${liquid} potion, faintly glowing from within, wax-sealed stopper, wrapped twine label`,
});

const ORE = 'a single rough chunk of unsmelted ore, broken facets, flecked with metal';
const BAR = 'a single cast metal ingot bar lying at an angle, square-edged, hammer marks along the top';
const HIDE = 'a single rolled animal hide tied with a cord';
// Leather is the hardest thing in the set to ask for, because every plain description of it names
// something the model would rather paint: "a flat square" is a framed panel on a wall, "a folded
// piece" is a leather-bound book, "a rolled strip" is a barrel or a shield. A loose fanned stack is
// the one wording that comes back as crafting material and nothing else.
const LEATHER = 'a loose stack of cut pieces of cured leather, fanned slightly apart, soft uneven edges';

// --- the items --------------------------------------------------------------------------------
/** One phrase per item id in ITEMS. Keep each to the object itself: the style suffix does the rest. */
export const ITEM_SUBJECTS = {
  // hides and leathers
  boar_hide: `${HIDE}, coarse bristled brown boar hide`,
  wolf_pelt: `${HIDE}, thick grey wolf fur`,
  marsh_hide: `${HIDE}, slick dark green-black marsh hide`,
  thorn_hide: `${HIDE}, tough russet hide studded with short barbs`,
  moor_hide: `${HIDE}, heavy weathered grey-green hide`,
  tanned_hide: `${LEATHER}, tan boar leather`,
  wolf_leather: `${LEATHER}, grey wolf leather`,
  marsh_leather: `${LEATHER}, dark slick marsh leather`,
  // The word "thorn" anywhere in this one and it comes back a feather or a fan of leaves, barbs or
  // no barbs, on every roll. The leather is named by its colour instead.
  thorn_leather: `${LEATHER}, stiff rust-brown leather`,
  moor_leather: `${LEATHER}, heavy grey-green moor leather`,

  // ores, bars and fuel
  copper_ore: `${ORE}, soft red-brown copper`,
  tin_ore: `${ORE}, pale dull grey tin`,
  iron_ore: `${ORE}, rusty red-brown iron`,
  adamant_ore: `${ORE}, green-black adamant`,
  stormiron_ore: `${ORE}, pale stone veined with lilac`,
  starmetal_ore: `${ORE}, black rock flecked with cold white light`,
  copper_bar: `${BAR}, ${METALS.copper}`,
  bronze_bar: `${BAR}, ${METALS.bronze}`,
  iron_bar: `${BAR}, ${METALS.iron}`,
  steel_bar: `${BAR}, ${METALS.steel}`,
  adamant_bar: `${BAR}, ${METALS.adamant}`,
  stormiron_bar: `${BAR}, ${METALS.stormiron}`,
  starmetal_bar: `${BAR}, ${METALS.starmetal}`,
  coal: 'a small heap of black coal lumps, glassy broken faces',
  logs: 'a short stack of three cut seasoned logs, bark on, sawn ends facing the viewer',

  // shards and reagents
  warden_shard: 'a jagged splinter of dark grey stone-like bone, a dull green light down the fracture',
  marrow_shard: 'a jagged barnacled splinter of rusted anchor iron, crusted with salt and shell',
  heartwood_shard: 'a jagged splinter of hard red heartwood, sap-dark grain, fibres torn at one end',
  crown_shard: 'a jagged splinter of cold grey crown iron, one edge still bearing a worn engraved pattern',
  arcane_dust: 'a small conical heap of fine pale grit, faintly glowing cold blue, a few motes lifting off it',
  sea_salt: 'a small conical heap of coarse grey salt crystals',
  vial: 'a small empty corked glass vial, clear and unfilled, wax-sealed stopper',

  // fish
  ...fishSet('silverfin', 'a small bright silver fish'),
  ...fishSet('brine_trout', 'a speckled olive-and-pink trout'),
  ...fishSet('saltpike', 'a long narrow grey-green pike with a hooked jaw'),
  ...fishSet('redgill', 'a deep red-finned fish with scarlet gills'),
  ...fishSet('ghost_eel', 'a pale translucent eel, faintly luminous'),
  ...fishSet('stormtuna', 'a heavy blue-black tuna with a steel sheen'),

  // herbs and potions
  ...herbSet('marrowleaf', 'pale grey-green marrowleaf with soft rounded leaves', 'healing_draught', 'deep red'),
  ...herbSet('fenbloom', 'fenbloom, a marsh flower with violet petals on a dark stem', 'draught_of_vigour', 'bright orange'),
  ...herbSet('thornmint', 'thornmint, a spiny bright green mint with tiny thorns along the stem', 'stoneskin', 'cloudy grey-brown'),
  ...herbSet('ghostcap', 'ghostcap, a pale luminous white cave mushroom', 'greater_healing', 'glowing crimson'),

  // weapons
  rusty_blade: `${FORMS.sword}, pitted rust-eaten iron, notched edge, the grip worn through`,
  copper_sword: `${FORMS.sword}, forged from ${METALS.copper}, light and short`,
  bronze_sword: `${FORMS.sword}, forged from ${METALS.bronze}`,
  iron_sword: `${FORMS.sword}, forged from ${METALS.iron}, a plain soldier's sword`,
  steel_sword: `${FORMS.sword}, forged from ${METALS.steel}, keen and balanced`,
  forged_blade: `${FORMS.sword}, forged from ${METALS.steel}, a masterwork with a fullered blade and a brass pommel`,
  warden_edge: `${FORMS.sword}, forged from ${METALS.steel} folded around a splinter of grey stone-like bone, a dull green light seeping from the seam`,
  adamant_blade: `${FORMS.sword}, forged from ${METALS.adamant}, broad and heavy`,
  marrows_edge: `${FORMS.sword}, forged from ${METALS.adamant} folded around barnacled anchor iron, salt crust and shell along the fuller`,
  stormiron_blade: `${FORMS.sword}, forged from ${METALS.stormiron}, narrow and very sharp`,
  rotroot_edge: `${FORMS.sword}, forged from ${METALS.stormiron} folded around red heartwood, dark sap-coloured grain running up the blade`,
  starmetal_blade: `${FORMS.sword}, forged from ${METALS.starmetal}, a long black edge with a seam of white light along it`,
  crownbreaker: `${FORMS.sword}, forged from ${METALS.starmetal} folded around cold grey crown iron, engraved pattern at the ricasso, white light in the fuller`,

  // armour: the stitched-hide bottom rung
  // "cap" alone comes back as a peaked chauffeur's cap, and leggings worn by nobody still come back
  // with legs in them, so both say what they are not as well as what they are.
  leather_cap: 'an empty medieval brown leather skullcap helmet with ear flaps, no peak, no brim, worn by nobody',
  hide_jerkin: 'an empty sleeveless stitched brown hide jerkin standing upright, worn by nobody',
  hide_leggings: 'empty stitched brown hide leggings laid out flat and limp, no legs in them, no body, no mannequin',

  // armour: the metal ladder
  ...metalSet('copper', [['copper_helm', 'helm'], ['copper_chestplate', 'chestplate'], ['copper_greaves', 'greaves']]),
  ...metalSet('bronze', [['bronze_helm', 'helm'], ['bronze_chestplate', 'chestplate'], ['bronze_greaves', 'greaves']]),
  ...metalSet('iron', [['iron_helm', 'helm'], ['iron_chestplate', 'chestplate'], ['iron_greaves', 'greaves']]),
  ...metalSet('steel', [['steel_helm', 'helm'], ['steel_chestplate', 'chestplate'], ['steel_greaves', 'greaves']]),
  ...metalSet('adamant', [['adamant_helm', 'helm'], ['adamant_chestplate', 'chestplate'], ['adamant_greaves', 'greaves']]),
  ...metalSet('stormiron', [
    ['stormiron_helm', 'helm', 'swept-back spikes over the crown'],
    ['stormiron_chestplate', 'chestplate'],
    ['stormiron_greaves', 'greaves'],
  ]),
  ...metalSet('starmetal', [
    ['starmetal_helm', 'helm', 'a four-point star standing over the brow'],
    ['starmetal_chestplate', 'chestplate', 'a star inlaid on the breast'],
    ['starmetal_greaves', 'greaves', 'a seam of cold white light down each shin'],
  ]),
  kings_crown: 'an empty circlet crown of cold grey iron, plain heavy band, worn teeth around the rim, barrow dust in the engraving, worn by nobody',

  // armour: the leather ladder
  ...leatherSet('hide', 'hide_gloves', 'hide_boots'),
  ...leatherSet('wolfskin', 'wolfskin_gloves', 'wolfskin_boots'),
  ...leatherSet('marshhide', 'marshhide_gloves', 'marshhide_boots'),
  ...leatherSet('thornhide', 'thornhide_gloves', 'thornhide_boots'),
  ...leatherSet('moorhide', 'moorhide_gloves', 'moorhide_boots'),
};

// --- the abilities ----------------------------------------------------------------------------
/**
 * One phrase per ability, keyed by abilityArtId (its name, lowercased, spaces to underscores).
 *
 * An ability is a verb and the model paints nouns, so every one of these is given a thing to be: the weapon the
 * blow is struck with, the shield the guard is held behind, the ember the heal is. Asked for the deed instead
 * ("a mighty cleaving strike") it paints the fight - two figures, ground, a sky - which is a picture, not an icon.
 */
export const ABILITY_SUBJECTS = {
  strike: 'a keen steel longsword blade angled across the frame, a single clean white slash of light cutting along its edge',
  // No "head" and no "face" in either hammer, and that is the whole fix: both came back a horned demon
  // portrait on every seed, because a head with a face on it is what the model hears. Naming a "block"
  // instead got a block - a bare iron cube, no hammer at all - so the haft is what is named now, and the
  // hammer word is said twice.
  crushing_blow: 'a blacksmith sledgehammer standing upright on its long dark wooden handle, the squared steel hammer at the top of the handle, grey sparks bursting off the steel',
  serrated_throw: 'a single serrated saw-toothed throwing knife turning in the air, a fine arc of dark red droplets trailing behind it',
  second_wind: 'a single ember of golden-green healing light, soft and radiant, one curl of pale breath winding around it',
  cleave: 'a wide crescent sweep of pale white light shaped like the arc of a blade, a broad axe edge riding the inside of the crescent',
  pummel: 'a single armoured steel gauntlet clenched into a fist, driven forward, a sharp crack of white light bursting off the knuckles',
  // Four blades in a ring is what this wants to be, and "multiple objects" in the negative fights it the whole
  // way: one blade bent into the ring is the same read and the model will actually paint it.
  whirlwind: 'a single curved sword blade bent round into a closed circle of motion, a grey vortex of wind spinning inside the ring',
  guard: 'a heavy round iron shield seen face on, riveted bands and a domed central boss, a cold pale blue ward light along the rim',
  bloodthirst: 'a straight steel blade standing point down, dark red blood running up the fuller towards the hilt, one droplet lifting off the tip',
  shield_bash: 'a heavy round iron shield turned edge on and driven forward rim first, a hard crack of white impact light across the boss',
  hemorrhage: 'a barbed crimson iron hook torn backwards, a spray of dark red droplets flung off its point',
  colossus_blow: 'a colossal two-handed stone warhammer standing upright on its long iron-bound handle, the huge cracked grey stone hammer at the top of the handle, hot orange light glowing in the cracks',
  last_stand: 'a dented iron shield boss with a heart of warm golden light burning in its centre, rays breaking out through the dents',
};

// --- the talents ------------------------------------------------------------------------------
/**
 * One phrase per talent node, keyed by its id in src/sim/talents.ts. These wear ABILITY_STYLE rather than a
 * style of their own: a talent is the same kind of picture as an ability - one emblem, no figure - and giving
 * it its own suffix would only be a second copy of that one to drift out of step with.
 *
 * A talent is a passive, so there is even less to paint than an ability: most are a number going up. Each is
 * given the one object the tree would carve for it, and the three trees are kept apart by what they are made
 * of - Fury is scarred iron and hot red light, Bulwark is plate and cold blue, Hunt is an edge and dark red.
 * Where a node sharpens an ability the player already has, its emblem is deliberately NOT that ability's
 * (Whirling is not Cleave's crescent, Bloodthirst's node is not Bloodthirst's blade), or the talent panel
 * would read as a second copy of the action bar.
 */
export const TALENT_SUBJECTS = {
  // Fury: scarred iron, hot red light.
  brutality: 'a heavy notched iron axe head alone, its edge scarred and chipped from use, dull hot red light glowing in the notches',
  overpower: 'a bull skull with heavy curved horns, blackened iron caps banded onto the horn tips, dull red light in the eye sockets',
  frenzy: 'three overlapping curved claw slashes of pale white light torn fast across the frame, trailing sparks',
  // An hourglass is the obvious picture for a cooldown and Exsanguinate has the better claim on it, so this
  // one is the sharpening rather than the waiting.
  relentless: 'a spinning iron whetstone wheel throwing a wide fan of white sparks from its rim',
  execute: 'an executioner broad squared axe head hanging edge down, a thin hot line of red light running along its edge',
  ruin: 'a shattered iron helm split open down the centre, the jagged crack glowing hot orange from within',
  berserk: 'a snarling horned war mask of blackened iron, mouth wrenched open, burning red light behind the eye slits',
  unbridled: 'a thick iron chain snapped apart at one link, white hot sparks bursting out of the broken link',
  bloodthirst: 'a squat dark iron chalice brimming with dark red blood, one heavy drop running down its outside',

  // Bulwark: layered plate, cold blue light.
  toughened: 'a thick iron pauldron of layered overlapping plates, dented and scarred, cold blue highlight along the top edge',
  bastion: 'a squat stone fortress tower with an iron banded base and one lit window, cold pale light on its stonework',
  rally: 'a war horn of banded brass and iron, warm golden light spilling out of its bell',
  // The stone block this used to stand on came back a pale paving slab filling the frame, which no reroll
  // moved: the backdrop the style asks for cannot survive a second large object being named beside it.
  stalwart: 'a single iron shod boot planted flat and square, a hard white shockwave cracking outward from under the heel',
  counterstrike: 'two crossed iron bracers braced against each other, a hard white spark bursting where they meet',
  thickskin: 'a hide of thick grey overlapping horned scales filling the frame, cold blue rim light on every ridge',
  guardian: 'a tall iron kite shield planted point down, a pale blue ward light burning steadily along its rim',
  // A sprig bound with linen is a pressed specimen, and the model paints those on parchment every time.
  // Clasped in iron it is an emblem, which is what the rest of the tree is wearing.
  vigour: 'a sprig of broad leaved green healing herb clasped in a dark iron ring, soft green light rising off the leaves',
  ironwill: 'a plain heavy iron crown band, unjewelled and battered, cold white light running along its rim',

  // Hunt: an edge, and dark red.
  serration: 'a curved blade edge seen close, a row of deep saw teeth along it each catching cold light, one dark red droplet hanging',
  predator: 'a wolf skull in profile with long bared fangs, low amber light burning in its eye socket',
  whirling: 'a wide open crescent of grey spinning wind, pale white light running along its outer edge',
  rending: 'three deep parallel claw gouges torn through thick grey hide, dark red welling up inside the cuts',
  bloodscent: 'a single dark red droplet of blood falling, a faint pale ring of scent light spreading outward around it',
  carnage: 'a broad double headed axe head alone, both edges notched and darkened, dried dark red caught in the notches',
  exsanguinate: 'an hourglass of dark iron running dark red blood instead of sand, its upper bulb nearly empty',
  opportunist: 'a thin curved stiletto dagger slipping in behind a broken iron plate, a cold white glint on its point',
  hemorrhage: 'a lean skeletal hand clenched shut, dragging a ribbon of dark red blood through the air towards itself',
};

// --- the faces --------------------------------------------------------------------------------
/**
 * Everyone the player can walk up to and talk to, by the id the game already knows them by:
 * the five quest givers (sim/quest), the merchants, trainers and stablemasters (sim/shop) and the
 * five flight masters (sim/flight). Flight ids collide with vendor ids, so they are prefixed.
 */
export const PORTRAIT_SUBJECTS = {
  // quest givers
  hale: 'Warden Hale, a grey-bearded human man in his sixties, a village warden in a worn green cloak over a mail shirt, scarred brow',
  harbour: 'Harbourmaster Pell, a stout weather-beaten human man in his fifties, oilskin coat and a knitted cap, salt-cracked skin',
  thorn: 'Reeve Maud Alder, a sharp-eyed human woman in her forties, a village reeve in a plain russet wool dress and a chain of office',
  high: 'Steward Hild Garrow, a tall austere human woman in her fifties, a moorland steward in dark riding leathers and a fur-collared mantle, grey hair pinned back',
  spire: 'Keeper Isaura Venn, a pale human woman in her thirties, a tower keeper in indigo robes with silver rune embroidery, close-cropped dark hair',

  // merchants and provisioners
  vendor_hale: 'Brannoch the Peddler, a round cheerful human man in his forties, a travelling peddler in a patched coat hung with straps and buckles',
  vendor_harbour: 'Tam Brine, a lean grizzled human man in his sixties, a harbour chandler in a canvas apron, rope burns on his hands',
  vendor_thorn: 'Edda Bracken, a broad kindly human woman in her fifties, a village provisioner in a flour-dusted apron and a headscarf',
  vendor_high: 'Kell Ashdown, a wiry freckled human man in his thirties, a moorland provisioner in a sheepskin jerkin',
  vendor_spire: 'Corwen Ashmere, a gaunt quiet human man in his forties, a tower provisioner in dark grey robes with ink-stained fingers',

  // trainers
  vendor_trainer: 'Orla Saltblade, a hard-muscled human woman in her thirties, a sword trainer in scarred leather fighting harness, hair braided tight',
  // Bare arms on a fighter are painted by standing him back far enough to show them, and no roll of
  // the dice talks the model out of it, so his arms are covered and his scars are on his face.
  vendor_thorn_trainer: 'Brannock Vane, a heavy-browed human man in his forties, a sword trainer in a padded gambeson buttoned to the throat, old scars across his cheek',
  vendor_high_trainer: 'Ravn Highcastle, a silver-haired human man in his sixties, a veteran sword trainer in a faded tabard over mail',

  // stablemasters
  vendor_thorn_stable: 'Garth Hollin, a slow-smiling human man in his fifties, a stablemaster in a straw-flecked leather jerkin, a bridle over his shoulder',
  vendor_high_stable: 'Isolde Marr, a windburnt human woman in her forties, a stablemaster in a riding coat and gauntlets, hair whipped loose',

  // flight masters
  flight_hale: 'Fenna Skywright, a small quick human woman in her twenties, a flight master in a feathered leather flying jacket and goggles pushed up',
  flight_saltmarrow: 'Orrin Gullwing, a weather-beaten human man in his fifties, a flight master in a gull-grey flying coat, a feather tied in his hair',
  flight_thornwick: 'Hesper Rookwing, a sly dark-eyed human woman in her thirties, a flight master in black feathered leathers, a rook on her shoulder',
  flight_highmoor: 'Tamsin Highwind, a tall calm human woman in her forties, a flight master in a high-collared wind-worn riding coat',
  flight_spire: 'Kestrel Duskwing, a hawk-nosed human man in his thirties, a flight master in deep blue flying leathers with silver buckles',
};

/**
 * A handful of subjects come out wrong on the roll their own id gives them - two swords where the
 * prompt asks for one, a portrait painted down to the waist while the rest are head and shoulders -
 * and no wording talks the model out of a bad roll. Rerolling only those keeps every other picture
 * byte for byte what it was, and keeps the set reproducible from a clean checkout, which rerolling
 * by hand with --seed does not.
 *
 * Keyed by `kind/id`, not by id alone: an id is only unique within its kind, and Hemorrhage is both
 * an ability and a talent. Keyed by id, rerolling one of them silently rerolled the other too.
 */
export const REROLLS: Record<string, number> = {
  'items/adamant_chestplate': 1,
  'items/steel_sword': 1,
  'items/stormiron_blade': 1,
  'items/tanned_hide': 1,
  'items/thorn_leather': 2,
  'abilities/colossus_blow': 1,
  'abilities/crushing_blow': 1,
  'abilities/hemorrhage': 1,
  'portraits/vendor_trainer': 2,
  // Light-on-dark backwards: the model painted these on parchment, a brown panel or a pale halo, and
  // the flood that flattens the backdrop starts at the border and cannot get past a lit pixel.
  'talents/carnage': 1,
  'talents/guardian': 1,
  'talents/hemorrhage': 2,
  'talents/vigour': 1,
  // Not what the prompt asked for: a second demon face beside Berserk rather than a split helm, two
  // plain daggers rather than one slipping behind a plate, and a pair of boots rather than one.
  'talents/opportunist': 1,
  'talents/ruin': 1,
  'talents/stalwart': 1,
};

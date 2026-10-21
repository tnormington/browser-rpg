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

// --- the items --------------------------------------------------------------------------------
/** One phrase per item id in ITEMS. Keep each to the object itself: the style suffix does the rest. */
export const ITEM_SUBJECTS = {
  // hides and leathers
  boar_hide: `${HIDE}, coarse bristled brown boar hide`,
  wolf_pelt: `${HIDE}, thick grey wolf fur`,
  marsh_hide: `${HIDE}, slick dark green-black marsh hide`,
  thorn_hide: `${HIDE}, tough russet hide studded with short barbs`,
  moor_hide: `${HIDE}, heavy weathered grey-green hide`,
  tanned_hide: 'a flat square of cured tan boar leather, edges trimmed clean',
  wolf_leather: 'a flat square of cured grey wolf leather, edges trimmed clean',
  marsh_leather: 'a flat square of cured dark slick marsh leather, edges trimmed clean',
  thorn_leather: 'a flat square of cured russet thorn leather, short barbs still in it',
  moor_leather: 'a flat square of cured heavy grey-green moor leather, edges trimmed clean',

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
  leather_cap: 'an empty simple stitched brown leather cap, worn by nobody',
  hide_jerkin: 'an empty sleeveless stitched brown hide jerkin standing upright, worn by nobody',
  hide_leggings: 'a pair of empty stitched brown hide leggings standing side by side, worn by nobody',

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
  vendor_thorn_trainer: 'Brannock Vane, a heavy-browed human man in his forties, a sword trainer in a sleeveless gambeson, forearms thick with old scars',
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

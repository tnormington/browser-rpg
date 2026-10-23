# Build the player's model out of the three purchased CC0 packs: one figure, one skeleton, the clips the game plays.
#
#   & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup `
#       --python scripts/build-player.py -- <packs-root> <out.glb> [--keep-maps] [--no-decimate]
#
# <packs-root> is the directory the three zips were extracted into, OUTSIDE the repo (they are ~1.2 GB unpacked
# against a 4.3 MB models directory, and only this one exported file is ever committed):
#
#   <packs-root>/outfits-source/Modular Character Outfits - Fantasy[Source]/...
#   <packs-root>/base-chars/Universal Base Characters[Standard]/...
#   <packs-root>/ual-source/Unreal-Godot/UAL1.glb
#
# Then check the result against the name contract before it lands:
#   $env:MODEL_DIR=<dir>; npx tsx src/model-contract.test.ts
#
# ---------------------------------------------------------------------------------------------------------------
# Three things measured out of the packs decide the shape of this script.
#
# 1. The three packs share one skeleton of 65 joints -- same names, same parentage -- but NOT one rest pose. The
#    animation library's mannequin is a different body from the character: its shin is 0.4003 against the outfit's
#    0.4288, its forearm 0.2744 against 0.2511, its hips sit 3 cm lower. glTF animation channels are absolute local
#    TRS, so copying UAL's tracks onto the character's skeleton would drive the character's bones to the mannequin's
#    proportions and deform every mesh by the difference. Blender's pose space is REST-RELATIVE, so assigning the
#    imported action to the character's armature and re-exporting is a real retarget, not a copy: each bone keeps its
#    own rest and takes the clip's offset from it. That is the whole reason this goes through Blender rather than
#    through a glTF merge.
#
# 2. The outfit is the body. The pack's readme: "only the head of the model is required. Using the full body will
#    result in clipping." So the figure is the Peasant set (what "wearing nothing" renders as) plus the base
#    character's head, cut off its body by vertex weight -- not a nude body with clothes over it.
#
# 3. The parts arrive as separate meshes, so the legs no longer have to be peeled off the chest by bone weight the way
#    `splitBones` peeled the knight's. Each part is given the material name the game dresses it by (models.ts SLOTS,
#    gear.ts dressBody), which is what keeps the tier ladder working on an authored figure.
import bpy
import sys
import os

args = sys.argv[sys.argv.index('--') + 1:]
PACKS, OUT = args[0], args[1]
KEEP_MAPS = '--keep-maps' in args
DECIMATE = '--no-decimate' not in args

OUTFIT = os.path.join(PACKS, 'outfits-source', 'Modular Character Outfits - Fantasy[Source]',
                      'Exports', 'glTF (Godot-Unreal)', 'Outfits', 'Male_Peasant.gltf')
BASE = os.path.join(PACKS, 'base-chars', 'Universal Base Characters[Standard]',
                    'Base Characters', 'Godot - UE', 'Superhero_Male_FullBody.gltf')
UAL = os.path.join(PACKS, 'ual-source', 'Unreal-Godot', 'UAL1.glb')

# The material each part is dressed by. models.ts keys colours and surface classes off these names and gear.ts
# recolours the first four as the worn item changes, so they are the file's half of that contract.
#   Armor      the chest: the body and the sleeves of the Peasant set
#   ArmorLegs  the legs, which the knight's file did not carry: models.ts cut them out of Armor by bone weight
#   Boots      the feet
#   Skin       the head, and the bare forearms and hands the sleeves leave; models.ts peels Hands off it by bone weight
PARTS = {
    'Male_Peasant_Body': {'MI_Peasant': 'Armor'},
    'Male_Peasant_Arms': {'MI_Peasant': 'Armor', 'MI_Regular_Male': 'Skin'},
    'Male_Peasant_Legs': {'MI_Peasant': 'ArmorLegs'},
    'Male_Peasant_Feet': {'MI_Peasant': 'Boots'},
    'SuperHero_Male': {'MI_Superhero_Male': 'Skin'},
    'Eyes': {'MI_Eyes': 'Eyes'},
    'Eyebrows': {'MI_Hair_1': 'Hair'},
}

# The six clips SLOTS.player.anim plays, under the names the library ships them as. `Jump` is the one that is built
# rather than picked: the library has a three-part jump (crouch, airborne loop, landing absorb) where the game wants
# one clip it can stretch over the airtime (AnimDef.jumpSpan), so the three are laid end to end and baked into one.
CLIPS = ['Idle_Loop', 'Jog_Fwd_Loop', 'Sword_Attack', 'Sword_Attack_Standing', 'Death01']
# `Jump_Loop` is left out of the three on purpose: none of the library's clips carries root motion (this is the
# non-_RM file), so the loop is a held hanging pose with no travel in it -- 60 frames the game would stretch over an
# airtime it is already stretching the push and the reach over. Start and Land chain straight into each other.
JUMP = ['Jump_Start', 'Jump_Land']

# Triangles per mesh after decimation. The pack is authored for a hero shot: the Peasant figure plus a head is 16,730
# triangles against the knight's 956, and against 7,659 for the blacksmith, the heaviest thing the game ships. These
# ratios take it to roughly a blacksmith. The head is left alone -- it is the one part a face is read off, and it is
# cheap; the body and the sleeves are where the triangles are.
BUDGET = {
    'Male_Peasant_Body': 0.35,
    'Male_Peasant_Arms': 0.3,
    'Male_Peasant_Legs': 0.5,
    'Male_Peasant_Feet': 0.35,
    'SuperHero_Male': 1.0,
    'Eyes': 0.25,
    'Eyebrows': 0.4,
}

TEXTURE_SIZE = 1024   # the pack ships 4K maps; a figure two world units tall never shows the difference


def log(*a):
    print('[build-player]', *a)


def imported(fn):
    """The objects one import added."""
    before = set(bpy.data.objects)
    fn()
    return [o for o in bpy.data.objects if o not in before]


def delete(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
log('blender', bpy.app.version_string)

# ---- the figure: the outfit's armature is the one everything else is brought onto --------------------------------

outfit = imported(lambda: bpy.ops.import_scene.gltf(filepath=OUTFIT))
rig = next(o for o in outfit if o.type == 'ARMATURE')
meshes = [o for o in outfit if o.type == 'MESH' and o.name in PARTS]
delete([o for o in outfit if o.type == 'MESH' and o.name not in PARTS])   # each pack file carries a stray Icosphere
log('outfit', [o.name for o in meshes], 'rig', rig.name, len(rig.data.bones), 'bones')

base = imported(lambda: bpy.ops.import_scene.gltf(filepath=BASE))
head = [o for o in base if o.type == 'MESH' and o.name in PARTS]
base_rig = [o for o in base if o.type == 'ARMATURE']
delete([o for o in base if o.type == 'MESH' and o.name not in PARTS])

# Cut the head off the base character's body: keep the vertices the head and the neck carry, drop the rest. The
# Peasant parts ARE the torso, arms and legs -- leaving the base body under them is the clipping the readme warns of.
body = next(o for o in head if o.name == 'SuperHero_Male')
keep = {body.vertex_groups[n].index for n in ('Head', 'neck_01')}
doomed = [v.index for v in body.data.vertices
          if sum(g.weight for g in v.groups if g.group in keep) < 0.5]
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')
for i in doomed:
    body.data.vertices[i].select = True
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.delete(type='VERT')
bpy.ops.object.mode_set(mode='OBJECT')
log('head cut:', len(body.data.vertices), 'vertices kept of', len(body.data.vertices) + len(doomed))

# The head, the eyes and the brows ride the outfit's armature from here. The two rigs agree exactly on the spine, the
# neck and the head (they differ only at the shoulders, the hips and the fingers), so this is a re-parent and not a
# re-bind: the vertex groups already name the right bones.
for o in head:
    o.parent = rig
    o.matrix_parent_inverse = rig.matrix_world.inverted()
    for m in o.modifiers:
        if m.type == 'ARMATURE':
            m.object = rig
    meshes.append(o)
delete(base_rig)

# ---- the clips: imported against the library's own mannequin, then retargeted by assignment ----------------------

ual = imported(lambda: bpy.ops.import_scene.gltf(filepath=UAL))
log('library', len(bpy.data.actions), 'actions')

scene = bpy.context.scene
rig.animation_data_create()


def assign(action):
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]


def bake(name, frames):
    """Bake the pose the rig is in over `frames` into an action of its own, so what ships is what was evaluated."""
    scene.frame_start, scene.frame_end = frames[0], frames[1]
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.nla.bake(frame_start=frames[0], frame_end=frames[1], only_selected=False,
                     visual_keying=True, clear_constraints=False, clear_parents=False,
                     use_current_action=False, bake_types={'POSE'})
    out = rig.animation_data.action
    out.name = name
    out.use_fake_user = True
    return out


wanted = []
for name in CLIPS:
    src = bpy.data.actions[name]
    assign(src)
    wanted.append(bake(name + '_baked', (int(src.frame_range[0]), int(round(src.frame_range[1])))))

# The jump, laid end to end on one NLA track and baked flat. The game stretches `jumpSpan` of the result over the
# airtime, so the crouch before the push and the absorb after the landing sit outside that span rather than being lost.
track = rig.animation_data.nla_tracks.new()
track.name = 'Jump'
at = 0
for name in JUMP:
    src = bpy.data.actions[name]
    strip = track.strips.new(name, at, src)
    strip.blend_type = 'REPLACE'
    strip.extrapolation = 'HOLD_FORWARD'
    at = int(round(strip.frame_end))
rig.animation_data.action = None
wanted.append(bake('Jump_baked', (0, at)))
log('jump composed over', at, 'frames:', [f'{n} {bpy.data.actions[n].frame_range[1]:.0f}f' for n in JUMP])
rig.animation_data.nla_tracks.remove(track)

# Everything the library brought with it goes: 120 actions, a mannequin and a second skeleton.
delete([o for o in ual])
for a in list(bpy.data.actions):
    if a not in wanted:
        bpy.data.actions.remove(a)
for a, name in zip(wanted, CLIPS + ['Jump']):
    a.name = name
rig.animation_data.action = None
log('clips', [a.name for a in bpy.data.actions])

# ---- materials, triangles, maps ----------------------------------------------------------------------------------

# One material per contract name, copied rather than renamed: the pack shares a single `MI_Peasant` datablock across
# the body, the sleeves, the legs and the feet, and the game has to be able to recolour those four apart.
dressed = {}
for o in meshes:
    for slot in o.material_slots:
        want = PARTS[o.name].get(slot.material.name)
        if not want:
            continue
        if want not in dressed:
            dressed[want] = slot.material.copy()
            dressed[want].name = want
        slot.material = dressed[want]

if DECIMATE:
    for o in meshes:
        ratio = BUDGET.get(o.name, 1.0)
        if ratio >= 1.0:
            continue
        m = o.modifiers.new('decimate', 'DECIMATE')
        m.ratio = ratio
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)

tris = 0
for o in meshes:
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
    log(f'  {o.name:28s} {len(o.data.loop_triangles):6d} tris  [{", ".join(s.material.name for s in o.material_slots)}]')
log('total', tris, 'triangles')

if KEEP_MAPS:
    # Two of the base character's normal maps name a file the pack does not ship (`T_Eye_Normal_png.png` for
    # `T_Eye_Normal.png`), so they import as empty images. Left in, the exporter writes a texture with no image behind
    # it and three's loader throws reading its uri -- the model never loads and the player is a grey box.
    gone = {i for i in bpy.data.images
            if i.source == 'FILE' and not os.path.exists(bpy.path.abspath(i.filepath))}
    for mat in bpy.data.materials:
        for node in [n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and (not n.image or n.image in gone)]:
            log('dropping texture with no file behind it:', mat.name, node.image.name if node.image else '(none)')
            mat.node_tree.nodes.remove(node)
    for img in bpy.data.images:
        if img not in gone and img.size[0] > TEXTURE_SIZE:
            img.scale(TEXTURE_SIZE, TEXTURE_SIZE)
    # One UV set each. The pack ships up to four per mesh (the base character's head has lightmap and detail sets);
    # the materials sample the first, and the rest are a float2 per vertex that nothing ever reads.
    for o in meshes:
        for uv in [u for u in o.data.uv_layers][1:]:
            o.data.uv_layers.remove(uv)
else:
    # The game throws the pack's maps away at load unless the slot asks to keep them (models.ts keepMaps), and the
    # pack's are 4K: shipping them unasked would be ten megabytes of texture in a four-megabyte models directory.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in [n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE']:
            mat.node_tree.nodes.remove(node)

# The base character's three meshes carry its own names into the file; `SuperHero_Male` is the head once it is cut.
# Nothing here may be called after a bone: gear.ts and anim.ts find bones by traversing for a node name.
for o, name in (('SuperHero_Male', 'Player_Head'), ('Eyes', 'Player_Eyes'), ('Eyebrows', 'Player_Brows')):
    if o in bpy.data.objects:
        bpy.data.objects[o].name = name

bpy.ops.object.select_all(action='DESELECT')
for o in meshes + [rig]:
    o.select_set(True)
bpy.context.view_layer.objects.active = rig

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_skins=True,
    # False: the rig already ends in real tip bones (ball_leaf_*, middle_04_leaf_*, Head), which is what the greaves,
    # the boots and the glove fingertips are sized along. On, the exporter hangs a second tip off every one of them --
    # 13 bones that nothing reads. The knight needed this option; this rig does not (scripts/glb-roundtrip.py).
    export_leaf_bone=False,
    export_image_format='WEBP' if KEEP_MAPS else 'NONE',
    export_image_quality=80,
    # Without the pack's maps there is nothing for the UVs to be read against: the game re-projects its own
    # (surface.ts bakeUV) wherever it is imposing its own surface class.
    export_texcoords=KEEP_MAPS,
    # Never: the pack's two colour layers are authoring masks, not shading. three turns `vertexColors` on for any
    # primitive that carries COLOR_0 and multiplies it into the material's colour, so shipping them tinted every
    # named colour in SLOTS toward the mask -- which is what `plain` was added for on the horses, and is better not
    # written into the file at all.
    export_vertex_color='NONE',
    export_optimize_animation_size=True,
    # False is the faithful one: True re-keys every clip over the whole skeleton (scripts/glb-roundtrip.py)
    export_optimize_animation_keep_anim_armature=False,
)
log('wrote', OUT, f'{os.path.getsize(OUT) / 1024:.0f} KB')

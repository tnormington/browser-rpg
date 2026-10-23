# Export the worn garments out of the Modular Character Outfits pack, in the player's own space.
#
#   & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup `
#       --python scripts/build-garment.py -- <packs-root> <out-dir> [gear_feet_hide ...]
#
# With no names it writes all of GARMENTS. <packs-root> is the directory build-player.py reads; each part comes from
#   <packs-root>/outfits-source/Modular Character Outfits - Fantasy[Source]/Exports/glTF (Godot-Unreal)/Modular Parts/
#
# A garment is NOT a prop hung off a bone. Every part in this pack is a skinned mesh over the same 65-joint rig the
# player is built on, so a boot bends at the ankle and a legs piece at the knee because the skeleton moves it -- there
# is no bone a thigh-to-ankle shell could hang from and still follow the leg. gear.ts mounts one by rebinding it to the
# player's own skeleton (`wear()`), which is why this script must not move, scale or re-pose anything: a part leaves
# here in exactly the space build-player.py left the figure in, and the two line up because they came out of the same
# pack's rig. The armature is exported alongside the mesh only because the exporter writes no skin data without one;
# the game throws that copy away and keeps the joint names.
#
# The material is renamed `Shell` whatever the pack called it (MI_Knight, MI_Ranger...), because gear.ts recolours a
# worn piece by material name and the tier ladder is that retint: one name means one call site for every garment.
import bpy
import sys
import os

# What each shipped file is cut from, and the decimation that takes it to roughly 1,300 triangles. The pack is authored
# for a hero shot and these are worn over a 7,838-triangle figure; the ranger's boots alone are 9,172.
#
# Two shells a slot, not five, because that is what the ladder actually asks for: every boot in the game is leather
# (Hide through Echohide), so the knight's sabatons have no item to be, and no legs item below bronze is plate. The
# wizard's robe and the peasant's own legs and feet are out for a different reason -- the figure already wears those
# two, since the pack's parts ARE its body.
GARMENTS = {
    'gear_head_hood':  ('Male_Ranger_Head_Hood', 0.6),
    'gear_legs_hide':  ('Male_Ranger_Legs', 1.0),
    'gear_legs_plate': ('Male_Knight_Legs_Armor', 0.45),
    'gear_feet_hide':  ('Male_Ranger_Feet_Boots', 0.15),
    'gear_feet_fine':  ('Male_Noble_Feet', 0.35),
}

args = sys.argv[sys.argv.index('--') + 1:]
PACKS, OUT_DIR = args[0], args[1]
WANTED = args[2:] or list(GARMENTS)

PARTS_DIR = os.path.join(PACKS, 'outfits-source', 'Modular Character Outfits - Fantasy[Source]',
                         'Exports', 'glTF (Godot-Unreal)', 'Modular Parts')


def log(*a):
    print('[build-garment]', *a)


def build(name, part, ratio):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PARTS_DIR, part + '.gltf'))
    objs = list(bpy.data.objects)
    rig = next(o for o in objs if o.type == 'ARMATURE')
    mesh = next(o for o in objs if o.type == 'MESH' and o.name == part)
    # each part file carries a stray Icosphere next to the garment
    for o in [o for o in objs if o.type == 'MESH' and o is not mesh]:
        bpy.data.objects.remove(o, do_unlink=True)

    for slot in mesh.material_slots:
        slot.material = slot.material.copy()
        slot.material.name = 'Shell'

    if ratio < 1.0:
        m = mesh.modifiers.new('decimate', 'DECIMATE')
        m.ratio = ratio
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.modifier_apply(modifier=m.name)

    # The game re-projects its own UVs and hangs its own surface maps over a worn piece (surface.ts), and the pack's
    # maps are 4K: shipping them unasked would be megabytes of texture nothing samples.
    for mat in bpy.data.materials:
        if mat.node_tree:
            for node in [n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE']:
                mat.node_tree.nodes.remove(node)

    # Nothing may be called after a bone: gear.ts and anim.ts find bones by traversing for a node name.
    mesh.name = 'Garment'

    out = os.path.join(OUT_DIR, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for o in (mesh, rig):
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_animations=False,
        export_skins=True,
        # As build-player.py: the rig already ends in real tip bones, and on, the exporter hangs a second tip off each.
        # Here it matters twice over -- an extra joint shifts every joint after it, and the rebind maps by name.
        export_leaf_bone=False,
        export_image_format='NONE',
        export_texcoords=False,
        export_vertex_color='NONE',
    )
    mesh.data.calc_loop_triangles()
    log(f'{name:18s} {part:26s} {len(mesh.data.loop_triangles):5d} tris  {os.path.getsize(out) / 1024:5.0f} KB')


log('blender', bpy.app.version_string)
os.makedirs(OUT_DIR, exist_ok=True)
for name in WANTED:
    part, ratio = GARMENTS[name]
    build(name, part, ratio)

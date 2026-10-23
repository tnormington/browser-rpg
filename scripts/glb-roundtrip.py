# Import a .glb into an empty Blender scene and export it straight back out: the export recipe the asset swap uses,
# and the proof that a round trip through Blender keeps everything the game reads out of the file by name.
#
#   & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup `
#       --python scripts/glb-roundtrip.py -- <in.glb> <out.glb>
#
# Then check the result against the contract:  $env:MODEL_DIR=<dir>; npx tsx src/model-contract.test.ts
#
# Measured on knight.glb against Blender 5.2.3 (HOM-202, phase 1). With the settings below the trip is exact: the same
# 45 nodes (the six `*_end` tips included), 3 materials, 12 clips with their `HumanArmature|` prefixes, and the same
# set of bones animated by each clip -- in a file 31% smaller than the one the pack shipped (272 KB against 393 KB).
#
# One setting carries all of that, and it is on by default:
#
#   export_optimize_animation_keep_anim_armature  default True, and True re-keys EVERY clip over the WHOLE skeleton:
#       Idle goes from 13 animated bones to 31, Run from 20 to 31. Nothing is named wrong, nothing fails to load, and
#       the file is 4% bigger than the original rather than a third smaller -- but Idle now writes the Abdomen, which
#       is the bone `anim.ts` reaches into for the mounted lean and the swing's hip twist. False is the faithful one.
#
# Two settings that turned out not to matter here, recorded so nobody re-tests them:
#
#   export_leaf_bone  no effect on this file either way. The `*_end` tips arrive from the importer as real bones, not
#       as Blender leaf bones, so they are exported because they exist -- not because the option asks for them. It is
#       left on because a rig authored in Blender from scratch is the case the option is actually for.
#   export_optimize_animation_size  file size only (272 KB on, 302 KB off); the track sets are identical.
import bpy
import sys

src, dst = sys.argv[sys.argv.index('--') + 1:][:2]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_skins=True,
    export_leaf_bone=True,
    export_optimize_animation_size=True,
    export_optimize_animation_keep_anim_armature=False,
)
print('ROUNDTRIP OK', dst)

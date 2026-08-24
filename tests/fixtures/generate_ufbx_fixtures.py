"""Generate the tiny binary FBX fixtures used by the native ufbx tests.

This is intentionally separate from ``_generate.mjs``: the latter generates
the older ASCII fixture set for the Three.js tests.  The checked-in binary
files are the normal test input, so Blender is only needed when regenerating
them manually:

    blender --background --python tests/fixtures/generate_ufbx_fixtures.py -- \
      --out-dir tests/fixtures/models

Blender 5.2's FBX exporter is used only to produce self-authored fixtures;
normal CI does not invoke this script.
"""

import argparse
import os
import sys

import bpy


FPS = 24.0


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    return parser.parse_args(argv)


def make_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = int(FPS)
    scene.render.fps_base = 1.0

    mesh = bpy.data.meshes.new("UfbxFixtureTriangleMesh")
    mesh.from_pydata(((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)), [], ((0, 1, 2),))
    mesh.update()
    obj = bpy.data.objects.new("AnimatedTriangle", mesh)
    bpy.context.collection.objects.link(obj)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    material = bpy.data.materials.new("FixtureOpaque")
    material.diffuse_color = (0.8, 0.35, 0.15, 1.0)
    obj.data.materials.append(material)
    return scene, obj


def make_action(obj, name, keys):
    # Blender 4.4+ stores action curves in layered channel bags.  The RNA
    # keyframe API creates the right action/slot wiring for every supported
    # Blender version and keeps this fixture generator small.
    obj.animation_data_clear()
    for frame, value in keys:
        obj.location = value
        obj.keyframe_insert(data_path="location", frame=frame)
    action = obj.animation_data.action
    action.name = name
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for curve in channelbag.fcurves:
                    for point in curve.keyframe_points:
                        point.interpolation = "LINEAR"
                    curve.update()
    return action


def export(scene, obj, output, actions, frame_start, frame_end):
    scene.frame_start = frame_start
    scene.frame_end = frame_end
    obj.animation_data.action = actions[0]
    for action in actions:
        action.use_fake_user = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.fbx(
        filepath=os.path.abspath(output),
        use_selection=True,
        object_types={"MESH"},
        apply_unit_scale=True,
        axis_forward="-Z",
        axis_up="Y",
        add_leaf_bones=False,
        bake_anim=True,
        bake_anim_use_all_actions=True,
        bake_anim_use_nla_strips=False,
        bake_anim_force_startend_keying=True,
        bake_anim_step=1.0,
    )


def main():
    args = parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    scene, obj = make_scene()
    fixture_take = make_action(
        obj,
        "FixtureTake",
        ((1.0, (0.0, 0.0, 0.0)), (13.0, (0.0, 0.0, 0.01)), (25.0, (0.0, 0.0, 0.02))),
    )
    export(
        scene,
        obj,
        os.path.join(args.out_dir, "animated-triangle.fbx"),
        (fixture_take,),
        1,
        25,
    )

    scene, obj = make_scene()
    take_a = make_action(
        obj,
        "Take A",
        ((1.0, (0.0, 0.0, 0.0)), (13.0, (0.05, 0.0, 0.0)), (25.0, (0.10, 0.0, 0.0))),
    )
    take_b = make_action(
        obj,
        "Take B",
        (
            (-11.0, (-0.10, 0.0, 0.0)),
            (13.0, (0.0, 0.0, 0.0)),
            (25.0, (0.05, 0.0, 0.0)),
            (26.0, (0.05, 0.0, 0.0)),
        ),
    )
    export(
        scene,
        obj,
        os.path.join(args.out_dir, "animated-take-ranges.fbx"),
        (take_a, take_b),
        -11,
        26,
    )


if __name__ == "__main__":
    main()

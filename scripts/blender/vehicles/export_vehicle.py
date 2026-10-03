"""Build the drivable (LOD0) car from the parametric generator and export it for the web game.

  blender -b --factory-startup -P scripts/blender/vehicles/export_vehicle.py -- [taxi]

Writes export/vehicles/<name>.glb. Parts stay separate objects so the game can animate them:
WHEEL_* (spin about local X, front ones steer), DOOR_*, STEER, plus SEAT_* / EXIT_* / CAM_* empties
and the topper / back-seat screen ad slots (extras carry slot_id). Front = +Y in Blender (-Z in three.js).
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import car_gen  # noqa: E402
import ts_common as C  # noqa: E402

VEHICLES = {"taxi": (car_gen.NYC_CAB, "M_Car_Paint_TaxiLivery", True)}
LIVERY = C.project_path("data", "vehicles", "taxi_livery.png")     # scripts/tools/make_taxi_livery.py


def livery_material():
    """Cab yellow + lettering as an image texture (the yellow is baked into it), on the car-paint shading."""
    base = C.get_material("M_Car_Paint_TaxiYellow")
    m = base.copy(); m.name = "M_Car_Paint_TaxiLivery"
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(LIVERY)
    tex.image.colorspace_settings.name = "sRGB"
    for l in list(bsdf.inputs["Base Color"].links):
        nt.links.remove(l)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m
TAXI_YELLOW = (0.93, 0.5, 0.0, 1.0)   # NYC cab yellow (amber)


def main(name="taxi"):
    spec, paint, taxi = VEHICLES[name]
    bpy.ops.wm.read_homefile(use_empty=True)
    coll = bpy.data.collections.new(f"VEH_{name}")
    bpy.context.scene.collection.children.link(coll)
    if paint == "M_Car_Paint_TaxiLivery":
        livery_material()
    objs = car_gen.build_vehicle(spec, paint, coll, lod=0, taxi=taxi)
    m = bpy.data.materials.get(paint)
    if m and taxi and m.node_tree and paint != "M_Car_Paint_TaxiLivery":
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Base Color"].default_value = TAXI_YELLOW
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        o.select_set(o.name in coll.all_objects)
    out = C.project_path("export", "vehicles", f"{name}.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_extras=True,
                              export_apply=True, export_yup=True, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6, export_image_format="WEBP")
    tris = sum(C.tri_count(o) for o in objs.values() if o.type == "MESH")
    print(f"exported {out}: {len(objs)} parts, {tris} tris, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(*(args or ["taxi"]))

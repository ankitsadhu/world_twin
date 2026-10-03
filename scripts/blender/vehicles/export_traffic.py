"""Build the traffic cars (LOD1: one light mesh per car, no interior to see) and export them for the game.

  Blender -b --factory-startup -P scripts/blender/vehicles/export_traffic.py   -> export/vehicles/traffic.glb

The game's traffic (viewer/js/traffic.js) instances these by name (PROP_Taxi, PROP_CarSedanBlack, ...) and falls
back to the props chunk's older cars if this file is missing. Cabs carry the cab livery; SUVs share the cab's
modern crossover body in their own paint; sedans use the crisp sedan body.
"""
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import car_gen  # noqa: E402
import export_vehicle  # noqa: E402
import ts_common as C  # noqa: E402

TRAFFIC = {
    "Taxi": ("NYC_CAB", "M_Car_Paint_TaxiLivery", True),
    "CarSedanBlack": ("SEDAN_CRISP", "M_Car_Paint_Black", False),
    "CarSedanWhite": ("SEDAN_CRISP", "M_Car_Paint_White", False),
    "CarSUVSilver": ("SUV", "M_Car_Paint_Silver", False),
    "CarSedanBlue": ("SEDAN_CRISP", "M_Car_Paint_Blue", False),
    "CarSUVRed": ("SUV", "M_Car_Paint_Red", False),
}


def build(name, spec_name, paint, taxi):
    coll = bpy.data.collections.new(f"TR_{name}")
    bpy.context.scene.collection.children.link(coll)
    objs = car_gen.build_vehicle(getattr(car_gen, spec_name), paint, coll, lod=1, taxi=taxi)
    bpy.context.view_layer.update()
    meshes = [o for o in objs.values() if o.type == "MESH" and not o.name.startswith("AD_")]
    bm, mats = bmesh.new(), []
    for o in meshes:
        tmp = o.data.copy(); tmp.transform(o.matrix_world)
        remap = []
        if not tmp.materials:                                  # an unpainted part (none expected): trim black
            tmp.materials.append(C.get_material("M_Car_TrimBlack"))
        for i, m in enumerate(tmp.materials):
            if m is None:
                tmp.materials[i] = m = C.get_material("M_Car_TrimBlack")
            if m.name not in [x.name for x in mats]:
                mats.append(m)
            remap.append([x.name for x in mats].index(m.name))
        for p in tmp.polygons:
            p.material_index = remap[p.material_index] if remap else 0
        bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    for o in list(coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new(f"PROP_{name}"); bm.to_mesh(me); bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(f"PROP_{name}", me)
    coll.objects.link(o)
    return o


def main():
    bpy.ops.wm.read_homefile(use_empty=True)
    export_vehicle.livery_material()
    out = [build(n, *v) for n, v in TRAFFIC.items()]
    bpy.ops.object.select_all(action="DESELECT")
    for o in out:
        o.select_set(True)
    path = C.project_path("export", "vehicles", "traffic.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_draco_mesh_compression_enable=True, export_image_format="WEBP")
    print("TRAFFIC", path, os.path.getsize(path) // 1024, "KB;", ", ".join(f"{o.name} {C.tri_count(o)}" for o in out))


main()

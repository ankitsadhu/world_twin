"""Build the harbour district from data/harbor/harbor.json (made by scripts/tools/prep_harbor.py).

  blender -b --factory-startup -P scripts/blender/build_harbor.py

Outputs (shared local frame with Times Square, Z up, glTF Y up):
  export/harbor/land.glb       land (z 0) with a concrete bulkhead down to the water, and the piers
  export/harbor/buildings.glb  ~17k buildings at surveyed heights, merged per 600 m cell, Times Square's facade
                               materials (lit windows at night) and roof membrane
The Statue of Liberty (export/harbor/liberty.glb) is placed by the viewer at harbor.json's statue position.
"""
import math
import os
import random
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402
from import_footprints import add_building, _tile  # noqa: E402

CELL = 600.0
bpy.ops.wm.read_factory_settings(use_empty=True)
COLL = bpy.context.scene.collection
H = C.load_json("data/harbor/harbor.json")


def mesh_obj(name, fill, mats):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    fill(bm, uvl)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(name, me)
    COLL.objects.link(o)
    return o


# ---------------------------------------------------------------- land, bulkhead, piers
ground = C.get_material("M_Sidewalk_Concrete")
bulk = C.get_material("M_Stone_GraniteDark")
pier_m = C.get_material("M_Road_Asphalt")


lawn = bpy.data.materials.new("M_Harbor_Lawn")
lawn.use_nodes = True
lawn.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.13, 0.22, 0.08, 1)
lawn.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95


def fill_land(bm, uvl):
    for tri, mi in [(t, 0) for t in H["land_tris"]] + [(t, 3) for t in H.get("park_tris", [])]:
        vs = [bm.verts.new((x, y, 0.0)) for x, y in tri]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            continue
        if f.normal.z < 0 or (vs[1].co - vs[0].co).cross(vs[2].co - vs[0].co).z < 0:
            f.normal_flip()
        f.material_index = mi
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x / 3.0, loop.vert.co.y / 3.0)
    for tri in H.get("road_tris", []):                        # streets: asphalt a few cm above the blocks
        vs = [bm.verts.new((x, y, 0.03)) for x, y in tri]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            continue
        if (vs[1].co - vs[0].co).cross(vs[2].co - vs[0].co).z < 0:
            f.normal_flip()
        f.material_index = 4
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x / 4.0, loop.vert.co.y / 4.0)
    for ring in H["land_rings"] + H["land_holes"]:            # the seawall: concrete from the street down into the water
        n = len(ring)
        for i in range(n):
            (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % n]
            vs = [bm.verts.new(p) for p in ((x0, y0, 0.0), (x1, y1, 0.0), (x1, y1, -3.0), (x0, y0, -3.0))]
            f = bm.faces.new(vs)
            f.material_index = 1
            seg = math.dist((x0, y0), (x1, y1))
            for loop, uv in zip(f.loops, ((0, 0), (seg / 2.3, 0), (seg / 2.3, 1.3), (0, 1.3))):
                loop[uvl].uv = uv
    for ring in H["piers"]:                                   # piers: a deck at +1.2 on walls down into the water
        pts = ring if C_signed(ring) > 0 else list(reversed(ring))
        top = [bm.verts.new((x, y, 1.2)) for x, y in pts]
        bot = [bm.verts.new((x, y, -2.5)) for x, y in pts]
        try:
            f = bm.faces.new(top)
            f.material_index = 2
            for loop in f.loops:
                loop[uvl].uv = (loop.vert.co.x / 4.0, loop.vert.co.y / 4.0)
        except ValueError:
            pass
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            f = bm.faces.new((bot[i], bot[j], top[j], top[i]))
            f.material_index = 1
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])


def C_signed(pts):
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))

asphalt = C.get_material("M_Road_Asphalt")
land = mesh_obj("HB_land", fill_land, [ground, bulk, pier_m, lawn, asphalt])

# ---------------------------------------------------------------- buildings, merged per cell
roof = C.get_material("M_Roof_Membrane")
cells = {}
for b in H["buildings"]:
    xs, ys = zip(*b["outline"])
    key = (math.floor(sum(xs) / len(xs) / CELL), math.floor(sum(ys) / len(ys) / CELL))
    cells.setdefault(key, []).append(b)
n_obj = 0
for (cx, cy), group in cells.items():
    names = sorted({g["mat"] for g in group})
    mats = [C.get_material(m) for m in names] + [roof]

    def fill(bm, uvl, group=group, names=names, mats=mats):
        for g in group:
            i = names.index(g["mat"])
            add_building(bm, uvl, g["outline"], g["h"], i, len(names), _tile(mats[i]), _tile(roof),
                         u_offset=random.Random(g["seed"]).uniform(0, 30))
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    mesh_obj(f"HB_cell_{cx}_{cy}", fill, mats)
    n_obj += 1

# One World Trade Center: the footprint data stops at the roof ring (429.3 m); the spire takes it to 541.3 m (1,776 ft)
owtc = next((b for b in H["buildings"] if b["seed"] == "1088469"), None)
if owtc:
    xs, ys = zip(*owtc["outline"])
    cx, cy, z0 = sum(xs) / len(xs), sum(ys) / len(ys), owtc["h"]
    steel = C.get_material("M_Metal_Steel")
    beacon = bpy.data.materials.new("M_Light_WTCBeacon")
    beacon.use_nodes = True
    bb = beacon.node_tree.nodes["Principled BSDF"]
    bb.inputs["Base Color"].default_value = (1, 1, 1, 1)
    bb.inputs["Emission Color"].default_value = (1, 1, 1, 1)
    bb.inputs["Emission Strength"].default_value = 8.0

    def fill_spire(bm, uvl):
        for (za, zb, ra, rb, mi) in ((z0, z0 + 6.0, 7.0, 6.0, 0), (z0 + 6.0, z0 + 110.0, 1.6, 0.6, 0), (z0 + 110.0, 541.3, 0.6, 0.25, 1)):
            ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=ra, radius2=rb, depth=zb - za)
            bmesh.ops.translate(bm, verts=ret["verts"], vec=(cx, cy, (za + zb) / 2))
            for f in {f for v in ret["verts"] for f in v.link_faces}:
                f.material_index = mi
        for z in (z0 + 30.0, z0 + 55.0, z0 + 80.0):                 # the spire's maintenance rings
            ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=2.6, radius2=2.6, depth=1.2)
            bmesh.ops.translate(bm, verts=ret["verts"], vec=(cx, cy, z))
    mesh_obj("HB_cell_onewtc_spire", fill_spire, [steel, beacon])
    print("ONE WTC spire on", round(cx), round(cy), "from", z0, "to 541.3 m")

tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
print(f"HARBOR {len(H['buildings'])} buildings in {n_obj} cells, land {len(H['land_tris'])} tris, {len(H['piers'])} piers, {tris} tris total")


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(C.project_path(path)), export_format="GLB", use_selection=True,
                              export_draco_mesh_compression_enable=True, export_yup=True, export_image_format="JPEG",
                              export_jpeg_quality=80)
    print("EXPORT", path, os.path.getsize(C.project_path(path)) // 1024, "KB")

os.makedirs(C.project_path("export/harbor"), exist_ok=True)
export([land], "export/harbor/land.glb")
export([o for o in bpy.data.objects if o.name.startswith("HB_cell_")], "export/harbor/buildings.glb")
os.makedirs(C.project_path("blender/districts/harbor"), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=C.project_path("blender/districts/harbor/harbor.blend"))

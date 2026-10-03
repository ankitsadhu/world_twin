"""Build blender/library/props.blend: reusable street furniture + vehicles as asset collections.

Each prop is one collection `PROP_<Name>` with its origin at ground contact, front = +Y, real size.
Districts append these collections and scatter them as collection instances (glTF: shared meshes).
Run inside Blender (resets the session, like build_library_materials.py).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

MATS = ["M_Metal_Aluminium", "M_Paint_DarkGrey", "M_Paint_Black", "M_Light_StreetWarm", "M_Paint_SignalYellow",
        "M_Light_SignalRed", "M_Light_SignalGreen", "M_Light_SignalOff", "M_Light_WalkHand", "M_Paint_NYCGreen",
        "M_Paint_HydrantRed", "M_Light_SubwayGreen", "M_Paint_TaxiYellow", "M_Glass_Car", "M_Rubber",
        "M_Light_Headlight", "M_Light_Taillight", "M_Light_StoreSign", "M_Metal_Steel", "M_Stone_GraniteDark",
        "M_Plant_Green"]


class Kit:
    """Tiny bmesh modelling kit: boxes / cylinders / frusta with a material name."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def _mat(self, faces, mat, smooth=False):
        i = MATS.index(mat)
        for f in faces:
            f.material_index = i
            f.smooth = smooth
            for loop in f.loops:
                co = loop.vert.co
                n = f.normal
                loop[self.uv].uv = (co.x + co.y, co.z) if abs(n.z) < 0.7 else (co.x, co.y)

    def box(self, center, size, mat, yaw=0.0, pitch=0.0):
        m = (Matrix.Translation(center) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "X") @
             Matrix.Diagonal((*size, 1.0)))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._mat({f for v in r["verts"] for f in v.link_faces}, mat)

    def cyl(self, base, r1, r2, h, mat, segs=10, axis="Z", smooth=True, caps=True):
        rot = {"Z": Matrix(), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(-math.pi / 2, 4, "X")}[axis]
        off = rot @ Vector((0, 0, h / 2))
        m = Matrix.Translation(Vector(base) + off) @ rot
        r = bmesh.ops.create_cone(self.bm, cap_ends=caps, segments=segs, radius1=r1, radius2=r2, depth=h, matrix=m)
        self._mat({f for v in r["verts"] for f in v.link_faces}, mat, smooth)

    def sphere(self, center, r, mat, subdiv=2):
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=Matrix.Translation(center))
        self._mat({f for v in res["verts"] for f in v.link_faces}, mat, True)

    def to_object(self, name, coll):
        me = bpy.data.meshes.new(name)
        for m in MATS:
            me.materials.append(C.get_material(m))
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        # drop unused material slots so instances stay light
        idx = [p.material_index for p in me.polygons]
        used = sorted(set(idx))
        remap = {old: new for new, old in enumerate(used)}
        mats = [me.materials[i] for i in used]
        me.materials.clear()          # note: clear() resets polygon indices -> reassign afterwards
        for m in mats:
            me.materials.append(m)
        for p, i in zip(me.polygons, idx):
            p.material_index = remap[i]
        o = bpy.data.objects.new(name, me)
        coll.objects.link(o)
        return o


def prop_collection(name):
    coll = bpy.data.collections.new(f"PROP_{name}")
    bpy.context.scene.collection.children.link(coll)
    return coll


# ----------------------------------------------------------------------------- props
def street_lamp():
    """NYC-style 'cobra head' on a tapered octagonal pole, 9 m, arm reaching +Y over the road."""
    k = Kit()
    k.cyl((0, 0, 0), 0.24, 0.2, 0.9, "M_Metal_Aluminium", segs=8)          # base
    k.cyl((0, 0, 0.9), 0.13, 0.08, 8.1, "M_Metal_Aluminium", segs=8)       # shaft
    k.box((0, 1.15, 8.85), (0.1, 2.4, 0.1), "M_Metal_Aluminium", pitch=math.radians(-6))
    k.box((0, 2.55, 8.95), (0.42, 0.95, 0.2), "M_Metal_Aluminium")          # luminaire housing
    k.box((0, 2.55, 8.84), (0.34, 0.8, 0.02), "M_Light_StreetWarm")         # lens (emissive)
    return k


def traffic_signal():
    """NYC corner pole with a mast arm along +Y over the road; yellow 3-lamp heads with lenses facing -X."""
    k = Kit()
    k.cyl((0, 0, 0), 0.22, 0.2, 0.6, "M_Paint_DarkGrey", segs=8)
    k.cyl((0, 0, 0.6), 0.15, 0.12, 6.4, "M_Paint_DarkGrey", segs=8)
    k.box((0, 3.3, 6.4), (0.14, 6.6, 0.14), "M_Paint_DarkGrey")             # mast arm
    k.box((0, 1.3, 5.9), (0.06, 2.6, 0.06), "M_Paint_DarkGrey", pitch=math.radians(14))  # brace
    for y in (3.4, 6.2):                                                    # signal heads hang from the arm
        k.box((0, y, 5.75), (0.36, 0.34, 1.05), "M_Paint_SignalYellow")
        k.box((0.24, y, 5.75), (0.1, 0.5, 1.2), "M_Paint_Black")            # back plate
        for z, mat in ((6.08, "M_Light_SignalRed"), (5.75, "M_Light_SignalOff"), (5.42, "M_Light_SignalOff")):
            k.cyl((-0.19, y, z), 0.13, 0.13, 0.03, mat, segs=12, axis="X")
            k.box((-0.26, y, z + 0.1), (0.14, 0.3, 0.03), "M_Paint_SignalYellow")  # visor
    # pedestrian head on the pole + a second head facing the cross street
    k.box((0.25, 0, 3.1), (0.3, 0.3, 0.42), "M_Paint_SignalYellow")
    k.box((0.41, 0, 3.1), (0.02, 0.24, 0.3), "M_Light_WalkHand")
    k.box((0, -0.25, 3.1), (0.3, 0.3, 0.42), "M_Paint_SignalYellow")
    k.box((0, -0.41, 3.1), (0.24, 0.02, 0.3), "M_Light_WalkHand")
    k.box((0, 0.6, 5.2), (0.36, 0.34, 1.05), "M_Paint_SignalYellow")          # pole-mounted head
    k.cyl((-0.19, 0.6, 5.53), 0.13, 0.13, 0.03, "M_Light_SignalRed", segs=12, axis="X")
    return k


def hydrant():
    k = Kit()
    k.cyl((0, 0, 0), 0.16, 0.16, 0.08, "M_Paint_HydrantRed", segs=10)
    k.cyl((0, 0, 0.08), 0.12, 0.12, 0.52, "M_Paint_HydrantRed", segs=10)
    k.sphere((0, 0, 0.62), 0.13, "M_Metal_Aluminium", 1)
    k.cyl((0, -0.22, 0.42), 0.06, 0.06, 0.44, "M_Paint_HydrantRed", segs=8, axis="Y")
    k.cyl((-0.2, 0, 0.42), 0.05, 0.05, 0.4, "M_Paint_HydrantRed", segs=8, axis="X")
    return k


def trash_basket():
    """NYC green wire litter basket (solid frustum read as wire at distance)."""
    k = Kit()
    k.cyl((0, 0, 0), 0.22, 0.3, 0.92, "M_Paint_NYCGreen", segs=12, caps=False)
    k.cyl((0, 0, 0.0), 0.22, 0.22, 0.04, "M_Paint_NYCGreen", segs=12)
    k.cyl((0, 0, 0.9), 0.31, 0.31, 0.04, "M_Paint_NYCGreen", segs=12)
    return k


def bollard():
    k = Kit()
    k.cyl((0, 0, 0), 0.16, 0.15, 0.95, "M_Metal_Steel", segs=10)
    k.cyl((0, 0, 0.95), 0.15, 0.1, 0.05, "M_Metal_Steel", segs=10)
    return k


def planter():
    k = Kit()
    k.box((0, 0, 0.32), (1.4, 1.4, 0.64), "M_Stone_GraniteDark")
    k.box((0, 0, 0.74), (1.2, 1.2, 0.24), "M_Plant_Green")
    k.sphere((0, 0, 1.0), 0.45, "M_Plant_Green", 1)
    return k


def subway_entrance():
    """Stair opening framed by green railings on 3 sides, two green globe lamps at the open (+Y) end."""
    k = Kit()
    L, W, H = 5.0, 2.0, 1.05
    for x in (-W / 2, W / 2):
        k.box((x, 0, H), (0.06, L, 0.06), "M_Paint_NYCGreen")
        k.box((x, 0, H / 2), (0.04, L, 0.04), "M_Paint_NYCGreen")
        for y in (-L / 2, -L / 4, 0, L / 4, L / 2):
            k.box((x, y, H / 2), (0.06, 0.06, H), "M_Paint_NYCGreen")
    k.box((0, -L / 2, H), (W, 0.06, 0.06), "M_Paint_NYCGreen")
    k.box((0, 0, -0.02), (W - 0.1, L - 0.1, 0.04), "M_Paint_Black")           # dark stair well
    for x in (-W / 2, W / 2):
        k.cyl((x, L / 2, 0), 0.05, 0.05, 2.2, "M_Paint_NYCGreen", segs=8)
        k.sphere((x, L / 2, 2.4), 0.2, "M_Light_SubwayGreen", 2)
    return k


def taxi():
    """NYC yellow cab (sedan), 4.85 m, front = +Y, origin at ground contact."""
    k = Kit()
    k.box((0, 0, 0.62), (1.82, 4.85, 0.62), "M_Paint_TaxiYellow")             # body
    k.box((0, 1.95, 0.84), (1.76, 0.9, 0.2), "M_Paint_TaxiYellow", pitch=math.radians(-6))  # hood slope
    k.box((0, -0.25, 1.17), (1.6, 2.5, 0.5), "M_Glass_Car")                   # greenhouse
    k.box((0, -0.25, 1.44), (1.5, 2.0, 0.06), "M_Paint_TaxiYellow")           # roof
    k.box((0, -0.15, 1.6), (0.9, 0.26, 0.26), "M_Light_StoreSign")            # roof light / ad topper
    k.box((0, 2.43, 0.68), (1.6, 0.04, 0.14), "M_Light_Headlight")
    k.box((0, -2.43, 0.74), (1.6, 0.04, 0.12), "M_Light_Taillight")
    k.box((0, 0, 0.36), (1.86, 4.9, 0.12), "M_Paint_Black")                   # rocker / bumpers
    for x in (-0.82, 0.82):
        for y in (-1.45, 1.45):
            k.cyl((x - 0.11 if x < 0 else x - 0.11, y, 0.33), 0.33, 0.33, 0.22, "M_Rubber", segs=14, axis="X")
    return k


PROPS = {"StreetLamp": street_lamp, "TrafficSignal": traffic_signal, "Hydrant": hydrant,
         "TrashBasket": trash_basket, "Bollard": bollard, "Planter": planter, "SubwayEntrance": subway_entrance,
         "Taxi": taxi}


TRAFFIC = {  # LOD1 cars from the parametric generator (vehicles/car_gen.py): (spec, paint, taxi)
    "Taxi": ("CROSSOVER", "M_Car_Paint_TaxiYellow", True),
    "CarSedanBlack": ("SEDAN", "M_Car_Paint_Black", False),
    "CarSedanWhite": ("SEDAN", "M_Car_Paint_White", False),
    "CarSUVSilver": ("CROSSOVER", "M_Car_Paint_Silver", False),
    "CarSedanBlue": ("SEDAN", "M_Car_Paint_Blue", False),
    "CarSUVRed": ("CROSSOVER", "M_Car_Paint_Red", False),
}


def traffic_car(name, spec_name, paint, taxi):
    """Single-mesh LOD1 car (traffic) joined from the generator's parts."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vehicles"))
    import car_gen
    coll = prop_collection(name)
    objs = car_gen.build_vehicle(getattr(car_gen, spec_name), paint, coll, lod=1, taxi=taxi)
    meshes = [o for o in objs.values() if o.type == "MESH"]
    # wheels are positioned after creation: refresh world matrices first, or every wheel merges at the origin
    bpy.context.view_layer.update()
    bm = bmesh.new()
    mats = []
    for o in meshes:
        tmp = o.data.copy()
        tmp.transform(o.matrix_world)
        remap = []
        for m in tmp.materials:
            if m.name not in [x.name for x in mats]:
                mats.append(m)
            remap.append([x.name for x in mats].index(m.name))
        for p in tmp.polygons:
            p.material_index = remap[p.material_index] if remap else 0
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    for o in meshes:
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new(f"PROP_{name}")
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    o = bpy.data.objects.new(f"PROP_{name}", me)
    coll.objects.link(o)
    return coll, o


def main():
    bpy.ops.wm.read_homefile(use_empty=True)
    out = {}
    for name, (spec, paint, taxi) in TRAFFIC.items():
        coll, o = traffic_car(name, spec, paint, taxi)
        coll.asset_mark()
        coll.asset_data.tags.new("vehicle", skip_if_exists=True)
        out[name] = C.tri_count(o)
    for name, fn in PROPS.items():
        if name == "Taxi":
            continue
        coll = prop_collection(name)
        o = fn().to_object(f"PROP_{name}", coll)
        coll.asset_mark()
        coll.asset_data.tags.new("prop", skip_if_exists=True)
        out[name] = C.tri_count(o)
    path = C.project_path("blender", "library", "props.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, relative_remap=True)
    return {"saved": path, "tris": out}


result = main()

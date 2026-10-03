"""Scatter street furniture + traffic over a district as collection instances (idempotent).

Rules follow NYC practice: lamps ~32 m apart along curbs, a signal pole with mast arm on every
intersection corner, street-name blades (real names) on the NE/SW poles, hydrants, litter baskets at
corners, bollards along the plaza edges, subway entrances at the real stations, and yellow cabs in the
correct one-way direction for each avenue / street. Everything is ray-cast so it only lands on the
intended surface (sidewalk / plaza / road).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

REGION = (-567.0, -505.0, 600.0, 570.0)   # hero + mid ring: where street-level detail matters
AVENUE_NAMES = {-550: "9 Av", -275: "8 Av", 0: "7 Av", 273: "6 Av", 584: "5 Av"}
NORTHBOUND = {-823, -275, 273}            # 10th, 8th, 6th run north; 9th, 7th, 5th run south
SUBWAY = [  # (avenue x, street y, corner sx, sy) approximate real station entrances
    (0, -249, 1, 1), (0, -249, -1, 1), (0, -249, 1, -1),          # Times Sq-42 St
    (0, 314, -1, 1), (0, 314, 1, -1),                             # 49 St (N/Q/R/W)
    (-275, -249, -1, 1), (-275, -249, 1, -1),                     # 42 St-Port Authority
    (-275, 394, 1, -1),                                           # 50 St (C/E)
    (273, -249, 1, 1), (273, 155, -1, 1), (273, 314, 1, -1),      # Bryant Park, 47-50 Sts-Rockefeller
]


def lib_prop(name):
    """Append PROP_<name> from the props library once; keep it in a non-exported holder collection."""
    cname = f"PROP_{name}"
    coll = bpy.data.collections.get(cname)
    if coll is None:
        with bpy.data.libraries.load(C.project_path("blender", "library", "props.blend"), link=False) as (s, d):
            d.collections = [cname]
        coll = bpy.data.collections[cname]
    holder = C.ensure_collection("LIB_PROPS")
    if coll.name not in holder.children:
        holder.children.link(coll)
    lc = bpy.context.view_layer.layer_collection.children.get("LIB_PROPS")
    if lc:
        lc.exclude = True
    return coll


class Scatter:
    def __init__(self, district_id):
        self.d = C.load_district(district_id)
        self.prefix = self.d["prefix"]
        self.tree = C.ensure_district_tree(self.prefix)
        self.scene = bpy.context.scene
        self.dg = bpy.context.evaluated_depsgraph_get()
        p = self.prefix
        self.surfaces = {"road": bpy.data.objects[f"TER_{p}_Roads"],
                         "sidewalk": bpy.data.objects[f"TER_{p}_Sidewalks"],
                         "plaza": bpy.data.objects[f"TER_{p}_Plazas"]}
        self.count = {}
        self.colls = {}

    def surface_at(self, x, y):
        hit, loc, n, i, obj, m = self.scene.ray_cast(self.dg, Vector((x, y, 400.0)), Vector((0, 0, -1)))
        if not hit:
            return None, 0.0
        for k, o in self.surfaces.items():
            if obj == o:
                return k, loc.z
        return "other", loc.z

    def place(self, prop, x, y, yaw_deg, need=("sidewalk", "plaza")):
        kind, z = self.surface_at(x, y)
        if kind not in need:
            return None
        coll = self.colls.get(prop)
        if coll is None:
            coll = self.colls[prop] = C.ensure_collection(f"{self.prefix}_PROPS_{prop}", self.tree["PROPS"])
        n = self.count[prop] = self.count.get(prop, 0) + 1
        e = bpy.data.objects.new(f"PROP_{self.prefix}_{prop}_{n:04d}", None)
        coll.objects.link(e)
        e.instance_type = "COLLECTION"
        e.instance_collection = lib_prop(prop)
        e.location = (x, y, z)
        e.rotation_euler = (0, 0, math.radians(yaw_deg))
        e["prop"] = prop
        e["chunk"] = "props"
        return e


def in_region(x, y):
    return REGION[0] <= x <= REGION[2] and REGION[1] <= y <= REGION[3]


def clear(prefix):
    """Remove scattered instances and the appended library copies (so the latest props.blend is used)."""
    root = bpy.data.collections.get(f"{prefix}_PROPS")
    if root:
        for o in list(root.all_objects):
            bpy.data.objects.remove(o, do_unlink=True)
    holder = bpy.data.collections.get("LIB_PROPS")
    if holder:
        for c in list(holder.children):
            for o in list(c.objects):
                bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.collections.remove(c)


CARS = ["Taxi"] * 11 + ["CarSedanBlack"] * 3 + ["CarSedanWhite"] * 2 + ["CarSUVSilver"] * 2 + \
       ["CarSedanBlue", "CarSUVRed"]   # Midtown traffic is mostly yellow cabs + black livery cars


def car(rng):
    return rng.choice(CARS)


def street_signs(sc, grid, layout):
    """Two crossed green blades per NE / SW corner pole, UV'd into the M_StreetSigns atlas."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    streets = {y: n for (y, w), n in zip(grid["streets"], range(37, 37 + len(grid["streets"])))}

    def blade(cx, cy, z, along_x, text):
        if text not in layout:
            return
        u0, v0, u1, v1 = layout[text]
        L, H = 1.45, 0.27
        for side in (1, -1):  # double-sided, each side reads left-to-right
            if along_x:
                y = cy + side * 0.012
                pts = [(cx - side * L / 2, y), (cx + side * L / 2, y)]
            else:
                x = cx - side * 0.012
                pts = [(x, cy - side * L / 2), (x, cy + side * L / 2)]
            vs = [bm.verts.new((pts[0][0], pts[0][1], z)), bm.verts.new((pts[1][0], pts[1][1], z)),
                  bm.verts.new((pts[1][0], pts[1][1], z + H)), bm.verts.new((pts[0][0], pts[0][1], z + H))]
            f = bm.faces.new(vs if side == -1 else list(reversed(vs)))
            uvs = ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
            for loop, v in zip(f.loops, vs if side == -1 else list(reversed(vs))):
                k = vs.index(v)
                loop[uvl].uv = uvs[k]

    for ax, aw in grid["avenues"]:
        if ax not in AVENUE_NAMES:
            continue
        for sy, sw in grid["streets"]:
            if not in_region(ax, sy) or sy not in streets:
                continue
            for sx, syy in ((1, 1), (-1, -1)):
                x, y = ax + sx * (aw / 2 + 1.0), sy + syy * (sw / 2 + 1.0)
                if sc.surface_at(x, y)[0] not in ("sidewalk", "plaza"):
                    continue
                blade(x, y, 4.2, True, f"W {streets[sy]} St")
                blade(x, y, 4.55, False, AVENUE_NAMES[ax])
    name = f"PROP_{sc.prefix}_StreetSigns"
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    me.materials.clear()
    me.materials.append(C.get_material("M_StreetSigns"))
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    o.data = me
    C.link_only_to(o, C.ensure_collection(f"{sc.prefix}_PROPS_StreetSigns", sc.tree["PROPS"]))
    o["chunk"] = "props"
    return len(me.polygons) // 2


def run(district_id="times_square", seed=7):
    rng = random.Random(seed)
    sc = Scatter(district_id)
    clear(sc.prefix)
    grid = sc.d["street_grid_local"]
    avenues, streets = grid["avenues"], grid["streets"]
    near_xing = lambda y: any(abs(y - sy) < sw / 2 + 6 for sy, sw in streets)
    near_ave = lambda x: any(abs(x - ax) < aw / 2 + 6 for ax, aw in avenues)

    # street lamps + hydrants along avenue curbs
    for ax, aw in avenues:
        for side in (1, -1):
            x = ax + side * (aw / 2 + 0.7)
            y = REGION[1]
            while y < REGION[3]:
                if in_region(x, y) and not near_xing(y):
                    sc.place("StreetLamp", x, y, 90 if side > 0 else -90)
                    if rng.random() < 0.45:
                        sc.place("Hydrant", ax + side * (aw / 2 + 0.45), y + 9.0, rng.uniform(0, 360))
                y += 32.0
    # street lamps along street curbs
    for sy, sw in streets:
        for side in (1, -1):
            y = sy + side * (sw / 2 + 0.7)
            x = REGION[0]
            while x < REGION[2]:
                if in_region(x, y) and not near_ave(x):
                    sc.place("StreetLamp", x, y, 180 if side > 0 else 0)
                x += 34.0
    # signals + litter baskets on every corner
    for ax, aw in avenues:
        for sy, sw in streets:
            if not in_region(ax, sy):
                continue
            for sx, syy, yaw in ((1, 1, 90), (-1, -1, -90), (-1, 1, 180), (1, -1, 0)):
                x, y = ax + sx * (aw / 2 + 1.0), sy + syy * (sw / 2 + 1.0)
                sc.place("TrafficSignal", x, y, yaw)
                if rng.random() < 0.6:
                    sc.place("TrashBasket", x + sx * 2.6, y + syy * 0.4, 0)
    # subway entrances (stairs run along the avenue sidewalk)
    for ax, sy, sx, syy in SUBWAY:
        aw = dict(avenues)[ax]
        sw = dict(streets)[sy]
        sc.place("SubwayEntrance", ax + sx * (aw / 2 + 2.6), sy + syy * (sw / 2 + 9.0), 0 if syy > 0 else 180)
    # bollards + planters along plaza edges that face the roadway
    for p in C.load_json(f"data/{district_id}/ground.json")["plazas"]:
        ring = p["exterior"]
        for a, b in zip(ring, ring[1:] + ring[:1]):
            L = math.dist(a, b)
            n = int(L // 2.6)
            for k in range(1, n):
                t = k / n
                x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                if not in_region(x, y):
                    continue
                nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
                if sc.surface_at(x + nx * 1.5, y + ny * 1.5)[0] == "road" or \
                        sc.surface_at(x - nx * 1.5, y - ny * 1.5)[0] == "road":
                    inward = -1 if sc.surface_at(x + nx * 1.5, y + ny * 1.5)[0] == "road" else 1
                    sc.place("Bollard", x + inward * nx * 0.6, y + inward * ny * 0.6, 0, need=("plaza",))
                    if k % 6 == 3:
                        sc.place("Planter", x + inward * nx * 2.4, y + inward * ny * 2.4, 0, need=("plaza",))
    # traffic (mostly yellow cabs): avenue lanes in the right direction, some queued at the stop bars
    for ax, aw in avenues:
        lanes = int(aw // 3.4)
        heading = 0 if ax in NORTHBOUND else 180
        for _ in range(28):
            lane = rng.randrange(1, lanes)                 # skip the curb lane (parking/bus)
            x = ax - aw / 2 + (lane + 0.5) * aw / lanes
            y = rng.uniform(REGION[1], REGION[3])
            if near_xing(y) or not in_region(x, y):
                continue
            sc.place(car(rng), x, y, heading, need=("road",))
        for sy, sw in streets:                             # queues waiting at a red light
            if rng.random() < 0.35 and in_region(ax, sy):
                stop = sy - (sw / 2 + 7.5) if heading == 0 else sy + (sw / 2 + 7.5)
                lane = rng.randrange(1, lanes)
                x = ax - aw / 2 + (lane + 0.5) * aw / lanes
                for q in range(rng.randint(1, 4)):
                    y = stop - q * 6.6 if heading == 0 else stop + q * 6.6
                    sc.place(car(rng), x, y, heading, need=("road",))
    for k, (sy, sw) in enumerate(streets):                 # crosstown: even streets east, odd west
        street_no = 37 + k
        heading = -90 if street_no % 2 == 0 else 90
        for _ in range(6):
            x = rng.uniform(REGION[0], REGION[2])
            if near_ave(x):
                continue
            sc.place(car(rng), x, sy + (-1.6 if heading == -90 else 1.6), heading, need=("road",))
    layout = C.load_json("blender/library/textures/gen/street_signs.json")
    signs = street_signs(sc, grid, layout)
    return {**sc.count, "StreetSignBlades": signs}


if __name__ == "__main__":
    print(run())

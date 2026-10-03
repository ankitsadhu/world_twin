"""ground.json -> terrain meshes: roads, raised sidewalks with granite curbs, plazas, water, piers, ships.

Heights: road 0.0, sidewalk/plaza +0.15 (NYC curb ~6"), water -1.8, pier deck +1.2.
Every surface UV'd in metres / material tile so textures sit at real-world scale.
"""
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402
from import_footprints import _tile, add_building  # noqa: E402

CURB_H = 0.15
WATER_Z = -1.8
PIER_Z = 1.2


def _cap(bm, uvl, poly, z, mat_idx, tile, up=True):
    """Triangulated planar cap of a polygon-with-holes at height z."""
    rings = [poly["exterior"]] + poly["holes"]
    flat = [Vector((x, y, z)) for r in rings for x, y in r]
    tris = tessellate_polygon([[Vector((x, y, z)) for x, y in r] for r in rings])
    verts = [bm.verts.new(v) for v in flat]
    tx, ty = tile
    for a, b, c in tris:
        va, vb, vc = verts[a], verts[b], verts[c]
        cross = (vb.co - va.co).cross(vc.co - va.co).z
        if (cross < 0) == up:
            vb, vc = vc, vb
        try:
            f = bm.faces.new((va, vb, vc))
        except ValueError:
            continue
        f.material_index = mat_idx
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x / tx, loop.vert.co.y / ty)


GRID = {"origin": (0.0, 0.0), "tile": 0.0}   # set from ground.json in run(); tile seams get no walls


def _on_seam(p, q):
    t = GRID["tile"]
    if not t:
        return False
    ox, oy = GRID["origin"]
    for k in (0, 1):
        o = ox if k == 0 else oy
        a, b = (p[k] - o) / t, (q[k] - o) / t
        if abs(p[k] - q[k]) < 1e-3 and abs(a - round(a)) < 1e-4:
            return True
    return False


def _walls(bm, uvl, poly, z0, z1, mat_idx, tile):
    """Vertical side faces along every ring (curbs, pier edges). Outward for exterior, inward for holes.
    Edges lying on the ground-tile seams are skipped (they are interior, not real curbs)."""
    tx, ty = tile
    for k, ring in enumerate([poly["exterior"]] + poly["holes"]):
        pts = [tuple(p) for p in ring]
        area = 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
        if (area < 0) == (k == 0):  # exterior CCW, holes CW -> faces point away from the solid
            pts.reverse()
        u = 0.0
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            seg = ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2) ** 0.5
            if seg < 1e-4 or _on_seam(p, q):
                continue
            vs = [bm.verts.new(v) for v in ((p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1), (p[0], p[1], z1))]
            f = bm.faces.new(vs)
            f.material_index = mat_idx
            for loop, uv in zip(f.loops, ((u, z0), (u + seg, z0), (u + seg, z1), (u, z1))):
                loop[uvl].uv = (uv[0] / tx, uv[1] / ty)
            u += seg


def _object(name, coll, mats, fill, **props):
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    fill(bm, uvl)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    obj.data = me
    C.link_only_to(obj, coll)
    C.set_props(obj, **props)
    return obj


def run(district_id="times_square"):
    d = C.load_district(district_id)
    prefix = d["prefix"]
    tree = C.ensure_district_tree(prefix)
    g = C.load_json(f"data/{district_id}/ground.json")
    GRID["origin"] = tuple(g["play_area"][:2])
    GRID["tile"] = g.get("tile_m", 0.0)
    M = {k: C.get_material(k) for k in ("M_Road_Asphalt", "M_Sidewalk_Concrete", "M_Curb_Granite",
                                        "M_Stone_GraniteDark", "M_Water_Hudson", "M_Paint_DarkGrey",
                                        "M_Metal_Steel", "M_Roof_Membrane")}
    T = tree["TERRAIN"]
    out = []

    def roads(bm, uvl):
        for p in g["roads"]:
            _cap(bm, uvl, p, 0.0, 0, _tile(M["M_Road_Asphalt"]))
    out.append(_object(f"TER_{prefix}_Roads", T, [M["M_Road_Asphalt"]], roads, surface="road", chunk="hero"))

    def sidewalks(bm, uvl):
        for p in g["sidewalk"]:
            _cap(bm, uvl, p, CURB_H, 0, _tile(M["M_Sidewalk_Concrete"]))
            _walls(bm, uvl, p, -0.3, CURB_H, 1, _tile(M["M_Curb_Granite"]))
    out.append(_object(f"TER_{prefix}_Sidewalks", T, [M["M_Sidewalk_Concrete"], M["M_Curb_Granite"]], sidewalks,
                       surface="sidewalk", chunk="hero"))

    def plazas(bm, uvl):
        for p in g["plazas"]:
            _cap(bm, uvl, p, CURB_H + 0.01, 0, _tile(M["M_Stone_GraniteDark"]))
            _walls(bm, uvl, p, -0.3, CURB_H + 0.01, 1, _tile(M["M_Curb_Granite"]))
    out.append(_object(f"TER_{prefix}_Plazas", T, [M["M_Stone_GraniteDark"], M["M_Curb_Granite"]], plazas,
                       surface="plaza", chunk="hero", bike_zone=True))

    def water(bm, uvl):
        for p in g["water"]:
            _cap(bm, uvl, p, WATER_Z, 0, (50.0, 50.0))
    out.append(_object(f"TER_{prefix}_Water_Hudson", T, [M["M_Water_Hudson"]], water, surface="water", chunk="water"))

    def piers(bm, uvl):
        for p in g["piers"]:
            _cap(bm, uvl, p, PIER_Z, 0, _tile(M["M_Sidewalk_Concrete"]))
            _walls(bm, uvl, p, WATER_Z - 1.0, PIER_Z, 1, _tile(M["M_Curb_Granite"]))
    out.append(_object(f"TER_{prefix}_Piers", T, [M["M_Sidewalk_Concrete"], M["M_Curb_Granite"]], piers,
                       surface="pier", chunk="water"))

    # Ships: USS Intrepid (flight deck ~ 18 m above water) and USS Growler, blockout masses
    for s in g["ships"]:
        intrepid = "Intrepid" in (s["name"] or "")
        h = 18.0 if intrepid else 5.5
        name = f"BLD_{prefix}_{'USSIntrepid' if intrepid else 'USSGrowler'}"

        def fill(bm, uvl, s=s, h=h):
            add_building(bm, uvl, s["exterior"], h - WATER_Z + 2.0, 0, 1, (4.0, 4.0), _tile(M["M_Road_Asphalt"]),
                         z0=WATER_Z - 2.0)
        o = _object(name, tree["HERO"], [M["M_Paint_DarkGrey"], M["M_Road_Asphalt"]], fill,
                    tier="hero", chunk="water", height_m=h, buyable=True, blockout=True,
                    display_name=s["name"] or "", deck_z=h)
        out.append(o)
    return {o.name: len(o.data.polygons) for o in out}


if __name__ == "__main__":
    print(run())

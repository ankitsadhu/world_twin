"""buildings.json -> extruded building meshes in the district file (idempotent).

hero / mid : one object per building (buyable, clickable, replaceable by hand-modelled heroes)
far        : merged per FAR_CELL_M grid cell to keep draw calls low
Walls UV'd in metres / material tile size (u along perimeter, v up), roofs planar.
"""
import math
import os
import random
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

FAR_CELL_M = 320.0
ROOF_MAT = "M_Roof_Membrane"


def _tile(mat):
    t = mat.get("tile_m", 1.0)
    return (float(t[0]), float(t[1])) if hasattr(t, "__len__") else (float(t), float(t))


def _signed_area(pts):
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))


def add_building(bm, uvl, outline, h, wall_idx, roof_idx, wall_tile, roof_tile, u_offset=0.0, z0=0.0):
    pts = [tuple(p) for p in outline]
    if _signed_area(pts) < 0:
        pts.reverse()
    n = len(pts)
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]
    top = [bm.verts.new((x, y, z0 + h)) for x, y in pts]
    tx, ty = wall_tile
    u = u_offset
    for i in range(n):
        j = (i + 1) % n
        seg = math.dist(pts[i], pts[j])
        if seg < 1e-4:
            continue
        f = bm.faces.new((bot[i], bot[j], top[j], top[i]))
        f.material_index = wall_idx
        for loop, (uu, vv) in zip(f.loops, ((u, z0), (u + seg, z0), (u + seg, z0 + h), (u, z0 + h))):
            loop[uvl].uv = (uu / tx, vv / ty)
        u += seg
    try:
        roof = bm.faces.new(top)
    except ValueError:
        return
    roof.material_index = roof_idx
    rx, ry = roof_tile
    for loop in roof.loops:
        loop[uvl].uv = (loop.vert.co.x / rx, loop.vert.co.y / ry)


def offset_polygon(pts, d):
    """Miter-offset a CCW polygon outward by d metres (clamped at sharp corners)."""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        e1 = (p1[0] - p0[0], p1[1] - p0[1])
        e2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1, l2 = math.hypot(*e1) or 1, math.hypot(*e2) or 1
        n1 = (e1[1] / l1, -e1[0] / l1)       # right normal = outward for CCW
        n2 = (e2[1] / l2, -e2[0] / l2)
        bx, by = n1[0] + n2[0], n1[1] + n2[1]
        bl = math.hypot(bx, by)
        if bl < 1e-6:
            out.append((p1[0] + n1[0] * d, p1[1] + n1[1] * d))
            continue
        cos_half = max(0.35, (bx * n1[0] + by * n1[1]) / bl)
        k = d / cos_half
        out.append((p1[0] + bx / bl * k, p1[1] + by / bl * k))
    return out


def add_parapet(bm, uvl, outline, h, wall_idx, cap_idx, wall_tile, p=1.1, t=0.35):
    """Parapet on a flat roof: outer wall continues p metres above the roof, cap, inner face back down.
    The roof face itself is still made by add_building at height h."""
    pts = [tuple(q) for q in outline]
    if _signed_area(pts) < 0:
        pts.reverse()
    inner = offset_polygon(pts, -t)
    n = len(pts)
    tx, ty = wall_tile
    u = 0.0
    for i in range(n):
        j = (i + 1) % n
        a, b, ia, ib = pts[i], pts[j], inner[i], inner[j]
        seg = math.dist(a, b)
        if seg < 1e-3:
            continue
        quads = (  # outer face, cap, inner face
            (((a[0], a[1], h), (b[0], b[1], h), (b[0], b[1], h + p), (a[0], a[1], h + p)), wall_idx),
            (((a[0], a[1], h + p), (b[0], b[1], h + p), (ib[0], ib[1], h + p), (ia[0], ia[1], h + p)), cap_idx),
            (((ib[0], ib[1], h), (ia[0], ia[1], h), (ia[0], ia[1], h + p), (ib[0], ib[1], h + p)), cap_idx),
        )
        for k, (co, mi) in enumerate(quads):
            f = bm.faces.new([bm.verts.new(c) for c in co])
            f.material_index = mi
            if k == 0:  # outer face continues the facade UVs (u along perimeter, v = height)
                for loop, uu in zip(f.loops, (u, u + seg, u + seg, u)):
                    loop[uvl].uv = (uu / tx, loop.vert.co.z / ty)
            else:       # cap + inner face use the roof material, planar
                for loop in f.loops:
                    loop[uvl].uv = (loop.vert.co.x, loop.vert.co.y + loop.vert.co.z)
        u += seg


SHOP_BAY_M = 4.0                 # storefront atlas: 4 shops of 4 m per 16 m row
SIGN_Z = (3.45, 4.25)            # sign band height inside a 4.5 m storefront row
SIGN_INSET = 0.15                # sign panel inset from the bay edges


def add_storefront(bm, uvl, outline, mat_idx, variant, h=4.5, offset=0.08, tile=(16.0, 18.0), rows=4,
                   sign_idx=None, slot_layer=None, next_slot=None):
    """Retail ground floor: a band just proud of the walls, UV'd into one row of the storefront atlas.

    If sign_idx is given, every whole shop bay also gets its own *sign quad* 3 cm in front of the band,
    UV'd onto the same atlas sign (so it looks identical by default) and tagged with a per-vertex
    `_SLOT` attribute (global sign index + 1; 0 = not a sign). The game uses that index to look up a
    buyer's logo in a runtime atlas, so thousands of shop signs stay one material / one draw call.
    Returns a list of sign records (centre, normal, size) for the sign catalogue."""
    pts = [tuple(p) for p in outline]
    if _signed_area(pts) < 0:
        pts.reverse()
    pts = offset_polygon(pts, offset)
    n = len(pts)
    v0 = (variant % rows) / rows
    u = random.Random(variant * 7919).uniform(0, 16)
    signs = []
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        seg = math.dist(a, b)
        if seg < 0.5:
            continue
        vs = [bm.verts.new(c) for c in ((a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], h), (a[0], a[1], h))]
        f = bm.faces.new(vs)
        f.material_index = mat_idx
        for loop, (uu, vv) in zip(f.loops, ((u, 0), (u + seg, 0), (u + seg, h), (u, h))):
            loop[uvl].uv = (uu / tile[0], v0 + vv / tile[1])
        if sign_idx is not None:
            dx, dy = (b[0] - a[0]) / seg, (b[1] - a[1]) / seg
            nx, ny = dy, -dx                                   # outward normal of a CCW edge
            k = math.ceil((u - SIGN_INSET) / SHOP_BAY_M)
            while SHOP_BAY_M * k + SHOP_BAY_M - SIGN_INSET <= u + seg:
                us0, us1 = SHOP_BAY_M * k + SIGN_INSET, SHOP_BAY_M * (k + 1) - SIGN_INSET
                t0, t1 = us0 - u, us1 - u
                p0 = (a[0] + dx * t0 + nx * 0.03, a[1] + dy * t0 + ny * 0.03)
                p1 = (a[0] + dx * t1 + nx * 0.03, a[1] + dy * t1 + ny * 0.03)
                z0, z1 = SIGN_Z
                sv = [bm.verts.new(c) for c in ((p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1),
                                                (p0[0], p0[1], z1))]
                idx = next_slot()
                for v in sv:
                    v[slot_layer] = float(idx + 1)
                sf = bm.faces.new(sv)
                sf.material_index = sign_idx
                for loop, (uu, vv) in zip(sf.loops, ((us0, z0), (us1, z0), (us1, z1), (us0, z1))):
                    loop[uvl].uv = (uu / tile[0], v0 + vv / tile[1])
                signs.append({"index": idx, "center": [round((p0[0] + p1[0]) / 2, 2), round((p0[1] + p1[1]) / 2, 2),
                                                       round((z0 + z1) / 2, 2)],
                              "normal": [round(nx, 3), round(ny, 3), 0.0], "width_m": round(us1 - us0, 2),
                              "height_m": round(z1 - z0, 2),
                              "default_uv": [round(us0 / tile[0], 5), round(v0 + z0 / tile[1], 5),
                                             round(us1 / tile[0], 5), round(v0 + z1 / tile[1], 5)]})
                k += 1
        u += seg
    return signs


def add_water_tower(bm, uvl, x, y, z, steel_idx, wood_idx, cap_idx, r=2.3, tank_h=4.2, leg_h=3.4):
    """Classic NYC rooftop water tank: steel legs, cedar-stave tank, conical tar roof."""
    from mathutils import Matrix
    for dx, dy in ((-1.6, -1.6), (1.6, -1.6), (1.6, 1.6), (-1.6, 1.6)):
        r_ = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((x + dx, y + dy, z + leg_h / 2)) @
                                   Matrix.Diagonal((0.22, 0.22, leg_h, 1.0)))
        for v in r_["verts"]:
            for f in v.link_faces:
                f.material_index = steel_idx
    segs = 12
    ring = [(x + r * math.cos(2 * math.pi * k / segs), y + r * math.sin(2 * math.pi * k / segs)) for k in range(segs)]
    add_building(bm, uvl, ring, tank_h, wood_idx, cap_idx, (2.0, 2.0), (1.0, 1.0), z0=z + leg_h)
    cone = bmesh.ops.create_cone(bm, cap_ends=False, segments=segs, radius1=r + 0.15, radius2=0.12, depth=1.5,
                                 matrix=Matrix.Translation((x, y, z + leg_h + tank_h + 0.75)))
    for v in cone["verts"]:
        for f in v.link_faces:
            f.material_index = cap_idx


def _mesh_from(name, mats, fill):
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    fill(bm, uvl)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    return me


def run(district_id="times_square", tiers=("hero", "mid", "far")):
    d = C.load_district(district_id)
    prefix = d["prefix"]
    tree = C.ensure_district_tree(prefix)
    data = C.load_json(f"data/{district_id}/buildings.json")["buildings"]
    roof = C.get_material(ROOF_MAT)
    storefront, steel, wood, cap, sign = (C.get_material(n) for n in ("M_Storefront", "M_Metal_Steel",
                                                                        "M_Wood_WaterTower", "M_Paint_Black",
                                                                        "M_ShopSign"))
    sign_table, per_bin = [], {}
    counter = iter(range(10 ** 7))
    blockout = C.ensure_collection(f"{prefix}_HERO_Blockout", tree["HERO"])
    target = {"hero": blockout, "mid": tree["MID"]}
    made, cells = 0, {}
    replaced = d.get("hero_overrides", {})  # bin -> hand-modelled hero object; never re-import those

    for b in data:
        if b["tier"] not in tiers or b["bin"] in replaced:
            continue
        if b["tier"] == "far":
            key = (int(b["centroid"][0] // FAR_CELL_M), int(b["centroid"][1] // FAR_CELL_M))
            cells.setdefault(key, []).append(b)
            continue
        wall = C.get_material(b["wall_mat"])
        rng = random.Random(b["bin"])
        shop = b["height_m"] > 6.0 and rng.random() < 0.85
        tower = (b["style"].startswith("prewar") and 20.0 < b["height_m"] < 110.0 and b["area_m2"] > 250
                 and rng.random() < 0.4)

        def fill(bm, uvl, b=b, wall=wall, rng=rng, shop=shop, tower=tower):
            add_building(bm, uvl, b["outline"], b["height_m"], 0, 1, _tile(wall), _tile(roof),
                         u_offset=rng.uniform(0, 30))
            if b["area_m2"] > 60:
                add_parapet(bm, uvl, b["outline"], b["height_m"], 0, 1, _tile(wall))
            if shop:
                layer = bm.verts.layers.float.get("_SLOT") or bm.verts.layers.float.new("_SLOT")
                recs = add_storefront(bm, uvl, b["outline"], 2, rng.randrange(4), sign_idx=6, slot_layer=layer,
                                      next_slot=lambda: next(counter))
                for r in recs:
                    per_bin[b["bin"]] = per_bin.get(b["bin"], 0) + 1
                    r.update(slot_id=f"{prefix.lower()}.{b['bin']}.sign{per_bin[b['bin']]:02d}",
                             bin=b["bin"], building=b["obj"], kind="storefront_sign", tier="standard",
                             aspect="4x1", status="available")
                    sign_table.append(r)
            if tower:
                cx, cy = b["centroid"]
                xs = [p[0] for p in b["outline"]]
                ys = [p[1] for p in b["outline"]]
                jx = (max(xs) - min(xs)) * rng.uniform(-0.2, 0.2)
                jy = (max(ys) - min(ys)) * rng.uniform(-0.2, 0.2)
                add_water_tower(bm, uvl, cx + jx, cy + jy, b["height_m"], 3, 4, 5)
        me = _mesh_from(b["obj"], [wall, roof, storefront, steel, wood, cap, sign], fill)
        obj = bpy.data.objects.get(b["obj"])
        if obj is None:
            obj = bpy.data.objects.new(b["obj"], me)
        obj.data = me
        C.link_only_to(obj, target[b["tier"]])
        C.set_props(obj, bld_id=b["id"], bin=b["bin"], tier=b["tier"], height_m=b["height_m"],
                    year=b["year"], style=b["style"], source="nyc_opendata", buyable=True,
                    chunk="hero" if b["tier"] == "hero" else ("mid_n" if b["centroid"][1] > 0 else "mid_s"),
                    blockout=b["tier"] == "hero", display_name=b.get("name") or "")
        made += 1

    for (cx, cy), group in cells.items():
        name = f"FAR_{prefix}_cell_{cx}_{cy}"
        mats = sorted({g["wall_mat"] for g in group})
        mat_objs = [C.get_material(m) for m in mats] + [roof]

        def fill(bm, uvl, group=group, mats=mats, mat_objs=mat_objs):
            for g in group:
                i = mats.index(g["wall_mat"])
                add_building(bm, uvl, g["outline"], g["height_m"], i, len(mats), _tile(mat_objs[i]), _tile(roof),
                             u_offset=random.Random(g["bin"]).uniform(0, 30))
        me = _mesh_from(name, mat_objs, fill)
        obj = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
        obj.data = me
        C.link_only_to(obj, tree["FAR"])
        C.set_props(obj, tier="far", chunk="far", buildings=len(group), buyable=False)
        made += 1
    C.save_json(f"data/{district_id}/sign_slots.json", {
        "district": district_id, "count": len(sign_table),
        "note": "per-vertex attribute _SLOT = index + 1 on M_ShopSign faces; default_uv = atlas rect in M_ShopSign",
        "signs": sign_table})
    return {"objects": made, "far_cells": len(cells), "sign_slots": len(sign_table)}


if __name__ == "__main__":
    print(run())

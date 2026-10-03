"""Sellable slot builder: AD_ (billboards) and SHOP_ (storefront signs).

Every slot is its own mesh with UVs exactly 0..1, its own material MAT_SLOT_<slot_id> (copy of
M_LED_SlotTemplate with the placeholder art for its aspect), and the slot schema as custom props
(exported as glTF extras -> the game swaps the texture and attaches the buyer's link).

Shapes: flat | wrap (strip along a polyline) | curved (cylinder arc) | anamorphic (L-shaped corner).
Each builder can also emit a bezel/back-box into a separate `frame` bmesh (part of the building).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

GEN = C.project_path("blender", "library", "textures", "gen")
ASPECTS = {"16x9": 16 / 9, "9x16": 9 / 16, "1x1": 1.0, "4x1": 4.0, "2x1": 2.0, "3x4": 0.75, "8x1": 8.0}
SCREEN_OFFSET = 0.02  # screen sits just in front of its bezel back plate


def nearest_aspect(w, h):
    r = w / h
    return min(ASPECTS, key=lambda k: abs(math.log(ASPECTS[k] / r)))


def slot_material(slot_id, aspect):
    name = f"MAT_SLOT_{slot_id}"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = C.get_material("M_LED_SlotTemplate").copy()
        mat.name = name
    mat["is_slot_template"] = False
    mat["slot_id"] = slot_id
    path = os.path.join(GEN, f"slot_placeholder_{aspect}.png")
    img = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path, check_existing=True)
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE":
            n.image = img
    return mat


def set_demo_art(on=True):
    """Lookdev only: fill every slot with fictional demo ads (on) or the AD SPACE placeholder (off).
    export_district.py always forces placeholders back before writing GLBs."""
    import zlib
    n = 0
    for o in bpy.data.objects:
        if not o.name.startswith(("AD_", "SHOP_")) or "slot_id" not in o:
            continue
        aspect = o["aspect"]
        idx = zlib.crc32(o["slot_id"].encode()) % 10
        fname = f"demo_ad_{idx:02d}_{aspect}.png" if on else f"slot_placeholder_{aspect}.png"
        img = bpy.data.images.get(fname) or bpy.data.images.load(os.path.join(GEN, fname), check_existing=True)
        for m in o.data.materials:
            for node in m.node_tree.nodes:
                if node.type == "TEX_IMAGE":
                    node.image = img
        n += 1
    return n


def _finish(name, coll, bm, slot_id, kind, shape, tier, w, h, aspect, building, extra):
    me = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    me.clear_geometry()
    me.materials.clear()
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(slot_material(slot_id, aspect))
    obj = bpy.data.objects.get(name) or bpy.data.objects.new(name, me)
    obj.data = me
    C.link_only_to(obj, coll)
    C.set_props(obj, slot_id=slot_id, kind=kind, shape=shape, tier=tier, width_m=round(w, 2),
                height_m=round(h, 2), aspect=aspect, default_art=f"slot_placeholder_{aspect}.png",
                building=building, status="available", **extra)
    return obj


def _box(bm, mat_idx, center, size, yaw):
    """Axis box rotated by yaw around Z. size = (width along local X, depth along local Y, height)."""
    cx, cy, cz = center
    w, d, h = size
    c, s = math.cos(yaw), math.sin(yaw)
    vs = []
    for dz in (-h / 2, h / 2):
        for dx, dy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
            vs.append(bm.verts.new((cx + dx * c - dy * s, cy + dx * s + dy * c, cz + dz)))
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        face = bm.faces.new([vs[i] for i in f])
        face.material_index = mat_idx
    return vs


def flat(name, coll, slot_id, center, w, h, yaw_deg=0.0, kind="billboard", tier="premium", building="",
         frame=None, frame_mat=0, bezel=0.35, depth=0.6, **extra):
    """Flat screen centred at `center` (x, y, z_mid). yaw 0 -> screen faces +Y."""
    yaw = math.radians(yaw_deg)
    c, s = math.cos(yaw), math.sin(yaw)
    fwd = Vector((-s, c, 0))
    right = Vector((-c, -s, 0))  # the *viewer's* right when facing the screen -> u reads left to right
    o = Vector(center) + fwd * SCREEN_OFFSET
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    corners = [o - right * w / 2 - Vector((0, 0, h / 2)), o + right * w / 2 - Vector((0, 0, h / 2)),
               o + right * w / 2 + Vector((0, 0, h / 2)), o - right * w / 2 + Vector((0, 0, h / 2))]
    f = bm.faces.new([bm.verts.new(p) for p in corners])
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    if frame is not None:  # back box + 4 bezel bars, flush behind the screen
        back_c = Vector(center) - fwd * (depth / 2)
        _box(frame, frame_mat, back_c, (w + 2 * bezel, depth, h + 2 * bezel), yaw)
        for dz in (h / 2 + bezel / 2, -h / 2 - bezel / 2):
            _box(frame, frame_mat, Vector(center) + Vector((0, 0, dz)) + fwd * 0.08, (w + 2 * bezel, 0.2, bezel), yaw)
        for dx in (w / 2 + bezel / 2, -w / 2 - bezel / 2):
            _box(frame, frame_mat, Vector(center) + right * dx + fwd * 0.08, (bezel, 0.2, h), yaw)
    aspect = extra.pop("aspect", None) or nearest_aspect(w, h)
    return _finish(name, coll, bm, slot_id, kind, "flat", tier, w, h, aspect, building, extra)


def wrap(name, coll, slot_id, path2d, z0, z1, kind="billboard", tier="premium", building="", outward=1, **extra):
    """Continuous LED strip along a 2D polyline (e.g. around a building corner). u = arc length 0..1.
    Give the path counter-clockwise around the building (outward=1): faces point out and the art
    reads left-to-right for a viewer outside."""
    pts = [Vector((x, y)) for x, y in path2d]
    lengths = [0.0]
    for a, b in zip(pts, pts[1:]):
        lengths.append(lengths[-1] + (b - a).length)
    L = lengths[-1]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    bot = [bm.verts.new((p.x, p.y, z0)) for p in pts]
    top = [bm.verts.new((p.x, p.y, z1)) for p in pts]
    for i in range(len(pts) - 1):
        quad = (bot[i], bot[i + 1], top[i + 1], top[i]) if outward > 0 else (bot[i + 1], bot[i], top[i], top[i + 1])
        f = bm.faces.new(quad)
        us = (lengths[i] / L, lengths[i + 1] / L)
        uvs = ((us[0], 0), (us[1], 0), (us[1], 1), (us[0], 1)) if outward > 0 else \
            ((us[1], 0), (us[0], 0), (us[0], 1), (us[1], 1))
        for loop, uv in zip(f.loops, uvs):
            loop[uvl].uv = uv
    h = z1 - z0
    aspect = extra.pop("aspect", None) or nearest_aspect(L, h)
    return _finish(name, coll, bm, slot_id, kind, "wrap", tier, L, h, aspect, building, extra)


def curved(name, coll, slot_id, center2d, radius, a0_deg, a1_deg, z0, z1, segments=24, kind="billboard",
           tier="hero", building="", **extra):
    """Cylindrical screen arc (Nasdaq style). Angles CCW from +X. UV u along the arc."""
    path = [(center2d[0] + radius * math.cos(math.radians(a0_deg + (a1_deg - a0_deg) * i / segments)),
             center2d[1] + radius * math.sin(math.radians(a0_deg + (a1_deg - a0_deg) * i / segments)))
            for i in range(segments + 1)]
    o = wrap(name, coll, slot_id, path, z0, z1, kind=kind, tier=tier, building=building, outward=1, **extra)
    o["shape"] = "curved"
    o["radius_m"] = radius
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def anamorphic(name, coll, slot_id, corner2d, dir_a, len_a, dir_b, len_b, z0, z1, tier="hero", building="",
               **extra):
    """L-shaped corner screen: wing A runs from the corner along -dir_a, wing B along dir_b.
    u runs continuously A-end -> corner -> B-end so one 3D-illusion artwork spans both faces."""
    c = Vector(corner2d)
    a, b = Vector(dir_a).normalized(), Vector(dir_b).normalized()
    path = [tuple(c - a * len_a), tuple(c), tuple(c + b * len_b)]
    o = wrap(name, coll, slot_id, path, z0, z1, tier=tier, building=building, **extra)
    o["shape"] = "anamorphic"
    o["corner"] = list(corner2d)
    return o

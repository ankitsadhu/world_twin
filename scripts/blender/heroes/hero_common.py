"""Shared helpers for hand-built hero scripts: mesh finishing, collision proxy, lettering, setbacks."""
import os
import sys

import bmesh
import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ts_common as C  # noqa: E402
from import_footprints import add_building  # noqa: E402


def retire_blockout(*names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)


def scaled(pts, k, anchor=None):
    """Scale a footprint toward its centroid, or toward `anchor` (gives off-centre / spiral setbacks)."""
    ax, ay = anchor or (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return [(ax + (x - ax) * k, ay + (y - ay) * k) for x, y in pts]


def lettering(bm, text, mat_idx, location, yaw_rad, size, depth=0.15, font_path=None):
    """Solid 3D letters (e.g. a street number) baked into the building bmesh. Faces +Y at yaw 0."""
    cu = bpy.data.curves.new("_tmp_text", "FONT")
    cu.body = text
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = "CENTER"
    if font_path and os.path.exists(font_path):
        cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    ob = bpy.data.objects.new("_tmp_text", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    # text lies in XY facing +Z: stand it up (rotate +90 about X so it faces -Y), then turn to face +Y + yaw
    m = Matrix.Translation(location) @ Matrix.Rotation(yaw_rad + 3.14159265, 4, "Z") @ Matrix.Rotation(1.5707963, 4, "X")
    me.transform(m)
    n0 = len(bm.faces)
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    for k in range(n0, len(bm.faces)):
        bm.faces[k].material_index = mat_idx
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)


def finish(obj_name, bm, mat_names, coll, slots, footprint, roof, **props):
    """Write bmesh to the hero object, parent its slots, create the COL_ proxy, set schema props."""
    tree = C.ensure_district_tree("TS")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    me = bpy.data.meshes.get(obj_name) or bpy.data.meshes.new(obj_name)
    me.clear_geometry()
    me.materials.clear()
    for n in mat_names:
        me.materials.append(C.get_material(n))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.get(obj_name) or bpy.data.objects.new(obj_name, me)
    obj.data = me
    C.link_only_to(obj, coll)
    C.set_props(obj, tier="hero", height_m=roof, style="hero", source="manual", buyable=True, chunk="hero",
                blockout=False, **props)
    for n in slots:
        bpy.data.objects[n].parent = obj
    cbm = bmesh.new()
    cuv = cbm.loops.layers.uv.new("UVMap")
    add_building(cbm, cuv, footprint, roof, 0, 0, (1, 1), (1, 1))
    cme = bpy.data.meshes.get("COL_" + obj_name) or bpy.data.meshes.new("COL_" + obj_name)
    cme.clear_geometry()
    cbm.to_mesh(cme)
    cbm.free()
    col = bpy.data.objects.get("COL_" + obj_name) or bpy.data.objects.new("COL_" + obj_name, cme)
    col.data = cme
    C.link_only_to(col, tree["COLLISION"])
    col.display_type = "WIRE"
    col.hide_render = True
    col["collider"] = "prism"
    col["building"] = obj_name
    return obj


def marker_light(name, loc, power):
    tree = C.ensure_district_tree("TS")
    e = bpy.data.objects.get(name) or bpy.data.objects.new(name, None)
    C.link_only_to(e, tree["LIGHTS"])
    e.location = loc
    e["light_power_w"] = power
    e["night_only"] = True
    return e

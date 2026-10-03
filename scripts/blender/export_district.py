"""Export a district for the web game.

Outputs (paths from the manifest):
  export/<id>/<chunk>.glb   terrain, hero, mid_n, mid_s, far, water, collision   (Draco, WebP, extras on)
  data/<id>/slots.json      sellable slot catalogue (id, shape, size, aspect, world position/normal, building)
  data/<id>/nav.json        spawns + navigation polylines (glTF has no curves)
  config/world.json         district entry gets its file list

Before export: day/night drivers (NG_TOD) are frozen to their night strength and every slot gets its
AD SPACE placeholder back. Both are restored afterwards, so the .blend is left untouched.
"""
import os
import sys
import time

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402
import slots_tool  # noqa: E402


def _freeze_tod():
    """Unlink NG_TOD -> Emission Strength; set constant. Returns undo list."""
    undo = []
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED" and "tod_export_strength" in n:
                sock = n.inputs["Emission Strength"]
                if sock.is_linked:
                    src = sock.links[0].from_socket
                    m.node_tree.links.remove(sock.links[0])
                    undo.append((m, n, src, sock.default_value))
                    sock.default_value = float(n["tod_export_strength"])
    return undo


def _restore_tod(undo):
    for m, n, src, val in undo:
        sock = n.inputs["Emission Strength"]
        sock.default_value = val
        m.node_tree.links.new(src, sock)


def _chunk_of(obj):
    if obj.name.startswith("COL_"):
        return "collision"
    if obj.name.startswith("TER_"):
        return "water" if obj.get("surface") in ("water", "pier") else "terrain"
    if obj.name.startswith(("AD_", "SHOP_")):
        parent = obj.parent
        return parent.get("chunk", "hero") if parent else "hero"
    return obj.get("chunk")


def _export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_extras=True, export_yup=True,
        export_apply=True, export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="WEBP", export_image_quality=85, export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6, export_gpu_instances=True, export_lights=False,
        export_cameras=False, export_animations=False,
        export_attributes=True)   # keeps the per-vertex _SLOT index on shop-sign faces
    return os.path.getsize(path)


def slot_catalogue(district):
    out = []
    for o in bpy.data.objects:
        if not o.name.startswith(("AD_", "SHOP_")) or "slot_id" not in o:
            continue
        mw = o.matrix_world
        me = o.data
        centre = sum((mw @ v.co for v in me.vertices), Vector()) / max(1, len(me.vertices))
        normal = (mw.to_3x3() @ me.polygons[0].normal).normalized() if me.polygons else Vector((0, 1, 0))
        b = bpy.data.objects.get(o.get("building", ""))
        # facets: consecutive panels facing the same way merged; wraps/curves keep one per face so
        # visibility can be judged from every direction the screen actually faces
        facets, cur = [], None
        for poly in me.polygons:
            nrm = (mw.to_3x3() @ poly.normal).normalized()
            ctr = mw @ poly.center
            if cur and nrm.dot(cur["n"]) > 0.97:
                a = cur["a"] + poly.area
                cur["c"] = (cur["c"] * cur["a"] + ctr * poly.area) / a
                cur["a"] = a
            else:
                cur = {"c": ctr.copy(), "n": nrm, "a": poly.area}
                facets.append(cur)
        facets = sorted(facets, key=lambda f: -f["a"])[:16]
        out.append({
            "slot_id": o["slot_id"], "object": o.name, "kind": o["kind"], "shape": o["shape"],
            "tier": o["tier"], "width_m": o["width_m"], "height_m": o["height_m"], "aspect": o["aspect"],
            "building": o.get("building", ""), "building_name": b.get("display_name", "") if b else "",
            "address": b.get("address", "") if b else "",
            # Blender Z-up local metres; the game converts to Y-up (x, z, -y)
            "center": [round(c, 2) for c in centre], "normal": [round(c, 3) for c in normal],
            "status": o.get("status", "available"), "default_art": o["default_art"],
            "facets": [[round(f["c"].x, 2), round(f["c"].y, 2), round(f["c"].z, 2), round(f["n"].x, 3),
                        round(f["n"].y, 3), round(f["n"].z, 3), round(f["a"], 1)] for f in facets],
        })
    out.sort(key=lambda s: s["slot_id"])
    return {"district": district["id"], "count": len(out), "slots": out}


def _footprint_center(o):
    if o.type != "MESH" or not o.data.vertices:
        return [round(c, 1) for c in o.matrix_world.translation]
    ws = [o.matrix_world @ v.co for v in o.data.vertices]
    low = [w for w in ws if w.z <= 1.0] or ws
    xs, ys = [w.x for w in low], [w.y for w in low]
    zc = sum(w.z for w in ws) / len(ws)
    return [round((min(xs) + max(xs)) / 2, 1), round((min(ys) + max(ys)) / 2, 1), round(zc, 1)]


def property_catalogue(district):
    """Every buyable building: what a company gets when it buys it (hero slots + shop-sign slots)."""
    signs = C.load_json(f"data/{district['id']}/sign_slots.json")["signs"] if os.path.exists(
        C.project_path(f"data/{district['id']}/sign_slots.json")) else []
    signs_by_obj = {}
    for s_ in signs:
        signs_by_obj.setdefault(s_["building"], []).append(s_["slot_id"])
    props = []
    for o in bpy.data.objects:
        if not o.name.startswith("BLD_") or not o.get("buyable"):
            continue
        slots = sorted(c["slot_id"] for c in o.children if "slot_id" in c)
        props.append({
            "property_id": f"{district['id']}.{o.get('bin', o.name)}", "object": o.name,
            "display_name": o.get("display_name", ""), "address": o.get("address", ""),
            "tier": o.get("tier"), "height_m": o.get("height_m"),
            # footprint centre: bounding box of the vertices at or below the podium (billboards / masts
            # hanging off a facade would drag a vertex mean off the building)
            "center": _footprint_center(o),
            "hero_slots": slots, "sign_slots": signs_by_obj.get(o.name, []),
            "owner": None, "brand": None,
        })
    props.sort(key=lambda p: (p["tier"] != "hero", -(p["height_m"] or 0)))
    return {"district": district["id"], "count": len(props), "properties": props}


def nav_data(district):
    nav = {"district": district["id"], "spawns": {}, "paths": {}}
    for o in bpy.data.objects:
        if o.name.startswith("SPAWN_"):
            nav["spawns"][o.name] = {"type": o.get("spawn_type"), "position": [round(c, 2) for c in o.location],
                                     "heading_deg": o.get("heading_deg", 0.0)}
        elif o.name.startswith("NAV_") and o.type == "CURVE":
            nav["paths"][o.name] = {"usage": o.get("usage"),
                                    "lines": [[[round(p.co.x, 2), round(p.co.y, 2), round(p.co.z, 2)]
                                               for p in sp.points] for sp in o.data.splines],
                                    **({"ceiling_m": o["ceiling_m"]} if "ceiling_m" in o else {})}
    return nav


def run(district_id="times_square"):
    t0 = time.time()
    d = C.load_district(district_id)
    prefix = d["prefix"]
    root = bpy.data.collections[prefix]
    exported = [o for c in root.children if c.get("exported", True) for o in c.all_objects]
    chunks = {}
    for o in exported:
        is_instance = o.type == "EMPTY" and o.instance_type == "COLLECTION" and o.instance_collection
        if o.type != "MESH" and not is_instance:
            continue
        ch = "props" if is_instance else _chunk_of(o)
        if ch:
            chunks.setdefault(ch, []).append(o)
    out_dir = C.project_path(d["outputs"]["export_dir"])
    os.makedirs(out_dir, exist_ok=True)

    undo = _freeze_tod()
    slots_tool.set_demo_art(False)
    sizes = {}
    try:
        for ch, objs in sorted(chunks.items()):
            sizes[ch] = {"objects": len(objs), "tris": sum(C.tri_count(o) for o in objs if o.type == "MESH"),
                         "bytes": _export(objs, os.path.join(out_dir, f"{ch}.glb"))}
    finally:
        _restore_tod(undo)
    C.save_json(d["outputs"]["slots"], slot_catalogue(d))
    C.save_json(f"data/{district_id}/nav.json", nav_data(d))
    C.save_json(f"data/{district_id}/properties.json", property_catalogue(d))
    world = C.load_world()
    for entry in world["districts"]:
        if entry["id"] == district_id:
            entry["files"] = {"chunks": {ch: f"{d['outputs']['export_dir']}/{ch}.glb" for ch in sizes},
                              "slots": d["outputs"]["slots"], "nav": f"data/{district_id}/nav.json",
                              "sign_slots": f"data/{district_id}/sign_slots.json",
                              "properties": f"data/{district_id}/properties.json"}
            entry["world_offset"] = C.district_world_offset(d, world)
            entry["grid_rotation_deg"] = d.get("grid_rotation_deg", 0.0)
    C.save_json("config/world.json", world)
    return {"chunks": sizes, "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    print(run())

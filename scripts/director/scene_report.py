"""Blender-side snapshot for the critics: writes data/<district>/scene_report.json.

Run inside Blender with the district file open (MCP, or `blender -b <file> -P scene_report.py -- times_square`).
Everything the headless critics cannot see from exported JSON/GLBs is captured here.
"""
import json
import os
import sys
from collections import Counter

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "blender"))
import ts_common as C  # noqa: E402
import validate  # noqa: E402


def tod_wired():
    n = 0
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        for nd in m.node_tree.nodes:
            if nd.type == "BSDF_PRINCIPLED" and "tod_export_strength" in nd and nd.inputs["Emission Strength"].is_linked:
                n += 1
    return n


def run(district_id="times_square"):
    d = C.load_district(district_id)
    prefix = d["prefix"]
    root = bpy.data.collections[prefix]
    colls = {}
    for c in root.children_recursive:
        colls[c.name] = {"exported_flag": c.get("exported"), "objects": len(c.objects)}
    top = {c.name: c.get("exported") for c in root.children}
    exported = [o for c in root.children if c.get("exported", True) for o in c.all_objects]
    nonexp = [o for c in root.children if not c.get("exported", True) for o in c.all_objects]
    props = Counter(o.get("prop") for o in bpy.data.objects
                    if o.type == "EMPTY" and o.instance_type == "COLLECTION" and o.get("prop"))
    slot_objs = [o for o in bpy.data.objects if o.name.startswith(("AD_", "SHOP_")) and "slot_id" in o
                 and o.users_collection and any(c.name.startswith(prefix) for c in o.users_collection)]
    slot_mats = [o.data.materials[0].name if o.data.materials else None for o in slot_objs]
    none_mats = [o.name for o in exported if o.type == "MESH" and not o.name.startswith("COL_")
                 and (not o.data.materials or any(m is None for m in o.data.materials))]
    bad_scale = [o.name for o in exported if o.type == "MESH" and not o.name.startswith(("COL_", "FAR_"))
                 and any(abs(s - 1) > 1e-4 for s in o.scale)]
    wrong_prefix = [o.name for o in exported if not o.name.startswith(C.OBJECT_PREFIXES + ("GLOW_",))]
    leaked = [o.name for o in exported if o.name.startswith(("REF_", "CAM_"))]
    heroes = {name: bool(bpy.data.objects.get(name)) for name in set(d.get("hero_overrides", {}).values())}
    hero_coll = {name: [c.name for c in bpy.data.objects[name].users_collection]
                 for name, ok in heroes.items() if ok}
    v = validate.validate(prefix, district_id)
    rep = {
        "district": district_id, "blend": bpy.data.filepath,
        "top_collections": top, "collections": colls,
        "stray_root_objects": [o.name for o in bpy.context.scene.collection.objects],
        "exported_objects": len(exported), "nonexported_objects": len(nonexp),
        "wrong_prefix": wrong_prefix[:50], "wrong_prefix_count": len(wrong_prefix),
        "leaked_review_objects": leaked,
        "none_material_meshes": none_mats, "unapplied_scale": bad_scale,
        "slot_objects": len(slot_objs), "slot_ids": sorted(o["slot_id"] for o in slot_objs),
        "slot_material_bad": [o.name for o, m in zip(slot_objs, slot_mats) if not (m or "").startswith("MAT_SLOT_")],
        "slot_material_shared": [m for m, n in Counter(slot_mats).items() if m and n > 1],
        "tod_wired_materials": tod_wired(),
        "prop_counts": dict(props),
        "hero_objects": heroes, "hero_collections": hero_coll,
        "validate": {"ok": v["ok"], "errors": v["errors"][:50], "warning_count": v["warning_count"],
                     "stats": v["stats"]},
    }
    C.save_json(f"data/{district_id}/scene_report.json", rep)
    return {k: rep[k] for k in ("exported_objects", "slot_objects", "tod_wired_materials", "prop_counts")}


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    print(json.dumps(run(args[0] if args else "times_square")))

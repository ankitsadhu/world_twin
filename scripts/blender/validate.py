"""Validate a district scene against the pipeline rules. Returns a report dict (errors / warnings / stats).

Checks: naming prefixes, objects outside the district tree, missing materials, unapplied scale on
exported meshes, slot schema + UV range + unique slot_id + per-slot material, triangle budgets per tier.
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ts_common as C  # noqa: E402

SLOT_REQUIRED = ("slot_id", "kind", "shape", "tier", "width_m", "height_m", "aspect")


def _exported_objects(prefix):
    root = bpy.data.collections.get(prefix)
    if root is None:
        return [], []
    exp, skip = [], []
    for c in root.children:
        target = exp if c.get("exported", True) else skip
        target.extend(c.all_objects)
    return exp, skip


def validate(prefix="TS", district_id="times_square"):
    district = C.load_district(district_id)
    errors, warnings = [], []
    exported, _ = _exported_objects(prefix)
    tris = {"hero": 0, "mid": 0, "far": 0, "other": 0}
    slot_ids = {}
    for o in exported:
        if not o.name.startswith(C.OBJECT_PREFIXES):
            warnings.append(f"{o.name}: name has no known prefix")
        if o.type != "MESH":
            continue
        t = C.tri_count(o)
        tier = o.get("tier", "other")
        tris[tier if tier in tris else "other"] += t if o.instance_type == "NONE" else 0
        if not o.data.materials or any(m is None for m in o.data.materials):
            if not o.name.startswith("COL_"):
                errors.append(f"{o.name}: missing material")
        if any(abs(s - 1.0) > 1e-4 for s in o.scale) and not o.name.startswith(("COL_", "FAR_")):
            warnings.append(f"{o.name}: unapplied scale {tuple(round(s, 3) for s in o.scale)}")
        if o.name.startswith(("AD_", "SHOP_")):
            for k in SLOT_REQUIRED:
                if k not in o:
                    errors.append(f"{o.name}: slot missing '{k}'")
            sid = o.get("slot_id")
            if sid in slot_ids:
                errors.append(f"{o.name}: duplicate slot_id {sid} (also {slot_ids[sid]})")
            slot_ids[sid] = o.name
            if o.get("shape") not in C.SLOT_SHAPES:
                errors.append(f"{o.name}: bad shape {o.get('shape')}")
            uv = o.data.uv_layers.get("UVMap") or (o.data.uv_layers[0] if o.data.uv_layers else None)
            if uv is None:
                errors.append(f"{o.name}: slot has no UVs")
            else:
                us = [d.uv for d in uv.data]
                if us and (min(u.x for u in us) < -1e-3 or max(u.x for u in us) > 1.001 or
                           min(u.y for u in us) < -1e-3 or max(u.y for u in us) > 1.001):
                    errors.append(f"{o.name}: slot UVs outside 0..1")
            mats = [m for m in o.data.materials if m]
            if not mats or not mats[0].name.startswith("MAT_SLOT_"):
                errors.append(f"{o.name}: slot material must be MAT_SLOT_<slot_id>")
            elif mats[0].users > 1:
                errors.append(f"{o.name}: slot material {mats[0].name} is shared")
    budgets = {"hero": district.get("tiers", {}).get("hero", {}).get("tri_budget"),
               "far": district.get("tiers", {}).get("far", {}).get("tri_budget")}
    for tier, b in budgets.items():
        if b and tris[tier] > b:
            errors.append(f"tier {tier}: {tris[tier]} tris > budget {b}")
    stray = [o.name for o in bpy.context.scene.collection.objects]
    if stray:
        warnings.append(f"objects outside district tree: {stray[:10]}")
    return {"ok": not errors, "errors": errors, "warnings": warnings[:60],
            "warning_count": len(warnings), "stats": {"tris": tris, "slots": len(slot_ids),
                                                      "exported_objects": len(exported)}}


if __name__ == "__main__":
    print(validate())

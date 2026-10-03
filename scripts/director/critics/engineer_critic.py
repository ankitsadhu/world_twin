"""Role 4: Principal 3D Engineer Critic: are the Blender files, scripts and exports production-ready?

Reads data/<id>/scene_report.json (written in Blender by scripts/director/scene_report.py) + export files.
"""
import os
import subprocess
import sys

from common import ROOT, Ctx, Report

CHUNKS = ["collision", "far", "hero", "mid_n", "mid_s", "props", "terrain", "water"]
SIZE_MB = {"hero": (0.5, 35), "mid_n": (1, 40), "mid_s": (1, 40), "far": (0.5, 40), "terrain": (0.5, 40),
           "props": (0.2, 20), "water": (0.05, 20), "collision": (0.0, 5)}


def run(ctx: Ctx) -> Report:
    r = Report("Principal 3D Engineer")
    sc = ctx.scene
    gen = ctx.path("blender", "library", "textures", "gen")

    # ---------------------------------------------------------------- naming & collections (30)
    pts = 30.0
    if not sc:
        r.flag("ERROR", "NO_SCENE_REPORT", "Run scripts/director/scene_report.py inside Blender first")
        pts = 0
    else:
        for name, flag in sc["top_collections"].items():
            should = not name.endswith(("_REF", "_LOOKDEV"))
            if bool(flag) != should:
                r.flag("ERROR", "COLL_EXPORT_FLAG", f"{name}.exported = {flag}, expected {should}", name, auto=True)
                pts -= 4
        if sc["stray_root_objects"]:
            r.flag("WARN", "STRAY_OBJECTS", f"{len(sc['stray_root_objects'])} objects in scene root: "
                   f"{sc['stray_root_objects'][:5]}", fix="Move into the district tree", auto=True)
            pts -= 2
        if sc["wrong_prefix_count"]:
            r.flag("WARN", "PREFIX_LAW", f"{sc['wrong_prefix_count']} exported objects break the prefix law "
                   f"(e.g. {sc['wrong_prefix'][:4]})", fix="Rename with an OBJECT_PREFIXES prefix", auto=True)
            pts -= min(6, sc["wrong_prefix_count"] * 0.2)
        if sc["leaked_review_objects"]:
            r.flag("ERROR", "REVIEW_LEAK", f"REF_/CAM_ objects in exported collections: {sc['leaked_review_objects'][:5]}",
                   auto=True)
            pts -= 4
        missing = [k for k, ok in sc["hero_objects"].items() if not ok]
        for m in missing:
            r.flag("ERROR", "HERO_OVERRIDE_MISSING", f"hero_overrides points to {m}, which is not in the scene", m)
            pts -= 3
    r.section("Naming & collections", pts, 30)

    # ---------------------------------------------------------------- geometry & UVs (25)
    pts = 25.0
    if sc:
        for o in sc["none_material_meshes"][:10]:
            r.flag("ERROR", "NONE_MATERIAL", f"{o} has an empty material slot (exports black)", o)
            pts -= 2
        if sc["unapplied_scale"]:
            r.flag("ERROR", "UNAPPLIED_SCALE", f"{len(sc['unapplied_scale'])} meshes with unapplied scale: "
                   f"{sc['unapplied_scale'][:5]}", auto=True)
            pts -= 4
        for e in sc["validate"]["errors"][:20]:
            r.flag("ERROR", "VALIDATE", e)
            pts -= 1
        tris = sc["validate"]["stats"]["tris"]
        budgets = ctx.district["tiers"]
        for tier, key in (("hero", "tri_budget"), ("far", "tri_budget")):
            b = budgets.get(tier, {}).get(key)
            if b and tris.get(tier, 0) > b:
                r.flag("ERROR", "TRI_BUDGET", f"{tier}: {tris[tier]} tris > {b}")
                pts -= 4
        r.extra["tris"] = tris
    r.section("Geometry & UVs", pts, 25)

    # ---------------------------------------------------------------- slot schema (25)
    pts = 25.0
    req = ("slot_id", "kind", "shape", "tier", "width_m", "height_m", "aspect", "default_art", "status", "building")
    kinds = ("billboard", "storefront", "rooftop", "vehicle_screen", "vehicle_topper")
    ids = [s["slot_id"] for s in ctx.slots]
    if len(ids) != len(set(ids)):
        r.flag("ERROR", "DUP_SLOT_ID", "Duplicate slot_id in slots.json")
        pts -= 8
    for s in ctx.slots:
        miss = [k for k in req if k not in s]
        if miss:
            r.flag("ERROR", "SLOT_SCHEMA", f"{s.get('slot_id')} missing {miss}", s.get("slot_id", ""))
            pts -= 1
        if s.get("shape") not in ("flat", "curved", "wrap", "anamorphic") or s.get("kind") not in kinds:
            r.flag("ERROR", "SLOT_ENUM", f"{s['slot_id']}: shape={s.get('shape')} kind={s.get('kind')}", s["slot_id"])
            pts -= 1
        if s.get("tier") not in ("hero", "premium", "standard"):
            r.flag("ERROR", "SLOT_TIER", f"{s['slot_id']}: tier={s.get('tier')}", s["slot_id"])
        if not os.path.exists(os.path.join(gen, s.get("default_art", ""))):
            r.flag("ERROR", "SLOT_ART", f"{s['slot_id']}: default_art {s.get('default_art')} not in textures/gen",
                   s["slot_id"])
            pts -= 1
    if sc:
        scene_ids, json_ids = set(sc["slot_ids"]), set(ids)
        if scene_ids != json_ids:
            r.flag("ERROR", "SLOTS_STALE", f"slots.json out of sync with blend (+{len(scene_ids - json_ids)} in blend, "
                   f"+{len(json_ids - scene_ids)} only in JSON)", fix="Re-run export_district.py", auto=True)
            pts -= 6
        if sc["slot_material_bad"] or sc["slot_material_shared"]:
            r.flag("ERROR", "SLOT_MATERIAL", f"bad={sc['slot_material_bad'][:3]} shared={sc['slot_material_shared'][:3]}")
            pts -= 5
    r.section("Slot schema", pts, 25, f"{len(ids)} slots")

    # ---------------------------------------------------------------- export pipeline (20)
    pts = 20.0
    exp = ctx.path(ctx.district["outputs"]["export_dir"])
    sizes = {}
    for ch in CHUNKS:
        p = os.path.join(exp, f"{ch}.glb")
        if not os.path.exists(p):
            r.flag("ERROR", "CHUNK_MISSING", f"{ch}.glb missing", ch, "Re-run export_district.py", auto=True)
            pts -= 3
            continue
        mb = os.path.getsize(p) / 1e6
        sizes[ch] = round(mb, 2)
        lo, hi = SIZE_MB[ch]
        if not lo <= mb <= hi:
            r.flag("WARN", "CHUNK_SIZE", f"{ch}.glb is {mb:.2f} MB (expected {lo}-{hi})", ch)
            pts -= 1
    total = sum(sizes.values())
    if total > 40:
        r.flag("WARN", "DOWNLOAD_SIZE", f"District download {total:.0f} MB; textures are duplicated per chunk",
               fix="Shared KTX2 texture set + meshopt (planned)")
        pts -= 2
    if sc and sc["tod_wired_materials"] == 0:
        r.flag("ERROR", "TOD_UNWIRED", "0 materials wired to NG_TOD")
        pts -= 6
    r.extra["glb_mb"] = sizes
    r.section("Export pipeline", pts, 20, f"{total:.0f} MB total")

    # ---------------------------------------------------------------- script lint (info only)
    ruff = os.path.join(ROOT, ".venv", "bin", "ruff")
    if os.path.exists(ruff):
        out = subprocess.run([ruff, "check", "--quiet", "--output-format", "concise", "scripts"], cwd=ROOT,
                             capture_output=True, text=True)
        issues = [ln for ln in out.stdout.splitlines() if ln.strip() and ":" in ln]
        if issues:
            r.flag("INFO", "LINT", f"ruff: {len(issues)} issues (e.g. {issues[0]})", fix="ruff check --fix scripts")
        r.extra["lint_issues"] = len(issues)
    return r


if __name__ == "__main__":
    rep = run(Ctx(sys.argv[1] if len(sys.argv) > 1 else "times_square"))
    print(rep.score, rep.sections)

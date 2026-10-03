"""Role 1: NYC Times Square Critic: is this Times Square, or a generic city labelled Times Square?"""
import sys

from shapely.geometry import Point, Polygon

from common import Ctx, Report, dist2


def run(ctx: Ctx) -> Report:
    r = Report("NYC Times Square")
    T, d = ctx.truth, ctx.district
    heroes = T.get("heroes", {})
    scene = ctx.scene or {}

    # ---------------------------------------------------------------- architecture
    pts = 25.0
    for name, exp in heroes.items():
        p = ctx.prop(name)
        present = (scene.get("hero_objects", {}).get(name) if scene else None)
        if p is None and not present:
            r.flag("ERROR", "HERO_MISSING", f"{name} not found in scene/properties", name,
                   "Run its hero script in scripts/blender/heroes/")
            pts -= 4
            continue
        if p:
            off = dist2(p["center"], exp["center"])
            if off > exp["tol_m"]:
                r.flag("WARN", "HERO_POSITION", f"{name} centre {p['center'][:2]} is {off:.0f} m from expected "
                       f"{exp['center']} (tol {exp['tol_m']} m)", name, "Check footprint in hero script")
                pts -= 2
            lo, hi = exp["roof_m"]
            if not lo <= (p["height_m"] or 0) <= hi:
                r.flag("WARN", "HERO_HEIGHT", f"{name} height {p['height_m']} m outside {lo}-{hi} m", name)
                pts -= 1
        cols = scene.get("hero_collections", {}).get(name, [])
        if cols and not any("HERO" in c for c in cols):
            r.flag("WARN", "HERO_COLLECTION", f"{name} is in {cols}, expected a *_HERO_* collection", name, auto=True)
            pts -= 1
    hb = T.get("height_bands_m", {})
    bad = [b for b in ctx.buildings if b["tier"] in hb and not hb[b["tier"]][0] <= b["height_m"] <= hb[b["tier"]][1]]
    if bad:
        r.flag("INFO", "HEIGHT_BAND", f"{len(bad)} {bad[0]['tier']}-tier buildings outside plausible height band "
               f"(e.g. {bad[0]['obj']} {bad[0]['height_m']} m); source is NYC data, verify before overriding")
    r.section("Architecture", pts, 25, f"{len(heroes)} heroes checked")

    # ---------------------------------------------------------------- culture
    pts = 25.0
    if not any(s["shape"] == "curved" and s["building"] == T.get("nasdaq_object") for s in ctx.slots):
        r.flag("ERROR", "NASDAQ_CURVE", "No curved billboard slot on the Nasdaq building", T.get("nasdaq_object"))
        pts -= 6
    plazas = [Polygon(p["exterior"]) for p in ctx.ground.get("plazas", [])]
    for name, xy in T.get("plazas", {}).items():
        if not any(pl.buffer(15).contains(Point(xy)) for pl in plazas):
            r.flag("ERROR", "PLAZA_MISSING", f"No pedestrian plaza surface at {name} {xy}", name)
            pts -= 4
    hero_tier_slots = [s for s in ctx.slots if s["tier"] == "hero"]
    weak = [s for s in hero_tier_slots if s["kind"] == "billboard" and s["shape"] == "flat" and s["height_m"] < 4]
    if weak:
        r.flag("WARN", "HERO_SLOT_SMALL", f"{len(weak)} hero-tier flat billboards under 4 m tall", weak[0]["slot_id"])
        pts -= 2
    r.section("Culture", pts, 25, f"{len(T.get('plazas', {}))} plazas, Nasdaq curve")

    # ---------------------------------------------------------------- density
    pts = 25.0
    # real city blocks: between consecutive avenues (+Broadway splits them) and consecutive streets
    hx0, hy0, hx1, hy1 = d["tier_rects_local"]["hero"]
    grid = d["street_grid_local"]
    avs = sorted(x for x, _ in grid["avenues"] if hx0 - 300 <= x <= hx1 + 300)
    sts = sorted(y for y, _ in grid["streets"] if hy0 - 100 <= y <= hy1 + 100)
    cells = {}
    for b in ctx.buildings:
        x, y = b["centroid"]
        if not (hx0 <= x <= hx1 and hy0 <= y <= hy1):
            continue
        i = sum(1 for a in avs if a < x)
        j = sum(1 for s_ in sts if s_ < y)
        cells[(i, j)] = cells.get((i, j), 0) + 1
    sparse = sorted(k for k, v in cells.items() if v < T["block_density"]["min"])
    dense = [k for k, v in cells.items() if v > T["block_density"]["max"]]
    if len(sparse) > len(cells) * 0.25:
        r.flag("WARN", "SPARSE_BLOCKS", f"{len(sparse)}/{len(cells)} hero blocks have < {T['block_density']['min']} buildings")
        pts -= 4
    elif sparse:
        r.flag("INFO", "SPARSE_BLOCKS", f"{len(sparse)}/{len(cells)} hero blocks have < {T['block_density']['min']} "
               "buildings (large single-building blocks such as the Marriott are real)")
    if dense:
        r.flag("INFO", "DENSE_BLOCKS", f"{len(dense)} hero blocks have > {T['block_density']['max']} buildings")
    # far-ring coverage: 100 m cells over the play rect, excluding water
    px0, py0, px1, py1 = d["tier_rects_local"]["play"]
    gap = T["far_gap_m"]
    water = [Polygon(w["exterior"]) for w in ctx.ground.get("water", [])]
    occupied = {(int((b["centroid"][0] - px0) // gap), int((b["centroid"][1] - py0) // gap)) for b in ctx.buildings}
    holes = []
    for i in range(int((px1 - px0) // gap)):
        for j in range(int((py1 - py0) // gap)):
            c = Point(px0 + (i + 0.5) * gap, py0 + (j + 0.5) * gap)
            if (i, j) in occupied or any(w.buffer(150).contains(c) for w in water):   # waterfront = highway/piers
                continue
            nb = sum((i + a, j + b) in occupied for a in (-1, 0, 1) for b in (-1, 0, 1))
            if nb <= 2:   # isolated empty cells next to buildings are just streets/parks
                holes.append((round(c.x), round(c.y)))
    if holes:
        r.flag("WARN", "SKYLINE_HOLE", f"{len(holes)} {gap} m cells with no buildings (e.g. {holes[:3]}); "
               "parks/rail yards are legitimate, check against the map")
        pts -= min(6, len(holes) * 0.3)
    r.section("Density", pts, 25, f"{len(cells)} hero cells, {len(holes)} far holes")

    # ---------------------------------------------------------------- atmosphere
    pts = 25.0
    if not scene:
        r.flag("WARN", "NO_SCENE_REPORT", "scene_report.json missing: run scripts/director/scene_report.py in Blender")
        pts -= 10
    else:
        if scene.get("tod_wired_materials", 0) == 0:
            r.flag("ERROR", "TOD_UNWIRED", "No materials wired to NG_TOD: screens will be dark at night")
            pts -= 10
        counts = scene.get("prop_counts", {})
        for prop, need in T.get("required_props", {}).items():
            have = counts.get(prop, 0)
            if have < need:
                r.flag("WARN" if have == 0 else "INFO", "PROP_SHORT", f"{prop}: {have} placed, want >= {need}",
                       prop, "Add to scripts/blender/build_library_props.py + scatter_props.py")
                pts -= 2 if have == 0 else 1
    r.section("Atmosphere", pts, 25, "TOD wiring, street props")
    return r


if __name__ == "__main__":
    print(run(Ctx(sys.argv[1] if len(sys.argv) > 1 else "times_square")).as_dict())

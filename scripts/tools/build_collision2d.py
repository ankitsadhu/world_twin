"""Bake a compact 2D collision map for a district: building footprints (+ roof height) and water.

export/<district>/collision2d.json:
  {"cell": 40, "bounds": [...], "polys": [{"h": height_m, "kind": "building"|"water"|"ship"|"raised", "pts": [[x,y],...], "name"?, "year"?}],
   "grid": {"cx,cy": [poly indices]}}
Walking / driving: blocked by any polygon whose h is above the character's feet.
Flying: blocked only where the aircraft is below h. Coordinates are Blender local metres (Z-up).
"""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402

CELL = 40.0
WALKABLE_BINS = {"1085637"}   # TKTS booth: the red steps on top are a walkable ramp


def main(district_id="times_square"):
    d = C.load_district(district_id)
    g = C.load_json(f"data/{district_id}/ground.json")
    polys = []
    # names shown when you tap a building: curated place names first, then the city's building names
    named = {}
    places = C.project_path(f"{d['outputs']['export_dir']}/places.json")
    if os.path.exists(places):
        for p in C.load_json(places)["places"]:
            if p["kind"] in ("building", "landmark"):
                named.setdefault(p["id"].split(".")[-1], p["name"])
    for b in C.load_json(f"data/{district_id}/buildings.json")["buildings"]:
        pts = [[round(x, 1), round(y, 1)] for x, y in b["outline"]]
        if b["bin"] in WALKABLE_BINS:          # walkable, but raised: route planning goes around / down it, never off its edge
            polys.append({"h": b["height_m"], "kind": "raised", "pts": pts})
            continue
        poly = {"h": b["height_m"], "kind": "building", "pts": pts}
        name = named.get(b["bin"]) or b.get("name")
        if name:
            poly["name"] = name
        if b.get("year"):
            poly["year"] = b["year"]
        polys.append(poly)
    for w in g["water"]:
        polys.append({"h": 0.5, "kind": "water", "pts": [[round(x, 1), round(y, 1)] for x, y in w["exterior"]]})
    for s in g["ships"]:   # the Intrepid / Growler hulls block boats and walkers; deck is reachable by spawn
        polys.append({"h": 18.0, "kind": "ship", "pts": [[round(x, 1), round(y, 1)] for x, y in s["exterior"]]})
    grid = {}
    for i, p in enumerate(polys):
        xs = [q[0] for q in p["pts"]]
        ys = [q[1] for q in p["pts"]]
        for cx in range(int(min(xs) // CELL), int(max(xs) // CELL) + 1):
            for cy in range(int(min(ys) // CELL), int(max(ys) // CELL) + 1):
                grid.setdefault(f"{cx},{cy}", []).append(i)
    out = f"{d['outputs']['export_dir']}/collision2d.json"
    C.save_json(out, {"district": district_id, "cell": CELL, "bounds": g["play_area"], "polys": polys, "grid": grid})
    print(f"{len(polys)} polygons, {len(grid)} cells -> {out} "
          f"({os.path.getsize(C.project_path(out)) // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "times_square")

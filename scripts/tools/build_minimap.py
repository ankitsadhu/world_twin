"""Bake a GTA-style map image + label/marker data for a district (run with the project venv or python3).

Outputs export/<district>/map.png (top-down, local metres, north-up in local grid frame) and map.json:
  {"bounds": [x0, y0, x1, y1], "px_per_m": k, "labels": [...], "markers": [...]}
Labels are drawn by the game at runtime (so they stay upright when the minimap rotates).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402

PX = 1.6  # pixels per metre

COL = {
    "bg": (22, 26, 30), "land": (46, 50, 56), "sidewalk": (70, 74, 80), "road": (104, 108, 116),
    "plaza": (150, 120, 92), "water": (28, 58, 92), "pier": (88, 84, 78),
    "bld_far": (58, 62, 70), "bld_mid": (66, 71, 80), "bld_hero": (84, 90, 104), "outline": (34, 37, 42),
    "steps": (205, 40, 40), "ship": (120, 124, 132),
}


def main(district_id="times_square"):
    d = C.load_district(district_id)
    g = C.load_json(f"data/{district_id}/ground.json")
    x0, y0, x1, y1 = g["play_area"]
    W, H = int((x1 - x0) * PX), int((y1 - y0) * PX)
    T = lambda p: ((p[0] - x0) * PX, (y1 - p[1]) * PX)
    img = Image.new("RGB", (W, H), COL["land"])
    dr = ImageDraw.Draw(img)

    def polys(items, col, hole=None):
        for p in items:
            dr.polygon([T(q) for q in p["exterior"]], fill=col)
            for h in p.get("holes", []):
                dr.polygon([T(q) for q in h], fill=hole or COL["land"])

    polys(g["water"], COL["water"])
    polys(g["sidewalk"], COL["sidewalk"], COL["road"])
    polys(g["roads"], COL["road"], COL["sidewalk"])
    polys(g["plazas"], COL["plaza"], COL["road"])
    polys(g["piers"], COL["pier"])
    for s in g["ships"]:
        dr.polygon([T(q) for q in s["exterior"]], fill=COL["ship"], outline=COL["outline"])
    over = d.get("hero_overrides", {})
    for b in C.load_json(f"data/{district_id}/buildings.json")["buildings"]:
        col = COL["bld_hero"] if b["tier"] == "hero" else COL["bld_mid"] if b["tier"] == "mid" else COL["bld_far"]
        if b["bin"] in over:
            col = (112, 100, 70)
        dr.polygon([T(q) for q in b["outline"]], fill=col, outline=COL["outline"])
    # TKTS red steps
    dr.rectangle([T((-28.1, 138.2)), T((-13.1, 121.5))], fill=COL["steps"])
    img = img.filter(ImageFilter.SMOOTH)
    out_dir = C.project_path(d["outputs"]["export_dir"])
    img.save(os.path.join(out_dir, "map.png"), optimize=True)

    grid = d["street_grid_local"]
    av_names = {-1306: "12th Ave", -1096: "11th Ave", -823: "10th Ave", -550: "9th Ave", -275: "8th Ave", 0: "7th Ave", 273: "6th Ave",
                584: "5th Ave", 739: "Madison Ave"}
    labels = [{"text": n, "x": x, "y": 0.0, "kind": "avenue"} for x, n in av_names.items()]
    labels[0]["ymin"] = -150                      # 12th Ave bends west toward the river south of W 43rd
    labels += [{"text": f"W {37 + k}th St".replace("1th", "1st").replace("2th", "2nd").replace("3th", "3rd")
                .replace("11st", "11th").replace("12nd", "12th").replace("13rd", "13th"),
                "x": -140.0, "y": y, "kind": "street"} for k, (y, w) in enumerate(grid["streets"])]
    labels += [{"text": "Hudson River", "x": -1640.0, "y": 0.0, "kind": "water"}]
    # Broadway centreline (local metres), from OSM: used to anchor its label on the diagonal
    broadway = [[133.0, -500.0], [71.6, -331.0], [27.6, -164.0], [15.4, -85.0], [-50.9, 155.0],
                [-63.7, 234.0], [-79.1, 314.0], [-82.9, 394.0], [-140.0, 700.0]]
    markers = [
        {"id": "tkts", "label": "TKTS Red Steps", "x": -20.6, "y": 130.0, "icon": "star"},
        {"id": "1tsq", "label": "One Times Square", "x": 22.0, "y": -214.0, "icon": "star"},
        {"id": "nasdaq", "label": "Nasdaq", "x": 58.0, "y": -182.0, "icon": "star"},
        {"id": "750", "label": "750 7th Ave", "x": 40.0, "y": 350.0, "icon": "star"},
        {"id": "paramount", "label": "Paramount", "x": -45.0, "y": -124.0, "icon": "star"},
        {"id": "marquis", "label": "Marriott Marquis", "x": -80.0, "y": 34.0, "icon": "star"},
        {"id": "intrepid", "label": "Intrepid · fly a plane", "x": -1486.0, "y": 23.0, "icon": "plane"},
        {"id": "pier83", "label": "Pier 83 · sightseeing boat", "x": -1494.0, "y": -193.0, "icon": "ship"},
    ]
    # ad slots (yellow = available); a backend will later mark sold ones
    slots = C.load_json(d["outputs"]["slots"])["slots"]
    for s in slots:
        c = s["center"]
        markers.append({"id": s["slot_id"], "label": s["slot_id"], "x": round(c[0], 1), "y": round(c[1], 1),
                        "icon": "slot", "status": s["status"]})
    C.save_json(f"{d['outputs']['export_dir']}/map.json", {
        "district": district_id, "bounds": [x0, y0, x1, y1], "px_per_m": PX, "size": [W, H],
        "grid_rotation_deg": d.get("grid_rotation_deg", 0.0), "labels": labels, "markers": markers,
        "paths": {"Broadway": broadway}})
    print(f"map.png {W}x{H} ({os.path.getsize(os.path.join(out_dir, 'map.png')) // 1024} KB), "
          f"{len(labels)} labels, {len(markers)} markers")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "times_square")

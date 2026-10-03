"""Bake the wider region's street map (the layer under the harbour's and Times Square's, same look): water, land,
parks, every road from motorways to residential streets, the airports. An overview image for the whole region plus
sharp tiles the map loads only when you zoom in.

  .venv/bin/python scripts/tools/build_region_map.py   -> export/region/map_overview.webp, map_<i>_<j>.webp, map.json

Inputs: data/region/region.json + map_land.json (prep_region.py), data/region/map_osm.json (fetch_region_map.py).
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402

COL = {"water": (28, 58, 92), "land": (46, 50, 56), "park": (44, 72, 48), "minor": (78, 82, 90), "major": (104, 108, 116),
       "motorway": (128, 118, 92), "apron": (70, 74, 80), "runway": (150, 154, 162)}
WIDTH = {"motorway": 22, "trunk": 18, "primary": 15, "secondary": 13, "tertiary": 11, "motorway_link": 9, "trunk_link": 9,
         "primary_link": 8, "secondary_link": 8, "residential": 7, "unclassified": 7, "living_street": 6}
MAJOR = {"trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link"}
OVER = 1 / 16                                   # overview: px per metre (the whole region in ~2100 x 2200 px)
DETAIL, TILE = 0.4, 2048                        # tiles: px per metre (2.5 m a pixel), px per tile (~5.1 km)


def main():
    R = C.load_json("data/region/region.json")
    L = C.load_json("data/region/map_land.json")
    osm = C.load_json("data/region/map_osm.json")
    P = C.district_projector(C.load_district("harbor"))
    xs, ys = [p[0] for p in R["frame"]], [p[1] for p in R["frame"]]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    by = {}                                                  # roads by class, each with its bbox (tiles skip the rest)
    for r in osm["roads"]:
        pts = [P(a, b) for a, b in r["pts"]]
        bx, byy = [q[0] for q in pts], [q[1] for q in pts]
        by.setdefault(r["hw"], []).append(((min(bx), min(byy), max(bx), max(byy)), pts))
    parks = [[P(a, b) for a, b in p["pts"]] for p in osm["parks"]]          # the real outlines (OSM)
    order = ["residential", "unclassified", "living_street", "secondary_link", "primary_link", "tertiary", "secondary",
             "trunk_link", "primary", "trunk", "motorway_link", "motorway"]                  # bigger roads drawn on top

    def render(ox, oy, W, H, k):
        """the map for the rect with top-left (ox, oy_top) at k px/m"""
        img = Image.new("RGBA", (W, H), (0, 0, 0, 0))       # outside the fetched area: transparent, not fake water
        d = ImageDraw.Draw(img)
        T = lambda p: ((p[0] - ox) * k, (oy - p[1]) * k)
        right, bottom = ox + W / k, oy - H / k
        d.polygon([T(q) for q in R["frame"]], fill=COL["water"])
        for ring in L["rings"]:
            d.polygon([T(q) for q in ring], fill=COL["land"])
        for ring in L["holes"]:
            d.polygon([T(q) for q in ring], fill=COL["water"])
        for poly in parks:
            if len(poly) >= 3:
                d.polygon([T(q) for q in poly], fill=COL["park"])
        for A in R["airports"].values():
            for poly in A["aprons"]:
                d.polygon([T(q) for q in poly], fill=COL["apron"])
            for tw in A["taxiways"]:
                d.line([T(q) for q in tw["pts"]], fill=COL["apron"], width=max(1, int(tw["w"] * k)))
        for hw in order:
            col = COL["motorway"] if hw.startswith("motorway") else COL["major"] if hw in MAJOR else COL["minor"]
            w = max(1, round(WIDTH.get(hw, 7) * k * (1.0 if k > 0.2 else 2.2)))          # overview: thicker, so they read
            if k < 0.1 and hw in ("residential", "unclassified", "living_street"):
                col = tuple(int(c * 0.85 + COL["land"][i] * 0.15) for i, c in enumerate(col))
            for (bx0, by0, bx1, by1), pts in by.get(hw, []):
                if bx1 < ox - 50 or bx0 > right + 50 or by1 < bottom - 50 or by0 > oy + 50 or len(pts) < 2:
                    continue
                if True:
                    d.line([T(q) for q in pts], fill=col, width=w, joint="curve" if w > 2 else None)
        for A in R["airports"].values():
            for r in A["runways"]:
                d.line([T(r["a"]), T(r["b"])], fill=COL["runway"], width=max(2, int(r["w"] * k)))
        return img

    out = C.project_path("export/region")
    os.makedirs(out, exist_ok=True)
    W, H = int((x1 - x0) * OVER), int((y1 - y0) * OVER)
    render(x0, y1, W, H, OVER).save(os.path.join(out, "map_overview.webp"), "WEBP", quality=80, method=5)
    print("overview", W, H, flush=True)
    span = TILE / DETAIL
    tiles = []
    nx, ny = int((x1 - x0) // span) + 1, int((y1 - y0) // span) + 1
    for i in range(nx):
        for j in range(ny):
            tx0, ty1 = x0 + i * span, y1 - j * span
            name = f"map_{i}_{j}.webp"
            render(tx0, ty1, TILE, TILE, DETAIL).save(os.path.join(out, name), "WEBP", quality=78, method=5)
            tiles.append({"file": name, "bounds": [round(tx0, 1), round(ty1 - span, 1), round(tx0 + span, 1), round(ty1, 1)]})
            print("tile", name, flush=True)
    # place names: boroughs and towns first (they win label collisions), then neighbourhoods
    rank = {"borough": 0, "city": 1, "town": 2, "suburb": 3, "quarter": 4, "neighbourhood": 5}
    labels, seen = [], set()
    for p in sorted(osm["places"], key=lambda p: rank.get(p["kind"], 9)):
        if not p.get("name") or p["name"] in seen:
            continue
        x, y = P(p["lat"], p["lon"])
        if not (x0 < x < x1 and y0 < y < y1):
            continue
        seen.add(p["name"])
        labels.append({"text": p["name"], "x": round(x, 1), "y": round(y, 1), "kind": "area", "rank": rank.get(p["kind"], 9)})
    C.save_json("export/region/map.json", {"bounds": [x0, y0, x1, y1], "overview": {"file": "map_overview.webp", "px_per_m": OVER},
                                           "tile_px_per_m": DETAIL, "tiles": tiles, "labels": labels})
    print(len(tiles), "tiles,", len(labels), "labels -> export/region", flush=True)


if __name__ == "__main__":
    main()

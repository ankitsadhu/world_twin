"""Footprints GeoJSON -> data/<id>/buildings.json (run with the project venv).

Projects to local metres, simplifies outlines, drops buildings off the play area / in the water,
assigns tier (hero / mid / far) from the manifest's local tier rectangles and a deterministic
facade style from construction year + height (seeded by BIN so re-runs are stable).
"""
import json
import random
import re
import sys

from shapely.geometry import Polygon, box
from shapely.validation import make_valid

import ts_common as C

# facade style families -> library materials (wall, accent). Picked by era/height.
STYLES = {
    "prewar_red": ["M_Facade_BrickRed"],
    "prewar_buff": ["M_Facade_BrickBuff"],
    "prewar_stone": ["M_Facade_Limestone"],
    "modern_glass": ["M_Glass_CurtainDark", "M_Glass_CurtainBlue", "M_Glass_CurtainGreen"],
    "postwar_stone": ["M_Facade_Limestone", "M_Facade_BrickBuff"],
}


def style_for(year, height, rng):
    if year >= 1975 and height > 45:
        return "modern_glass"
    if year >= 1950:
        return rng.choice(["postwar_stone", "modern_glass"] if height > 80 else ["postwar_stone", "prewar_buff"])
    if height > 90:
        return rng.choice(["prewar_stone", "prewar_buff"])
    return rng.choice(["prewar_red", "prewar_red", "prewar_buff", "prewar_stone"])


def slug(s):
    return re.sub(r"[^A-Za-z0-9]+", "", (s or "").title())[:28]


def main(district_id):
    d = C.load_district(district_id)
    P = C.district_projector(d)
    rects = d["tier_rects_local"]
    hero, mid, play = box(*rects["hero"]), box(*rects["mid"]), box(*rects["play"])
    ground = C.load_json(f"data/{district_id}/ground.json")
    water = [Polygon(w["exterior"], w["holes"]) for w in ground["water"]]
    feats = C.load_json(d["outputs"]["footprints"])["features"]
    out, skipped = [], 0
    for f in feats:
        p = f["properties"]
        h = float(p.get("height_m") or 0)
        if h < 2.5:
            skipped += 1
            continue
        for k, poly in enumerate(f["geometry"]["coordinates"]):
            outer = [P(lat, lon) for lon, lat in poly[0]]
            if len(outer) < 4:
                continue
            g = make_valid(Polygon(outer)).buffer(0).simplify(0.2 if h > 20 else 0.4)
            if g.is_empty or g.area < 8:
                continue
            if g.geom_type != "Polygon":
                g = max(getattr(g, "geoms", [g]), key=lambda x: x.area)
            c = g.centroid
            if not play.contains(c) or any(w.contains(c) for w in water):
                skipped += 1
                continue
            tier = "hero" if hero.contains(c) else "mid" if mid.contains(c) else "far"
            bin_ = str(p.get("bin") or p.get("doitt_id"))
            rng = random.Random(bin_)
            year = int(float(p.get("construction_year") or 1930))
            style = style_for(year, h, rng)
            name = slug(p.get("name"))
            out.append({
                "id": f"{bin_}" + (f"_{k}" if k else ""), "bin": bin_, "name": p.get("name"),
                "obj": f"BLD_{d['prefix']}_{name + '_' if name else ''}{bin_}" + (f"_{k}" if k else ""),
                "tier": tier, "height_m": round(h, 2), "year": year, "style": style,
                "wall_mat": rng.choice(STYLES[style]),
                "outline": [[round(x, 3), round(y, 3)] for x, y in list(g.exterior.coords)[:-1]],
                "centroid": [round(c.x, 2), round(c.y, 2)], "area_m2": round(g.area, 1),
            })
    C.save_json(f"data/{district_id}/buildings.json", {"district": district_id, "buildings": out})
    from collections import Counter
    print(len(out), "buildings", dict(Counter(b["tier"] for b in out)), "skipped", skipped,
          dict(Counter(b["style"] for b in out)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "times_square")

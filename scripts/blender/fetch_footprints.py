"""Fetch building footprints + roof heights for a district's bounds (run with plain python3).

Source: NYC Open Data "BUILDING" dataset (5zhs-2jue): height_roof / ground_elevation in feet.
Usage: python3 scripts/blender/fetch_footprints.py times_square
"""
import json
import sys
import urllib.parse
import urllib.request

import ts_common as C

DATASET = "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson"
UA = {"User-Agent": "find-a-startup-3d-city/0.1"}
PAGE = 5000


def fetch(bounds):
    s, w, n, e = bounds["south"], bounds["west"], bounds["north"], bounds["east"]
    where = f"within_box(the_geom, {n}, {w}, {s}, {e})"
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"$where": where, "$limit": PAGE, "$offset": offset, "$order": "objectid"})
        req = urllib.request.Request(f"{DATASET}?{q}", headers=UA)
        page = json.load(urllib.request.urlopen(req, timeout=120))["features"]
        feats += page
        if len(page) < PAGE:
            return feats
        offset += PAGE


def main(district_id):
    d = C.load_district(district_id)
    feats = fetch(d["bounds_geo"])
    for f in feats:  # normalise to metres
        p = f["properties"]
        p["height_m"] = round(float(p.get("height_roof") or 0) * 0.3048, 2)
        p["ground_m"] = round(float(p.get("ground_elevation") or 0) * 0.3048, 2)
    out = {"type": "FeatureCollection", "source": "NYC Open Data 5zhs-2jue", "features": feats}
    C.save_json(d["outputs"]["footprints"], out)
    print(f"{len(feats)} footprints -> {d['outputs']['footprints']}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "times_square")

"""Fetch the harbour's OpenStreetMap layers: coastline (land/water), piers, and New Jersey buildings (the NYC side comes
from NYC Open Data footprints with surveyed roof heights).

Usage: python3 scripts/blender/fetch_harbor_osm.py harbor   -> data/harbor/osm.json
Data (c) OpenStreetMap contributors, ODbL. The bbox is split into tiles: big queries time out.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

import ts_common as C

MIRRORS = ["https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass-api.de/api/interpreter"]   # the first one that answered fastest (2026-10)
UA = {"User-Agent": "find-a-startup-3d-city/0.1"}


def post(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(3):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=body, headers=UA)
                return json.load(urllib.request.urlopen(req, timeout=180))
            except Exception as e:  # noqa: BLE001 - try the next mirror
                last = e
        time.sleep(5)
    raise RuntimeError(f"overpass failed: {last}")


def main(district_id):
    d = C.load_district(district_id)
    b = d["bounds_geo"]
    bbox = f"{b['south']},{b['west']},{b['north']},{b['east']}"
    out = {"source": "OpenStreetMap contributors (ODbL)", "bounds": b, "elements": []}
    seen = set()

    def run(sub, box):
        q = f"[out:json][timeout:150];{sub}({box});out geom tags;"
        res = post(q)
        n = 0
        for e in res.get("elements", []):
            k = (e["type"], e["id"])
            if k not in seen:
                seen.add(k); out["elements"].append(e); n += 1
        print(f"  {sub[:60]:60s} {box} +{n}")

    run('way["natural"="coastline"]', bbox)
    run('way["man_made"="pier"]', bbox)
    run('way["man_made"="breakwater"]', bbox)
    run('relation["natural"="water"]', bbox)
    run('way["leisure"="park"]', bbox)                      # parks (Central Park, Hudson River Park, Liberty State Park...)
    run('relation["leisure"="park"]', bbox)
    # New Jersey buildings (west of the Hudson's centreline), in tiles
    s, w, n, e = b["south"], b["west"], b["north"], -73.99     # NJ's shore runs NE: Weehawken is at -74.01
    rows, cols = 6, 3
    for i in range(rows):
        for j in range(cols):
            box = f"{s + (n - s) * i / rows:.5f},{w + (e - w) * j / cols:.5f},{s + (n - s) * (i + 1) / rows:.5f},{w + (e - w) * (j + 1) / cols:.5f}"
            run('way["building"]', box)
    C.save_json(d["outputs"]["osm"], out)
    print(len(out["elements"]), "elements ->", d["outputs"]["osm"])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "harbor")

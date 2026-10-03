"""Fetch street centrelines, pedestrian plazas, piers and shoreline from OpenStreetMap (Overpass).

Usage: python3 scripts/blender/fetch_osm.py times_square   -> data/<id>/osm.json
Data (c) OpenStreetMap contributors, ODbL. Split into small sub-queries: big ones time out.
"""
import json
import sys
import urllib.parse
import urllib.request

import ts_common as C

MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.private.coffee/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
UA = {"User-Agent": "find-a-startup-3d-city/0.1"}

SUBQUERIES = [
    'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|pedestrian|living_street)$"]',
    'way["highway"="service"]',
    'way["area:highway"]',
    'way["man_made"="pier"]',
    'way["natural"~"^(coastline|water)$"]',
    'way["place"="square"]',
    'way["historic"="ship"]',
]


def query(sub, b):
    bbox = f"{b['south']},{b['west']},{b['north']},{b['east']}"
    return f"[out:json][timeout:90];{sub}({bbox});out geom tags;"


def post(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    err = None
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=body, headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # mirror busy -> try next
            err = e
            print(f"  {url}: {e}")
    raise SystemExit(f"all Overpass mirrors failed: {err}")


def main(district_id):
    d = C.load_district(district_id)
    elements, seen = [], set()
    for sub in SUBQUERIES:
        res = post(query(sub, d["bounds_geo"]))
        new = [e for e in res["elements"] if (e["type"], e["id"]) not in seen]
        seen.update((e["type"], e["id"]) for e in new)
        elements += new
        print(f"{sub}: {len(new)}")
    out_rel = f"data/{district_id}/osm.json"
    C.save_json(out_rel, {"source": "OpenStreetMap contributors (ODbL)", "elements": elements})
    print(f"{len(elements)} elements -> {out_rel}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "times_square")

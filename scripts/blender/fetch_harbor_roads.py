"""Fetch the harbour's streets from OpenStreetMap for its map layer (Times Square's map draws its own streets).

Usage: python3 scripts/blender/fetch_harbor_roads.py harbor   -> data/harbor/roads.json
Data (c) OpenStreetMap contributors, ODbL.
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
SUB = 'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|motorway_link|trunk_link|primary_link)$"]'


def post(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    for attempt in range(3):
        for url in MIRRORS:
            try:
                return json.load(urllib.request.urlopen(urllib.request.Request(url, data=body, headers=UA), timeout=180))
            except Exception as e:  # noqa: BLE001
                last = e
        time.sleep(5)
    raise RuntimeError(last)


def main(district_id):
    d = C.load_district(district_id)
    b = d["bounds_geo"]
    out, seen = [], set()
    rows, cols = 5, 2
    for i in range(rows):
        for j in range(cols):
            s = b["south"] + (b["north"] - b["south"]) * i / rows; n = b["south"] + (b["north"] - b["south"]) * (i + 1) / rows
            w = b["west"] + (b["east"] - b["west"]) * j / cols; e = b["west"] + (b["east"] - b["west"]) * (j + 1) / cols
            res = post(f"[out:json][timeout:150];{SUB}({s:.5f},{w:.5f},{n:.5f},{e:.5f});out geom tags;")
            k = 0
            for el in res.get("elements", []):
                if el["id"] in seen or "geometry" not in el:
                    continue
                seen.add(el["id"]); k += 1
                out.append({"hw": el["tags"].get("highway"), "name": el["tags"].get("name"),
                            "pts": [[round(q["lat"], 6), round(q["lon"], 6)] for q in el["geometry"]]})
            print(f"tile {i},{j}: +{k}", flush=True)
    C.save_json("data/harbor/roads.json", {"source": "OpenStreetMap contributors (ODbL)", "roads": out})
    print(len(out), "roads -> data/harbor/roads.json", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "harbor")

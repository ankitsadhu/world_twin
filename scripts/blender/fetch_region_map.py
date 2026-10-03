"""Fetch the wider region's street map from OpenStreetMap: every road (motorways to residential streets), parks and
place names (boroughs, towns, neighbourhoods), for the map layer under Midtown and the harbour.

  python3 -u scripts/blender/fetch_region_map.py   -> data/region/map_osm.json

Data (c) OpenStreetMap contributors, ODbL.
"""
import json
import os
import time
import urllib.parse
import urllib.request

MIRRORS = ["https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass-api.de/api/interpreter"]
UA = {"User-Agent": "find-a-startup-3d-city/0.1"}
REGION = (40.60, -74.26, 40.92, -73.80)                 # south, west, north, east: Newark .. LaGuardia, Teterboro
N = 8                                                   # 8 x 8 tiles (~4.4 x 4.9 km each)
ROADS = ('way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|'
         'motorway_link|trunk_link|primary_link|secondary_link)$"]')
MAJOR = {"motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link"}
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def post(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(4):
        for url in MIRRORS:
            try:
                return json.load(urllib.request.urlopen(urllib.request.Request(url, data=body, headers=UA), timeout=200))
            except Exception as e:  # noqa: BLE001
                last = e
        time.sleep(8)
    raise RuntimeError(last)


def main():
    path = os.path.join(ROOT, "data", "region", "map_osm.json")
    out = {"source": "OpenStreetMap contributors (ODbL)", "region": REGION, "roads": [], "parks": [], "places": [], "done": []}
    if os.path.exists(path):                             # resume: Overpass is slow, keep what we have
        out = json.load(open(path))
    seen = set()
    s, w, n, e = REGION
    for i in range(N):
        for j in range(N):
            key = f"{i},{j}"
            if key in out["done"]:
                continue
            bb = f"{s + (n - s) * i / N:.5f},{w + (e - w) * j / N:.5f},{s + (n - s) * (i + 1) / N:.5f},{w + (e - w) * (j + 1) / N:.5f}"
            res = post(f'[out:json][timeout:180];({ROADS}({bb});way["leisure"="park"]({bb});'
                       f'way["landuse"~"^(cemetery|recreation_ground)$"]({bb});'
                       f'node["place"~"^(borough|city|town|suburb|neighbourhood|quarter)$"]({bb}););out geom tags;')
            k = 0
            for el in res.get("elements", []):
                t = el.get("tags", {})
                if el["type"] == "node":
                    out["places"].append({"name": t.get("name"), "kind": t.get("place"), "lat": round(el["lat"], 5),
                                          "lon": round(el["lon"], 5)})
                    continue
                if el["id"] in seen or "geometry" not in el:
                    continue
                seen.add(el["id"]); k += 1
                pts = [[round(q["lat"], 5), round(q["lon"], 5)] for q in el["geometry"]]
                if "highway" in t:
                    out["roads"].append({"hw": t["highway"], "name": t.get("name") if t["highway"] in MAJOR else None, "pts": pts})
                elif len(pts) >= 4:
                    out["parks"].append({"name": t.get("name"), "pts": pts})
            out["done"].append(key)
            print(f"tile {key}: +{k} (roads {len(out['roads'])}, parks {len(out['parks'])})", flush=True)
            json.dump(out, open(path, "w"))
    print("->", path, os.path.getsize(path) // 1024, "KB", flush=True)


if __name__ == "__main__":
    main()

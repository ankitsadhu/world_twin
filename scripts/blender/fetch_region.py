"""Fetch the wider New York region for flying: the coastline (land vs water) and the real airports a small plane
uses around Manhattan (runways, taxiways, aprons, terminals) from OpenStreetMap.

  python3 -u scripts/blender/fetch_region.py   -> data/region/osm.json

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
AIRPORTS = {                                             # bbox per airport (south, west, north, east)
    "TEB": (40.840, -74.075, 40.870, -74.045),
    "LGA": (40.762, -73.895, 40.790, -73.855),
    "EWR": (40.665, -74.195, 40.712, -74.150),
}
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def post(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(3):
        for url in MIRRORS:
            try:
                return json.load(urllib.request.urlopen(urllib.request.Request(url, data=body, headers=UA), timeout=180))
            except Exception as e:  # noqa: BLE001
                last = e
        time.sleep(5)
    raise RuntimeError(last)


def main():
    out = {"source": "OpenStreetMap contributors (ODbL)", "region": REGION, "coastline": [], "airports": {}}
    s, w, n, e = REGION
    # coastline in 4 tiles (big single queries time out)
    seen = set()
    for i in range(2):
        for j in range(2):
            bb = f"{s + (n - s) * i / 2},{w + (e - w) * j / 2},{s + (n - s) * (i + 1) / 2},{w + (e - w) * (j + 1) / 2}"
            res = post(f'[out:json][timeout:150];way["natural"="coastline"]({bb});out geom;')
            k = 0
            for el in res.get("elements", []):
                if el["id"] in seen or "geometry" not in el:
                    continue
                seen.add(el["id"]); k += 1
                out["coastline"].append([[round(q["lat"], 6), round(q["lon"], 6)] for q in el["geometry"]])
            print(f"coastline tile {i},{j}: +{k}", flush=True)
    for code, (s2, w2, n2, e2) in AIRPORTS.items():
        bb = f"{s2},{w2},{n2},{e2}"
        res = post(f'[out:json][timeout:120];(way["aeroway"~"^(runway|taxiway|apron|terminal|hangar)$"]({bb}););out geom tags;')
        feats = []
        for el in res.get("elements", []):
            if "geometry" not in el:
                continue
            t = el.get("tags", {})
            feats.append({"kind": t.get("aeroway"), "ref": t.get("ref"), "name": t.get("name"), "width": t.get("width"),
                          "surface": t.get("surface"), "pts": [[round(q["lat"], 6), round(q["lon"], 6)] for q in el["geometry"]]})
        out["airports"][code] = feats
        print(f"{code}: {len(feats)} features ({sum(1 for f in feats if f['kind'] == 'runway')} runways)", flush=True)
    path = os.path.join(ROOT, "data", "region", "osm.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(out, f)
    print("->", path, os.path.getsize(path) // 1024, "KB", flush=True)


if __name__ == "__main__":
    main()

"""The wider region for flying, in the shared local frame: land (from the OSM coastline) and the airports.

  .venv/bin/python scripts/tools/prep_region.py   -> data/region/region.json

Land: the region rectangle cut by the coastline; each piece is land if it lies to the LEFT of its nearest coastline
segment (OSM convention). Kept coarse (20 m) - it's seen from a plane; Midtown and the harbour draw their own,
detailed ground on top. Airports: runways from their OSM centrelines and width (real headings, real lengths),
taxiways as ribbons, aprons as polygons, terminals and hangars as footprints to extrude.
"""
import json
import math
import os
import sys

from shapely import constrained_delaunay_triangles
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import linemerge, split, unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402

NAMES = {
    "TEB": ("Teterboro Airport", "Teterboro, NJ · the busiest general-aviation airport in the New York area: private planes, "
            "business jets and the Hudson River sightseeing flights. In New York: about 30 min by car to Midtown."),
    "LGA": ("LaGuardia Airport", "Queens · opened in 1939 on the shore of Flushing Bay. In New York: about 30 min by cab "
            "to Midtown, or the Q70 bus to the subway."),
    "EWR": ("Newark Liberty International Airport", "Newark, NJ · opened in 1928, the New York area's first major airport. "
            "In New York: AirTrain and NJ Transit to Penn Station in about 30 min."),
}


def r2(v):
    return round(v, 1)


def main():
    osm = C.load_json("data/region/osm.json")
    P = C.district_projector(C.load_district("harbor"))
    s, w, n, e = osm["region"]                             # the whole fetched area (tilted 29 degrees in the grid frame)
    frame = Polygon([P(s, w), P(s, e), P(n, e), P(n, w)])
    coast = [LineString([P(a, b) for a, b in ln]) for ln in osm["coastline"] if len(ln) > 1]
    merged = linemerge(MultiLineString(coast))
    pieces = split(frame, merged)
    segs = []
    for ln in getattr(merged, "geoms", [merged]):
        cs = list(ln.coords)
        segs += list(zip(cs, cs[1:]))
    land = []
    for g in pieces.geoms:
        if g.area < 2e4:
            continue
        q = g.representative_point()
        best, bd = None, 1e18
        for (ax, ay), (bx, by) in segs:                      # nearest coastline segment (coarse is fine)
            vx, vy = bx - ax, by - ay
            t = max(0, min(1, ((q.x - ax) * vx + (q.y - ay) * vy) / (vx * vx + vy * vy or 1)))
            d = (ax + vx * t - q.x) ** 2 + (ay + vy * t - q.y) ** 2
            if d < bd:
                bd, best = d, ((ax, ay), (bx, by))
        (ax, ay), (bx, by) = best
        if (bx - ax) * (q.y - ay) - (by - ay) * (q.x - ax) > 0:   # left of the coastline: land
            land.append(g)
    land_all = unary_union(land)
    fine = land_all.simplify(4)                              # for the map (build_region_map.py): a sharper coast
    C.save_json("data/region/map_land.json", {"rings": [[[r2(x), r2(y)] for x, y in g.exterior.coords]
                                                        for g in getattr(fine, "geoms", [fine]) if g.geom_type == "Polygon"],
                                              "holes": [[[r2(x), r2(y)] for x, y in h.coords] for g in getattr(fine, "geoms", [fine])
                                                        if g.geom_type == "Polygon" for h in g.interiors]})
    land_u = land_all.simplify(20)
    tris = []
    for g in getattr(land_u, "geoms", [land_u]):
        if g.geom_type != "Polygon":
            continue
        for t in getattr(constrained_delaunay_triangles(g), "geoms", []):
            tris += [r2(v) for xy in list(t.exterior.coords)[:3] for v in xy]
    print(f"land: {len(land)} pieces, {land_u.area / 1e6:.0f} km2, {len(tris) // 6} triangles")

    airports = {}
    for code, feats in osm["airports"].items():
        A = {"code": code, "name": NAMES[code][0], "fact": NAMES[code][1], "runways": [], "taxiways": [], "aprons": [],
             "terminals": [], "hangars": []}
        for f in feats:
            pts = [P(a, b) for a, b in f["pts"]]
            k = f["kind"]
            try:
                wid = float(str(f.get("width") or "").split()[0])
            except (ValueError, IndexError):
                wid = None
            if k == "runway" and len(pts) >= 2:
                a, b = pts[0], pts[-1]
                if (f.get("surface") or "asphalt") in ("grass", "water"):
                    continue
                A["runways"].append({"ref": f.get("ref") or "", "a": [r2(a[0]), r2(a[1])], "b": [r2(b[0]), r2(b[1])],
                                     "w": wid or 45.0, "len": round(math.dist(a, b))})
            elif k == "taxiway" and len(pts) >= 2:
                A["taxiways"].append({"w": wid or 22.0, "pts": [[r2(x), r2(y)] for x, y in LineString(pts).simplify(2).coords]})
            elif k in ("apron", "terminal", "hangar") and len(pts) >= 4:
                g = Polygon(pts).buffer(0).simplify(1.5)
                if g.is_empty or g.geom_type != "Polygon" or g.area < 50:
                    continue
                key = {"apron": "aprons", "terminal": "terminals", "hangar": "hangars"}[k]
                A[key].append([[r2(x), r2(y)] for x, y in list(g.exterior.coords)[:-1]])
        # a runway mapped as several ways (split at taxiway crossings): one strip per ref, end to end
        merged_rw = {}
        for r in A["runways"]:
            k = r["ref"] or f"{r['a']}"
            if k in merged_rw:
                m = merged_rw[k]
                pts = [m["a"], m["b"], r["a"], r["b"]]
                a, b = max(((p, q) for p in pts for q in pts), key=lambda pq: math.dist(*pq))
                m.update(a=a, b=b, len=round(math.dist(a, b)), w=max(m["w"], r["w"]))
            else:
                merged_rw[k] = dict(r)
        A["runways"] = [r for r in merged_rw.values() if r["len"] > 400]     # not helipads / stubs
        # a = the threshold of the first designator ("01" of "01/19"): flying a -> b you hold its magnetic heading
        # (NYC's magnetic variation is about 13 degrees west, so magnetic = true + 13)
        n0, n1 = P(40.75, -73.98), P(40.76, -73.98)
        north = math.atan2(n1[0] - n0[0], n1[1] - n0[1])
        for r in A["runways"]:
            true = math.degrees(math.atan2(r["b"][0] - r["a"][0], r["b"][1] - r["a"][1]) - north) % 360
            num = int("".join(ch for ch in r["ref"].split("/")[0] if ch.isdigit()) or 0)
            if num and abs((true + 13 - num * 10 + 180) % 360 - 180) > 90:
                r["a"], r["b"] = r["b"], r["a"]
        c = unary_union([LineString([r["a"], r["b"]]) for r in A["runways"]]).centroid if A["runways"] else Point(0, 0)
        A["center"] = [r2(c.x), r2(c.y)]
        airports[code] = A
        print(f"{code}: {len(A['runways'])} runways ({', '.join(r['ref'] + ' ' + str(r['len']) + ' m' for r in A['runways'])}), "
              f"{len(A['taxiways'])} taxiways, {len(A['aprons'])} aprons, {len(A['terminals'])} terminals, {len(A['hangars'])} hangars")
    # the big parks, kept green under the city infill (corners, real lat/lon)
    PARKS = {
        "Central Park": [(40.7681, -73.9819), (40.7644, -73.9730), (40.7969, -73.9493), (40.8006, -73.9580)],
        "Prospect Park": [(40.6720, -73.9700), (40.6610, -73.9620), (40.6510, -73.9720), (40.6560, -73.9790), (40.6700, -73.9790)],
        "Flushing Meadows": [(40.7600, -73.8480), (40.7520, -73.8380), (40.7270, -73.8360), (40.7280, -73.8500), (40.7500, -73.8550)],
        "Van Cortlandt / Bronx Park": [(40.8700, -73.8800), (40.8700, -73.8650), (40.8500, -73.8700), (40.8500, -73.8800)],
        "Liberty State Park": [(40.7120, -74.0560), (40.7080, -74.0450), (40.6950, -74.0500), (40.6980, -74.0620)],
    }
    parks = [{"name": k, "poly": [[r2(c) for c in P(a, b)] for a, b in v]} for k, v in PARKS.items()]
    C.save_json("data/region/region.json", {"frame": [[r2(x), r2(y)] for x, y in list(frame.exterior.coords)[:-1]],
                                            "land_tris": tris, "airports": airports, "parks": parks})
    print("-> data/region/region.json", os.path.getsize(C.project_path("data/region/region.json")) // 1024, "KB")


if __name__ == "__main__":
    main()

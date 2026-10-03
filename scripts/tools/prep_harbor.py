"""Prepare the harbour district: land (from the OSM coastline), buildings (NYC Open Data + OSM New Jersey), piers.

  .venv/bin/python scripts/tools/prep_harbor.py harbor   -> data/harbor/harbor.json

Everything is in the shared local frame (same anchor and 29 deg grid rotation as Times Square). The Times Square play
area is cut out: that district models its own ground, buildings and piers.
Land: coastline ways are clipped to the district box and polygonised with the box edge; each face is land if it lies
to the LEFT of the nearest coastline segment (OSM convention).
"""
import json
import math
import os
import random
import re
import sys
from collections import Counter

from shapely import constrained_delaunay_triangles
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping
from shapely.ops import linemerge, polygonize, split, unary_union
from shapely.validation import make_valid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402

STYLES = {
    "prewar_red": ["M_Facade_BrickRed"], "prewar_buff": ["M_Facade_BrickBuff"], "prewar_stone": ["M_Facade_Limestone"],
    "modern_glass": ["M_Glass_CurtainDark", "M_Glass_CurtainBlue", "M_Glass_CurtainGreen"],
    "postwar_stone": ["M_Facade_Limestone", "M_Facade_BrickBuff"],
}
NJ_POINT = (40.7178, -74.0431)               # Jersey City: whichever land face holds this is New Jersey
STATUE = (40.68925, -74.0445)


def style_for(year, height, rng):              # same rules as prep_buildings.py (Times Square)
    if year >= 1975 and height > 45:
        return "modern_glass"
    if year >= 1950:
        return rng.choice(["postwar_stone", "modern_glass"] if height > 80 else ["postwar_stone", "prewar_buff"])
    if height > 90:
        return rng.choice(["prewar_stone", "prewar_buff"])
    return rng.choice(["prewar_red", "prewar_red", "prewar_buff", "prewar_stone"])


def osm_height(tags):
    for k in ("height", "building:height"):
        v = tags.get(k)
        if v:
            m = re.match(r"\s*([\d.]+)\s*(m|ft|')?", v)
            if m:
                h = float(m.group(1))
                return h * 0.3048 if m.group(2) in ("ft", "'") else h
    lv = tags.get("building:levels")
    if lv:
        try:
            return float(lv.split(";")[0]) * 3.2 + 1.0
        except ValueError:
            pass
    return {"house": 8.0, "detached": 8.0, "terrace": 10.0, "residential": 11.0, "garage": 3.5, "shed": 3.0,
            "industrial": 9.0, "warehouse": 9.0, "commercial": 12.0, "retail": 6.0}.get(tags.get("building"), 10.0)


def main(district_id):
    d = C.load_district(district_id)
    P = C.district_projector(d)
    b = d["bounds_geo"]
    # the district is the local rectangle (aligned with Times Square's grid, sharing its bottom edge); the geo bounds
    # only say what to download to cover it
    frame = box(*d["local_rect"]) if "local_rect" in d else \
        Polygon([P(b["south"], b["west"]), P(b["south"], b["east"]), P(b["north"], b["east"]), P(b["north"], b["west"])])
    ex = box(*d["exclude_local_rect"])
    osm = C.load_json(d["outputs"]["osm"])["elements"]

    # ---------------------------------------------------------------- land
    # New York: NYC's borough boundaries clipped to the shoreline (Manhattan incl. Liberty, Ellis and Governors Islands,
    # Brooklyn, Staten Island); New Jersey: the frame cut by the OSM coastline, the side holding Jersey City
    ny = []
    for f in C.load_json("data/harbor/boroughs.geojson")["features"]:
        for poly in f["geometry"]["coordinates"]:
            ring = [P(lat, lon) for lon, lat in poly[0]]
            g = make_valid(Polygon(ring, [[P(lat, lon) for lon, lat in h] for h in poly[1:]])).buffer(0)
            if g.intersects(frame):
                ny.append(g.intersection(frame))
    ny_u = unary_union(ny)
    coast = [LineString([P(p["lat"], p["lon"]) for p in e["geometry"]]) for e in osm
             if e["type"] == "way" and e.get("tags", {}).get("natural") == "coastline" and len(e.get("geometry", [])) > 1]
    nj = Point(P(*NJ_POINT))
    pieces = split(frame, linemerge(MultiLineString(coast)))
    nj_piece = next((g for g in pieces.geoms if g.contains(nj)), None)
    nj_u = nj_piece.difference(ny_u).buffer(0) if nj_piece is not None else Polygon()
    land_u = unary_union([ny_u, nj_u]).difference(ex).buffer(0)
    land_polys = [g for g in getattr(land_u, "geoms", [land_u]) if g.area > 200]
    nj_land = [g for g in getattr(nj_u.difference(ex), "geoms", [nj_u.difference(ex)]) if g.area > 200]
    print(f"land: NY {ny_u.area / 1e6:.2f} km2, NJ {nj_u.area / 1e6:.2f} km2 -> {len(land_polys)} land polygons")

    # ---------------------------------------------------------------- buildings: NYC (surveyed heights)
    sx, sy = P(*STATUE)
    statue_xy, out = None, []
    feats = C.load_json(d["outputs"]["footprints"])["features"]
    skipped = Counter()
    for f in feats:
        p = f["properties"]
        h = float(p.get("height_m") or 0)
        if h < 2.5:
            skipped["low"] += 1
            continue
        for k, poly in enumerate(f["geometry"]["coordinates"]):
            outer = [P(lat, lon) for lon, lat in poly[0]]
            if len(outer) < 4:
                continue
            g = make_valid(Polygon(outer)).buffer(0).simplify(0.3 if h > 20 else 0.6)
            if g.is_empty or g.area < 12:
                continue
            if g.geom_type != "Polygon":
                g = max(getattr(g, "geoms", [g]), key=lambda x: x.area)
            c = g.centroid
            if ex.contains(c) or not frame.contains(c):
                skipped["times_square" if ex.contains(c) else "outside"] += 1
                continue
            if math.hypot(c.x - sx, c.y - sy) < 45 and h > 20:      # the statue's pedestal: the hero model replaces it
                statue_xy = (round(c.x, 2), round(c.y, 2))
                skipped["statue"] += 1
                continue
            bin_ = str(p.get("bin") or p.get("doitt_id"))
            rng = random.Random(bin_)
            year = int(float(p.get("construction_year") or 1930))
            style = style_for(year, h, rng)
            out.append({"h": round(h, 2), "mat": rng.choice(STYLES[style]), "seed": bin_, "src": "nyc",
                        "outline": [[round(x, 2), round(y, 2)] for x, y in list(g.exterior.coords)[:-1]]})
    n_nyc = len(out)

    # ---------------------------------------------------------------- buildings: New Jersey (OSM)
    for e in osm:
        t = e.get("tags", {})
        if e["type"] != "way" or "building" not in t or len(e.get("geometry", [])) < 4:
            continue
        outer = [P(q["lat"], q["lon"]) for q in e["geometry"]]
        g = make_valid(Polygon(outer)).buffer(0)
        if g.is_empty or g.area < 20:
            continue
        if g.geom_type != "Polygon":
            g = max(getattr(g, "geoms", [g]), key=lambda x: x.area)
        c = g.centroid
        if not nj_u.contains(c):                             # NY side buildings come from NYC Open Data
            skipped["osm_not_nj"] += 1
            continue
        h = osm_height(t)
        g = g.simplify(0.3 if h > 20 else 0.6)
        rng = random.Random(e["id"])
        style = "modern_glass" if h > 60 else rng.choice(["prewar_red", "prewar_buff", "postwar_stone", "prewar_stone"])
        out.append({"h": round(h, 2), "mat": rng.choice(STYLES[style]), "seed": str(e["id"]), "src": "osm",
                    "outline": [[round(x, 2), round(y, 2)] for x, y in list(g.exterior.coords)[:-1]]})
    # what you can see from the harbour: everything near the water, and anything tall enough to rise over the rest
    from shapely import prepare
    shore = land_u.boundary
    prepare(shore)
    before = len(out)
    out = [o for o in out if o["h"] >= 18 or shore.distance(Polygon(o["outline"]).centroid) < 450]
    n_nyc = sum(1 for o in out if o["src"] == "nyc")
    print(f"buildings: {n_nyc} NYC + {len(out) - n_nyc} NJ (dropped {before - len(out)} low ones inland); skipped {dict(skipped)}; statue at {statue_xy}")

    # ---------------------------------------------------------------- piers
    land_all = unary_union(land_polys)
    piers = []
    for e in osm:
        t = e.get("tags", {})
        if e["type"] != "way" or t.get("man_made") not in ("pier", "breakwater"):
            continue
        pts = [P(q["lat"], q["lon"]) for q in e.get("geometry", [])]
        if len(pts) < 2:
            continue
        closed = len(pts) > 3 and math.dist(pts[0], pts[-1]) < 0.5
        g = make_valid(Polygon(pts)).buffer(0) if closed else LineString(pts).buffer(4.0, cap_style="flat")
        g = g.intersection(frame).difference(ex)
        if g.is_empty or g.area < 30:
            continue
        for gg in getattr(g, "geoms", [g]):
            if gg.geom_type != "Polygon" or gg.area < 30:
                continue
            if gg.difference(land_all).area < 0.3 * gg.area:      # mostly on land: not a pier over the water
                continue
            piers.append([[round(x, 2), round(y, 2)] for x, y in list(gg.simplify(0.4).exterior.coords)[:-1]])
    print(f"piers: {len(piers)}")

    # ---------------------------------------------------------------- land triangles (constrained, holes respected)
    # parks (OSM leisure=park, ways and multipolygon relations): Central Park, Hudson River Park, Liberty State Park...
    park_geoms = []
    for e in osm:
        if e.get("tags", {}).get("leisure") != "park":
            continue
        if e["type"] == "way" and len(e.get("geometry", [])) > 3:
            park_geoms.append(make_valid(Polygon([P(q["lat"], q["lon"]) for q in e["geometry"]])).buffer(0))
        elif e["type"] == "relation":
            outer = [LineString([P(q["lat"], q["lon"]) for q in m["geometry"]]) for m in e.get("members", [])
                     if m.get("role") == "outer" and len(m.get("geometry", [])) > 1]
            if outer:
                park_geoms += [make_valid(g).buffer(0) for g in polygonize(linemerge(MultiLineString(outer))).geoms]
    parks_u = unary_union([g for g in park_geoms if g.area > 1500]).intersection(frame).buffer(0) if park_geoms else Polygon()
    print(f"parks: {len(park_geoms)} OSM parks, {parks_u.area / 1e6:.2f} km2")
    tris, park_tris = [], []

    def tri_into(g, dst):
        for gg in getattr(g, "geoms", [g]):
            if gg.geom_type != "Polygon" or gg.area < 50:
                continue
            for t in getattr(constrained_delaunay_triangles(gg.simplify(0.8)), "geoms", []):
                dst.append([[round(x, 2), round(y, 2)] for x, y in list(t.exterior.coords)[:3]])
    for g in land_polys:
        if g.area < 1.0e6:                          # the small islands: Liberty, Ellis, Governors (lawns and parkland)
            tri_into(g, park_tris)
            continue
        tri_into(g.difference(parks_u).buffer(0), tris)
        tri_into(g.intersection(parks_u).buffer(0), park_tris)
    rings = [[[round(x, 2), round(y, 2)] for x, y in list(g.simplify(0.8).exterior.coords)[:-1]] for g in land_polys]
    holes = [[[round(x, 2), round(y, 2)] for x, y in list(h.coords)[:-1]] for g in land_polys for h in g.simplify(0.8).interiors]
    C.save_json("data/harbor/harbor.json", {
        "district": district_id, "frame": [[round(x, 1), round(y, 1)] for x, y in list(frame.exterior.coords)[:-1]],
        "land_rings": rings, "land_holes": holes, "land_tris": tris, "park_tris": park_tris, "buildings": out, "piers": piers,
        "statue": {"xy": statue_xy, "facing_bearing_deg": 135.0},
        "nj_rings": [[[round(x, 2), round(y, 2)] for x, y in list(g.simplify(0.8).exterior.coords)[:-1]] for g in nj_land],
    })
    print("-> data/harbor/harbor.json:", len(rings), "land rings,", len(tris), "land triangles")

    # ---------------------------------------------------------------- streets (OSM): asphalt on the land, lines + names for the map
    WIDTH = {"motorway": 20, "trunk": 20, "primary": 16, "secondary": 13, "tertiary": 11, "residential": 9, "unclassified": 9,
             "living_street": 7, "pedestrian": 6, "motorway_link": 8, "trunk_link": 8, "primary_link": 8}
    road_tris, road_lines, road_labels = [], [], []
    rp = C.project_path("data/harbor/roads.json")
    if os.path.exists(rp):
        geoms = []
        for r in C.load_json("data/harbor/roads.json")["roads"]:
            ln = LineString([P(la, lo) for la, lo in r["pts"]])
            ln = ln.intersection(frame)
            if ln.is_empty:
                continue
            w = WIDTH.get(r["hw"], 8)
            geoms.append(ln.buffer(w / 2, cap_style="flat", join_style="round"))
            for part in getattr(ln, "geoms", [ln]):
                if part.geom_type != "LineString":
                    continue
                road_lines.append({"w": w, "n": r.get("name") or "", "pts": [[round(x, 1), round(y, 1)] for x, y in part.simplify(1.0).coords]})
                if r.get("name") and part.length > 120:                # a name every ~350 m along the street
                    major = r["hw"] in ("motorway", "trunk", "primary", "secondary")
                    k = 0.0
                    while k <= part.length:
                        t = min(part.length - 1, max(1, k + min(175.0, part.length / 2)))
                        a_, b_ = part.interpolate(max(0, t - 8)), part.interpolate(min(part.length, t + 8))
                        mid = part.interpolate(t)
                        road_labels.append({"text": r["name"], "x": round(mid.x, 1), "y": round(mid.y, 1), "kind": "road",
                                            "major": major, "angle": round(math.atan2(b_.y - a_.y, b_.x - a_.x), 3)})
                        k += 350.0
        roads_u = unary_union(geoms).intersection(land_u).buffer(0)
        for g in getattr(roads_u, "geoms", [roads_u]):
            if g.geom_type != "Polygon" or g.area < 20:
                continue
            for t in getattr(constrained_delaunay_triangles(g.simplify(0.5)), "geoms", []):
                road_tris.append([[round(x, 2), round(y, 2)] for x, y in list(t.exterior.coords)[:3]])
        # the same name within 250 m of itself once is enough (OSM splits streets into many short ways)
        kept = []
        for l in road_labels:
            if all(k["text"] != l["text"] or math.hypot(k["x"] - l["x"], k["y"] - l["y"]) > 250 for k in kept):
                kept.append(l)
        road_labels = kept
        H_ = C.load_json("data/harbor/harbor.json")
        H_["road_tris"], H_["road_lines"], H_["road_labels"] = road_tris, road_lines, road_labels
        C.save_json("data/harbor/harbor.json", H_)
        print(f"streets: {len(road_lines)} lines, {len(road_tris)} asphalt triangles, {len(road_labels)} named")

    # ---------------------------------------------------------------- compact collision data for the viewer (boats, planes)
    def flat(pts, nd=1):
        return [round(v, nd) for xy in pts for v in xy]
    cb = []
    for o in out:
        r = Polygon(o["outline"]).minimum_rotated_rectangle
        cb.append([round(o["h"], 1)] + flat(list(r.exterior.coords)[:-1]))
    C.save_json("data/harbor/collide.json", {
        "note": "harbour obstacles, local metres: frame (district edge), land rings, piers, buildings [h, x1,y1..x4,y4]",
        "frame": flat(list(frame.exterior.coords)[:-1]),
        "land": [flat(list(g.simplify(1.5).exterior.coords)[:-1]) for g in land_polys],
        "piers": [flat(r) for r in piers], "buildings": cb, "statue": statue_xy})

    # ---------------------------------------------------------------- harbour landmarks for search / Go
    marks = [
        ("liberty", "Statue of Liberty", "Liberty Island · 93 m from the ground to the torch", "statue liberty island lady torch", statue_xy, 130, (260, -260, 70)),
        ("ellis", "Ellis Island", "Immigration museum · 12 million arrivals, 1892-1954", "ellis island immigration museum", P(40.6995, -74.0396), 40, (220, 160, 60)),
        ("governors", "Governors Island", "Park island · Fort Jay and Castle Williams", "governors island park", P(40.6895, -74.0168), 20, (-420, -260, 120)),
        ("battery", "The Battery", "Southern tip of Manhattan · ferries to the Statue", "battery park castle clinton ferry", P(40.7033, -74.0170), 10, (-300, -250, 60)),
        ("onewtc", "One World Trade Center", "541 m (1,776 ft) · the tallest building in the Western Hemisphere", "one world trade center wtc freedom tower 911 memorial", (387, -5512), 300, (-700, -600, 260)),
        ("exchange", "Exchange Place", "Jersey City waterfront · skyline view of Lower Manhattan", "jersey city exchange place new jersey", P(40.7163, -74.0329), 30, (420, -150, 70)),
        ("hoboken", "Hoboken waterfront", "Pier A Park · across from Midtown", "hoboken pier a new jersey", P(40.7375, -74.0265), 10, (400, -200, 60)),
        ("centralpark", "Central Park", "843 acres · 59th St to 110th St", "central park sheep meadow bethesda the pond gapstow", P(40.7680, -73.9755), 5, (-250, -350, 120)),
        ("pier25", "Pier 25", "Hudson River Park · Tribeca", "pier 25 tribeca hudson river park", P(40.7206, -74.0145), 5, (-250, -150, 50)),
    ]
    places = []
    for pid, name, sub, kw, (x, y), tz, (ox, oy, oz) in marks:
        places.append({"id": pid, "name": name, "sub": sub, "kind": "landmark", "keywords": kw, "x": round(x, 1), "y": round(y, 1),
                       "eye": [round(x + ox, 1), round(y + oy, 1), oz], "target": [round(x, 1), round(y, 1), tz]})
    C.save_json("data/harbor/places.json", {"district": district_id, "places": places})
    print("-> collide.json:", len(cb), "buildings,", len(piers), "piers; places.json:", len(places))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "harbor")

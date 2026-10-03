"""2D ground plan for a district (run with the project venv: ../../.venv/bin/python).

OSM centrelines + shoreline + piers -> data/<id>/ground.json with polygons in local metres:
  roads, plazas, sidewalk (land - roads - plazas), water, piers, ships, and NAV centrelines.
Roadway widths follow NYC curb-to-curb norms (avenue 100 ft ROW ~ 21 m roadway, street 60 ft ROW ~ 10.5 m).
"""
import json
import sys

from shapely.geometry import LineString, Polygon, box, mapping
from shapely.ops import linemerge, unary_union

import ts_common as C

# play area in local metres (x: east-ish across avenues, y: north-ish along avenues)
PLAY_AREA = {"times_square": (-1750.0, -720.0, 960.0, 740.0)}

WIDE_STREETS = {"West 34th Street", "West 42nd Street", "East 42nd Street", "West 57th Street", "East 57th Street"}
PLAZA_BUFFER_M = 12.5   # half width of Broadway bow-tie plazas
SIMPLIFY_M = 0.25


def road_width(tags):
    name, hw = tags.get("name", ""), tags.get("highway")
    if tags.get("tunnel") == "yes" or tags.get("bridge") == "yes" or tags.get("covered") == "yes":
        return None
    if tags.get("layer") and tags["layer"] not in ("0",):
        return None
    if hw == "pedestrian":
        return None
    if name == "Broadway":
        return 12.0
    if hw == "trunk":
        return 11.0
    if hw == "motorway":
        return 9.0
    if "Avenue" in name or "Americas" in name:
        return 21.0
    if name in WIDE_STREETS:
        return 18.0
    if hw in ("primary", "secondary", "tertiary", "residential", "unclassified", "living_street"):
        return 10.5
    return None


def ring(geom, P):
    return [P(p["lat"], p["lon"]) for p in geom]


TILE_M = 120.0


def tiled(g, area_box):
    """Cut a surface into TILE_M grid tiles: small polygons with few holes tessellate reliably in Blender
    (one giant road polygon with hundreds of holes does not) and tiles cull/stream better in the game."""
    x0, y0, x1, y1 = area_box
    parts = []
    y = y0
    while y < y1:
        x = x0
        while x < x1:
            piece = g.intersection(box(x, y, x + TILE_M, y + TILE_M))
            if not piece.is_empty:
                parts.extend(getattr(piece, "geoms", [piece]))
            x += TILE_M
        y += TILE_M
    return parts


def poly_out(g, area_box=None):
    """shapely (Multi)Polygon -> list of {exterior, holes} with rounded coords (tiled if area_box given)."""
    if g.is_empty:
        return []
    geoms = tiled(g, area_box) if area_box else getattr(g, "geoms", [g])
    out = []
    for p in geoms:
        if p.geom_type != "Polygon" or p.area < 1.0:
            continue
        p = p.simplify(SIMPLIFY_M)
        r = lambda cs: [[round(x, 3), round(y, 3)] for x, y in list(cs)[:-1]]
        out.append({"exterior": r(p.exterior.coords), "holes": [r(h.coords) for h in p.interiors if Polygon(h).area > 1]})
    return out


def build(district_id):
    d = C.load_district(district_id)
    P = C.district_projector(d)
    osm = C.load_json(f"data/{district_id}/osm.json")["elements"]
    area = box(*PLAY_AREA[district_id])

    roads, plazas, piers, ships, coast, nav = [], [], [], [], [], []
    for e in osm:
        t, g = e.get("tags", {}), e.get("geometry")
        if not g:
            continue
        pts = ring(g, P)
        closed = len(pts) > 3 and pts[0] == pts[-1]
        hw = t.get("highway")
        if t.get("natural") == "coastline":
            coast.append(LineString(pts))
        elif t.get("man_made") == "pier":
            piers.append(Polygon(pts).buffer(0) if closed else LineString(pts).buffer(6.0, cap_style="flat"))
        elif t.get("historic") == "ship" and closed:
            ships.append({"name": t.get("name"), "poly": Polygon(pts)})
        elif t.get("place") == "square" and closed and t.get("name") in ("Times Square", "Duffy Square"):
            plazas.append(Polygon(pts).buffer(0))
        elif hw == "pedestrian":
            if closed and t.get("area") == "yes":
                plazas.append(Polygon(pts).buffer(0))
            elif t.get("name") == "Broadway":
                plazas.append(LineString(pts).buffer(PLAZA_BUFFER_M, cap_style="flat"))
        elif hw:
            w = road_width(t)
            if w:
                line = LineString(pts)
                roads.append(line.buffer(w / 2, cap_style="flat", join_style="mitre", mitre_limit=3))
                if line.intersects(area):
                    nav.append({"name": t.get("name", ""), "highway": hw, "width": w,
                                "oneway": t.get("oneway") == "yes",
                                "points": [[round(x, 2), round(y, 2)] for x, y in line.intersection(area).coords]
                                if line.intersection(area).geom_type == "LineString" else
                                [[round(x, 2), round(y, 2)] for x, y in line.coords]})

    # land = play area east of the merged coastline (coastline extended north/south past the area)
    shore = linemerge(unary_union(coast))
    if shore.geom_type == "MultiLineString":
        shore = max(shore.geoms, key=lambda l: l.length)
    cs = list(shore.coords)
    if cs[0][1] > cs[-1][1]:
        cs = cs[::-1]
    x0, y0, x1, y1 = PLAY_AREA[district_id]
    cs = [(cs[0][0], y0 - 200)] + cs + [(cs[-1][0], y1 + 200)]
    west = Polygon(cs + [(x0 - 1000, y1 + 200), (x0 - 1000, y0 - 200)]).buffer(0)
    water = west.intersection(area)
    land = area.difference(west)

    road_u = unary_union(roads).intersection(land)
    plaza_u = unary_union(plazas).intersection(land)
    road_u = road_u.difference(plaza_u)
    sidewalk = land.difference(road_u).difference(plaza_u)
    pier_u = unary_union(piers).intersection(area).difference(land.buffer(-0.01))

    out = {
        "district": district_id, "play_area": PLAY_AREA[district_id], "tile_m": TILE_M,
        "roads": poly_out(road_u, area.bounds), "plazas": poly_out(plaza_u, area.bounds),
        "sidewalk": poly_out(sidewalk, area.bounds), "water": poly_out(water, area.bounds),
        "piers": poly_out(pier_u),
        "ships": [{"name": s["name"], **poly_out(s["poly"])[0]} for s in ships if poly_out(s["poly"])],
        "nav_roads": nav,
    }
    C.save_json(f"data/{district_id}/ground.json", out)
    stats = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    print(stats, "road area m2:", round(road_u.area), "plaza m2:", round(plaza_u.area), "water m2:", round(water.area))


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "times_square")

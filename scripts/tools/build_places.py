"""Bake the "Where to?" index for a district: export/<district>/places.json.

Every place gets a precomputed camera view (eye + target, Blender local metres) chosen so the camera stands
on open ground (street / plaza / water edge, not inside a building) with a clear line of sight to the place.
Kinds: landmark (curated), intersection (every avenue x street), building (named NYC buildings), ad (sellable
slots: so a business can "find my billboard"), transport (vehicle spawns).
"""
import math
import os
import sys

from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402

LANDMARKS = [  # id, name, subtitle, keywords
    ("tkts", "TKTS Red Steps", "Duffy Square · sit and look at One Times Square", "red stairs steps tkts duffy father"),
    ("1tsq", "One Times Square", "The New Year's Eve ball tower", "ball nye new year one times square 1475"),
    ("nasdaq", "Nasdaq Tower", "4 Times Square · curved screen", "nasdaq 4 times square conde nast drum"),
    ("750", "750 7th Ave", "Wraparound screens & 3D corner board", "750 seventh 3d box corner"),
    ("w49", "7th Ave & W 49th St corner", "Corner LED wrap", "49th corner"),
    ("paramount", "Paramount Building", "Clock tower & globe", "paramount clock globe 1501"),
    ("marquis", "Marriott Marquis screen", "100 m wraparound screen", "marriott marquis hotel"),
    ("1551", "1551 Broadway", "Screen tower over Duffy Square", "1551 american eagle"),
    ("astor", "One Astor Plaza", "1515 Broadway · Minskoff Theatre", "astor plaza minskoff lion king"),
    ("3tsq", "3 Times Square", "Rounded LED corner", "3 times square reuters"),
    ("1540", "1540 Broadway", "Bertelsmann building", "bertelsmann 1540"),
    ("intrepid", "USS Intrepid (planes)", "Pier 86 · take off from the deck", "intrepid carrier plane fly pier 86"),
    ("pier83", "Pier 83 (boats)", "Hudson River · sightseeing ferry", "pier 83 boat ship ferry circle line hudson"),
]
HERO_OBJ = {"tkts": "BLD_TS_TKTSDuffySquare", "1tsq": "BLD_TS_OneTimesSquare", "nasdaq": "BLD_TS_FourTimesSquare",
            "750": "BLD_TS_750SeventhAve", "w49": "BLD_TS_W49thCorner", "paramount": "BLD_TS_ParamountBuilding",
            "marquis": "BLD_TS_NewYorkMarriottMarquisHotel_1024727", "1551": "BLD_TS_1551Broadway",
            "astor": "BLD_TS_OneAstorPlaza", "3tsq": "BLD_TS_ThreeTimesSquare", "1540": "BLD_TS_1540Broadway"}
CURATED_VIEWS = {  # hand-picked shots that match the reference photos (eye, target)
    "tkts": ([-12.0, 96.0, 1.7], [-20.0, 130.0, 4.0]),
    "1tsq": ([-14.5, 137.5, 6.4], [16.0, -215.0, 40.0]),   # from the top of the red steps, cross off-centre
    "nasdaq": ([8.0, -128.0, 1.7], [60.0, -184.0, 30.0]),
    "750": ([-6.0, 302.0, 1.7], [24.0, 334.0, 16.0]),
    "w49": ([-1.0, 323.0, 1.7], [-24.0, 298.0, 9.0]),
    "paramount": ([26.0, -182.0, 1.7], [-37.0, -124.0, 84.0]),
    "marquis": ([2.0, 30.0, 1.7], [-34.0, 36.0, 20.0]),
    "1551": ([-6.0, 104.0, 1.7], [-58.0, 118.0, 28.0]),
    "3tsq": ([12.0, -262.0, 1.7], [-30.0, -215.0, 40.0]),
    "intrepid": ([-1430.0, -80.0, 40.0], [-1486.0, 23.0, 15.0]),
    "pier83": ([-1440.0, -260.0, 12.0], [-1494.0, -193.0, 0.0]),
}
AVE = {-1096: "11th Ave", -823: "10th Ave", -550: "9th Ave", -275: "8th Ave", 0: "7th Ave", 273: "6th Ave",
       584: "5th Ave", 739: "Madison Ave"}


def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


class Viewfinder:
    def __init__(self, district_id):
        self.blds = [(Polygon(b["outline"]), b["height_m"]) for b in C.load_json(f"data/{district_id}/buildings.json")["buildings"]]
        self.tree = STRtree([p for p, _ in self.blds])
        g = C.load_json(f"data/{district_id}/ground.json")
        self.water = [Polygon(w["exterior"]) for w in g["water"]]

    def solid(self, pt, z=1.7):
        for i in self.tree.query(pt):
            p, h = self.blds[i]
            if h > z and p.contains(pt):
                return True
        return False

    def clear(self, a, b, z_eye, z_tgt, target_poly=None):
        line = LineString([a, b])
        for i in self.tree.query(line):
            p, h = self.blds[i]
            if target_poly is not None and p.equals(target_poly):
                continue
            if not p.intersects(line):
                continue
            # height of the sight line where it crosses this building (conservative: lowest point)
            dmin = Point(a).distance(p.intersection(line))      # where the sight line enters this building
            t = dmin / max(1e-6, line.length)
            if z_eye + (z_tgt - z_eye) * t < h:
                return False
        return True

    def view(self, x, y, h, poly=None):
        """Find an eye position looking at (x, y) from open ground. Returns (eye, target)."""
        z_tgt = min(max(h * 0.45, 3.0), 70.0)
        best = None
        for dist in (max(35.0, h * 0.55), max(55.0, h * 0.8), 90.0, 140.0):
            for k in range(24):
                a = 2 * math.pi * k / 24
                ex, ey = x + dist * math.cos(a), y + dist * math.sin(a)
                ept = Point(ex, ey)
                if any(w.contains(ept) for w in self.water) or self.solid(ept):
                    continue
                z_eye = 1.7 if h < 40 else min(2.0 + h * 0.18, 45.0)
                if not self.clear((ex, ey), (x, y), z_eye, z_tgt, poly):
                    continue
                score = -dist + (8 if z_eye <= 2 else 0)
                if best is None or score > best[0]:
                    best = (score, [round(ex, 1), round(ey, 1), round(z_eye, 1)])
            if best:
                break
        eye = best[1] if best else [round(x + 60, 1), round(y - 60, 1), round(max(40.0, h * 0.6), 1)]
        return eye, [round(x, 1), round(y, 1), round(z_tgt, 1)]


def main(district_id="times_square"):
    d = C.load_district(district_id)
    vf = Viewfinder(district_id)
    props = {p["object"]: p for p in C.load_json(f"data/{district_id}/properties.json")["properties"]}
    bmap = {b["obj"]: b for b in C.load_json(f"data/{district_id}/buildings.json")["buildings"]}
    places = []

    for pid, name, sub, kw in LANDMARKS:
        if pid in CURATED_VIEWS:
            eye, tgt = CURATED_VIEWS[pid]
        else:
            p = props.get(HERO_OBJ.get(pid, ""))
            eye, tgt = vf.view(p["center"][0], p["center"][1], p["height_m"] or 30)
        places.append({"id": pid, "name": name, "sub": sub, "kind": "landmark", "keywords": kw,
                       "x": tgt[0], "y": tgt[1], "eye": eye, "target": tgt})

    grid = d["street_grid_local"]
    hx0, hy0, hx1, hy1 = d["tier_rects_local"]["mid"]
    for k, (y, w) in enumerate(grid["streets"]):
        st = f"W {ordinal(37 + k)} St"
        for ax, aw in grid["avenues"]:
            if ax not in AVE or not (hx0 - 50 <= ax <= hx1 + 50 and hy0 - 50 <= y <= hy1 + 50):
                continue
            eye = [ax + aw / 2 + 2.0, y - w / 2 - 12.0, 1.7]           # SE corner, looking north-west across
            places.append({"id": f"x_{ax}_{37 + k}", "name": f"{AVE[ax]} & {st}", "sub": "Intersection",
                           "kind": "intersection", "keywords": f"{st} {AVE[ax]} {37 + k} corner",
                           "x": ax, "y": y, "eye": eye, "target": [ax - 10.0, y + 30.0, 8.0]})

    for obj, p in props.items():
        if not p["display_name"] or any(pl.get("name") == p["display_name"] for pl in places):
            continue
        b = bmap.get(obj)
        poly = Polygon(b["outline"]) if b else None
        x, y = p["center"][:2]
        if not (d["tier_rects_local"]["play"][0] <= x <= d["tier_rects_local"]["play"][2]):
            continue
        eye, tgt = vf.view(x, y, p["height_m"] or 20, poly)
        places.append({"id": p["property_id"], "name": p["display_name"], "sub": p.get("address") or "Building",
                       "kind": "building", "keywords": obj, "x": round(x, 1), "y": round(y, 1), "eye": eye,
                       "target": tgt})

    for s in C.load_json(d["outputs"]["slots"])["slots"]:
        c, n = s["center"], s["normal"]
        dist = max(18.0, s["width_m"] * 1.3, s["height_m"] * 1.2)
        ex, ey = c[0] + n[0] * dist, c[1] + n[1] * dist
        ez = 1.7 if c[2] < 30 else min(c[2] * 0.6, 120)
        # wraps / curves go round corners (their centre is inside the building) and any eye that lands
        # inside a building is useless: find open ground with a clear line of sight instead
        if s["shape"] in ("wrap", "curved", "anamorphic") or vf.solid(Point(ex, ey)):
            (ex, ey, ez), _ = vf.view(c[0], c[1], max(20.0, c[2] * 1.6))
        places.append({"id": s["slot_id"], "name": f"Ad slot {s['slot_id']}",
                       "sub": f"{s['shape']} · {s['aspect']} · {s['width_m']}×{s['height_m']} m · {s['status']}",
                       "kind": "ad", "keywords": f"{s['building']} {s['building_name']} billboard screen ad",
                       "x": c[0], "y": c[1], "eye": [round(ex, 1), round(ey, 1), round(ez, 1)],
                       "target": [c[0], c[1], c[2]]})

    out = f"{d['outputs']['export_dir']}/places.json"
    C.save_json(out, {"district": district_id, "places": places})
    from collections import Counter
    print(f"{len(places)} places {dict(Counter(p['kind'] for p in places))} -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "times_square")

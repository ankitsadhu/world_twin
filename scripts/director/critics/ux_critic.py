"""Role 3: UX Critic: a first-time visitor spawns at Duffy Square. Can they find things, move, and stay?"""
import sys

import networkx as nx
from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

from common import Ctx, Report, dist2


def graph(lines, snap=4.0):
    g = nx.Graph()
    for line in lines:
        pts = [(round(p[0] / snap) * snap, round(p[1] / snap) * snap) for p in line]
        for a, b in zip(pts, pts[1:]):
            if a != b:
                g.add_edge(a, b, weight=dist2(a, b))
    return g


def nearest(g, xy):
    return min(g.nodes, key=lambda n: dist2(n, xy))


def run(ctx: Ctx) -> Report:
    r = Report("UX")
    nav, T, d = ctx.nav, ctx.truth, ctx.district
    spawn = nav["spawns"].get(d["spawns"]["player"])
    hx0, hy0, hx1, hy1 = d["tier_rects_local"]["hero"]
    heroes = T.get("heroes", {})

    # ---------------------------------------------------------------- navigation (30)
    pts = 30.0
    g = graph(nav["paths"].get("NAV_roads", {}).get("lines", []) +
              nav["paths"].get("NAV_bike_BroadwayPlaza", {}).get("lines", []))
    if not spawn or not g.number_of_nodes():
        r.flag("ERROR", "NO_NAV", "Player spawn or nav graph missing")
        pts = 0
    else:
        comps = sorted(nx.connected_components(g), key=len, reverse=True)
        main = g.subgraph(comps[0])
        islands = [c for c in comps[1:] if len(c) >= 8]
        if islands:
            r.flag("WARN", "NAV_FRAGMENTED", f"Nav graph has {len(comps)} pieces; {len(islands)} islands of >= 8 nodes "
                   f"(e.g. plaza outlines) are not joined to the street network", "NAV_bike_BroadwayPlaza",
                   "Link each plaza ring to the nearest road node in build_nav.py", auto=True)
            pts -= min(6, len(islands) * 0.5)
        s0 = nearest(main, spawn["position"])
        dist = nx.single_source_dijkstra_path_length(main, s0, weight="weight")
        for name, h in heroes.items():
            n = nearest(main, h["center"])
            w = dist.get(n)
            if w is None:
                r.flag("ERROR", "UNREACHABLE", f"{name} not reachable from spawn", name)
                pts -= 4
            elif dist2(n, h["center"]) > 80:
                r.flag("WARN", "HERO_OFF_NETWORK", f"{name} is {dist2(n, h['center']):.0f} m from the street network", name)
                pts -= 1
            elif w > 600:
                r.flag("WARN", "FAR_HERO", f"{name} is {w:.0f} m walk from spawn", name)
                pts -= 1
        # dead ends inside the hero rect that are not at the play-area edge (OSM service stubs are common)
        dead = [n for n in g.nodes if g.degree(n) == 1 and hx0 + 20 < n[0] < hx1 - 20 and hy0 + 20 < n[1] < hy1 - 20]
        for n in dead[:10]:
            r.flag("WARN", "DEAD_END", f"Nav dead end at {n}", f"{n}", "Connect to nearest path (build_nav.py)", auto=True)
        pts -= min(8, len(dead) * 0.5)
        r.extra["dead_ends"] = len(dead)
    zones = d.get("vehicle_zones", {})
    for k, need in (("car", "NAV_roads"), ("ship", "NAV_water_Hudson")):
        if need not in nav["paths"]:
            r.flag("ERROR", "ZONE_MISSING", f"{k} zone {need} missing")
            pts -= 3
    if "NAV_runway_Intrepid" not in nav["paths"] or nav["paths"]["NAV_runway_Intrepid"].get("ceiling_m", 0) < 600:
        r.flag("WARN", "RUNWAY", "Plane runway missing or ceiling < 600 m")
        pts -= 2
    if "plane" not in zones:
        r.flag("INFO", "ZONES", "vehicle_zones has no plane entry")
    r.section("Navigation", pts, 30, f"{g.number_of_nodes()} nav nodes")

    # ---------------------------------------------------------------- discoverability (30)
    pts = 30.0
    fps = [(Polygon(b["outline"]), b) for b in ctx.buildings if b["height_m"] > 6]
    tree = STRtree([p for p, _ in fps])
    visible = 0
    if spawn:
        sp = spawn["position"][:2]
        for name, h in heroes.items():
            line = LineString([sp, h["center"]])
            target = Point(h["center"])
            blockers = [fps[i][1]["obj"] for i in tree.query(line)
                        if fps[i][0].intersects(line) and not fps[i][0].buffer(2).contains(target)]
            if blockers:
                r.flag("INFO", "SIGHTLINE", f"{name} hidden from spawn by {blockers[0]} (+{len(blockers) - 1})", name,
                       "Waypoint/minimap star helps; landmarks above the blocker still read")
            else:
                visible += 1
        if visible < len(heroes) * 0.5:
            pts -= 6
    named = [p for p in ctx.properties if p["display_name"] and hx0 <= p["center"][0] <= hx1 and hy0 <= p["center"][1] <= hy1]
    if len(named) < T.get("named_destinations_min", 15):
        r.flag("WARN", "FEW_DESTINATIONS", f"Only {len(named)} named destinations in hero zone")
        pts -= 5
    # POI density: sample walkable points, distance to nearest named building
    walk = [Polygon(p["exterior"]) for p in ctx.ground.get("plazas", []) + ctx.ground.get("sidewalk", [])]
    named_xy = [p["center"][:2] for p in named]
    far_pts, n_s = 0, 0
    for i in range(24):
        for j in range(30):
            x, y = hx0 + (i + 0.5) * (hx1 - hx0) / 24, hy0 + (j + 0.5) * (hy1 - hy0) / 30
            if not any(w.contains(Point(x, y)) for w in walk):
                continue
            n_s += 1
            if named_xy and min(dist2((x, y), q) for q in named_xy) > T.get("poi_max_dist_m", 120):
                far_pts += 1
    if n_s and far_pts / n_s > 0.1:
        r.flag("WARN", "POI_SPARSE", f"{far_pts}/{n_s} walkable samples are > {T.get('poi_max_dist_m', 120)} m from a named place")
        pts -= 4
    r.section("Discoverability", pts, 30, f"{visible}/{len(heroes)} heroes visible from spawn, {len(named)} named places")
    r.extra["named_destinations"] = len(named)

    # ---------------------------------------------------------------- engagement (25)
    pts = 25.0
    if g.number_of_nodes():
        bc = nx.betweenness_centrality(g, k=min(300, g.number_of_nodes()), weight="weight", seed=1)
        top = [n for n, _ in sorted(bc.items(), key=lambda kv: -kv[1]) if hx0 <= n[0] <= hx1 and hy0 <= n[1] <= hy1][:5]
        prem = [s["center"] for s in ctx.slots if s["tier"] in ("hero", "premium")]
        for n in top:
            if not any(dist2(n, q) < 30 for q in prem):
                r.flag("INFO", "CHOKEPOINT_NO_SLOT", f"Social chokepoint {n} has no premium slot within 30 m",
                       f"{n}", "-> Business critic")
                pts -= 1
    scene = ctx.scene or {}
    if scene and scene.get("prop_counts", {}).get("Taxi", 0) == 0:
        r.flag("WARN", "EMPTY_STREETS", "No taxi instances")
        pts -= 5
    r.section("Engagement", pts, 25, "chokepoints, vehicles")

    # ---------------------------------------------------------------- atmosphere / LOD (15)
    pts = 15.0
    emissive = sum(1 for s in ctx.slots)  # every slot uses the LED template (TOD-driven) by construction
    if scene and scene.get("tod_wired_materials", 0) < emissive * 0.4:
        r.flag("WARN", "NIGHT_DEAD", "Few TOD-wired materials relative to slots: night scene may feel dead")
        pts -= 5
    mx0, my0, mx1, my1 = d["tier_rects_local"]["mid"]
    mids = [b["centroid"] for b in ctx.buildings if b["tier"] == "mid"]
    gap = T.get("lod_mid_gap_m", 150)
    holes = 0
    for i in range(int((mx1 - mx0) // 50)):
        for j in range(int((my1 - my0) // 50)):
            c = (mx0 + (i + 0.5) * 50, my0 + (j + 0.5) * 50)
            if hx0 <= c[0] <= hx1 and hy0 <= c[1] <= hy1:
                continue
            if mids and min(dist2(c, m) for m in mids) > gap / 2 + 25:
                holes += 1
    if holes:
        r.flag("INFO", "LOD_GAP", f"{holes} 50 m cells in the mid ring > {gap} m from mid buildings (possible pop-in)")
        pts -= min(5, holes * 0.5)
    r.section("Atmosphere", pts, 15, f"{scene.get('tod_wired_materials', '?')} TOD materials")
    return r


if __name__ == "__main__":
    rep = run(Ctx(sys.argv[1] if len(sys.argv) > 1 else "times_square"))
    print(rep.score, rep.sections)

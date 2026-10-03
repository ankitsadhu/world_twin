"""Role 2: Business Critic: would a real brand pay for this slot? Scores every slot + finds missing inventory.

composite = .27 visibility + .22 pedestrian_flow + .14 neighbor_quality + .08 sign_height
          + .10 photo_potential + .05 brand_suitability + .14 fame          (each 0-100)
fame: iconic screens (hand-built heroes such as One Times Square, the Nasdaq drum, the Marquis wall) command a
premium the geometry cannot see: they are in the news, on postcards and in every tourist's photo.
"""
import math
import sys

import networkx as nx
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from common import Ctx, Report, clamp, dist2

TIER_WEIGHT = {"hero": 1.0, "premium": 0.85, "standard": 0.65}
ASPECT_PHOTO = {"9x16": 1.0, "1x1": 0.9, "3x4": 0.85, "16x9": 0.7, "2x1": 0.5, "4x1": 0.4, "8x1": 0.3}
ASPECT_FIT = {  # aspect -> (best categories, score)
    "9x16": ("Fashion, Entertainment, Beauty", 95), "3x4": ("Fashion, Retail", 85), "1x1": ("Tech, Social, Food", 85),
    "16x9": ("Entertainment, Auto, Tech", 90), "2x1": ("Retail, Travel", 75), "4x1": ("Finance, Telecom, Retail", 70),
    "8x1": ("Wayfinding, F&B, News ticker", 60)}
DAILY_VISITORS = 330_000      # Times Square Alliance average daily pedestrian count (pre-2020 ~ 330k-380k)
PRICE_BANDS = [(90, "Landmark"), (75, "Premium"), (55, "Standard"), (0, "Value")]
VIS_REF = 0.5564        # fixed visibility reference (calibrated 2026-10-03, 110 visible screens): prices stay put when inventory changes


def facets(s):
    """[(x, y, z, nx, ny, nz, area)] for the screen's faces; older exports without facets fall back to one."""
    if s.get("facets"):
        return s["facets"]
    c, n = s["center"], s["normal"]
    return [[*c, *n, s["width_m"] * s["height_m"]]]


def anchor(s):
    """Where the screen actually is for distance questions: its biggest face (a wrap's centre is inside the building)."""
    f = max(facets(s), key=lambda f: f[6])
    return [f[0], f[1], f[2]]


def plaza_area(ctx):
    """All pedestrian plaza surfaces as one shape (foot traffic lives on surfaces, not on 3 points)."""
    if not hasattr(ctx, "_plaza_u"):
        ctx._plaza_u = unary_union([Polygon(p["exterior"]) for p in ctx.ground.get("plazas", [])])
    return ctx._plaza_u


def front_of(s, metres=10.0):
    """A point on the street in front of the screen's main face."""
    f = max(facets(s), key=lambda f: f[6])
    return (f[0] + f[3] * metres, f[1] + f[4] * metres)


def area_of(s):
    return s["width_m"] * s["height_m"]


def band(c):
    return next(name for lo, name in PRICE_BANDS if c >= lo)


def road_graph(ctx):
    g = nx.Graph()
    for line in ctx.nav["paths"].get("NAV_roads", {}).get("lines", []):
        pts = [(round(p[0] / 4) * 4, round(p[1] / 4) * 4) for p in line]
        for a, b in zip(pts, pts[1:]):
            if a != b:
                g.add_edge(a, b, weight=dist2(a, b))
    return g


def run(ctx: Ctx) -> Report:
    r = Report("Business")
    hot = {k: v for k, v in ctx.truth.get("hotspots", {}).items() if not k.startswith("_")}
    plazas = list(ctx.truth.get("plazas", {}).values()) + list(hot.values())
    landmarks = [h["center"] for h in ctx.truth.get("heroes", {}).values()] + plazas
    slots = ctx.slots
    if not slots:
        r.flag("ERROR", "NO_SLOTS", "slots.json empty: run export_district.py")
        r.section("Inventory", 0, 100)
        return r

    # raw visibility: area * cos(angle to plaza) / d^2, summed over plazas (+ near-field from the street)
    raw = []
    for s in slots:
        v = 0.0
        for fx, fy, fz, ux, uy, uz, area in facets(s):     # every face of the screen, real area and direction
            for p in plazas:
                dx, dy, dz = p[0] - fx, p[1] - fy, 1.7 - fz
                d = max(8.0, math.sqrt(dx * dx + dy * dy + dz * dz))
                v += area * max(0.0, (ux * dx + uy * dy + uz * dz) / d) / (d * d)
        raw.append(v * TIER_WEIGHT.get(s["tier"], 0.7))
    # FIXED reference (calibrated 2026-10-03 on the 110 visible screens), so adding or removing a screen never moves the
    # others' prices. The old rank-based reference let one hidden screen inflate the whole catalogue.
    ctx.vis_calibration = sorted(raw)[min(len(raw) - 1, int(len(raw) * 0.99))] or 1.0   # reported, not used
    ref = VIS_REF
    premium_pos = [anchor(s) for s in slots if s["tier"] in ("hero", "premium")]

    # iconic = on a hand-built hero (hero_overrides) or a curated landmark in the truth file
    famous = set(ctx.district.get("hero_overrides", {}).values()) | set(ctx.truth.get("heroes", {})) | \
        {"BLD_TS_MarquisScreen", "BLD_TS_NewYorkMarriottMarquisHotel_1024727"}
    cards = []
    for s, rv in zip(slots, raw):
        c = anchor(s)
        vis = clamp(100 * math.sqrt(rv / ref))      # diminishing returns: twice the size is not twice the value
        # foot traffic: distance from the street in front of the screen to the nearest plaza SURFACE / hotspot
        dmin = min(plaza_area(ctx).distance(Point(front_of(s))), min(dist2(front_of(s), p) for p in plazas))
        flow = clamp(100 * math.exp(-dmin / 160))
        neigh = clamp(100 * min(1.0, sum(1 for q in premium_pos if 0 < dist2(c, q) < 80) / 12))
        z = c[2]
        if s["kind"] == "rooftop" or z > 60:
            # skyline signs: judged by size, not street-level framing (seen from across Midtown)
            height = clamp(55 + 45 * min(1.0, area_of(s) / 250))
        else:
            height = clamp(100 * math.exp(-((z - 16) ** 2) / (2 * 10 ** 2)))
        # photo value: aspect matters for normal boards, but a giant screen fills any wide shot whatever its ratio
        bonus = max(ASPECT_PHOTO.get(s["aspect"], 0.5), min(1.0, sum(f[6] for f in facets(s)) / 1200))
        near = min(min(dist2(c, lm) for lm in landmarks), plaza_area(ctx).distance(Point(front_of(s))))
        photo = clamp(100 * bonus / (1 + near / 120))
        cats, suit = ASPECT_FIT.get(s["aspect"], ("General", 60))
        fame = 100 if s["building"] in famous else 0
        comp = round(.27 * vis + .22 * flow + .14 * neigh + .08 * height + .10 * photo + .05 * suit + .14 * fame)
        card = {"slot_id": s["slot_id"], "building": s["building"], "aspect": s["aspect"], "shape": s["shape"],
                "size": f"{s['width_m']} x {s['height_m']} m", "z_m": round(z, 1),
                "visibility": round(vis), "pedestrian_flow": round(flow), "neighbor_quality": round(neigh),
                "sign_height": round(height), "photo_potential": round(photo), "brand_suitability": suit, "fame": fame,
                "composite": comp, "band": band(comp), "best_categories": cats,
                "est_daily_impressions": int(DAILY_VISITORS * 0.6 * vis / 100 * flow / 100)}
        cards.append(card)
        # per-slot issues
        if s["aspect"] == "16x9" and z < 6:
            r.flag("WARN", "ASPECT_LOW", f"{s['slot_id']}: 16x9 screen at {z:.1f} m is mostly hidden by crowds", s["slot_id"],
                   "Raise to >= 6 m or change to 4x1 band")
        if s["aspect"] == "9x16" and s["height_m"] < 6:
            r.flag("INFO", "ASPECT_SMALL", f"{s['slot_id']}: 9x16 slot only {s['height_m']} m tall", s["slot_id"])
        if s["tier"] == "hero" and comp < 55:
            r.flag("WARN", "TIER_MISMATCH", f"{s['slot_id']} ({s['building']}) tagged hero but scores {comp} "
                   f"({band(comp)})", s["slot_id"],
                   "Re-tier to standard or reposition toward a plaza")
    cards.sort(key=lambda c: -c["composite"])

    # occlusion pairs: near-coincident slots facing the same way (one hides the other)
    for i, a in enumerate(slots):
        for b in slots[i + 1:]:
            if dist2(a["center"], b["center"]) < 3 and abs(a["center"][2] - b["center"][2]) < 3:
                dot = sum(x * y for x, y in zip(a["normal"], b["normal"]))
                if dot > 0.7:
                    r.flag("WARN", "OCCLUSION_PAIR", f"{a['slot_id']} and {b['slot_id']} overlap", a["slot_id"],
                           "Remove or move the lower-scoring slot")

    # gap analysis: busiest road-graph nodes (betweenness) in the hero rect with no premium+ slot within 40 m
    g = road_graph(ctx)
    hx0, hy0, hx1, hy1 = ctx.district["tier_rects_local"]["hero"]
    gaps = []
    if g.number_of_nodes():
        bc = nx.betweenness_centrality(g, k=min(300, g.number_of_nodes()), weight="weight", seed=1)
        top = sorted(((v, n) for n, v in bc.items() if hx0 <= n[0] <= hx1 and hy0 <= n[1] <= hy1), reverse=True)
        seen = []
        for v, n in top:
            if any(dist2(n, q) < 60 for q in seen):
                continue
            seen.append(n)
            if not any(dist2(n, q) < 40 for q in premium_pos):
                gaps.append({"node": n, "betweenness": round(v, 3)})
                r.flag("WARN", "INVENTORY_GAP", f"Busy junction {n} (betweenness {v:.2f}) has no premium slot within 40 m",
                       f"{n}", "Add a 9x16 or 16x9 slot on the nearest facade facing this junction")
            if len(seen) >= 8:
                break

    bands = {}
    for c in cards:
        bands[c["band"]] = bands.get(c["band"], 0) + 1
    unsold = sum(1 for s in slots if s["status"] == "available")
    r.flag("INFO", "UNSOLD", f"{unsold}/{len(slots)} slots available (pre-launch: expected)")
    avg = sum(c["composite"] for c in cards) / len(cards)
    r.section("Inventory quality", avg, 100, f"avg composite {avg:.0f}; bands {bands}")
    r.extra = {"cards": cards, "bands": bands, "gaps": gaps, "top10": [c["slot_id"] for c in cards[:10]]}
    return r


if __name__ == "__main__":
    rep = run(Ctx(sys.argv[1] if len(sys.argv) > 1 else "times_square"))
    print(rep.score, rep.extra["bands"], rep.extra["top10"])

"""Bake the advertiser-facing sales data for every slot: export/<district>/slot_sales.json.

Turns engineering records (slot ids, BLD_ names, shapes) into what a media buyer reads: a plain title,
size, what the screen faces, estimated daily audience (Business critic), indicative price, artwork spec,
and a camera view that frames the screen. Prices are ESTIMATES from a CPM model, labelled as such.
"""
import math
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "director", "critics"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import business_critic  # noqa: E402
import ts_common as C  # noqa: E402
from common import Ctx  # noqa: E402

KIND = {"curved": "Curved screen", "wrap": "Wraparound screen", "anamorphic": "Corner 3D screen"}
CPM = {"Landmark": 28.0, "Premium": 16.0, "Standard": 9.0, "Value": 4.5}   # USD per 1000 impressions (indicative)
# price per 1000 views rises smoothly with the score (band labels stay, but no cliff at a band edge: a screen near a
# boundary can't halve or double in price because a neighbour was added or removed)
CPM_CURVE = [(0, 4.0), (55, 9.0), (75, 16.0), (90, 28.0), (100, 34.0)]


def cpm_for(score):
    for (a, pa), (b, pb) in zip(CPM_CURVE, CPM_CURVE[1:]):
        if score <= b:
            return pa + (pb - pa) * max(0.0, score - a) / (b - a)
    return CPM_CURVE[-1][1]
ART_PX = {"16x9": (3840, 2160), "9x16": (2160, 3840), "1x1": (2160, 2160), "4x1": (3840, 960), "2x1": (3840, 1920),
          "3x4": (1620, 2160), "8x1": (3840, 480)}


def nearest(places, x, y, kinds):
    best, bd = None, 1e9
    for p in places:
        if p["kind"] in kinds:
            d = math.hypot(p["x"] - x, p["y"] - y)
            if d < bd:
                best, bd = p, d
    return best, bd


def main(district_id="times_square"):
    ctx = Ctx(district_id)
    d = ctx.district
    rep = business_critic.run(ctx)
    cards = {c["slot_id"]: c for c in rep.extra["cards"]}
    places = C.load_json(f"{d['outputs']['export_dir']}/places.json")["places"]
    ad_views = {p["id"]: p for p in places if p["kind"] == "ad"}
    named = {p["object"]: p for p in ctx.properties}
    plazas = ctx.truth.get("plazas", {})
    out = []
    for s in ctx.slots:
        big = max(business_critic.facets(s), key=lambda f: f[6])     # the main face decides what it "faces"
        c, n = big[:3], big[3:6]
        card = cards[s["slot_id"]]
        b = named.get(s["building"], {})
        bname = b.get("display_name") or ""
        if s["kind"] == "rooftop":
            kind = "Rooftop sign"
        elif s["kind"] == "storefront":
            kind = "Storefront sign"
        elif s["kind"].startswith("vehicle"):
            kind = "Taxi screen"
        else:
            kind = KIND.get(s["shape"], "Billboard")
        # what it faces: a plaza in front of it, else the nearest intersection out along its normal
        if s["shape"] in ("wrap", "curved", "anamorphic"):
            fx, fy = c[0] + n[0] * 12, c[1] + n[1] * 12
        else:
            fx, fy = c[0] + n[0] * 30, c[1] + n[1] * 30
        faces = None
        on_plaza = business_critic.plaza_area(ctx).distance(business_critic.Point(fx, fy)) < 15
        for name, (px, py) in sorted(plazas.items(), key=lambda kv: math.hypot(kv[1][0] - fx, kv[1][1] - fy)):
            if on_plaza or math.hypot(px - fx, py - fy) < 70:
                faces = {"DuffySquare_TKTS": "Duffy Square & the red steps", "BroadwayPlaza_44_45": "the Broadway plaza",
                         "Bowtie_42_43": "the 42nd St crossroads"}.get(name)
                break
        if not faces:
            x, _ = nearest(places, fx, fy, ("intersection",))
            faces = x["name"] if x else "the street"
        where, _ = nearest(places, c[0], c[1], ("intersection",))
        title = f"{kind} · {bname}" if bname else f"{kind} at {where['name']}" if where else kind
        monthly = card["est_daily_impressions"] * 30 / 1000 * cpm_for(card["composite"])
        w, h = ART_PX.get(s["aspect"], (3840, 2160))
        view = ad_views.get(s["slot_id"])
        out.append({
            "slot_id": s["slot_id"], "title": title, "kind": kind, "building": bname,
            "size": f"{round(s['width_m'], 1):g} × {round(s['height_m'], 1):g} m", "faces": faces, "height_above_street_m": round(c[2]),
            "daily_audience": card["est_daily_impressions"], "band": card["band"], "score": card["composite"],
            "price_month_usd": int(round(monthly, -2)), "price_is_estimate": True,
            "best_for": card["best_categories"], "status": s["status"],
            "artwork": {"aspect": s["aspect"].replace("x", ":"), "px": [w, h], "formats": ["PNG", "JPG", "MP4 (≤15 s)"]},
            "view": {"eye": view["eye"], "target": view["target"]} if view else None,
            "position": c,
        })
    # moving slots (the Hudson banner plane): defined in config/mobile_slots.json, priced on the same curve
    mobile = C.load_json("config/mobile_slots.json").get(district_id, []) if os.path.exists(os.path.join(ROOT, "config", "mobile_slots.json")) else []
    for m in mobile:
        w, h = ART_PX.get(m["aspect"], (3840, 960))
        out.append({k: v for k, v in m.items() if not k.startswith("_") and k != "aspect"} | {
            "price_month_usd": int(round(m["daily_audience"] * 30 / 1000 * cpm_for(m["score"]), -2)), "price_is_estimate": True,
            "status": m.get("status", "available"),
            "artwork": {"aspect": m["aspect"].replace("x", ":"), "px": [w, h], "formats": ["PNG", "JPG"]}})
    out.sort(key=lambda r: -r["score"])
    C.save_json(f"{d['outputs']['export_dir']}/slot_sales.json", {
        "district": district_id, "currency": "USD", "pricing_note":
        "Indicative monthly price from estimated audience x CPM band; final pricing set by sales.", "slots": out})
    print(f"{len(out)} slots -> slot_sales.json; top: {[(o['title'], o['price_month_usd']) for o in out[:3]]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "times_square")

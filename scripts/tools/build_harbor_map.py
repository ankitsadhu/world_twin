"""Bake the harbour's map layer (same look as Times Square's map.png, at lower resolution: it covers ~9 x 11 km).

  .venv/bin/python scripts/tools/build_harbor_map.py   -> export/harbor/map.webp + export/harbor/map.json

The game draws this layer first and Times Square's detailed map on top of it, in the full map and the minimap.
Labels / markers are drawn by the game at runtime (upright when the minimap rotates).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "blender"))
import ts_common as C  # noqa: E402

PX = 0.5                                    # pixels per metre (a street is 4-5 px; light enough for phones)
COL = {"water": (28, 58, 92), "land": (46, 50, 56), "park": (44, 72, 48), "pier": (88, 84, 78), "outline": (34, 37, 42),
       "bld_lo": (58, 62, 70), "bld_hi": (92, 98, 112)}


def main():
    H = C.load_json("data/harbor/harbor.json")
    P = C.district_projector(C.load_district("harbor"))
    fr = H["frame"]
    x0, x1 = min(p[0] for p in fr), max(p[0] for p in fr)
    y0, y1 = min(p[1] for p in fr), max(p[1] for p in fr)
    W, Hh = int((x1 - x0) * PX), int((y1 - y0) * PX)
    T = lambda p: ((p[0] - x0) * PX, (y1 - p[1]) * PX)
    img = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))               # outside the data: transparent (the region map shows)
    dr = ImageDraw.Draw(img)
    dr.polygon([T(q) for q in fr], fill=COL["water"])
    for r in H["land_rings"]:
        dr.polygon([T(q) for q in r], fill=COL["land"])
    for r in H["land_holes"]:
        dr.polygon([T(q) for q in r], fill=COL["water"])
    for t in H.get("park_tris", []):
        dr.polygon([T(q) for q in t], fill=COL["park"])
    for r in H["piers"]:
        dr.polygon([T(q) for q in r], fill=COL["pier"])
    for key, col, extra in (("sidewalk", (70, 74, 80), 4), ("road", (104, 108, 116), 0)):     # streets, Times Square's style
        for ln in H.get("road_lines", []):
            pts = [T(q) for q in ln["pts"]]
            if len(pts) > 1:
                dr.line(pts, fill=col, width=max(1, int((ln["w"] + extra) * PX)), joint="curve")
    for b in sorted(H["buildings"], key=lambda b: b["h"]):      # taller = lighter, drawn last
        k = min(1.0, b["h"] / 160.0)
        col = tuple(int(COL["bld_lo"][i] + (COL["bld_hi"][i] - COL["bld_lo"][i]) * k) for i in range(3))
        dr.polygon([T(q) for q in b["outline"]], fill=col, outline=COL["outline"] if b["h"] > 40 else None)
    a = img.getchannel("A")                                     # smooth the colours, keep the frame's edge crisp
    img = img.convert("RGB").filter(ImageFilter.SMOOTH); img.putalpha(a)
    out = C.project_path("export/harbor")
    img.save(os.path.join(out, "map.webp"), "WEBP", quality=82, method=5)

    def L(lat, lon):
        x, y = P(lat, lon)
        return round(x, 1), round(y, 1)
    labels = []
    for text, (lat, lon), kind in [
        ("Hudson River", (40.725, -74.0205), "water"), ("Upper New York Bay", (40.6935, -74.028), "area_water"),
        ("East River", (40.7035, -73.9935), "area_water"),
        ("Jersey City", (40.7215, -74.0505), "area"), ("Hoboken", (40.7445, -74.0325), "area"),
        ("Liberty State Park", (40.7035, -74.056), "area"), ("Lower Manhattan", (40.7105, -74.0085), "area"),
        ("Battery Park City", (40.7115, -74.0165), "area"), ("Tribeca", (40.7185, -74.0085), "area"),
        ("West Village", (40.7345, -74.0055), "area"), ("Chelsea", (40.7465, -74.0005), "area"),
        ("Brooklyn", (40.6955, -73.9915), "area"), ("Liberty Island", (40.6905, -74.0458), "island"),
        ("Ellis Island", (40.6985, -74.0425), "island"), ("Governors Island", (40.6875, -74.0185), "island"),
        ("Central Park", (40.7735, -73.9710), "island"), ("Upper West Side", (40.7810, -73.9800), "area"),
        ("Upper East Side", (40.7700, -73.9570), "area"), ("Midtown East", (40.7545, -73.9695), "area"),
        ("Murray Hill", (40.7480, -73.9780), "area"), ("Kips Bay", (40.7405, -73.9790), "area"),
        ("Long Island City", (40.7445, -73.9505), "area"), ("Roosevelt Island", (40.7600, -73.9505), "island"),
        ("Weehawken", (40.7690, -74.0200), "area"), ("Lincoln Square", (40.7745, -73.9845), "area"),
    ]:
        x, y = L(lat, lon)
        ex = C.load_district("harbor")["exclude_local_rect"]
        if ex[0] < x < ex[2] and ex[1] < y < ex[3]:             # inside Times Square's own map
            continue
        labels.append({"text": text, "x": x, "y": y, "kind": kind})
    labels += H.get("road_labels", [])                          # street names (West St, Broadway, Canal St...)
    places = {p["id"]: p for p in C.load_json("data/harbor/places.json")["places"]}
    markers = [{"id": pid, "label": places[pid]["name"], "x": places[pid]["x"], "y": places[pid]["y"], "icon": "star"}
               for pid in ("liberty", "ellis", "onewtc", "battery", "governors", "exchange", "centralpark") if pid in places]
    C.save_json("export/harbor/map.json", {"district": "harbor", "bounds": [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
                                           "px_per_m": PX, "size": [W, Hh], "labels": labels, "markers": markers})
    # named streets, for "Near West St & Chambers St" on a dropped pin (the map image has no names to look up)
    names, lines = [], []
    for ln in H.get("road_lines", []):
        if not ln.get("n"):
            continue
        if ln["n"] not in names:
            names.append(ln["n"])
        pts = [round(v) for q in ln["pts"] for v in q]
        lines.append([names.index(ln["n"])] + pts)
    C.save_json("export/harbor/streets.json", {"names": names, "lines": lines})
    print(f"streets.json: {len(names)} names, {len(lines)} lines ({os.path.getsize(C.project_path('export/harbor/streets.json')) // 1024} KB)")
    print(f"map.webp {W}x{Hh} ({os.path.getsize(os.path.join(out, 'map.webp')) // 1024} KB), {len(labels)} labels, {len(markers)} markers")


if __name__ == "__main__":
    main()

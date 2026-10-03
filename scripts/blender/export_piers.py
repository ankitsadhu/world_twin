"""Bake the exact pier deck outlines (TER_TS_Piers) into data/<district>/piers.json, for boats: bumping, tying up
alongside, stepping ashore.

  blender -b blender/districts/times_square/times_square.blend -P scripts/blender/export_piers.py -- times_square

For each connected island the upward-facing (deck) faces are merged and their boundary edges chained into closed
outlines (Blender local metres, x/y, counter-clockwise); tiny islands (< 4 m^2: bollards, pilings) are skipped.
"""
import bpy
import bmesh
import json
import math
import os
import sys

district = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "times_square"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
o = bpy.data.objects["TER_TS_Piers"]
bm = bmesh.new()
bm.from_mesh(o.data)
bm.transform(o.matrix_world)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
bm.faces.ensure_lookup_table()
seen, piers = set(), []
for f0 in bm.faces:
    if f0.index in seen:
        continue
    stack, isl = [f0], []                                     # faces of one island
    while stack:
        f = stack.pop()
        if f.index in seen:
            continue
        seen.add(f.index)
        isl.append(f)
        for e in f.edges:
            stack.extend(g for g in e.link_faces if g.index not in seen)
    top = [f for f in isl if f.normal.z > 0.7]
    if not top:
        continue
    deck = max(v.co.z for f in top for v in f.verts)
    top = [f for f in top if f.calc_center_median().z > deck - 0.3]
    area = sum(f.calc_area() for f in top)
    if area < 4:
        continue
    tops = set(top)
    bound = [e for f in top for e in f.edges if sum(1 for g in e.link_faces if g in tops) == 1]
    nxt = {}
    for e in bound:                                           # chain boundary edges into loops
        a, b = e.verts
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)
    loops, used = [], set()
    for start in list(nxt):
        if start in used:
            continue
        loop, prev, cur = [start], None, start
        used.add(start)
        while True:
            cand = [v for v in nxt[cur] if v is not prev]
            if not cand:
                break
            n = cand[0]
            if n is start:
                break
            if n in used:
                break
            loop.append(n); used.add(n); prev, cur = cur, n
        if len(loop) >= 3:
            pts = [(round(v.co.x, 2), round(v.co.y, 2)) for v in loop]
            # drop collinear points
            clean = []
            for i, p in enumerate(pts):
                a, c = pts[i - 1], pts[(i + 1) % len(pts)]
                if abs((p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0])) > 0.02:
                    clean.append(p)
            sa = sum(clean[i - 1][0] * clean[i][1] - clean[i][0] * clean[i - 1][1] for i in range(len(clean))) / 2
            if sa < 0:
                clean.reverse()
            loops.append((abs(sa), clean))
    loops.sort(key=lambda t: -t[0])
    outline = loops[0][1]
    xs, ys = [p[0] for p in outline], [p[1] for p in outline]
    piers.append({"outline": outline, "box": [min(xs), min(ys), max(xs), max(ys)], "deck": round(deck, 2), "area": round(area)})
piers.sort(key=lambda p: -p["box"][3])
out = os.path.join(ROOT, "data", district, "piers.json")
json.dump({"district": district, "note": "pier deck outlines, Blender local metres, counter-clockwise", "piers": piers}, open(out, "w"))
print("PIERS", len(piers), "->", out)
for p in piers:
    print("P", p["box"], len(p["outline"]), "pts", p["area"], "m2")
